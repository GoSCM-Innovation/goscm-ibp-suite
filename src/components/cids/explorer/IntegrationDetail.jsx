// Todo lo que se sabe de una integración: de dónde sale cada campo, qué filtra, qué busca y cómo
// se dibuja.
//
// Las secciones nacen ABIERTAS, como en v9, salvo el diagrama: no se carga hasta que se abre, porque
// su librería pesa y no tiene sentido descargarla para leer una tabla de mapeos.
//
// Los textos son los de v9 («Mappings», «Filtros», «Target:», «ZIP:», «Atrás»…): el texto portado
// manda sobre la preferencia de idioma.

import { Suspense, lazy, useState } from 'react'
import {
  COLOR_DE_TIPO,
  COLOR_DE_VIA,
  ICONO_DE_VIA,
  NOMBRE_DE_VIA,
  scriptsDe,
  vecinos,
} from '../../../lib/integration-view.js'
import AtlSection from './AtlSection.jsx'
import IbpJobsSection from './IbpJobsSection.jsx'

const DataflowDiagram = lazy(() => import('./DataflowDiagram.jsx'))

/**
 * Una sección plegable con su contador gris «(N)», como en v9.
 *
 * `derecha` es lo que va a la derecha de la cabecera, antes de la flecha: en el detalle de una
 * dimensión es el «N campos» y el «Ver» que lleva a la integración completa.
 */
export function Seccion({ titulo, cantidad, abiertaPorOmision = false, derecha = null, children }) {
  const [abierta, setAbierta] = useState(abiertaPorOmision)

  return (
    <div className="exp-section">
      <button type="button" className="exp-section-head" onClick={() => setAbierta((previo) => !previo)}>
        <span>
          {titulo}
          {cantidad !== undefined && <span className="exp-count-gris"> ({cantidad})</span>}
        </span>
        <span className="exp-section-derecha">
          {derecha}
          <span className="exp-arrow">{abierta ? '▼' : '▶'}</span>
        </span>
      </button>
      {abierta && <div className="exp-section-body">{children}</div>}
    </div>
  )
}

const ETIQUETA_DE_SCRIPT = { pre: 'Pre-load', post: 'Post-load' }

/**
 * Un script del job: si corre antes o después del dataflow, su nombre, su descripción y su código.
 * Un slot sin contenido se muestra igual, atenuado: CI-DS lo crea al abrir el editor de scripts.
 */
function ScriptDelJob({ script }) {
  const codigo = (script.expression || '').trim()
  return (
    <div className={`exp-script-item${codigo ? '' : ' is-empty'}`}>
      <div className="exp-script-head">
        <span className={`exp-script-kind${script.kind ? ` is-${script.kind}` : ''}`}>
          {ETIQUETA_DE_SCRIPT[script.kind] ?? 'Script'}
        </span>
        <span className="exp-script-name">{script.name || '—'}</span>
      </div>
      {script.description && <div className="exp-script-desc">{script.description}</div>}
      {codigo
        ? <pre className="exp-script-code">{codigo}</pre>
        : <p className="exp-script-empty">Slot de script definido pero sin contenido.</p>}
    </div>
  )
}

/** La tabla de mapeos. La comparten el detalle y la vista por dimensión. */
export function TablaDeMapeos({ mapeos, mostrarDestino = true, conInsigniaLookup = true }) {
  if (mapeos.length === 0) return <p className="exp-empty">Sin mappings</p>

  return (
    <div className="table-scroll">
      <table className="table-dense">
        <thead>
          <tr>
            {mostrarDestino
              ? <><th>Campo Destino</th><th>Origen</th><th>Transformación</th></>
              : <><th>Campo Origen</th><th>Campo Destino</th><th>Transformación</th></>}
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
                  {conInsigniaLookup && /\blookup\s*\(/i.test(uno.ops || '') && (
                    <div><span className="exp-lookup-badge">lookup</span></div>
                  )}
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
  if (filtros.length === 0) return <p className="exp-empty">Sin filtros</p>

  return filtros.map((uno, i) => (
    <div className="exp-filter" key={`${uno.expression.slice(0, 40)}-${i}`}>
      {uno.sourceTable && <div className="exp-filter-table">Tabla: {uno.sourceTable}</div>}
      <pre className="exp-expr">{uno.expression}</pre>
    </div>
  ))
}

/** El texto de la vía de una arista: la tabla, el archivo o el lookup que une las dos integraciones. */
const etiquetaDe = (arista) => arista.label ?? ''

/** Un salto a la integración vecina, con el color de la vía por la que están unidas. */
function Vecina({ arista, idxVecina, direccion, integraciones, transportadas, onIr }) {
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
      title={`${direccion} (${NOMBRE_DE_VIA[arista.via]}): ${etiquetaDe(arista)}${transportada ? ' · Promovido a producción' : ''}`}
    >
      <span aria-hidden="true">{ICONO_DE_VIA[arista.via]}</span>
      {transportada && <span className="exp-promoted" title="Promovido a producción">✓</span>}
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
  indiceDeJobs,
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
          <button type="button" className="btn btn-sm" onClick={onVolver} title="Volver al paso anterior">◀ Atrás</button>
          <button type="button" className="btn btn-sm" onClick={onInicio} title="Volver a la integración inicial">⌂ Inicio</button>
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
          Target: <b>{integracion.targetTable}</b>
          {integracion.fileLoaderFileName && <> · Archivo: <b>{integracion.fileLoaderFileName}</b></>}
        </div>
        <div className="exp-sub">ZIP: {integracion._zipName}</div>
      </div>

      {(entrantes.length > 0 || salientes.length > 0) && (
        <div className="exp-chains">
          {entrantes.length > 0 && (
            <>
              <div className="exp-chain-label">⬅ Alimentado por</div>
              <div className="exp-chain-row">
                {entrantes.map((una, i) => (
                  <Vecina
                    key={`in-${una.from}-${i}`}
                    arista={una}
                    direccion="Alimentado por"
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
                    direccion="Alimenta a"
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

      {indiceDeJobs && <IbpJobsSection jobName={integracion.jobName} indice={indiceDeJobs} />}

      {/* Los scripts pre/post-load van ARRIBA del diagrama, como en v9: corren fuera del dataflow y el
          preload es lo primero que ejecuta la tarea. Solo si el job tiene alguno, vacío o no. */}
      {scriptsDe(integracion).length > 0 && (
        <Seccion titulo="📜 Scripts pre/post-load" cantidad={scriptsDe(integracion).length} abiertaPorOmision>
          {scriptsDe(integracion).map((script, i) => <ScriptDelJob key={i} script={script} />)}
        </Seccion>
      )}

      {hayDiagrama && (
        <Seccion titulo="🗺️ Diagrama del DataFlow" cantidad={integracion.diagram.nodes.length}>
          <Suspense fallback={<div className="page-hint">Cargando el diagrama…</div>}>
            <DataflowDiagram
              diagrama={integracion.diagram}
              integracion={integracion}
              nombre={integracion.dataflowName || integracion.jobName}
            />
          </Suspense>
        </Seccion>
      )}

      <Seccion titulo="🗂️ Mappings" cantidad={integracion.mappings.length} abiertaPorOmision>
        <TablaDeMapeos mapeos={integracion.mappings} />
      </Seccion>

      <Seccion titulo="🔍 Filtros" cantidad={integracion.filters.length} abiertaPorOmision>
        <ListaDeFiltros filtros={integracion.filters} />
      </Seccion>

      {integracion.lookups.length > 0 && (
        <Seccion titulo="🔗 Lookups" cantidad={integracion.lookups.length} abiertaPorOmision>
          {integracion.lookups.map((uno, i) => (
            <div className="exp-lookup" key={`${uno.transform}-${i}`}>
              {uno.transform && <div className="exp-sub">Transform: {uno.transform}</div>}
              <pre className="exp-expr">{uno.func}</pre>
            </div>
          ))}
        </Seccion>
      )}

      {integracion.variables.length > 0 && (
        <Seccion titulo="⚙️ Variables" cantidad={integracion.variables.length} abiertaPorOmision>
          {integracion.variables.map((uno) => (
            <div className="exp-var" key={uno.name}>
              <span className="exp-var-name">{uno.name}</span>
              <span className="exp-var-value">{uno.value || <span className="exp-muted">(vacío)</span>}</span>
            </div>
          ))}
        </Seccion>
      )}
    </div>
  )
}
