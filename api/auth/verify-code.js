// POST /api/auth/verify-code — { email, code }
//
// Valida el código y abre la sesión. El usuario se vuelve a resolver aquí, en vez de confiar
// en lo que se guardó al pedir el código: entre una cosa y otra pueden pasar diez minutos, y
// en ese rato el administrador puede haberle quitado el acceso.

import { findUserForLogin, looksLikeEmail, normalizeEmail, recordLogin } from '../../core/auth/identity.js'
import { verifyCode } from '../../core/auth/codes.js'
import { createSession, SESSION_TTL_SECONDS } from '../../core/auth/sessions.js'
import { isSecureRequest, sessionCookie } from '../../core/auth/cookies.js'
import { contractedModules } from '../../core/auth/guards.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' })

  const email = normalizeEmail(req.body?.email)
  const code = String(req.body?.code ?? '').trim()
  if (!looksLikeEmail(email) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Correo o código no válidos.' })
  }

  try {
    const result = await verifyCode({ email, code })
    if (!result.ok) {
      console.log(`[ingreso] código rechazado para ${email}: ${result.reason}`)
      return res.status(401).json({ error: 'Código incorrecto o vencido.' })
    }

    const user = await findUserForLogin(email, 'email')
    if (!user || user.id !== result.userId) {
      console.log(`[ingreso] el usuario ${email} dejó de poder entrar entre la solicitud y la validación`)
      return res.status(401).json({ error: 'Código incorrecto o vencido.' })
    }

    const sessionId = await createSession({
      userId: user.id,
      clientId: user.clientId,
      isAdmin: user.isAdmin,
      email: user.email,
      name: user.name,
    })

    await recordLogin(user.clientId, user.id)
    const modules = await contractedModules(user.clientId)

    res.setHeader('Set-Cookie', sessionCookie(sessionId, {
      maxAge: SESSION_TTL_SECONDS,
      secure: isSecureRequest(req),
    }))

    return res.status(200).json({
      user: { email: user.email, name: user.name, isAdmin: user.isAdmin },
      modules,
    })
  } catch (error) {
    console.error(`[ingreso] fallo al validar el código de ${email}: ${error.stack || error.message}`)
    return res.status(500).json({ error: 'No se pudo procesar la solicitud.' })
  }
}
