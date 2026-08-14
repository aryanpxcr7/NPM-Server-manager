/**
 * The integrated terminal.
 *
 * One xterm.js instance per session, all kept mounted and hidden with CSS rather
 * than unmounted on tab switch -- an unmounted terminal loses its scroll position
 * and its selection, and has to replay its whole scrollback to come back.
 *
 * The session itself lives in the main process (`main/terminal.ts`), so closing
 * the panel, switching to the log tab or reloading the renderer does not end the
 * shell: the panel re-attaches and redraws from the scrollback it kept.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Plus, Trash2, X } from 'lucide-react'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal as Xterm } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { TerminalChunk, TerminalSession, TerminalShell } from '@shared/types'
import { comboOf } from '../lib/shortcuts'
import { terminalPalette, type TerminalPalette } from '../lib/terminal-theme'
import { findTheme } from '../lib/themes'
import { useSettings } from './SettingsProvider'

/** The stylesheet's mono stack, which xterm needs as a concrete font list. */
function monoFamily(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim()
  return value.length > 0 ? value : 'Consolas, monospace'
}

interface InstanceProps {
  session: TerminalSession
  active: boolean
  fontSize: number
  palette: TerminalPalette
  /** The combo that toggles this panel, which must reach the app, not the shell. */
  toggleCombo: string
}

function TerminalInstance({
  session,
  active,
  fontSize,
  palette,
  toggleCombo
}: InstanceProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Xterm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  // Read inside long-lived handlers, so they always see the current value without
  // the terminal having to be torn down and rebuilt when it changes.
  const toggleRef = useRef(toggleCombo)
  toggleRef.current = toggleCombo

  /** Re-measures the terminal and tells the pty its new size. */
  const fitNow = useCallback((): void => {
    const host = hostRef.current
    const term = termRef.current
    const fit = fitRef.current
    // A hidden host measures 0x0, and fitting to that would tell the shell it has
    // no screen -- which some programs take as a cue to redraw at one column.
    if (!host || !term || !fit || host.clientWidth === 0 || host.clientHeight === 0) return
    try {
      fit.fit()
    } catch {
      return // the terminal can be disposed between the check and the call
    }
    void window.nsm.terminal.resize(session.id, term.cols, term.rows).catch(() => undefined)
  }, [session.id])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Xterm({
      fontSize,
      fontFamily: monoFamily(),
      theme: palette,
      cursorBlink: true,
      cursorStyle: 'bar',
      // Deep enough to scroll back through a failed build, which is the whole
      // reason to have the panel rather than a separate window.
      scrollback: 10_000,
      drawBoldTextInBrightColors: false,
      allowProposedApi: true
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        event.preventDefault()
        void window.nsm.openExternal(uri).catch(() => undefined)
      })
    )
    term.open(host)
    termRef.current = term
    fitRef.current = fit

    const copySelection = (): void => {
      const text = term.getSelection()
      if (text.length === 0) return
      void window.nsm.clipboard.write(text).catch(() => undefined)
      term.clearSelection()
    }
    const paste = async (): Promise<void> => {
      const text = await window.nsm.clipboard.read().catch(() => '')
      if (text.length > 0) await window.nsm.terminal.write(session.id, text).catch(() => undefined)
    }

    // Windows terminal conventions: Ctrl+C copies when there is a selection and
    // interrupts when there is not, Ctrl+Shift+C/V always copy and paste.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      if (comboOf(e) === toggleRef.current) return false

      if (!e.ctrlKey || e.altKey) return true
      const key = e.key.toLowerCase()
      if (key === 'c' && (e.shiftKey || term.hasSelection())) {
        copySelection()
        return false
      }
      if (key === 'v') {
        void paste()
        return false
      }
      return true
    })

    // Right-click is copy-or-paste, as it is in a Windows console.
    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault()
      if (term.hasSelection()) copySelection()
      else void paste()
    }
    host.addEventListener('contextmenu', onContextMenu)

    const input = term.onData((data) => {
      void window.nsm.terminal.write(session.id, data).catch(() => undefined)
    })

    // Output that arrived before the scrollback request resolves is held back and
    // replayed in order; `seq` is what makes the two streams joinable without
    // either dropping a chunk or printing one twice.
    let replayed = false
    let queue: TerminalChunk[] = []
    let lastSeq = 0
    let disposed = false

    const write = (chunk: TerminalChunk): void => {
      if (chunk.seq <= lastSeq) return
      lastSeq = chunk.seq
      term.write(chunk.data)
    }

    const offData = window.nsm.terminal.onData((chunk) => {
      if (chunk.id !== session.id || disposed) return
      if (replayed) write(chunk)
      else queue.push(chunk)
    })

    window.nsm.terminal
      .buffer(session.id)
      .then(({ data, seq }) => {
        if (disposed) return
        if (data.length > 0) term.write(data)
        lastSeq = seq
        replayed = true
        for (const chunk of queue) write(chunk)
        queue = []
      })
      .catch(() => {
        replayed = true
      })

    let frame = 0
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(fitNow)
    })
    observer.observe(host)

    return () => {
      disposed = true
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      host.removeEventListener('contextmenu', onContextMenu)
      offData()
      input.dispose()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
    // Deliberately keyed on the session alone: font size, palette and the toggle
    // combo are applied by the effects below and by `toggleRef`, so changing one
    // does not throw away the scrollback that is on screen.
  }, [session.id, fitNow])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontSize = fontSize
    fitNow()
  }, [fontSize, fitNow])

  useEffect(() => {
    const term = termRef.current
    if (term) term.options.theme = palette
  }, [palette])

  // Becoming visible is the only moment the terminal can be measured correctly.
  useEffect(() => {
    if (!active) return
    fitNow()
    termRef.current?.focus()
  }, [active, fitNow])

  // A shell that has exited leaves its output on screen; without this the panel
  // just stops responding to typing with no explanation.
  useEffect(() => {
    if (session.status !== 'exited') return
    const term = termRef.current
    if (!term) return
    const code = session.exitCode
    term.write(`\r\n\x1b[2m[${session.shellLabel} exited${code === null ? '' : ` with code ${code}`}]\x1b[0m\r\n`)
  }, [session.status, session.exitCode, session.shellLabel])

  return (
    <div className={`term-host ${active ? 'active' : ''}`} ref={hostRef} />
  )
}

interface Props {
  /** Folder new terminals open in; null starts them in the home directory. */
  projectId: string | null
  /** True while the terminal tab of the dock is the one on screen. */
  visible: boolean
  /**
   * Incremented by the app to ask for a new session. A counter rather than a
   * callback because "open a terminal here" has to mean a *new* one even when the
   * panel is already showing a session in some other folder.
   */
  newSessionRequest: number
  toggleCombo: string
  onError: (message: string) => void
}

export default function TerminalPanel({
  projectId,
  visible,
  newSessionRequest,
  toggleCombo,
  onError
}: Props): React.JSX.Element {
  const { settings } = useSettings()
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [shells, setShells] = useState<TerminalShell[]>([])
  const [loaded, setLoaded] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const palette = useMemo(() => terminalPalette(findTheme(settings.theme)), [settings.theme])

  const errorRef = useRef(onError)
  errorRef.current = onError
  const projectRef = useRef(projectId)
  projectRef.current = projectId
  const shellRef = useRef(settings.terminalShell)
  shellRef.current = settings.terminalShell

  const create = useCallback(async (shellId?: string): Promise<void> => {
    setBusy(true)
    try {
      const session = await window.nsm.terminal.create({
        projectId: projectRef.current,
        shellId: shellId ?? shellRef.current
      })
      setSessions((current) => [...current, session])
      setActiveId(session.id)
    } catch (err) {
      errorRef.current(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [])

  const close = useCallback((id: string): void => {
    setSessions((current) => current.filter((s) => s.id !== id))
    void window.nsm.terminal.close(id).catch(() => undefined)
  }, [])

  // Sessions outlive the panel, so the first thing it does is adopt whatever is
  // already running rather than assume it starts from nothing.
  useEffect(() => {
    let cancelled = false
    void Promise.all([window.nsm.terminal.list(), window.nsm.terminal.shells()])
      .then(([open, found]) => {
        if (cancelled) return
        setSessions(open)
        setShells(found)
      })
      .catch((err: unknown) =>
        errorRef.current(err instanceof Error ? err.message : String(err))
      )
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })

    const off = window.nsm.terminal.onSession((session) => {
      setSessions((current) =>
        current.map((s) => (s.id === session.id ? session : s))
      )
    })

    return () => {
      cancelled = true
      off()
    }
  }, [])

  // Whatever the tab list does -- adopt, open, close -- the selection follows it,
  // so there is never an active id pointing at a tab that is not there.
  useEffect(() => {
    if (activeId !== null && sessions.some((s) => s.id === activeId)) return
    setActiveId(sessions[sessions.length - 1]?.id ?? null)
  }, [sessions, activeId])

  // Opening the panel with nothing in it should give you a prompt, not a button
  // to press to get one. Once only: if that fails, the empty state explains why.
  const autoStarted = useRef(false)
  useEffect(() => {
    if (!visible || !loaded || autoStarted.current) return
    autoStarted.current = true
    if (sessions.length === 0) void create()
  }, [visible, loaded, sessions.length, create])

  // Zero is the initial value and means "nothing asked for yet"; only a change
  // opens a session, so a remount of the panel does not open a spare one.
  const lastRequest = useRef(newSessionRequest)
  useEffect(() => {
    if (newSessionRequest === lastRequest.current) return
    lastRequest.current = newSessionRequest
    autoStarted.current = true
    void create()
  }, [newSessionRequest, create])

  useEffect(() => {
    if (!menuOpen) return
    const dismiss = (): void => setMenuOpen(false)
    window.addEventListener('mousedown', dismiss)
    return () => window.removeEventListener('mousedown', dismiss)
  }, [menuOpen])

  const active = sessions.find((s) => s.id === activeId) ?? null

  return (
    <div className="term-panel">
      <div className="term-tabs">
        <div className="term-tab-list">
          {sessions.map((session) => (
            <span
              key={session.id}
              className={`term-tab ${session.id === activeId ? 'active' : ''}`}
            >
              <button className="term-tab-label" onClick={() => setActiveId(session.id)}>
                <span className={`status-dot ${session.status === 'running' ? 'running' : 'exited'}`} />
                {session.title}
                <span className="term-tab-shell">{session.shellLabel}</span>
              </button>
              <button
                className="term-tab-close"
                onClick={() => close(session.id)}
                title={session.status === 'running' ? 'Close terminal (ends the shell)' : 'Close tab'}
                aria-label="Close terminal"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>

        <div className="term-new">
          <button
            className="btn-ghost btn-sm"
            onClick={() => void create()}
            disabled={busy}
            title="New terminal"
            aria-label="New terminal"
          >
            <Plus size={14} />
          </button>
          {shells.length > 1 && (
            <button
              className="btn-ghost btn-sm"
              onMouseDown={(e) => {
                e.stopPropagation()
                setMenuOpen((open) => !open)
              }}
              title="New terminal with a different shell"
              aria-label="Choose a shell"
              aria-expanded={menuOpen}
            >
              <ChevronDown size={13} />
            </button>
          )}

          {menuOpen && (
            <div className="term-shell-menu" onMouseDown={(e) => e.stopPropagation()}>
              {shells.map((shell) => (
                <button
                  key={shell.id}
                  onClick={() => {
                    setMenuOpen(false)
                    void create(shell.id)
                  }}
                  title={shell.file}
                >
                  {shell.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          className="btn-ghost btn-sm"
          onClick={() => active && close(active.id)}
          disabled={!active}
          title="Close the active terminal"
          aria-label="Close the active terminal"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="term-body">
        {sessions.map((session) => (
          <TerminalInstance
            key={session.id}
            session={session}
            active={visible && session.id === activeId}
            fontSize={settings.terminalFontSize}
            palette={palette}
            toggleCombo={toggleCombo}
          />
        ))}

        {sessions.length === 0 && (
          <div className="term-empty">
            <p>No terminal open.</p>
            <button className="btn btn-sm" onClick={() => void create()} disabled={busy}>
              <Plus size={14} /> New terminal
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
