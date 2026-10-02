// Lo que se dice de un nodo al pulsarlo: su tipo, su código, su nombre y, si es un proveedor, qué
// materiales abastece.
//
// Portado de `_vizNodeDetailHtml` de `visualizer.js` de v7. Aquí NO está lo que una versión anterior
// añadió —«Le llega de / Manda a» y el plazo de producción—: v7 no lo tenía, y el plazo ya sale en el
// globo de ayuda de la planta.

import { CLASES, insumosDeProveedor } from '../../../core/ibp/supply-network.js'
import { INSIGNIA_DE_CLASE, NOMBRE_DE_CLASE } from '../../lib/clases-de-red.js'

/**
 * `nodo` es un nodo de `armarRed`. `filas` son las filas de la red cargada (para los insumos del
 * proveedor) y `descripciones` un mapa código → descripción de material, del catálogo.
 */
export default function DetalleDeNodo({ nodo, filas, descripciones }) {
  const insumos = nodo.clase === CLASES.proveedor && filas ? insumosDeProveedor(nodo.id, filas) : []

  return (
    <>
      <span className={`badge ${INSIGNIA_DE_CLASE[nodo.clase] ?? 'badge-comp'}`}>
        {NOMBRE_DE_CLASE[nodo.clase] ?? nodo.clase}
      </span>
      {' '}
      <strong className="nv-detalle-id">{nodo.id}</strong>
      {nodo.titulo && nodo.titulo !== nodo.id && (
        <>
          <br />
          <span className="nv-detalle-titulo">{nodo.titulo}</span>
        </>
      )}

      {insumos.length > 0 && (
        <div className="nv-detalle-insumos">
          <div className="nv-detalle-insumos-titulo">Insumos abastecidos ({insumos.length}):</div>
          <div className="nv-detalle-chips">
            {insumos.map((codigo) => (
              <span key={codigo} className="nv-detalle-chip">
                {codigo}
                {descripciones?.[codigo] && (
                  <>{' '}<span className="nv-detalle-chip-descr">{descripciones[codigo]}</span></>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
