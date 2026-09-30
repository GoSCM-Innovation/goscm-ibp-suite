// Repetir algo cada `delay` ms, pero SOLO mientras la pestaña del navegador se ve. Portado tal cual
// de `hooks/useVisibleInterval.js` de v8.
//
// Con la pestaña oculta el temporizador se para: nadie mira, y consultar a SAP de fondo es gasto.
// Al volver, se ejecuta UNA vez en el acto —lo que hay en pantalla puede tener minutos— y el
// temporizador sigue. Con `delay` nulo no se repite nada.

import { useEffect, useRef } from 'react'

export function useVisibleInterval(callback, delay) {
  const savedCallback = useRef(callback)
  useEffect(() => { savedCallback.current = callback }, [callback])

  useEffect(() => {
    if (delay == null) return undefined
    let timer = null
    const tick = () => savedCallback.current()
    const start = () => { if (timer == null) timer = setInterval(tick, delay) }
    const stop  = () => { if (timer != null) { clearInterval(timer); timer = null } }

    const onVisibility = () => {
      if (document.hidden) {
        stop()
      } else {
        savedCallback.current()   // al volver, se refresca en el acto
        start()
      }
    }

    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [delay])
}
