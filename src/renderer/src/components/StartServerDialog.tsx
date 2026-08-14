import { useMemo, useState } from 'react'
import { Hammer, Play, Rocket, TerminalSquare, TestTube2 } from 'lucide-react'
import type { ProjectScript, ScriptKind } from '@shared/types'
import Modal from './Modal'
import { useSettings } from './SettingsProvider'

interface Props {
  projectName: string
  scripts: ProjectScript[]
  /** Scripts already running, so we can disable them instead of failing on click. */
  runningScripts: string[]
  onPick: (script: string, openWhenReady: boolean) => void
  onClose: () => void
}

const ICONS: Record<ScriptKind, typeof Play> = {
  dev: Play,
  build: Hammer,
  start: Rocket,
  test: TestTube2,
  other: TerminalSquare
}

const HEADINGS: Record<ScriptKind, string> = {
  dev: 'Development',
  build: 'Build',
  start: 'Production',
  test: 'Checks',
  other: 'Other scripts'
}

const FRIENDLY: Record<string, string> = {
  dev: 'Start Dev Server',
  build: 'Start Build Server',
  start: 'Start Production Server',
  preview: 'Start Preview Server',
  serve: 'Start Static Server',
  watch: 'Start Watcher'
}

export default function StartServerDialog({
  projectName,
  scripts,
  runningScripts,
  onPick,
  onClose
}: Props): React.JSX.Element {
  const { settings, update } = useSettings()
  const [showAll, setShowAll] = useState(false)
  // Ticking the box here is a lasting choice, so it writes straight to settings.
  const openWhenReady = settings.openWhenReady

  // The common case is dev or build, so everything else hides behind a toggle
  // rather than burying the two buttons people actually came for.
  const primary = useMemo(
    () => scripts.filter((s) => s.kind === 'dev' || s.kind === 'build' || s.kind === 'start'),
    [scripts]
  )
  const secondary = useMemo(
    () => scripts.filter((s) => !primary.includes(s)),
    [scripts, primary]
  )

  const visible = showAll ? scripts : primary.length > 0 ? primary : scripts

  const grouped = useMemo(() => {
    const map = new Map<ScriptKind, ProjectScript[]>()
    for (const script of visible) {
      const list = map.get(script.kind) ?? []
      list.push(script)
      map.set(script.kind, list)
    }
    return [...map.entries()]
  }, [visible])

  return (
    <Modal
      title="Start Server"
      subtitle={`Choose which script to run for ${projectName}.`}
      onClose={onClose}
      footer={
        secondary.length > 0 && primary.length > 0 ? (
          <>
            <button className="btn btn-sm" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show fewer' : `Show all ${scripts.length} scripts`}
            </button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-sm" onClick={onClose}>
              Cancel
            </button>
          </>
        ) : (
          <button className="btn btn-sm" onClick={onClose}>
            Cancel
          </button>
        )
      }
    >
      {scripts.length === 0 ? (
        <p style={{ color: 'var(--text-dim)', paddingBottom: 8, lineHeight: 1.6 }}>
          This project&rsquo;s package.json has no <code>scripts</code> section, so there is nothing
          to start.
        </p>
      ) : (
        <div style={{ paddingBottom: 6 }}>
          {grouped.map(([kind, list]) => (
            <div key={kind}>
              {grouped.length > 1 && <div className="script-group-label">{HEADINGS[kind]}</div>}
              {list.map((script) => {
                const Icon = ICONS[script.kind]
                const isRunning = runningScripts.includes(script.name)
                return (
                  <button
                    key={script.name}
                    className="script-option"
                    disabled={isRunning}
                    onClick={() => onPick(script.name, openWhenReady)}
                  >
                    <div className={`script-icon ${script.kind}`}>
                      <Icon size={18} />
                    </div>
                    <div className="script-text">
                      <div className="label">
                        {FRIENDLY[script.name] ?? `Run "${script.name}"`}
                        {isRunning && (
                          <span className="tag tag-managed" style={{ marginLeft: 8 }}>
                            running
                          </span>
                        )}
                      </div>
                      <div className="cmd">{script.command}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          ))}

          <label className="start-option">
            <input
              type="checkbox"
              className="checkbox"
              checked={openWhenReady}
              onChange={(e) => update({ openWhenReady: e.target.checked })}
            />
            <span>
              Open in browser when ready
              <span className="hint">
                The address the server prints is opened once it is listening.
              </span>
            </span>
          </label>
        </div>
      )}
    </Modal>
  )
}
