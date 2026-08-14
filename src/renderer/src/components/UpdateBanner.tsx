import { useEffect, useState } from 'react'
import { ArrowDownCircle, CheckCircle2, ExternalLink, RefreshCw, X } from 'lucide-react'
import type { UpdateInfo } from '@shared/types'

type Phase = 'idle' | 'downloading' | 'ready' | 'failed'

interface Props {
  info: UpdateInfo
  onDismiss: () => void
}

export default function UpdateBanner({ info, onDismiss }: Props): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState({ received: 0, total: info.assetSize ?? 0 })
  const [installerPath, setInstallerPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => window.nsm.updates.onProgress(setProgress), [])

  const startDownload = async (): Promise<void> => {
    setPhase('downloading')
    setError(null)
    try {
      const file = await window.nsm.updates.download({
        assetUrl: info.assetUrl,
        assetName: info.assetName,
        assetSize: info.assetSize
      })
      setInstallerPath(file)
      setPhase('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('failed')
    }
  }

  const install = async (): Promise<void> => {
    if (!installerPath) return
    try {
      await window.nsm.updates.install(installerPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('failed')
    }
  }

  const pct =
    progress.total > 0 ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : 0

  return (
    <div className="update-banner">
      <div className="update-icon">
        {phase === 'ready' ? <CheckCircle2 size={18} /> : <ArrowDownCircle size={18} />}
      </div>

      <div className="update-text">
        <div className="update-title">
          {phase === 'ready'
            ? `Version ${info.latestVersion} is ready to install`
            : `Version ${info.latestVersion} is available`}
          <span className="update-current">you have {info.currentVersion}</span>
        </div>

        {phase === 'downloading' && (
          <div className="update-progress">
            <div className="update-progress-bar">
              <div className="update-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="update-progress-label">
              {pct}% · {formatBytes(progress.received)}
              {progress.total > 0 && ` of ${formatBytes(progress.total)}`}
            </span>
          </div>
        )}

        {phase === 'ready' && (
          <div className="update-notes">
            The app will close and the installer will open. Your running dev servers
            keep running.
          </div>
        )}

        {phase === 'failed' && error && <div className="update-error">{error}</div>}

        {phase === 'idle' && info.notes && (
          <div className="update-notes">{firstLines(info.notes, 2)}</div>
        )}
      </div>

      <div className="update-actions">
        <button
          className="btn btn-sm btn-ghost"
          title="View the release on GitHub"
          onClick={() => window.nsm.openExternal(info.releaseUrl)}
        >
          <ExternalLink size={14} />
        </button>

        {phase === 'idle' && (
          <>
            <button className="btn btn-sm" onClick={onDismiss}>
              Later
            </button>
            <button className="btn btn-sm btn-primary" onClick={startDownload}>
              Update now
            </button>
          </>
        )}

        {phase === 'downloading' && (
          <button className="btn btn-sm" disabled>
            <RefreshCw size={13} className="spin" /> Downloading…
          </button>
        )}

        {phase === 'ready' && (
          <>
            <button className="btn btn-sm" onClick={onDismiss}>
              Later
            </button>
            <button className="btn btn-sm btn-primary" onClick={install}>
              Restart &amp; install
            </button>
          </>
        )}

        {phase === 'failed' && (
          <>
            <button className="btn btn-sm" onClick={() => window.nsm.openExternal(info.releaseUrl)}>
              Download manually
            </button>
            <button className="btn btn-sm btn-primary" onClick={startDownload}>
              Retry
            </button>
          </>
        )}

        <button className="btn-ghost" style={{ padding: 4 }} onClick={onDismiss} aria-label="Dismiss">
          <X size={15} />
        </button>
      </div>
    </div>
  )
}

function firstLines(text: string, count: number): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^[#*\-\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, count)
    .join(' · ')
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
