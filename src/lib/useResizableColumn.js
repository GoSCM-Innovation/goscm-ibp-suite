// Ensanchar la columna de la izquierda arrastrando su borde.
//
// Portado de `initMasterResizer` de `explorer.js` de v9. Hace falta de verdad: los nombres de tarea
// de un proyecto real pasan de los cuarenta caracteres y con el ancho por omisión no se leen.
//
// El ancho se recuerda entre sesiones, porque quien lo ajusta lo hace una vez y espera encontrarlo
// así la próxima.

import { useCallback, useEffect, useRef, useState } from 'react'

/** Entre estos dos valores. Más angosto no se lee nada; más ancho no deja sitio al detalle. */
export const ANCHO = { minimo: 200, maximo: 620, porOmision: 300 }

const acotar = (valor) => Math.min(ANCHO.maximo, Math.max(ANCHO.minimo, Math.round(valor)))

/** Lee el ancho guardado. Si no hay o es basura, el de siempre. */
function anchoGuardado(clave) {
  try {
    const guardado = Number(window.localStorage.getItem(clave))
    return Number.isFinite(guardado) && guardado > 0 ? acotar(guardado) : ANCHO.porOmision
  } catch {
    // Sin almacenamiento —modo privado, por ejemplo— se usa el de siempre y no pasa nada.
    return ANCHO.porOmision
  }
}

/**
 * Devuelve el ancho de la columna y lo que hay que poner en el borde para poder arrastrarlo.
 *
 * `contenedorRef` tiene que apuntar al elemento que contiene las dos columnas: el ancho se mide
 * desde su borde izquierdo, no desde el de la ventana.
 */
export function useResizableColumn(clave = 'exp-ancho-columna') {
  const contenedorRef = useRef(null)
  const [ancho, setAncho] = useState(() => anchoGuardado(clave))
  const [arrastrando, setArrastrando] = useState(false)

  useEffect(() => {
    if (!arrastrando) return undefined

    const alMover = (evento) => {
      const caja = contenedorRef.current?.getBoundingClientRect()
      if (caja) setAncho(acotar(evento.clientX - caja.left))
    }
    const alSoltar = () => setArrastrando(false)

    document.addEventListener('pointermove', alMover)
    document.addEventListener('pointerup', alSoltar)
    // Mientras se arrastra, el cursor y la ausencia de selección son del documento entero: si no,
    // pasar por encima del texto de la lista lo selecciona y el arrastre se siente roto.
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('pointermove', alMover)
      document.removeEventListener('pointerup', alSoltar)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [arrastrando])

  // Se guarda al terminar de arrastrar, no en cada píxel.
  useEffect(() => {
    if (arrastrando) return
    try { window.localStorage.setItem(clave, String(ancho)) } catch { /* sin almacenamiento */ }
  }, [arrastrando, ancho, clave])

  /** El teclado también mueve el borde: con el ratón solo, no es accesible. */
  const alTeclear = useCallback((evento) => {
    const paso = evento.shiftKey ? 50 : 10
    if (evento.key === 'ArrowLeft') { evento.preventDefault(); setAncho((previo) => acotar(previo - paso)) }
    if (evento.key === 'ArrowRight') { evento.preventDefault(); setAncho((previo) => acotar(previo + paso)) }
    if (evento.key === 'Home') { evento.preventDefault(); setAncho(ANCHO.porOmision) }
  }, [])

  return {
    contenedorRef,
    ancho,
    arrastrando,
    propiedadesDelBorde: {
      role: 'separator',
      'aria-orientation': 'vertical',
      'aria-label': 'Ancho de la lista',
      'aria-valuenow': ancho,
      'aria-valuemin': ANCHO.minimo,
      'aria-valuemax': ANCHO.maximo,
      tabIndex: 0,
      onPointerDown: (evento) => { evento.preventDefault(); setArrastrando(true) },
      onDoubleClick: () => setAncho(ANCHO.porOmision),
      onKeyDown: alTeclear,
    },
  }
}
