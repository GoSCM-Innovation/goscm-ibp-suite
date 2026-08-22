// Las operaciones de acceso, con su dirección. Tabla cerrada: ver `handlers/ibp/index.js`.

import logout from './logout.js'
import requestCode from './request-code.js'
import session from './session.js'
import verifyCode from './verify-code.js'

export const RUTAS = Object.freeze({
  logout,
  'request-code': requestCode,
  session,
  'verify-code': verifyCode,
})

export default RUTAS
