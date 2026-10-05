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
import { getRedis, tenantKey } from '../persistence/redis.js'
import { getConnectionTarget } from '../connections/index.js'
import { adaptadorPara } from './adapters.js'
import { getOrchestration } from './orchestrations.js'
import {
  DEFAULT_RUN_POLICY,
  decideForPending,
  directPredecessors,
  groupOutcome,
  initRunState,
  resetForResume,
  runOutcome,
} from './run-state.js'
import {
  RUN_STATE_SECONDS,
  TERMINAL_RUN_STATUSES,
  desmarcarActiva,
  errorDeConflicto,
  esTerminal,
  getRun,
  guardarRun,
  listActiveRuns,
} from './run-store.js'
import { isRetryDue, isStepDone, nextStepState } from './step-outcome.js'

// El estado guardado vive en `run-store.js`; se vuelve a exportar para que quien ya importaba de aquí
// siga haciéndolo.
export { RUN_STATE_SECONDS, TERMINAL_RUN_STATUSES, getRun, listActiveRuns }

/**
 * Cuánto dura el cerrojo de una vuelta.
 *
 * Impide que dos relojes avancen la misma orquestación a la vez, que lanzaría cada tarea dos veces.
 * Quince segundos, como en v9: más que lo que tarda una vuelta y menos que lo que nadie esté
 * dispuesto a esperar si un proceso se cae con el cerrojo puesto —vence solo.
 */
export const RUN_LOCK_SECONDS = 15

/** Cuánto se espera entre un intento de cortar y el siguiente, si una vuelta tiene el cerrojo. */
export const ESPERA_ENTRE_INTENTOS_DE_CORTAR_MS = 500

const esperarMs = (ms) => new Promise((resolver) => { setTimeout(resolver, ms) })

const lockKey = (clientId, orchestrationId) => tenantKey(clientId, 'orch-run-lock', orchestrationId)

const estadoDe = (run, nodeId) => run.nodes?.[nodeId]

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

// Qué se lanza y cómo se pregunta cómo va depende del tipo de conexión. Las reglas de dependencias,
// grupos y reintentos son las mismas para CI-DS y para IBP, salvo las que cada adaptador declara en
// su `politica` —las diferencias entre el orquestador de v9 y el de v8—. Ver `adapters.js` y
// `DEFAULT_RUN_POLICY` en `run-state.js`.

/** La política de un adaptador; sin ella, la de CI-DS. */
const politicaDe = (adaptador) => ({ ...DEFAULT_RUN_POLICY, ...(adaptador?.politica ?? {}) })

/**
 * Avanza un nivel de pasos: el primer nivel de la orquestación, o los hijos de un grupo.
 *
 * Es la misma lógica en los dos casos, y por eso está una sola vez. Modifica `estados` en el sitio;
 * quien llama lo guarda.
 */
async function avanzarNivel({ nodos, aristas, estados, destino, adaptador, porOmision, ahora, politica }) {
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

    // La letra de SAP de un intento anterior no es de esta ejecución nueva.
    if ('sapStatus' in paso) paso.sapStatus = null

    try {
      paso.sapRunId = await adaptador.lanzar(destino, porId[id], porOmision)
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
        sapStatus = await adaptador.consultar(destino, paso.sapRunId)
      } catch {
        return // No se pudo preguntar: se vuelve a intentar en la vuelta siguiente.
      }
      // Lo que el adaptador sabe además del estado: el identificador ya completo —un trabajo de IBP
      // que se lanzó sin número de repetición lo gana al contarlo SAP— y la letra de SAP tal cual,
      // que la pantalla de IBP enseña junto al trabajo. CI-DS no manda ninguno de los dos.
      if (sapStatus?.sapRunId) paso.sapRunId = sapStatus.sapRunId
      if (sapStatus?.codigoSap) paso.sapStatus = sapStatus.codigoSap
      Object.assign(paso, nextStepState(paso, sapStatus, configPorId[nodo.id], ahora, politica))
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

    const decision = decideForPending(predecesores.get(nodo.id) ?? [], estados, configPorId, politica)
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

    // El tipo sale de la CONEXIÓN y no de la orquestación: es donde ya vive, y así una orquestación
    // no puede decir que es de un tipo y apuntar a un tenant del otro.
    let adaptador
    try {
      const conexion = await getConnectionTarget(clientId, orquestacion.connectionId)
      adaptador = adaptadorPara(conexion.kind)
    } catch (fallo) {
      return guardarRun(clientId, orchestrationId, {
        ...run,
        status: 'error',
        finishedAt: new Date(ahora).toISOString(),
        error: fallo.message,
      })
    }
    const porOmision = run.defaults ?? {}
    const politica = politicaDe(adaptador)
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
          adaptador,
          porOmision,
          ahora,
          politica,
        })
        const resultado = groupOutcome(hijos.map((hijo) => hijo.id), estadoGrupo.children, politica)
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
      adaptador,
      porOmision,
      ahora,
      politica,
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

    const resultado = runOutcome(primerNivel.map((nodo) => nodo.id), run.nodes, {
      configPorId: Object.fromEntries(primerNivel.map((nodo) => [nodo.id, nodo.data ?? {}])),
      politica,
    })
    if (resultado !== 'running') {
      run.status = resultado
      run.finishedAt = new Date(ahora).toISOString()
    }

    return guardarRun(clientId, orchestrationId, run)
  })

  // Sin cerrojo significa que otra vuelta la está avanzando ahora mismo: se devuelve lo que hay.
  return avanzado ?? getRun(clientId, orchestrationId)
}

/** El mensaje de v9 cuando ya hay una ejecución en marcha. */
const YA_HAY_UNA_ACTIVA = 'Ya hay una ejecución activa'

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
  if (primerNivel.length === 0) throw new Error('La orquestación no tiene nodos')

  const arrancado = await conCerrojo(clientId, orchestrationId, async () => {
    const anterior = await getRun(clientId, orchestrationId)
    if (anterior && !esTerminal(anterior.status)) throw errorDeConflicto(YA_HAY_UNA_ACTIVA)
    const run = { ...initRunState(orquestacion.nodes, new Date(ahora).toISOString()), defaults }
    return guardarRun(clientId, orchestrationId, run)
  })

  if (!arrancado) throw errorDeConflicto(YA_HAY_UNA_ACTIVA)
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
    if (!esTerminal(run.status)) throw errorDeConflicto(YA_HAY_UNA_ACTIVA)
    if (run.status === 'success') throw errorDeConflicto('La ejecución terminó bien: no hay nada que retomar.')
    return guardarRun(clientId, orchestrationId, resetForResume(run))
  })

  if (!retomado) throw errorDeConflicto(YA_HAY_UNA_ACTIVA)
  return retomado
}

/**
 * Corta una ejecución.
 *
 * Se le pide a CI-DS que cancele los pasos que estén corriendo, pero lo que ya entró en SAP no se
 * deshace: cancelar detiene, no revierte. Un paso que no se pueda cancelar no impide cortar los
 * demás — quedarse a medias por uno sería lo peor de los dos mundos.
 *
 * Con CI-DS, como en v9, los pasos que estaban corriendo quedan «cancelled» y los que todavía no
 * habían empezado quedan «skipped»: a esos nadie los canceló, simplemente no llegaron a correr. Si
 * una vuelta tiene el cerrojo, se reintenta 5 veces cada 500 ms antes de rendirse; la espera se
 * inyecta (`esperar`) para poder probarlo sin esperar de verdad.
 *
 * En IBP no se le pide nada a SAP (`cancelInSap: false` en su política): se corta solo la
 * orquestación, como en v8, y todo lo no terminado queda «cancelled» y a la primera.
 */
export async function cancelRun(
  clientId,
  orchestrationId,
  ahora = Date.now(),
  { esperar = esperarMs } = {},
) {
  const orquestacion = await getOrchestration(clientId, orchestrationId)
  if (!orquestacion) throw new Error('La orquestación no existe para este cliente.')

  const destino = { clientId, connectionId: orquestacion.connectionId, production: orquestacion.production }

  // No poder resolver el adaptador NO impide cancelar: el estado local se corta igual, que es lo
  // que quien pulsó cancelar espera. Solo se pierde el aviso a SAP. Se resuelve antes del cerrojo
  // porque su política dice cuántas veces se intenta tomarlo.
  let adaptador = null
  try {
    adaptador = adaptadorPara((await getConnectionTarget(clientId, orquestacion.connectionId)).kind)
  } catch {
    adaptador = null
  }
  const politica = politicaDe(adaptador)

  const cortar = async () => {
    const run = await getRun(clientId, orchestrationId)
    if (!run) throw new Error('Esta orquestación no tiene ninguna ejecución registrada.')
    if (esTerminal(run.status)) return run

    const enMarcha = []
    for (const paso of Object.values(run.nodes)) {
      if (paso.status === 'running' && paso.sapRunId) enMarcha.push(paso)
      for (const hijo of Object.values(paso.children ?? {})) {
        if (hijo.status === 'running' && hijo.sapRunId) enMarcha.push(hijo)
      }
    }

    // IBP no avisa a SAP: el orquestador de v8 solo dejaba de preguntar, y los trabajos lanzados
    // terminaban por su cuenta. Ver la política de su adaptador.
    const avisarASap = adaptador && politica.cancelInSap

    await Promise.allSettled((avisarASap ? enMarcha : []).map(async (paso) => {
      try {
        await adaptador?.cancelar(destino, paso.sapRunId)
      } catch {
        // SAP decide si alcanza a detenerla; el estado local se marca igual.
      }
    }))

    const instante = new Date(ahora).toISOString()
    const cortarPaso = (paso) => {
      if (isStepDone(paso.status)) return paso
      // Lo que no llegó a arrancar no se «cancela»: se omite, como en v9. Con la política de IBP
      // todo queda cancelado, como en v8.
      if (paso.status === 'pending' && politica.cancelSkipsPending) {
        return { ...paso, status: 'skipped', finishedAt: instante }
      }
      return { ...paso, status: 'cancelled', finishedAt: instante }
    }

    return guardarRun(clientId, orchestrationId, {
      ...run,
      status: 'cancelled',
      finishedAt: instante,
      nodes: Object.fromEntries(Object.entries(run.nodes).map(([id, paso]) => [id, {
        ...cortarPaso(paso),
        ...(paso.children
          ? { children: Object.fromEntries(Object.entries(paso.children).map(([h, hijo]) => [h, cortarPaso(hijo)])) }
          : {}),
      }])),
    })
  }

  const intentos = Math.max(1, politica.cancelLockAttempts)
  for (let intento = 1; intento <= intentos; intento += 1) {
    const cortado = await conCerrojo(clientId, orchestrationId, cortar)
    if (cortado) return cortado
    if (intento < intentos) await esperar(ESPERA_ENTRE_INTENTOS_DE_CORTAR_MS)
  }

  // v9 aquí devolvía la ejecución SIN cortar, como si hubiera salido bien. Se dice que no se pudo:
  // quien pulsó cancelar tiene que saber que la carga sigue corriendo.
  throw new Error('La ejecución está avanzando en este momento; prueba de nuevo en unos segundos.')
}
