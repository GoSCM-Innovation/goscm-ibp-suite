// Los estados de un Application Job de IBP: qué significa cada letra, de qué color va y qué se
// puede hacer con ella.
//
// Portado de v8, donde esta tabla estaba escrita TRES veces —el monitor, el resumen y el resumen
// global— y no idénticas: el monitor tenía catorce colores y los resúmenes otros catorce distintos.
// Aquí hay una sola, y es la que usan las tres pantallas.
//
// SAP manda las etiquetas en `JobStatusInfoSet`, así que las de aquí son el respaldo para cuando esa
// consulta no llega o trae un código que no describe. El código SÍ es dato nuestro: de él dependen
// las decisiones de cancelar y reiniciar.
//
// Ojo con las minúsculas: `c` (cancelando) y `k` (por saltar) son estados DISTINTOS de `C`
// (cancelado) y `K` (saltado). Comparar sin distinguir mayúsculas daría por terminado un job que
// todavía se está cancelando.

/**
 * Cada estado con su etiqueta y su color.
 *
 * Los colores son los del monitor de v8, que es la pantalla donde más se miran.
 */
export const JOB_STATUS = Object.freeze({
  F: { label: 'Terminado', color: '#22c55e' },
  W: { label: 'Terminado con avisos', color: '#eab308' },
  A: { label: 'Fallado', color: '#ef4444' },
  U: { label: 'Error de usuario', color: '#ef4444' },
  C: { label: 'Cancelado', color: '#f97316' },
  c: { label: 'Cancelándose', color: '#fb923c' },
  R: { label: 'En proceso', color: '#06b6d4' },
  P: { label: 'Liberado', color: '#3b82f6' },
  S: { label: 'Programado', color: '#8b5cf6' },
  Y: { label: 'Listo', color: '#14b8a6' },
  K: { label: 'Saltado', color: '#6b7280' },
  k: { label: 'Por saltar', color: '#6b7280' },
  D: { label: 'Borrado', color: '#4b5563' },
  X: { label: 'Desconocido', color: '#9ca3af' },
})

/** Con qué se pinta un código que SAP devuelva y esta tabla no conozca. */
export const JOB_STATUS_FALLBACK = Object.freeze({ label: 'Sin clasificar', color: '#9ca3af' })

/**
 * Lo que hay que saber de un código: etiqueta y color, sin tener que comprobar si existe.
 *
 * Un código desconocido NO se da por terminado ni por fallado, a propósito: si SAP añade un estado,
 * es mejor que salga sin clasificar que clasificado mal.
 */
export function jobStatusMeta(code) {
  return JOB_STATUS[code] ?? { ...JOB_STATUS_FALLBACK, code }
}

/** Aún no ha acabado: se le puede pedir a SAP que lo detenga. */
export const CANCELABLE_JOB_STATUSES = Object.freeze(['P', 'R', 'S', 'Y'])

/** Ya acabó de una forma u otra: se puede volver a lanzar. */
export const RESTARTABLE_JOB_STATUSES = Object.freeze(['A', 'U', 'C', 'W', 'F'])

/** Se detuvo en un paso que falló. */
export const FAILED_JOB_STATUSES = Object.freeze(['A', 'U', 'C'])

/** Completó todos sus pasos, con avisos o sin ellos. */
export const FINISHED_JOB_STATUSES = Object.freeze(['F', 'W'])

/** Todavía está corriendo o esperando su turno. */
export const RUNNING_JOB_STATUSES = Object.freeze(['R', 'c'])
export const QUEUED_JOB_STATUSES = Object.freeze(['P', 'S', 'Y'])

export const isJobCancelable = (code) => CANCELABLE_JOB_STATUSES.includes(code)
export const isJobRestartable = (code) => RESTARTABLE_JOB_STATUSES.includes(code)
export const isJobFailed = (code) => FAILED_JOB_STATUSES.includes(code)
export const isJobFinished = (code) => FINISHED_JOB_STATUSES.includes(code)
export const isJobRunning = (code) => RUNNING_JOB_STATUSES.includes(code)
export const isJobQueued = (code) => QUEUED_JOB_STATUSES.includes(code)

/**
 * Qué porcentaje acabó bien.
 *
 * Cuenta como éxito lo terminado, con avisos o sin ellos —es lo que hacía v8— y solo mira lo que ya
 * acabó: incluir lo que todavía corre haría bajar la tasa por trabajos que aún pueden salir bien.
 *
 * No redondea a 100 si hubo algún fallo, ni a 0 si hubo algún acierto: un "100%" con tres jobs
 * fallados es peor que no dar el dato.
 */
export function jobSuccessRate(codes) {
  const acabados = codes.filter((uno) => isJobFinished(uno) || isJobFailed(uno))
  if (acabados.length === 0) return null

  const bien = acabados.filter(isJobFinished).length
  if (bien === 0) return 0
  if (bien === acabados.length) return 100

  const bruto = Math.round((bien / acabados.length) * 100)
  return Math.min(99, Math.max(1, bruto))
}

/**
 * Los modos con los que SAP admite reiniciar un job.
 *
 * Portados de v8 con su explicación: la diferencia importa y elegir mal repite trabajo ya hecho o
 * se salta un paso que hacía falta.
 */
export const JOB_RESTART_MODES = Object.freeze([
  {
    value: 'E',
    label: 'Desde el paso que falló',
    description: 'Retoma en el primer paso con error y sigue. Los pasos que ya terminaron no se repiten.',
  },
  {
    value: 'A',
    label: 'Todos los pasos desde el principio',
    description: 'Vuelve a ejecutar el trabajo entero, incluidos los pasos que habían terminado bien.',
  },
])
