// La lista de la izquierda: las integraciones agrupadas, o las claves de la dimensión abierta.
//
// Se agrupa por proyecto y dentro por tarea, como en CI-DS. Una tarea con un solo dataflow se
// muestra como una fila: agrupar algo que no tiene hermanos solo agrega un clic.

import { useState } from 'react'
import { COLOR_DE_TIPO, COLOR_DE_VIA, NOMBRE_DE_VIA, agruparParaLista } from '../../../lib/integration-view.js'

/** La etiqueta de tipo (MD / KF / FILE) con su color. */
function Tipo({ tipo }) {
  const valor = tipo || 'MD'
  return (
    <span className="exp-type" style={{ background: COLOR_DE_TIPO[valor] || 'var(--text3)' }}>{valor}</span>
  )
}

/**
 * Las flechitas de cadena: una por integración que la alimenta y una por cada una a la que alimenta.
 *
 * Sirven para ver de un vistazo, sin abrir nada, qué partes del proyecto están encadenadas.
 */
function Cadenas({ cadenas, idxs }) {
  const entrantes = cadenas.filter((una) => idxs.has(una.to))
  const salientes = cadenas.filter((una) => idxs.has(una.from))
  if (entrantes.length === 0 && salientes.length === 0) return null

  return (
    <span className="exp-chain-marks">
      {entrantes.map((una, i) => (
        <span
          key={`in-${una.from}-${una.to}-${i}`}
          style={{ color: COLOR_DE_VIA[una.via] }}
          title={`Alimentada por ${NOMBRE_DE_VIA[una.via]}`}
        >
          ⬅
        </span>
      ))}
      {salientes.map((una, i) => (
        <span
          key={`out-${una.from}-${una.to}-${i}`}
          style={{ color: COLOR_DE_VIA[una.via] }}
          title={`Alimenta por ${NOMBRE_DE_VIA[una.via]}`}
        >
          ➡
        </span>
      ))}
    </span>
  )
}

/** Una integración suelta, o un dataflow dentro de una tarea con varios. */
function Fila({ integracion, activa, esHija, transportada, cadenas, onElegir }) {
  const nombre = esHija ? (integracion.dataflowName || integracion.targetTable) : integracion.jobName

  return (
    <button
      type="button"
      className={`exp-item${activa ? ' active' : ''}${esHija ? ' child' : ''}`}
      onClick={() => onElegir(integracion._idx)}
    >
      <span className="exp-item-name">
        {!esHija && <Tipo tipo={integracion.tipoIntegracion} />}
        {transportada && <span className="exp-promoted" title="Ya está en el repositorio productivo">✓</span>}
        {esHija ? `↳ ${nombre}` : nombre}
        <Cadenas cadenas={cadenas} idxs={new Set([integracion._idx])} />
      </span>
      {!esHija && integracion.dataflowName && integracion.dataflowName !== integracion.jobName && (
        <span className="exp-item-sub">↳ {integracion.dataflowName}</span>
      )}
      <span className="exp-item-sub">{integracion.targetTable}</span>
    </button>
  )
}

/** Una tarea con varios dataflows: se abre y se cierra. */
function Tarea({ tarea, seleccion, transportadas, cadenas, onElegir }) {
  const contieneLaElegida = tarea.dataflows.some((una) => una._idx === seleccion)
  const [abierta, setAbierta] = useState(contieneLaElegida)

  if (tarea.dataflows.length === 1) {
    const [unica] = tarea.dataflows
    return (
      <Fila
        integracion={unica}
        activa={seleccion === unica._idx}
        esHija={false}
        transportada={transportadas?.has((unica.jobName || '').toUpperCase())}
        cadenas={cadenas}
        onElegir={onElegir}
      />
    )
  }

  const idxs = new Set(tarea.dataflows.map((una) => una._idx))

  return (
    <div className="exp-task">
      <button type="button" className="exp-task-head" onClick={() => setAbierta((previo) => !previo)}>
        <span className="exp-item-name">
          <Tipo tipo={tarea.dataflows[0].tipoIntegracion} />
          {transportadas?.has((tarea.jobName || '').toUpperCase()) && (
            <span className="exp-promoted" title="Ya está en el repositorio productivo">✓</span>
          )}
          {tarea.jobName}
          <span className="exp-count">{tarea.dataflows.length}</span>
          <Cadenas cadenas={cadenas} idxs={idxs} />
        </span>
        <span className="exp-arrow">{abierta || contieneLaElegida ? '▼' : '▶'}</span>
      </button>

      {(abierta || contieneLaElegida) && tarea.dataflows.map((una) => (
        <Fila
          key={una._idx}
          integracion={una}
          activa={seleccion === una._idx}
          esHija
          transportada={false}
          cadenas={cadenas}
          onElegir={onElegir}
        />
      ))}
    </div>
  )
}

/** Un proyecto: solo se dibuja su cabecera cuando hay más de uno cargado. */
function Proyecto({ proyecto, unico, seleccion, transportadas, cadenas, onElegir }) {
  const contieneLaElegida = proyecto.tareas.some((una) => una.dataflows.some((otra) => otra._idx === seleccion))
  const [abierto, setAbierto] = useState(true)

  const tareas = proyecto.tareas.map((una) => (
    <Tarea
      key={`${proyecto.zip}-${una.jobName}`}
      tarea={una}
      seleccion={seleccion}
      transportadas={transportadas}
      cadenas={cadenas}
      onElegir={onElegir}
    />
  ))

  if (unico) return tareas

  return (
    <div className="exp-project">
      <button type="button" className="exp-project-head" onClick={() => setAbierto((previo) => !previo)}>
        <span>{proyecto.nombre} <span className="exp-count">{proyecto.total}</span></span>
        <span className="exp-arrow">{abierto || contieneLaElegida ? '▼' : '▶'}</span>
      </button>
      {(abierto || contieneLaElegida) && tareas}
    </div>
  )
}

export default function ExplorerMaster({
  dimension,
  integraciones,
  entradas,
  cadenas,
  transportadas,
  seleccion,
  claveElegida,
  onElegirIntegracion,
  onElegirClave,
}) {
  if (dimension !== 'integracion') {
    if (entradas.length === 0) return <p className="exp-empty">No hay nada que coincida.</p>

    return (
      <div className="exp-dim-list">
        {entradas.map((una) => (
          <button
            key={una.clave}
            type="button"
            className={`exp-item${claveElegida === una.clave ? ' active' : ''}`}
            onClick={() => onElegirClave(una.clave)}
          >
            <span className="exp-item-name">
              {una.etiqueta}
              <span className="exp-count">{una.filas.length}</span>
            </span>
          </button>
        ))}
      </div>
    )
  }

  if (integraciones.length === 0) return <p className="exp-empty">No hay nada que coincida.</p>

  const proyectos = agruparParaLista(integraciones)

  return (
    <div className="exp-master-list">
      {proyectos.map((uno) => (
        <Proyecto
          key={uno.zip}
          proyecto={uno}
          unico={proyectos.length === 1}
          seleccion={seleccion}
          transportadas={transportadas}
          cadenas={cadenas}
          onElegir={onElegirIntegracion}
        />
      ))}
    </div>
  )
}
