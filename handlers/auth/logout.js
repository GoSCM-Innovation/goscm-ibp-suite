// POST /api/auth/logout — cierra la sesión.
//
// Borra el registro en Redis y vence la cookie. Responde 200 aunque no hubiera sesión: no
// hay nada que informar y tampoco motivo para distinguir los dos casos.
//
// Si Redis falla, la cookie se vence igual (el navegador deja de mandarla) pero se responde 500: la
// sesión sigue viva en el servidor y decir «Sesión cerrada» sería mentir sobre algo de seguridad.

import { expiredSessionCookie, isSecureRequest, readSessionCookie } from '../../core/auth/cookies.js'
import { destroySession } from '../../core/auth/sessions.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' })

  let cerrada = true
  try {
    const sessionId = readSessionCookie(req.headers?.cookie)
    if (sessionId) await destroySession(sessionId)
  } catch (error) {
    cerrada = false
    console.error(`[sesión] fallo al cerrar sesión: ${error.stack || error.message}`)
  }

  res.setHeader('Set-Cookie', expiredSessionCookie({ secure: isSecureRequest(req) }))
  if (!cerrada) return res.status(500).json({ error: 'No se pudo cerrar la sesión en el servidor.' })
  return res.status(200).json({ message: 'Sesión cerrada.' })
}
