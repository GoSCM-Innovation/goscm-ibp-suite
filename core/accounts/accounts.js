// Las operaciones del panel de administración: clientes, usuarios y suscripciones.
//
// Dos niveles, y la diferencia importa:
//   • Administrador de PLATAFORMA (GoSCM): da de alta clientes y decide qué módulos tiene
//     cada uno. Es decidir qué se cobra, así que no puede quedar del lado del cliente.
//   • Administrador de CLIENTE: gestiona la gente de su empresa y sus conexiones a SAP.
//
// Quién puede llamar a cada cosa lo comprueban las guardas de `core/auth`. Aquí están las
// reglas que no dependen de quién llama sino de qué pasaría: no dejar la plataforma sin
// administradores, no borrarse a uno mismo, y cerrar las sesiones de quien pierde permisos.

import { query, queryOne } from '../persistence/postgres.js'
import { queryOneScoped, queryScoped } from '../persistence/tenant-scope.js'
import { destroyUserSessions } from '../auth/sessions.js'
import { MODULES } from '../auth/guards.js'
import { looksLikeEmail, normalizeEmail } from '../auth/identity.js'

// La base usa nombres con guion bajo y el resto de la aplicación no. La traducción se hace
// aquí, en la frontera, para que ninguna pantalla tenga que saber cómo se llaman las columnas.

const toClient = (row) => row && ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  status: row.status,
  createdAt: row.created_at,
  userCount: row.user_count,
  moduleCount: row.module_count,
})

const toUser = (row) => row && ({
  id: row.id,
  email: row.email,
  name: row.name,
  isAdmin: row.is_admin,
  isPlatformAdmin: row.is_platform_admin,
  status: row.status,
  allowedProviders: row.allowed_providers,
  createdAt: row.created_at,
  lastLoginAt: row.last_login_at,
})

const toSubscription = (row) => row && ({
  module: row.module,
  status: row.status,
  validFrom: row.valid_from,
  validUntil: row.valid_until,
})

// ─── Clientes ────────────────────────────────────────────────────────────────

export async function listClients() {
  const rows = await query(
    `select c.id, c.name, c.slug, c.status, c.created_at,
            (select count(*)::int from users u where u.client_id = c.id) as user_count,
            (select count(*)::int from module_subscriptions m
              where m.client_id = c.id and m.status = 'active') as module_count
     from clients c
     order by c.name`,
  )
  return rows.map(toClient)
}

export async function createClient({ name, slug }) {
  if (!name?.trim()) throw new Error('El cliente necesita un nombre.')
  const cleanSlug = String(slug ?? '').trim().toLowerCase()
  if (!/^[a-z0-9-]{2,40}$/.test(cleanSlug)) {
    throw new Error('El identificador del cliente solo admite letras, números y guiones (entre 2 y 40).')
  }

  const existing = await queryOne('select id from clients where slug = $1', [cleanSlug])
  if (existing) throw new Error(`Ya existe un cliente con el identificador "${cleanSlug}".`)

  return toClient(await queryOne(
    'insert into clients (name, slug) values ($1, $2) returning id, name, slug, status, created_at',
    [name.trim(), cleanSlug],
  ))
}

/**
 * Suspender un cliente cierra las sesiones de toda su gente: si no, seguirían dentro hasta
 * que les caducara sola. Suspender es lo que se hace cuando alguien deja de pagar.
 */
export async function setClientStatus(clientId, status) {
  if (!['active', 'suspended'].includes(status)) {
    throw new Error(`Estado de cliente desconocido: "${status}".`)
  }
  const updated = await queryOne(
    'update clients set status = $1 where id = $2 returning id, name, slug, status',
    [status, clientId],
  )
  if (!updated) throw new Error('El cliente no existe.')

  if (status === 'suspended') {
    for (const user of await queryScoped(clientId, 'select id from users where client_id = $1', [clientId])) {
      await destroyUserSessions(user.id)
    }
  }
  return toClient(updated)
}

// ─── Usuarios ────────────────────────────────────────────────────────────────

export async function listUsers(clientId) {
  const rows = await queryScoped(
    clientId,
    `select id, email, name, is_admin, is_platform_admin, status, allowed_providers, created_at, last_login_at
     from users where client_id = $1 order by email`,
    [clientId],
  )
  return rows.map(toUser)
}

export async function createUser(clientId, { email, name = null, isAdmin = false }) {
  const address = normalizeEmail(email)
  if (!looksLikeEmail(address)) throw new Error('El correo no es válido.')

  // El correo es único en toda la plataforma: la identidad es el buzón, no la pareja
  // cliente + correo. Se comprueba antes para dar un mensaje entendible en vez del error
  // técnico de la base.
  const existing = await queryOne('select client_id from users where lower(email) = $1', [address])
  if (existing) throw new Error('Ya hay un usuario con ese correo en la plataforma.')

  return toUser(await queryOneScoped(
    clientId,
    `insert into users (client_id, email, name, is_admin, allowed_providers)
     values ($1, $2, $3, $4, array['email']::text[])
     returning id, email, name, is_admin, is_platform_admin, status, created_at`,
    [clientId, address, name, Boolean(isAdmin)],
  ))
}

/**
 * Da de baja o reactiva a alguien. Al darlo de baja se cierran sus sesiones abiertas: quitarle
 * el acceso tiene que surtir efecto ahora, no cuando le caduque la sesión.
 */
export async function setUserStatus(clientId, userId, status) {
  if (!['active', 'disabled'].includes(status)) {
    throw new Error(`Estado de usuario desconocido: "${status}".`)
  }
  const updated = await queryOneScoped(
    clientId,
    'update users set status = $1 where id = $2 and client_id = $3 returning id, email, status',
    [status, userId, clientId],
  )
  if (!updated) throw new Error('El usuario no existe para este cliente.')

  if (status === 'disabled') await destroyUserSessions(userId)
  return toUser(updated)
}

/**
 * Cambia los permisos de alguien y cierra sus sesiones.
 *
 * Los permisos viajan dentro de la sesión, así que cambiarlos sin cerrarla dejaría los
 * antiguos vigentes durante horas — y en el caso de quitar permisos, eso es un agujero.
 *
 * `actingUserId` es quien está haciendo el cambio: sirve para impedir que alguien se quite a
 * sí mismo el rol de plataforma y se encierre fuera.
 */
export async function setUserRoles(clientId, userId, { isAdmin, isPlatformAdmin }, { actingUserId } = {}) {
  const user = await queryOneScoped(
    clientId,
    'select id, is_admin, is_platform_admin from users where id = $1 and client_id = $2',
    [userId, clientId],
  )
  if (!user) throw new Error('El usuario no existe para este cliente.')

  const nextAdmin = isAdmin === undefined ? user.is_admin : Boolean(isAdmin)
  const nextPlatform = isPlatformAdmin === undefined ? user.is_platform_admin : Boolean(isPlatformAdmin)

  if (user.is_platform_admin && !nextPlatform) {
    if (actingUserId && actingUserId === userId) {
      throw new Error('No puedes quitarte a ti mismo el rol de administrador de la plataforma.')
    }
    const remaining = await queryOne(
      'select count(*)::int as n from users where is_platform_admin and status = \'active\' and id <> $1',
      [userId],
    )
    if (remaining.n === 0) {
      throw new Error('No se puede quitar al último administrador de la plataforma: nadie podría volver a entrar.')
    }
  }

  const updated = await queryOneScoped(
    clientId,
    `update users set is_admin = $1, is_platform_admin = $2
     where id = $3 and client_id = $4
     returning id, email, is_admin, is_platform_admin`,
    [nextAdmin, nextPlatform, userId, clientId],
  )

  await destroyUserSessions(userId)
  return toUser(updated)
}

export async function deleteUser(clientId, userId, { actingUserId } = {}) {
  if (actingUserId && actingUserId === userId) {
    throw new Error('No puedes borrarte a ti mismo.')
  }
  const user = await queryOneScoped(
    clientId,
    'select id, is_platform_admin from users where id = $1 and client_id = $2',
    [userId, clientId],
  )
  if (!user) return false

  if (user.is_platform_admin) {
    const remaining = await queryOne(
      'select count(*)::int as n from users where is_platform_admin and status = \'active\' and id <> $1',
      [userId],
    )
    if (remaining.n === 0) {
      throw new Error('No se puede borrar al último administrador de la plataforma.')
    }
  }

  await queryScoped(clientId, 'delete from users where id = $1 and client_id = $2', [userId, clientId])
  await destroyUserSessions(userId)
  return true
}

// ─── Suscripción por módulo ──────────────────────────────────────────────────

export async function listSubscriptions(clientId) {
  const rows = await queryScoped(
    clientId,
    `select module, status, valid_from, valid_until, created_at
     from module_subscriptions where client_id = $1 order by module`,
    [clientId],
  )
  return rows.map(toSubscription)
}

/**
 * Activa o vence un módulo para un cliente. Es la palanca comercial, y por eso solo la toca
 * un administrador de plataforma.
 *
 * No hace falta cerrar sesiones: la suscripción se consulta en cada uso, así que vencer un
 * módulo surte efecto en la siguiente petición.
 */
export async function setSubscription(clientId, module, { status = 'active', validFrom = null, validUntil = null } = {}) {
  if (!MODULES.includes(module)) {
    throw new Error(`Módulo desconocido: "${module}". Los válidos son ${MODULES.join(', ')}.`)
  }
  if (!['active', 'expired'].includes(status)) {
    throw new Error(`Estado de suscripción desconocido: "${status}".`)
  }
  if (validFrom && validUntil && validUntil < validFrom) {
    throw new Error('La fecha de fin no puede ser anterior a la de inicio.')
  }

  return toSubscription(await queryOneScoped(
    clientId,
    `insert into module_subscriptions (client_id, module, status, valid_from, valid_until)
     values ($1, $2, $3, $4, $5)
     on conflict (client_id, module) do update set
       status = excluded.status,
       valid_from = excluded.valid_from,
       valid_until = excluded.valid_until
     returning module, status, valid_from, valid_until`,
    [clientId, module, status, validFrom, validUntil],
  ))
}
