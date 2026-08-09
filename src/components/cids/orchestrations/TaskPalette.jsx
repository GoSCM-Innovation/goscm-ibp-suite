// Las tareas del repositorio, para agregarlas al lienzo.
//
// Portada de `panel/TaskPalette.jsx` de v9, con una diferencia: allí se arrastraba una tarea al
// lienzo y aquí se hace clic. Arrastrar se ve mejor en una demostración, pero no funciona con el
// dedo —y el editor para teléfono es una pieza que pediste— así que el clic es lo que anda en los
// dos sitios. El paso aparece en un hueco libre y después se mueve arrastrando, como cualquier otro.
//
// Las tareas se piden igual que en el lanzador: los proyectos primero, y las tareas de un proyecto
// cuando se abre. Pedirlas todas de entrada serían decenas de consultas para llenar una lista que
// casi nadie mira entera.

import { useEffect, useMemo, useState } from 'react'
import { cidsCall } from '../../../lib/cids.js'

// `onAgregar` recibe los DATOS del paso, no la tarea: así el lienzo no sabe si lo que se le agrega
// es una tarea de CI-DS o un trabajo de IBP, y la misma pantalla sirve para los dos.
export default function TaskPalette({ destino, onAgregar, onAgregarGrupo }) {
  const [proyectos, setProyectos] = useState([])
  const [tareas, setTareas] = useState({})
  const [abierto, setAbierto] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    let abandonado = false
    cidsCall(destino, 'getProjects')
      .then((lista) => {
        if (abandonado) return
        setProyectos(Array.isArray(lista) ? lista : [])
        setCargando(false)
      })
      .catch((fallo) => {
        if (abandonado) return
        setError(fallo.message)
        setCargando(false)
      })
    return () => { abandonado = true }
  }, [destino])

  function abrir(proyecto) {
    if (abierto === proyecto.guid) {
      setAbierto(null)
      return
    }
    setAbierto(proyecto.guid)
    if (tareas[proyecto.guid]) return

    cidsCall(destino, 'getProjectTasks', { projectGuid: proyecto.guid })
      .then((lista) => setTareas((previas) => ({ ...previas, [proyecto.guid]: Array.isArray(lista) ? lista : [] })))
      // Un proyecto que falla queda vacío y no rompe la paleta: los demás se siguen usando.
      .catch(() => setTareas((previas) => ({ ...previas, [proyecto.guid]: [] })))
  }

  const visibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()
    if (!texto) return proyectos
    return proyectos.filter((proyecto) => (
      (proyecto.name || '').toLowerCase().includes(texto)
      // Igual que en el lanzador: solo encuentra tareas de proyectos ya abiertos.
      || (tareas[proyecto.guid] ?? []).some((tarea) => (tarea.taskName || '').toLowerCase().includes(texto))
    ))
  }, [proyectos, tareas, busqueda])

  return (
    <div className="paleta">
      <div className="paleta-cabeza">
        <span className="filtro-titulo">Tareas</span>
        {onAgregarGrupo && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onAgregarGrupo}
            title="Agregar un grupo: los pasos que metas dentro corren juntos"
          >
            + Grupo
          </button>
        )}
      </div>

      <div className="paleta-buscar">
        <input
          type="search"
          className="input input-sm"
          placeholder="Buscar…"
          value={busqueda}
          onChange={(evento) => setBusqueda(evento.target.value)}
          aria-label="Buscar tarea"
        />
      </div>

      <div className="paleta-cuerpo">
        {error && <div className="notice notice-error" style={{ margin: 8 }}>✕ {error}</div>}
        {cargando && <div className="page-hint" style={{ padding: 12 }}>Cargando proyectos…</div>}

        {!cargando && visibles.length === 0 && (
          <div className="page-hint" style={{ padding: 12 }}>
            {busqueda ? 'Nada que coincida.' : 'Este repositorio no tiene proyectos.'}
          </div>
        )}

        {visibles.map((proyecto) => {
          const texto = busqueda.trim().toLowerCase()
          const suyas = tareas[proyecto.guid] ?? []
          const mostradas = texto
            ? suyas.filter((tarea) => (tarea.taskName || '').toLowerCase().includes(texto))
            : suyas

          return (
            <div key={proyecto.guid}>
              <button
                type="button"
                className={`paleta-proyecto${abierto === proyecto.guid ? ' open' : ''}`}
                onClick={() => abrir(proyecto)}
                aria-expanded={abierto === proyecto.guid}
              >
                <span className="tree-caret">{abierto === proyecto.guid ? '▾' : '▸'}</span>
                <span className="paleta-proyecto-nombre">{proyecto.name || '—'}</span>
              </button>

              {abierto === proyecto.guid && (
                <div className="paleta-tareas">
                  {mostradas.length === 0 ? (
                    <div className="tree-hueco">
                      {suyas.length === 0 ? 'Sin tareas.' : 'Ninguna coincide.'}
                    </div>
                  ) : mostradas.map((tarea) => (
                    <button
                      key={tarea.taskGuid || tarea.taskName}
                      type="button"
                      className="paleta-tarea"
                      onClick={() => onAgregar({
                      taskName: tarea.taskName,
                      taskGuid: tarea.taskGuid ?? null,
                      taskType: tarea.type ?? null,
                      label: tarea.taskName,
                      agentName: null,
                      profileName: null,
                      globalVariables: [],
                    })}
                      title={`Agregar "${tarea.taskName}" al lienzo`}
                    >
                      <span className={`type-badge${tarea.type === 'PROCESS' ? ' process' : ''}`}>
                        {tarea.type || 'TASK'}
                      </span>
                      <span className="paleta-tarea-nombre">{tarea.taskName}</span>
                      <span className="paleta-mas">+</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
