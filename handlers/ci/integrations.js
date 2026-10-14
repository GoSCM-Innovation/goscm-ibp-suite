// /api/ci/integrations — la biblioteca de integraciones de CI Tools.
//
//   GET    ?connectionId=…                       la lista de una conexión (sin el body de cada una)
//   GET    ?id=…                                 una, con su body
//   POST   { connectionId, folder, name, body }  crear
//   POST   { action: 'duplicate', id }           duplicar
//   POST   { action: 'rename-folder', connectionId, from, to }   renombrar una carpeta (y las que cuelgan de ella)
//   PATCH  { id, name?, folder?, body? }         guardar cambios
//   DELETE { id }                                borrar (409 si una orquestación la usa)
//
// El módulo `ci` se exige aquí, en el servidor. Quién es el dueño y de qué conexión es cada cosa lo deciden las
// guardas de `core/ci`; este archivo solo traduce a HTTP.

import { requireModule } from '../../core/auth/guards.js'
import {
  createIntegration,
  deleteIntegration,
  duplicateIntegration,
  getIntegration,
  listIntegrations,
  renameFolder,
  updateIntegration,
} from '../../core/ci/index.js'

export default async function handler(req, res) {
  const session = await requireModule(req, res, 'ci')
  if (!session) return
  const { clientId, userId } = session

  try {
    if (req.method === 'GET') {
      const { id, connectionId } = req.query ?? {}

      if (id) {
        const integration = await getIntegration(clientId, id)
        // Igual que si fuera de otro cliente: contestar distinto confirmaría que existe.
        if (!integration) return res.status(404).json({ error: 'La integración no existe.' })
        return res.status(200).json({ integration })
      }

      if (!connectionId) return res.status(400).json({ error: 'Falta la conexión.' })
      return res.status(200).json({ integrations: await listIntegrations(clientId, connectionId) })
    }

    if (req.method === 'POST') {
      const { action, id, connectionId, folder, name, body, from, to } = req.body ?? {}

      if (action === 'duplicate') {
        if (!id) return res.status(400).json({ error: 'Falta la integración a duplicar.' })
        return res.status(201).json({ integration: await duplicateIntegration(clientId, userId, id) })
      }

      if (action === 'rename-folder') {
        return res.status(200).json({ renamed: await renameFolder(clientId, connectionId, from, to) })
      }

      return res.status(201).json({ integration: await createIntegration(clientId, userId, { connectionId, folder, name, body }) })
    }

    if (req.method === 'PATCH') {
      const { id, name, folder, body } = req.body ?? {}
      if (!id) return res.status(400).json({ error: 'Falta la integración.' })
      // Se pasan tal cual: `undefined` significa «no lo cambies», y core lo distingue.
      return res.status(200).json({ integration: await updateIntegration(clientId, userId, id, { name, folder, body }) })
    }

    if (req.method === 'DELETE') {
      const { id } = req.body ?? {}
      if (!id) return res.status(400).json({ error: 'Falta la integración.' })
      const borrada = await deleteIntegration(clientId, id)
      return res.status(borrada ? 200 : 404).json(borrada ? { deleted: true } : { error: 'La integración no existe.' })
    }

    return res.status(405).json({ error: 'Método no permitido.' })
  } catch (error) {
    // Los mensajes de core/ci están escritos para mostrarse: dicen qué está mal en el body o qué orquestación
    // usa la integración. Un 409 es un choque esperado, no un fallo, y no llena el registro.
    if (!error.statusCode) console.error(`[ci/integrations] ${error.stack || error.message}`)
    return res.status(error.statusCode ?? 400).json({ error: error.message })
  }
}
