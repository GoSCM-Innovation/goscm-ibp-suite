// Código de un solo uso enviado al correo.
//
// Demuestra que quien entra controla ese buzón — exactamente lo mismo que demuestra un
// proveedor de SSO, sin contraseñas que crear, repartir, olvidar ni custodiar.
//
// Lo que protege el mecanismo, en orden de importancia:
//   1. El límite de intentos. Un código de 6 dígitos tiene un millón de combinaciones; sin
//      límite, adivinarlo es cuestión de minutos. Con 5 intentos, la probabilidad de acertar
//      es de 5 en un millón antes de que el código muera.
//   2. La vida corta: 10 minutos.
//   3. Un solo uso: al validarlo se borra.
//   4. El tope de envíos por correo y por IP, que impide usar esto para inundar buzones
//      ajenos o para averiguar qué direcciones están dadas de alta.
//
// En Redis se guarda una huella HMAC del código, nunca el código. Que no se malinterprete:
// contra quien tenga a la vez el volcado de Redis y SESSION_SECRET, la huella de un número
// de seis cifras no resiste nada — la protección real es el límite de intentos. Lo que sí
// evita es que un volcado de Redis, por sí solo, entregue códigos utilizables.

import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import { getRedis, globalKey } from '../persistence/redis.js'
import { findUserForLogin } from './identity.js'
import { deliverCode } from './delivery.js'

export const CODE_TTL_SECONDS = 10 * 60
export const MAX_VERIFICATION_ATTEMPTS = 5

const THROTTLE_WINDOW_SECONDS = 15 * 60
const MAX_REQUESTS_PER_EMAIL = 5
const MAX_REQUESTS_PER_IP = 20

// Las partes de una clave de Redis no pueden llevar ":" (lo impide `globalKey`), y una IPv6
// está llena de ellos. Se resumen en una huella, que además evita dejar direcciones y
// correos legibles en las claves.
const digest = (value) => createHash('sha256').update(String(value)).digest('hex')

const codeKey = (email) => globalKey('login', 'code', digest(email))
const attemptsKey = (email) => globalKey('login', 'attempts', digest(email))
const emailThrottleKey = (email) => globalKey('login', 'throttle-email', digest(email))
const ipThrottleKey = (ip) => globalKey('login', 'throttle-ip', digest(ip))

function fingerprint(email, code) {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('Falta SESSION_SECRET: no se puede firmar el código de acceso.')
  return createHmac('sha256', secret).update(`${email}:${code}`).digest('hex')
}

/** Seis dígitos con entropía criptográfica. `Math.random` no sirve para esto. */
export function generateCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/** Comparación de huellas resistente a temporización. */
function sameFingerprint(a, b) {
  const left = Buffer.from(String(a), 'utf8')
  const right = Buffer.from(String(b), 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

async function withinLimit(key, max) {
  const redis = getRedis()
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, THROTTLE_WINDOW_SECONDS)
  return count <= max
}

/**
 * Genera y entrega un código si el correo corresponde a un usuario que puede entrar.
 *
 * Devuelve siempre la misma forma y NUNCA el código: quien llama no puede distinguir un
 * correo dado de alta de uno que no existe. Ese detalle es lo que impide convertir la
 * pantalla de ingreso en una herramienta para averiguar quiénes son tus clientes.
 *
 * El motivo (`reason`) es para los registros del servidor, no para la respuesta al navegador.
 */
export async function requestCode({ email, ip }) {
  if (ip && !(await withinLimit(ipThrottleKey(ip), MAX_REQUESTS_PER_IP))) {
    return { delivered: false, reason: 'demasiadas solicitudes desde esta IP' }
  }

  const user = await findUserForLogin(email, 'email')
  if (!user) return { delivered: false, reason: 'sin usuario activo para ese correo' }

  // Siempre en minúsculas: si la clave dependiera de cómo se escribió el correo, alternar
  // mayúsculas bastaría para saltarse el tope.
  const normalized = user.email.toLowerCase()

  // El tope por correo va después de resolver el usuario: así una dirección que no existe
  // no consume ni deja rastro de cupo, y no se puede sondear por diferencia de tiempos.
  if (!(await withinLimit(emailThrottleKey(normalized), MAX_REQUESTS_PER_EMAIL))) {
    return { delivered: false, reason: 'demasiadas solicitudes para ese correo' }
  }

  const code = generateCode()
  const redis = getRedis()

  await redis.set(
    codeKey(normalized),
    { fingerprint: fingerprint(normalized, code), userId: user.id, clientId: user.clientId },
    { ex: CODE_TTL_SECONDS },
  )
  await redis.del(attemptsKey(normalized))

  await deliverCode({ email: user.email, code, expiresInMinutes: CODE_TTL_SECONDS / 60 })

  return { delivered: true }
}

/**
 * Valida el código. Devuelve `{ ok: true, userId, clientId }` o `{ ok: false, reason }`.
 * Al acertar, el código se destruye: un solo uso.
 */
export async function verifyCode({ email, code }) {
  const normalized = String(email ?? '').trim().toLowerCase()
  const redis = getRedis()

  const record = await redis.get(codeKey(normalized))
  if (!record) return { ok: false, reason: 'no hay código vigente para ese correo' }

  const attempts = await redis.incr(attemptsKey(normalized))
  if (attempts === 1) await redis.expire(attemptsKey(normalized), CODE_TTL_SECONDS)

  if (attempts > MAX_VERIFICATION_ATTEMPTS) {
    // Quemar el código: si alguien está probando a ciegas, no se le deja seguir aunque
    // vuelva a pedir otro código antes de que expire el contador.
    await redis.del(codeKey(normalized))
    return { ok: false, reason: 'demasiados intentos' }
  }

  if (!sameFingerprint(record.fingerprint, fingerprint(normalized, String(code ?? '').trim()))) {
    return { ok: false, reason: 'código incorrecto' }
  }

  await redis.del(codeKey(normalized))
  await redis.del(attemptsKey(normalized))

  return { ok: true, userId: record.userId, clientId: record.clientId }
}
