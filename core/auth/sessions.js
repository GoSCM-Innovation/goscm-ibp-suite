// La sesión: lo que hace que la app te recuerde después de que demostraste quién eres.
//
// Esta pieza no sabe cómo lo demostraste. Recibe un usuario ya resuelto y abre la sesión;
// el día que existan Microsoft y Google entrarán por aquí sin cambiar nada.
//
// En el navegador solo vive un identificador aleatorio dentro de una cookie httpOnly. Los
// datos están en Redis: la cookie por sí sola no dice nada de nadie, y JavaScript de la
// página no puede leerla.
//
// Renovación por uso: la sesión dura una jornada laboral y el reloj se reinicia mientras la
// persona trabaja, pero solo cuando ya se consumió más de la mitad. Renovar en cada petición
// gastaría un comando de Redis por clic sin ganar nada.

import { randomBytes } from 'node:crypto'
import { getRedis, globalKey } from '../persistence/redis.js'

export const SESSION_TTL_SECONDS = 12 * 60 * 60
const RENEW_WHEN_REMAINING_BELOW = SESSION_TTL_SECONDS / 2

const sessionKey = (id) => globalKey('session', id)
const userSessionsKey = (userId) => globalKey('user-sessions', userId)

/**
 * 32 bytes de entropía criptográfica. Es lo único que separa a un desconocido de la sesión
 * de otra persona, así que no se escatima ni se usa nada predecible.
 */
export function generateSessionId() {
  return randomBytes(32).toString('base64url')
}

export async function createSession({ userId, clientId, isAdmin, email, name }) {
  const redis = getRedis()
  const id = generateSessionId()

  await redis.set(
    sessionKey(id),
    { userId, clientId, isAdmin: Boolean(isAdmin), email, name: name ?? null },
    { ex: SESSION_TTL_SECONDS },
  )

  // Índice para poder cerrar de golpe todas las sesiones de una persona cuando el
  // administrador le quita el acceso. Sin esto, dar de baja a alguien no lo echaría hasta
  // que su sesión venciera sola.
  await redis.sadd(userSessionsKey(userId), id)
  await redis.expire(userSessionsKey(userId), SESSION_TTL_SECONDS)

  return id
}

export async function readSession(sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return null

  const redis = getRedis()
  const session = await redis.get(sessionKey(sessionId))
  if (!session) return null

  const remaining = await redis.ttl(sessionKey(sessionId))
  if (remaining >= 0 && remaining < RENEW_WHEN_REMAINING_BELOW) {
    await redis.expire(sessionKey(sessionId), SESSION_TTL_SECONDS)
    await redis.expire(userSessionsKey(session.userId), SESSION_TTL_SECONDS)
  }

  return { id: sessionId, ...session }
}

export async function destroySession(sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return
  const redis = getRedis()
  const session = await redis.get(sessionKey(sessionId))
  await redis.del(sessionKey(sessionId))
  if (session?.userId) await redis.srem(userSessionsKey(session.userId), sessionId)
}

/**
 * Cierra todas las sesiones abiertas de una persona. Lo usa el panel de administración al
 * dar de baja a alguien o al cambiarle los permisos: los permisos viajan dentro de la
 * sesión, así que cambiarlos sin cerrar sesiones dejaría los antiguos vigentes hasta que
 * venciera sola.
 */
export async function destroyUserSessions(userId) {
  const redis = getRedis()
  const ids = (await redis.smembers(userSessionsKey(userId))) ?? []
  for (const id of ids) await redis.del(sessionKey(id))
  await redis.del(userSessionsKey(userId))
  return ids.length
}
