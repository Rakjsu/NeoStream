import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { themeService } from './services/themeService'
import { bootProfiler } from './services/bootProfiler'
import { diagnosticsService } from './services/diagnosticsService'

// Apply the persisted theme (CSS custom properties on <html>) before the
// first render so themed surfaces never flash the default palette.
themeService.apply()

// ⏱️ Item 20: primeira marca do profiling de boot (renderer nasceu).
bootProfiler.mark('rendererStart')

// Forward uncaught renderer errors to the main process so they land in
// main.log — packaged-app bug reports were blind to the UI side.
// Throttled so an error loop can't flood the log file.
const REPORT_LIMIT = 20
let reportedErrors = 0

function reportRendererError(message: string, stack?: string, level: 'error' | 'warn' = 'error') {
  // Always record into the in-memory diagnostics ring buffer (cheap, never
  // persisted; only included in an export when the opt-in is enabled).
  try {
    diagnosticsService.record({ time: new Date().toISOString(), level, message })
  } catch {
    // Buffer unavailable — ignore.
  }

  if (reportedErrors >= REPORT_LIMIT) return
  reportedErrors += 1
  try {
    window.ipcRenderer?.send('log:renderer', { level, message, stack })
  } catch {
    // Preload bridge unavailable (e.g. tests) — nothing to do.
  }
}

window.addEventListener('error', (event) => {
  reportRendererError(event.message, event.error?.stack)
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  const message = reason instanceof Error ? reason.message : String(reason)
  const stack = reason instanceof Error ? reason.stack : undefined
  reportRendererError(`Unhandled rejection: ${message}`, stack)
})

// Note: StrictMode was removed because it causes video player issues
// (double mounting causes video to reinitialize and seek operations to fail)
createRoot(document.getElementById('root')!).render(
  <App />,
)
