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

/** Administrador de su propio cliente. Un administrador de plataforma también lo es. */
export async function requireAdmin(req, res) {
  const session = await requireSession(req, res)
  if (!session) return null
  if (!session.isAdmin && !session.isPlatformAdmin) {
    res.status(403).json({ error: 'Hace falta ser administrador.' })
    return null
  }
  return session
}

/**
 * Administrador de la plataforma: dar de alta clientes y activar o vencer módulos.
 * Es la palanca comercial, y por eso no la toca el administrador de un cliente.
 */
export async function requirePlatformAdmin(req, res) {
  const session = await requireSession(req, res)
  if (!session) return null
  if (!session.isPlatformAdmin) {
    res.status(403).json({ error: 'Hace falta ser administrador de la plataforma.' })
    return null
  }
  return session
}

/**
 * Permite administrar los datos de un cliente: el administrador de plataforma puede con
 * cualquiera; el de un cliente, solo con el suyo. Sin cliente indicado se administra el
 * propio, que es lo que quiere el administrador de un cliente siempre.
 *
 * Devuelve `{ session, clientId }` — el `clientId` ya resuelto, para que quien llame no tenga
 * que volver a decidirlo. Responde 404 y no 403 ante un cliente ajeno: contestar "prohibido"
 * confirmaría que ese cliente existe.
 */
export async function requireClientAccess(req, res, requestedClientId = null) {
  const session = await requireAdmin(req, res)
  if (!session) return null

  const clientId = requestedClientId || session.clientId
  if (!session.isPlatformAdmin && clientId !== session.clientId) {
    res.status(404).json({ error: 'El cliente no existe.' })
    return null
  }
  return { session, clientId }
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

/**
 * Como `requireModule`, pero basta con UNO de los módulos.
 *
 * Existe para lo que dos módulos leen igual: las plantillas de trabajo de IBP las lista la pestaña
 * «Job Templates» de IBP Tools y las usa el explorador de integraciones de CI-DS para enriquecer.
 * Pedir solo uno de los dos dejaba a quien contrató el otro con un 403 en una pantalla suya.
 */
export async function requireAnyModule(req, res, modules) {
  const session = await requireSession(req, res)
  if (!session) return null
  for (const module of modules) {
    if (await hasModule(session.clientId, module)) return session
  }
  res.status(403).json({ error: 'Este módulo no está contratado.', module: modules.join(' | ') })
  return null
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
