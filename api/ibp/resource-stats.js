// GET /api/ibp/resource-stats?connectionId=…&horas=24 — el consumo de CPU y memoria del tenant.
//
// La serie llega ya agrupada: en treinta días son 4.320 puntos y el navegador los promediaría igual.

import { requireModule } from '../../core/auth/guards.js'
import { getConnectionTarget, getCredentials } from '../../core/connections/index.js'
import { readResourceStats } from '../../core/ibp/index.js'

/** El acuerdo que habilita `RES_CONS_STATS_API_SRV`. */
const ACUERDO = 'SAP_COM_0068'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' })

  const session = await requireModule(req, res, 'jobs')
  if (!session) return

  const connectionId = req.query?.connectionId
  if (!connectionId) return res.status(400).json({ error: 'Falta la conexión.' })

  try {
    const conexion = await getConnectionTarget(session.clientId, connectionId)
    if (conexion.kind !== 'ibp') return res.status(400).json({ error: 'Esa conexión no es de IBP.' })

    const credentials = await getCredentials(session.clientId, connectionId, ACUERDO)
    const salida = await readResourceStats({
      baseUrl: conexion.baseUrl,
      credentials,
      horas: Number(req.query?.horas) || 24,
    })

    return res.status(200).json(salida)
  } catch (error) {
    console.error(`[ibp/resource-stats] ${error.stack || error.message}`)
    return res.status(400).json({ error: error.message, detalle: error.detail ?? '' })
  }
}
