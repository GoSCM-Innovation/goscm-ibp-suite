// El único acceso a Redis (Upstash). Estado efímero: sesiones, cachés con TTL, cerrojos de
// cron, contadores de cuota del asistente.
//
// Cliente perezoso, igual que Postgres: importar este módulo no exige que las variables de
// entorno existan.
//
// Las claves de datos de un cliente se construyen SIEMPRE con `tenantKey`. Redis no tiene
// nada parecido a una restricción de integridad, así que el prefijo por cliente es todo el
// aislamiento que hay — por eso está en una función y no a mano en cada llamada.

import { Redis } from '@upstash/redis'

let client = null

// Se aceptan los dos nombres que existen en la práctica: `KV_REST_API_*`, que es como los
// inyecta el marketplace de Vercel, y `UPSTASH_REDIS_REST_*`, que es como los entrega la
// consola de Upstash cuando la cuenta es directa. Da igual por qué puerta se contrate.
export function getRedis() {
  if (client) return client
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    throw new Error(
      'No hay conexión a Redis configurada: faltan KV_REST_API_URL y KV_REST_API_TOKEN ' +
      '(o sus equivalentes UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN).',
    )
  }
  client = new Redis({ url, token })
  return client
}

/**
 * Clave con espacio de nombres del cliente: `c:<clientId>:<parte>:<parte>`.
 * Rechaza los dos puntos dentro de una parte, que permitirían fabricar una clave de otro
 * cliente desde un valor que venga de fuera.
 */
export function tenantKey(clientId, ...parts) {
  const segments = [clientId, ...parts]
  for (const segment of segments) {
    if (typeof segment !== 'string' || segment.length === 0) {
      throw new Error('tenantKey: todas las partes de la clave deben ser cadenas no vacías.')
    }
    if (segment.includes(':')) {
      throw new Error(`tenantKey: una parte de la clave no puede contener ":" (recibido "${segment}").`)
    }
  }
  return `c:${segments.join(':')}`
}

/** Clave global, sin cliente. Solo para estado que no es de nadie: cerrojos de cron, etc. */
export function globalKey(...parts) {
  if (parts.length === 0) throw new Error('globalKey: hace falta al menos una parte.')
  for (const part of parts) {
    if (typeof part !== 'string' || part.length === 0) {
      throw new Error('globalKey: todas las partes de la clave deben ser cadenas no vacías.')
    }
    if (part.includes(':')) {
      throw new Error(`globalKey: una parte de la clave no puede contener ":" (recibido "${part}").`)
    }
  }
  return `g:${parts.join(':')}`
}

/** Solo para los tests: descarta el cliente memorizado. */
export function resetRedisClient() {
  client = null
}
