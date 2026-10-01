import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// Tras un despliegue, una pestaña abierta de antes puede pedir un archivo que ya no existe (los
// nombres llevan un código que cambia con cada versión). Vite avisa con este evento: se recarga UNA
// vez para traer la versión nueva. La marca evita un bucle si el fallo fuera otro.
window.addEventListener('vite:preloadError', (evento) => {
  evento.preventDefault()
  try {
    if (sessionStorage.getItem('recargado-por-version')) return
    sessionStorage.setItem('recargado-por-version', '1')
  } catch { /* sin almacenamiento: se recarga igual, una vez por carga de la página */ }
  window.location.reload()
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
