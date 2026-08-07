// Todo lo que se sabe de una integración: de dónde sale cada campo, qué filtra, qué busca y cómo
// se dibuja.
//
// Las secciones nacen cerradas salvo los mapeos, que es lo que se viene a ver. El diagrama además
// no se carga hasta que se abre: su librería pesa y no tiene sentido descargarla para leer una tabla
// de mapeos.

import { Suspense, lazy, useState } from 'react'
import {
  COLOR_DE_TIPO,
  COLOR_DE_VIA,
  ICONO_DE_VIA,
  NOMBRE_DE_VIA,
  vecinos,
} from '../../../lib/integration-view.js'
import AtlSection from './AtlSection.jsx'

const DataflowDiagram = lazy(() => import('./DataflowDiagram.jsx'))

/** Una sección plegable con su contador. */
export function Seccion({ titulo, cantidad, abiertaPorOmision = false, children }) {
  const [abierta, setAbierta] = useState(abiertaPorOmision)

  return (
    <div className="exp-section">
      <button type="button" className="exp-section-head" onClick={() => setAbierta((previo) => !previo)}>
        <span>{titulo} {cantidad !== undefined && <span className="exp-count">{cantidad}</span>}</span>
        <span className="exp-arrow">{abierta ? '▼' : '▶'}</span>
      </button>
      {abierta && <div className="exp-section-body">{children}</div>}
    </div>
  )
}

/** La tabla de mapeos. La comparten el detalle y la vista por dimensión. */
export function TablaDeMapeos({ mapeos, mostrarDestino = true }) {
  if (mapeos.length === 0) return <p className="exp-empty">Esta integración no mapea ningún campo.</p>

  return (
    <div className="table-scroll">
      <table className="table-dense">
        <thead>
          <tr>
            {mostrarDestino
              ? <><th>Campo destino</th><th>Origen</th><th>Transformación</th></>
              : <><th>Origen</th><th>Campo destino</th><th>Transformación</th></>}
          </tr>
        </thead>
        <tbody>
          {mapeos.map((uno, i) => {
            const origen = [uno.srcDS, uno.srcTable, uno.srcField].filter(Boolean).join(' · ') || '—'
            const destino = (
              <td>
                <div className="exp-dst-field">{uno.dstField}</div>
                {(mostrarDestino ? uno.dstDesc : uno.dstTable) && (
                  <div className="exp-sub">{mostrarDestino ? uno.dstDesc : uno.dstTable}</div>
                )}
              </td>
            )

            return (
              <tr key={`${uno.dstField}-${i}`}>
                {mostrarDestino ? destino : <td className="exp-src">{origen}</td>}
                {mostrarDestino ? <td className="exp-src">{origen}</td> : destino}
                <td>
                  {uno.ops ? <code className="exp-ops">{uno.ops}</code> : <span className="exp-muted">—</span>}
                  {/\blookup\s*\(/i.test(uno.ops || '') && <div><span className="tag tag-muted">lookup</span></div>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** La lista de filtros. También compartida con la vista por dimensión. */
export function ListaDeFiltros({ filtros }) {
  if (filtros.length === 0) return <p className="exp-empty">Esta integración no filtra nada.</p>

  return filtros.map((uno, i) => (
    <div className="exp-filter" key={`${uno.expression.slice(0, 40)}-${i}`}>
      {uno.sourceTable && <div className="exp-filter-table">Tabla: {uno.sourceTable}</div>}
      <pre className="exp-expr">{uno.expression}</pre>
    </div>
  ))
}

/** Un salto a la integración vecina, con el color de la vía por la que están unidas. */
function Vecina({ arista, idxVecina, integraciones, transportadas, onIr }) {
  const otra = integraciones[idxVecina]
  if (!otra) return null

  const transportada = transportadas?.has((otra.jobName || '').toUpperCase())
  const dataflow = otra.dataflowName && otra.dataflowName !== otra.jobName ? otra.dataflowName : ''

  return (
    <button
      type="button"
      className="exp-chain-pill"
      style={{ borderColor: COLOR_DE_VIA[arista.via] }}
      onClick={() => onIr(idxVecina)}
      title={`Por ${NOMBRE_DE_VIA[arista.via]}: ${arista.label}`}
    >
      <span aria-hidden="true">{ICONO_DE_VIA[arista.via]}</span>
      {transportada && <span className="exp-promoted">✓</span>}
      <span className="exp-chain-task">{otra.jobName}</span>
      {dataflow && <span className="exp-sub">↳ {dataflow}</span>}
    </button>
  )
}

export default function IntegrationDetail({
  integracion,
  integraciones,
  cadenas,
  transportadas,
  atl,
  puedeVolver,
  onVolver,
  onInicio,
  onIr,
}) {
  const { entrantes, salientes } = vecinos(cadenas, integracion._idx)
  const tipo = integracion.tipoIntegracion || 'MD'
  const hayDiagrama = integracion.diagram?.nodes?.length > 0

  return (
    <div className="exp-detail">
      {puedeVolver && (
        <div className="exp-navbar">
          <button type="button" className="btn btn-sm" onClick={onVolver}>◀ Volver</button>
          <button type="button" className="btn btn-sm" onClick={onInicio}>⌂ Inicio</button>
        </div>
      )}

      <div className="exp-header-card">
        <div className="exp-h-title">
          <span className="exp-type" style={{ background: COLOR_DE_TIPO[tipo] || 'var(--text3)' }}>{tipo}</span>
          {integracion.jobName}
        </div>
        {integracion.dataflowName && integracion.dataflowName !== integracion.jobName && (
          <div className="exp-sub">↳ Dataflow: {integracion.dataflowName}</div>
        )}
        <div className="exp-h-flow">{integracion.srcDSName || '—'} → {integracion.dstDSName || '—'}</div>
        <div className="exp-sub">
          Destino: <b>{integracion.targetTable}</b>
          {integracion.fileLoaderFileName && <> · Archivo: <b>{integracion.fileLoaderFileName}</b></>}
        </div>
        <div className="exp-sub">
          Proyecto: {integracion._zipName}
          {integracion.planArea && <> · Área: {integracion.planArea}</>}
        </div>
      </div>

      {(entrantes.length > 0 || salientes.length > 0) && (
        <div className="exp-chains">
          {entrantes.length > 0 && (
            <>
              <div className="exp-chain-label">⬅ La alimentan</div>
              <div className="exp-chain-row">
                {entrantes.map((una, i) => (
                  <Vecina
                    key={`in-${una.from}-${i}`}
                    arista={una}
                    idxVecina={una.from}
                    integraciones={integraciones}
                    transportadas={transportadas}
                    onIr={onIr}
                  />
                ))}
              </div>
            </>
          )}
          {salientes.length > 0 && (
            <>
              <div className="exp-chain-label">➡ Alimenta a</div>
              <div className="exp-chain-row">
                {salientes.map((una, i) => (
                  <Vecina
                    key={`out-${una.to}-${i}`}
                    arista={una}
                    idxVecina={una.to}
                    integraciones={integraciones}
                    transportadas={transportadas}
                    onIr={onIr}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {atl && <AtlSection idx={integracion._idx} atl={atl} integraciones={integraciones} />}

      {hayDiagrama && (
        <Seccion titulo="🗺️ Diagrama del dataflow" cantidad={integracion.diagram.nodes.length}>
          <Suspense fallback={<div className="page-hint">Cargando el diagrama…</div>}>
            <DataflowDiagram diagrama={integracion.diagram} />
          </Suspense>
        </Seccion>
      )}

      <Seccion titulo="🗂️ Mapeos" cantidad={integracion.mappings.length} abiertaPorOmision>
        <TablaDeMapeos mapeos={integracion.mappings} />
      </Seccion>

      <Seccion titulo="🔍 Filtros y uniones" cantidad={integracion.filters.length}>
        <ListaDeFiltros filtros={integracion.filters} />
      </Seccion>

      {integracion.lookups.length > 0 && (
        <Seccion titulo="🔗 Lookups" cantidad={integracion.lookups.length}>
          {integracion.lookups.map((uno, i) => (
            <div className="exp-lookup" key={`${uno.transform}-${i}`}>
              {uno.transform && <div className="exp-sub">Transformación: {uno.transform}</div>}
              <pre className="exp-expr">{uno.func}</pre>
            </div>
          ))}
        </Seccion>
      )}

      {integracion.variables.length > 0 && (
        <Seccion titulo="⚙️ Variables" cantidad={integracion.variables.length}>
          {integracion.variables.map((uno) => (
            <div className="exp-var" key={uno.name}>
              <span className="exp-var-name">{uno.name}</span>
              <span className="exp-var-value">{uno.value || <span className="exp-muted">sin valor</span>}</span>
            </div>
          ))}
        </Seccion>
      )}
    </div>
  )
}
