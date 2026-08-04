// /api/admin/subscriptions — qué módulos tiene contratados un cliente.
//
// Consultarlo puede el administrador del cliente; CAMBIARLO solo el de plataforma. Es la
// palanca de lo que se cobra: si el administrador de un cliente pudiera tocarla, se
// activaría los módulos que quisiera.

import { requireClientAccess, requirePlatformAdmin } from '../../core/auth/guards.js'
import { listSubscriptions, setSubscription } from '../../core/accounts/accounts.js'

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const access = await requireClientAccess(req, res, req.query?.clientId)
      if (!access) return
      return res.status(200).json({ subscriptions: await listSubscriptions(access.clientId) })
    }

    if (req.method === 'PUT') {
      const session = await requirePlatformAdmin(req, res)
      if (!session) return

      const { clientId, module, status, validFrom, validUntil } = req.body ?? {}
      if (!clientId) return res.status(400).json({ error: 'Falta el cliente.' })
      if (!module) return res.status(400).json({ error: 'Falta el módulo.' })

      const subscription = await setSubscription(clientId, module, { status, validFrom, validUntil })
      return res.status(200).json({ subscription })
    }

    return res.status(405).json({ error: 'Método no permitido.' })
  } catch (error) {
    console.error(`[admin/subscriptions] ${error.stack || error.message}`)
    return res.status(400).json({ error: error.message })
  }
}
