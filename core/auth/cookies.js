// La cookie de sesión.
//
// `HttpOnly`: JavaScript de la página no puede leerla. Es lo que evita que un fallo de
// scripting en cualquier rincón de la interfaz se convierta en el robo de la sesión — la
// deuda que arrastraba v9 con su token embebido en el bundle.
//
// `SameSite=Lax` y no `Strict`: Strict rompería la vuelta desde un enlace externo o desde el
// redirección de un proveedor de SSO, que es justo lo que viene en la siguiente iteración.
//
// `Secure` solo cuando la petición llega por https: en `localhost` se trabaja sobre http y
// una cookie Secure no se guardaría.

export const SESSION_COOKIE = 'ibp_session'

export function isSecureRequest(req) {
  const forwarded = req?.headers?.['x-forwarded-proto']
  const protocol = Array.isArray(forwarded) ? forwarded[0] : forwarded
  if (typeof protocol === 'string') return protocol.split(',')[0].trim() === 'https'
  return Boolean(req?.socket?.encrypted)
}

export function readSessionCookie(cookieHeader) {
  if (typeof cookieHeader !== 'string' || cookieHeader === '') return null
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    if (part.slice(0, separator).trim() !== SESSION_COOKIE) continue
    const value = part.slice(separator + 1).trim()
    return value === '' ? null : decodeURIComponent(value)
  }
  return null
}

function serialize(value, { maxAge, secure }) {
  const attributes = [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ]
  if (secure) attributes.push('Secure')
  return attributes.join('; ')
}

export function sessionCookie(sessionId, { maxAge, secure }) {
  return serialize(encodeURIComponent(sessionId), { maxAge, secure })
}

/** Cookie vacía y ya vencida: es como se cierra la sesión en el navegador. */
export function expiredSessionCookie({ secure }) {
  return serialize('', { maxAge: 0, secure })
}
