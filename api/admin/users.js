// /api/admin/users — la gente de un cliente.
//
// El administrador de plataforma puede con cualquier cliente; el de un cliente, solo con el
// suyo. Sin indicar cliente se administra el propio.
//
// El rol de plataforma solo lo reparte un administrador de plataforma: si no, el
// administrador de un cliente se ascendería a sí mismo.

import { requireClientAccess } from '../../core/auth/guards.js'
import { createUser, deleteUser, listUsers, setUserRoles, setUserStatus } from '../../core/accounts/accounts.js'

export default async function handler(req, res) {
  const access = await requireClientAccess(req, res, req.query?.clientId || req.body?.clientId)
  if (!access) return
  const { session, clientId } = access

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ users: await listUsers(clientId) })
    }

    if (req.method === 'POST') {
      const user = await createUser(clientId, {
        email: req.body?.email,
        name: req.body?.name ?? null,
        isAdmin: Boolean(req.body?.isAdmin),
      })
      return res.status(201).json({ user })
    }

    if (req.method === 'PATCH') {
      const { userId, status, isAdmin, isPlatformAdmin } = req.body ?? {}
      if (!userId) return res.status(400).json({ error: 'Falta el usuario.' })

      if (isPlatformAdmin !== undefined && !session.isPlatformAdmin) {
        return res.status(403).json({ error: 'Solo un administrador de la plataforma reparte ese rol.' })
      }

      if (status !== undefined) {
        return res.status(200).json({ user: await setUserStatus(clientId, userId, status) })
      }

      const user = await setUserRoles(
        clientId, userId, { isAdmin, isPlatformAdmin }, { actingUserId: session.userId },
      )
      return res.status(200).json({ user })
    }

    if (req.method === 'DELETE') {
      const userId = req.query?.id || req.body?.userId
      if (!userId) return res.status(400).json({ error: 'Falta el usuario.' })
      const deleted = await deleteUser(clientId, userId, { actingUserId: session.userId })
      return res.status(deleted ? 200 : 404).json(deleted ? { deleted: true } : { error: 'El usuario no existe.' })
    }

    return res.status(405).json({ error: 'Método no permitido.' })
  } catch (error) {
    console.error(`[admin/users] ${error.stack || error.message}`)
    return res.status(400).json({ error: error.message })
  }
}
