// GET /api/connections?kind=cids — a qué tenants puede apuntar un módulo.
//
// Distinto de /api/admin/connections: ese es para configurar y exige ser administrador. Este es
// para trabajar y lo usa cualquier usuario, así que devuelve **solo lo que hace falta para
// elegir en un desplegable**: identificador, nombre y si es productivo. La dirección del tenant
// y su organización no salen — no son secretos, pero tampoco tiene por qué conocerlas quien
// solo va a mirar el monitor.

import { contractedModules, requireSession } from '../core/auth/guards.js'
import { listConnections } from '../core/connections/connections.js'

/**
 * Qué módulos dan derecho a ver las conexiones de cada tipo.
 *
 * La comprobación va aquí y no en la interfaz: un desplegable vacío no impide que alguien
 * llame al endpoint a mano. Una conexión de IBP la usan dos módulos, así que con cualquiera
 * de los dos alcanza.
 */
const MODULES_BY_KIND = Object.freeze({
  ibp: ['explorer', 'jobs'],
  cids: ['cids'],
})

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' })

  const session = await requireSession(req, res)
  if (!session) return

  const kind = req.query?.kind
  const habilitantes = MODULES_BY_KIND[kind]
  if (!habilitantes) {
    return res.status(400).json({ error: "Falta el tipo de conexión ('ibp' o 'cids')." })
  }

  try {
    const contratados = await contractedModules(session.clientId)
    if (!habilitantes.some((module) => contratados.includes(module))) {
      return res.status(403).json({ error: 'Ningún módulo contratado usa este tipo de conexión.' })
    }

    const connections = await listConnections(session.clientId, { kind })
    return res.status(200).json({
      connections: connections.map(({ id, name, isProduction }) => ({ id, name, isProduction })),
    })
  } catch (error) {
    console.error(`[connections] ${error.stack || error.message}`)
    return res.status(400).json({ error: error.message })
  }
}
