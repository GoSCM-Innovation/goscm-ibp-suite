// GET /api/cids/promoted?connectionId=… — qué tareas de este tenant ya están en producción.
//
// Devuelve `names: null` cuando la comparación no aplica, y eso NO es un error: significa que la
// conexión ya es la productiva o que no tiene declarada su contraparte. La interfaz simplemente no
// muestra nada. Contestar una lista vacía en ese caso diría "ninguna tarea está transportada", que
// es una afirmación distinta.

import { requireModule } from '../../core/auth/guards.js'
import { getPromotedTaskNames } from '../../core/cids/promoted-tasks.js'
import { SoapError, SoapSessionExpiredError } from '../../core/soap/client.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' })

  const session = await requireModule(req, res, 'cids')
  if (!session) return

  const connectionId = req.query?.connectionId
  if (!connectionId) return res.status(400).json({ error: 'Falta la conexión.' })

  try {
    const names = await getPromotedTaskNames(session.clientId, connectionId)
    return res.status(200).json({ names })
  } catch (error) {
    // Armar la lista habla con el tenant PRODUCTIVO, que puede tener sus credenciales vencidas
    // aunque el de pruebas funcione. Por eso el mensaje aclara de cuál se trata.
    if (error instanceof SoapSessionExpiredError) {
      return res.status(502).json({ error: 'CI-DS rechazó la sesión del tenant productivo. Revisa sus credenciales.' })
    }
    if (error instanceof SoapError) {
      return res.status(502).json({ error: error.message, faultCode: error.faultCode })
    }
    console.error(`[cids/promoted] ${error.stack || error.message}`)
    return res.status(400).json({ error: error.message })
  }
}
