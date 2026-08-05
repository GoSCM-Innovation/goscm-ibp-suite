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
  PROMOTED_CACHE_SECONDS,
  PROMOTED_CONCURRENCY,
  forgetPromotedTaskNames,
  getPromotedTaskNames,
  normalizeTaskName,
} from './promoted-tasks.js'

export {
  DETAIL_CONCURRENCY,
  MAX_RUNS_PER_BATCH,
  fetchTaskDetails,
} from './task-details.js'

export {
  CANCELABLE_STATUSES,
  FAILED_STATUSES,
  QUEUED_STATUSES,
  TASK_STATUS,
  TERMINAL_STATUSES,
  WARNING_STATUSES,
  formatDuration,
  isCancelable,
  isFailed,
  isQueued,
  isTerminal,
  isWarning,
  statusMeta,
} from './task-status.js'
