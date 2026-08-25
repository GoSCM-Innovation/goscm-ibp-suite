// El fin y la duración de una ejecución de CI-DS.
//
// La lista de ejecuciones (`getAllExecutedTasks2`) trae nombre, inicio y estado, pero NO el fin
// ni la duración: eso es una consulta aparte por cada ejecución. Con 50 filas en pantalla son
// 50 consultas, y de ahí sale todo lo que hay aquí.
//
// v9 las lanzaba desde el navegador, una petición por fila. Aquí van del lado del servidor: el
// navegador pide una tanda y el servidor la resuelve. Cambia el número de peticiones a nuestra
// API (de 50 a 4), no el tráfico hacia SAP, que sigue siendo una consulta por ejecución con el
// mismo tope de concurrencia.

import { runCidsOperation } from './operations.js'
import { runPool } from './pool.js'

/**
 * Cuántas consultas a SAP van a la vez. Portado de v9.
 *
 * No se sube: cada consulta es trabajo real en el tenant, y el monitor no es lo único que lo
 * está usando. Seis fue el número con el que v9 vivió en producción.
 */
export const DETAIL_CONCURRENCY = 6

/**
 * Cuántas ejecuciones acepta una tanda.
 *
 * Es un límite del despliegue, no de SAP: una función de Vercel se corta a los diez segundos, y
 * cincuenta consultas en tandas de seis no entran ahí. El navegador parte la página en tandas y las
 * pide en paralelo, así que cada función queda corta. Subir este número es la forma de que el
 * monitor empiece a fallar por tiempo justo cuando el tenant está lento.
 */
export const MAX_RUNS_PER_BATCH = 15

/**
 * SAP devuelve la marca de tiempo de fin con separadores que cambian según el tenant
 * ("20260804123000.0000000" o con guiones y T). Quitar todo lo que no sea dígito deja siempre
 * los catorce primeros en el mismo sitio, que es lo que se lee para mostrarla. Es lo que hacía
 * v9 y por eso funcionaba en tenants distintos.
 */
const soloDigitos = (valor) => String(valor || '').replace(/\D/g, '') || null

/**
 * Fin y duración de cada ejecución de la tanda, como mapa `runId → detalle`.
 *
 * Una consulta que falla NO tumba la tanda: esa fila vuelve marcada como fallida y las demás
 * llegan igual. Con cincuenta filas en pantalla, dejar la página en blanco porque una ejecución
 * dio problema sería peor que no mostrar su duración.
 */
export async function fetchTaskDetails({ clientId, connectionId, runIds, production = false }) {
  if (!Array.isArray(runIds)) throw new Error('Hay que indicar qué ejecuciones consultar.')

  // Sin duplicados y sin vacíos: repetir un runId sería pagarle a SAP dos veces lo mismo.
  const pendientes = [...new Set(runIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
  if (pendientes.length === 0) return {}
  if (pendientes.length > MAX_RUNS_PER_BATCH) {
    throw new Error(`Una tanda admite como máximo ${MAX_RUNS_PER_BATCH} ejecuciones; llegaron ${pendientes.length}.`)
  }

  const detalles = {}
  await runPool(pendientes, DETAIL_CONCURRENCY, async (runId) => {
    try {
      const respuesta = await runCidsOperation({
        clientId,
        connectionId,
        operation: 'getTaskStatusByRunId2',
        params: { runId },
        production,
      })
      detalles[runId] = {
        endTime: soloDigitos(respuesta.endTime),
        durationSeconds: respuesta.executionTime == null || respuesta.executionTime === ''
          ? null
          : Number.parseFloat(respuesta.executionTime),
        failed: false,
      }
    } catch {
      // El motivo no se propaga a propósito: quien llama muestra una tabla, no un error por
      // fila. Si el problema es de la conexión, la carga de la lista ya lo va a contar.
      detalles[runId] = { endTime: null, durationSeconds: null, failed: true }
    }
  })

  return detalles
}
