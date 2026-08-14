import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { RotateCw, Square, Trash2 } from 'lucide-react'
import type { ManagedRun, ServerLogLine } from '@shared/types'
import { splitLinks } from '../lib/links'

/**
 * One line of output, with any URLs in it made clickable.
 *
 * Plain clicks are ignored on purpose: the panel is text you select and copy, and
 * a link that navigates on a stray click would fight that. Ctrl+click matches
 * every terminal the user already has open.
 */
const LogLineRow = memo(function LogLineRow({ line }: { line: ServerLogLine }): React.JSX.Element {
  const parts = useMemo(() => splitLinks(line.text), [line.text])

  return (
    <div className={`log-line ${line.stream}`}>
      {parts.length === 0
        ? ' ' // keeps a blank line at full height
        : parts.map((part, i) =>
            part.href ? (
              <span
                key={i}
                className="log-link"
                title={`${part.href}\n\nCtrl+click to open`}
                onClick={(e) => {
                  if (!e.ctrlKey && !e.metaKey) return
                  e.preventDefault()
                  void window.nsm.openExternal(part.href as string)
                }}
              >
                {part.text}
              </span>
            ) : (
              <span key={i}>{part.text}</span>
            )
          )}
    </div>
  )
})

interface Props {
  runs: ManagedRun[]
  logs: Record<string, ServerLogLine[]>
  activeRunId: string | null
  onSelect: (runId: string) => void
  onStop: (runId: string) => void
  onRestart: (runId: string) => void
  onClearFinished: () => void
}

export default function LogPanel({
  runs,
  logs,
  activeRunId,
  onSelect,
  onStop,
  onRestart,
  onClearFinished
}: Props): React.JSX.Element | null {
  const outputRef = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)
  const [modifierHeld, setModifierHeld] = useState(false)

  const active = runs.find((r) => r.runId === activeRunId) ?? runs[0] ?? null
  const lines = active ? (logs[active.runId] ?? []) : []

  // Stay pinned to the newest output unless the user scrolls up to read history.
  useLayoutEffect(() => {
    const el = outputRef.current
    if (el && pinned) el.scrollTop = el.scrollHeight
  }, [lines, pinned])

  useEffect(() => setPinned(true), [active?.runId])

  // Links only look clickable while the modifier is down, so the panel reads as
  // plain text the rest of the time.
  useEffect(() => {
    const sync = (e: KeyboardEvent): void => setModifierHeld(e.ctrlKey || e.metaKey)
    const clear = (): void => setModifierHeld(false)
    window.addEventListener('keydown', sync)
    window.addEventListener('keyup', sync)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', sync)
      window.removeEventListener('keyup', sync)
      window.removeEventListener('blur', clear)
    }
  }, [])

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
      </div>

      <div
        className={`log-output ${modifierHeld ? 'mod-held' : ''}`}
        ref={outputRef}
        onScroll={(e) => {
          const el = e.currentTarget
          setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
        }}
      >
        {lines.length === 0 ? (
          <div style={{ color: 'var(--text-faint)' }}>Waiting for output&hellip;</div>
        ) : (
          lines.map((line, i) => <LogLineRow key={i} line={line} />)
        )}
      </div>
    </div>
  )
}
