// La sesión con SAP CI-DS.
//
// Cambio de fondo respecto a v9: allí el identificador de sesión vivía en el navegador y se
// mandaba en cada llamada, junto con la URL del endpoint. Aquí vive en el servidor, guardado
// en Redis por cliente y conexión. El navegador nunca lo ve — igual que nunca ve las
// credenciales.
//
// Sobre la duración: SAP decide cuándo caduca su sesión y no anuncia cuánto dura. Lo que hay
// aquí es la vida de NUESTRA copia, deliberadamente más corta de lo que suele durar la suya.
// Si aun así SAP la da por vencida antes, no pasa nada: quien la usa detecta el rechazo,
// vuelve a identificarse y reintenta. Esa es la red de seguridad de verdad; el tiempo de
// aquí solo evita identificarse en cada clic.

import { getRedis, tenantKey } from '../persistence/redis.js'
import { CIDS_AGREEMENT, getConnectionTarget, getCredentials } from '../connections/connections.js'
import { logon } from '../soap/client.js'

export const CACHED_SESSION_SECONDS = 20 * 60

/**
 * Una conexión de CI-DS da acceso a DOS repositorios, no a uno.
 *
 * `isProduction` es un campo del logon, no de la conexión: con la misma dirección, la misma
 * organización y las mismas credenciales, la bandera decide si entrás al repositorio de pruebas o
 * al productivo. Por eso hay dos sesiones posibles por conexión y cada una se guarda por separado —
 * mezclarlas daría datos del repositorio equivocado.
 */
const sessionKey = (clientId, connectionId, production) => (
  tenantKey(clientId, production ? 'cids-session-prd' : 'cids-session', connectionId)
)

/** La conexión de CI-DS, comprobando que sea de ese tipo antes de intentar nada. */
export async function getCidsTarget(clientId, connectionId) {
  const target = await getConnectionTarget(clientId, connectionId)
  if (target.kind !== 'cids') {
    throw new Error(`La conexión "${target.name}" no es de CI-DS.`)
  }
  return target
}

/**
 * Identificador de sesión con CI-DS, reutilizando el guardado si sigue vigente.
 *
 * Con `force` se descarta el guardado y se vuelve a identificar. Con `production` se entra al
 * repositorio productivo aunque la conexión sea de pruebas, que es lo que hace falta para saber qué
 * tareas ya están transportadas.
 *
 * La conexión se lee solo cuando hay que identificarse: con la sesión guardada no se toca la base.
 */
export async function getCidsSession(clientId, connectionId, { force = false, production = false } = {}) {
  const redis = getRedis()
  const key = sessionKey(clientId, connectionId, production)

  if (!force) {
    const cached = await redis.get(key)
    if (cached) return cached
  }

  const target = await getCidsTarget(clientId, connectionId)
  const { user, password } = await getCredentials(clientId, connectionId, CIDS_AGREEMENT)

  const sessionId = await logon({
    serviceUrl: target.baseUrl,
    orgName: target.organization,
    user,
    password,
    // Pedir el productivo manda; si no se pide, se usa el repositorio propio de la conexión.
    isProduction: production || target.isProduction,
  })

  await redis.set(key, sessionId, { ex: CACHED_SESSION_SECONDS })
  return sessionId
}

/**
 * Olvida la sesión guardada. Se llama cuando SAP la rechaza.
 * Hay que olvidar la MISMA que se estaba usando: borrar la de pruebas no arregla nada si la que
 * venció era la del productivo.
 */
export async function forgetCidsSession(clientId, connectionId, { production = false } = {}) {
  await getRedis().del(sessionKey(clientId, connectionId, production))
}
