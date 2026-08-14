import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { ManagedRun, ServerLogLine } from '@shared/types'
import { closeLogFd, LogTailer, openLogFd } from './logtail'
import { getProject } from './store'
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

interface PersistedRun {
  runId: string
  projectId: string
  projectName: string
  script: string
  pid: number
  startedAt: number
  logFile: string
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
      logFile: r.logFile
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
    return Array.isArray(parsed) ? parsed : []
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
export function reconcileRuns(processIndex: Map<number, ProcSnapshot>): void {
  if (pendingAdoption !== null) {
    for (const saved of pendingAdoption) {
      if (runs.has(saved.runId)) continue
      const proc = processIndex.get(saved.pid)
      if (!proc || !looksLikeOurRun(proc, saved.script)) continue
      adopt(saved)
    }
    pendingAdoption = null
    persistRuns()
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
 * Guards against PID reuse: the recorded pid must still be a node process running
 * npm with the same script before we claim it as ours.
 */
function looksLikeOurRun(proc: ProcSnapshot, script: string): boolean {
  if (!/^(node|bun|deno)\.exe$/i.test(proc.name)) return false
  const cmd = proc.commandLine
  if (!cmd) return false
  return cmd.includes('npm-cli.js') && new RegExp(`\\brun\\s+${escapeRegExp(script)}\\b`).test(cmd)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function adopt(saved: PersistedRun): void {
  const run: RunRecord = {
    runId: saved.runId,
    projectId: saved.projectId,
    projectName: saved.projectName,
    script: saved.script,
    status: 'running',
    pid: saved.pid,
    exitCode: null,
    startedAt: saved.startedAt,
    endedAt: null,
    ports: [],
    adopted: true,
    logFile: saved.logFile,
    childPid: null,
    tailer: null,
    log: []
  }
  runs.set(run.runId, run)
  append(run, 'system', `Reattached to server still running from a previous session (PID ${saved.pid}).`)
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
      windowsHide: true,
      // Required on Windows: without it the child is torn down with the parent
      // even when its stdio never touches a pipe.
      detached: true,
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

export function clearFinishedRuns(): void {
  for (const [id, run] of runs) {
    if (!isLive(run.status)) {
      retire(run)
      runs.delete(id)
    }
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
