// /api/orchestrations — las orquestaciones de un destino, sea de CI-DS o de IBP.
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
//
// El módulo que hace falta NO es fijo: sale del tipo de la conexión contra la que corre. Encadenar
// tareas de CI-DS y encadenar Application Jobs de IBP son la misma cosa por dentro —el motor es uno
// solo— pero se contratan por separado, así que cada una exige el suyo. Comprobarlo por la conexión
// y no por la ruta es lo que impide que quien tenga uno solo llegue a las del otro.

import { hasModule, requireSession } from '../core/auth/guards.js'
import { getConnectionTarget } from '../core/connections/index.js'
import {
  createOrchestration,
  deleteOrchestration,
  duplicateOrchestration,
  getOrchestration,
  listOrchestrations,
  updateOrchestration,
} from '../core/orchestrations/orchestrations.js'

/** Qué módulo hay que tener contratado para orquestar cada tipo de conexión. */
const MODULO_DE = Object.freeze({ cids: 'cids', ibp: 'jobs' })

export default async function handler(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  const { clientId } = session

  /** Comprueba que el módulo del tipo de esa conexión esté contratado. */
  async function exigirModuloDe(connectionId) {
    const conexion = await getConnectionTarget(clientId, connectionId)
    const modulo = MODULO_DE[conexion.kind]
    if (!modulo) throw new Error(`No hay forma de orquestar una conexión de tipo "${conexion.kind}".`)
    if (!(await hasModule(clientId, modulo))) throw new Error('Tu empresa no tiene contratado ese módulo.')
  }

  /** Lo mismo, para las operaciones que llegan con la orquestación y no con la conexión. */
  async function exigirModuloDeLaOrquestacion(id) {
    const orquestacion = await getOrchestration(clientId, id)
    // Igual que si fuera de otro cliente: contestar distinto confirmaría que existe.
    if (!orquestacion) return null
    await exigirModuloDe(orquestacion.connectionId)
    return orquestacion
  }

  try {
    if (req.method === 'GET') {
      const { id, connectionId, production } = req.query ?? {}

      if (id) {
        const orchestration = await exigirModuloDeLaOrquestacion(id)
        if (!orchestration) return res.status(404).json({ error: 'La orquestación no existe.' })
        return res.status(200).json({ orchestration })
      }

      if (!connectionId) return res.status(400).json({ error: 'Falta la conexión.' })
      await exigirModuloDe(connectionId)
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
        if (!(await exigirModuloDeLaOrquestacion(id))) {
          return res.status(404).json({ error: 'La orquestación no existe.' })
        }
        return res.status(201).json({ orchestration: await duplicateOrchestration(clientId, id) })
      }

      if (!connectionId) return res.status(400).json({ error: 'Falta la conexión.' })
      await exigirModuloDe(connectionId)
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
      if (!(await exigirModuloDeLaOrquestacion(id))) {
        return res.status(404).json({ error: 'La orquestación no existe.' })
      }
      // Se pasan tal cual: `undefined` significa "no lo cambies", y core lo distingue.
      return res.status(200).json({ orchestration: await updateOrchestration(clientId, id, { name, nodes, edges }) })
    }

    if (req.method === 'DELETE') {
      const { id } = req.body ?? {}
      if (!id) return res.status(400).json({ error: 'Falta la orquestación.' })
      if (!(await exigirModuloDeLaOrquestacion(id))) {
        return res.status(404).json({ error: 'La orquestación no existe.' })
      }
      const borrada = await deleteOrchestration(clientId, id)
      return res.status(borrada ? 200 : 404).json(borrada ? { deleted: true } : { error: 'La orquestación no existe.' })
    }

    return res.status(405).json({ error: 'Método no permitido.' })
  } catch (error) {
    // Los mensajes de core/orchestrations están escritos para mostrarse: dicen qué paso tiene el
    // ciclo, o a qué nodo apunta una conexión que no existe.
    console.error(`[orchestrations] ${error.stack || error.message}`)
    return res.status(400).json({ error: error.message })
  }
}
