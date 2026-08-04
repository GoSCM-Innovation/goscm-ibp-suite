// Quién es cada persona: resolver un correo a un usuario activo de un cliente activo.
//
// Esta pieza responde SOLO a "quién eres". No abre sesiones, no reparte cookies y no sabe
// cómo se demostró la identidad. Esa separación es deliberada: cuando se añadan Microsoft y
// Google, entrarán por aquí y todo lo que hay detrás seguirá igual.

import { query } from '../persistence/postgres.js'
import { queryScoped } from '../persistence/tenant-scope.js'

/** Formas de demostrar el correo. Hoy solo la primera está implementada. */
export const PROVIDERS = Object.freeze(['email', 'microsoft', 'google'])

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

/**
 * Comprobación deliberadamente laxa: el objetivo es descartar basura evidente antes de
 * tocar la base, no decidir qué es un correo válido. Lo único que valida de verdad una
 * dirección es que llegue el código.
 */
export function looksLikeEmail(value) {
  const email = normalizeEmail(value)
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

/**
 * Usuario activo, de un cliente activo, que puede entrar por `provider`. Devuelve `null` en
 * cualquier otro caso — sin distinguir el motivo, para que quien llame no pueda convertir
 * esto en una forma de averiguar quién es cliente.
 *
 * Excepción documentada al aislamiento por cliente: es la ÚNICA consulta que cruza clientes,
 * porque su trabajo es justamente descubrir a cuál pertenece quien está entrando. Todo lo
 * que venga después ya lleva el filtro. Por eso usa `query` y no `queryScoped`.
 */
export async function findUserForLogin(email, provider = 'email') {
  const normalized = normalizeEmail(email)
  if (!looksLikeEmail(normalized)) return null

  const rows = await query(
    `select u.id, u.client_id, u.email, u.name, u.is_admin, u.is_platform_admin, u.allowed_providers
     from users u
     join clients c on c.id = u.client_id
     where lower(u.email) = $1
       and u.status = 'active'
       and c.status = 'active'`,
    [normalized],
  )

  const user = rows[0]
  if (!user) return null
  if (!user.allowed_providers.includes(provider)) return null

  return {
    id: user.id,
    clientId: user.client_id,
    email: user.email,
    name: user.name,
    isAdmin: user.is_admin,
    isPlatformAdmin: user.is_platform_admin,
  }
}

export async function recordLogin(clientId, userId) {
  await queryScoped(clientId, `update users set last_login_at = now() where id = $1 and client_id = $2`, [userId, clientId])
}
