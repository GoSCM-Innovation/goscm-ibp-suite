// Una tabla o un campo, y todas las integraciones que lo tocan.
//
// Es la vuelta al derecho de la vista por integración: en vez de "qué hace esta integración",
// contesta "quién usa este campo", que es la pregunta con la que se empieza cuando hay que cambiar
// algo en SAP y no se sabe qué se va a romper.
//
// La forma y los textos son los de v9: arriba el título (con el datastore si es una tabla), la línea
// «<dimensión> · N mapeos · M integraciones» y el botón «⧉ Copiar» de las tareas; y debajo un bloque
// plegado por integración, con su «N campos» y el «Ver» que lleva a la integración completa.

import { COLOR_DE_TIPO, dimensionPorId, filasPorIntegracion } from '../../../lib/integration-view.js'
import BotonCopiar from '../../ui/BotonCopiar.jsx'
import { ListaDeFiltros, Seccion, TablaDeMapeos } from './IntegrationDetail.jsx'

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`

export default function DimensionDetail({
  dimension, entrada, integraciones, onIrAIntegracion, onCopiarTareas,
}) {
  if (!entrada) return <p className="exp-empty">Selecciona un elemento a la izquierda</p>

  const definicion = dimensionPorId(dimension)
  const esDeFiltro = definicion.fila === 'fIdx'
  const esCampo = dimension.endsWith('-field')
  // Una dimensión de origen se lee al revés: interesa de dónde sale, no a dónde va.
  const mostrarDestino = dimension !== 'src-table' && dimension !== 'src-field'

  const porIntegracion = filasPorIntegracion(entrada.filas, definicion.fila)
  if (porIntegracion.length === 0) return <p className="exp-empty">Sin datos para esta clave</p>

  const [datastore, tabla] = entrada.clave.split('::')
  const titulo = esCampo ? entrada.clave : (tabla || entrada.clave)
  const unidades = esDeFiltro
    ? plural(entrada.filas.length, 'filtro', 'filtros')
    : plural(entrada.filas.length, 'mapeo', 'mapeos')

  return (
    <div className="exp-detail">
      <div className="exp-header-card">
        <BotonCopiar
          className="exp-copy-detalle"
          titulo="Copiar listado de tareas (formato tabla)"
          onCopiar={onCopiarTareas}
        />
        <div className="exp-h-title">{titulo}</div>
        {!esCampo && datastore && <div className="exp-h-flow">Datastore: {datastore}</div>}
        <div className="exp-sub">
          {definicion.icono} {definicion.label} · {unidades} · {plural(porIntegracion.length, 'integración', 'integraciones')}
        </div>
      </div>

      {porIntegracion.map(({ intIdx, indices }) => {
        const integracion = integraciones[intIdx]
        if (!integracion) return null

        const tipo = integracion.tipoIntegracion || 'MD'
        const dataflow = integracion.dataflowName && integracion.dataflowName !== integracion.jobName
          ? integracion.dataflowName
          : ''

        const cabecera = (
          <span className="exp-dim-title">
            <span className="exp-type" style={{ '--tipo': COLOR_DE_TIPO[tipo] || 'var(--text3)' }}>{tipo}</span>
            {integracion.jobName}
            {dataflow && <span className="exp-sub">↳ {dataflow}</span>}
            <span className="exp-muted">{integracion._zipName}</span>
          </span>
        )

        // v9 escribe «campo(s)» también en las dimensiones de tabla, y «filtro(s)» en las de filtro.
        const cuenta = esDeFiltro
          ? plural(indices.length, 'filtro', 'filtros')
          : plural(indices.length, 'campo', 'campos')

        const derecha = (
          <>
            <span className="exp-muted">{cuenta}</span>
            <span
              role="button"
              tabIndex={0}
              className="exp-chain-pill"
              title="Ver integracion completa"
              onClick={(evento) => { evento.stopPropagation(); onIrAIntegracion(intIdx) }}
              onKeyDown={(evento) => {
                if (evento.key === 'Enter' || evento.key === ' ') {
                  evento.preventDefault()
                  evento.stopPropagation()
                  onIrAIntegracion(intIdx)
                }
              }}
            >
              Ver
            </span>
          </>
        )

        return (
          <div className="exp-dim-block" key={intIdx}>
            <Seccion titulo={cabecera} derecha={derecha}>
              {esDeFiltro
                ? <ListaDeFiltros filtros={indices.map((i) => integracion.filters[i]).filter(Boolean)} />
                : (
                  <TablaDeMapeos
                    mapeos={indices.map((i) => integracion.mappings[i]).filter(Boolean)}
                    mostrarDestino={mostrarDestino}
                    conInsigniaLookup={false}
                  />
                )}
            </Seccion>
          </div>
        )
      })}
    </div>
  )
}
