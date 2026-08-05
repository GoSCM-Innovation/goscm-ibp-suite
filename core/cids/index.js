// Superficie pública de core/cids: hablar con CI-DS usando las conexiones de un cliente.

export {
  CACHED_SESSION_SECONDS,
  forgetCidsSession,
  getCidsSession,
  getCidsTarget,
} from './session.js'

export {
  ALLOWED_OPERATIONS,
  READ_OPERATIONS,
  WRITE_OPERATIONS,
  isWriteOperation,
  runCidsOperation,
} from './operations.js'
