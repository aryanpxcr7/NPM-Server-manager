/**
 * The integrated terminal.
 *
 * Each session is a real pseudoterminal (ConPTY, through node-pty), not a piped
 * child process: a shell only draws its prompt, colours its output and accepts
 * arrow keys when it believes it is talking to a terminal. The renderer draws it
 * with xterm.js, so what is on screen is what the shell actually emitted.
 *
 * This module owns the sessions the same way `servers.ts` owns runs -- the
 * renderer mirrors them and can be reloaded without losing anything, because the
 * scrollback is kept here and replayed on demand.
 *
 * Note the difference from every other process this app starts: the shell here is
 * chosen by the user and typed into by the user, so unlike `runNpm()` it is meant
 * to interpret what it is given. Nothing this app derives from a project folder is
 * ever written into it. See docs/DECISIONS.md §19.
 */
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { IPty } from '@lydell/node-pty'
import { spawn as spawnPty } from '@lydell/node-pty'
import type { TerminalBuffer, TerminalSession, TerminalShell } from '@shared/types'
import { getProject } from './store'

/** 'data' → TerminalChunk; 'session' → TerminalSession, when its status changes. */
export const terminalEvents = new EventEmitter()

/**
 * Scrollback kept per session, in characters.
 *
 * This is the same trade as the log panel's ring buffer: enough to scroll back
 * through a build, bounded so a runaway `while true` cannot grow the main process
 * without limit. xterm keeps its own scrollback on top of this; the buffer here
 * only has to survive a renderer reload.
 */
const MAX_BUFFER_CHARS = 256 * 1024

/**
 * Terminals are cheap but not free -- each is a shell plus a ConPTY host. This
 * only exists to turn "held Ctrl+Shift+` down" into an error message rather than
 * a machine with two hundred shells on it.
 */
const MAX_SESSIONS = 16

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

interface Session {
  info: TerminalSession
  pty: IPty
  /** Output chunks, oldest first, trimmed from the front past MAX_BUFFER_CHARS. */
  chunks: string[]
  chars: number
  seq: number
  /** Set once kill has been asked for, so a second close cannot double-kill. */
  killing: boolean
}

const sessions = new Map<string, Session>()

// --- Shells ---------------------------------------------------------------

interface ShellCandidate extends TerminalShell {
  /** Arguments that make the shell start interactive and quiet. */
  args: string[]
}

let shellCache: ShellCandidate[] | null = null

function firstExisting(...candidates: (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return null
}

/**
 * The shells present on this machine, best first.
 *
 * PowerShell 7 leads when installed because it is what a developer who installed
 * it wants; Windows PowerShell is on every Windows box, so the list is never
 * empty. Everything is located by absolute path -- a bare `powershell.exe` would
 * resolve against PATH, and PATH is writable by anything the user has run.
 */
export function listShells(): TerminalShell[] {
  return shellCandidates().map(({ id, label, file }) => ({ id, label, file }))
}

function shellCandidates(): ShellCandidate[] {
  if (shellCache) return shellCache

  const system = process.env.SystemRoot ?? 'C:\\Windows'
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const localAppData = process.env.LOCALAPPDATA ?? ''

  const found: ShellCandidate[] = []
  const add = (id: string, label: string, file: string | null, args: string[]): void => {
    if (file) found.push({ id, label, file, args })
  }

  add(
    'pwsh',
    'PowerShell',
    firstExisting(
      path.join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
      path.join(programFiles, 'PowerShell', '6', 'pwsh.exe'),
      localAppData
        ? path.join(localAppData, 'Microsoft', 'WindowsApps', 'pwsh.exe')
        : null
    ),
    ['-NoLogo']
  )

  add(
    'powershell',
    'Windows PowerShell',
    firstExisting(path.join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')),
    ['-NoLogo']
  )

  add(
    'cmd',
    'Command Prompt',
    firstExisting(process.env.ComSpec, path.join(system, 'System32', 'cmd.exe')),
    []
  )

  add(
    'git-bash',
    'Git Bash',
    firstExisting(
      path.join(programFiles, 'Git', 'bin', 'bash.exe'),
      path.join(programFilesX86, 'Git', 'bin', 'bash.exe'),
      localAppData ? path.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe') : null
    ),
    ['--login', '-i']
  )

  shellCache = found
  return found
}

/**
 * The shell to start: the one asked for, else the first one on this machine.
 *
 * A stored preference for a shell that has since been uninstalled falls back
 * rather than failing -- the setting outlives the machine it was chosen on.
 */
function resolveShell(shellId: string | null | undefined): ShellCandidate {
  const available = shellCandidates()
  if (available.length === 0) {
    throw new Error('No shell could be found on this machine — not even cmd.exe.')
  }
  if (shellId) {
    const match = available.find((s) => s.id === shellId)
    if (match) return match
  }
  return available[0]
}

// --- Sessions -------------------------------------------------------------

export interface CreateOptions {
  /** Folder to start in. Falls back to the home directory when missing. */
  cwd?: string | null
  /** Project whose folder to start in; wins over `cwd` when it resolves. */
  projectId?: string | null
  shellId?: string | null
  cols?: number
  rows?: number
}

export function createSession(options: CreateOptions = {}): TerminalSession {
  if (sessions.size >= MAX_SESSIONS) {
    throw new Error(`That is ${MAX_SESSIONS} terminals already. Close one first.`)
  }

  const project = options.projectId ? getProject(options.projectId) : null
  const home = process.env.USERPROFILE ?? process.cwd()
  const wanted = project?.path ?? options.cwd ?? home
  // A project folder can be deleted while its entry is still in the list; a
  // terminal that refuses to open is worse than one that opens somewhere sane.
  const cwd = existsSync(wanted) ? wanted : home

  const shell = resolveShell(options.shellId)
  const cols = clampDimension(options.cols, DEFAULT_COLS)
  const rows = clampDimension(options.rows, DEFAULT_ROWS)

  let pty: IPty
  try {
    pty = spawnPty(shell.file, shell.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: terminalEnv()
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not start ${shell.label}: ${message}`)
  }

  const info: TerminalSession = {
    id: randomUUID(),
    title: project?.name ?? shell.label,
    shellId: shell.id,
    shellLabel: shell.label,
    cwd,
    projectId: project?.id ?? null,
    pid: pty.pid,
    startedAt: Date.now(),
    status: 'running',
    exitCode: null
  }

  const session: Session = { info, pty, chunks: [], chars: 0, seq: 0, killing: false }
  sessions.set(info.id, session)

  pty.onData((data) => {
    session.seq += 1
    session.chunks.push(data)
    session.chars += data.length
    while (session.chars > MAX_BUFFER_CHARS && session.chunks.length > 1) {
      session.chars -= session.chunks.shift()?.length ?? 0
    }
    terminalEvents.emit('data', { id: info.id, data, seq: session.seq })
  })

  pty.onExit(({ exitCode }) => {
    session.info.status = 'exited'
    session.info.exitCode = exitCode
    terminalEvents.emit('session', { ...session.info })
  })

  return { ...info }
}

/**
 * The environment a shell starts in.
 *
 * A copy of the app's own, minus the two variables Electron uses to change how
 * `process.execPath` behaves -- leaving those set makes any `node` the user runs
 * from this terminal misbehave in ways that look like their machine is broken.
 */
function terminalEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ATTACH_CONSOLE

  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  return env
}

function clampDimension(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(500, Math.max(1, Math.floor(value)))
}

export function listSessions(): TerminalSession[] {
  return [...sessions.values()].map((s) => ({ ...s.info }))
}

/** The scrollback so far, so a remounted panel can redraw what it missed. */
export function getBuffer(id: string): TerminalBuffer {
  const session = sessions.get(id)
  if (!session) throw new Error('That terminal is no longer open.')
  return { data: session.chunks.join(''), seq: session.seq }
}

export function writeSession(id: string, data: string): void {
  const session = sessions.get(id)
  if (!session) throw new Error('That terminal is no longer open.')
  if (session.info.status !== 'running') return
  session.pty.write(data)
}

export function resizeSession(id: string, cols: number, rows: number): void {
  const session = sessions.get(id)
  // Resizes chase a ResizeObserver, so one arriving just after a shell exits is
  // ordinary rather than an error worth showing anybody.
  if (!session || session.info.status !== 'running') return
  try {
    session.pty.resize(clampDimension(cols, DEFAULT_COLS), clampDimension(rows, DEFAULT_ROWS))
  } catch {
    // The pty can close between the check above and the call.
  }
}

/**
 * Ends a session and forgets it.
 *
 * `pty.kill()` goes through ConPTY's console process list, which covers the whole
 * tree -- measured at ~145 ms including a grandchild `node` process. `taskkill /T
 * /F` is kept as the backstop for the case where that path stalls, because a
 * terminal that will not close is the one bug that leaves ports bound.
 */
export function closeSession(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  sessions.delete(id)

  if (session.info.status !== 'running' || session.killing) return
  session.killing = true

  const pid = session.info.pid
  try {
    session.pty.kill()
  } catch {
    killTree(pid)
    return
  }

  setTimeout(() => {
    if (session.info.status === 'running') killTree(pid)
  }, 2000)
}

/** Ends every session. Called on quit: a shell with no window is not usable. */
export function closeAllSessions(): void {
  for (const id of [...sessions.keys()]) {
    const session = sessions.get(id)
    const running = session?.info.status === 'running'
    const pid = session?.info.pid
    closeSession(id)

    // `pty.kill()` finishes asynchronously and the two-second backstop above
    // needs an event loop that is about to stop turning. `taskkill` is a separate
    // process, so once spawned it finishes the job whether we are here or not.
    if (running && pid !== undefined) killTree(pid)
  }
}

export function sessionCount(): number {
  return [...sessions.values()].filter((s) => s.info.status === 'running').length
}

function killTree(pid: number): void {
  execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {
    // Nothing to do either way: the session is already gone from the registry.
  })
}
