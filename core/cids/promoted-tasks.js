// Qué tareas de un repositorio de pruebas existen ADEMÁS en el productivo.
//
// Es decir: qué está ya transportado. Portado del `usePromotedTasks` de v9.
//
// La clave está en cómo se llega al repositorio productivo, y es más simple de lo que parece: una
// conexión de CI-DS da acceso a los DOS. `isProduction` es un campo del logon, así que con la misma
// dirección, la misma organización y las mismas credenciales se entra a uno o al otro. No hay una
// segunda conexión que configurar ni nada que enlazar — es la misma con otra bandera. v9 lo hacía
// exactamente así, abriendo las dos sesiones al identificarse.
//
// Lo que sí cambia respecto de v9: allí las dos sesiones vivían en el navegador y las consultas al
// productivo salían de ahí. Aquí las hace el servidor, y el navegador no ve ninguna de las dos.

import { getRedis, tenantKey } from '../persistence/redis.js'
import { getCidsTarget } from './session.js'
import { runCidsOperation } from './operations.js'
import { runPool } from './pool.js'

/**
 * Cuánto vale la lista guardada.
 *
 * Armarla cuesta una consulta por proyecto del repositorio productivo, así que sin caché cada vez
 * que alguien abre el módulo se pagarían decenas de consultas. Quince minutos es un equilibrio
 * deliberado: transportar una tarea a producción no pasa cada minuto, y lo que se arriesga con un
 * dato viejo es una marca de más o de menos —nunca una acción equivocada, porque esto no habilita
 * ni bloquea nada.
 */
export const PROMOTED_CACHE_SECONDS = 15 * 60

/** Cuántas consultas de tareas van a la vez contra el repositorio productivo. */
export const PROMOTED_CONCURRENCY = 6

const promotedKey = (clientId, connectionId) => tenantKey(clientId, 'cids-promoted', connectionId)

/** Así se comparan los nombres: sin espacios en las puntas y en mayúsculas. Como en v9. */
export const normalizeTaskName = (taskName) => String(taskName ?? '').trim().toUpperCase()

/**
 * Los nombres de tarea que hay en el repositorio productivo de esta conexión.
 *
 * Devuelve `null` —y no una lista vacía— cuando la comparación no aplica, o sea cuando la conexión
 * ya apunta al productivo. La diferencia importa: con `null` la interfaz no muestra nada, mientras
 * que con una lista vacía diría "ninguna tarea está transportada", que es una afirmación distinta.
 */
export async function getPromotedTaskNames(clientId, connectionId, { production = false } = {}) {
  // Mirando el productivo no hay con qué comparar: todo lo que se ve ya está ahí. `production` es el
  // repositorio que se está mirando, no una propiedad de la conexión — una conexión de CI-DS da
  // acceso a los dos.
  if (production) return null

  // Se comprueba que la conexión exista y sea de CI-DS antes de tocar la caché.
  await getCidsTarget(clientId, connectionId)

  const redis = getRedis()
  const key = promotedKey(clientId, connectionId)
  const guardada = await redis.get(key)
  if (Array.isArray(guardada)) return guardada

  const nombres = await listarTareasProductivas(clientId, connectionId)
  await redis.set(key, nombres, { ex: PROMOTED_CACHE_SECONDS })
  return nombres
}

/** Descarta la lista guardada, para forzar un recálculo. */
export async function forgetPromotedTaskNames(clientId, connectionId) {
  await getRedis().del(promotedKey(clientId, connectionId))
}

/**
 * Todos los nombres de tarea del repositorio productivo: sus proyectos y las tareas de cada uno.
 *
 * `production: true` es lo único que distingue estas consultas de las normales, y es lo que hace que
 * vayan al otro repositorio de la misma conexión.
 *
 * Un proyecto cuya consulta falla se descarta en silencio, como en v9. La alternativa —tumbar la
 * lista entera— dejaría la comparación sin hacer por un solo proyecto con problemas, y lo que se
 * pierde es una marca, no un dato del que dependa una decisión.
 */
async function listarTareasProductivas(clientId, connectionId) {
  const enProduccion = { clientId, connectionId, production: true }

  const proyectos = await runCidsOperation({ ...enProduccion, operation: 'getProjects' })
  const conGuid = (Array.isArray(proyectos) ? proyectos : []).filter((proyecto) => proyecto.guid)

  const nombres = new Set()
  await runPool(conGuid, PROMOTED_CONCURRENCY, async (proyecto) => {
    try {
      const tareas = await runCidsOperation({
        ...enProduccion,
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
