// /api/cids/orchestrations — las orquestaciones de un destino de CI-DS.
//
//   GET    ?connectionId=…&production=…   listar
//   GET    ?id=…                          una, con su grafo
//   POST   { connectionId, production, name, nodes, edges }   crear
//   POST   { action: 'duplicate', id }                        duplicar
//   PATCH  { id, name?, nodes?, edges? }                      guardar cambios
//   DELETE { id }                                             borrar
//
// El handler es delgado a propósito: quién es el dueño, si el destino existe y si el grafo se puede
// ejecutar lo deciden las guardas de `core/orchestrations`. Aquí solo se traduce a HTTP.

import { requireModule } from '../../core/auth/guards.js'
import {
  createOrchestration,
  deleteOrchestration,
  duplicateOrchestration,
  getOrchestration,
  listOrchestrations,
  updateOrchestration,
} from '../../core/orchestrations/orchestrations.js'

export default async function handler(req, res) {
  const session = await requireModule(req, res, 'cids')
  if (!session) return
  const { clientId } = session

  try {
    if (req.method === 'GET') {
      const { id, connectionId, production } = req.query ?? {}

      if (id) {
        const orchestration = await getOrchestration(clientId, id)
        // Igual que si fuera de otro cliente: contestar distinto confirmaría que existe.
        if (!orchestration) return res.status(404).json({ error: 'La orquestación no existe.' })
        return res.status(200).json({ orchestration })
      }

      if (!connectionId) return res.status(400).json({ error: 'Falta la conexión.' })
      const orchestrations = await listOrchestrations(clientId, {
        connectionId,
        production: production === 'true',
      })
      return res.status(200).json({ orchestrations })
    }

    if (req.method === 'POST') {
      const { action, id, connectionId, production, name, nodes, edges } = req.body ?? {}

      if (action === 'duplicate') {
        if (!id) return res.status(400).json({ error: 'Falta la orquestación a duplicar.' })
        return res.status(201).json({ orchestration: await duplicateOrchestration(clientId, id) })
      }

      if (!connectionId) return res.status(400).json({ error: 'Falta la conexión.' })
      const orchestration = await createOrchestration(clientId, {
        connectionId,
        production: Boolean(production),
        name,
        nodes,
        edges,
      })
      return res.status(201).json({ orchestration })
    }

    if (req.method === 'PATCH') {
      const { id, name, nodes, edges } = req.body ?? {}
      if (!id) return res.status(400).json({ error: 'Falta la orquestación.' })
      // Se pasan tal cual: `undefined` significa "no lo cambies", y core lo distingue.
      return res.status(200).json({ orchestration: await updateOrchestration(clientId, id, { name, nodes, edges }) })
    }

    if (req.method === 'DELETE') {
      const { id } = req.body ?? {}
      if (!id) return res.status(400).json({ error: 'Falta la orquestación.' })
      const borrada = await deleteOrchestration(clientId, id)
      return res.status(borrada ? 200 : 404).json(borrada ? { deleted: true } : { error: 'La orquestación no existe.' })
    }

    return res.status(405).json({ error: 'Método no permitido.' })
  } catch (error) {
    // Los mensajes de core/orchestrations están escritos para mostrarse: dicen qué paso tiene el
    // ciclo, o a qué nodo apunta una conexión que no existe.
    console.error(`[cids/orchestrations] ${error.stack || error.message}`)
    return res.status(400).json({ error: error.message })
  }
}
