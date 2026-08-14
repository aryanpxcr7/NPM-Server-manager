import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'

type ToastKind = 'info' | 'success' | 'error'

interface Toast {
  id: number
  kind: ToastKind
  text: string
}

interface ToastApi {
  push: (kind: ToastKind, text: string) => void
  info: (text: string) => void
  success: (text: string) => void
  error: (text: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (kind: ToastKind, text: string) => {
      const id = nextId.current++
      setToasts((current) => [...current, { id, kind, text }])
      // Errors stay long enough to actually read a stack-ish message.
      window.setTimeout(() => dismiss(id), kind === 'error' ? 9000 : 4000)
    },
    [dismiss]
  )

  const api = useMemo<ToastApi>(
    () => ({
      push,
      info: (text) => push('info', text),
      success: (text) => push('success', text),
      error: (text) => push('error', text)
    }),
    [push]
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind}`}>
            {toast.kind === 'error' ? (
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            ) : toast.kind === 'success' ? (
              <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            ) : (
              <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            )}
            <div className="toast-text">{toast.text}</div>
            <button className="btn-ghost" style={{ padding: 2 }} onClick={() => dismiss(toast.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
