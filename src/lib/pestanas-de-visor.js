// Las pestañas abiertas de un visor de datos: qué mira cada una y cómo se llama.
//
// Portado de `DataViewer/tabsHelpers.js` y de la persistencia de `ViewerTabs.jsx` de v8.
//
// Lo que se guarda es la DEFINICIÓN —área, versión y tabla—, nunca las filas. Al volver, las pestañas
// están donde estaban y cada una lee sus datos cuando se abre. Es lo que permite tener ocho abiertas
// sin que entrar a la aplicación dispare ocho consultas a SAP.

/** El tope de v8. Con más, la tira deja de ser navegable y la memoria empieza a doler. */
export const TOPE_DE_PESTANAS = 8

/** Dónde se guardan las de un visor y una conexión. */
export const claveDePestanas = (clase, conexionId) => `visor_${clase}_${conexionId || 'sin-conexion'}`

/** Un identificador que no choque con los de las pestañas ya abiertas. */
let contador = 0
const nuevoId = () => {
  contador += 1
  return `p${contador}_${Math.random().toString(36).slice(2, 8)}`
}

/** Una pestaña nueva, opcionalmente arrancando en la misma tabla que otra. */
export const nuevaPestana = (def = null) => ({ id: nuevoId(), def: def ? { ...def } : null })

/**
 * Cómo se llama una pestaña en la tira.
 *
 * `ÁREA · VERSIÓN · TABLA`, y sin la versión cuando es la base. Una pestaña sin tabla elegida todavía
 * no tiene nombre, y quien la pinta pone «Pestaña n».
 */
export function nombreDePestana(def) {
  if (!def?.tabla) return ''
  const partes = [def.area, def.version, def.tabla].filter(Boolean)
  return partes.join(' · ')
}

/** Las pestañas guardadas. Siempre devuelve al menos una: un visor sin pestañas no enseña nada. */
export function leerPestanas(clase, conexionId) {
  let leidas = []
  try {
    const crudo = localStorage.getItem(claveDePestanas(clase, conexionId))
    leidas = crudo ? JSON.parse(crudo) : []
  } catch {
    leidas = []
  }

  const validas = (Array.isArray(leidas) ? leidas : [])
    .filter((una) => una?.id)
    .slice(0, TOPE_DE_PESTANAS)
    .map((una) => ({ id: String(una.id), def: una.def ?? null }))

  return validas.length > 0 ? validas : [nuevaPestana()]
}

/** Guarda las pestañas de un visor. Que no se pueda guardar no rompe la sesión en curso. */
export function guardarPestanas(clase, conexionId, pestanas) {
  try {
    localStorage.setItem(
      claveDePestanas(clase, conexionId),
      JSON.stringify((pestanas ?? []).map(({ id, def }) => ({ id, def }))),
    )
  } catch {
    // Sin espacio o en modo privado.
  }
}
