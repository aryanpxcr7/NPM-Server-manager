import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowUpCircle,
  Download,
  FolderOpen,
  Play,
  RefreshCw,
  RotateCw,
  Square,
  Terminal,
  TerminalSquare,
  Trash2
} from 'lucide-react'
import type {
  DetectedServer,
  ManagedRun,
  PackageScanResult,
  ProjectDetail,
  UpdateMode,
  UpdatePlanEntry
} from '@shared/types'
import Modal from './Modal'
import PackageTable, { isUpdatable } from './PackageTable'
import StartServerDialog from './StartServerDialog'
import { useToast } from './Toasts'

interface Props {
  detail: ProjectDetail
  runs: ManagedRun[]
  /** Everything the port scanner found, so servers started elsewhere show here too. */
  servers: DetectedServer[]
  /** Owned by App so the Ctrl+Enter shortcut can open the picker as well. */
  startPickerOpen: boolean
  onStartPickerChange: (open: boolean) => void
  onStart: (projectId: string, script: string, openWhenReady: boolean) => Promise<void>
  onStop: (runId: string) => void
  onRestart: (runId: string) => void
  onRemove: (projectId: string) => void
  onRefreshDetail: () => void
  /** Opens the app's own terminal in this folder, in the bottom dock. */
  onOpenTerminalPanel: () => void
  /** Opens the shell chooser for an external terminal in this folder. */
  onOpenExternalTerminal: () => void
  onStopExternal: (server: DetectedServer) => void
  onRestartExternal: (server: DetectedServer) => void
}

export default function ProjectView({
  detail,
  runs,
  servers,
  startPickerOpen,
  onStartPickerChange,
  onStart,
  onStop,
  onRestart,
  onRemove,
  onRefreshDetail,
  onOpenTerminalPanel,
  onOpenExternalTerminal,
  onStopExternal,
  onRestartExternal
}: Props): React.JSX.Element {
  const toast = useToast()
  const { project } = detail

  const [scan, setScan] = useState<PackageScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [plan, setPlan] = useState<{ mode: UpdateMode; entries: UpdatePlanEntry[] } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const liveRuns = useMemo(
    () =>
      runs.filter(
        (r) => r.projectId === project.id && (r.status === 'running' || r.status === 'starting')
      ),
    [runs, project.id]
  )
  /**
   * Servers for this project that the app did not start -- run from a terminal,
   * an IDE, or left over from a previous session it could not adopt. They belong
   * on this page as much as the managed ones: the whole point of opening a
   * project is to see what it is doing and be able to stop it.
   */
  const externals = useMemo(
    () => servers.filter((s) => !s.managed && s.projectId === project.id),
    [servers, project.id]
  )

  // A script already listening on a port cannot be started again, whoever
  // started it, so the Start dialog greys both kinds out.
  const runningScripts = useMemo(
    () => [
      ...liveRuns.map((r) => r.script),
      ...externals.map((s) => s.script).filter((s): s is string => s !== null)
    ],
    [liveRuns, externals]
  )

  const refreshPackages = useCallback(async () => {
    setScanning(true)
    try {
      const result = await window.nsm.packages.scan(project.id)
      setScan(result)
      setSelected(new Set())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setScanning(false)
    }
  }, [project.id, toast])

  // Reset per-project state and scan whenever the selected project changes.
  useEffect(() => {
    setScan(null)
    setSelected(new Set())
    if (detail.hasNodeModules && !detail.error) void refreshPackages()
  }, [project.id, detail.hasNodeModules, detail.error, refreshPackages])

  const updatableCount = useMemo(
    () => (scan?.packages ?? []).filter(isUpdatable).length,
    [scan]
  )

  const openPlan = async (mode: UpdateMode): Promise<void> => {
    setBusy('plan')
    try {
      const entries = await window.nsm.packages.plan(project.id, mode)
      const filtered = selected.size > 0 ? entries.filter((e) => selected.has(e.name)) : entries
      if (filtered.length === 0) {
        toast.info('Nothing to update.')
        return
      }
      setPlan({ mode, entries: filtered })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const runUpdate = async (): Promise<void> => {
    if (!plan) return
    setBusy('update')
    try {
      const names = plan.entries.map((e) => e.name)
      const result = await window.nsm.packages.update(project.id, plan.mode, names)
      setPlan(null)
      if (result.ok) {
        toast.success(`Updated ${names.length} package${names.length === 1 ? '' : 's'}.`)
      } else {
        toast.error(`npm exited with code ${result.exitCode}. ${result.output.slice(0, 200)}`)
      }
      await refreshPackages()
      onRefreshDetail()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const runInstall = async (): Promise<void> => {
    setBusy('install')
    try {
      const result = await window.nsm.packages.install(project.id)
      if (result.ok) {
        toast.success('npm install finished.')
      } else {
        toast.error(`npm install failed (code ${result.exitCode}).`)
      }
      onRefreshDetail()
      await refreshPackages()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="topbar">
        <div style={{ minWidth: 0 }}>
          <h2>{project.name}</h2>
          <div className="path" title={project.path}>
            {project.path}
            {detail.packageJson?.version && ` · v${detail.packageJson.version}`}
          </div>
        </div>

        <div className="topbar-spacer" />

        {liveRuns.map((run) => (
          <div key={run.runId} className="run-chip">
            <span className="status-dot running" />
            <span className="run-chip-script">{run.script}</span>
            {run.ports.length > 0 && (
              <button
                className="run-chip-port"
                title={`Open http://localhost:${run.ports[0]}`}
                onClick={() => window.nsm.openExternal(`http://localhost:${run.ports[0]}`)}
              >
                :{run.ports[0]}
              </button>
            )}
            <button
              className="btn btn-sm btn-ghost"
              title={`Restart ${run.script}`}
              onClick={() => onRestart(run.runId)}
            >
              <RotateCw size={13} />
            </button>
            <button
              className="btn btn-sm btn-ghost run-chip-stop"
              title={`Stop ${run.script}`}
              onClick={() => onStop(run.runId)}
            >
              <Square size={13} />
            </button>
          </div>
        ))}

        {externals.map((server) => (
          <div
            key={server.pid}
            className="run-chip run-chip-external"
            title={`Started outside this app — ${server.commandLine ?? server.processName}`}
          >
            <span className="status-dot running" />
            <span className="run-chip-script">{server.script ?? server.processName}</span>
            <span className="tag tag-external">external</span>
            {server.ports.length > 0 && (
              <button
                className="run-chip-port"
                title={`Open http://localhost:${server.ports[0]}`}
                onClick={() => window.nsm.openExternal(`http://localhost:${server.ports[0]}`)}
              >
                :{server.ports[0]}
              </button>
            )}
            {server.restartable && (
              <button
                className="btn btn-sm btn-ghost"
                title={`Stop it and run "npm run ${server.script}" here, so this app manages it`}
                onClick={() => onRestartExternal(server)}
              >
                <RotateCw size={13} />
              </button>
            )}
            <button
              className="btn btn-sm btn-ghost run-chip-stop"
              title={`Stop this process (PID ${server.pid})`}
              onClick={() => onStopExternal(server)}
            >
              <Square size={13} />
            </button>
          </div>
        ))}

        <button
          className={`btn ${liveRuns.length > 0 ? '' : 'btn-primary'}`}
          onClick={() => onStartPickerChange(true)}
          disabled={!!detail.error}
          title={liveRuns.length > 0 ? 'Start another script' : undefined}
        >
          <Play size={15} /> {liveRuns.length > 0 ? 'Start another' : 'Start Server'}
        </button>
        <button
          className="btn btn-ghost"
          title="Terminal in this folder"
          onClick={onOpenTerminalPanel}
        >
          <Terminal size={16} />
        </button>
        <button
          className="btn btn-ghost"
          title="Choose Command Prompt or PowerShell"
          onClick={onOpenExternalTerminal}
        >
          <TerminalSquare size={16} />
        </button>
        <button className="btn btn-ghost" title="Open folder" onClick={() => window.nsm.projects.reveal(project.id)}>
          <FolderOpen size={16} />
        </button>
        <button className="btn btn-ghost" title="Remove project" onClick={() => setConfirmRemove(true)}>
          <Trash2 size={16} />
        </button>
      </div>

      <div className="content">
        {detail.error && (
          <div className="banner error">
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <div>{detail.error}</div>
          </div>
        )}

        {!detail.error && !detail.hasNodeModules && (
          <div className="banner warn">
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <strong>node_modules is missing.</strong> Dependencies have not been installed for this
              project yet.
            </div>
            <button className="btn btn-sm" onClick={runInstall} disabled={busy === 'install'}>
              {busy === 'install' ? (
                <RefreshCw size={13} className="spin" />
              ) : (
                <Download size={13} />
              )}
              {busy === 'install' ? 'Installing…' : 'npm install'}
            </button>
          </div>
        )}

        {!detail.error && (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 16,
                flexWrap: 'wrap'
              }}
            >
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Dependencies</h3>
              {scan && (
                <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                  {updatableCount === 0
                    ? 'all up to date'
                    : `${updatableCount} can be updated`}
                  {selected.size > 0 && ` · ${selected.size} selected`}
                </span>
              )}

              <div style={{ flex: 1 }} />

              <button className="btn btn-sm" onClick={refreshPackages} disabled={scanning}>
                <RefreshCw size={14} className={scanning ? 'spin' : ''} />
                {scanning ? 'Checking…' : 'Check for updates'}
              </button>
              <button
                className="btn btn-sm"
                onClick={() => openPlan('wanted')}
                disabled={!scan || updatableCount === 0 || busy !== null}
                title="Update within the version ranges already in package.json"
              >
                <ArrowUpCircle size={14} />
                {selected.size > 0 ? `Update ${selected.size} selected` : 'Update all (safe)'}
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => openPlan('latest')}
                disabled={!scan || updatableCount === 0 || busy !== null}
                title="Install the newest published version, rewriting package.json"
              >
                <ArrowUpCircle size={14} /> Update all to latest
              </button>
            </div>

            <PackageTable
              result={scan}
              loading={scanning}
              selected={selected}
              onToggle={(name) =>
                setSelected((current) => {
                  const next = new Set(current)
                  if (next.has(name)) next.delete(name)
                  else next.add(name)
                  return next
                })
              }
              onToggleAll={(names, checked) =>
                setSelected((current) => {
                  const next = new Set(current)
                  for (const name of names) {
                    if (checked) next.add(name)
                    else next.delete(name)
                  }
                  return next
                })
              }
            />
          </>
        )}
      </div>

      {startPickerOpen && (
        <StartServerDialog
          projectName={project.name}
          scripts={detail.scripts}
          runningScripts={runningScripts}
          onClose={() => onStartPickerChange(false)}
          onPick={async (script, openWhenReady) => {
            onStartPickerChange(false)
            await onStart(project.id, script, openWhenReady)
          }}
        />
      )}

      {plan && (
        <Modal
          title={plan.mode === 'latest' ? 'Update to latest versions' : 'Update within ranges'}
          subtitle={
            plan.mode === 'latest'
              ? 'These packages will be installed at their newest published version. Major versions can contain breaking changes, and package.json will be rewritten.'
              : 'These packages will move to the newest version allowed by the ranges already in package.json.'
          }
          onClose={() => (busy === 'update' ? undefined : setPlan(null))}
          footer={
            <>
              <button className="btn btn-sm" onClick={() => setPlan(null)} disabled={busy === 'update'}>
                Cancel
              </button>
              <button className="btn btn-sm btn-primary" onClick={runUpdate} disabled={busy === 'update'}>
                {busy === 'update' ? (
                  <>
                    <RefreshCw size={13} className="spin" /> Updating…
                  </>
                ) : (
                  `Update ${plan.entries.length} package${plan.entries.length === 1 ? '' : 's'}`
                )}
              </button>
            </>
          }
        >
          <div style={{ paddingBottom: 12 }}>
            {plan.entries.map((entry) => (
              <div
                key={entry.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '7px 0',
                  borderBottom: '1px solid var(--border)',
                  fontFamily: 'var(--mono)',
                  fontSize: 12.5
                }}
              >
                <span style={{ flex: 1 }}>{entry.name}</span>
                <span style={{ color: 'var(--text-faint)' }}>{entry.from ?? 'not installed'}</span>
                <span style={{ color: 'var(--text-faint)' }}>→</span>
                <span style={{ color: 'var(--green)', fontWeight: 600 }}>{entry.to}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {confirmRemove && (
        <Modal
          title={`Remove ${project.name}?`}
          subtitle="This only removes the project from NPM Server Manager. Nothing on disk is touched."
          onClose={() => setConfirmRemove(false)}
          width={440}
          footer={
            <>
              <button className="btn btn-sm" onClick={() => setConfirmRemove(false)}>
                Cancel
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={() => {
                  setConfirmRemove(false)
                  onRemove(project.id)
                }}
              >
                Remove from list
              </button>
            </>
          }
        >
          <div style={{ paddingBottom: 8 }} />
        </Modal>
      )}
    </>
  )
}
