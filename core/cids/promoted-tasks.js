// Qué tareas de un tenant de pruebas existen ADEMÁS en el productivo.
//
// Es decir: qué está ya transportado. Portado del `usePromotedTasks` de v9, con la diferencia de
// fondo de todo este proyecto: allí el navegador guardaba una segunda sesión con el tenant
// productivo y hacía las consultas él; aquí las hace el servidor con las credenciales de la
// conexión productiva, que el navegador no ve nunca.
//
// El enlace entre el tenant de pruebas y su productivo se declara en la conexión (ver la migración
// 004). No se deduce: buscar "la conexión productiva del cliente" acierta mientras haya una sola, y
// el día que haya dos marcaría tareas que no están transportadas sin que nadie se enterara.

import { getRedis, tenantKey } from '../persistence/redis.js'
import { getCidsTarget } from './session.js'
import { runCidsOperation } from './operations.js'
import { runPool } from './pool.js'

/**
 * Cuánto vale la lista guardada.
 *
 * Armarla cuesta una consulta por proyecto del tenant productivo, así que sin caché cada vez que
 * alguien abre el módulo se le pedirían decenas de consultas a producción. Quince minutos es un
 * equilibrio deliberado: transportar una tarea a producción no pasa cada minuto, y lo que se
 * arriesga con un dato viejo es una estrella de más o de menos —nunca una acción equivocada,
 * porque esto no habilita ni bloquea nada.
 */
export const PROMOTED_CACHE_SECONDS = 15 * 60

/** Cuántas consultas de tareas van a la vez contra el tenant productivo. */
export const PROMOTED_CONCURRENCY = 6

const promotedKey = (clientId, connectionId) => tenantKey(clientId, 'cids-promoted', connectionId)

/** Así se comparan los nombres: sin espacios en las puntas y en mayúsculas. Como en v9. */
export const normalizeTaskName = (taskName) => String(taskName ?? '').trim().toUpperCase()

/**
 * Los nombres de tarea del tenant productivo que le corresponde a esta conexión.
 *
 * Devuelve `null` —y no una lista vacía— cuando la comparación no aplica: la conexión ya es la
 * productiva, o no tiene declarada su contraparte. La diferencia importa: con `null` la interfaz no
 * muestra nada, mientras que con una lista vacía diría "ninguna tarea está transportada", que es
 * una afirmación que no podemos hacer.
 */
export async function getPromotedTaskNames(clientId, connectionId) {
  const target = await getCidsTarget(clientId, connectionId)

  // Mirando el productivo no hay con qué comparar.
  if (target.isProduction) return null
  if (!target.productionCounterpartId) return null

  const redis = getRedis()
  const key = promotedKey(clientId, connectionId)
  const guardada = await redis.get(key)
  if (Array.isArray(guardada)) return guardada

  const nombres = await listarTareasDe(clientId, target.productionCounterpartId)
  await redis.set(key, nombres, { ex: PROMOTED_CACHE_SECONDS })
  return nombres
}

/** Descarta la lista guardada. Para cuando cambia el enlace o se fuerza un recálculo. */
export async function forgetPromotedTaskNames(clientId, connectionId) {
  await getRedis().del(promotedKey(clientId, connectionId))
}

/**
 * Todos los nombres de tarea de un tenant: sus proyectos y las tareas de cada uno.
 *
 * Un proyecto cuya consulta falla se descarta en silencio, como en v9. La alternativa —tumbar la
 * lista entera— dejaría la comparación sin hacer por un proyecto con problemas, y lo que se pierde
 * es una estrella, no un dato del que dependa una decisión.
 */
async function listarTareasDe(clientId, connectionId) {
  const proyectos = await runCidsOperation({ clientId, connectionId, operation: 'getProjects' })
  const conGuid = (Array.isArray(proyectos) ? proyectos : []).filter((proyecto) => proyecto.guid)

  const nombres = new Set()
  await runPool(conGuid, PROMOTED_CONCURRENCY, async (proyecto) => {
    try {
      const tareas = await runCidsOperation({
        clientId,
        connectionId,
        operation: 'getProjectTasks',
        params: { projectGuid: proyecto.guid },
      })
      for (const tarea of Array.isArray(tareas) ? tareas : []) {
        const nombre = normalizeTaskName(tarea.taskName)
        if (nombre) nombres.add(nombre)
      }
    } catch {
      // Proyecto con problemas: se sigue con los demás.
    }
  })

  // Ordenados para que la lista guardada sea estable entre recálculos.
  return [...nombres].sort()
}
