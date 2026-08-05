// El módulo CI-DS Tools: elegir el tenant y, por ahora, el monitor de tareas.
//
// La conexión se elige aquí y no dentro del monitor porque las demás herramientas del módulo
// (orquestador, explorador de integraciones, documentación) van a apuntar a la misma.

import { useEffect, useState } from 'react'
import { listCidsConnections } from '../../lib/cids.js'
import TaskMonitor from './TaskMonitor.jsx'

export default function CidsTools() {
  const [conexiones, setConexiones] = useState(null)
  const [elegida, setElegida] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    listCidsConnections()
      .then((lista) => {
        setConexiones(lista)
        // Con una sola conexión no hay nada que elegir: se entra directo al monitor.
        if (lista.length > 0) setElegida(lista[0].id)
      })
      .catch((fallo) => { setError(fallo.message); setConexiones([]) })
  }, [])

  if (conexiones === null) {
    return <div className="page-hint">Cargando conexiones…</div>
  }

  if (error) {
    return <div className="notice notice-error">✕ {error}</div>
  }

  if (conexiones.length === 0) {
    return (
      <div className="notice notice-info">
        No hay ninguna conexión a CI-DS configurada para tu empresa. Pedile a quien administra la
        cuenta que la dé de alta en Administración → Conexiones.
      </div>
    )
  }

  const activa = conexiones.find((conexion) => conexion.id === elegida)

  return (
    <div className="module-page">
      <div className="module-head">
        <div>
          <div className="page-title">Monitor de tareas</div>
          <div className="page-hint">Ejecuciones de CI-DS, su estado y su duración.</div>
        </div>

        <div className="monitor-bar">
          {conexiones.length > 1 ? (
            <select
              className="select input-sm"
              value={elegida}
              onChange={(evento) => setElegida(evento.target.value)}
              aria-label="Conexión de CI-DS"
            >
              {conexiones.map((conexion) => (
                <option key={conexion.id} value={conexion.id}>{conexion.name}</option>
              ))}
            </select>
          ) : (
            <span className="tag">{activa?.name}</span>
          )}
          {activa?.isProduction && <span className="tag tag-accent">Productivo</span>}
        </div>
      </div>

      {/* La clave fuerza a empezar de cero al cambiar de tenant: fechas y filtros son de la
          conexión que se estaba mirando, no del usuario. */}
      <TaskMonitor key={elegida} connectionId={elegida} />
    </div>
  )
}
