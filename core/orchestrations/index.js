// Superficie pública de core/orchestrations: encadenar tareas de CI-DS con dependencias y grupos.

export {
  createOrchestration,
  deleteOrchestration,
  duplicateOrchestration,
  getOrchestration,
  listOrchestrations,
  updateOrchestration,
} from './orchestrations.js'

export {
  RUN_LOCK_SECONDS,
  RUN_STATE_SECONDS,
  TERMINAL_RUN_STATUSES,
  cancelRun,
  getRun,
  listActiveRuns,
  resumeRun,
  startRun,
  tickRun,
} from './runner.js'

export {
  decideForPending,
  directPredecessors,
  initRunState,
  resetForResume,
  runOutcome,
} from './run-state.js'

export {
  DONE_STEP_STATUSES,
  isRetryDue,
  isStepDone,
  nextStepState,
} from './step-outcome.js'

export {
  ERROR_STRATEGIES,
  EXECUTION_MODES,
  MAX_RETRIES_LIMIT,
  MAX_RETRY_DELAY_SECONDS,
  NODE_TYPES,
  normalizeGraph,
} from './graph.js'
