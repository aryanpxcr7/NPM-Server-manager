import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DetectedServer } from '@shared/types'
import { getProjects, normalizePath } from './store'
import { getRunForPid, listRuns, reconcileRuns, setRunPorts } from './servers'

const execFileAsync = promisify(execFile)

/** Process names worth surfacing as "servers"; anything else is noise. */
const INTERESTING = new Set([
  'node.exe',
  'bun.exe',
  'deno.exe',
  'python.exe',
  'pythonw.exe',
  'ruby.exe',
  'php.exe',
  'dotnet.exe',
  'java.exe',
  'nginx.exe',
  'httpd.exe',
  'caddy.exe'
])

interface ListenEntry {
  pid: number
  port: number
}

interface ProcessInfo {
  pid: number
  name: string
  commandLine: string | null
  parentPid: number | null
}

/**
 * Enumerates every process holding a listening TCP port, keeping the ones that
 * look like local dev servers and mapping them back to saved projects.
 */
export async function scanServers(): Promise<DetectedServer[]> {
  const [listening, processes] = await Promise.all([listListeningPorts(), listProcesses()])

  const byPid = new Map<number, ProcessInfo>()
  for (const proc of processes) byPid.set(proc.pid, proc)

  const portsByPid = new Map<number, Set<number>>()
  const pidByPort = new Map<number, number>()
  for (const entry of listening) {
    let set = portsByPid.get(entry.pid)
    if (!set) {
      set = new Set()
      portsByPid.set(entry.pid, set)
    }
    set.add(entry.port)
    pidByPort.set(entry.port, entry.pid)
  }

  // Adopt servers left running by a previous session and retire dead ones. This
  // reuses the process table and port map we just paid for.
  reconcileRuns(byPid, pidByPort)

  const projects = getProjects()
  const servers: DetectedServer[] = []

  for (const [pid, ports] of portsByPid) {
    const proc = byPid.get(pid)
    if (!proc) continue

    const run = getRunForPid(pid, byPid)
    const isManaged = run !== undefined

    // Show anything we started, plus recognisable runtimes. System services
    // (svchost and friends) are never interesting here.
    if (!isManaged && !INTERESTING.has(proc.name.toLowerCase())) continue

    const cwd = proc.commandLine ? guessCwd(proc.commandLine) : null
    // A run already knows its project; re-deriving it would lose the name if the
    // project were removed while its server kept running.
    const match = run ? null : matchProject(proc.commandLine, cwd, projects)

    // For anything we did not start, the npm script is recovered from the
    // process tree, which is what makes an external server restartable.
    const script = run?.script ?? (isManaged ? null : findNpmScript(pid, byPid))
    const projectId = run?.projectId ?? match?.id ?? null

    servers.push({
      pid,
      processName: proc.name,
      ports: [...ports].sort((a, b) => a - b),
      commandLine: proc.commandLine,
      cwd,
      projectId,
      projectName: run?.projectName ?? match?.name ?? null,
      managed: isManaged,
      runId: run?.runId ?? null,
      script,
      restartable: !isManaged && projectId !== null && script !== null,
      startedAt: run?.startedAt ?? null
    })
  }

  // Managed runs that have not bound a port yet still belong in the list, so a
  // just-started dev server shows up immediately instead of after it boots.
  // Runs already represented above are skipped -- npm binds no port itself, so
  // its listening child stands in for the whole run.
  const shown = new Set(servers.map((s) => s.runId).filter((id): id is string => id !== null))
  for (const run of listRuns()) {
    if (run.status !== 'running' && run.status !== 'starting') continue
    if (shown.has(run.runId)) continue
    if (run.pid !== null && portsByPid.has(run.pid)) continue
    servers.push({
      pid: run.pid ?? -1,
      processName: 'node.exe',
      ports: [],
      commandLine: null,
      cwd: null,
      projectId: run.projectId,
      projectName: run.projectName,
      managed: true,
      runId: run.runId,
      script: run.script,
      restartable: false,
      startedAt: run.startedAt
    })
  }

  // Remember where each run was seen, so it can be found again after a restart.
  for (const server of servers) {
    if (server.runId && server.ports.length > 0) setRunPorts(server.runId, server.ports)
  }

  return servers.sort((a, b) => {
    if (a.managed !== b.managed) return a.managed ? -1 : 1
    return (a.ports[0] ?? 99999) - (b.ports[0] ?? 99999)
  })
}

/**
 * `netstat -ano` is far cheaper to start than a PowerShell cmdlet and needs no
 * elevation, so it is the fast path for the port table.
 */
async function listListeningPorts(): Promise<ListenEntry[]> {
  const { stdout } = await execFileAsync('netstat', ['-ano', '-p', 'TCP'], {
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  })

  const entries: ListenEntry[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    // Proto  Local Address  Foreign Address  State  PID
    if (parts.length < 5 || parts[3] !== 'LISTENING') continue

    const local = parts[1]
    // IPv6 locals look like [::1]:3000 or [::]:3000; IPv4 like 0.0.0.0:3000.
    const portMatch = local.match(/:(\d+)$/)
    const pid = Number.parseInt(parts[4], 10)
    if (!portMatch || Number.isNaN(pid) || pid === 0) continue

    entries.push({ pid, port: Number.parseInt(portMatch[1], 10) })
  }
  return entries
}

/**
 * One CIM query gives name, command line and parent for every process, which is
 * what lets us attribute a port to a project folder and walk npm -> child trees.
 */
async function listProcesses(): Promise<ProcessInfo[]> {
  const script =
    'Get-CimInstance Win32_Process | ' +
    'Select-Object ProcessId,Name,CommandLine,ParentProcessId | ' +
    'ConvertTo-Json -Compress -Depth 2'

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 20_000 }
    )

    const parsed = JSON.parse(stdout) as
      | Array<Record<string, unknown>>
      | Record<string, unknown>
    const rows = Array.isArray(parsed) ? parsed : [parsed]

    return rows
      .map((row) => ({
        pid: Number(row.ProcessId),
        name: String(row.Name ?? ''),
        commandLine: typeof row.CommandLine === 'string' ? row.CommandLine : null,
        parentPid: row.ParentProcessId === null ? null : Number(row.ParentProcessId)
      }))
      .filter((p) => Number.isFinite(p.pid))
  } catch {
    // CIM can be blocked by policy; fall back to tasklist, losing command lines.
    return listProcessesFallback()
  }
}

async function listProcessesFallback(): Promise<ProcessInfo[]> {
  const { stdout } = await execFileAsync('tasklist', ['/FO', 'CSV', '/NH'], {
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  })

  const processes: ProcessInfo[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const cols = line.match(/"([^"]*)"/g)
    if (!cols || cols.length < 2) continue
    const name = cols[0].slice(1, -1)
    const pid = Number.parseInt(cols[1].slice(1, -1), 10)
    if (Number.isNaN(pid)) continue
    processes.push({ pid, name, commandLine: null, parentPid: null })
  }
  return processes
}

/**
 * The `npm run <script>` that started a process, read off its own command line.
 *
 * Two shapes reach us. npm spawns scripts as `node …\npm-cli.js run dev`, which
 * is what the manager process itself looks like; the `npm run dev` form turns up
 * when the tree passes through a `cmd.exe /c` wrapper.
 *
 * **Only npm is recognised, deliberately.** A yarn or pnpm project would be
 * restarted with npm — this app runs npm unconditionally (see `docs/STATUS.md`
 * gap #1) — and quietly using the wrong package manager on someone's lockfile is
 * worse than not offering the button. Those servers stay stoppable, not
 * restartable.
 */
function parseNpmScript(commandLine: string): string | null {
  const match =
    /\bnpm-cli\.js"?\s+(?:run|run-script)\s+(?:"([^"]+)"|(\S+))/i.exec(commandLine) ??
    /\bnpm(?:\.cmd)?"?\s+(?:run|run-script)\s+(?:"([^"]+)"|(\S+))/i.exec(commandLine)
  if (!match) return null

  const script = match[1] ?? match[2] ?? ''
  // Anything after the script name is an npm flag or a `--` passthrough, not
  // part of the name; and a name has to look like one before it is offered.
  return /^[A-Za-z0-9_.:@\-/]+$/.test(script) ? script : null
}

/**
 * Walks up from a listening process looking for the npm invocation that started
 * it. A dev server is typically a grandchild — npm → cmd.exe → vite — so the
 * command line of the process holding the port says nothing about the script.
 */
function findNpmScript(pid: number, byPid: Map<number, ProcessInfo>): string | null {
  let current = byPid.get(pid)

  // Bounded rather than "until the root": parent pids are reused by Windows, so a
  // corrupt chain could otherwise loop, and no real npm tree is this deep.
  for (let depth = 0; current && depth < 8; depth++) {
    const script = current.commandLine ? parseNpmScript(current.commandLine) : null
    if (script) return script
    current = current.parentPid === null ? undefined : byPid.get(current.parentPid)
  }
  return null
}

/** Runtimes whose own path in argv[0] tells us nothing about the project. */
const RUNTIME_EXES = /\\(node|bun|deno|python|pythonw|ruby|php|dotnet|java)\.exe$/i

/**
 * npm and most bundlers put the project directory in argv, so an absolute path
 * from the command line approximates the working directory.
 *
 * Windows paths routinely contain spaces ("Program Files", "My Projects"), so
 * quoted arguments must be read as a whole -- a naive \S+ match would truncate
 * "C:\Program Files\..." to "C:\Program".
 */
function guessCwd(commandLine: string): string | null {
  const candidates: string[] = []

  // Quoted arguments first: everything up to the closing quote belongs to the path.
  for (const match of commandLine.matchAll(/"([A-Za-z]:\\[^"]*)"/g)) {
    candidates.push(match[1])
  }
  // Then bare arguments, which cannot contain spaces by definition.
  for (const match of commandLine.matchAll(/(?:^|\s)([A-Za-z]:\\[^"\s]+)/g)) {
    candidates.push(match[1])
  }

  // argv[0] is the interpreter itself; the project path is in a later argument.
  const meaningful = candidates.find((c) => !RUNTIME_EXES.test(c)) ?? candidates[0]
  if (!meaningful) return null

  // Trim back to a directory when the match landed on a file such as vite.js.
  const trimmed = meaningful.replace(/\\[^\\]*\.[a-z0-9]+$/i, '')
  return trimmed || null
}

function matchProject(
  commandLine: string | null,
  cwd: string | null,
  projects: ReturnType<typeof getProjects>
): { id: string; name: string } | undefined {
  if (!commandLine && !cwd) return undefined
  const haystack = `${commandLine ?? ''} ${cwd ?? ''}`.replace(/\\/g, '/').toLowerCase()

  // Longest path first, so a nested project beats its parent folder.
  const candidates = [...projects].sort((a, b) => b.path.length - a.path.length)
  const hit = candidates.find((p) => haystack.includes(normalizePath(p.path)))
  return hit ? { id: hit.id, name: hit.name } : undefined
}
