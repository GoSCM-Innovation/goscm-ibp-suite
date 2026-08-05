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

const sessionKey = (clientId, connectionId) => tenantKey(clientId, 'cids-session', connectionId)

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
 * Con `force` se descarta el guardado y se vuelve a identificar.
 */
export async function getCidsSession(clientId, connectionId, { force = false } = {}) {
  const redis = getRedis()
  const key = sessionKey(clientId, connectionId)

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
    isProduction: target.isProduction,
  })

  await redis.set(key, sessionId, { ex: CACHED_SESSION_SECONDS })
  return sessionId
}

/** Olvida la sesión guardada. Se llama cuando SAP la rechaza. */
export async function forgetCidsSession(clientId, connectionId) {
  await getRedis().del(sessionKey(clientId, connectionId))
}
