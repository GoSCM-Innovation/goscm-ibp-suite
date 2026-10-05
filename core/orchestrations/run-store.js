// Dónde se guarda el estado de las ejecuciones: leerlo, escribirlo, borrarlo, y el índice de las
// que están en marcha.
//
// Vive aparte de `runner.js` porque lo necesitan dos módulos que no pueden depender uno del otro:
// el motor, que avanza ejecuciones, y `orchestrations.js`, que al borrar una orquestación tiene que
// negarse si tiene una corriendo y limpiar su estado si no. Con el estado en el motor, uno importaría
// al otro y el ciclo lo resuelve el orden de carga, que es justo lo que no debe decidir nada.

import { getRedis, globalKey, tenantKey } from '../persistence/redis.js'

/**
 * Cuánto vive el estado de una ejecución.
 *
 * Una semana: lo suficiente para mirar cómo fue la carga de anoche o la del fin de semana largo, y
 * lo bastante poco para que Redis no acumule ejecuciones de hace meses. v9 no le ponía límite y
 * crecían para siempre.
 */
export const RUN_STATE_SECONDS = 7 * 24 * 3600

/** Estados en los que una ejecución ya no avanza más. */
export const TERMINAL_RUN_STATUSES = Object.freeze(['success', 'error', 'cancelled'])

export const esTerminal = (status) => TERMINAL_RUN_STATUSES.includes(status)

/**
 * Un error con el código HTTP que le corresponde.
 *
 * v9 contestaba 409 cuando lo pedido choca con una ejecución en marcha («Ya hay una ejecución
 * activa», «No se puede eliminar con una ejecución activa»). Los endpoints leen `statusCode`.
 */
export const errorDeConflicto = (mensaje) => Object.assign(new Error(mensaje), { statusCode: 409 })

const runKey = (clientId, orchestrationId) => tenantKey(clientId, 'orch-run', orchestrationId)

/**
 * Índice de las ejecuciones en marcha, para que el reloj sepa a cuáles avanzar.
 *
 * Es global a propósito —no es de ningún cliente— y por eso lleva el cliente dentro de cada entrada.
 * Es de lo que `globalKey` está pensado para guardar: estado de infraestructura, no dato de nadie.
 *
 * La alternativa era que el reloj recorriera todas las orquestaciones de la base y preguntara por
 * cada una si está corriendo, que es lo que hacía v9. Con este índice el trabajo es proporcional a
 * las que de verdad están en marcha, no a las que existen.
 */
const ACTIVE_RUNS_KEY = globalKey('cids-active-runs')

const entradaActiva = (clientId, orchestrationId) => `${clientId}|${orchestrationId}`

async function marcarActiva(clientId, orchestrationId) {
  await getRedis().sadd(ACTIVE_RUNS_KEY, entradaActiva(clientId, orchestrationId))
}

export async function desmarcarActiva(clientId, orchestrationId) {
  await getRedis().srem(ACTIVE_RUNS_KEY, entradaActiva(clientId, orchestrationId))
}

/** Qué ejecuciones hay en marcha, como `{ clientId, orchestrationId }`. Lo usa el reloj. */
export async function listActiveRuns() {
  const entradas = await getRedis().smembers(ACTIVE_RUNS_KEY)
  return entradas
    .map((entrada) => {
      const [clientId, orchestrationId] = String(entrada).split('|')
      return clientId && orchestrationId ? { clientId, orchestrationId } : null
    })
    .filter(Boolean)
}

/** El estado de una ejecución, o `null` si no hay ninguna registrada. */
export async function getRun(clientId, orchestrationId) {
  const guardado = await getRedis().get(runKey(clientId, orchestrationId))
  return guardado ?? null
}

export async function guardarRun(clientId, orchestrationId, run) {
  await getRedis().set(runKey(clientId, orchestrationId), run, { ex: RUN_STATE_SECONDS })
  // El índice se mantiene aquí y no en cada sitio que cambia el estado: así no se puede olvidar en
  // uno de ellos y dejar una ejecución que el reloj nunca vuelve a mirar.
  if (esTerminal(run.status)) await desmarcarActiva(clientId, orchestrationId)
  else await marcarActiva(clientId, orchestrationId)
  return run
}

/** Borra el estado de una ejecución y la saca del índice. Se usa al eliminar su orquestación. */
export async function borrarRun(clientId, orchestrationId) {
  await getRedis().del(runKey(clientId, orchestrationId))
  await desmarcarActiva(clientId, orchestrationId)
}
