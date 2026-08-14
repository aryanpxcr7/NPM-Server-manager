/**
 * Keyboard shortcuts.
 *
 * The table below is both the reference shown in Settings and the dispatch table
 * the handler in `App.tsx` switches on, so the two cannot drift apart.
 */

export type ShortcutId =
  | 'settings'
  | 'shortcuts'
  | 'start-dev'
  | 'start-pick'
  | 'stop'
  | 'restart'
  | 'open-browser'
  | 'terminal'
  | 'reveal'
  | 'add-project'
  | 'toggle-logs'
  | 'rescan'
  | 'servers-view'
  | 'project-n'

export interface Shortcut {
  id: ShortcutId
  /** Default combo, as produced by `comboOf`. Empty for ranges like Ctrl+1-9. */
  combo: string
  /** What is drawn in the settings table when the combo is a range. */
  display?: string[]
  label: string
  /** The state the shortcut needs, shown beside it so a no-op is not a mystery. */
  needs?: string
  /** True when the combo cannot be rebound, because it is a range of keys. */
  fixed?: boolean
}

/** A user's rebindings, by id. Anything absent uses the default combo. */
export type ShortcutBindings = Partial<Record<ShortcutId, string>>

export const SHORTCUTS: Shortcut[] = [
  { id: 'start-dev', combo: 'ctrl+d', label: 'Start the dev server for the open project', needs: 'a project open' },
  { id: 'start-pick', combo: 'ctrl+enter', label: 'Choose a script to start', needs: 'a project open' },
  { id: 'stop', combo: 'ctrl+shift+s', label: 'Stop the active server', needs: 'a server running' },
  { id: 'restart', combo: 'ctrl+shift+r', label: 'Restart the active server', needs: 'a server running' },
  { id: 'open-browser', combo: 'ctrl+b', label: 'Open the active server in the browser', needs: 'a known port' },
  { id: 'terminal', combo: 'ctrl+t', label: 'Open a terminal in the project folder', needs: 'a project open' },
  { id: 'reveal', combo: 'ctrl+e', label: 'Show the project folder in Explorer', needs: 'a project open' },
  { id: 'add-project', combo: 'ctrl+o', label: 'Add a project folder' },
  { id: 'toggle-logs', combo: 'ctrl+l', label: 'Show or hide the log panel' },
  { id: 'rescan', combo: 'ctrl+r', label: 'Rescan the port table' },
  {
    id: 'project-n',
    combo: '',
    display: ['Ctrl', '1'],
    label: 'Jump to the first nine projects (Ctrl+1 … Ctrl+9)',
    fixed: true
  },
  { id: 'servers-view', combo: 'ctrl+0', label: 'Go to Servers' },
  { id: 'settings', combo: 'ctrl+,', label: 'Open settings' },
  { id: 'shortcuts', combo: 'ctrl+/', label: 'Open this list' }
]

/**
 * The combo a key event represents, e.g. `ctrl+shift+r`. Modifier order is fixed
 * so the string can be compared directly.
 */
export function comboOf(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  if (e.metaKey) parts.push('meta')

  parts.push(e.key.toLowerCase())
  return parts.join('+')
}

/**
 * Key *names* as `KeyboardEvent.key` reports them, which is not what the combo
 * prefixes are called: holding Ctrl produces `key === 'Control'`, so the combo for
 * that event is `ctrl+control`.
 */
const MODIFIER_KEYS = new Set(['control', 'shift', 'alt', 'altgraph', 'meta', 'os'])

/**
 * True while a chord is still being held down -- the pressed key is itself a
 * modifier, so the combo is incomplete.
 *
 * Recording must ignore these rather than reject them: every real chord starts
 * with one or more of them, and complaining at that point tells the user their
 * perfectly good shortcut was refused.
 */
export function isChordInProgress(combo: string): boolean {
  return MODIFIER_KEYS.has(combo.split('+').pop() ?? '')
}

/**
 * Why a combo cannot be bound, or null when it can.
 *
 * The modifier requirement is not politeness: the handler runs on every keydown
 * in the window, so a bare letter would fire while the user is reading the log.
 */
export function comboProblem(combo: string): string | null {
  const parts = combo.split('+')
  const key = parts[parts.length - 1]

  if (MODIFIER_KEYS.has(key)) return 'Hold a modifier and press another key.'
  if (key === 'escape') return 'Esc cancels; it cannot be bound.'
  if (key === 'tab') return 'Tab moves focus; it cannot be bound.'
  if (!parts.includes('ctrl') && !parts.includes('alt') && !parts.includes('meta')) {
    return 'Needs Ctrl, Alt or Win, or it would fire while you type.'
  }
  if (/^ctrl\+[0-9]$/.test(combo)) return 'Ctrl+0 to Ctrl+9 are reserved for switching projects.'
  return null
}

/** Every shortcut's combo, with the user's rebindings applied. */
export function resolveBindings(overrides: ShortcutBindings): Record<ShortcutId, string> {
  const resolved = {} as Record<ShortcutId, string>
  for (const shortcut of SHORTCUTS) {
    resolved[shortcut.id] = shortcut.fixed ? shortcut.combo : overrides[shortcut.id] ?? shortcut.combo
  }
  return resolved
}

/** The reverse lookup the key handler needs: which shortcut a combo triggers. */
export function bindingLookup(overrides: ShortcutBindings): Map<string, ShortcutId> {
  const lookup = new Map<string, ShortcutId>()
  for (const [id, combo] of Object.entries(resolveBindings(overrides))) {
    if (combo.length > 0 && !lookup.has(combo)) lookup.set(combo, id as ShortcutId)
  }
  return lookup
}

/** Splits a combo into the keys to draw as separate chips. */
export function comboKeys(combo: string): string[] {
  return combo.split('+').map((part) => {
    switch (part) {
      case 'ctrl':
        return 'Ctrl'
      case 'shift':
        return 'Shift'
      case 'alt':
        return 'Alt'
      case 'meta':
        return 'Win'
      case 'enter':
        return 'Enter'
      case 'escape':
        return 'Esc'
      case ' ':
        return 'Space'
      case 'arrowup':
        return '↑'
      case 'arrowdown':
        return '↓'
      case 'arrowleft':
        return '←'
      case 'arrowright':
        return '→'
      default:
        // Single characters and F-keys read best upper-cased; named keys like
        // "backspace" read best capitalised.
        return part.length <= 3 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)
    }
  })
}
