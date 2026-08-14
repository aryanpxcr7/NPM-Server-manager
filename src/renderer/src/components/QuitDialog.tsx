import { PowerOff, Server, Square } from 'lucide-react'
import type { ManagedRun } from '@shared/types'
import Modal from './Modal'

interface Props {
  liveRuns: number
  runs: ManagedRun[]
  onChoose: (choice: 'stop' | 'leave' | 'cancel') => void
}

/**
 * Replaces the OS message box on quit. Beyond looking like the rest of the app,
 * it can show *which* servers are running -- the native dialog could only state a
 * number, which is not enough to decide with.
 */
export default function QuitDialog({ liveRuns, runs, onChoose }: Props): React.JSX.Element {
  const live = runs.filter((r) => r.status === 'running' || r.status === 'starting')

  return (
    <Modal
      title={`${liveRuns} dev ${liveRuns === 1 ? 'server is' : 'servers are'} still running`}
      subtitle="Choose what happens to them when the app closes."
      onClose={() => onChoose('cancel')}
      width={520}
      footer={
        <>
          <button className="btn btn-sm" onClick={() => onChoose('cancel')}>
            Cancel
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={() => onChoose('leave')}>
            Leave them running
          </button>
          <button className="btn btn-sm btn-danger" onClick={() => onChoose('stop')}>
            <Square size={13} /> Stop and quit
          </button>
        </>
      }
    >
      <div className="quit-list">
        {live.map((run) => (
          <div className="quit-row" key={run.runId}>
            <span className="status-dot running" />
            <span className="quit-project">{run.projectName}</span>
            <span className="quit-script">{run.script}</span>
            {run.ports.length > 0 && <span className="quit-port">:{run.ports[0]}</span>}
          </div>
        ))}
        {live.length === 0 && (
          <div className="quit-row" style={{ color: 'var(--text-faint)' }}>
            <Server size={14} /> Details unavailable
          </div>
        )}
      </div>

      <div className="quit-help">
        <div>
          <PowerOff size={14} style={{ color: 'var(--red)', flexShrink: 0 }} />
          <div>
            <strong>Stop and quit</strong> ends every server above and frees its port.
          </div>
        </div>
        <div>
          <Server size={14} style={{ color: 'var(--green)', flexShrink: 0 }} />
          <div>
            <strong>Leave them running</strong> keeps them alive after the app closes.
            Reopening reattaches to them.
          </div>
        </div>
      </div>
    </Modal>
  )
}
