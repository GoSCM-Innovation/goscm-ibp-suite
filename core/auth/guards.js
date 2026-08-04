// Las guardas que usa todo endpoint de la aplicación.
//
// Regla del proyecto: la verificación de módulo contratado vive en el servidor. Ocultar un
// botón en la interfaz no es una restricción — es una sugerencia que se salta cualquiera con
// la consola del navegador abierta.
//
// Cada guarda responde ella misma con el error y devuelve `null`, para que el handler sea:
//
//     const session = await requireModule(req, res, 'jobs')
//     if (!session) return

import { queryScoped } from '../persistence/tenant-scope.js'
import { readSessionCookie } from './cookies.js'
import { readSession } from './sessions.js'

/** Los módulos que se venden. Debe coincidir con el CHECK de `module_subscriptions`. */
export const MODULES = Object.freeze(['explorer', 'jobs', 'cids'])

const ACTIVE_SUBSCRIPTION = `
  status = 'active'
  and (valid_from is null or valid_from <= current_date)
  and (valid_until is null or valid_until >= current_date)
`

/** La sesión, o `null`. No responde nada: para endpoints que funcionan con y sin sesión. */
export async function getSession(req) {
  const sessionId = readSessionCookie(req?.headers?.cookie)
  if (!sessionId) return null
  return readSession(sessionId)
}

export async function requireSession(req, res) {
  const session = await getSession(req)
  if (!session) {
    res.status(401).json({ error: 'Sesión no válida o vencida.' })
    return null
  }
  return session
}

export async function requireAdmin(req, res) {
  const session = await requireSession(req, res)
  if (!session) return null
  if (!session.isAdmin) {
    res.status(403).json({ error: 'Hace falta ser administrador.' })
    return null
  }
  return session
}

/**
 * Módulos que el cliente tiene contratados y vigentes hoy.
 * Se consulta en cada uso en vez de guardarse en la sesión: vencer una suscripción desde el
 * panel tiene que surtir efecto de inmediato, no cuando al usuario le caduque la sesión.
 */
export async function contractedModules(clientId) {
  const rows = await queryScoped(
    clientId,
    `select module from module_subscriptions where client_id = $1 and ${ACTIVE_SUBSCRIPTION} order by module`,
    [clientId],
  )
  return rows.map((row) => row.module)
}

export async function hasModule(clientId, module) {
  if (!MODULES.includes(module)) {
    // Un módulo mal escrito devolvería "no contratado" y parecería un problema de permisos.
    // Mejor que reviente: es un error de programación, no una denegación.
    throw new Error(`Módulo desconocido: "${module}". Los válidos son ${MODULES.join(', ')}.`)
  }
  const rows = await queryScoped(
    clientId,
    `select 1 from module_subscriptions where client_id = $1 and module = $2 and ${ACTIVE_SUBSCRIPTION}`,
    [clientId, module],
  )
  return rows.length > 0
}

export async function requireModule(req, res, module) {
  const session = await requireSession(req, res)
  if (!session) return null
  if (!(await hasModule(session.clientId, module))) {
    res.status(403).json({ error: 'Este módulo no está contratado.', module })
    return null
  }
  return session
}
