// /api/admin/connections — las conexiones a SAP de un cliente y sus acuerdos.
//
// La contraseña de SAP ENTRA por aquí (al guardar un acuerdo) y no vuelve a salir nunca: no
// hay ningún camino en esta API que devuelva una contraseña, ni siquiera cifrada. Solo el
// servidor la descifra, justo antes de llamar a SAP.

import { requireClientAccess } from '../../core/auth/guards.js'
import { forgetPromotedTaskNames } from '../../core/cids/promoted-tasks.js'
import {
  createConnection,
  deleteAgreement,
  deleteConnection,
  getConnection,
  listConnections,
  setProductionCounterpart,
  upsertAgreement,
} from '../../core/connections/connections.js'

export default async function handler(req, res) {
  const access = await requireClientAccess(req, res, req.query?.clientId || req.body?.clientId)
  if (!access) return
  const { clientId } = access

  try {
    if (req.method === 'GET') {
      const connectionId = req.query?.id
      if (connectionId) {
        const connection = await getConnection(clientId, connectionId)
        if (!connection) return res.status(404).json({ error: 'La conexión no existe.' })
        return res.status(200).json({ connection })
      }
      return res.status(200).json({ connections: await listConnections(clientId) })
    }

    if (req.method === 'POST') {
      // Alta de un acuerdo dentro de una conexión ya existente.
      if (req.body?.agreement) {
        const { connectionId, agreement, sapUser, password } = req.body
        if (!connectionId) return res.status(400).json({ error: 'Falta la conexión.' })
        const saved = await upsertAgreement(clientId, connectionId, { agreement, sapUser, password })
        return res.status(200).json({ agreement: saved })
      }

      const connection = await createConnection(clientId, {
        kind: req.body?.kind,
        name: req.body?.name,
        baseUrl: req.body?.baseUrl,
        organization: req.body?.organization ?? null,
        isProduction: Boolean(req.body?.isProduction),
      })
      return res.status(201).json({ connection })
    }

    if (req.method === 'PATCH') {
      // Hoy lo único que se modifica de una conexión ya creada es su contraparte productiva.
      const { connectionId, productionCounterpartId } = req.body ?? {}
      if (!connectionId) return res.status(400).json({ error: 'Falta la conexión.' })

      const connection = await setProductionCounterpart(clientId, connectionId, productionCounterpartId || null)
      // La lista de tareas transportadas se armó mirando la contraparte anterior: si el enlace
      // cambió, lo guardado ya no corresponde a nada.
      await forgetPromotedTaskNames(clientId, connectionId)
      return res.status(200).json({ connection })
    }

    if (req.method === 'DELETE') {
      const { agreementId } = req.body ?? {}
      if (agreementId) {
        const deleted = await deleteAgreement(clientId, agreementId)
        return res.status(deleted ? 200 : 404).json(deleted ? { deleted: true } : { error: 'El acuerdo no existe.' })
      }

      const connectionId = req.query?.id || req.body?.connectionId
      if (!connectionId) return res.status(400).json({ error: 'Falta la conexión.' })
      const deleted = await deleteConnection(clientId, connectionId)
      return res.status(deleted ? 200 : 404).json(deleted ? { deleted: true } : { error: 'La conexión no existe.' })
    }

    return res.status(405).json({ error: 'Método no permitido.' })
  } catch (error) {
    // El mensaje puede venir de la validación de la dirección o del cifrado; nunca trae la
    // contraseña, porque ninguna de esas capas la mete en el texto del error.
    console.error(`[admin/connections] ${error.stack || error.message}`)
    return res.status(400).json({ error: error.message })
  }
}
