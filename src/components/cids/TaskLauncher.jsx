// Proyectos y tareas de CI-DS: el árbol para encontrar una tarea y lanzarla.
//
// Portado de `src/components/Tasks/Tasks.jsx` de v9, incluidos los proyectos fijados, que es la
// pieza que lo hace usable: un tenant real tiene decenas de proyectos y siempre se trabaja con
// tres o cuatro.
//
// Las tareas de un proyecto se piden al abrirlo y quedan guardadas. Pedirlas todas de entrada
// serían decenas de consultas para mostrar algo que casi nadie mira entero.

import { useEffect, useMemo, useState } from 'react'
import { cidsCall, isTaskPromoted } from '../../lib/cids.js'
import PromotedBadge from './PromotedBadge.jsx'
import RunTaskModal from './RunTaskModal.jsx'

/** Los proyectos fijados se recuerdan por conexión: los de un tenant no son los de otro. */
const claveFijados = (connectionId) => `ibp.cids.pins.${connectionId}`

function leerFijados(connectionId) {
  try {
    const guardado = JSON.parse(localStorage.getItem(claveFijados(connectionId)) || '[]')
    return new Set(Array.isArray(guardado) ? guardado : [])
  } catch {
    return new Set()
  }
}

function guardarFijados(connectionId, fijados) {
  try {
    localStorage.setItem(claveFijados(connectionId), JSON.stringify([...fijados]))
  } catch {
    // Almacenamiento bloqueado: los fijados valen para esta visita y no se recuerdan.
  }
}

export default function TaskLauncher({ connectionId, onTaskLanzada, transportadas }) {
  const [proyectos, setProyectos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [intento, setIntento] = useState(0)

  const [abiertos, setAbiertos] = useState({})
  const [tareas, setTareas] = useState({})
  const [cargandoTareas, setCargandoTareas] = useState({})

  const [busqueda, setBusqueda] = useState('')
  const [fijados, setFijados] = useState(() => leerFijados(connectionId))
  const [soloFijados, setSoloFijados] = useState(false)
  const [lanzar, setLanzar] = useState(null)

  useEffect(() => {
    let abandonado = false
    cidsCall(connectionId, 'getProjects')
      .then((lista) => {
        if (abandonado) return
        setProyectos(Array.isArray(lista) ? lista : [])
        setError('')
        setCargando(false)
      })
      .catch((fallo) => {
        if (abandonado) return
        setError(fallo.message)
        setCargando(false)
      })
    return () => { abandonado = true }
  }, [connectionId, intento])

  function refrescar() {
    setCargando(true)
    setIntento((numero) => numero + 1)
  }

  function fijar(guid) {
    setFijados((previos) => {
      const siguientes = new Set(previos)
      if (siguientes.has(guid)) siguientes.delete(guid)
      else siguientes.add(guid)
      guardarFijados(connectionId, siguientes)
      return siguientes
    })
  }

  function limpiarFijados() {
    setFijados(new Set())
    setSoloFijados(false)
    guardarFijados(connectionId, new Set())
  }

  function abrir(proyecto) {
    const guid = proyecto.guid
    if (abiertos[guid]) {
      setAbiertos((previos) => ({ ...previos, [guid]: false }))
      return
    }
    setAbiertos((previos) => ({ ...previos, [guid]: true }))
    if (tareas[guid]) return

    setCargandoTareas((previos) => ({ ...previos, [guid]: true }))
    cidsCall(connectionId, 'getProjectTasks', { projectGuid: guid })
      .then((lista) => setTareas((previos) => ({ ...previos, [guid]: Array.isArray(lista) ? lista : [] })))
      // Un proyecto que falla queda como vacío y no rompe el árbol: los otros se siguen usando.
      .catch(() => setTareas((previos) => ({ ...previos, [guid]: [] })))
      .finally(() => setCargandoTareas((previos) => ({ ...previos, [guid]: false })))
  }

  const visibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()

    const coincide = (proyecto) => {
      if (!texto) return true
      if ((proyecto.name || '').toLowerCase().includes(texto)) return true
      // Solo encuentra tareas de proyectos ya abiertos, porque de los cerrados todavía no se
      // sabe qué tienen. Igual que en v9.
      return (tareas[proyecto.guid] ?? []).some((tarea) => (tarea.taskName || '').toLowerCase().includes(texto))
    }

    return proyectos
      .filter((proyecto) => coincide(proyecto) && (!soloFijados || fijados.has(proyecto.guid)))
      .sort((a, b) => {
        // Los fijados arriba y, dentro de cada grupo, por nombre.
        const fijadoA = fijados.has(a.guid) ? 1 : 0
        const fijadoB = fijados.has(b.guid) ? 1 : 0
        if (fijadoA !== fijadoB) return fijadoB - fijadoA
        return (a.name || '').localeCompare(b.name || '')
      })
  }, [proyectos, tareas, busqueda, soloFijados, fijados])

  return (
    <div className="monitor">
      <div className={`progress-line${cargando ? ' on' : ''}`} />

      <div className="monitor-head">
        <div className="monitor-meta">
          {cargando ? 'Cargando proyectos…' : `${visibles.length} de ${proyectos.length} proyectos`}
        </div>

        <div className="monitor-bar">
          <input
            type="search"
            className="input input-sm"
            style={{ width: 220 }}
            placeholder="Buscar proyecto o tarea…"
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
            aria-label="Buscar proyecto o tarea"
          />
          <button
            type="button"
            className={`btn btn-sm${soloFijados ? ' btn-primary' : ''}`}
            onClick={() => setSoloFijados((activo) => !activo)}
            disabled={fijados.size === 0 && !soloFijados}
            title={fijados.size === 0 ? 'Todavía no fijaste ningún proyecto' : 'Mostrar solo los fijados'}
          >
            {soloFijados ? '★' : '☆'} Solo fijados{fijados.size > 0 ? ` (${fijados.size})` : ''}
          </button>
          {fijados.size > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={limpiarFijados}>
              Limpiar
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={refrescar} disabled={cargando}>↺ Actualizar</button>
        </div>
      </div>

      {error && <div className="notice notice-error">✕ {error}</div>}

      <div className="tree">
        {visibles.length === 0 && !cargando ? (
          <div className="table-empty">
            {busqueda
              ? `Nada que coincida con "${busqueda}".`
              : soloFijados
                ? 'Ningún proyecto fijado coincide.'
                : 'Este tenant no tiene proyectos.'}
          </div>
        ) : visibles.map((proyecto) => (
          <Proyecto
            key={proyecto.guid}
            proyecto={proyecto}
            abierto={Boolean(abiertos[proyecto.guid])}
            cargando={Boolean(cargandoTareas[proyecto.guid])}
            tareas={tareas[proyecto.guid]}
            fijado={fijados.has(proyecto.guid)}
            busqueda={busqueda}
            transportadas={transportadas}
            onAbrir={() => abrir(proyecto)}
            onFijar={() => fijar(proyecto.guid)}
            onEjecutar={setLanzar}
          />
        ))}
      </div>

      {lanzar && (
        <RunTaskModal
          connectionId={connectionId}
          task={lanzar}
          onClose={() => setLanzar(null)}
          onLanzada={(nombre) => { setLanzar(null); onTaskLanzada(nombre) }}
        />
      )}
    </div>
  )
}

function Proyecto({ proyecto, abierto, cargando, tareas, fijado, busqueda, transportadas, onAbrir, onFijar, onEjecutar }) {
  const texto = busqueda.trim().toLowerCase()
  const suyas = tareas ?? []
  const mostradas = texto
    ? suyas.filter((tarea) => (tarea.taskName || '').toLowerCase().includes(texto))
    : suyas

  return (
    <div className="tree-group">
      <div className={`tree-project${abierto ? ' open' : ''}`}>
        <button
          type="button"
          className={`tree-pin${fijado ? ' on' : ''}`}
          onClick={onFijar}
          title={fijado ? 'Quitar de fijados' : 'Fijar este proyecto'}
          aria-pressed={fijado}
        >
          {fijado ? '★' : '☆'}
        </button>

        <button type="button" className="tree-open" onClick={onAbrir} aria-expanded={abierto}>
          <span className="tree-caret">{cargando ? '…' : abierto ? '▾' : '▸'}</span>
          <span className="tree-name">{proyecto.name || '—'}</span>
          {proyecto.description && <span className="tree-desc">— {proyecto.description}</span>}
          {abierto && suyas.length > 0 && (
            <span className="tree-count">{suyas.length} tareas</span>
          )}
        </button>
      </div>

      {abierto && (
        <div className="tree-tasks">
          {mostradas.length === 0 && !cargando ? (
            <div className="tree-hueco">
              {suyas.length === 0 ? 'Este proyecto no tiene tareas.' : 'Ninguna tarea coincide con la búsqueda.'}
            </div>
          ) : mostradas.map((tarea, indice) => (
            <div className="tree-task" key={tarea.taskGuid || indice}>
              <span className={`type-badge${tarea.type === 'PROCESS' ? ' process' : ''}`}>
                {tarea.type || 'TASK'}
              </span>
              {isTaskPromoted(transportadas, tarea.taskName) && <PromotedBadge />}
              <div className="tree-task-what">
                <div className="tree-task-name" title={tarea.taskName || ''}>{tarea.taskName || '—'}</div>
                {tarea.description && <div className="tree-task-desc">{tarea.description}</div>}
              </div>
              <button type="button" className="btn btn-sm btn-run" onClick={() => onEjecutar(tarea)}>
                ▶ Ejecutar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
