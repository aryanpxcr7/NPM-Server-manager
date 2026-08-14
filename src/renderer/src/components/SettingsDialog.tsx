import { useEffect, useState } from 'react'
import { Check, Command, Palette, RotateCcw, SlidersHorizontal } from 'lucide-react'
import type { TerminalShell } from '@shared/types'
import Modal from './Modal'
import { useSettings } from './SettingsProvider'
import {
  DEFAULT_SETTINGS,
  SCAN_INTERVALS,
  TERMINAL_FONT_SIZES,
  type Settings
} from '../lib/settings'
import {
  comboKeys,
  comboOf,
  comboProblem,
  isChordInProgress,
  resolveBindings,
  SHORTCUTS,
  type ShortcutId
} from '../lib/shortcuts'
import { THEMES, type Theme } from '../lib/themes'

type Tab = 'appearance' | 'behaviour' | 'shortcuts'

const TABS: { id: Tab; label: string; icon: typeof Palette }[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'behaviour', label: 'Behaviour', icon: SlidersHorizontal },
  { id: 'shortcuts', label: 'Shortcuts', icon: Command }
]

/**
 * Reset is per tab, not global.
 *
 * One "Reset to defaults" button in the footer of a tabbed dialog looks like it
 * resets the tab you are looking at. It did not — resetting from the Shortcuts
 * tab also threw away the user's theme.
 */
const TAB_NOUN: Record<Tab, string> = {
  appearance: 'theme',
  behaviour: 'behaviour',
  shortcuts: 'shortcuts'
}

const TAB_DEFAULTS: Record<Tab, Partial<Settings>> = {
  appearance: { theme: DEFAULT_SETTINGS.theme },
  behaviour: {
    openWhenReady: DEFAULT_SETTINGS.openWhenReady,
    devScript: DEFAULT_SETTINGS.devScript,
    scanIntervalMs: DEFAULT_SETTINGS.scanIntervalMs,
    terminalShell: DEFAULT_SETTINGS.terminalShell,
    terminalFontSize: DEFAULT_SETTINGS.terminalFontSize,
    dockHeight: DEFAULT_SETTINGS.dockHeight
  },
  shortcuts: { shortcuts: {} }
}

function isTabDefault(tab: Tab, settings: Settings): boolean {
  switch (tab) {
    case 'appearance':
      return settings.theme === DEFAULT_SETTINGS.theme
    case 'behaviour':
      return (
        settings.openWhenReady === DEFAULT_SETTINGS.openWhenReady &&
        settings.devScript === DEFAULT_SETTINGS.devScript &&
        settings.scanIntervalMs === DEFAULT_SETTINGS.scanIntervalMs &&
        settings.terminalShell === DEFAULT_SETTINGS.terminalShell &&
        settings.terminalFontSize === DEFAULT_SETTINGS.terminalFontSize &&
        settings.dockHeight === DEFAULT_SETTINGS.dockHeight
      )
    case 'shortcuts':
      return Object.keys(settings.shortcuts).length === 0
  }
}

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

/**
 * The rebindable shortcut table.
 *
 * Recording captures keys on the window during the capture phase, so the combo
 * being recorded cannot also trigger the app's own handler or reach a button as a
 * click. `Esc` and clicking elsewhere both cancel.
 */
function ShortcutTab(): React.JSX.Element {
  const { settings, update } = useSettings()
  const [recording, setRecording] = useState<ShortcutId | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const bindings = resolveBindings(settings.shortcuts)

  const bind = (id: ShortcutId, combo: string): void => {
    const clash = SHORTCUTS.find((s) => s.id !== id && bindings[s.id] === combo)
    if (clash) {
      setProblem(`${comboKeys(combo).join('+')} already ${clash.label.toLowerCase()}.`)
      return
    }
    const next = { ...settings.shortcuts }
    const original = SHORTCUTS.find((s) => s.id === id)?.combo
    if (combo === original) delete next[id]
    else next[id] = combo
    update({ shortcuts: next })
    setRecording(null)
    setProblem(null)
  }

  useEffect(() => {
    if (!recording) return

    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(null)
        setProblem(null)
        return
      }
      const combo = comboOf(e)
      // Ctrl arrives as its own keydown before the key it modifies. Waiting for
      // the real key is the whole point: rejecting the chord as it is being
      // pressed reads as "rebinding is broken".
      if (isChordInProgress(combo)) return

      const why = comboProblem(combo)
      if (why) {
        setProblem(why)
        return
      }
      bind(recording, combo)
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // Deliberately no dependency array: the listener closes over the current
    // bindings, and re-attaching each render is cheaper than memoising them.
  })

  return (
    <div className="settings-pane" onMouseDown={() => setRecording(null)}>
      <p className="settings-note">
        Click a shortcut to rebind it, then press the keys you want. Shortcuts are ignored while a
        dialog is open or while you are typing in a field.
      </p>

      <div className="shortcut-list">
        {SHORTCUTS.map((shortcut) => {
          const combo = bindings[shortcut.id]
          const isRecording = recording === shortcut.id
          const changed = settings.shortcuts[shortcut.id] !== undefined

          return (
            <div key={shortcut.id} className="shortcut-row">
              <span className="shortcut-label">
                {shortcut.label}
                {shortcut.needs && <span className="hint">needs {shortcut.needs}</span>}
              </span>

              {changed && (
                <button
                  className="btn-ghost btn-sm shortcut-reset"
                  title="Back to the default"
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    const next = { ...settings.shortcuts }
                    delete next[shortcut.id]
                    update({ shortcuts: next })
                  }}
                >
                  <RotateCcw size={13} />
                </button>
              )}

              {shortcut.fixed ? (
                <span className="shortcut-keys">
                  {(shortcut.display ?? []).map((key, i) => (
                    <kbd key={i}>{key}</kbd>
                  ))}
                  <span className="shortcut-range">… 9 · fixed</span>
                </span>
              ) : (
                <button
                  className={`shortcut-keys editable ${isRecording ? 'recording' : ''}`}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    setProblem(null)
                    setRecording(isRecording ? null : shortcut.id)
                  }}
                  title="Click, then press the keys"
                >
                  {isRecording ? (
                    <span className="shortcut-recording">Press keys… (Esc cancels)</span>
                  ) : (
                    comboKeys(combo).map((key, i) => <kbd key={i}>{key}</kbd>)
                  )}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {problem && <p className="shortcut-problem">{problem}</p>}
    </div>
  )
}

/**
 * The terminal half of the Behaviour tab.
 *
 * The shell list is read from the main process rather than hardcoded, so the
 * dropdown only ever offers shells that are actually installed -- offering
 * PowerShell 7 on a machine without it would just be a way to fail on open.
 */
function TerminalSettings(): React.JSX.Element {
  const { settings, update } = useSettings()
  const [shells, setShells] = useState<TerminalShell[]>([])

  useEffect(() => {
    let cancelled = false
    void window.nsm.terminal
      .shells()
      .then((found) => {
        if (!cancelled) setShells(found)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const missing =
    settings.terminalShell !== 'auto' &&
    shells.length > 0 &&
    !shells.some((s) => s.id === settings.terminalShell)

  return (
    <>
      <div className="setting-row column">
        <span>
          Shell the terminal opens
          <span className="hint">
            New terminals start this shell. Existing ones keep the shell they were opened with,
            and the + button can always start a different one.
          </span>
        </span>
        <select
          className="field-input"
          value={settings.terminalShell}
          onChange={(e) => update({ terminalShell: e.target.value })}
        >
          <option value="auto">
            Automatic{shells.length > 0 ? ` (${shells[0].label})` : ''}
          </option>
          {shells.map((shell) => (
            <option key={shell.id} value={shell.id} title={shell.file}>
              {shell.label}
            </option>
          ))}
          {missing && <option value={settings.terminalShell}>{settings.terminalShell} — not found</option>}
        </select>
      </div>

      <div className="setting-row column">
        <span>
          Terminal text size
          <span className="hint">Applies to every open terminal as soon as you pick it.</span>
        </span>
        <div className="segmented">
          {TERMINAL_FONT_SIZES.map((size) => (
            <button
              key={size}
              className={settings.terminalFontSize === size ? 'active' : ''}
              onClick={() => update({ terminalFontSize: size })}
            >
              {size}px
            </button>
          ))}
        </div>
      </div>
    </>
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
            onClick={() => update(TAB_DEFAULTS[tab])}
            disabled={isTabDefault(tab, settings)}
            title={`Put ${TAB_NOUN[tab]} back to how it shipped. Nothing on the other tabs changes.`}
          >
            Reset {TAB_NOUN[tab]}
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

          <div className="settings-group-label">Terminal</div>
          <TerminalSettings />
        </div>
      )}

      {tab === 'shortcuts' && <ShortcutTab />}
    </Modal>
  )
}
