// La lista de la izquierda: las integraciones agrupadas, o las claves de la dimensión abierta.
//
// Se agrupa por proyecto (ZIP) y dentro por tarea, como en CI-DS. Una tarea con un solo dataflow se
// muestra como una fila: agrupar algo que no tiene hermanos solo agrega un clic.
//
// El orden de la primera línea de cada fila es el de v9: tipo · ✓ promovida · IBP · 📜 · nombre ·
// flechas de cadena · ⚠ de conflicto. Y los textos también (el texto portado manda sobre el idioma).

import { useEffect, useRef, useState } from 'react'
import { claveDeTarea } from '../../../lib/ibp.js'
import {
  COLOR_DE_TIPO, COLOR_DE_VIA, agruparParaLista, dimensionPorId, tieneScripts,
} from '../../../lib/integration-view.js'

const TITULO_DE_PROMOVIDA = 'Promovido a producción'
const TITULO_DEL_CONFLICTO =
  'Posible conflicto entre la cadena de datos detectada y el orden de ejecución declarado en el ATL.'

/** La etiqueta de tipo (MD / KF / FILE) con su color. */
function Tipo({ tipo }) {
  const valor = tipo || 'MD'
  return (
    <span className="exp-type" style={{ background: COLOR_DE_TIPO[valor] || 'var(--text3)' }}>{valor}</span>
  )
}

/**
 * Las flechitas de cadena: una por integración que la alimenta (⬅) y una por cada una a la que
 * alimenta (➡), con el color de la vía. Sirven para ver de un vistazo qué partes están encadenadas.
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
          title={`Alimentado por (${una.via})`}
        >
          ⬅
        </span>
      ))}
      {salientes.map((una, i) => (
        <span
          key={`out-${una.from}-${una.to}-${i}`}
          style={{ color: COLOR_DE_VIA[una.via] }}
          title={`Alimenta a (${una.via})`}
        >
          ➡
        </span>
      ))}
    </span>
  )
}

/** La insignia 📜: el job tiene un script pre/post-load con contenido. De v9 (`ex-script-badge`). */
function InsigniaDeScript() {
  return (
    <span className="exp-script-badge" title="El job tiene un script pre/post-load con contenido">📜</span>
  )
}

/** La insignia IBP: algún Application Job de IBP ejecuta esta tarea. De v9 (`ex-ibp-badge`). */
function InsigniaDeIbp() {
  return <span className="exp-ibp-badge" title="🔌 SAP IBP · Jobs y Steps">IBP</span>
}

const estaEnIbp = (indiceDeJobs, jobName) => Boolean(
  indiceDeJobs && (indiceDeJobs[claveDeTarea(jobName)]?.length ?? 0) > 0,
)

const AvisoDeConflicto = () => <span className="exp-warn" title={TITULO_DEL_CONFLICTO}>⚠</span>

/** Una integración suelta, o un dataflow dentro de una tarea con varios. */
function Fila({ integracion, activa, esHija, transportada, enIbp, choca, cadenas, onElegir }) {
  const nombre = esHija ? (integracion.dataflowName || integracion.targetTable) : integracion.jobName

  return (
    <button
      type="button"
      className={`exp-item${activa ? ' active' : ''}${esHija ? ' child' : ''}`}
      onClick={() => onElegir(integracion._idx)}
    >
      <span className="exp-item-name">
        {!esHija && <Tipo tipo={integracion.tipoIntegracion} />}
        {!esHija && transportada && <span className="exp-promoted" title={TITULO_DE_PROMOVIDA}>✓</span>}
        {!esHija && enIbp && <InsigniaDeIbp />}
        {!esHija && tieneScripts(integracion) && <InsigniaDeScript />}
        {esHija ? `↳ ${nombre}` : nombre}
        <Cadenas cadenas={cadenas} idxs={new Set([integracion._idx])} />
        {choca && <AvisoDeConflicto />}
      </span>
      {!esHija && integracion.dataflowName && integracion.dataflowName !== integracion.jobName && (
        <span className="exp-item-sub exp-item-df">↳ {integracion.dataflowName}</span>
      )}
      <span className="exp-item-sub">{integracion.targetTable}</span>
    </button>
  )
}

/** Una tarea con varios dataflows: se abre y se cierra. */
function Tarea({ tarea, seleccion, transportadas, indiceDeJobs, enConflicto, cadenas, onElegir }) {
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
        enIbp={estaEnIbp(indiceDeJobs, unica.jobName)}
        choca={enConflicto?.has(unica._idx)}
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
            <span className="exp-promoted" title={TITULO_DE_PROMOVIDA}>✓</span>
          )}
          {estaEnIbp(indiceDeJobs, tarea.jobName) && <InsigniaDeIbp />}
          {tarea.dataflows.some(tieneScripts) && <InsigniaDeScript />}
          {tarea.jobName}
          <span className="exp-count">{tarea.dataflows.length}</span>
          <Cadenas cadenas={cadenas} idxs={idxs} />
          {tarea.dataflows.some((una) => enConflicto?.has(una._idx)) && <AvisoDeConflicto />}
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
          enIbp={false}
          choca={enConflicto?.has(una._idx)}
          cadenas={cadenas}
          onElegir={onElegir}
        />
      ))}
    </div>
  )
}

/**
 * Un proyecto: solo se dibuja su cabecera cuando hay más de uno cargado.
 *
 * Como en v9 nace PLEGADO, salvo el que contiene la integración elegida, y su cabecera dice
 * «nombre (N)» en mayúsculas.
 */
function Proyecto({ proyecto, unico, seleccion, transportadas, indiceDeJobs, enConflicto, cadenas, onElegir }) {
  const contieneLaElegida = proyecto.tareas.some((una) => una.dataflows.some((otra) => otra._idx === seleccion))
  const [abierto, setAbierto] = useState(contieneLaElegida)

  const tareas = proyecto.tareas.map((una) => (
    <Tarea
      key={`${proyecto.zip}-${una.jobName}`}
      tarea={una}
      seleccion={seleccion}
      transportadas={transportadas}
      indiceDeJobs={indiceDeJobs}
      enConflicto={enConflicto}
      cadenas={cadenas}
      onElegir={onElegir}
    />
  ))

  if (unico) return tareas

  return (
    <div className="exp-project">
      <button type="button" className="exp-project-head" onClick={() => setAbierto((previo) => !previo)}>
        <span>{proyecto.nombre} ({proyecto.total})</span>
        <span className="exp-arrow">{abierto || contieneLaElegida ? '▼' : '▶'}</span>
      </button>
      {(abierto || contieneLaElegida) && tareas}
    </div>
  )
}

/** «1 integración» / «3 integraciones»: las unidades de v9 (`ex.unit.*`). */
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`

/** El renglón de abajo de una clave de dimensión, como lo arma v9 (`renderMasterDimItems`). */
function subtituloDeClave(dimension, entrada) {
  const definicion = dimensionPorId(dimension)
  const esCampo = dimension.endsWith('-field')
  const esFiltro = definicion.fila === 'fIdx'
  const integraciones = new Set(entrada.filas.map((una) => una.intIdx)).size
  const integracionesTxt = plural(integraciones, 'integración', 'integraciones')

  if (esCampo) {
    const usos = esFiltro
      ? plural(entrada.filas.length, 'filtro', 'filtros')
      : plural(entrada.filas.length, 'uso', 'usos')
    return `${usos} · ${integracionesTxt}`
  }

  const [datastore] = entrada.clave.split('::')
  if (esFiltro) return `${integracionesTxt} · ${plural(entrada.filas.length, 'filtro', 'filtros')}`
  return `${datastore ? `${datastore} · ` : ''}${integracionesTxt} · ${plural(entrada.filas.length, 'mapeo', 'mapeos')}`
}

/** El nombre de una clave: el campo, o la parte «tabla» de `DATASTORE::TABLA`. */
const nombreDeClave = (entrada) => (
  entrada.clave.includes('::') ? entrada.clave.split('::')[1] || entrada.clave : entrada.clave
)

export default function ExplorerMaster({
  dimension,
  integraciones,
  entradas,
  cadenas,
  transportadas,
  indiceDeJobs = null,
  enConflicto,
  seleccion,
  claveElegida,
  onElegirIntegracion,
  onElegirClave,
}) {
  const lista = useRef(null)

  // Lo elegido tiene que verse: con una lista larga, saltar a una vecina lo deja fuera de la caja.
  // Es el `scrollIntoView` de v9 con `block: nearest`, que no mueve nada si ya está a la vista.
  useEffect(() => {
    lista.current?.querySelector('.exp-item.active')?.scrollIntoView?.({ block: 'nearest' })
  }, [seleccion, claveElegida, dimension])

  if (dimension !== 'integracion') {
    if (entradas.length === 0) return <p className="exp-empty">Sin resultados</p>

    return (
      <div className="exp-dim-list" ref={lista}>
        {entradas.map((una) => (
          <button
            key={una.clave}
            type="button"
            className={`exp-item${claveElegida === una.clave ? ' active' : ''}`}
            onClick={() => onElegirClave(una.clave)}
          >
            <span className="exp-item-name">{nombreDeClave(una)}</span>
            <span className="exp-item-sub">{subtituloDeClave(dimension, una)}</span>
          </button>
        ))}
      </div>
    )
  }

  if (integraciones.length === 0) return <p className="exp-empty">No se encontraron integraciones</p>

  const proyectos = agruparParaLista(integraciones)

  return (
    <div className="exp-master-list" ref={lista}>
      {proyectos.map((uno) => (
        <Proyecto
          key={uno.zip}
          proyecto={uno}
          unico={proyectos.length === 1}
          seleccion={seleccion}
          transportadas={transportadas}
          indiceDeJobs={indiceDeJobs}
          enConflicto={enConflicto}
          cadenas={cadenas}
          onElegir={onElegirIntegracion}
        />
      ))}
    </div>
  )
}
