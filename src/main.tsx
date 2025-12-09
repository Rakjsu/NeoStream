import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Note: StrictMode was removed because it causes video player issues
// (double mounting causes video to reinitialize and seek operations to fail)
createRoot(document.getElementById('root')!).render(
  <App />,
)
