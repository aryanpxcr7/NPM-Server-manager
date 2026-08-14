import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { loadSettings, saveSettings, type Settings } from '../lib/settings'
import { applyTheme } from '../lib/themes'

interface SettingsContextValue {
  settings: Settings
  /** Merges a partial change, persists it, and applies the theme if it moved. */
  update: (patch: Partial<Settings>) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [settings, setSettings] = useState<Settings>(loadSettings)

  // main.tsx applies the stored theme before the first paint; this covers every
  // later change, including a theme previewed from the settings dialog.
  useEffect(() => {
    applyTheme(settings.theme)
  }, [settings.theme])

  const update = useCallback((patch: Partial<Settings>): void => {
    setSettings((current) => {
      const next = { ...current, ...patch }
      saveSettings(next)
      return next
    })
  }, [])

  const value = useMemo(() => ({ settings, update }), [settings, update])

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext)
  if (!value) throw new Error('useSettings must be used inside a SettingsProvider')
  return value
}
