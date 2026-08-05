// Ejecutar una operación de CI-DS con la conexión de un cliente.
//
// Es el único camino que usan los endpoints: recibe el cliente, la conexión y qué hacer, y se
// encarga de identificarse, de reutilizar la sesión y de volver a identificarse si SAP la da
// por vencida. Quien llama no sabe que existe una sesión.
//
// Las operaciones que se pueden pedir están en una lista cerrada. No es paranoia: sin ella,
// cualquiera con acceso al endpoint podría invocar operaciones del servicio SOAP que la
// aplicación nunca pensó exponer.

import { SoapSessionExpiredError, callOperation } from '../soap/client.js'
import { forgetCidsSession, getCidsSession, getCidsTarget } from './session.js'

/** Operaciones de lectura: no cambian nada en CI-DS. */
export const READ_OPERATIONS = Object.freeze([
  'ping',
  'getProjects',
  'getProjectTasks',
  'searchTasks',
  'getTaskInfo',
  'getAgents',
  'getSystemConfigurations',
  'getAllExecutedTasks2',
  'getTaskStatusByRunId2',
  'getTaskLogs',
])

/** Operaciones que hacen algo: lanzar o cancelar una tarea. */
export const WRITE_OPERATIONS = Object.freeze(['runTask', 'cancelTask'])

export const ALLOWED_OPERATIONS = Object.freeze([...READ_OPERATIONS, ...WRITE_OPERATIONS])

export function isWriteOperation(operation) {
  return WRITE_OPERATIONS.includes(operation)
}

/**
 * Ejecuta la operación y devuelve el resultado ya interpretado.
 *
 * Si SAP rechaza la sesión, se vuelve a identificar y se reintenta UNA vez. Solo una: si la
 * segunda también falla, el problema no es la sesión y reintentar en bucle solo esconde el
 * error de verdad.
 */
export async function runCidsOperation({ clientId, connectionId, operation, params = {}, debug = false }) {
  if (!ALLOWED_OPERATIONS.includes(operation)) {
    throw new Error(`Operación no permitida: "${operation}".`)
  }

  const target = await getCidsTarget(clientId, connectionId)
  let sessionId = await getCidsSession(clientId, connectionId)

  const ejecutar = () => callOperation({
    serviceUrl: target.baseUrl,
    sessionId,
    operation,
    params,
    debug,
  })

  try {
    return await ejecutar()
  } catch (error) {
    if (!(error instanceof SoapSessionExpiredError)) throw error
    await forgetCidsSession(clientId, connectionId)
    sessionId = await getCidsSession(clientId, connectionId, { force: true })
    return ejecutar()
  }
}
