import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app, shell } from 'electron'
import type { UpdateInfo } from '@shared/types'

/** Releases live in their own repo so the source repo's history stays clean. */
const RELEASES_REPO = 'aryanpxcr7/NPM-SM-Releases'
const LATEST_URL = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${RELEASES_REPO}/releases`

/** GitHub rejects API requests without one. */
const USER_AGENT = 'NPM-Server-Manager-Updater'

interface GhAsset {
  name: string
  browser_download_url: string
  size: number
  content_type: string
}

interface GhRelease {
  tag_name: string
  name: string | null
  body: string | null
  html_url: string
  draft: boolean
  prerelease: boolean
  published_at: string | null
  assets: GhAsset[]
}

export function currentVersion(): string {
  return app.getVersion()
}

/**
 * Asks GitHub for the newest published release.
 *
 * Unauthenticated, so it is subject to a 60 requests/hour/IP limit -- fine for a
 * check on launch plus the occasional manual one. Any failure is reported rather
 * than thrown, because a missing network should never disrupt the app.
 */
export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = currentVersion()
  const base: UpdateInfo = {
    currentVersion: current,
    latestVersion: null,
    available: false,
    notes: '',
    releaseUrl: RELEASES_PAGE,
    assetUrl: null,
    assetName: null,
    assetSize: null,
    publishedAt: null,
    mandatory: false,
    error: null
  }

  let response: Response
  try {
    response = await fetch(LATEST_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15_000)
    })
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : 'Network request failed.' }
  }

  // A 404 here is indistinguishable from "no releases yet", but since releases
  // are always published for this app it in practice means the repo is private,
  // renamed or gone. That once failed silently as "you're up to date", which is
  // the worst possible way to be wrong -- so it is reported.
  if (response.status === 404) {
    return {
      ...base,
      error:
        'Could not read the releases list. The releases repository may be private, ' +
        'renamed or unavailable.'
    }
  }
  if (response.status === 403 || response.status === 429) {
    return { ...base, error: 'GitHub rate limit reached. Try again later.' }
  }
  if (!response.ok) {
    return { ...base, error: `GitHub returned ${response.status}.` }
  }

  const release = (await response.json()) as GhRelease
  if (release.draft) return base

  const latest = normalizeVersion(release.tag_name)
  const asset = pickInstaller(release.assets)
  const minimum = await minimumSupported(release)

  return {
    currentVersion: current,
    latestVersion: latest,
    available: isNewer(latest, current),
    notes: (release.body ?? '').trim(),
    releaseUrl: release.html_url || RELEASES_PAGE,
    assetUrl: asset?.browser_download_url ?? null,
    assetName: asset?.name ?? null,
    assetSize: asset?.size ?? null,
    publishedAt: release.published_at,
    // Older builds shipped a download path that silently corrupted the installer,
    // so leaving people on them is not a neutral choice.
    mandatory: minimum !== null && isNewer(minimum, current),
    error: null
  }
}

/**
 * Reads the minimum supported version from `update-policy.json` on the latest
 * release, when one is attached.
 *
 * Publishing the floor alongside the release, rather than baking it into the app,
 * means a version can be retired after the fact -- which is the only option once
 * a defective build is already installed somewhere.
 */
async function minimumSupported(release: GhRelease): Promise<string | null> {
  const asset = release.assets.find((a) => /^update-policy\.json$/i.test(a.name))
  if (!asset) return null
  try {
    const res = await fetch(asset.browser_download_url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) return null
    const policy = (await res.json()) as { minimumVersion?: unknown }
    return typeof policy.minimumVersion === 'string' ? normalizeVersion(policy.minimumVersion) : null
  } catch {
    return null
  }
}

function pickInstaller(assets: GhAsset[]): GhAsset | undefined {
  return assets.find((a) => /setup.*\.exe$/i.test(a.name)) ?? assets.find((a) => /\.exe$/i.test(a.name))
}

function normalizeVersion(tag: string): string {
  return tag.trim().replace(/^v/i, '')
}

/**
 * Compares dotted numeric versions. A prerelease suffix loses to the same version
 * without one, so 1.2.0 beats 1.2.0-beta.1.
 */
export function isNewer(candidate: string, current: string): boolean {
  const a = parse(candidate)
  const b = parse(current)
  if (!a || !b) return false

  for (let i = 0; i < 3; i++) {
    if (a.parts[i] !== b.parts[i]) return a.parts[i] > b.parts[i]
  }
  if (a.pre === b.pre) return false
  if (!a.pre) return true // release beats prerelease
  if (!b.pre) return false
  return a.pre > b.pre
}

function parse(version: string): { parts: [number, number, number]; pre: string } | null {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/)
  if (!match) return null
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ?? ''
  }
}

function updateDir(): string {
  return path.join(app.getPath('userData'), 'updates')
}

/**
 * Downloads the installer to a temp folder, reporting progress.
 * Returns the path to the downloaded file.
 */
export async function downloadUpdate(
  info: Pick<UpdateInfo, 'assetUrl' | 'assetName' | 'assetSize'>,
  onProgress: (received: number, total: number) => void
): Promise<string> {
  if (!info.assetUrl || !info.assetName) {
    throw new Error('This release has no installer attached. Open the release page instead.')
  }

  const dir = updateDir()
  await mkdir(dir, { recursive: true })
  const target = path.join(dir, info.assetName)


  // A previous download is only reused if it still verifies. Size alone is not
  // sufficient -- the duplicated-chunk bug produced a correctly sized, corrupt file.
  try {
    await stat(target)
    await verifyDownload(target, info, info.assetSize ?? 0)
    onProgress(info.assetSize ?? 0, info.assetSize ?? 0)
    return target
  } catch {
    await rm(target, { force: true }).catch(() => undefined)
  }

  const response = await fetch(info.assetUrl, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'follow'
  })
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: GitHub returned ${response.status}.`)
  }

  const total = Number(response.headers.get('content-length')) || info.assetSize || 0
  let received = 0

  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])

  // Progress is counted by a pass-through in the pipeline, NOT by a 'data'
  // listener on the source. Attaching 'data' before pipeline consumes the stream
  // puts it in flowing mode early and chunks get re-delivered from the internal
  // buffer -- which silently duplicated a 16 KB block and produced an installer
  // of exactly the right size whose contents were wrong. See DECISIONS.md §16.
  const counter = new Transform({
    transform(chunk: Buffer, _enc, callback) {
      received += chunk.length
      onProgress(received, total)
      callback(null, chunk)
    }
  })

  const partial = `${target}.part`
  await pipeline(source, counter, createWriteStream(partial))

  await verifyDownload(partial, info, total)

  // Rename only once the file is verified, so a bad download is never mistaken
  // for a usable one.
  await rename(partial, target)
  return target
}

/**
 * Refuses to hand back an installer that is not byte-for-byte what was published.
 *
 * A size check alone is not enough: the duplicated-chunk bug produced a file of
 * exactly the expected length. When the release publishes SHA256SUMS.txt the hash
 * is authoritative; otherwise the structural checks still catch truncation and
 * error pages served in place of a binary.
 */
async function verifyDownload(
  file: string,
  info: Pick<UpdateInfo, 'assetUrl' | 'assetName'>,
  expectedSize: number
): Promise<void> {
  const { size } = await stat(file)
  if (expectedSize && size !== expectedSize) {
    await rm(file, { force: true })
    throw new Error(
      `Download is incomplete (${size} of ${expectedSize} bytes). Please try again.`
    )
  }

  const head = await readFile(file, { encoding: null }).then((b) => b.subarray(0, 2).toString('latin1'))
  if (head !== 'MZ') {
    await rm(file, { force: true })
    throw new Error('Downloaded file is not a Windows installer. Please try again.')
  }

  const expected = await publishedChecksum(info.assetName ?? '')
  if (!expected) return // release predates checksum publishing

  const actual = await sha256(file)
  if (actual !== expected) {
    await rm(file, { force: true })
    throw new Error('Downloaded installer failed its integrity check. Please try again.')
  }
}

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  return hash.digest('hex')
}

/** Reads SHA256SUMS.txt from the release, when one is attached. */
async function publishedChecksum(assetName: string): Promise<string | null> {
  if (!assetName) return null
  try {
    const res = await fetch(LATEST_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) return null
    const release = (await res.json()) as GhRelease
    const sums = release.assets.find((a) => /^SHA256SUMS\.txt$/i.test(a.name))
    if (!sums) return null

    const body = await fetch(sums.browser_download_url, {
      headers: { 'User-Agent': USER_AGENT }
    }).then((r) => (r.ok ? r.text() : ''))

    for (const line of body.split(/\r?\n/)) {
      // Format: "<hex>  <filename>"
      const match = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i)
      if (match && match[2].trim() === assetName) return match[1].toLowerCase()
    }
    return null
  } catch {
    return null
  }
}

/**
 * Launches the downloaded installer and quits, so it can replace files the
 * running app has locked.
 */
export async function installUpdate(installerPath: string): Promise<void> {
  const error = await shell.openPath(installerPath)
  if (error) throw new Error(`Could not launch the installer: ${error}`)
  // Give the shell a moment to spawn it before we exit.
  setTimeout(() => app.quit(), 1200)
}

export function releasesPage(): string {
  return RELEASES_PAGE
}
