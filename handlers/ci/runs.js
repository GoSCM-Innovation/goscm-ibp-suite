// GET /api/ci/runs — el historial de ejecuciones y los valores con que se corrió por última vez.
//
//   ?connectionId=…[&integrationId=…][&limit=…]    las últimas ejecuciones de la conexión
//   ?variablesDe=integration&id=…                   los valores de variables de la última corrida de esa integración
//
// Los valores se guardan en el servidor y no en el navegador a propósito: lo guardado en el navegador no sabría
// de qué tenant es.

import { requireModule } from '../../core/auth/guards.js'
import { listarEjecuciones, ultimasVariables } from '../../core/ci/index.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' })

  const session = await requireModule(req, res, 'ci')
  if (!session) return

  const { connectionId, integrationId, limit, variablesDe, id } = req.query ?? {}

  try {
    if (variablesDe === 'integration') {
      if (!id) return res.status(400).json({ error: 'Falta la integración.' })
      return res.status(200).json({ variables: await ultimasVariables(session.clientId, { integrationId: id }) })
    }

    if (!connectionId) return res.status(400).json({ error: 'Falta la conexión.' })
    const runs = await listarEjecuciones(session.clientId, {
      connectionId,
      integrationId: integrationId || null,
      ...(limit ? { limit } : {}),
    })
    return res.status(200).json({ runs })
  } catch (error) {
    console.error(`[ci/runs] ${error.stack || error.message}`)
    return res.status(400).json({ error: error.message })
  }
}
