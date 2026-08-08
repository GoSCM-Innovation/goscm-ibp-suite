// El módulo IBP Tools: elegir el tenant y moverse entre sus herramientas.
//
// Equivale a `SystemView.jsx` de v8, sin lo que la Fase 1 ya reemplazó: el diálogo para
// identificarse contra SAP, la barra lateral y la pantalla de conexiones.
//
// En v8 las pestañas aparecían según qué acuerdo de comunicación tuviera configurada la conexión.
// Esa idea se conserva —una pestaña que no puede funcionar es peor que una pestaña ausente— pero se
// resolverá cuando estén portadas las que dependen de los otros acuerdos. Por ahora todas las de
// aquí usan `SAP_COM_0068`.

import { lazy, Suspense, useEffect, useState } from 'react'

import { listIbpConnections } from '../../lib/ibp.js'

const JobMonitor = lazy(() => import('./JobMonitor.jsx'))

const HERRAMIENTAS = [
  { id: 'monitor', label: 'Monitor de trabajos' },
]

export default function IbpTools() {
  const [conexiones, setConexiones] = useState(null)
  const [elegida, setElegida] = useState('')
  const [error, setError] = useState('')
  const [herramienta, setHerramienta] = useState('monitor')

  useEffect(() => {
    let abandonado = false
    listIbpConnections()
      .then((lista) => {
        if (abandonado) return
        setConexiones(lista)
        if (lista.length > 0) setElegida(lista[0].id)
      })
      .catch((fallo) => {
        if (abandonado) return
        setError(fallo.message)
        setConexiones([])
      })
    return () => { abandonado = true }
  }, [])

  if (conexiones === null) return <div className="page-hint">Cargando conexiones…</div>
  if (error) return <div className="notice notice-error">✕ {error}</div>

  if (conexiones.length === 0) {
    return (
      <div className="notice notice-info">
        No hay ninguna conexión a SAP IBP configurada para tu empresa. Pedile a quien administra la
        cuenta que la dé de alta en Administración → Conexiones.
      </div>
    )
  }

  const conexion = conexiones.find((una) => una.id === elegida) ?? null

  return (
    <div className="module-page">
      <div className="module-head">
        <div>
          <div className="page-title">IBP Tools</div>
          <div className="page-hint">Los Application Jobs del tenant elegido.</div>
        </div>

        <div className="monitor-bar">
          <select
            className="select input-sm"
            value={elegida}
            onChange={(evento) => setElegida(evento.target.value)}
            aria-label="Tenant de IBP"
          >
            {conexiones.map((una) => (
              <option key={una.id} value={una.id}>{una.name}</option>
            ))}
          </select>
          {conexion?.isProduction && <span className="tag tag-accent">Productivo</span>}
        </div>
      </div>

      <div className="tabs">
        {HERRAMIENTAS.map((una) => (
          <button
            key={una.id}
            type="button"
            className={`tab${herramienta === una.id ? ' active' : ''}`}
            onClick={() => setHerramienta(una.id)}
            aria-pressed={herramienta === una.id}
          >
            {una.label}
          </button>
        ))}
      </div>

      {/* La clave fuerza a empezar de cero al cambiar de tenant: el rango, los filtros y la fila
          elegida son del tenant que se estaba mirando. */}
      {herramienta === 'monitor' && conexion && (
        <Suspense fallback={<div className="page-hint">Cargando el monitor…</div>}>
          <JobMonitor key={conexion.id} conexionId={conexion.id} />
        </Suspense>
      )}
    </div>
  )
}
