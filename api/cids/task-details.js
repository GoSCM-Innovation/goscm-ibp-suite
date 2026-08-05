// POST /api/cids/task-details — { connectionId, runIds } → fin y duración de cada ejecución.
//
// Existe para no hacer una petición por fila. La lista de ejecuciones no trae el fin ni la
// duración, así que hacen falta tantas consultas a SAP como filas en pantalla; lo que este
// endpoint evita es que también sean tantas peticiones a nuestra API, cada una repitiendo la
// comprobación de sesión, de módulo y de conexión. Así lo hacía v9.
//
// El tope de ejecuciones por tanda vive en core/cids, junto al motivo por el que existe.

import { requireModule } from '../../core/auth/guards.js'
import { fetchTaskDetails } from '../../core/cids/task-details.js'
import { SoapError, SoapSessionExpiredError } from '../../core/soap/client.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' })

  const session = await requireModule(req, res, 'cids')
  if (!session) return

  const { connectionId, runIds } = req.body ?? {}
  if (!connectionId) return res.status(400).json({ error: 'Falta la conexión.' })

  try {
    const details = await fetchTaskDetails({
      clientId: session.clientId,
      connectionId,
      runIds: runIds ?? [],
    })
    return res.status(200).json({ details })
  } catch (error) {
    // Una consulta suelta que falla ya viene marcada dentro de `details`; si el error llega
    // hasta aquí, el problema es de la conexión entera y no de una fila.
    if (error instanceof SoapSessionExpiredError) {
      return res.status(502).json({ error: 'CI-DS rechazó la sesión. Revisa las credenciales de la conexión.' })
    }
    if (error instanceof SoapError) {
      return res.status(502).json({ error: error.message, faultCode: error.faultCode })
    }
    console.error(`[cids/task-details] ${error.stack || error.message}`)
    return res.status(400).json({ error: error.message })
  }
}
