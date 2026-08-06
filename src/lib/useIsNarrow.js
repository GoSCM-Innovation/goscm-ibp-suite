// ¿Estamos en una pantalla angosta?
//
// Se usa para decidir entre el lienzo y el editor en lista. No alcanza con CSS: son dos componentes
// distintos, no el mismo con otro aspecto — el lienzo carga una librería de dibujo entera que en el
// teléfono no sirve para nada.
//
// Portado del `useViewport` de v9.

import { useEffect, useState } from 'react'

/** El mismo corte que usa el resto de los estilos para apilar en vez de poner columnas. */
export const ANCHO_ANGOSTO = 720

const consultar = () => (
  typeof matchMedia === 'function' ? matchMedia(`(max-width: ${ANCHO_ANGOSTO}px)`) : null
)

export function useIsNarrow() {
  const [angosta, setAngosta] = useState(() => consultar()?.matches ?? false)

  useEffect(() => {
    const medio = consultar()
    if (!medio) return undefined
    const alCambiar = (evento) => setAngosta(evento.matches)
    medio.addEventListener('change', alCambiar)
    return () => medio.removeEventListener('change', alCambiar)
  }, [])

  return angosta
}
