import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { ManagedRun, ServerLogLine } from '@shared/types'
import { getProject } from './store'
import { resolveToolchain } from './toolchain'

interface RunRecord extends ManagedRun {
  child: ChildProcess | null
  log: ServerLogLine[]
}

/** Ring buffer size per run; enough to debug a boot failure without unbounded growth. */
const MAX_LOG_LINES = 2000

const runs = new Map<string, RunRecord>()

export const serverEvents = new EventEmitter()

function toPublic(run: RunRecord): ManagedRun {
  const { child: _child, log: _log, ...rest } = run
  void _child
  void _log
  return rest
}

export function listRuns(): ManagedRun[] {
  return [...runs.values()].map(toPublic).sort((a, b) => b.startedAt - a.startedAt)
}

export function getRunLog(runId: string): ServerLogLine[] {
  return runs.get(runId)?.log ?? []
}

/**
 * Resolves the run that owns a pid, following parent links so the actual dev
 * server (a grandchild of npm) is still attributed to the run that started it.
 */
export function getRunForPid(
  pid: number,
  processIndex: Map<number, { pid: number; parentPid: number | null }>
): ManagedRun | undefined {
  const owners = new Map<number, RunRecord>()
  for (const run of runs.values()) {
    if (run.pid !== null && (run.status === 'running' || run.status === 'starting')) {
      owners.set(run.pid, run)
    }
  }
  if (owners.size === 0) return undefined

  let current: number | null = pid
  const seen = new Set<number>()
  // Cap the walk; a cycle in the reported parent chain must not hang the scan.
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

export async function startServer(projectId: string, script: string): Promise<ManagedRun> {
  const project = getProject(projectId)
  if (!project) throw new Error('Project not found. It may have been removed.')

  const existing = [...runs.values()].find(
    (r) => r.projectId === projectId && r.script === script && isLive(r.status)
  )
  if (existing) {
    throw new Error(`"${script}" is already running for ${project.name}.`)
  }

  const { nodeExe, npmCli } = await resolveToolchain()
  const runId = randomUUID()

  const run: RunRecord = {
    runId,
    projectId,
    projectName: project.name,
    script,
    status: 'starting',
    pid: null,
    exitCode: null,
    startedAt: Date.now(),
    endedAt: null,
    ports: [],
    child: null,
    log: []
  }
  runs.set(runId, run)

  // No shell: argv goes straight to CreateProcess, so a folder name containing
  // & or ^ is just a folder name.
  const child = spawn(nodeExe, [npmCli, 'run', script], {
    cwd: project.path,
    windowsHide: true,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      NPM_CONFIG_COLOR: 'false',
      // Many dev servers try to open a browser tab on boot; keep that off.
      BROWSER: 'none'
    }
  })

  run.child = child
  run.pid = child.pid ?? null
  run.status = 'running'

  append(run, 'system', `> npm run ${script}  (in ${project.path})`)

  child.stdout?.on('data', (chunk: Buffer) => append(run, 'stdout', chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => append(run, 'stderr', chunk.toString()))

  child.on('error', (err) => {
    run.status = 'failed'
    run.endedAt = Date.now()
    append(run, 'system', `Failed to start: ${err.message}`)
    serverEvents.emit('run-changed', toPublic(run))
  })

  child.on('exit', (code, signal) => {
    run.status = code === 0 || signal === 'SIGTERM' ? 'exited' : 'failed'
    run.exitCode = code
    run.endedAt = Date.now()
    run.child = null
    append(
      run,
      'system',
      signal ? `Stopped (${signal}).` : `Process exited with code ${code ?? 'unknown'}.`
    )
    serverEvents.emit('run-changed', toPublic(run))
  })

  serverEvents.emit('run-changed', toPublic(run))
  return toPublic(run)
}

export async function stopServer(runId: string): Promise<void> {
  const run = runs.get(runId)
  if (!run) throw new Error('That run is no longer tracked.')
  if (!isLive(run.status) || run.pid === null) return

  append(run, 'system', 'Stopping...')
  await killTree(run.pid)
}

export async function restartServer(runId: string): Promise<ManagedRun> {
  const run = runs.get(runId)
  if (!run) throw new Error('That run is no longer tracked.')

  const { projectId, script } = run
  if (isLive(run.status) && run.pid !== null) {
    await killTree(run.pid)
    await waitForExit(run)
  }
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
    if (!isLive(run.status)) runs.delete(id)
  }
}

/** Kills every live run; called on app quit so nothing is orphaned. */
export async function stopAll(): Promise<void> {
  await Promise.all(
    [...runs.values()]
      .filter((r) => isLive(r.status) && r.pid !== null)
      .map((r) => killTree(r.pid as number).catch(() => undefined))
  )
}

function isLive(status: ManagedRun['status']): boolean {
  return status === 'running' || status === 'starting'
}

/**
 * npm launches the real server as a child, so killing only npm's pid would leave
 * the port bound. taskkill /T walks the whole tree.
 */
function killTree(pid: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, (err, _o, stderr) => {
      if (!err) return resolve()
      // 128 means the process already exited between scan and kill -- not an error.
      const code = (err as NodeJS.ErrnoException & { code?: number }).code
      if (code === 128) return resolve()
      reject(new Error(stderr?.trim() || err.message))
    })
  })
}

function waitForExit(run: RunRecord, timeoutMs = 5000): Promise<void> {
  if (!isLive(run.status)) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(finish, timeoutMs)
    function finish(): void {
      clearTimeout(timer)
      serverEvents.off('run-changed', onChange)
      resolve()
    }
    function onChange(changed: ManagedRun): void {
      if (changed.runId === run.runId && !isLive(changed.status)) finish()
    }
    serverEvents.on('run-changed', onChange)
  })
}

function append(run: RunRecord, stream: ServerLogLine['stream'], text: string): void {
  const cleaned = text.replace(/\r\n/g, '\n').replace(/\r/g, '')
  for (const raw of cleaned.split('\n')) {
    if (raw.trim() === '' && stream !== 'system') continue
    const line: ServerLogLine = { runId: run.runId, stream, text: raw, at: Date.now() }
    run.log.push(line)
    if (run.log.length > MAX_LOG_LINES) run.log.splice(0, run.log.length - MAX_LOG_LINES)
    serverEvents.emit('log', line)
  }
}
