// ¿Pantalla de teléfono? Portado tal cual de `hooks/useIsMobile.js` de v8.
//
// Existe aparte de `useIsNarrow` porque las pantallas portadas de v8 deciden sus rellenos y columnas
// con ESTE corte (640 px), y con otro quedarían distintas a como eran.

import { useEffect, useState } from 'react'

export function useIsMobile(breakpoint = 640) {
  const [is, setIs] = useState(() => typeof window !== 'undefined' && window.innerWidth <= breakpoint)
  useEffect(() => {
    const fn = () => setIs(window.innerWidth <= breakpoint)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [breakpoint])
  return is
}
