// Qué versión de un área se está mirando, y qué se le manda a SAP.
//
// Son tres reglas cortas y una de ellas costó que un módulo entero fuera inalcanzable, así que van
// aquí y con pruebas en vez de dentro de la pantalla.
//
// LA VERSIÓN BASE ES «SIN VERSIÓN». En SAP IBP, el dato maestro del área vive en la versión base, y
// pedirlo es NO mandar `VersionID` en el filtro. Medido en el tenant de pruebas: la base tiene 8.134
// productos y 47.919 arcos, mientras que dos de sus seis versiones con nombre están completamente
// vacías.
//
// El problema: en un desplegable la cadena vacía ya significa «todavía no elige». Si la base también
// fuera la cadena vacía, las dos cosas serían indistinguibles, y como la pantalla exige haber elegido
// para dejarte pasar, la base quedaba fuera de alcance —que es exactamente lo que pasaba—. Así que la
// base tiene identificador propio aquí dentro y se traduce a vacío al hablar con SAP.

/** La versión base del área. No es un identificador de SAP: es interno de la interfaz. */
export const VERSION_BASE = '__base__'

/** El identificador que espera SAP. La base va vacía; el resto, tal cual. */
export const versionParaSap = (elegida) => (elegida === VERSION_BASE ? '' : String(elegida ?? ''))

/**
 * Las versiones que se pueden elegir, con la base primero.
 *
 * Primero porque es la del área y es el caso normal; las versiones con nombre son escenarios.
 */
export function versionesElegibles(versiones) {
  return [VERSION_BASE, ...(versiones ?? []).map((una) => una?.id).filter(Boolean)]
}

/**
 * La versión que de verdad está en juego.
 *
 * Se DERIVA y no se guarda tal cual porque al cambiar de área la que estaba puesta casi nunca existe
 * en la nueva, y arrastrarla haría que la pantalla dijera una versión y consultara otra.
 *
 * Se auto-elige solo si hay UNA posibilidad —un área sin ninguna versión con nombre—; con dos o más
 * devuelve vacío, que es «todavía no elige». Adivinar aquí es de lo más caro que puede hacer esta
 * aplicación: un análisis de calidad de datos leído contra la versión equivocada parece correcto.
 */
export function versionEfectiva(versionId, versiones) {
  const elegibles = versionesElegibles(versiones)
  if (elegibles.includes(versionId)) return versionId
  return elegibles.length === 1 ? elegibles[0] : ''
}
