import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowDownCircle, CheckCircle2, ExternalLink, RefreshCw, X } from 'lucide-react'
import type { UpdateInfo } from '@shared/types'

type Phase = 'idle' | 'downloading' | 'ready' | 'failed'

interface Props {
  info: UpdateInfo
  onDismiss: () => void
  /** Begin downloading immediately, e.g. when the launch dialog said "Update now". */
  autoStart?: boolean
}

export default function UpdateBanner({ info, onDismiss, autoStart }: Props): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState({ received: 0, total: info.assetSize ?? 0 })
  const [installerPath, setInstallerPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => window.nsm.updates.onProgress(setProgress), [])

  const started = useRef(false)
  useEffect(() => {
    if (!autoStart || started.current) return
    started.current = true
    void startDownload()
    // startDownload is stable for the life of this banner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart])

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

  // A retired version cannot be dismissed: older builds downloaded updates with a
  // bug that silently corrupted the installer, so "Later" would strand the user.
  const required = info.mandatory

  return (
    <div className={`update-banner ${required ? 'required' : ''}`}>
      <div className="update-icon">
        {phase === 'ready' ? <CheckCircle2 size={18} /> : required ? <AlertTriangle size={18} /> : <ArrowDownCircle size={18} />}
      </div>

      <div className="update-text">
        <div className="update-title">
          {phase === 'ready'
            ? `Version ${info.latestVersion} is ready to install`
            : required
              ? `Update required — version ${info.currentVersion} is no longer supported`
              : `Version ${info.latestVersion} is available`}
          <span className="update-current">
            {required ? `update to ${info.latestVersion}` : `you have ${info.currentVersion}`}
          </span>
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

        {phase === 'idle' && required && (
          <div className="update-notes">
            This version has a known defect and has been retired. Updating is the only
            supported path forward.
          </div>
        )}

        {phase === 'idle' && !required && info.notes && (
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
            {!required && (
              <button className="btn btn-sm" onClick={onDismiss}>
                Later
              </button>
            )}
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
            {!required && (
              <button className="btn btn-sm" onClick={onDismiss}>
                Later
              </button>
            )}
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

        {!required && (
          <button className="btn-ghost" style={{ padding: 4 }} onClick={onDismiss} aria-label="Dismiss">
            <X size={15} />
          </button>
        )}
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
