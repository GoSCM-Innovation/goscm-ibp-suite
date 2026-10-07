import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { alFallarLaCarga } from './lib/recarga-por-version.js'

// Tras un despliegue, una pestaña abierta de antes puede pedir un archivo que ya no existe. Se recarga para
// traer la versión nueva, sin entrar en bucle: ver `recarga-por-version.js`.
window.addEventListener('vite:preloadError', alFallarLaCarga)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
