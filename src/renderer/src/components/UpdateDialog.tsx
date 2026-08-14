import { AlertTriangle, ArrowDownCircle, ExternalLink } from 'lucide-react'
import type { UpdateInfo } from '@shared/types'
import Modal from './Modal'

interface Props {
  info: UpdateInfo
  onUpdate: () => void
  onLater: () => void
}

/**
 * Shown once per launch when a newer version exists. The banner along the bottom
 * remains afterwards as a persistent reminder, so dismissing this is not the same
 * as hiding the update.
 */
export default function UpdateDialog({ info, onUpdate, onLater }: Props): React.JSX.Element {
  const required = info.mandatory

  return (
    <Modal
      title={required ? 'Update required' : `Version ${info.latestVersion} is available`}
      subtitle={
        required
          ? `Version ${info.currentVersion} has been retired and is no longer supported.`
          : `You have ${info.currentVersion}.`
      }
      onClose={required ? () => undefined : onLater}
      width={560}
      footer={
        <>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => window.nsm.openExternal(info.releaseUrl)}
          >
            <ExternalLink size={14} /> View release
          </button>
          <div style={{ flex: 1 }} />
          {!required && (
            <button className="btn btn-sm" onClick={onLater}>
              Later
            </button>
          )}
          <button className="btn btn-sm btn-primary" onClick={onUpdate}>
            <ArrowDownCircle size={14} /> Update now
          </button>
        </>
      }
    >
      {required && (
        <div className="banner error" style={{ marginBottom: 14 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0 }} />
          <div>
            This version has a known defect and cannot reliably update itself. Updating
            is the only supported path forward.
          </div>
        </div>
      )}

      {info.notes ? (
        <div className="release-notes">{cleanNotes(info.notes)}</div>
      ) : (
        <p style={{ color: 'var(--text-dim)' }}>No release notes were published.</p>
      )}
    </Modal>
  )
}

/**
 * Renders the GitHub markdown body as readable plain text. A full markdown
 * renderer is not worth a dependency for a summary the user can open in full on
 * the release page.
 */
function cleanNotes(notes: string): string {
  return notes
    .split(/\r?\n/)
    .filter((line) => !/^>\s*\[!/.test(line)) // callout markers
    .map((line) =>
      line
        .replace(/^#{1,6}\s*/, '')
        .replace(/^>\s?/, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 2000)
}
