import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  FolderPlus,
  Layers,
  RefreshCw,
  ScrollText,
  Server,
  Settings as SettingsIcon,
  Terminal,
  Zap
} from 'lucide-react'
import type {
  DetectedServer,
  ExternalTerminalShell,
  ManagedRun,
  Project,
  ProjectColor,
  ProjectDetail,
  ServerLogLine,
  UpdateInfo
} from '@shared/types'
import type { ToolchainInfo } from '@shared/api'
import LogPanel from './components/LogPanel'
import ProjectContextMenu, { type MenuTarget } from './components/ProjectContextMenu'
import ProjectView from './components/ProjectView'
import QuitDialog from './components/QuitDialog'
import ServersView from './components/ServersView'
import SettingsDialog from './components/SettingsDialog'
import { SettingsProvider, useSettings } from './components/SettingsProvider'
import TerminalPanel from './components/TerminalPanel'
import ExternalTerminalDialog from './components/ExternalTerminalDialog'
import UpdateBanner from './components/UpdateBanner'
import UpdateDialog from './components/UpdateDialog'
import { ToastProvider, useToast } from './components/Toasts'
import { firstServerUrl } from './lib/links'
import { DOCK_MAX_HEIGHT, DOCK_MIN_HEIGHT } from './lib/settings'
import { bindingLookup, comboOf, resolveBindings } from './lib/shortcuts'

/**
 * How long "open in browser when ready" waits for a starting server to reveal an
 * address. Generous, because a cold Next.js build can take a while to listen.
 */
const OPEN_TIMEOUT_MS = 90_000

type View = { kind: 'servers' } | { kind: 'project'; id: string }

/** Which half of the bottom dock is on screen. */
type DockTab = 'logs' | 'terminal'

function Shell(): React.JSX.Element {
  const toast = useToast()
  const { settings, update: updateSettings } = useSettings()

  const [projects, setProjects] = useState<Project[]>([])
  const [view, setView] = useState<View>({ kind: 'servers' })
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [servers, setServers] = useState<DetectedServer[]>([])
  const [runs, setRuns] = useState<ManagedRun[]>([])
  const [logs, setLogs] = useState<Record<string, ServerLogLine[]>>({})
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [dockOpen, setDockOpen] = useState(true)
  const [dockTab, setDockTab] = useState<DockTab>('logs')
  /** Live height while the dock is being dragged; null means "use the setting". */
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  /** Bumped to ask the terminal panel for a new session in the open project. */
  const [terminalRequest, setTerminalRequest] = useState(0)
  const [scanning, setScanning] = useState(false)
  const [toolchain, setToolchain] = useState<ToolchainInfo | null>(null)
  const [toolchainError, setToolchainError] = useState<string | null>(null)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [menu, setMenu] = useState<MenuTarget | null>(null)
  const [externalTerminalProject, setExternalTerminalProject] = useState<Project | null>(null)
  const [updatePrompted, setUpdatePrompted] = useState(false)
  const [updateAutoStart, setUpdateAutoStart] = useState(false)
  const [quitPrompt, setQuitPrompt] = useState<{ liveRuns: number } | null>(null)
  const [settingsTab, setSettingsTab] = useState<'appearance' | 'behaviour' | 'shortcuts' | null>(
    null
  )
  // Lifted out of ProjectView so a shortcut can open the script picker too.
  const [startPickerOpen, setStartPickerOpen] = useState(false)

  const errorRef = useRef(toast.error)
  errorRef.current = toast.error
  const infoRef = useRef(toast.info)
  infoRef.current = toast.info

  /** Runs waiting to be opened in the browser, mapped to their giving-up timer. */
  const pendingOpenRef = useRef(new Map<string, number>())
  /** Mirror of `logs`, so a run armed after its first output can still catch up. */
  const logsRef = useRef<Record<string, ServerLogLine[]>>({})

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

  /** Stops waiting to open `runId`; true when it was still armed. */
  const cancelPendingOpen = useCallback((runId: string): boolean => {
    const timer = pendingOpenRef.current.get(runId)
    if (timer === undefined) return false
    window.clearTimeout(timer)
    pendingOpenRef.current.delete(runId)
    return true
  }, [])

  /** Opens `url` for a run that asked for it, once. Later addresses are ignored. */
  const openRunUrl = useCallback((runId: string, url: string): void => {
    if (!cancelPendingOpen(runId)) return
    window.nsm
      .openExternal(url)
      .catch((err: unknown) => errorRef.current(err instanceof Error ? err.message : String(err)))
  }, [cancelPendingOpen])

  /** Starts waiting for `runId` to reveal an address, and opens it when it does. */
  const armOpenOnStart = useCallback(
    (runId: string, script: string): void => {
      cancelPendingOpen(runId)
      const timer = window.setTimeout(() => {
        if (cancelPendingOpen(runId)) {
          infoRef.current(`"${script}" gave no address to open. Use the port chip when it appears.`)
        }
      }, OPEN_TIMEOUT_MS)
      pendingOpenRef.current.set(runId, timer)

      // Output can arrive before start() resolves, so replay what already landed.
      for (const line of logsRef.current[runId] ?? []) {
        const url = firstServerUrl(line.text)
        if (url) {
          openRunUrl(runId, url)
          break
        }
      }
    },
    [cancelPendingOpen, openRunUrl]
  )

  useEffect(() => {
    logsRef.current = logs
  }, [logs])

  // Clear timers if the shell ever unmounts, so nothing fires into a dead tree.
  useEffect(() => {
    const pending = pendingOpenRef.current
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer)
      pending.clear()
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

  // Check on every launch, and again when the window regains focus -- a manager
  // left open for days would otherwise never notice a release.
  useEffect(() => {
    let last = 0
    const check = (): void => {
      // GitHub's unauthenticated limit is 60/hour; once every 15 minutes is ample.
      if (Date.now() - last < 15 * 60 * 1000) return
      last = Date.now()
      window.nsm.updates
        .check()
        .then(setUpdate)
        .catch(() => undefined) // a failed check must never disrupt the app
    }

    const timer = window.setTimeout(check, 1200)
    window.addEventListener('focus', check)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', check)
    }
  }, [])

  // Poll the port table; pause while the window is hidden so a backgrounded app
  // is not shelling out every few seconds for nothing.
  useEffect(() => {
    const tick = (): void => {
      if (document.visibilityState === 'visible') void scan()
    }
    const timer = window.setInterval(tick, settings.scanIntervalMs)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [scan, settings.scanIntervalMs])

  // The main process defers the quit decision to the app's own dialog.
  useEffect(() => window.nsm.app.onConfirmQuit(setQuitPrompt), [])

  // Live output and status from the main process.
  useEffect(() => {
    const offLog = window.nsm.servers.onLog((line) => {
      // A dev server announces its address long before the port scanner notices
      // it, so the log is the fast path for "open in browser when ready".
      if (pendingOpenRef.current.has(line.runId)) {
        const url = firstServerUrl(line.text)
        if (url) openRunUrl(line.runId, url)
      }

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
  }, [scan, openRunUrl])

  // Fallback for servers that print no address: the scanner finds the port they
  // bound. Also the point where a run that died stops being waited on.
  useEffect(() => {
    if (pendingOpenRef.current.size === 0) return
    for (const run of runs) {
      if (!pendingOpenRef.current.has(run.runId)) continue
      if (run.status === 'exited' || run.status === 'failed') cancelPendingOpen(run.runId)
      else if (run.ports.length > 0) openRunUrl(run.runId, `http://localhost:${run.ports[0]}`)
    }
  }, [runs, cancelPendingOpen, openRunUrl])

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

  const startServer = async (
    projectId: string,
    script: string,
    openWhenReady = false
  ): Promise<void> => {
    try {
      const run = await window.nsm.servers.start(projectId, script)
      setRuns((current) => [run, ...current.filter((r) => r.runId !== run.runId)])
      setActiveRunId(run.runId)
      setDockTab('logs')
      setDockOpen(true)
      toast.success(`Started "${script}".`)
      if (openWhenReady) armOpenOnStart(run.runId, script)
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

  const stopRun = async (runId: string): Promise<void> => {
    try {
      await window.nsm.servers.stop(runId)
      toast.success('Server stopped.')
      void scan()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * Takes over a server started outside the app: stops it, then runs the same
   * npm script here so it comes back with a log and a stop button.
   */
  const restartExternal = async (server: DetectedServer): Promise<void> => {
    if (!server.projectId || !server.script) return
    try {
      const run = await window.nsm.servers.restartExternal(
        server.pid,
        server.projectId,
        server.script
      )
      setRuns(await window.nsm.servers.runs())
      setActiveRunId(run.runId)
      setDockTab('logs')
      setDockOpen(true)
      toast.success(`"${run.script}" is now managed here.`)
      void scan()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      void scan()
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

  const requestExternalTerminal = (project: Project): void => {
    setExternalTerminalProject(project)
  }

  const openTerminal = async (shell: ExternalTerminalShell): Promise<void> => {
    const project = externalTerminalProject
    setExternalTerminalProject(null)
    if (!project) return
    try {
      await window.nsm.projects.openTerminal(project.id, shell)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const setProjectColor = async (project: Project, color: ProjectColor | null): Promise<void> => {
    // Update locally first so the swatch responds instantly.
    setProjects((current) =>
      current.map((p) => (p.id === project.id ? { ...p, color } : p))
    )
    try {
      await window.nsm.projects.setColor(project.id, color)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      await loadProjects()
    }
  }

  const checkForUpdate = async (): Promise<void> => {
    setCheckingUpdate(true)
    try {
      const info = await window.nsm.updates.check()
      setUpdate(info)
      setUpdateDismissed(false)
      if (info.error) toast.error(`Update check failed: ${info.error}`)
      else if (!info.available) toast.success(`You're on the latest version (${info.currentVersion}).`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setCheckingUpdate(false)
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

  /** Combo → shortcut, with the user's rebindings applied. */
  const bindings = useMemo(() => bindingLookup(settings.shortcuts), [settings.shortcuts])

  /**
   * The one combo the integrated terminal must not swallow. Everything else typed
   * into a shell belongs to the shell -- Ctrl+L clears its screen, Ctrl+R searches
   * its history -- so the panel can only be closed by the key that opened it.
   */
  const terminalCombo = useMemo(
    () => resolveBindings(settings.shortcuts)['terminal-panel'],
    [settings.shortcuts]
  )

  const dockHeight = dragHeight ?? settings.dockHeight

  /** Shows `tab`, or hides the dock when that tab is already the one showing. */
  const toggleDock = useCallback(
    (tab: DockTab): void => {
      setDockOpen((open) => !(open && dockTab === tab))
      setDockTab(tab)
    },
    [dockTab]
  )

  /** Opens the terminal on the current project, always in a fresh session. */
  const openTerminalHere = useCallback((): void => {
    setDockTab('terminal')
    setDockOpen(true)
    setTerminalRequest((n) => n + 1)
  }, [])

  const startDockResize = (event: React.MouseEvent): void => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = dockHeight
    // Leaves room for the topbar and some of the view above it, so the dock can
    // never be dragged over the whole window.
    const ceiling = Math.min(DOCK_MAX_HEIGHT, Math.max(DOCK_MIN_HEIGHT, window.innerHeight - 220))
    const heightAt = (clientY: number): number =>
      Math.min(ceiling, Math.max(DOCK_MIN_HEIGHT, Math.round(startHeight + (startY - clientY))))

    const onMove = (e: MouseEvent): void => setDragHeight(heightAt(e.clientY))
    const onUp = (e: MouseEvent): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const final = heightAt(e.clientY)
      setDragHeight(null)
      // Written once, on release: persisting every mousemove would hammer
      // localStorage for a value nobody reads until the next launch.
      updateSettings({ dockHeight: final })
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /** The run the shortcuts act on: whatever the log panel is showing, else the newest. */
  const activeRun = useMemo(
    () => liveRuns.find((r) => r.runId === activeRunId) ?? liveRuns[0] ?? null,
    [liveRuns, activeRunId]
  )

  const startDevScript = (): void => {
    if (view.kind !== 'project' || !detail) {
      toast.info('Open a project first — Ctrl+D starts its dev server.')
      return
    }
    const script =
      detail.scripts.find((s) => s.name === settings.devScript) ??
      detail.scripts.find((s) => s.kind === 'dev')
    if (!script) {
      toast.info(`${detail.project.name} has no "${settings.devScript}" script.`)
      return
    }
    if (liveRuns.some((r) => r.projectId === detail.project.id && r.script === script.name)) {
      toast.info(`"${script.name}" is already running.`)
      return
    }
    void startServer(detail.project.id, script.name, settings.openWhenReady)
  }

  // Reassigned every render, so the listener below always sees current state
  // without being torn down and rebuilt on each keystroke's worth of change.
  const shortcutRef = useRef<(e: KeyboardEvent) => void>(() => undefined)
  shortcutRef.current = (e: KeyboardEvent): void => {
    // Every shortcut is Ctrl-based, so this is the cheapest possible rejection.
    if (!e.ctrlKey && !e.metaKey) return

    const target = e.target as HTMLElement | null
    // A focused terminal is a shell, not a text field: everything typed into it
    // is meant for the shell, except the combo that hides the panel again.
    const inTerminal = target?.closest?.('.xterm') != null
    if (inTerminal) {
      if (comboOf(e) !== terminalCombo) return
    } else if (
      target?.isContentEditable ||
      target?.tagName === 'INPUT' ||
      target?.tagName === 'TEXTAREA' ||
      target?.tagName === 'SELECT'
    ) {
      return
    }
    // A dialog owns the keyboard while it is up. Every modal renders `.overlay`,
    // including the ones owned by child components this one cannot see.
    if (document.querySelector('.overlay')) return

    const act = (fn: () => void): void => {
      e.preventDefault()
      fn()
    }
    const combo = comboOf(e)
    const projectId = view.kind === 'project' ? view.id : null

    // Ctrl+1 … Ctrl+9 jump to a project by position in the sidebar. Reserved, so
    // `comboProblem` refuses to rebind anything onto them.
    const digit = /^ctrl\+([1-9])$/.exec(combo)
    if (digit) {
      const project = projects[Number(digit[1]) - 1]
      if (project) act(() => setView({ kind: 'project', id: project.id }))
      return
    }

    switch (bindings.get(combo)) {
      case 'settings':
        return act(() => setSettingsTab('appearance'))
      case 'shortcuts':
        return act(() => setSettingsTab('shortcuts'))
      case 'servers-view':
        return act(() => setView({ kind: 'servers' }))
      case 'toggle-logs':
        return act(() => toggleDock('logs'))
      case 'terminal-panel':
        return act(() => toggleDock('terminal'))
      case 'rescan':
        return act(() => void scan(true))
      case 'add-project':
        return act(() => void addProjects())
      case 'start-dev':
        return act(startDevScript)
      case 'start-pick':
        return act(() =>
          projectId ? setStartPickerOpen(true) : toast.info('Open a project first.')
        )
      case 'terminal':
        return act(() => {
          const project = projectId ? projects.find((item) => item.id === projectId) : null
          if (project) requestExternalTerminal(project)
          else toast.info('Open a project first.')
        })
      case 'reveal':
        return act(() =>
          projectId
            ? void window.nsm.projects.reveal(projectId)
            : toast.info('Open a project first.')
        )
      case 'stop':
        return act(() =>
          activeRun ? void stopRun(activeRun.runId) : toast.info('No server is running.')
        )
      case 'restart':
        return act(() =>
          activeRun ? void restartRun(activeRun.runId) : toast.info('No server is running.')
        )
      case 'open-browser':
        return act(() => {
          const port = activeRun?.ports[0]
          if (port === undefined) {
            toast.info('No server with a known port yet.')
            return
          }
          void window.nsm.openExternal(`http://localhost:${port}`)
        })
      default:
        return
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => shortcutRef.current(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The picker belongs to whichever project is open; switching closes it.
  useEffect(() => setStartPickerOpen(false), [view])

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">
            <Zap size={15} />
          </div>
          <h1>NPM Server Manager</h1>
          <button
            className="btn-ghost btn-sm brand-settings"
            onClick={() => setSettingsTab('appearance')}
            title="Settings — themes, behaviour, shortcuts (Ctrl+,)"
            aria-label="Settings"
          >
            <SettingsIcon size={16} />
          </button>
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
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ project, x: e.clientX, y: e.clientY })
                }}
                title={`${project.path}

Right-click for options`}
              >
                <Layers
                  size={15}
                  style={{ flexShrink: 0 }}
                  className={project.color ? `project-color-${project.color}` : undefined}
                />
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

        <div className="sidebar-footer" style={{ borderTop: 'none', paddingTop: 0 }}>
          <span>v{update?.currentVersion ?? '—'}</span>
          <button
            className="btn-ghost"
            style={{ padding: '0 4px', fontFamily: 'var(--mono)', fontSize: 11 }}
            onClick={checkForUpdate}
            disabled={checkingUpdate}
            title="Check for updates"
          >
            {checkingUpdate ? 'checking…' : 'check for updates'}
          </button>
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
                onRestartExternal={restartExternal}
                onOpenProject={(id) => setView({ kind: 'project', id })}
                onOpenFolder={(id) => void window.nsm.projects.reveal(id)}
              />
            </div>
          </>
        ) : detail ? (
          <ProjectView
            detail={detail}
            runs={runs}
            servers={servers}
            startPickerOpen={startPickerOpen}
            onStartPickerChange={setStartPickerOpen}
            onStart={startServer}
            onStop={stopRun}
            onRestart={restartRun}
            onRemove={removeProject}
            onRefreshDetail={() => void loadDetail(view.id)}
            onOpenTerminalPanel={openTerminalHere}
            onOpenExternalTerminal={() => requestExternalTerminal(detail.project)}
            onStopExternal={stopServer}
            onRestartExternal={restartExternal}
          />
        ) : (
          <div className="content">
            <div className="empty">
              <RefreshCw size={24} className="spin" />
              <h3>Loading project&hellip;</h3>
            </div>
          </div>
        )}

        {dockOpen && (
          <div className="dock" style={{ height: dockHeight }}>
            <div
              className="dock-resize"
              onMouseDown={startDockResize}
              title="Drag to resize"
              role="separator"
              aria-orientation="horizontal"
            />

            <div className="dock-head">
              <button
                className={`dock-tab ${dockTab === 'logs' ? 'active' : ''}`}
                onClick={() => setDockTab('logs')}
              >
                <ScrollText size={13} /> Logs
                {runs.length > 0 && <span className="count">{runs.length}</span>}
              </button>
              <button
                className={`dock-tab ${dockTab === 'terminal' ? 'active' : ''}`}
                onClick={() => setDockTab('terminal')}
              >
                <Terminal size={13} /> Terminal
              </button>

              <div style={{ flex: 1 }} />

              <button
                className="btn-ghost btn-sm"
                onClick={() => setDockOpen(false)}
                title="Hide the panel"
                aria-label="Hide the panel"
              >
                <ChevronDown size={14} />
              </button>
            </div>

            <div className="dock-body">
              <div className="dock-pane" hidden={dockTab !== 'logs'}>
                {runs.length > 0 ? (
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
                  />
                ) : (
                  <div className="dock-empty">
                    Nothing started from here yet. Servers you start show their output on this tab.
                  </div>
                )}
              </div>

              {/* Kept mounted while the dock is open so switching to the logs and
                  back does not re-attach and redraw every terminal. */}
              <div className="dock-pane" hidden={dockTab !== 'terminal'}>
                <TerminalPanel
                  projectId={view.kind === 'project' ? view.id : null}
                  visible={dockTab === 'terminal'}
                  newSessionRequest={terminalRequest}
                  toggleCombo={terminalCombo}
                  onError={toast.error}
                />
              </div>
            </div>
          </div>
        )}

        {!dockOpen && (
          <div className="dock-reopen">
            <button className="btn btn-sm" onClick={() => toggleDock('terminal')}>
              <Terminal size={14} /> Terminal
            </button>
            {liveRuns.length > 0 && (
              <button className="btn btn-sm" onClick={() => toggleDock('logs')}>
                <ScrollText size={14} /> Logs ({liveRuns.length} running)
              </button>
            )}
          </div>
        )}

        {update?.available && (update.mandatory || !updateDismissed) && (
          <UpdateBanner
            info={update}
            autoStart={updateAutoStart}
            onDismiss={() => setUpdateDismissed(true)}
          />
        )}
      </main>

      {update?.available && !updatePrompted && (
        <UpdateDialog
          info={update}
          onLater={() => setUpdatePrompted(true)}
          onUpdate={() => {
            // Hand off to the banner, which owns the download and progress UI.
            setUpdatePrompted(true)
            setUpdateDismissed(false)
            setUpdateAutoStart(true)
          }}
        />
      )}

      {settingsTab && (
        <SettingsDialog initialTab={settingsTab} onClose={() => setSettingsTab(null)} />
      )}

      {quitPrompt && (
        <QuitDialog
          liveRuns={quitPrompt.liveRuns}
          runs={runs}
          onChoose={(choice) => {
            setQuitPrompt(null)
            void window.nsm.app.quitChoice(choice)
          }}
        />
      )}

      {menu && (
        <ProjectContextMenu
          target={menu}
          onClose={() => setMenu(null)}
          onOpenTerminalPanel={(project) => {
            setView({ kind: 'project', id: project.id })
            openTerminalHere()
          }}
          onOpenTerminal={requestExternalTerminal}
          onOpenFolder={(project) => void window.nsm.projects.reveal(project.id)}
          onSetColor={setProjectColor}
          onRemove={(project) => void removeProject(project.id)}
          onStartServer={(project) => setView({ kind: 'project', id: project.id })}
        />
      )}

      {externalTerminalProject && (
        <ExternalTerminalDialog
          project={externalTerminalProject}
          onClose={() => setExternalTerminalProject(null)}
          onChoose={(shell) => void openTerminal(shell)}
        />
      )}
    </div>
  )
}

export default function App(): React.JSX.Element {
  return (
    <SettingsProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </SettingsProvider>
  )
}
