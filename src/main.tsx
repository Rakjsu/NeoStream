import { createRoot } from 'react-dom/client'
import './index.css'
import { RaizDoApp } from './RaizDoApp'
import { themeService } from './services/themeService'
import { bootProfiler } from './services/bootProfiler'
import { reportRendererError } from './services/rendererErrorReport'

// Apply the persisted theme (CSS custom properties on <html>) before the
// first render so themed surfaces never flash the default palette.
themeService.apply()

// ⏱️ Item 20: primeira marca do profiling de boot (renderer nasceu).
bootProfiler.mark('rendererStart')

// Forward uncaught renderer errors to the main process so they land in
// main.log — packaged-app bug reports were blind to the UI side.
// A função vive em `services/rendererErrorReport` porque o ErrorBoundary
// também precisa dela: o React engole o erro de render antes destes dois
// ouvintes, então o crash de tela não passava por aqui.
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
  <RaizDoApp />,
)
