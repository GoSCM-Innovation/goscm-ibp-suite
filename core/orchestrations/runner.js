// El motor: lo que HACE. Lanza tareas en SAP, consulta cómo van y guarda el estado.
//
// Las reglas están en `step-outcome.js` y `run-state.js`, que son puras. Aquí solo se aplican.
//
// Cómo avanza una ejecución: por vueltas. Una función serverless se corta a los diez segundos y una
// orquestación puede durar horas, así que cada vuelta mira qué pasos están corriendo, lanza los que
// ya pueden, guarda y se va. Un reloj externo vuelve a llamar. Portado de `api/orchestrate.js` de v9.
//
// Una diferencia con v9: allí la lógica de avanzar pasos estaba escrita dos veces —una para el primer
// nivel y otra para los hijos de un grupo— y son la misma cosa. Aquí es una función usada dos veces,
// que además es lo que evita que se arreglen bugs en una copia y no en la otra.

import { randomUUID } from 'node:crypto'
import { getRedis, globalKey, tenantKey } from '../persistence/redis.js'
import { runCidsOperation } from '../cids/operations.js'
import { getOrchestration } from './orchestrations.js'
import { decideForPending, directPredecessors, initRunState, resetForResume, runOutcome } from './run-state.js'
import { isRetryDue, isStepDone, nextStepState } from './step-outcome.js'

/**
 * Cuánto vive el estado de una ejecución.
 *
 * Una semana: lo suficiente para mirar cómo fue la carga de anoche o la del fin de semana largo, y
 * lo bastante poco para que Redis no acumule ejecuciones de hace meses. v9 no le ponía límite y
 * crecían para siempre.
 */
export const RUN_STATE_SECONDS = 7 * 24 * 3600

/**
 * Cuánto dura el cerrojo de una vuelta.
 *
 * Impide que dos relojes avancen la misma orquestación a la vez, que lanzaría cada tarea dos veces.
 * Quince segundos, como en v9: más que lo que tarda una vuelta y menos que lo que nadie esté
 * dispuesto a esperar si un proceso se cae con el cerrojo puesto —vence solo.
 */
export const RUN_LOCK_SECONDS = 15

const runKey = (clientId, orchestrationId) => tenantKey(clientId, 'orch-run', orchestrationId)
const lockKey = (clientId, orchestrationId) => tenantKey(clientId, 'orch-run-lock', orchestrationId)

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

async function desmarcarActiva(clientId, orchestrationId) {
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

/** Estados en los que una ejecución ya no avanza más. */
export const TERMINAL_RUN_STATUSES = Object.freeze(['success', 'error', 'cancelled'])

const esTerminal = (status) => TERMINAL_RUN_STATUSES.includes(status)

const estadoDe = (run, nodeId) => run.nodes?.[nodeId]

/** El estado de una ejecución, o `null` si no hay ninguna registrada. */
export async function getRun(clientId, orchestrationId) {
  const guardado = await getRedis().get(runKey(clientId, orchestrationId))
  return guardado ?? null
}

async function guardarRun(clientId, orchestrationId, run) {
  await getRedis().set(runKey(clientId, orchestrationId), run, { ex: RUN_STATE_SECONDS })
  // El índice se mantiene aquí y no en cada sitio que cambia el estado: así no se puede olvidar en
  // uno de ellos y dejar una ejecución que el reloj nunca vuelve a mirar.
  if (esTerminal(run.status)) await desmarcarActiva(clientId, orchestrationId)
  else await marcarActiva(clientId, orchestrationId)
  return run
}

/**
 * Ejecuta `hacer` con el cerrojo puesto. Devuelve `null` si ya lo tenía otro.
 *
 * El cerrojo lleva una marca propia y solo se suelta si sigue siendo la nuestra: si la vuelta tardó
 * más que el vencimiento, el cerrojo ya es de otro y borrarlo lo dejaría trabajando sin protección.
 */
async function conCerrojo(clientId, orchestrationId, hacer) {
  const redis = getRedis()
  const clave = lockKey(clientId, orchestrationId)
  // Marca propia e irrepetible: es lo que permite soltar el cerrojo solo si sigue siendo el nuestro.
  const marca = randomUUID()

  const tomado = await redis.set(clave, marca, { nx: true, ex: RUN_LOCK_SECONDS })
  if (!tomado) return null

  try {
    return await hacer()
  } finally {
    try {
      if (await redis.get(clave) === marca) await redis.del(clave)
    } catch {
      // Vence solo; no vale la pena tumbar la vuelta por no poder soltarlo.
    }
  }
}

/** Lanza una tarea en CI-DS y devuelve el identificador de la ejecución. */
async function lanzarTarea(destino, nodo, porOmision) {
  const datos = nodo.data ?? {}
  const respuesta = await runCidsOperation({
    ...destino,
    operation: 'runTask',
    params: {
      taskName: datos.taskName,
      ...(datos.agentName ?? porOmision.agentName ? { agentName: datos.agentName ?? porOmision.agentName } : {}),
      ...(datos.profileName ?? porOmision.profileName
        ? { profileName: datos.profileName ?? porOmision.profileName }
        : {}),
      // Las del paso pisan a las generales: lo específico manda sobre lo que se puso para todos.
      globalVariables: [...(porOmision.globalVariables ?? []), ...(datos.globalVariables ?? [])],
    },
  })
  const runId = respuesta?.runId
  if (!runId) throw new Error(`CI-DS no devolvió el identificador de ejecución de "${datos.taskName}".`)
  return runId
}

/** Pregunta cómo va una ejecución. Un fallo al preguntar NO decide nada: se reintenta en la vuelta siguiente. */
async function consultarTarea(destino, sapRunId) {
  return runCidsOperation({ ...destino, operation: 'getTaskStatusByRunId2', params: { runId: sapRunId } })
}

/**
 * Avanza un nivel de pasos: el primer nivel de la orquestación, o los hijos de un grupo.
 *
 * Es la misma lógica en los dos casos, y por eso está una sola vez. Modifica `estados` en el sitio;
 * quien llama lo guarda.
 */
async function avanzarNivel({ nodos, aristas, estados, destino, porOmision, ahora }) {
  const predecesores = directPredecessors(nodos, aristas)
  const configPorId = Object.fromEntries(nodos.map((nodo) => [nodo.id, nodo.data ?? {}]))
  const porId = Object.fromEntries(nodos.map((nodo) => [nodo.id, nodo]))

  const arrancar = async (id) => {
    const paso = estados[id]
    paso.status = 'running'
    paso.startedAt = paso.startedAt ?? new Date(ahora).toISOString()

    // Un grupo no se lanza en SAP: no es una tarea. Ponerlo en marcha es todo lo que hace falta —
    // sus hijos empiezan a avanzar solos a partir de la vuelta siguiente.
    if (porId[id].type === 'group') return

    try {
      paso.sapRunId = await lanzarTarea(destino, porId[id], porOmision)
    } catch (fallo) {
      // No poder lanzarla es un fallo del paso, no de la vuelta: los demás siguen.
      paso.status = 'error'
      paso.finishedAt = new Date(ahora).toISOString()
      paso.error = fallo.message
    }
  }

  // 1. Los que están corriendo: preguntar cómo van. Los que esperan un reintento: relanzarlos.
  await Promise.allSettled(nodos.map(async (nodo) => {
    const paso = estados[nodo.id]
    if (!paso) return

    if (paso.status === 'running' && paso.sapRunId) {
      let sapStatus
      try {
        sapStatus = await consultarTarea(destino, paso.sapRunId)
      } catch {
        return // No se pudo preguntar: se vuelve a intentar en la vuelta siguiente.
      }
      Object.assign(paso, nextStepState(paso, sapStatus, configPorId[nodo.id], ahora))
      return
    }

    if (isRetryDue(paso, ahora)) {
      paso.retryAt = null
      await arrancar(nodo.id)
    }
  }))

  // 2. Los pendientes cuyos predecesores ya terminaron: lanzarlos o saltearlos.
  await Promise.allSettled(nodos.map(async (nodo) => {
    const paso = estados[nodo.id]
    if (!paso || paso.status !== 'pending' || paso.retryAt) return

    const decision = decideForPending(predecesores.get(nodo.id) ?? [], estados, configPorId)
    if (decision === 'esperar') return
    if (decision === 'saltear') {
      paso.status = 'skipped'
      paso.finishedAt = new Date(ahora).toISOString()
      return
    }
    await arrancar(nodo.id)
  }))
}

/** Avanza una orquestación un paso. Devuelve el estado resultante. */
export async function tickRun(clientId, orchestrationId, ahora = Date.now()) {
  const avanzado = await conCerrojo(clientId, orchestrationId, async () => {
    const run = await getRun(clientId, orchestrationId)
    if (!run || esTerminal(run.status)) {
      // Venció el estado guardado, o ya terminó y el índice quedó atrasado. En los dos casos el
      // reloj no tiene nada que hacer con ella nunca más.
      await desmarcarActiva(clientId, orchestrationId)
      return run
    }

    const orquestacion = await getOrchestration(clientId, orchestrationId)
    if (!orquestacion) {
      // La borraron mientras corría. Se deja constancia en vez de reintentar para siempre.
      return guardarRun(clientId, orchestrationId, {
        ...run,
        status: 'error',
        finishedAt: new Date(ahora).toISOString(),
        error: 'La orquestación fue eliminada mientras se ejecutaba.',
      })
    }

    const { nodes, edges } = orquestacion
    const destino = {
      clientId,
      connectionId: orquestacion.connectionId,
      production: orquestacion.production,
    }
    const porOmision = run.defaults ?? {}
    const primerNivel = nodes.filter((nodo) => !nodo.parentId)

    // Los grupos que ya arrancaron avanzan por dentro antes de mirar el primer nivel: así un grupo
    // que termina en esta misma vuelta desbloquea a lo que venía detrás sin esperar a la siguiente.
    await Promise.allSettled(primerNivel
      .filter((nodo) => nodo.type === 'group' && estadoDe(run, nodo.id)?.status === 'running')
      .map(async (grupo) => {
        const estadoGrupo = run.nodes[grupo.id]
        const hijos = nodes.filter((nodo) => nodo.parentId === grupo.id)
        await avanzarNivel({
          nodos: hijos,
          aristas: edges,
          estados: estadoGrupo.children,
          destino,
          porOmision,
          ahora,
        })
        const resultado = runOutcome(hijos.map((hijo) => hijo.id), estadoGrupo.children)
        if (resultado !== 'running') {
          estadoGrupo.status = resultado
          estadoGrupo.finishedAt = new Date(ahora).toISOString()
        }
      }))

    await avanzarNivel({
      nodos: primerNivel,
      aristas: edges,
      estados: run.nodes,
      destino,
      porOmision,
      ahora,
    })

    // Un grupo recién arrancado no lanza tareas: `avanzarNivel` lo puso en marcha y sus hijos
    // empiezan en la vuelta siguiente. Un grupo sin hijos termina en el acto.
    for (const grupo of primerNivel.filter((nodo) => nodo.type === 'group')) {
      const estadoGrupo = run.nodes[grupo.id]
      if (estadoGrupo?.status !== 'running') continue
      if (Object.keys(estadoGrupo.children ?? {}).length === 0) {
        estadoGrupo.status = 'success'
        estadoGrupo.finishedAt = new Date(ahora).toISOString()
      }
    }

    const resultado = runOutcome(primerNivel.map((nodo) => nodo.id), run.nodes)
    if (resultado !== 'running') {
      run.status = resultado
      run.finishedAt = new Date(ahora).toISOString()
    }

    return guardarRun(clientId, orchestrationId, run)
  })

  // Sin cerrojo significa que otra vuelta la está avanzando ahora mismo: se devuelve lo que hay.
  return avanzado ?? getRun(clientId, orchestrationId)
}

/**
 * Arranca una ejecución desde cero.
 *
 * Se niega si ya hay una corriendo: lanzar la misma orquestación dos veces a la vez duplicaría cada
 * carga en SAP, que es de los errores más caros que se pueden cometer aquí.
 */
export async function startRun(clientId, orchestrationId, { defaults = {} } = {}, ahora = Date.now()) {
  const orquestacion = await getOrchestration(clientId, orchestrationId)
  if (!orquestacion) throw new Error('La orquestación no existe para este cliente.')

  const primerNivel = orquestacion.nodes.filter((nodo) => !nodo.parentId)
  if (primerNivel.length === 0) throw new Error('La orquestación no tiene ningún paso que ejecutar.')

  const arrancado = await conCerrojo(clientId, orchestrationId, async () => {
    const anterior = await getRun(clientId, orchestrationId)
    if (anterior && !esTerminal(anterior.status)) {
      throw new Error('Ya hay una ejecución en curso de esta orquestación.')
    }
    const run = { ...initRunState(orquestacion.nodes, new Date(ahora).toISOString()), defaults }
    return guardarRun(clientId, orchestrationId, run)
  })

  if (!arrancado) throw new Error('Ya hay una ejecución en curso de esta orquestación.')
  return arrancado
}

/**
 * Retoma una ejecución que terminó mal, desde donde falló.
 *
 * Lo que salió bien se conserva: volver a lanzar una carga que ya entró la duplicaría en SAP.
 */
export async function resumeRun(clientId, orchestrationId) {
  const retomado = await conCerrojo(clientId, orchestrationId, async () => {
    const run = await getRun(clientId, orchestrationId)
    if (!run) throw new Error('Esta orquestación no tiene ninguna ejecución registrada.')
    if (!esTerminal(run.status)) throw new Error('Ya hay una ejecución en curso de esta orquestación.')
    if (run.status === 'success') throw new Error('La ejecución terminó bien: no hay nada que retomar.')
    return guardarRun(clientId, orchestrationId, resetForResume(run))
  })

  if (!retomado) throw new Error('Ya hay una ejecución en curso de esta orquestación.')
  return retomado
}

/**
 * Corta una ejecución.
 *
 * Se le pide a CI-DS que cancele los pasos que estén corriendo, pero lo que ya entró en SAP no se
 * deshace: cancelar detiene, no revierte. Un paso que no se pueda cancelar no impide cortar los
 * demás — quedarse a medias por uno sería lo peor de los dos mundos.
 */
export async function cancelRun(clientId, orchestrationId, ahora = Date.now()) {
  const orquestacion = await getOrchestration(clientId, orchestrationId)
  if (!orquestacion) throw new Error('La orquestación no existe para este cliente.')

  const cortado = await conCerrojo(clientId, orchestrationId, async () => {
    const run = await getRun(clientId, orchestrationId)
    if (!run) throw new Error('Esta orquestación no tiene ninguna ejecución registrada.')
    if (esTerminal(run.status)) return run

    const destino = { clientId, connectionId: orquestacion.connectionId, production: orquestacion.production }
    const enMarcha = []
    for (const paso of Object.values(run.nodes)) {
      if (paso.status === 'running' && paso.sapRunId) enMarcha.push(paso)
      for (const hijo of Object.values(paso.children ?? {})) {
        if (hijo.status === 'running' && hijo.sapRunId) enMarcha.push(hijo)
      }
    }

    await Promise.allSettled(enMarcha.map(async (paso) => {
      try {
        await runCidsOperation({ ...destino, operation: 'cancelTask', params: { runId: paso.sapRunId } })
      } catch {
        // CI-DS decide si alcanza a cancelarla; el estado local se marca igual.
      }
    }))

    const cortarPaso = (paso) => {
      if (isStepDone(paso.status)) return paso
      return { ...paso, status: 'cancelled', finishedAt: new Date(ahora).toISOString() }
    }

    return guardarRun(clientId, orchestrationId, {
      ...run,
      status: 'cancelled',
      finishedAt: new Date(ahora).toISOString(),
      nodes: Object.fromEntries(Object.entries(run.nodes).map(([id, paso]) => [id, {
        ...cortarPaso(paso),
        ...(paso.children
          ? { children: Object.fromEntries(Object.entries(paso.children).map(([h, hijo]) => [h, cortarPaso(hijo)])) }
          : {}),
      }])),
    })
  })

  if (!cortado) throw new Error('La ejecución está avanzando en este momento; probá de nuevo en unos segundos.')
  return cortado
}
