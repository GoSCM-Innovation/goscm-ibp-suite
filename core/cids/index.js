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

export {
  DETAIL_CONCURRENCY,
  MAX_RUNS_PER_BATCH,
  fetchTaskDetails,
} from './task-details.js'

export {
  CANCELABLE_STATUSES,
  TASK_STATUS,
  TERMINAL_STATUSES,
  formatDuration,
  isCancelable,
  isTerminal,
  statusMeta,
} from './task-status.js'
