// Las cuentas de un tablero: pasar de una lista de ejecuciones a los números que se dibujan.
//
// Están aquí y no dentro de un componente porque son lo que son: transformaciones de datos, sin
// nada de React en medio, y por eso se pueden probar. En v9 esto vivía duplicado —`buildChartData`
// en el resumen global y las mismas cuentas escritas a mano en el resumen del tenant— y por eso los
// dos tableros mostraban números distintos para los mismos datos.

import { isFailed, isWarning } from '../../core/cids/task-status.js'
import { dayLabelEpochMs } from './dates.js'

/** Cuántos días se dibujan en el gráfico de barras. De v9. */
export const DIAS_EN_GRAFICO = 14

/** Cuántas filas se listan en los cuadros de abajo. De v9. */
export const FILAS_EN_LISTA = 5

/** Cuántas ejecuciones hay de cada estado, de más a menos, con su etiqueta y su color. */
export function statusBreakdown(ejecuciones, statusMeta) {
  const cuenta = new Map()
  for (const fila of ejecuciones) {
    cuenta.set(fila.statusCode, (cuenta.get(fila.statusCode) ?? 0) + 1)
  }
  return [...cuenta.entries()]
    .map(([code, value]) => ({ code, value, name: statusMeta(code).label, color: statusMeta(code).color }))
    .sort((a, b) => b.value - a.value)
}

/**
 * Ejecuciones por día, en tres pilas: correctas, falladas y el resto.
 *
 * El día se calcula en la zona elegida, no en UTC: una carga de las 2 de la mañana en UTC es del día
 * anterior si miras en UTC-4, y el gráfico tiene que coincidir con lo que dice la tabla.
 */
export function perDayBreakdown(ejecuciones, zona) {
  const porDia = new Map()

  for (const fila of ejecuciones) {
    const dia = dayLabelEpochMs(fila.startDate, zona)
    const delDia = porDia.get(dia) ?? { dia, Correctas: 0, Falladas: 0, Otras: 0 }
    if (fila.statusCode === 'SUCCESS') delDia.Correctas += 1
    else if (isFailed(fila.statusCode)) delDia.Falladas += 1
    else delDia.Otras += 1
    porDia.set(dia, delDia)
  }

  return [...porDia.values()]
    .sort((a, b) => a.dia.localeCompare(b.dia))
    .slice(-DIAS_EN_GRAFICO)
}

/**
 * Las tareas más ejecutadas.
 *
 * `claveExtra` separa la misma tarea cuando viene de tenants distintos: en el tablero global,
 * CARGA_DIARIA de producción y CARGA_DIARIA de pruebas son dos filas, no una. Es lo que hacía v9.
 */
export function topTasks(ejecuciones, { claveExtra = () => '', limite = FILAS_EN_LISTA } = {}) {
  const cuenta = new Map()

  for (const fila of ejecuciones) {
    const taskName = fila.taskName || '—'
    const clave = `${claveExtra(fila)}|${taskName}`
    const actual = cuenta.get(clave) ?? { clave, taskName, fila, veces: 0 }
    actual.veces += 1
    cuenta.set(clave, actual)
  }

  return [...cuenta.values()].sort((a, b) => b.veces - a.veces).slice(0, limite)
}

/** Las más recientes que cumplan la condición. Lo usan "últimas falladas" y "correctas con errores". */
function ultimas(ejecuciones, cumple, limite) {
  return ejecuciones
    .filter((fila) => cumple(fila.statusCode))
    .sort((a, b) => (Number.parseInt(b.startDate, 10) || 0) - (Number.parseInt(a.startDate, 10) || 0))
    .slice(0, limite)
}

export function latestFailed(ejecuciones, limite = FILAS_EN_LISTA) {
  return ultimas(ejecuciones, isFailed, limite)
}

export function latestWarnings(ejecuciones, limite = FILAS_EN_LISTA) {
  return ultimas(ejecuciones, isWarning, limite)
}

/** El color con el que se pinta una tasa de éxito. Los cortes son los de v9. */
export function colorDeTasa(tasa) {
  if (tasa === null) return 'var(--text2)'
  if (tasa >= 90) return 'var(--green)'
  if (tasa >= 70) return 'var(--accent)'
  return 'var(--red)'
}
