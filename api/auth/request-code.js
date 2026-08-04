// POST /api/auth/request-code — { email }
//
// Responde SIEMPRE lo mismo, exista o no el correo, esté o no dentro del límite de envíos.
// Cualquier diferencia convertiría esta pantalla en una forma de averiguar quién es cliente.
// El motivo real queda en los registros del servidor.

import { looksLikeEmail, normalizeEmail } from '../../core/auth/identity.js'
import { requestCode } from '../../core/auth/codes.js'

const RESPUESTA_UNIFORME = 'Si el correo está dado de alta, en unos segundos llegará un código.'

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded
  if (typeof raw === 'string' && raw.trim() !== '') return raw.split(',')[0].trim()
  return req.socket?.remoteAddress ?? 'desconocida'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' })

  const email = normalizeEmail(req.body?.email)
  if (!looksLikeEmail(email)) return res.status(400).json({ error: 'Correo no válido.' })

  try {
    const result = await requestCode({ email, ip: clientIp(req) })
    if (!result.delivered) console.log(`[ingreso] sin código para ${email}: ${result.reason}`)
  } catch (error) {
    console.error(`[ingreso] fallo al generar el código para ${email}: ${error.stack || error.message}`)
    return res.status(500).json({ error: 'No se pudo procesar la solicitud.' })
  }

  return res.status(202).json({ message: RESPUESTA_UNIFORME })
}
