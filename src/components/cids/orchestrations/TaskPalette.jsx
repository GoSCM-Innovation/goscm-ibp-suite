// Las tareas del repositorio, para agregarlas al lienzo.
//
// Portada de `panel/TaskPalette.jsx` de v9: el título «Task Palette», los proyectos que se pueden
// fijar (📌) y filtrar, el panel que se contrae a una barra de 28 px, el asa para cambiarle el ancho
// y las tareas como chips que se arrastran al lienzo.
//
// Una diferencia a propósito: además de arrastrar, el chip se agrega con un clic. Arrastrar no
// funciona con el dedo —y el editor para teléfono es una pieza que pediste— así que el clic es lo
// que anda en los dos sitios. El paso aparece en un hueco libre y después se mueve, como cualquier
// otro.
//
// Las tareas se piden igual que en el lanzador: los proyectos primero, y las tareas de un proyecto
// cuando se abre. Pedirlas todas de entrada serían decenas de consultas para llenar una lista que
// casi nadie mira entera.

import { useEffect, useMemo, useRef, useState } from 'react'
import { cidsCall, isTaskPromoted } from '../../../lib/cids.js'
import {
  ANCHO_INICIAL,
  anchoDePaleta,
  guardarFijados,
  leerFijados,
  olvidarFijados,
  proyectosVisibles,
  tareasVisibles,
  textoDeTarea,
} from '../../../lib/paleta-tareas.js'
import PromotedBadge from '../PromotedBadge.jsx'
import './lista.css'

// `onAgregar` recibe los DATOS del paso, no la tarea: así el lienzo no sabe si lo que se le agrega
// es una tarea de CI-DS o un trabajo de IBP, y la misma pantalla sirve para los dos.
//
// `movil` es la paleta dentro del diálogo del teléfono: ocupa todo el ancho que le den, no se
// contrae, no tiene asa y sus chips no se arrastran.
export default function TaskPalette({
  destino, onAgregar, onAgregarGrupo, transportadas = null, movil = false,
}) {
  const [proyectos, setProyectos] = useState([])
  const [tareas, setTareas] = useState({})
  const [cargandoTareas, setCargandoTareas] = useState({})
  const [abierto, setAbierto] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [contraida, setContraida] = useState(false)
  const [ancho, setAncho] = useState(ANCHO_INICIAL)
  const [fijados, setFijados] = useState(() => leerFijados(destino.id))
  const [soloFijados, setSoloFijados] = useState(false)
  // Quita los oyentes del arrastre en curso si el panel se desmonta a mitad de moverlo.
  const soltarAsa = useRef(null)

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

  useEffect(() => () => soltarAsa.current?.(), [])

  function abrir(proyecto) {
    if (abierto === proyecto.guid) {
      setAbierto(null)
      return
    }
    setAbierto(proyecto.guid)
    if (tareas[proyecto.guid]) return

    setCargandoTareas((previas) => ({ ...previas, [proyecto.guid]: true }))
    cidsCall(destino, 'getProjectTasks', { projectGuid: proyecto.guid })
      .then((lista) => setTareas((previas) => ({ ...previas, [proyecto.guid]: Array.isArray(lista) ? lista : [] })))
      // Un proyecto que falla queda vacío y no rompe la paleta: los demás se siguen usando.
      .catch(() => setTareas((previas) => ({ ...previas, [proyecto.guid]: [] })))
      .finally(() => setCargandoTareas((previas) => ({ ...previas, [proyecto.guid]: false })))
  }

  function alternarFijado(evento, guid) {
    evento.stopPropagation()
    setFijados((previos) => {
      const siguientes = new Set(previos)
      if (siguientes.has(guid)) siguientes.delete(guid)
      else siguientes.add(guid)
      guardarFijados(destino.id, siguientes)
      return siguientes
    })
  }

  function limpiarFijados() {
    setFijados(new Set())
    setSoloFijados(false)
    olvidarFijados(destino.id)
  }

  function empezarArrastre(evento) {
    evento.preventDefault()
    const inicio = { x: evento.clientX, ancho }
    const mover = (otro) => setAncho(anchoDePaleta(inicio.ancho, otro.clientX - inicio.x))
    const soltar = () => {
      document.removeEventListener('mousemove', mover)
      document.removeEventListener('mouseup', soltar)
      soltarAsa.current = null
    }
    document.addEventListener('mousemove', mover)
    document.addEventListener('mouseup', soltar)
    soltarAsa.current = soltar
  }

  const visibles = useMemo(
    () => proyectosVisibles({ proyectos, tareas, fijados, soloFijados, busqueda }),
    [proyectos, tareas, fijados, soloFijados, busqueda],
  )
  const hayFijados = fijados.size > 0

  if (contraida && !movil) {
    return (
      <button
        type="button"
        className="paleta-contraida"
        onClick={() => setContraida(false)}
        title="Expandir panel de tasks"
      >
        <span className="paleta-contraida-texto">TASKS</span>
        <span className="paleta-contraida-flecha">›</span>
      </button>
    )
  }

  return (
    <div className={`paleta${movil ? ' paleta-movil' : ''}`} style={movil ? undefined : { width: ancho }}>
      {!movil && <div className="paleta-asa" onMouseDown={empezarArrastre} />}

      <div className="paleta-cabeza">
        <span className="paleta-titulo">Task Palette</span>
        <div className="paleta-botones">
          <button
            type="button"
            className={`paleta-pin${soloFijados ? ' on' : ''}${hayFijados ? ' hay' : ''}`}
            onClick={() => setSoloFijados((activo) => !activo)}
            title={soloFijados
              ? 'Mostrando solo proyectos fijados — clic para ver todos'
              : `Filtrar por proyectos fijados (${fijados.size})`}
            aria-pressed={soloFijados}
          >
            📌
            {hayFijados && <span className="paleta-pin-n">{fijados.size}</span>}
          </button>
          {!movil && (
            <button type="button" className="paleta-contraer" onClick={() => setContraida(true)} title="Contraer panel">
              ‹
            </button>
          )}
        </div>
      </div>

      <div className="paleta-buscar">
        <input
          type="text"
          className="input input-sm"
          placeholder="Buscar proyectos o tasks…"
          value={busqueda}
          onChange={(evento) => setBusqueda(evento.target.value)}
          aria-label="Buscar proyectos o tasks"
        />

        {soloFijados && hayFijados && (
          <div className="paleta-solo-fijados">
            <span>{fijados.size} proyecto{fijados.size !== 1 ? 's' : ''} fijado{fijados.size !== 1 ? 's' : ''}</span>
            <button type="button" onClick={limpiarFijados} title="Quitar todos los fijados">Limpiar</button>
          </div>
        )}
      </div>

      <div className="paleta-cuerpo">
        {error && <div className="notice notice-error" style={{ margin: 8 }}>✕ {error}</div>}
        {cargando && <div className="paleta-cargando">Cargando proyectos…</div>}

        {!cargando && visibles.length === 0 && (
          <div className="paleta-hueco">
            {soloFijados && hayFijados ? 'Sin proyectos fijados coincidentes' : 'Sin proyectos'}
          </div>
        )}

        {visibles.map((proyecto) => {
          const estaAbierto = abierto === proyecto.guid
          const esFijado = fijados.has(proyecto.guid)
          const cargandoEste = Boolean(cargandoTareas[proyecto.guid])
          const mostradas = tareasVisibles(tareas[proyecto.guid], busqueda)

          return (
            <div key={proyecto.guid}>
              <div className={`paleta-fila${estaAbierto ? ' open' : ''}`}>
                <button
                  type="button"
                  className={`paleta-proyecto${estaAbierto ? ' open' : ''}`}
                  onClick={() => abrir(proyecto)}
                  aria-expanded={estaAbierto}
                  title={proyecto.name}
                >
                  <span className="tree-caret">{cargandoEste ? '…' : estaAbierto ? '▾' : '▸'}</span>
                  <span className="paleta-proyecto-nombre">{proyecto.name || '—'}</span>
                </button>
                <button
                  type="button"
                  className={`paleta-fijar${esFijado ? ' on' : ''}`}
                  onClick={(evento) => alternarFijado(evento, proyecto.guid)}
                  title={esFijado ? 'Quitar de fijados' : 'Fijar proyecto'}
                  aria-pressed={esFijado}
                >
                  📌
                </button>
              </div>

              {estaAbierto && (
                <div className="paleta-tareas">
                  {mostradas.length === 0 && !cargandoEste ? (
                    <div className="tree-hueco">Sin tasks</div>
                  ) : mostradas.map((tarea) => (
                    <Chip
                      key={tarea.taskGuid || tarea.taskName}
                      tarea={tarea}
                      movil={movil}
                      promovida={isTaskPromoted(transportadas, tarea.taskName)}
                      onAgregar={onAgregar}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {onAgregarGrupo && (
        <div className="paleta-pie">
          <button
            type="button"
            className="paleta-grupo"
            onClick={onAgregarGrupo}
            title="Agregar un grupo: los pasos que metas dentro corren juntos"
          >
            + Nuevo grupo
          </button>
        </div>
      )}
    </div>
  )
}

/** Una tarea: se arrastra al lienzo, o se agrega con un clic (o con Enter, si se llega con el teclado). */
function Chip({ tarea, movil, promovida, onAgregar }) {
  const agregar = () => onAgregar({
    taskName: tarea.taskName,
    taskGuid: tarea.taskGuid ?? null,
    taskType: tarea.type ?? null,
    label: tarea.taskName,
    agentName: null,
    profileName: null,
    globalVariables: [],
  })

  function alEmpezarArrastre(evento) {
    evento.dataTransfer.effectAllowed = 'copy'
    evento.dataTransfer.setData('application/x-orch-task', JSON.stringify({
      taskName: tarea.taskName,
      taskGuid: tarea.taskGuid,
      type: tarea.type,
    }))
  }

  return (
    <div
      className="paleta-tarea"
      role="button"
      tabIndex={0}
      draggable={!movil}
      onDragStart={movil ? undefined : alEmpezarArrastre}
      onClick={agregar}
      onKeyDown={(evento) => {
        if (evento.key === 'Enter' || evento.key === ' ') {
          evento.preventDefault()
          agregar()
        }
      }}
      title={textoDeTarea(tarea)}
    >
      {!movil && <span className="paleta-grip">⠿</span>}
      <span className={`type-badge${tarea.type === 'PROCESS' ? ' process' : ''}`}>
        {tarea.type || 'TASK'}
      </span>
      {promovida && <PromotedBadge />}
      <span className="paleta-tarea-nombre">{tarea.taskName}</span>
      <span className="paleta-mas">+</span>
    </div>
  )
}
