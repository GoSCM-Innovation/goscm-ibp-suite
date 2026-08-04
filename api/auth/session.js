// GET /api/auth/session — quién está conectado y qué módulos tiene contratados.
// Es lo primero que consulta la interfaz al cargar.

import { contractedModules, requireSession } from '../../core/auth/guards.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' })

  try {
    const session = await requireSession(req, res)
    if (!session) return

    const modules = await contractedModules(session.clientId)
    return res.status(200).json({
      user: { email: session.email, name: session.name, isAdmin: session.isAdmin },
      modules,
    })
  } catch (error) {
    console.error(`[sesión] fallo al leer la sesión: ${error.stack || error.message}`)
    return res.status(500).json({ error: 'No se pudo procesar la solicitud.' })
  }
}
