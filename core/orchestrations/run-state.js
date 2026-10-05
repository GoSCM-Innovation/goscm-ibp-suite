// El estado de una ejecución y qué toca hacer en cada vuelta del reloj.
//
// La otra mitad de las reglas del motor, y también pura: recibe el grafo y el estado, y dice qué
// lanzar, qué saltear y si la ejecución terminó. No toca Redis ni SAP — eso lo hace `runner.js` con
// lo que aquí se decide.
//
// Por qué el motor va por vueltas y no de corrido: una función serverless se corta a los diez
// segundos y una orquestación puede durar horas. Así que cada vuelta mira qué pasos están corriendo,
// lanza los que ya pueden, guarda y se va. Un reloj externo la vuelve a llamar.
//
// Portado de `tick` de `api/orchestrate.js` de v9, incluido su hallazgo principal: **cada paso se
// programa por sus propios predecesores, no por "olas"**. Con olas, dos cadenas independientes
// (A→B y C→D) se esperarían entre sí sin motivo; por predecesores, cada una avanza a su ritmo.

import { isStepDone } from './step-outcome.js'

/**
 * Las reglas del motor que NO son iguales para todos los tipos de conexión.
 *
 * El motor es uno solo, pero sustituye a dos orquestadores que se portan cada uno tal cual: el de v9
 * para CI-DS y el de v8 para los Application Jobs de IBP. En lo que el usuario ve —qué pasa con un
 * paso cancelado, si se avisa a SAP al cortar, cómo termina la ejecución— los dos no decidían igual,
 * y aquí está escrita cada diferencia con su nombre. Cada adaptador trae la suya (`politica`, en
 * `adapters.js`); esta es la de CI-DS, que también vale cuando un adaptador no trae ninguna.
 *
 *   - `cancelInSap`: al cortar, pedirle a SAP que detenga lo que está corriendo.
 *   - `cancelledBlocks`: un paso cancelado saltea lo que viene detrás.
 *   - `exhaustedRetryBlocks`: un paso con «reintentar» que agotó los reintentos saltea lo que viene
 *     detrás (si no, se trata como «continuar»).
 *   - `assumedFailureFailsRun`: un paso fallado con «continuar» deja la ejecución en error al final.
 *   - `cancelledChildCancelsGroup`: un hijo cancelado deja cancelado a su grupo.
 *   - `cancelledCodes`: los códigos de SAP que dejan el paso cancelado. Ver `nextStepState`.
 *   - `cancelSkipsPending`: al cortar la ejecución, los pasos que no habían arrancado quedan
 *     «omitidos» (`skipped`) y solo los que corrían quedan «cancelados». Sin esto, todo queda cancelado.
 *   - `cancelLockAttempts`: cuántas veces se intenta tomar el cerrojo al cortar (500 ms entre una y
 *     otra) antes de rendirse, por si una vuelta lo tiene en ese instante.
 */
export const DEFAULT_RUN_POLICY = Object.freeze({
  cancelSkipsPending: true,
  cancelLockAttempts: 5,
  cancelInSap: true,
  cancelledBlocks: true,
  exhaustedRetryBlocks: false,
  assumedFailureFailsRun: true,
  cancelledChildCancelsGroup: false,
  cancelledCodes: Object.freeze([]),
})

/** El estado inicial de un paso, antes de que arranque nada. */
const pasoPendiente = (nodeId) => ({
  nodeId,
  status: 'pending',
  sapRunId: null,
  sapStatusCode: null,
  startedAt: null,
  finishedAt: null,
  error: null,
  retryCount: 0,
  retryAt: null,
})

/**
 * El estado de arranque de una ejecución: todos los pasos pendientes.
 *
 * Los hijos de un grupo cuelgan del estado del grupo, igual que en v9: así el grupo se puede dar por
 * terminado mirando solo lo suyo.
 */
export function initRunState(nodes, startedAt) {
  const porId = {}

  for (const nodo of nodes) {
    if (nodo.parentId) continue
    if (nodo.type === 'group') {
      const hijos = nodes.filter((otro) => otro.parentId === nodo.id)
      porId[nodo.id] = {
        ...pasoPendiente(nodo.id),
        type: 'group',
        children: Object.fromEntries(hijos.map((hijo) => [hijo.id, pasoPendiente(hijo.id)])),
      }
    } else {
      porId[nodo.id] = { ...pasoPendiente(nodo.id), type: 'task' }
    }
  }

  return { status: 'running', startedAt, finishedAt: null, nodes: porId }
}

/** Qué pasos tiene que esperar cada uno. Solo cuentan las conexiones entre nodos del mismo nivel. */
export function directPredecessors(nodes, edges) {
  const deQuienDepende = new Map(nodes.map((nodo) => [nodo.id, []]))
  for (const arista of edges) {
    if (!deQuienDepende.has(arista.source) || !deQuienDepende.has(arista.target)) continue
    deQuienDepende.get(arista.target).push(arista.source)
  }
  return deQuienDepende
}

/**
 * Qué hacer con un paso pendiente: esperar, lanzarlo, o saltearlo.
 *
 * Se saltea cuando algo de lo que depende no llegó a buen puerto:
 *   - un predecesor salteado arrastra a los que vienen detrás;
 *   - un predecesor fallado lo bloquea SOLO si su estrategia era parar. Con "continuar" el fallo se
 *     da por asumido y la cadena sigue, que es justamente para lo que existe esa estrategia.
 *
 * Con la política de IBP (v8) cambian dos cosas: un paso cancelado NO bloquea, y uno que agotó sus
 * reintentos SÍ. Ver `DEFAULT_RUN_POLICY`.
 */
export function decideForPending(predecesores, estados, configPorId, politica = DEFAULT_RUN_POLICY) {
  const todosTerminados = predecesores.every((id) => isStepDone(estados[id]?.status))
  if (!todosTerminados) return 'esperar'

  const bloqueado = predecesores.some((id) => {
    const estado = estados[id]?.status
    if (estado === 'skipped') return true
    if (estado === 'cancelled') return politica.cancelledBlocks
    if (estado === 'error') {
      const estrategia = configPorId[id]?.errorStrategy ?? 'stop'
      if (estrategia === 'stop') return true
      return estrategia === 'retry' && politica.exhaustedRetryBlocks
    }
    return false
  })

  return bloqueado ? 'saltear' : 'lanzar'
}

/**
 * Cómo quedó la ejecución mirando sus pasos de primer nivel.
 *
 * Sigue corriendo mientras quede alguno sin terminar. Una sola fallada la deja fallada: si algo no
 * se hizo, decir que la carga salió bien sería mentir.
 *
 * Salvo con la política de IBP: allí, como en v8, un paso fallado con «continuar» no cuenta —la
 * cadena siguió y la ejecución termina «Completado»—. Para eso hace falta la configuración de cada
 * paso (`configPorId`).
 */
export function runOutcome(topNodeIds, estados, { configPorId = {}, politica = DEFAULT_RUN_POLICY } = {}) {
  const terminados = topNodeIds.every((id) => isStepDone(estados[id]?.status))
  if (!terminados) return 'running'

  const fallada = topNodeIds.some((id) => {
    if (estados[id]?.status !== 'error') return false
    if (politica.assumedFailureFailsRun) return true
    return (configPorId[id]?.errorStrategy ?? 'stop') !== 'continue'
  })
  return fallada ? 'error' : 'success'
}

/**
 * Cómo quedó un grupo mirando sus hijos.
 *
 * Un hijo fallado deja fallado al grupo, sea cual sea la estrategia del hijo: la que decide si la
 * cadena sigue es la del GRUPO. Con la política de IBP, además, un hijo cancelado deja cancelado al
 * grupo —antes que un fallo, como en v8— y la cadena sigue.
 */
export function groupOutcome(childIds, estados, politica = DEFAULT_RUN_POLICY) {
  const terminados = childIds.every((id) => isStepDone(estados[id]?.status))
  if (!terminados) return 'running'
  if (politica.cancelledChildCancelsGroup && childIds.some((id) => estados[id]?.status === 'cancelled')) {
    return 'cancelled'
  }
  return childIds.some((id) => estados[id]?.status === 'error') ? 'error' : 'success'
}

/**
 * Deja la ejecución lista para retomarse desde donde falló.
 *
 * Lo que salió bien se conserva —volver a lanzar una carga que ya entró la duplicaría en SAP— y todo
 * lo demás vuelve a pendiente, incluido lo salteado: si el paso que lo bloqueaba ahora sale bien, le
 * toca correr.
 *
 * Devuelve un estado nuevo; no modifica el que recibe.
 */
export function resetForResume(run) {
  const reiniciarPaso = (paso) => (
    paso.status === 'success' || paso.status === 'success_with_errors'
      ? paso
      : { ...pasoPendiente(paso.nodeId), type: paso.type, children: paso.children }
  )

  const nodes = Object.fromEntries(Object.entries(run.nodes).map(([id, paso]) => {
    if (paso.type !== 'group') return [id, reiniciarPaso(paso)]
    if (paso.status === 'success' || paso.status === 'success_with_errors') return [id, paso]
    return [id, {
      ...reiniciarPaso(paso),
      children: Object.fromEntries(
        Object.entries(paso.children ?? {}).map(([hijoId, hijo]) => [hijoId, reiniciarPaso(hijo)]),
      ),
    }]
  }))

  return { ...run, status: 'running', finishedAt: null, nodes }
}
