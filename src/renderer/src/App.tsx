import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FolderPlus,
  Layers,
  RefreshCw,
  Server,
  Terminal,
  Zap
} from 'lucide-react'
import type {
  DetectedServer,
  ManagedRun,
  Project,
  ProjectDetail,
  ServerLogLine
} from '@shared/types'
import type { ToolchainInfo } from '@shared/api'
import LogPanel from './components/LogPanel'
import ProjectView from './components/ProjectView'
import ServersView from './components/ServersView'
import { ToastProvider, useToast } from './components/Toasts'

/** How often the port table is re-read while the app is focused. */
const SCAN_INTERVAL_MS = 4000

type View = { kind: 'servers' } | { kind: 'project'; id: string }

function Shell(): React.JSX.Element {
  const toast = useToast()

  const [projects, setProjects] = useState<Project[]>([])
  const [view, setView] = useState<View>({ kind: 'servers' })
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [servers, setServers] = useState<DetectedServer[]>([])
  const [runs, setRuns] = useState<ManagedRun[]>([])
  const [logs, setLogs] = useState<Record<string, ServerLogLine[]>>({})
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [showLogs, setShowLogs] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [toolchain, setToolchain] = useState<ToolchainInfo | null>(null)
  const [toolchainError, setToolchainError] = useState<string | null>(null)

  const errorRef = useRef(toast.error)
  errorRef.current = toast.error

  const loadProjects = useCallback(async () => {
    try {
      setProjects(await window.nsm.projects.list())
    } catch (err) {
      errorRef.current(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const scan = useCallback(async (showSpinner = false) => {
    if (showSpinner) setScanning(true)
    try {
      const [found, activeRuns] = await Promise.all([
        window.nsm.servers.scan(),
        window.nsm.servers.runs()
      ])
      setServers(found)
      setRuns(activeRuns)
    } catch (err) {
      if (showSpinner) errorRef.current(err instanceof Error ? err.message : String(err))
    } finally {
      if (showSpinner) setScanning(false)
    }
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    try {
      setDetail(await window.nsm.projects.detail(id))
    } catch (err) {
      errorRef.current(err instanceof Error ? err.message : String(err))
      setDetail(null)
    }
  }, [])

  // Initial load.
  useEffect(() => {
    void loadProjects()
    void scan(true)
    window.nsm
      .toolchain()
      .then(setToolchain)
      .catch((err: unknown) =>
        setToolchainError(err instanceof Error ? err.message : String(err))
      )
  }, [loadProjects, scan])

  // Poll the port table; pause while the window is hidden so a backgrounded app
  // is not shelling out every few seconds for nothing.
  useEffect(() => {
    const tick = (): void => {
      if (document.visibilityState === 'visible') void scan()
    }
    const timer = window.setInterval(tick, SCAN_INTERVAL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [scan])

  // Live output and status from the main process.
  useEffect(() => {
    const offLog = window.nsm.servers.onLog((line) => {
      setLogs((current) => {
        const existing = current[line.runId] ?? []
        // Mirror the main process ring buffer so a chatty server cannot grow
        // renderer memory without bound.
        const next = [...existing, line]
        return { ...current, [line.runId]: next.length > 2000 ? next.slice(-2000) : next }
      })
    })

    const offRun = window.nsm.servers.onRunChanged((run) => {
      setRuns((current) => {
        const index = current.findIndex((r) => r.runId === run.runId)
        if (index === -1) return [run, ...current]
        const next = [...current]
        next[index] = run
        return next
      })
      if (run.status === 'failed') {
        errorRef.current(`${run.projectName}: "${run.script}" failed. Check the log below.`)
      }
      void scan()
    })

    return () => {
      offLog()
      offRun()
    }
  }, [scan])

  useEffect(() => {
    if (view.kind === 'project') void loadDetail(view.id)
    else setDetail(null)
  }, [view, loadDetail])

  const addProjects = async (): Promise<void> => {
    try {
      const result = await window.nsm.projects.pick()
      if (result.added.length > 0) {
        toast.success(`Added ${result.added.join(', ')}.`)
        await loadProjects()
      }
      for (const error of result.errors) toast.error(error)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const startServer = async (projectId: string, script: string): Promise<void> => {
    try {
      const run = await window.nsm.servers.start(projectId, script)
      setRuns((current) => [run, ...current.filter((r) => r.runId !== run.runId)])
      setActiveRunId(run.runId)
      setShowLogs(true)
      toast.success(`Started "${script}".`)
      void scan()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const stopServer = async (server: DetectedServer): Promise<void> => {
    try {
      // Stopping through the run kills npm's whole tree; a bare pid is the
      // fallback for servers this app never started.
      if (server.runId) await window.nsm.servers.stop(server.runId)
      else await window.nsm.servers.kill(server.pid)
      toast.success(
        server.ports.length > 0 ? `Stopped process on port ${server.ports[0]}.` : 'Process stopped.'
      )
      void scan()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const restartRun = async (runId: string): Promise<void> => {
    try {
      const run = await window.nsm.servers.restart(runId)
      setRuns(await window.nsm.servers.runs())
      setActiveRunId(run.runId)
      toast.success(`Restarted "${run.script}".`)
      void scan()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const removeProject = async (id: string): Promise<void> => {
    try {
      await window.nsm.projects.remove(id)
      setView({ kind: 'servers' })
      await loadProjects()
      toast.success('Project removed from the list.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const liveRuns = useMemo(
    () => runs.filter((r) => r.status === 'running' || r.status === 'starting'),
    [runs]
  )

  const runningProjectIds = useMemo(
    () => new Set(liveRuns.map((r) => r.projectId)),
    [liveRuns]
  )

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">
            <Zap size={15} />
          </div>
          <h1>NPM Server Manager</h1>
        </div>

        <div className="nav-list">
          <button
            className={`nav-item ${view.kind === 'servers' ? 'active' : ''}`}
            onClick={() => setView({ kind: 'servers' })}
          >
            <Server size={16} />
            Servers
            <span className="count">{servers.length}</span>
          </button>
        </div>

        <div className="sidebar-section">
          <span>Projects</span>
          <button className="btn-ghost btn-sm" onClick={addProjects} title="Add project folder">
            <FolderPlus size={15} />
          </button>
        </div>

        <div className="project-list">
          {projects.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 12.5, color: 'var(--text-faint)', lineHeight: 1.6 }}>
              No projects yet. Add a folder that contains a package.json.
            </div>
          ) : (
            projects.map((project) => (
              <button
                key={project.id}
                className={`project-item ${
                  view.kind === 'project' && view.id === project.id ? 'active' : ''
                }`}
                onClick={() => setView({ kind: 'project', id: project.id })}
                title={project.path}
              >
                <Layers size={15} style={{ flexShrink: 0 }} />
                <span className="name">{project.name}</span>
                {runningProjectIds.has(project.id) && <span className="running-dot" />}
              </button>
            ))
          )}
        </div>

        <div className="sidebar-footer">
          {toolchain ? (
            <>
              <span>node {toolchain.nodeVersion}</span>
              <span>npm v{toolchain.npmVersion}</span>
            </>
          ) : (
            <span style={{ color: toolchainError ? 'var(--red)' : undefined }}>
              {toolchainError ? 'Node not found' : 'detecting node…'}
            </span>
          )}
        </div>
      </aside>

      <main className="main">
        {view.kind === 'servers' ? (
          <>
            <div className="topbar">
              <div>
                <h2>Servers</h2>
                <div className="path">Every process listening on a TCP port right now</div>
              </div>
              <div className="topbar-spacer" />
              <button className="btn" onClick={() => scan(true)} disabled={scanning}>
                <RefreshCw size={14} className={scanning ? 'spin' : ''} /> Rescan
              </button>
              <button className="btn btn-primary" onClick={addProjects}>
                <FolderPlus size={15} /> Add project
              </button>
            </div>
            <div className="content">
              {toolchainError && (
                <div className="banner error">
                  <Terminal size={16} style={{ flexShrink: 0 }} />
                  <div>{toolchainError}</div>
                </div>
              )}
              <ServersView
                servers={servers}
                runs={runs}
                loading={scanning}
                onRefresh={() => scan(true)}
                onStopPid={stopServer}
                onRestartRun={restartRun}
                onOpenProject={(id) => setView({ kind: 'project', id })}
              />
            </div>
          </>
        ) : detail ? (
          <ProjectView
            detail={detail}
            runs={runs}
            onStart={startServer}
            onRemove={removeProject}
            onRefreshDetail={() => void loadDetail(view.id)}
          />
        ) : (
          <div className="content">
            <div className="empty">
              <RefreshCw size={24} className="spin" />
              <h3>Loading project&hellip;</h3>
            </div>
          </div>
        )}

        {showLogs && runs.length > 0 && (
          <LogPanel
            runs={runs}
            logs={logs}
            activeRunId={activeRunId}
            onSelect={setActiveRunId}
            onStop={async (runId) => {
              try {
                await window.nsm.servers.stop(runId)
                void scan()
              } catch (err) {
                toast.error(err instanceof Error ? err.message : String(err))
              }
            }}
            onRestart={restartRun}
            onClearFinished={async () => {
              await window.nsm.servers.clearFinished()
              setRuns(await window.nsm.servers.runs())
            }}
            onCollapse={() => setShowLogs(false)}
          />
        )}

        {!showLogs && liveRuns.length > 0 && (
          <button
            className="btn"
            style={{ margin: 12, alignSelf: 'flex-start' }}
            onClick={() => setShowLogs(true)}
          >
            <Terminal size={14} /> Show logs ({liveRuns.length} running)
          </button>
        )}
      </main>
    </div>
  )
}

export default function App(): React.JSX.Element {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  )
}
