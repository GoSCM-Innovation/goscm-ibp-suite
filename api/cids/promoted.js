// GET /api/cids/promoted?connectionId=…&production=… — qué tareas ya están en producción.
//
// Devuelve `names: null` cuando la comparación no aplica, y eso NO es un error: significa que lo que
// se está mirando YA es el repositorio productivo. La interfaz simplemente no muestra nada. Contestar
// una lista vacía diría "ninguna tarea está transportada", que es una afirmación distinta.
//
// Si el repositorio productivo no contesta, también se devuelve `names: null` con éxito, no un
// error. v9 lo llamaba "best effort" y tenía razón: es una marca informativa sobre una pantalla que
// funciona igual sin ella, y hay usuarios cuyas credenciales entran al repositorio de pruebas pero
// no al productivo. El motivo queda en el registro del servidor, no en la cara del usuario.

import { requireModule } from '../../core/auth/guards.js'
import { getPromotedTaskNames } from '../../core/cids/promoted-tasks.js'
import { SoapError } from '../../core/soap/client.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' })

  const session = await requireModule(req, res, 'cids')
  if (!session) return

  const connectionId = req.query?.connectionId
  if (!connectionId) return res.status(400).json({ error: 'Falta la conexión.' })

  try {
    const names = await getPromotedTaskNames(session.clientId, connectionId, {
      production: req.query?.production === 'true',
    })
    return res.status(200).json({ names })
  } catch (error) {
    // `SoapSessionExpiredError` hereda de `SoapError`, así que las dos entran por aquí.
    if (error instanceof SoapError) {
      console.error(`[cids/promoted] el repositorio productivo no contestó: ${error.message}`)
      return res.status(200).json({ names: null })
    }
    console.error(`[cids/promoted] ${error.stack || error.message}`)
    return res.status(400).json({ error: error.message })
  }
}
