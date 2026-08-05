// El módulo CI-DS Tools: elegir el tenant y moverse entre sus herramientas.
//
// Equivale a `SystemView.jsx` de v9, sin dos cosas que allí ocupaban la mitad del archivo: el
// diálogo para identificarse contra SAP y el aviso de "sesión vencida". Las dos desaparecen porque
// la sesión vive en el servidor y se renueva sola cuando SAP la rechaza.

import { Suspense, lazy, useEffect, useState } from 'react'
import { fetchPromotedTaskNames, listCidsConnections } from '../../lib/cids.js'
import TaskMonitor from './TaskMonitor.jsx'
import TaskLauncher from './TaskLauncher.jsx'

// El tablero se carga aparte, solo cuando se abre su pestaña. Es el único que usa la librería de
// gráficos, y esa librería pesa más que todo el resto de la aplicación junta: dejarla en el paquete
// principal se la haría descargar hasta a quien solo entra a ver el monitor.
const Summary = lazy(() => import('./Summary.jsx'))

// El orden es el de v9: se entra por el resumen, que es la pantalla que contesta "¿cómo venimos?"
// antes de que nadie tenga que buscar una ejecución concreta.
const HERRAMIENTAS = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'monitor', label: 'Monitor de tareas' },
  { id: 'tareas', label: 'Proyectos y tareas' },
]

export default function CidsTools() {
  const [conexiones, setConexiones] = useState(null)
  const [elegida, setElegida] = useState('')
  const [error, setError] = useState('')
  const [herramienta, setHerramienta] = useState('resumen')

  // La búsqueda del monitor vive acá arriba y no dentro del monitor. Es lo que permite que al
  // lanzar una tarea se salte al monitor ya filtrado por ella —lo que hacía v9— sin que el monitor
  // tenga que enterarse de que existe el lanzador.
  const [busqueda, setBusqueda] = useState('')

  // Qué tareas de este tenant ya están en producción. Se pide una vez por conexión y se comparte
  // entre las herramientas que la usan: armarla le cuesta al repositorio productivo una consulta por
  // proyecto, así que pedirla por pantalla sería pagarla dos veces. `null` = la comparación no aplica.
  const [transportadas, setTransportadas] = useState(null)

  useEffect(() => {
    if (!elegida) return undefined
    let abandonado = false
    fetchPromotedTaskNames(elegida)
      .then((nombres) => { if (!abandonado) setTransportadas(nombres) })
      // Que falle no rompe nada: es una marca de más, no un dato del que dependa una decisión.
      .catch(() => { if (!abandonado) setTransportadas(null) })
    return () => { abandonado = true }
  }, [elegida])

  useEffect(() => {
    listCidsConnections()
      .then((lista) => {
        setConexiones(lista)
        // Con una sola conexión no hay nada que elegir: se entra directo.
        if (lista.length > 0) setElegida(lista[0].id)
      })
      .catch((fallo) => { setError(fallo.message); setConexiones([]) })
  }, [])

  if (conexiones === null) return <div className="page-hint">Cargando conexiones…</div>
  if (error) return <div className="notice notice-error">✕ {error}</div>

  if (conexiones.length === 0) {
    return (
      <div className="notice notice-info">
        No hay ninguna conexión a CI-DS configurada para tu empresa. Pedile a quien administra la
        cuenta que la dé de alta en Administración → Conexiones.
      </div>
    )
  }

  const activa = conexiones.find((conexion) => conexion.id === elegida)

  function verEnMonitor(taskName) {
    setBusqueda(taskName)
    setHerramienta('monitor')
  }

  return (
    <div className="module-page">
      <div className="module-head">
        <div>
          <div className="page-title">CI-DS Tools</div>
          <div className="page-hint">Ejecuciones, proyectos y tareas del tenant.</div>
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

      {/* La clave fuerza a empezar de cero al cambiar de tenant: fechas, filtros y proyectos
          abiertos son de la conexión que se estaba mirando, no del usuario.

          Cada herramienta se monta y se desmonta al cambiar de pestaña, igual que en v9. La
          alternativa —dejarlas montadas y solo esconderlas— haría que el monitor y el resumen
          siguieran consultando a SAP en sus relojes mientras mirás otra cosa. */}
      {herramienta === 'resumen' && (
        <Suspense fallback={<div className="page-hint">Cargando el tablero…</div>}>
          <Summary key={`resumen-${elegida}`} connectionId={elegida} />
        </Suspense>
      )}
      {herramienta === 'monitor' && (
        <TaskMonitor
          key={`monitor-${elegida}`}
          connectionId={elegida}
          busqueda={busqueda}
          onBuscar={setBusqueda}
          transportadas={transportadas}
        />
      )}
      {herramienta === 'tareas' && (
        <TaskLauncher
          key={`tareas-${elegida}`}
          connectionId={elegida}
          onTaskLanzada={verEnMonitor}
          transportadas={transportadas}
        />
      )}
    </div>
  )
}
