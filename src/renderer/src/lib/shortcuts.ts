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
  /** Normalised combo, as produced by `comboOf`. Empty for ranges like Ctrl+1-9. */
  combo: string
  /** What is drawn in the settings table when the combo is a range. */
  display?: string[]
  label: string
  /** The state the shortcut needs, shown beside it so a no-op is not a mystery. */
  needs?: string
}

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
    label: 'Jump to the first nine projects (Ctrl+1 … Ctrl+9)'
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
      case ',':
        return ','
      default:
        return part.toUpperCase()
    }
  })
}
