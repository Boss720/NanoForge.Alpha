import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initThemePalette } from './lib/themePalette.ts'
import { initA11yPreferences } from './lib/a11y.ts'
import { AppErrorBoundary } from './components/ErrorBoundary.tsx'

// Hydrate saved theme palette and accessibility preferences directly into DOM before mount
initThemePalette()
initA11yPreferences()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
