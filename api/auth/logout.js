// POST /api/auth/logout — cierra la sesión.
//
// Borra el registro en Redis y vence la cookie. Responde 200 aunque no hubiera sesión: no
// hay nada que informar y tampoco motivo para distinguir los dos casos.

import { expiredSessionCookie, isSecureRequest, readSessionCookie } from '../../core/auth/cookies.js'
import { destroySession } from '../../core/auth/sessions.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' })

  try {
    const sessionId = readSessionCookie(req.headers?.cookie)
    if (sessionId) await destroySession(sessionId)
  } catch (error) {
    console.error(`[sesión] fallo al cerrar sesión: ${error.stack || error.message}`)
  }

  res.setHeader('Set-Cookie', expiredSessionCookie({ secure: isSecureRequest(req) }))
  return res.status(200).json({ message: 'Sesión cerrada.' })
}
