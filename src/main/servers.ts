import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { ManagedRun, ServerLogLine } from '@shared/types'
import { closeLogFd, LogTailer, openLogFd } from './logtail'
import { readPackageJson } from './projects'
import { getProject, normalizePath } from './store'
import { resolveToolchain } from './toolchain'

interface RunRecord extends ManagedRun {
  logFile: string
  /** Held only for runs this session spawned; null for adopted ones. */
  childPid: number | null
  tailer: LogTailer | null
  log: ServerLogLine[]
}

/** Ring buffer size per run; enough to debug a boot failure without unbounded growth. */
const MAX_LOG_LINES = 2000

/** How much of an existing log to replay when adopting a run from a previous session. */
const ADOPT_REPLAY_BYTES = 256 * 1024

const runs = new Map<string, RunRecord>()

export const serverEvents = new EventEmitter()

/** Persisted runs awaiting validation against live processes; null once resolved. */
let pendingAdoption: PersistedRun[] | null = null
/**
 * Adoption is retried across several scans. A dev server's npm process can take
 * a moment to appear in the process table after the app starts, and giving up on
 * the first pass used to discard the saved index permanently.
 */
let adoptionAttempts = 0
const MAX_ADOPTION_ATTEMPTS = 5

interface PersistedRun {
  runId: string
  projectId: string
  projectName: string
  script: string
  pid: number
  startedAt: number
  logFile: string
  /**
   * Ports this run was last seen holding. This is what makes reattaching work:
   * npm exits with the app, but the server it launched -- a grandchild -- keeps
   * the port. The recorded pid is usually dead by the next launch, so the port is
   * the only durable handle on the process.
   */
  ports: number[]
}

// --- paths -------------------------------------------------------------------

function logDir(): string {
  const dir = path.join(app.getPath('userData'), 'logs')
  mkdirSync(dir, { recursive: true })
  return dir
}

function runsFile(): string {
  return path.join(app.getPath('userData'), 'runs.json')
}

// --- persistence -------------------------------------------------------------

function persistRuns(): void {
  const live: PersistedRun[] = [...runs.values()]
    .filter((r) => isLive(r.status) && r.pid !== null)
    .map((r) => ({
      runId: r.runId,
      projectId: r.projectId,
      projectName: r.projectName,
      script: r.script,
      pid: r.pid as number,
      startedAt: r.startedAt,
      logFile: r.logFile,
      ports: r.ports
    }))

  try {
    const file = runsFile()
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(live, null, 2), 'utf8')
    renameSync(tmp, file)
  } catch {
    // Losing the run index only costs adoption on next launch, not correctness.
  }
}

function loadPersistedRuns(): PersistedRun[] {
  try {
    const file = runsFile()
    if (!existsSync(file)) return []
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as PersistedRun[]
    if (!Array.isArray(parsed)) return []
    return parsed.map((r) => ({ ...r, ports: Array.isArray(r.ports) ? r.ports : [] }))
  } catch {
    return []
  }
}

/** Called once at startup, before the first scan. */
export function initServers(): void {
  pendingAdoption = loadPersistedRuns()
}

// --- public API --------------------------------------------------------------

function toPublic(run: RunRecord): ManagedRun {
  const { logFile: _f, childPid: _c, tailer: _t, log: _l, ...rest } = run
  void _f
  void _c
  void _t
  void _l
  return rest
}

export function listRuns(): ManagedRun[] {
  return [...runs.values()].map(toPublic).sort((a, b) => b.startedAt - a.startedAt)
}

export function getRunLog(runId: string): ServerLogLine[] {
  return runs.get(runId)?.log ?? []
}

export interface ProcSnapshot {
  pid: number
  name: string
  commandLine: string | null
  parentPid: number | null
}

/**
 * Reconciles the run registry against the live process table: adopts servers left
 * running by a previous session and retires runs whose process is gone.
 *
 * Called from the port scanner, which already pays for the process query.
 */
export function reconcileRuns(
  processIndex: Map<number, ProcSnapshot>,
  pidByPort: Map<number, number> = new Map()
): void {
  if (pendingAdoption !== null) {
    const unresolved: PersistedRun[] = []
    for (const saved of pendingAdoption) {
      if (runs.has(saved.runId)) continue
      const claimedPid = findLiveProcess(saved, processIndex, pidByPort)
      if (claimedPid !== null) {
        adopt(saved, claimedPid)
        continue
      }
      // Either the process has not surfaced yet, or it is genuinely gone. Retry
      // for a few scans rather than discarding the record on the first miss.
      unresolved.push(saved)
    }

    adoptionAttempts++
    if (unresolved.length === 0 || adoptionAttempts >= MAX_ADOPTION_ATTEMPTS) {
      pendingAdoption = null
      persistRuns()
    } else {
      pendingAdoption = unresolved
    }
  }

  let changed = false
  for (const run of runs.values()) {
    // Runs we spawned get an exit event; adopted ones must be polled.
    if (run.childPid !== null || !isLive(run.status) || run.pid === null) continue
    if (processIndex.has(run.pid)) continue
    finish(run, null, 'Process is no longer running.')
    changed = true
  }
  if (changed) persistRuns()
}

/**
 * Guards against PID reuse before reclaiming a process as ours.
 *
 * The original check required the command line to contain both `npm-cli.js` and
 * `run <script>`. That rejected legitimate runs whenever the command line was
 * unreadable, which happens routinely: `Win32_Process` omits it for processes the
 * current user cannot fully open, and the `tasklist` fallback never provides it
 * at all. Those runs then reappeared as "external" after a restart.
 *
 * A readable command line is still matched strictly. When it is missing, the
 * process name alone is accepted -- pid reuse landing on the same executable
 * name within the gap between two app launches is unlikely enough to be worth
 * the far more common correct adoption.
 */
function looksLikeOurRun(proc: ProcSnapshot, saved: PersistedRun): boolean {
  if (!/^(node|bun|deno)\.exe$/i.test(proc.name)) return false

  const cmd = proc.commandLine
  if (!cmd) return true

  if (new RegExp(`\\brun\\s+${escapeRegExp(saved.script)}\\b`).test(cmd)) return true

  // Some npm versions rewrite argv, but the project path stays a strong signal.
  const project = getProject(saved.projectId)
  return Boolean(
    project && cmd.replace(/\\/g, '/').toLowerCase().includes(normalizePath(project.path))
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Locates the process still serving a saved run, if any.
 *
 * The recorded pid is npm's, and npm does not survive the app closing -- the
 * server it spawned does. So the pid is only a first guess; the ports the run was
 * last seen on are the reliable route back to it.
 */
function findLiveProcess(
  saved: PersistedRun,
  processIndex: Map<number, ProcSnapshot>,
  pidByPort: Map<number, number>
): number | null {
  const byPid = processIndex.get(saved.pid)
  if (byPid && looksLikeOurRun(byPid, saved)) return saved.pid

  for (const port of saved.ports) {
    const pid = pidByPort.get(port)
    if (pid === undefined) continue
    const proc = processIndex.get(pid)
    // Any runtime still holding a port this run owned is that run continuing.
    if (proc && /^(node|bun|deno)\.exe$/i.test(proc.name)) return pid
  }
  return null
}

/** Records the ports a run is observed on, so it can be found again next launch. */
export function setRunPorts(runId: string, ports: number[]): void {
  const run = runs.get(runId)
  if (!run) return
  const same =
    run.ports.length === ports.length && run.ports.every((p, i) => p === ports[i])
  if (same) return
  run.ports = ports
  persistRuns()
}

function adopt(saved: PersistedRun, livePid: number): void {
  const run: RunRecord = {
    runId: saved.runId,
    projectId: saved.projectId,
    projectName: saved.projectName,
    script: saved.script,
    status: 'running',
    pid: livePid,
    exitCode: null,
    startedAt: saved.startedAt,
    endedAt: null,
    ports: saved.ports,
    adopted: true,
    logFile: saved.logFile,
    childPid: null,
    tailer: null,
    log: []
  }
  runs.set(run.runId, run)
  append(run, 'system', `Reattached to server still running from a previous session (PID ${livePid}).`)
  startTailing(run, true)
  serverEvents.emit('run-changed', toPublic(run))
}

export async function startServer(projectId: string, script: string): Promise<ManagedRun> {
  const project = getProject(projectId)
  if (!project) throw new Error('Project not found. It may have been removed.')

  const existing = [...runs.values()].find(
    (r) => r.projectId === projectId && r.script === script && isLive(r.status)
  )
  if (existing) throw new Error(`"${script}" is already running for ${project.name}.`)

  const { nodeExe, npmCli } = await resolveToolchain()
  const runId = randomUUID()
  const logFile = path.join(logDir(), `${runId}.log`)

  // Output goes to a file rather than a pipe. A piped child dies as soon as the
  // app exits and it next writes to the broken pipe; a file-backed one survives.
  // See docs/DECISIONS.md §10.
  const fd = openLogFd(logFile)

  let child: ReturnType<typeof spawn>
  try {
    child = spawn(nodeExe, [npmCli, 'run', script], {
      cwd: project.path,
      // windowsHide gives the child an *invisible* console, which npm's cmd.exe
      // then inherits. Adding `detached` would give it no console at all, forcing
      // cmd.exe to allocate a fresh visible one -- that is the terminal window
      // that used to pop up. Detached is not needed for the process to outlive
      // the app; Windows does not reap children when their parent exits.
      // See docs/DECISIONS.md §10.
      windowsHide: true,
      stdio: ['ignore', fd, fd],
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        NPM_CONFIG_COLOR: 'false',
        BROWSER: 'none'
      }
    })
  } finally {
    // The child holds its own duplicate of the descriptor.
    closeLogFd(fd)
  }

  const run: RunRecord = {
    runId,
    projectId,
    projectName: project.name,
    script,
    status: 'running',
    pid: child.pid ?? null,
    exitCode: null,
    startedAt: Date.now(),
    endedAt: null,
    ports: [],
    adopted: false,
    logFile,
    childPid: child.pid ?? null,
    tailer: null,
    log: []
  }
  runs.set(runId, run)

  append(run, 'system', `> npm run ${script}  (in ${project.path})`)
  startTailing(run, false)

  child.on('error', (err) => {
    finish(run, null, `Failed to start: ${err.message}`, 'failed')
  })

  child.on('exit', (code, signal) => {
    finish(
      run,
      code,
      signal ? `Stopped (${signal}).` : `Process exited with code ${code ?? 'unknown'}.`,
      code === 0 || signal === 'SIGTERM' ? 'exited' : 'failed'
    )
  })

  // The app must not be kept alive by this child, and the child must not die
  // with it.
  child.unref()

  persistRuns()
  serverEvents.emit('run-changed', toPublic(run))
  return toPublic(run)
}

export async function stopServer(runId: string): Promise<void> {
  const run = runs.get(runId)
  if (!run) throw new Error('That run is no longer tracked.')
  if (!isLive(run.status) || run.pid === null) return

  append(run, 'system', 'Stopping...')
  await killTree(run.pid)

  // Adopted runs have no exit event, so settle their state here.
  if (run.childPid === null) finish(run, null, 'Stopped.')
}

export async function restartServer(runId: string): Promise<ManagedRun> {
  const run = runs.get(runId)
  if (!run) throw new Error('That run is no longer tracked.')

  const { projectId, script } = run
  if (isLive(run.status) && run.pid !== null) {
    await killTree(run.pid)
    await waitForExit(run)
  }
  retire(run)
  runs.delete(runId)
  return startServer(projectId, script)
}

/** Stops a server we did not start, found by the port scanner. */
export async function killPid(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid process id.')
  if (pid === process.pid) throw new Error('Refusing to stop NPM Server Manager itself.')
  await killTree(pid)
}

/**
 * Takes over a server this app did not start: kills its tree, then runs the same
 * npm script as a managed run.
 *
 * The result is deliberately not a like-for-like restart. A server started in a
 * terminal has no log we can read and no handle we can hold, so re-running the
 * script the scanner found is both the only thing we *can* do and the more useful
 * one — afterwards it has live output, a stop button and it survives a restart of
 * the app like any other run.
 */
export async function restartExternal(
  pid: number,
  projectId: string,
  script: string
): Promise<ManagedRun> {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid process id.')
  if (pid === process.pid) throw new Error('Refusing to stop NPM Server Manager itself.')

  const project = getProject(projectId)
  if (!project) throw new Error('Project not found. It may have been removed.')

  // The script name was recovered from a command line, so it is checked against
  // the project's own package.json before anything runs it. Nothing derived from
  // a process listing is trusted as a name to execute.
  const pkg = await readPackageJson(project.path)
  const scripts = pkg?.scripts ?? {}
  if (!Object.prototype.hasOwnProperty.call(scripts, script)) {
    throw new Error(`${project.name} has no "${script}" script to restart.`)
  }

  await killTree(pid)
  // The replacement binds the same port, so the old holder has to be gone first
  // or the new server dies on EADDRINUSE and looks like our fault.
  await waitForPidGone(pid)

  return startServer(projectId, script)
}

/** True while `pid` still exists. Costs no process spawn, unlike tasklist. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // ESRCH is "no such process"; EPERM means it exists but belongs to someone
    // whose processes we may not signal, which still counts as alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function waitForPidGone(pid: number, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
}

export function clearFinishedRuns(): void {
  for (const [id, run] of runs) {
    if (!isLive(run.status)) {
      retire(run)
      runs.delete(id)
    }
  }
  persistRuns()
}

export function liveRunCount(): number {
  return [...runs.values()].filter((r) => isLive(r.status)).length
}

/** Stops every running server. Only used when the user explicitly asks to. */
export async function stopAll(): Promise<void> {
  await Promise.all(
    [...runs.values()]
      .filter((r) => isLive(r.status) && r.pid !== null)
      .map((r) => killTree(r.pid as number).catch(() => undefined))
  )
  // Nothing survives, so the run index should not invite a reattach next launch.
  for (const run of runs.values()) {
    if (isLive(run.status)) finish(run, null, 'Stopped on quit.')
  }
  persistRuns()
}

/**
 * Detaches from every running server without stopping it, so they outlive the
 * app. Called on quit.
 */
export function detachAll(): void {
  for (const run of runs.values()) {
    run.tailer?.stop()
    run.tailer = null
  }
  persistRuns()
}

export function getRunForPid(
  pid: number,
  processIndex: Map<number, { pid: number; parentPid: number | null }>
): ManagedRun | undefined {
  const owners = new Map<number, RunRecord>()
  for (const run of runs.values()) {
    if (run.pid !== null && isLive(run.status)) owners.set(run.pid, run)
  }
  if (owners.size === 0) return undefined

  let current: number | null = pid
  const seen = new Set<number>()
  for (let depth = 0; current !== null && depth < 12; depth++) {
    if (seen.has(current)) break
    seen.add(current)

    const owner = owners.get(current)
    if (owner) return toPublic(owner)

    const proc: { pid: number; parentPid: number | null } | undefined = processIndex.get(current)
    current = proc?.parentPid ?? null
    if (current === 0) break
  }
  return undefined
}

// --- internals ---------------------------------------------------------------

function isLive(status: ManagedRun['status']): boolean {
  return status === 'running' || status === 'starting'
}

function startTailing(run: RunRecord, replayHistory: boolean): void {
  const tailer = new LogTailer(run.logFile, (lines) => {
    for (const line of lines) emit(run, classifyLine(line), line)
  })

  let from = 0
  if (replayHistory && existsSync(run.logFile)) {
    try {
      const { size } = statSync(run.logFile)
      from = Math.max(0, size - ADOPT_REPLAY_BYTES)
    } catch {
      from = 0
    }
  }

  run.tailer = tailer
  tailer.start(from)
}

/**
 * stdout and stderr share one file so their interleaving is preserved, which
 * costs the stream distinction. Errors are recognised by shape instead --
 * imprecise, but only affects colouring. See docs/DECISIONS.md §10.
 */
function classifyLine(text: string): ServerLogLine['stream'] {
  return /\b(error|err!|failed|exception|cannot find|ENOENT|EADDRINUSE)\b/i.test(text)
    ? 'stderr'
    : 'stdout'
}

function finish(
  run: RunRecord,
  exitCode: number | null,
  message: string,
  status: ManagedRun['status'] = 'exited'
): void {
  if (!isLive(run.status)) return
  run.status = status
  run.exitCode = exitCode
  run.endedAt = Date.now()
  run.childPid = null
  append(run, 'system', message)
  // Give the tailer a moment to drain output written just before exit.
  setTimeout(() => {
    run.tailer?.stop()
    run.tailer = null
  }, 600)
  persistRuns()
  serverEvents.emit('run-changed', toPublic(run))
}

function retire(run: RunRecord): void {
  run.tailer?.stop()
  run.tailer = null
}

function killTree(pid: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'taskkill',
      ['/pid', String(pid), '/T', '/F'],
      { windowsHide: true },
      (err, _o, stderr) => {
        if (!err) return resolve()
        // 128 means the process already exited between scan and kill.
        const code = (err as NodeJS.ErrnoException & { code?: number }).code
        if (code === 128) return resolve()
        reject(new Error(stderr?.trim() || err.message))
      }
    )
  })
}

function waitForExit(run: RunRecord, timeoutMs = 5000): Promise<void> {
  if (!isLive(run.status)) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(finishWait, timeoutMs)
    function finishWait(): void {
      clearTimeout(timer)
      serverEvents.off('run-changed', onChange)
      resolve()
    }
    function onChange(changed: ManagedRun): void {
      if (changed.runId === run.runId && !isLive(changed.status)) finishWait()
    }
    serverEvents.on('run-changed', onChange)
  })
}

function append(run: RunRecord, stream: ServerLogLine['stream'], text: string): void {
  emit(run, stream, text)
}

function emit(run: RunRecord, stream: ServerLogLine['stream'], text: string): void {
  const line: ServerLogLine = { runId: run.runId, stream, text, at: Date.now() }
  run.log.push(line)
  if (run.log.length > MAX_LOG_LINES) run.log.splice(0, run.log.length - MAX_LOG_LINES)
  serverEvents.emit('log', line)
}
