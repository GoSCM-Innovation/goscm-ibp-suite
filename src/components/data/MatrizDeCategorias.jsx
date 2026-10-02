// El cuerpo del paso ③ «Categorizar tipos de material»: una matriz de interruptores, tipos en filas y
// las cuatro categorías en columnas.
//
// Portado de `mattyeRenderCategorize` y `_mattypeCatBindTooltips` de `mattype-config.js` de v7. Es de
// presentación pura: recibe SOLO los tipos incluidos (los excluidos no se categorizan) y avisa cada
// vez que se marca o desmarca una casilla.
//
// Los textos de las categorías no se repiten aquí: vienen de `TEXTOS_DE_CATEGORIA`, que son los mismos
// que usan la hoja Resumen del Excel y el glosario. Si se copiaran, el tooltip y el Excel dirían
// cosas distintas el día que alguien corrija una regla en un solo sitio.
//
// EL TOOLTIP FLOTANTE. La matriz vive dentro de un panel con `overflow` (el scroll horizontal), y un
// tooltip posicionado dentro de ella quedaría recortado. v7 lo resolvía creando un `<div>` colgado de
// `<body>` al pasar el ratón; en React eso es un portal. La posición es la de v7: 240 px de ancho,
// centrado sobre el «?», sin salirse a menos de 8 px de los bordes, encima del «?» salvo que no quepa
// —entonces, debajo—. Se calcula con el alto REAL del tooltip, por eso se mide antes de pintar.

import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MATTYPE_CATS, TEXTOS_DE_CATEGORIA } from '../../../core/ibp/mattype-config.js'

const ANCHO_DEL_TOOLTIP = 240
const MARGEN = 8

/** El tooltip de una categoría, colgado de `<body>` y colocado según el «?» sobre el que está el ratón. */
function TooltipDeCategoria({ textos, ancla }) {
  const caja = useRef(null)

  // `useLayoutEffect` y no `useEffect`: hay que medir el alto del tooltip YA pintado en el DOM para
  // decidir si cabe arriba, y colocarlo antes de que el navegador lo dibuje; con `useEffect` se vería
  // un destello en la esquina superior izquierda.
  useLayoutEffect(() => {
    const tip = caja.current
    if (!tip) return
    let izquierda = ancla.left + ancla.width / 2 - ANCHO_DEL_TOOLTIP / 2
    izquierda = Math.max(MARGEN, Math.min(izquierda, window.innerWidth - ANCHO_DEL_TOOLTIP - MARGEN))
    let arriba = ancla.top - tip.offsetHeight - 10
    if (arriba < MARGEN) arriba = ancla.bottom + 10
    tip.style.left = `${izquierda}px`
    tip.style.top = `${arriba}px`
  }, [ancla])

  return createPortal(
    <div id="mattype-floating-tooltip" ref={caja}>
      <div className="mattype-cat-tooltip-title">{textos.label}</div>
      <div>{textos.desc}</div>
      <ul className="mattype-cat-tooltip-rules">
        {textos.rules.map((regla) => <li key={regla}>{regla}</li>)}
      </ul>
      <div className="mattype-cat-tooltip-ex">Ej: {textos.example}</div>
    </div>,
    document.body,
  )
}

/**
 * @param {object}  props
 * @param {Array<{ tipo: string, productos: number, categorias: string[] }>} props.tipos
 *        Solo los incluidos, ya ordenados.
 * @param {(tipo: string, categoriaId: string, marcado: boolean) => void} props.onAlternar
 */
export default function MatrizDeCategorias({ tipos, onAlternar }) {
  // Qué categoría tiene el ratón encima y dónde está su «?» (el rectángulo, para colocar el tooltip).
  const [tooltip, setTooltip] = useState(null)

  if (!tipos?.length) {
    return <p className="mattype-empty">No hay tipos incluidos para categorizar.</p>
  }

  return (
    <>
      <div className="mattype-matrix-scroll">
        <table className="mattype-matrix-table">
          <thead>
            <tr>
              <th className="mattype-matrix-th-type">Tipo</th>
              <th className="mattype-matrix-th-count">Productos</th>
              {MATTYPE_CATS.map((cat) => (
                <th key={cat.id} className="mattype-matrix-th-cat" style={{ color: cat.color }}>
                  {TEXTOS_DE_CATEGORIA[cat.id].label}
                  <span
                    className="mattype-cat-help"
                    onMouseEnter={(evento) => setTooltip({ id: cat.id, ancla: evento.currentTarget.getBoundingClientRect() })}
                    onMouseLeave={() => setTooltip(null)}
                  >
                    ?
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tipos.map(({ tipo, productos, categorias }) => (
              <tr key={tipo}>
                <td><span className="mattype-code">{tipo}</span></td>
                <td className="mattype-col-count">{productos || 0} prods</td>
                {MATTYPE_CATS.map((cat) => (
                  <td key={cat.id} className="mattype-matrix-cell">
                    <label className="mattype-toggle" data-cat={cat.id}>
                      <input
                        type="checkbox"
                        checked={categorias.includes(cat.id)}
                        onChange={(evento) => onAlternar(tipo, cat.id, evento.target.checked)}
                      />
                      <span className="mattype-toggle-slider" />
                    </label>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mattype-note">ℹ️ Un tipo puede estar en más de una categoría. Sin categoría = todas las métricas con reglas en modo 🟡.</p>

      {tooltip && <TooltipDeCategoria textos={TEXTOS_DE_CATEGORIA[tooltip.id]} ancla={tooltip.ancla} />}
    </>
  )
}
