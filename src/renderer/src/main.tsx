import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { loadSettings } from './lib/settings'
import { applyTheme } from './lib/themes'
import './styles.css'

// Before the first render, so a non-default theme never flashes the default one.
applyTheme(loadSettings().theme)

const container = document.getElementById('root')
if (!container) throw new Error('Root element missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
