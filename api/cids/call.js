// POST /api/cids/call — { connectionId, operation, params }
//
// El único camino del navegador hacia CI-DS. Tres guardas antes de tocar nada: hay sesión, el
// módulo está contratado, y la conexión es de ese cliente (lo comprueba `core/connections`,
// que filtra por cliente en cada consulta).
//
// La lista de operaciones permitidas vive en core/cids, no aquí: así vale igual para el
// asistente de IA cuando llegue.

import { requireModule } from '../../core/auth/guards.js'
import { runCidsOperation } from '../../core/cids/operations.js'
import { SoapError, SoapSessionExpiredError } from '../../core/soap/client.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' })

  const session = await requireModule(req, res, 'cids')
  if (!session) return

  const { connectionId, operation, params } = req.body ?? {}
  if (!connectionId) return res.status(400).json({ error: 'Falta la conexión.' })
  if (!operation) return res.status(400).json({ error: 'Falta la operación.' })

  try {
    const result = await runCidsOperation({
      clientId: session.clientId,
      connectionId,
      operation,
      params: params ?? {},
    })
    return res.status(200).json({ result })
  } catch (error) {
    if (error instanceof SoapSessionExpiredError) {
      // Ya se reintentó con una sesión nueva; si sigue fallando, el problema es del tenant.
      return res.status(502).json({ error: 'CI-DS rechazó la sesión. Revisa las credenciales de la conexión.' })
    }
    if (error instanceof SoapError) {
      return res.status(502).json({ error: error.message, faultCode: error.faultCode })
    }
    console.error(`[cids] ${operation}: ${error.stack || error.message}`)
    return res.status(400).json({ error: error.message })
  }
}
