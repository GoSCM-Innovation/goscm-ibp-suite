// Los estados de una tarea de CI-DS: una sola fuente de verdad.
//
// En v9 esta tabla estaba repetida en cuatro sitios —el monitor, los dos resúmenes y el
// lienzo del orquestador— con los mismos colores escritos a mano en cada uno. Bastaba con que
// SAP añadiera un estado para que apareciera bien en una pantalla y como "desconocido" en las
// otras. Aquí está una vez.
//
// Los códigos y los colores se portan tal cual de v9: son los que SAP devuelve (ya sin el
// prefijo "TASK:", que quita el cliente SOAP) y los colores con los que tus usuarios llevan
// tiempo leyendo estas pantallas.

export const TASK_STATUS = Object.freeze({
  RUNNING: { label: 'En ejecución', color: '#3b82f6' },
  SUCCESS: { label: 'Correcta', color: '#34d399' },
  SUCCESS_WITH_ERRORS_D: { label: 'Correcta con errores D', color: '#fbbf24' },
  SUCCESS_WITH_ERRORS_E: { label: 'Correcta con errores E', color: '#f97316' },
  ERROR: { label: 'Error', color: '#ff6b6b' },
  QUEUEING: { label: 'En cola', color: '#8b5cf6' },
  IMPORTED: { label: 'Importada', color: '#06b6d4' },
  FETCHED: { label: 'Recuperada', color: '#22d3ee' },
  TERMINATED: { label: 'Cancelada', color: '#9ca3af' },
  TERMINATION_FAILED: { label: 'Cancelación fallida', color: '#f97316' },
  UNKNOWN: { label: 'Desconocido', color: '#6b7280' },
})

/**
 * Estados finales: la tarea ya acabó y su detalle no va a cambiar nunca más.
 *
 * Es lo que permite al monitor pedir el detalle UNA vez y guardarlo, en vez de volver a
 * preguntarlo en cada refresco. Con cientos de ejecuciones en pantalla, la diferencia entre
 * consultar todas cada 30 segundos o solo las que siguen vivas es enorme.
 */
export const TERMINAL_STATUSES = Object.freeze([
  'SUCCESS',
  'SUCCESS_WITH_ERRORS_D',
  'SUCCESS_WITH_ERRORS_E',
  'ERROR',
  'TERMINATED',
  'TERMINATION_FAILED',
])

/** Estados en los que todavía se puede cancelar la tarea. */
export const CANCELABLE_STATUSES = Object.freeze(['RUNNING', 'QUEUEING', 'IMPORTED', 'FETCHED'])

export function isTerminal(statusCode) {
  return TERMINAL_STATUSES.includes(statusCode)
}

export function isCancelable(statusCode) {
  return CANCELABLE_STATUSES.includes(statusCode)
}

/** Etiqueta y color de un estado. Uno que no conozcamos cae en "desconocido", no revienta. */
export function statusMeta(statusCode) {
  return TASK_STATUS[statusCode] ?? TASK_STATUS.UNKNOWN
}

/**
 * Duración legible a partir de segundos: "12s", "4m 56s", "7h 6m".
 * Portada de v9 sin cambios; devuelve un guion cuando no hay dato.
 */
export function formatDuration(seconds) {
  const total = Number(seconds)
  if (!Number.isFinite(total) || total <= 0) return '—'
  const redondeado = Math.round(total)
  const horas = Math.floor(redondeado / 3600)
  const minutos = Math.floor((redondeado % 3600) / 60)
  const resto = redondeado % 60
  if (horas > 0) return `${horas}h ${minutos}m`
  if (minutos > 0) return `${minutos}m ${resto}s`
  return `${resto}s`
}
