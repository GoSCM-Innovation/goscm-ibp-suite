// Qué conexiones están abiertas en la tira de pestañas, y cuál se está mirando.
//
// Portado de `loadOpenTabs` / `persistOpenTabs` / `closeTab` de `App.jsx` de v9. Se guarda en
// `localStorage` para que al volver estén las mismas pestañas de la última vez, que es lo que v9
// hacía: quien trabaja contra tres tenants no quiere volver a abrirlos cada mañana.
//
// Por módulo (`clave`) y no global: las conexiones de IBP y las de CI-DS son listas distintas, y una
// pestaña de un tenant de IBP no significa nada en CI-DS.

/** Lo guardado se filtra contra lo que existe: una conexión borrada no debe dejar una pestaña rota. */
export function abrirLasGuardadas(clave, existentes) {
  const validas = new Set((existentes ?? []).map((una) => una.id))
  let guardadas = []
  try {
    const crudo = localStorage.getItem(`pestanas_${clave}`)
    guardadas = crudo ? JSON.parse(crudo) : []
  } catch {
    guardadas = []
  }

  const abiertas = (Array.isArray(guardadas) ? guardadas : []).filter((id) => validas.has(id))
  // Sin nada guardado se abre la primera, para no dejar el módulo en blanco al entrar por primera vez.
  if (abiertas.length === 0 && existentes?.length > 0) return [existentes[0].id]
  return abiertas
}

/** Guarda la lista. Que no se pueda guardar no rompe nada: solo no se recordará. */
export function guardarAbiertas(clave, abiertas) {
  try {
    localStorage.setItem(`pestanas_${clave}`, JSON.stringify(abiertas ?? []))
  } catch {
    // Sin espacio o en modo privado.
  }
}

/** Abre una pestaña si no lo estaba. Devuelve la lista nueva. */
export function abrir(abiertas, id) {
  return (abiertas ?? []).includes(id) ? abiertas : [...(abiertas ?? []), id]
}

/**
 * Cierra una pestaña y dice cuál queda activa.
 *
 * La última no se cierra: un módulo sin ninguna pestaña abierta no tiene nada que enseñar, y v9 caía
 * en su pantalla de conexiones, que aquí no existe —las administra otro módulo—.
 *
 * Al cerrar la activa se pasa a la ANTERIOR, no a la primera: es de donde se venía.
 */
export function cerrar(abiertas, activa, id) {
  const lista = abiertas ?? []
  if (lista.length <= 1) return { abiertas: lista, activa }

  const donde = lista.indexOf(id)
  const quedan = lista.filter((otra) => otra !== id)
  if (activa !== id) return { abiertas: quedan, activa }

  return { abiertas: quedan, activa: quedan[Math.max(0, donde - 1)] }
}
