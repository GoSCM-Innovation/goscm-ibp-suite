// Una tabla o un campo, y todas las integraciones que lo tocan.
//
// Es la vuelta al derecho de la vista por integración: en vez de "qué hace esta integración",
// contesta "quién usa este campo", que es la pregunta con la que se empieza cuando hay que cambiar
// algo en SAP y no se sabe qué se va a romper.

import { COLOR_DE_TIPO, dimensionPorId, filasPorIntegracion } from '../../../lib/integration-view.js'
import { ListaDeFiltros, Seccion, TablaDeMapeos } from './IntegrationDetail.jsx'

export default function DimensionDetail({ dimension, entrada, integraciones, onIrAIntegracion }) {
  if (!entrada) return <p className="exp-empty">Elige algo de la lista para ver quién lo usa.</p>

  const definicion = dimensionPorId(dimension)
  const esDeFiltro = definicion.fila === 'fIdx'
  // Una dimensión de origen se lee al revés: interesa de dónde sale, no a dónde va.
  const mostrarDestino = dimension !== 'src-table' && dimension !== 'src-field'

  const porIntegracion = filasPorIntegracion(entrada.filas, definicion.fila)

  return (
    <div className="exp-detail">
      <div className="exp-header-card">
        <div className="exp-h-title">{entrada.etiqueta}</div>
        <div className="exp-sub">
          {definicion.label} · lo usan {porIntegracion.length}
          {porIntegracion.length === 1 ? ' integración' : ' integraciones'}
        </div>
      </div>

      {porIntegracion.map(({ intIdx, indices }) => {
        const integracion = integraciones[intIdx]
        if (!integracion) return null

        const tipo = integracion.tipoIntegracion || 'MD'
        const dataflow = integracion.dataflowName && integracion.dataflowName !== integracion.jobName
          ? integracion.dataflowName
          : ''

        const titulo = (
          <span className="exp-dim-title">
            <span className="exp-type" style={{ background: COLOR_DE_TIPO[tipo] || 'var(--text3)' }}>{tipo}</span>
            {integracion.jobName}
            {dataflow && <span className="exp-sub">↳ {dataflow}</span>}
            <span className="exp-muted">{integracion._zipName}</span>
          </span>
        )

        return (
          <div className="exp-dim-block" key={intIdx}>
            <Seccion titulo={titulo} cantidad={indices.length}>
              {esDeFiltro
                ? <ListaDeFiltros filtros={indices.map((i) => integracion.filters[i]).filter(Boolean)} />
                : (
                  <TablaDeMapeos
                    mapeos={indices.map((i) => integracion.mappings[i]).filter(Boolean)}
                    mostrarDestino={mostrarDestino}
                  />
                )}
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => onIrAIntegracion(intIdx)}
              >
                Ver la integración completa →
              </button>
            </Seccion>
          </div>
        )
      })}
    </div>
  )
}
