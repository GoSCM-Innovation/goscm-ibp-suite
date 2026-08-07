// La lista vista al revés: por proceso de CI-DS y en el orden en que corre.
//
// Portado de `renderAtlProcessMaster` de `explorer.js` de v9. Es la vista que contesta "¿qué hace
// este proceso, en qué orden?" en vez de "¿qué hace esta integración?".
//
// Los dataflows que el ATL declara pero que no están en los ZIP cargados se muestran igual, marcados
// como faltantes: que el proceso llame a algo que no se cargó es justamente lo que hay que ver.

import { useState } from 'react'

import { COLOR_DE_VIA, NOMBRE_DE_VIA } from '../../../lib/integration-view.js'

/** Las flechitas de cadena de una integración. */
function Cadenas({ cadenas, idx }) {
  const propias = cadenas.filter((una) => una.from === idx || una.to === idx)
  if (propias.length === 0) return null

  return (
    <span className="exp-chain-marks">
      {propias.map((una, i) => (
        <span
          key={`${una.from}-${una.to}-${i}`}
          style={{ color: COLOR_DE_VIA[una.via] }}
          title={`${una.to === idx ? 'Alimentada' : 'Alimenta'} por ${NOMBRE_DE_VIA[una.via]}`}
        >
          {una.to === idx ? '⬅' : '➡'}
        </span>
      ))}
    </span>
  )
}

/** Un proceso, con sus grupos en orden de ejecución. */
function Proceso({ titulo, subtitulo, children }) {
  const [abierto, setAbierto] = useState(true)

  return (
    <div className="exp-project">
      <button type="button" className="exp-project-head" onClick={() => setAbierto((previo) => !previo)}>
        <span>{titulo} <span className="exp-count">{subtitulo}</span></span>
        <span className="exp-arrow">{abierto ? '▼' : '▶'}</span>
      </button>
      {abierto && children}
    </div>
  )
}

export default function AtlProcessMaster({
  atl,
  integraciones,
  visibles,
  cadenas,
  enConflicto,
  soloConflictos,
  seleccion,
  onElegir,
}) {
  const puedeVerse = new Set(visibles.map((una) => una._idx))
  const porIdx = new Map(integraciones.map((una) => [una._idx, una]))

  const fila = (idx) => {
    const integracion = porIdx.get(idx)
    if (!integracion || !puedeVerse.has(idx)) return null
    if (soloConflictos && !enConflicto?.has(idx)) return null

    return (
      <button
        key={idx}
        type="button"
        className={`exp-item child${seleccion === idx ? ' active' : ''}`}
        onClick={() => onElegir(idx)}
      >
        <span className="exp-item-name">
          {enConflicto?.has(idx) && <span className="exp-warn" title="Choca con el orden real de ejecución">⚠</span>}
          ↳ {integracion.dataflowName || integracion.targetTable}
          <Cadenas cadenas={cadenas} idx={idx} />
        </span>
        <span className="exp-item-sub">{integracion.targetTable}</span>
      </button>
    )
  }

  const procesos = atl.procesos.map((proceso, procesoIdx) => {
    // Un proceso sin capa de planes tiene un único grupo sin nombre: repetir su cabecera sobra.
    const sinGrupos = proceso.grupos.length === 1 && !proceso.grupos[0].nombre

    const grupos = proceso.grupos.map((grupo, grupoIdx) => {
      const cuerpo = grupo.dataflows.map((dataflow, i) => {
        if (!dataflow.falta) return fila(dataflow.idx)
        if (soloConflictos) return null
        return (
          <div className="exp-item child exp-falta" key={`falta-${i}`} title="El proceso lo llama, pero no está en los ZIP cargados">
            <span className="exp-item-name">↳ {dataflow.displayName || 'sin nombre'}</span>
            <span className="tag tag-muted">no está en los ZIP</span>
          </div>
        )
      }).filter(Boolean)

      if (cuerpo.length === 0) return null
      if (sinGrupos) return cuerpo

      return (
        <div key={`${grupo.nombre}-${grupoIdx}`}>
          <div className="exp-atl-group-head">
            {grupo.nombre || 'Sin grupo'}
            <span className={`tag ${grupo.parallel ? 'tag-accent' : 'tag-muted'}`}>
              {grupo.parallel ? 'en paralelo' : 'secuencial'}
            </span>
          </div>
          {cuerpo}
        </div>
      )
    }).filter(Boolean)

    if (grupos.length === 0) return null

    return (
      <Proceso
        key={`${proceso.archivo}-${procesoIdx}`}
        titulo={proceso.session}
        subtitulo={`${proceso.emparejados}/${proceso.declarados}`}
      >
        {grupos}
      </Proceso>
    )
  }).filter(Boolean)

  const sueltas = soloConflictos
    ? []
    : atl.huerfanas.map((idx) => fila(idx)).filter(Boolean)

  if (procesos.length === 0 && sueltas.length === 0) {
    return <p className="exp-empty">No hay nada que coincida.</p>
  }

  return (
    <div className="exp-master-list">
      {procesos}
      {sueltas.length > 0 && (
        <Proceso titulo="Sin proceso de CI-DS" subtitulo={sueltas.length}>{sueltas}</Proceso>
      )}
    </div>
  )
}
