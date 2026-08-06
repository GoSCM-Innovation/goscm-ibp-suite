// Lo que la interfaz necesita para trabajar con orquestaciones.
//
// Igual que el resto del módulo: todo pasa por nuestra API, y el navegador nunca sabe la dirección
// del tenant ni las credenciales.

import { api } from './api.js'

/** Las orquestaciones de un destino: una conexión y uno de sus dos repositorios. */
export async function listOrchestrations(destino) {
  const { orchestrations } = await api.get('/api/cids/orchestrations', {
    connectionId: destino.connectionId,
    production: String(destino.production),
  })
  return orchestrations
}

/** Una orquestación con su grafo completo. */
export async function getOrchestration(id) {
  const { orchestration } = await api.get('/api/cids/orchestrations', { id })
  return orchestration
}

export async function createOrchestration(destino, name) {
  const { orchestration } = await api.post('/api/cids/orchestrations', {
    connectionId: destino.connectionId,
    production: destino.production,
    name,
    nodes: [],
    edges: [],
  })
  return orchestration
}

/**
 * Guarda cambios. Lo que no se manda no se toca.
 *
 * El grafo se manda entero, nunca a medias: el servidor lo valida completo —una conexión nueva puede
 * apuntar a un nodo que ya no está— y validar media cosa no demuestra nada.
 */
export async function saveOrchestration(id, cambios) {
  const { orchestration } = await api.patch('/api/cids/orchestrations', { id, ...cambios })
  return orchestration
}

export async function duplicateOrchestration(id) {
  const { orchestration } = await api.post('/api/cids/orchestrations', { action: 'duplicate', id })
  return orchestration
}

export async function deleteOrchestration(id) {
  await api.del('/api/cids/orchestrations', { id })
}

// ─── Ejecución ──────────────────────────────────────────────────────────────────────────────────

/** El estado de la última ejecución, o `null` si nunca se ejecutó. */
export async function getRun(id) {
  const { run } = await api.get('/api/cids/orchestration-run', { id })
  return run
}

const accion = async (id, action, extra = {}) => {
  const { run } = await api.post('/api/cids/orchestration-run', { id, action, ...extra })
  return run
}

export const startRun = (id, defaults) => accion(id, 'start', { defaults })
export const resumeRun = (id) => accion(id, 'resume')
export const cancelRun = (id) => accion(id, 'cancel')

/**
 * Empuja la ejecución un paso.
 *
 * La pantalla la va llamando mientras esté abierta. No es un detalle de implementación que se pueda
 * esconder: hoy es lo ÚNICO que hace avanzar una orquestación, porque el reloj del servidor existe
 * pero todavía no está declarado en Vercel. Si se cierra la pantalla, la ejecución queda donde está
 * y se retoma después sin repetir lo que ya salió bien.
 */
export const tickRun = (id) => accion(id, 'tick')

/** Estados en los que una ejecución ya no avanza. Tiene que coincidir con `core/orchestrations`. */
export const TERMINAL_RUN_STATUSES = Object.freeze(['success', 'error', 'cancelled'])

export const isRunFinished = (run) => Boolean(run) && TERMINAL_RUN_STATUSES.includes(run.status)
