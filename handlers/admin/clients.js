// /api/admin/clients — alta y listado de clientes. Solo administrador de plataforma.
//
// Dar de alta un cliente y suspenderlo son decisiones comerciales de GoSCM, así que no las
// toca el administrador de un cliente ni aunque sea administrador de lo suyo.

import { requirePlatformAdmin } from '../../core/auth/guards.js'
import { createClient, listClients, setClientStatus } from '../../core/accounts/accounts.js'

export default async function handler(req, res) {
  const session = await requirePlatformAdmin(req, res)
  if (!session) return

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ clients: await listClients() })
    }

    if (req.method === 'POST') {
      const client = await createClient({ name: req.body?.name, slug: req.body?.slug })
      return res.status(201).json({ client })
    }

    if (req.method === 'PATCH') {
      const { clientId, status } = req.body ?? {}
      if (!clientId) return res.status(400).json({ error: 'Falta el cliente.' })
      return res.status(200).json({ client: await setClientStatus(clientId, status) })
    }

    return res.status(405).json({ error: 'Método no permitido.' })
  } catch (error) {
    console.error(`[admin/clients] ${error.stack || error.message}`)
    return res.status(400).json({ error: error.message })
  }
}
