import type {
  CommandResult,
  PackageInfo,
  PackageScanResult,
  UpdateMode,
  UpdatePlanEntry,
  UpdateSeverity
} from '@shared/types'
import { getProject } from './store'
import { readPackageJson } from './projects'
import { runNpm } from './toolchain'

interface NpmOutdatedEntry {
  current?: string
  wanted?: string
  latest?: string
  dependent?: string
  location?: string
}

interface NpmLsEntry {
  version?: string
  resolved?: string
  missing?: boolean
}

interface NpmLsOutput {
  dependencies?: Record<string, NpmLsEntry>
}

const DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies'
] as const

/**
 * Builds the package table: every declared dependency, its installed version and
 * how far behind the registry it is.
 *
 * `npm ls` gives the truth about what is on disk; `npm outdated` adds the registry
 * side. The latter needs the network, so a failure there degrades to a plain
 * installed-versions list rather than failing the whole view.
 */
export async function scanPackages(projectId: string): Promise<PackageScanResult> {
  const project = getProject(projectId)
  if (!project) throw new Error('Project not found.')

  const pkg = await readPackageJson(project.path)
  if (!pkg) throw new Error('Could not read package.json.')

  const ranges = new Map<string, { range: string; type: PackageInfo['type'] }>()
  for (const field of DEP_FIELDS) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      ranges.set(name, { range, type: field })
    }
  }

  const [installed, outdated] = await Promise.all([readInstalled(project.path), readOutdated(project.path)])

  const packages: PackageInfo[] = []
  for (const [name, meta] of ranges) {
    const current = installed.get(name) ?? null
    const entry = outdated.data?.get(name)
    const wanted = entry?.wanted ?? null
    const latest = entry?.latest ?? null

    packages.push({
      name,
      current,
      // npm omits a package from `outdated` when it is up to date, so absence
      // means wanted and latest both equal what is installed.
      wanted: wanted ?? current,
      latest: latest ?? current,
      range: meta.range,
      type: meta.type,
      severity: severityOf(current, wanted ?? current, latest ?? current, outdated.error !== null)
    })
  }

  packages.sort((a, b) => {
    const rank: Record<UpdateSeverity, number> = {
      missing: 0,
      major: 1,
      minor: 2,
      patch: 3,
      unknown: 4,
      current: 5
    }
    return rank[a.severity] - rank[b.severity] || a.name.localeCompare(b.name)
  })

  return { packages, outdatedError: outdated.error, scannedAt: Date.now() }
}

async function readInstalled(cwd: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  // `ls` exits non-zero on unmet peer deps, which is common and not fatal here.
  const { stdout } = await runNpm(['ls', '--depth=0', '--json'], cwd)
  try {
    const parsed = JSON.parse(stdout) as NpmLsOutput
    for (const [name, entry] of Object.entries(parsed.dependencies ?? {})) {
      if (entry.missing || !entry.version) continue
      map.set(name, entry.version)
    }
  } catch {
    // Leave the map empty; every package shows as "missing", which is honest
    // when we cannot read the tree.
  }
  return map
}

async function readOutdated(
  cwd: string
): Promise<{ data: Map<string, NpmOutdatedEntry> | null; error: string | null }> {
  // `npm outdated` deliberately exits 1 when it finds outdated packages.
  const { stdout, stderr, exitCode } = await runNpm(['outdated', '--json', '--long'], cwd, {
    timeout: 180_000
  })

  const trimmed = stdout.trim()
  if (!trimmed) {
    if (exitCode !== 0 && exitCode !== 1) {
      return { data: null, error: cleanNpmError(stderr) || 'npm outdated failed.' }
    }
    return { data: new Map(), error: null }
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, NpmOutdatedEntry | NpmOutdatedEntry[]>
    const map = new Map<string, NpmOutdatedEntry>()
    for (const [name, value] of Object.entries(parsed)) {
      // With workspaces npm returns an array per package; the first entry is fine
      // for a single-project view.
      map.set(name, Array.isArray(value) ? value[0] : value)
    }
    return { data: map, error: null }
  } catch {
    return { data: null, error: cleanNpmError(stderr) || 'Could not parse npm outdated output.' }
  }
}

/** Computes the plan for "update all" without running anything. */
export async function planUpdates(projectId: string, mode: UpdateMode): Promise<UpdatePlanEntry[]> {
  const { packages } = await scanPackages(projectId)
  const target = (p: PackageInfo): string | null => (mode === 'latest' ? p.latest : p.wanted)

  return packages
    .filter((p) => {
      const to = target(p)
      return to !== null && to !== p.current
    })
    .map((p) => ({ name: p.name, from: p.current, to: target(p) as string }))
}

/**
 * `wanted` stays inside the semver ranges already in package.json, so `npm update`
 * is the right tool. `latest` crosses major versions and must rewrite the ranges,
 * which only `npm install pkg@version` does.
 */
export async function applyUpdates(
  projectId: string,
  mode: UpdateMode,
  onlyPackages?: string[]
): Promise<CommandResult> {
  const project = getProject(projectId)
  if (!project) throw new Error('Project not found.')

  const plan = await planUpdates(projectId, mode)
  const filtered = onlyPackages?.length
    ? plan.filter((entry) => onlyPackages.includes(entry.name))
    : plan

  if (filtered.length === 0) {
    return { ok: true, exitCode: 0, output: 'Everything is already up to date.' }
  }

  const args =
    mode === 'latest'
      ? ['install', ...filtered.map((e) => `${e.name}@${e.to}`), '--save']
      : ['update', ...filtered.map((e) => e.name)]

  const { stdout, stderr, exitCode } = await runNpm(args, project.path, { timeout: 600_000 })
  return {
    ok: exitCode === 0,
    exitCode,
    output: [stdout.trim(), stderr.trim()].filter(Boolean).join('\n') || 'Done.'
  }
}

export async function installPackages(projectId: string): Promise<CommandResult> {
  const project = getProject(projectId)
  if (!project) throw new Error('Project not found.')

  const { stdout, stderr, exitCode } = await runNpm(['install'], project.path, { timeout: 900_000 })
  return {
    ok: exitCode === 0,
    exitCode,
    output: [stdout.trim(), stderr.trim()].filter(Boolean).join('\n') || 'Done.'
  }
}

function severityOf(
  current: string | null,
  wanted: string | null,
  latest: string | null,
  registryFailed: boolean
): UpdateSeverity {
  if (!current) return 'missing'
  if (registryFailed || !latest) return 'unknown'
  if (current === latest) return 'current'

  const diff = semverDiff(current, latest)
  if (diff === 'major') return 'major'
  if (diff === 'minor') return 'minor'
  if (diff === 'patch') return 'patch'
  // Prerelease or non-semver versions that differ from latest.
  return wanted && wanted !== current ? 'minor' : 'unknown'
}

/** Minimal semver comparison; avoids a dependency for the one thing we need. */
function semverDiff(a: string, b: string): 'major' | 'minor' | 'patch' | null {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return null
  if (pa[0] !== pb[0]) return 'major'
  if (pa[1] !== pb[1]) return 'minor'
  if (pa[2] !== pb[2]) return 'patch'
  return null
}

function parseVersion(v: string): [number, number, number] | null {
  const match = v.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function cleanNpmError(stderr: string): string {
  return stderr
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/^npm (warn|notice)/i.test(l))
    .map((l) => l.replace(/^npm error\s*/i, ''))
    .join(' ')
    .trim()
    .slice(0, 400)
}
