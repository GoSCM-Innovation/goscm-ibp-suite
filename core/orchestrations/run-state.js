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
 */
export function decideForPending(predecesores, estados, configPorId) {
  const todosTerminados = predecesores.every((id) => isStepDone(estados[id]?.status))
  if (!todosTerminados) return 'esperar'

  const bloqueado = predecesores.some((id) => {
    const estado = estados[id]?.status
    if (estado === 'skipped' || estado === 'cancelled') return true
    if (estado === 'error') return (configPorId[id]?.errorStrategy ?? 'stop') === 'stop'
    return false
  })

  return bloqueado ? 'saltear' : 'lanzar'
}

/**
 * Cómo quedó la ejecución mirando sus pasos de primer nivel.
 *
 * Sigue corriendo mientras quede alguno sin terminar. Una sola fallada la deja fallada: si algo no
 * se hizo, decir que la carga salió bien sería mentir.
 */
export function runOutcome(topNodeIds, estados) {
  const terminados = topNodeIds.every((id) => isStepDone(estados[id]?.status))
  if (!terminados) return 'running'
  return topNodeIds.some((id) => estados[id]?.status === 'error') ? 'error' : 'success'
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
