/**
 * User settings.
 *
 * These live in the renderer's `localStorage` rather than in the main process
 * store: they are all pure UI preference, and `localStorage` is already scoped to
 * the data directory, so a development run keeps its own settings exactly like it
 * keeps its own project list.
 */
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
}

export const DEFAULT_SETTINGS: Settings = {
  theme: DEFAULT_THEME_ID,
  openWhenReady: false,
  devScript: 'dev',
  scanIntervalMs: 4000
}

export const SCAN_INTERVALS = [2000, 4000, 10_000, 30_000] as const

const KEY = 'nsm.settings'
/** Written by the Start Server dialog before there was a settings store. */
const LEGACY_OPEN_KEY = 'nsm.openWhenReady'

function coerce(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS }
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
    return { ...DEFAULT_SETTINGS, openWhenReady: window.localStorage.getItem(LEGACY_OPEN_KEY) === '1' }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // A blocked localStorage only costs persistence; the session still works.
  }
}
