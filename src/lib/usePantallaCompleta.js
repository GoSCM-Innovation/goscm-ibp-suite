// Ver una tabla o un grafo a pantalla completa.
//
// Portado de `bomToggleFullscreen` de `bom.js` de v7 y de sus hermanos en `visualizer.js`,
// `snWebView.js` y `explorer.js`, más los de v8 (`DataGrid`, los dos visores, `OrchBuilder`) y v9
// (el lienzo de orquestaciones). Estaba en las OCHO pantallas de datos de los tres proyectos y en
// ninguna de aquí, que es la clase de hueco que no se ve en un inventario de archivos: vivía dentro
// de archivos que el inventario daba por portados.
//
// No es un adorno. Son las pantallas de una tabla de sesenta columnas y de un grafo de trescientos
// nodos: en un panel de media pantalla, con la barra y el menú al lado, son otra herramienta.
//
// Se usa la API del navegador y no un panel superpuesto con CSS, que es lo que hacía v9. Dos razones:
// es lo que hacían v7 y v8, y el navegador ya se encarga de salir con Escape — un panel de CSS obliga
// a escuchar la tecla, y a acertar con el apilamiento contra la barra y el menú del armazón.

import { useCallback, useEffect, useState } from 'react'

/** Si este navegador sabe ponerse a pantalla completa. En jsdom, no. */
const disponible = () => typeof document !== 'undefined'
  && typeof document.documentElement?.requestFullscreen === 'function'

/**
 * Pone a pantalla completa el elemento de `ref`.
 *
 * `activa` se sigue del evento del navegador y no de nuestro propio estado, porque hay más de una
 * forma de salir —Escape, F11, el botón—: si nos fiáramos de lo que pulsamos, el botón acabaría
 * diciendo «Salir» con la pantalla ya normal.
 */
export function usePantallaCompleta(ref) {
  const [activa, setActiva] = useState(false)

  useEffect(() => {
    if (!disponible()) return undefined
    const alCambiar = () => setActiva(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', alCambiar)
    return () => document.removeEventListener('fullscreenchange', alCambiar)
  }, [])

  const alternar = useCallback(() => {
    if (!disponible()) return
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => { /* Salir y no poder no deja nada roto. */ })
      return
    }
    // Si el navegador se niega —falta el gesto, o está prohibido en este contexto— no se hace nada y
    // la pantalla sigue funcionando igual. No es un error que valga la pena contarle a nadie.
    ref.current?.requestFullscreen?.().catch(() => {})
  }, [ref])

  return { activa, alternar, disponible: disponible() }
}
