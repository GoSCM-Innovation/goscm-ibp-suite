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
  MESSAGE_TYPE,
  RESTARTABLE_JOB_STATUSES,
  isJobCancelable,
  isJobFailed,
  isJobFinished,
  isJobQueued,
  isJobRestartable,
  isJobRunning,
  isProblemMessage,
  jobStatusMeta,
  jobSuccessRate,
  messageTypeMeta,
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

export {
  ETIQUETA_DE_PARAMETRO,
  etiquetaDeParametro,
  nombreBase,
  numeroDeRanura,
  pasoDesdeSecuencia,
  tieneValor,
} from './job-params.js'

export { readTemplateDetail, scheduleJob } from './job-schedule.js'

export {
  CONJUNTOS_DE_CONSUMO,
  METERING_MAX,
  METERING_PAGE,
  meteringRoot,
  readMetering,
  readMeteringSet,
  toMeteringTimestamp,
} from './metering.js'

export {
  PREFIJO_COMPLEMENTO_EXCEL,
  RANGOS_DE_CONSUMO,
  aSegundos,
  actividadPorDia,
  contarPor,
  diaDe,
  distintos,
  escribirDuracion,
  nombresDeComponente,
  nombresDeUsuario,
  resumirConsumo,
} from './metering-summary.js'

export {
  RANGOS_DE_RECURSOS,
  agrupar,
  intervaloDeAgrupacion,
  parseOdataDate,
  resumenDeRecursos,
  serieDesdeFilas,
} from './resource-series.js'

export { RES_CONS_TOP, readResourceStats, resourceRoot } from './resource-stats.js'

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
