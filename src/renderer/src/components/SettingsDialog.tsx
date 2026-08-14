import { useState } from 'react'
import { Check, Command, Palette, SlidersHorizontal } from 'lucide-react'
import Modal from './Modal'
import { useSettings } from './SettingsProvider'
import { DEFAULT_SETTINGS, SCAN_INTERVALS } from '../lib/settings'
import { comboKeys, SHORTCUTS } from '../lib/shortcuts'
import { THEMES, type Theme } from '../lib/themes'

type Tab = 'appearance' | 'behaviour' | 'shortcuts'

const TABS: { id: Tab; label: string; icon: typeof Palette }[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'behaviour', label: 'Behaviour', icon: SlidersHorizontal },
  { id: 'shortcuts', label: 'Shortcuts', icon: Command }
]

/** A miniature of the app drawn in the theme's own colours. */
function ThemePreview({ theme }: { theme: Theme }): React.JSX.Element {
  const c = theme.colors
  return (
    <div className="theme-mini" style={{ background: c.bg, borderColor: c.border }}>
      <div className="theme-mini-side" style={{ background: c['bg-inset'], borderColor: c.border }}>
        <span className="theme-mini-dot" style={{ background: c.accent }} />
        <span className="theme-mini-bar" style={{ background: c['border-strong'] }} />
        <span className="theme-mini-bar" style={{ background: c['border-strong'] }} />
      </div>
      <div className="theme-mini-main">
        <span className="theme-mini-bar wide" style={{ background: c['text-dim'] }} />
        <span className="theme-mini-bar" style={{ background: c['border-strong'] }} />
        <span className="theme-mini-swatches">
          <i style={{ background: c.green }} />
          <i style={{ background: c.amber }} />
          <i style={{ background: c.red }} />
          <i style={{ background: c.violet }} />
          <i style={{ background: c.cyan }} />
        </span>
      </div>
    </div>
  )
}

function ThemeGrid({
  themes,
  current,
  onPick
}: {
  themes: Theme[]
  current: string
  onPick: (id: string) => void
}): React.JSX.Element {
  return (
    <div className="theme-grid">
      {themes.map((theme) => (
        <button
          key={theme.id}
          className={`theme-card ${theme.id === current ? 'selected' : ''}`}
          onClick={() => onPick(theme.id)}
        >
          <ThemePreview theme={theme} />
          <span className="theme-card-name">
            {theme.name}
            {theme.id === current && <Check size={13} />}
          </span>
        </button>
      ))}
    </div>
  )
}

export default function SettingsDialog({
  initialTab = 'appearance',
  onClose
}: {
  initialTab?: Tab
  onClose: () => void
}): React.JSX.Element {
  const { settings, update } = useSettings()
  const [tab, setTab] = useState<Tab>(initialTab)

  const dark = THEMES.filter((t) => t.dark)
  const light = THEMES.filter((t) => !t.dark)

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      width={720}
      footer={
        <>
          <button
            className="btn btn-sm"
            onClick={() => update(DEFAULT_SETTINGS)}
            title="Theme, behaviour -- everything back to how it shipped"
          >
            Reset to defaults
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="settings-tabs">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`settings-tab ${tab === id ? 'active' : ''}`}
            onClick={() => setTab(id)}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'appearance' && (
        <div className="settings-pane">
          <p className="settings-note">
            {THEMES.length} themes, applied the moment you click one.
          </p>
          <div className="settings-group-label">Dark</div>
          <ThemeGrid themes={dark} current={settings.theme} onPick={(theme) => update({ theme })} />
          <div className="settings-group-label">Light</div>
          <ThemeGrid themes={light} current={settings.theme} onPick={(theme) => update({ theme })} />
        </div>
      )}

      {tab === 'behaviour' && (
        <div className="settings-pane">
          <label className="setting-row">
            <input
              type="checkbox"
              className="checkbox"
              checked={settings.openWhenReady}
              onChange={(e) => update({ openWhenReady: e.target.checked })}
            />
            <span>
              Open the browser when a server is ready
              <span className="hint">
                Sets the default for the checkbox in the Start Server dialog, and applies to
                servers started with a shortcut.
              </span>
            </span>
          </label>

          <div className="setting-row column">
            <span>
              Script the start shortcut runs
              <span className="hint">
                Ctrl+D runs this script. If a project has no script by that name, its first
                development script is used instead.
              </span>
            </span>
            <input
              className="field-input"
              value={settings.devScript}
              spellCheck={false}
              onChange={(e) => update({ devScript: e.target.value })}
              onBlur={(e) => {
                if (e.target.value.trim().length === 0) update({ devScript: DEFAULT_SETTINGS.devScript })
              }}
            />
          </div>

          <div className="setting-row column">
            <span>
              How often ports are rescanned
              <span className="hint">
                Each scan shells out to netstat and the process table. Slow it down if you keep
                many projects open; speed it up to notice a new server sooner.
              </span>
            </span>
            <div className="segmented">
              {SCAN_INTERVALS.map((ms) => (
                <button
                  key={ms}
                  className={settings.scanIntervalMs === ms ? 'active' : ''}
                  onClick={() => update({ scanIntervalMs: ms })}
                >
                  {ms / 1000}s
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'shortcuts' && (
        <div className="settings-pane">
          <p className="settings-note">
            Shortcuts are ignored while a dialog is open or while you are typing in a field.
          </p>
          <div className="shortcut-list">
            {SHORTCUTS.map((shortcut) => (
              <div key={shortcut.id} className="shortcut-row">
                <span className="shortcut-label">
                  {shortcut.label}
                  {shortcut.needs && <span className="hint">needs {shortcut.needs}</span>}
                </span>
                <span className="shortcut-keys">
                  {(shortcut.display ?? comboKeys(shortcut.combo)).map((key, i) => (
                    <kbd key={i}>{key}</kbd>
                  ))}
                  {shortcut.id === 'project-n' && <span className="shortcut-range">… 9</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}
