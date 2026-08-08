// Superficie pública de core/ibp: lo que la aplicación le pregunta a un tenant de IBP.
//
// Ningún módulo de negocio arma una URL de IBP por su cuenta. Si a alguno le falta una operación,
// se agrega aquí — y así queda disponible también para el asistente de IA.

export {
  SERVICIOS,
  formatEdmType,
  mergeCatalogs,
  parseCatalog,
  planningAreasFrom,
  readCatalog,
  serviceRoot,
} from './catalog.js'

export {
  CANCELABLE_JOB_STATUSES,
  FAILED_JOB_STATUSES,
  FINISHED_JOB_STATUSES,
  JOB_RESTART_MODES,
  JOB_STATUS,
  RESTARTABLE_JOB_STATUSES,
  isJobCancelable,
  isJobFailed,
  isJobFinished,
  isJobQueued,
  isJobRestartable,
  isJobRunning,
  jobStatusMeta,
  jobSuccessRate,
} from './job-status.js'

export {
  JOB_HEADER_SELECT,
  JOB_HEADER_TOP,
  buildJobHeaderQuery,
  cancelJobRun,
  readJobRuns,
  readJobStatuses,
  readLogMessages,
  readRunSteps,
  readStepLogInfo,
  restartJobRun,
  toSapTimestamp,
} from './job-runs.js'

export { formatIbpExample, readSampleRow } from './sample-row.js'

export { resolveTargetEntity, selectFieldsFor } from './target-entity.js'

export {
  APPJOB_ROOT,
  TIPO_INTEGRACION,
  appJobRoot,
  entitySetNames,
  pickJobEntity,
  readAllPages,
  readJobSteps,
  readJobTemplates,
  readJobsWithSteps,
  readTaskIds,
  readTaskIndex,
  stepKey,
} from './app-jobs.js'
