// Superficie pública de core/auth.
//
// Las tres piezas están separadas a propósito y en este orden:
//   identity  — quién eres (resuelve un correo a un usuario de un cliente)
//   codes     — cómo lo demuestras (hoy: código de un solo uso al correo)
//   sessions  — qué pasa después (la app te recuerda una jornada)
//
// `sessions` no sabe nada de `codes`. Añadir Microsoft y Google es sumar una pieza al medio,
// no tocar los extremos.

export { PROVIDERS, normalizeEmail, looksLikeEmail, findUserForLogin, recordLogin } from './identity.js'
export { CODE_TTL_SECONDS, MAX_VERIFICATION_ATTEMPTS, generateCode, requestCode, verifyCode } from './codes.js'
export {
  SESSION_TTL_SECONDS,
  createSession,
  readSession,
  destroySession,
  destroyUserSessions,
} from './sessions.js'
export { SESSION_COOKIE, sessionCookie, expiredSessionCookie, readSessionCookie, isSecureRequest } from './cookies.js'
export {
  MODULES,
  contractedModules,
  getSession,
  hasModule,
  requireAdmin,
  requireClientAccess,
  requireModule,
  requirePlatformAdmin,
  requireSession,
} from './guards.js'
export { setCodeSender, resetCodeSender } from './delivery.js'

export { bearerMatches, sameSecret } from './secrets.js'
