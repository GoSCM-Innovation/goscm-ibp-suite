// Qué hacer cuando una pestaña abierta de antes pide un archivo de la versión anterior.
//
// Tras un despliegue, los nombres de los archivos cambian (llevan un código). Una pestaña que sigue con
// la versión vieja pide uno que ya no existe y Vite avisa con `vite:preloadError`. Recargar trae la versión
// nueva, pero hay que evitar un bucle si el fallo fuera otro (un archivo que de verdad no está).
//
// Antes la recarga se permitía UNA vez por sesión del navegador y la marca no se borraba nunca. Al segundo
// despliegue de la sesión ya no recargaba, y como además tapaba el error con `preventDefault()`, la carga
// del módulo devolvía `undefined` y la pantalla fallaba con «Cannot read properties of undefined (reading
// 'default')». Ahora lo que se limita es la FRECUENCIA: no se recarga dos veces en pocos segundos.

/** Si se recargó hace menos de esto, un nuevo fallo no es una versión nueva: es otro problema. */
export const VENTANA_DE_RECARGA_MS = 30000

/** La clave en `sessionStorage` donde se anota cuándo fue la última recarga por versión. */
export const CLAVE_DE_RECARGA = 'recargado-por-version'

/**
 * ¿Se debe recargar ahora? `ultima` es la hora (ms) de la última recarga por versión, o 0/`null` si no la
 * hubo. Lo que no es un número válido cuenta como «nunca».
 */
export function debeRecargar(ahora, ultima, ventana = VENTANA_DE_RECARGA_MS) {
  const antes = Number(ultima)
  if (!Number.isFinite(antes) || antes <= 0) return true
  return ahora - antes >= ventana
}

/**
 * El manejador de `vite:preloadError`. Si toca recargar, lo anota y recarga; si no, NO tapa el error: lo
 * deja pasar para que se vea el motivo real en vez de un `undefined`.
 */
export function alFallarLaCarga(evento, { almacen = globalThis.sessionStorage, recargar = () => globalThis.location.reload(), ahora = Date.now() } = {}) {
  let ultima = 0
  try { ultima = Number(almacen?.getItem(CLAVE_DE_RECARGA)) } catch { /* sin almacenamiento: se trata como «nunca» */ }

  if (!debeRecargar(ahora, ultima)) return false

  try { almacen?.setItem(CLAVE_DE_RECARGA, String(ahora)) } catch { /* sin almacenamiento: se recarga igual */ }
  evento.preventDefault()
  recargar()
  return true
}
