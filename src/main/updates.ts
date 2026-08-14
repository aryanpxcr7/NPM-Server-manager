import { createWriteStream } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
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
    error: null
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

  // A completed download from a previous attempt can be reused.
  try {
    const existing = await stat(target)
    if (info.assetSize && existing.size === info.assetSize) {
      onProgress(existing.size, info.assetSize)
      return target
    }
    await rm(target, { force: true })
  } catch {
    /* not downloaded yet */
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
  source.on('data', (chunk: Buffer) => {
    received += chunk.length
    onProgress(received, total)
  })

  const partial = `${target}.part`
  await pipeline(source, createWriteStream(partial))

  // Rename only once the whole file is on disk, so a cancelled download is never
  // mistaken for a complete one.
  const { rename } = await import('node:fs/promises')
  await rename(partial, target)
  return target
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
