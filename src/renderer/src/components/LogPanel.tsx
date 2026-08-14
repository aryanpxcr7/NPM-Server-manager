import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, RotateCw, Square, Trash2 } from 'lucide-react'
import type { ManagedRun, ServerLogLine } from '@shared/types'

interface Props {
  runs: ManagedRun[]
  logs: Record<string, ServerLogLine[]>
  activeRunId: string | null
  onSelect: (runId: string) => void
  onStop: (runId: string) => void
  onRestart: (runId: string) => void
  onClearFinished: () => void
  onCollapse: () => void
}

export default function LogPanel({
  runs,
  logs,
  activeRunId,
  onSelect,
  onStop,
  onRestart,
  onClearFinished,
  onCollapse
}: Props): React.JSX.Element | null {
  const outputRef = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)

  const active = runs.find((r) => r.runId === activeRunId) ?? runs[0] ?? null
  const lines = active ? (logs[active.runId] ?? []) : []

  // Stay pinned to the newest output unless the user scrolls up to read history.
  useLayoutEffect(() => {
    const el = outputRef.current
    if (el && pinned) el.scrollTop = el.scrollHeight
  }, [lines, pinned])

  useEffect(() => setPinned(true), [active?.runId])

  if (runs.length === 0) return null

  const isLive = active?.status === 'running' || active?.status === 'starting'

  return (
    <div className="log-panel">
      <div className="log-tabs">
        {runs.map((run) => (
          <button
            key={run.runId}
            className={`log-tab ${run.runId === active?.runId ? 'active' : ''}`}
            onClick={() => onSelect(run.runId)}
          >
            <span className={`status-dot ${run.status}`} />
            {run.projectName}
            <span style={{ color: 'var(--text-faint)' }}>:{run.script}</span>
            {run.adopted && (
              <span className="tag" title="Left running by a previous session">
                reattached
              </span>
            )}
            {run.ports.length > 0 && (
              <span style={{ color: 'var(--accent)', fontFamily: 'var(--mono)', fontSize: 11 }}>
                {run.ports[0]}
              </span>
            )}
          </button>
        ))}

        <div style={{ flex: 1 }} />

        {active && isLive && (
          <>
            <button className="btn-ghost btn-sm" onClick={() => onRestart(active.runId)} title="Restart">
              <RotateCw size={14} />
            </button>
            <button className="btn-ghost btn-sm" onClick={() => onStop(active.runId)} title="Stop">
              <Square size={14} />
            </button>
          </>
        )}
        <button className="btn-ghost btn-sm" onClick={onClearFinished} title="Clear finished runs">
          <Trash2 size={14} />
        </button>
        <button className="btn-ghost btn-sm" onClick={onCollapse} title="Hide logs">
          <ChevronDown size={14} />
        </button>
      </div>

      <div
        className="log-output"
        ref={outputRef}
        onScroll={(e) => {
          const el = e.currentTarget
          setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
        }}
      >
        {lines.length === 0 ? (
          <div style={{ color: 'var(--text-faint)' }}>Waiting for output&hellip;</div>
        ) : (
          lines.map((line, i) => (
            <div key={i} className={`log-line ${line.stream}`}>
              {line.text || ' '}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
