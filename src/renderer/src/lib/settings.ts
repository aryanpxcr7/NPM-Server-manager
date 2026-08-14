/**
 * User settings.
 *
 * These live in the renderer's `localStorage` rather than in the main process
 * store: they are all pure UI preference, and `localStorage` is already scoped to
 * the data directory, so a development run keeps its own settings exactly like it
 * keeps its own project list.
 */
import { comboProblem, SHORTCUTS, type ShortcutBindings, type ShortcutId } from './shortcuts'
import { DEFAULT_THEME_ID, THEMES } from './themes'

export interface Settings {
  /** Theme id from `themes.ts`; an unknown id falls back to the default. */
  theme: string
  /** Default state of "Open in browser when ready" in the Start Server dialog. */
  openWhenReady: boolean
  /** Script that the start-server shortcut runs. */
  devScript: string
  /** How often the port table is re-read while the window is visible. */
  scanIntervalMs: number
  /** Rebound shortcuts, by id. Anything absent keeps its default combo. */
  shortcuts: ShortcutBindings
}

export const DEFAULT_SETTINGS: Settings = {
  theme: DEFAULT_THEME_ID,
  openWhenReady: false,
  devScript: 'dev',
  scanIntervalMs: 4000,
  shortcuts: {}
}

export const SCAN_INTERVALS = [2000, 4000, 10_000, 30_000] as const

const KEY = 'nsm.settings'
/** Written by the Start Server dialog before there was a settings store. */
const LEGACY_OPEN_KEY = 'nsm.openWhenReady'

/**
 * Keeps only rebindings that still make sense: a known id, a combo that is legal
 * to bind, and no two ids on the same combo. Stored settings outlive the version
 * that wrote them, so a shortcut that has since been removed or made fixed must
 * not resurrect itself.
 */
function coerceShortcuts(raw: unknown): ShortcutBindings {
  if (typeof raw !== 'object' || raw === null) return {}
  const bindings: ShortcutBindings = {}
  const taken = new Set<string>()

  for (const shortcut of SHORTCUTS) {
    if (shortcut.fixed) continue
    const combo = (raw as Record<string, unknown>)[shortcut.id]
    if (typeof combo !== 'string' || combo === shortcut.combo) continue
    if (comboProblem(combo) !== null || taken.has(combo)) continue
    bindings[shortcut.id as ShortcutId] = combo
    taken.add(combo)
  }
  return bindings
}

function coerce(raw: unknown): Settings {
  // `shortcuts` is a nested object, so every fallback needs its own copy.
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS, shortcuts: {} }
  const value = raw as Partial<Record<keyof Settings, unknown>>

  const theme =
    typeof value.theme === 'string' && THEMES.some((t) => t.id === value.theme)
      ? value.theme
      : DEFAULT_SETTINGS.theme

  const devScript =
    typeof value.devScript === 'string' && value.devScript.trim().length > 0
      ? value.devScript.trim()
      : DEFAULT_SETTINGS.devScript

  const interval = Number(value.scanIntervalMs)

  return {
    shortcuts: coerceShortcuts(value.shortcuts),
    theme,
    openWhenReady:
      typeof value.openWhenReady === 'boolean'
        ? value.openWhenReady
        : DEFAULT_SETTINGS.openWhenReady,
    devScript,
    scanIntervalMs: SCAN_INTERVALS.includes(interval as (typeof SCAN_INTERVALS)[number])
      ? interval
      : DEFAULT_SETTINGS.scanIntervalMs
  }
}

export function loadSettings(): Settings {
  try {
    const stored = window.localStorage.getItem(KEY)
    if (stored !== null) return coerce(JSON.parse(stored))
    // First run after the upgrade: keep the checkbox the user had already set.
    return {
      ...DEFAULT_SETTINGS,
      shortcuts: {},
      openWhenReady: window.localStorage.getItem(LEGACY_OPEN_KEY) === '1'
    }
  } catch {
    return { ...DEFAULT_SETTINGS, shortcuts: {} }
  }
}

export function saveSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // A blocked localStorage only costs persistence; the session still works.
  }
}
