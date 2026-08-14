import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FolderOpen, Play, Terminal, TerminalSquare, Trash2 } from 'lucide-react'
import { PROJECT_COLORS, type Project, type ProjectColor } from '@shared/types'

export interface MenuTarget {
  project: Project
  x: number
  y: number
}

interface Props {
  target: MenuTarget
  onClose: () => void
  /** The app's own terminal, in the bottom dock. */
  onOpenTerminalPanel: (project: Project) => void
  onOpenTerminal: (project: Project) => void
  onOpenFolder: (project: Project) => void
  onSetColor: (project: Project, color: ProjectColor | null) => void
  onRemove: (project: Project) => void
  onStartServer: (project: Project) => void
}

/** Swatch values must track the --project-* custom properties in styles.css. */
const SWATCH: Record<ProjectColor, string> = {
  blue: '#4c8dff',
  violet: '#a371f7',
  green: '#3fb950',
  amber: '#d29922',
  red: '#f85149',
  pink: '#f778ba',
  cyan: '#39c5cf',
  slate: '#8b98a9'
}

export default function ProjectContextMenu({
  target,
  onClose,
  onOpenTerminalPanel,
  onOpenTerminal,
  onOpenFolder,
  onSetColor,
  onRemove,
  onStartServer
}: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: target.x, y: target.y })

  // Keep the menu inside the window when opened near an edge.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      x: Math.min(target.x, window.innerWidth - width - 8),
      y: Math.min(target.y, window.innerHeight - height - 8)
    })
  }, [target])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // Capture phase, so a click anywhere dismisses before it activates anything.
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const run = (fn: () => void) => (): void => {
    fn()
    onClose()
  }

  const { project } = target

  return createPortal(
    <div className="context-menu" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu">
      <div className="context-menu-label">{project.name}</div>

      <button className="context-item" onClick={run(() => onStartServer(project))}>
        <Play size={14} /> Start server
      </button>
      <button className="context-item" onClick={run(() => onOpenTerminalPanel(project))}>
        <Terminal size={14} /> Terminal here
      </button>
      <button className="context-item" onClick={run(() => onOpenTerminal(project))}>
        <TerminalSquare size={14} /> Open in external terminal
      </button>
      <button className="context-item" onClick={run(() => onOpenFolder(project))}>
        <FolderOpen size={14} /> Open folder
      </button>

      <div className="context-sep" />

      <div className="context-menu-label">Colour</div>
      <div className="swatch-row">
        {PROJECT_COLORS.map((color) => (
          <button
            key={color}
            className={`swatch ${project.color === color ? 'selected' : ''}`}
            style={{ background: SWATCH[color] }}
            title={color}
            aria-label={`Set colour ${color}`}
            onClick={run(() => onSetColor(project, color))}
          />
        ))}
        <button
          className={`swatch swatch-none ${project.color === null ? 'selected' : ''}`}
          title="Default"
          aria-label="Clear colour"
          onClick={run(() => onSetColor(project, null))}
        />
      </div>

      <div className="context-sep" />

      <button className="context-item danger" onClick={run(() => onRemove(project))}>
        <Trash2 size={14} /> Remove from list
      </button>
    </div>,
    document.body
  )
}
