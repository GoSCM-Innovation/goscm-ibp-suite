// Lo que la interfaz necesita para hablar con CI-DS: siempre a través de nuestra API.
//
// El navegador no sabe la dirección del tenant, ni su usuario, ni el identificador de sesión con
// SAP. Todo eso vive en el servidor. Aquí solo se dice a qué conexión y qué operación.

import { api } from './api.js'

/**
 * Cuántas ejecuciones lleva cada tanda al pedir fin y duración.
 *
 * Tiene que ser menor o igual que `MAX_RUNS_PER_BATCH` de `core/cids/task-details.js`, que es
 * quien lo hace cumplir. Está repetido a propósito: el frontend no importa de `core/`.
 */
export const RUNS_PER_BATCH = 15

/** Una operación de CI-DS. Devuelve ya el resultado, sin la envoltura de la respuesta. */
export async function cidsCall(connectionId, operation, params = {}) {
  const { result } = await api.post('/api/cids/call', { connectionId, operation, params })
  return result
}

/** Las conexiones de CI-DS a las que puede apuntar este usuario. */
export async function listCidsConnections() {
  const { connections } = await api.get('/api/connections', { kind: 'cids' })
  return connections
}

/**
 * Los nombres de tarea que este tenant ya tiene en producción, como conjunto para consultarlo
 * rápido. `null` significa que la comparación no aplica —esta conexión es la productiva o no
 * declaró su contraparte— y NO que no haya ninguna transportada.
 */
export async function fetchPromotedTaskNames(connectionId) {
  const { names } = await api.get('/api/cids/promoted', { connectionId })
  return Array.isArray(names) ? new Set(names) : null
}

/** Así se comparan los nombres. Tiene que coincidir con `normalizeTaskName` de `core/cids`. */
export function isTaskPromoted(promoted, taskName) {
  return Boolean(promoted?.has(String(taskName ?? '').trim().toUpperCase()))
}

/**
 * Fin y duración de un puñado de ejecuciones, en tandas.
 *
 * Las tandas van **una tras otra, no en paralelo**. Si salieran a la vez, cada una consultaría a
 * SAP de a seis y el tenant recibiría veinticuatro consultas simultáneas en vez de seis. El
 * precio es una pequeña espera entre tandas; a cambio, el tope de concurrencia contra SAP es el
 * mismo que tenía v9.
 *
 * `shouldStop` se consulta antes de cada tanda: si el usuario ya cambió de página, las que
 * quedan no se piden.
 */
export async function fetchTaskDetails(connectionId, runIds, { shouldStop = () => false } = {}) {
  const detalles = {}

  for (let desde = 0; desde < runIds.length; desde += RUNS_PER_BATCH) {
    if (shouldStop()) break
    const tanda = runIds.slice(desde, desde + RUNS_PER_BATCH)
    const { details } = await api.post('/api/cids/task-details', { connectionId, runIds: tanda })
    Object.assign(detalles, details)
  }

  return detalles
}
