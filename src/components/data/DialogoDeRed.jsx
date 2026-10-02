// Un `<dialog>` nativo abierto como modal, para los dos diálogos del Network Visualizer.
//
// v7 usaba `<dialog>` con `showModal()` para «Filtros de red» y para la pantalla completa, y se
// conserva: el navegador ya se encarga del fondo, del foco y de cerrar con Escape. Se monta ABIERTO y
// se desmonta para cerrar — quien lo usa decide con un estado, no con una llamada.
//
// `showModal` se llama en un efecto de layout, antes de que los hijos hagan sus efectos normales: el
// lienzo de la red mide su caja al crearse, y dentro de un `<dialog>` cerrado la caja mide cero.

import { useLayoutEffect, useRef } from 'react'

export default function DialogoDeRed({ onCerrar, etiqueta, className = '', children }) {
  const caja = useRef(null)

  useLayoutEffect(() => {
    const dialogo = caja.current
    if (!dialogo || dialogo.open) return
    // jsdom no implementa `showModal`; en un navegador siempre existe.
    if (typeof dialogo.showModal === 'function') dialogo.showModal()
    else dialogo.setAttribute('open', '')
  }, [])

  return (
    <dialog ref={caja} className={`nv-dialogo ${className}`.trim()} aria-label={etiqueta} onClose={onCerrar}>
      {children}
    </dialog>
  )
}
