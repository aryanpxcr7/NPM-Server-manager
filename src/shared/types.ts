/** Types shared across the main process, preload bridge and renderer. */

export interface Project {
  id: string
  name: string
  path: string
  /** Epoch ms the folder was added. */
  addedAt: number
  /** Package manager inferred from the lockfile present in the folder. */
  packageManager: PackageManager
  /** Accent for the sidebar entry; null uses the default. */
  color: ProjectColor | null
}

/** Named swatches rather than free-form hex, so they stay legible on the dark UI. */
export type ProjectColor =
  | 'blue'
  | 'violet'
  | 'green'
  | 'amber'
  | 'red'
  | 'pink'
  | 'cyan'
  | 'slate'

export const PROJECT_COLORS: ProjectColor[] = [
  'blue',
  'violet',
  'green',
  'amber',
  'red',
  'pink',
  'cyan',
  'slate'
]

export type PackageManager = 'npm' | 'yarn' | 'pnpm'

/** A script entry from the project's package.json. */
export interface ProjectScript {
  name: string
  command: string
  /** Our best guess at what this script does, used to pre-sort the Start Server dialog. */
  kind: ScriptKind
}

export type ScriptKind = 'dev' | 'build' | 'start' | 'test' | 'other'

export interface ProjectDetail {
  project: Project
  /** null when package.json is missing or unparseable. */
  packageJson: {
    name: string | null
    version: string | null
  } | null
  scripts: ProjectScript[]
  hasNodeModules: boolean
  error: string | null
}

/** Severity of how far behind an installed package is. */
export type UpdateSeverity = 'current' | 'patch' | 'minor' | 'major' | 'missing' | 'unknown'

export interface PackageInfo {
  name: string
  /** Installed version, null when declared but not installed. */
  current: string | null
  /** Highest version satisfying the range in package.json. */
  wanted: string | null
  /** Highest version published to the registry. */
  latest: string | null
  /** The raw range as written in package.json, e.g. "^18.2.0". */
  range: string | null
  type: 'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies'
  severity: UpdateSeverity
}

export interface PackageScanResult {
  packages: PackageInfo[]
  /** Set when the registry check failed; packages still lists installed versions. */
  outdatedError: string | null
  scannedAt: number
}

/** A process on this machine holding a listening TCP port. */
export interface DetectedServer {
  pid: number
  processName: string
  ports: number[]
  commandLine: string | null
  /** Working directory when we can determine it, else null. */
  cwd: string | null
  /** Set when this server maps to one of the user's saved projects. */
  projectId: string | null
  projectName: string | null
  /** True when this app spawned it and still owns the handle. */
  managed: boolean
  /** Identifies the owning run, so the UI can act on it without re-deriving. */
  runId: string | null
  /** Script name for managed servers, e.g. "dev". */
  script: string | null
  startedAt: number | null
}

export interface ServerLogLine {
  runId: string
  stream: 'stdout' | 'stderr' | 'system'
  text: string
  at: number
}

export type RunStatus = 'starting' | 'running' | 'exited' | 'failed'

/** A dev/build server this app started and is tracking. */
export interface ManagedRun {
  runId: string
  projectId: string
  projectName: string
  script: string
  status: RunStatus
  pid: number | null
  exitCode: number | null
  startedAt: number
  endedAt: number | null
  /** Ports observed for this run's process tree, filled in by the scanner. */
  ports: number[]
  /** True when a previous app session started this and it outlived that session. */
  adopted: boolean
}

export interface UpdatePlanEntry {
  name: string
  from: string | null
  to: string
}

export type UpdateMode = 'wanted' | 'latest'

/** Result of a long-running npm command (update/install). */
export interface CommandResult {
  ok: boolean
  exitCode: number | null
  output: string
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** Result of checking the releases repo for a newer build. */
export interface UpdateInfo {
  currentVersion: string
  /** null when no release could be read. */
  latestVersion: string | null
  available: boolean
  /** Release notes, as markdown from the GitHub release body. */
  notes: string
  releaseUrl: string
  /** Direct download for the installer, when the release has one attached. */
  assetUrl: string | null
  assetName: string | null
  assetSize: number | null
  publishedAt: string | null
  /**
   * True when the running version is below the minimum the release policy still
   * supports. The update prompt then cannot be dismissed.
   */
  mandatory: boolean
  /** Set when the check failed; the app carries on regardless. */
  error: string | null
}

export interface UpdateProgress {
  received: number
  total: number
}
