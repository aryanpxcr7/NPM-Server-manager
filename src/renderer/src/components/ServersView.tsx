import { ExternalLink, FolderOpen, RefreshCw, RotateCw, Server, Square } from 'lucide-react'
import type { DetectedServer, ManagedRun } from '@shared/types'

interface Props {
  servers: DetectedServer[]
  runs: ManagedRun[]
  loading: boolean
  onRefresh: () => void
  onStopPid: (server: DetectedServer) => void
  onRestartRun: (runId: string) => void
  onOpenProject: (projectId: string) => void
  onOpenFolder: (projectId: string) => void
}

export default function ServersView({
  servers,
  runs,
  loading,
  onRefresh,
  onStopPid,
  onRestartRun,
  onOpenProject,
  onOpenFolder
}: Props): React.JSX.Element {
  const managed = servers.filter((s) => s.managed)
  const external = servers.filter((s) => !s.managed)

  return (
    <>
      <div className="stat-row">
        <div className="stat">
          <div className="value">{servers.length}</div>
          <div className="label">Listening processes</div>
        </div>
        <div className="stat">
          <div className="value" style={{ color: 'var(--green)' }}>
            {managed.length}
          </div>
          <div className="label">Started from this app</div>
        </div>
        <div className="stat">
          <div className="value" style={{ color: 'var(--amber)' }}>
            {external.length}
          </div>
          <div className="label">Started elsewhere</div>
        </div>
      </div>

      {servers.length === 0 ? (
        <div className="empty">
          <Server size={26} />
          <h3>{loading ? 'Scanning ports…' : 'Nothing is listening'}</h3>
          <p>
            No development server is holding a TCP port right now. Start one from a project, or
            rescan if you launched something in a terminal.
          </p>
          <button className="btn" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Rescan
          </button>
        </div>
      ) : (
        <>
          {managed.length > 0 && (
            <ServerGroup
              title="Managed by NPM Server Manager"
              subtitle="Stopping these also stops their child processes."
              servers={managed}
              runs={runs}
              onStopPid={onStopPid}
              onRestartRun={onRestartRun}
              onOpenProject={onOpenProject}
              onOpenFolder={onOpenFolder}
            />
          )}
          {external.length > 0 && (
            <ServerGroup
              title="Found on this PC"
              subtitle="Started outside this app — from a terminal, an IDE, or at boot."
              servers={external}
              runs={runs}
              onStopPid={onStopPid}
              onRestartRun={onRestartRun}
              onOpenProject={onOpenProject}
              onOpenFolder={onOpenFolder}
            />
          )}
        </>
      )}
    </>
  )
}

function ServerGroup({
  title,
  subtitle,
  servers,
  runs,
  onStopPid,
  onRestartRun,
  onOpenProject,
  onOpenFolder
}: {
  title: string
  subtitle: string
  servers: DetectedServer[]
  runs: ManagedRun[]
  onStopPid: (server: DetectedServer) => void
  onRestartRun: (runId: string) => void
  onOpenProject: (projectId: string) => void
  onOpenFolder: (projectId: string) => void
}): React.JSX.Element {
  return (
    <div className="card">
      <div className="card-header">
        <h3>{title}</h3>
        <span className="sub">{subtitle}</span>
      </div>
      {servers.map((server) => {
        const run = server.runId ? runs.find((r) => r.runId === server.runId) : undefined

        return (
          <div className="server-row" key={`${server.pid}-${server.ports.join(',')}`}>
            <div className={`port-badge ${server.ports.length === 0 ? 'pending' : ''}`}>
              {server.ports.length === 0 ? 'starting' : `:${server.ports[0]}`}
            </div>

            <div className="server-meta">
              <div className="server-title">
                {server.projectName ? (
                  <button
                    className="btn-ghost"
                    style={{ padding: 0, fontWeight: 500 }}
                    onClick={() => server.projectId && onOpenProject(server.projectId)}
                  >
                    {server.projectName}
                  </button>
                ) : (
                  <span>{server.processName}</span>
                )}

                {server.script && <span className="tag">npm run {server.script}</span>}
                <span className={`tag ${server.managed ? 'tag-managed' : 'tag-external'}`}>
                  {server.managed ? 'managed' : 'external'}
                </span>
                {run?.adopted && (
                  <span className="tag" title="Left running by a previous session">
                    reattached
                  </span>
                )}
                {server.ports.length > 1 && (
                  <span className="tag">+{server.ports.length - 1} more ports</span>
                )}
              </div>
              <div className="server-cmd" title={server.commandLine ?? undefined}>
                {server.pid > 0 && `PID ${server.pid} · `}
                {server.commandLine ?? server.cwd ?? server.processName}
              </div>
            </div>

            <div className="server-actions">
              {server.projectId && (
                <button
                  className="btn btn-sm btn-ghost"
                  title="Open this project's folder"
                  onClick={() => server.projectId && onOpenFolder(server.projectId)}
                >
                  <FolderOpen size={14} />
                </button>
              )}
              {server.ports.length > 0 && (
                <button
                  className="btn btn-sm btn-ghost"
                  title={`Open http://localhost:${server.ports[0]}`}
                  onClick={() => window.nsm.openExternal(`http://localhost:${server.ports[0]}`)}
                >
                  <ExternalLink size={14} />
                </button>
              )}
              {run && (
                <button className="btn btn-sm" onClick={() => onRestartRun(run.runId)}>
                  <RotateCw size={13} /> Restart
                </button>
              )}
              <button className="btn btn-sm btn-danger" onClick={() => onStopPid(server)}>
                <Square size={13} /> Stop
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
