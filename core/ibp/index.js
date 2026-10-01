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
  readCatalogMeta,
  readJobRun,
  readJobRuns,
  readLatestTemplateRun,
  readJobStatuses,
  readLogMessages,
  readRunParams,
  readRunSteps,
  readStepLogInfo,
  readTemplateSequences,
  restartJobRun,
  toSapTimestamp,
} from './job-runs.js'

export {
  ETIQUETA_DE_PARAMETRO,
  ETIQUETA_DE_PARAMETRO_DE_PASO,
  OPERADOR_DE_SELECCION,
  ORDEN_DE_SECCIONES,
  SECCION_DE_PARAMETRO,
  etiquetaDeParametro,
  etiquetaDeParametroDePaso,
  metaDeCatalogo,
  metaSinDatos,
  nombreBase,
  numeroDeRanura,
  pasoDesdeSecuencia,
  tieneValor,
} from './job-params.js'

export { readJobTemplateSet, readTemplateDetail, scheduleJob } from './job-schedule.js'

export {
  ESTADOS_QUE_IMPIDEN,
  compararCampos,
  emparejarTabla,
  emparejarTablas,
  raicesDe,
  resumirPlan,
  revisarEntrada,
  sePuedeCopiar,
} from './migration-plan.js'

export { planificarMigracion } from './migration.js'

export {
  ESPERA_MAXIMA_MS,
  MAX_BYTES_POR_ENVIO,
  MAX_FILAS_POR_ENVIO,
  abrirSesionDeEscritura,
  commitTransaction,
  getExportResult,
  getTransactionId,
  initiateParallelProcess,
  partirEnEnvios,
  postTransChunk,
  readMessages,
  waitForProcessed,
} from './master-data-write.js'

export { FILAS_POR_SEGMENTO, INTENTOS_POR_SEGMENTO, migrarSegmento, migrarTabla } from './migration-run.js'

export {
  ATRIBUTOS_DE_CONVERSION,
  FILAS_PARA_CONTAR,
  VALOR_DE_SONDEO,
  areasDesdeConjuntos,
  cifraLegible,
  conversionQueFalta,
  esCero,
  esNombreDeCampo,
  filtroDeCifra,
  filtroDeCifras,
  filtroDeFechas,
  filtroDePlanificacion,
  nivelDeAgregacion,
  ordenDelVisor,
  parseKfMetadata,
  periodoIso,
  periodoLegible,
  selectDePlanificacion,
  selectDelVisor,
  sinCeros,
  sinFilasEnCero,
} from './planning-data-model.js'

export { cifrasCambiadas, filasDeEdicionDeCifras, resultadoDeEdicion } from './planning-data-edit.js'

export { ESPERA_DE_EDICION_MS, escribirCifrasEditadas } from './planning-data-edit-run.js'

export { PRUEBAS_EN_PARALELO, readAttrDistinctValues, tablaDelAtributo } from './attr-values.js'

export {
  ATRIBUTOS_DE_SOLO_LECTURA,
  CAMPOS_DE_TIEMPO,
  FILAS_POR_SEGMENTO as FILAS_POR_SEGMENTO_KF,
  NIVELES_DE_TIEMPO,
  UMBRAL_PARA_PARTIR_POR_TIEMPO,
  dimensionesEscribibles,
  cifrasPegadas,
  esCampoDeTiempo,
  filaParaEscribir,
  nivelDeTiempoDe,
  nombreEnDestino,
  planificarSegmentos,
  renombrados,
  revisarMigracionDeCifras,
  selectDeLaMigracion,
} from './kf-migration-plan.js'

export {
  duracionLegible,
  estadoDeCorrida,
  filasDeConfiguracion,
  filasDeSegmentos,
  mensajesAgrupados,
  momentoLegible,
  nombreDelInforme,
  resumirCorrida,
} from './kf-run-report.js'

export {
  INTENTOS_POR_SEGMENTO as INTENTOS_POR_SEGMENTO_KF,
  contarLoQueSeCopia,
  migrarCifras,
  migrarSegmentoDeCifras,
} from './kf-migration.js'

export {
  ESPERA_MAXIMA_MS as ESPERA_MAXIMA_KF_MS,
  MAX_VALORES_POR_ENVIO,
  abrirSesionDeEscritura as abrirSesionDeEscrituraKf,
  commitTransaction as commitTransactionKf,
  filasPorEnvio,
  getExportResult as getExportResultKf,
  getTransactionId as getTransactionIdKf,
  initiateParallelProcess as initiateParallelProcessKf,
  partirEnEnvios as partirEnEnviosKf,
  postKfChunk,
  readMessages as readMessagesKf,
  waitForProcessed as waitForProcessedKf,
} from './planning-data-write.js'

export {
  ESPERA_ENTRE_INTENTOS_MS,
  FILAS_POR_PAGINA,
  countKf,
  detectConversions,
  planningRoot,
  readKfMetadata,
  readKfPage,
  readPlanningAreas,
  readVersions,
} from './planning-data.js'

export {
  EXTRACCIONES,
  GRUPOS_DE_EXTRACCION,
  MARCA_DE_INVALIDA,
  descartarInvalidas,
  planificarExtraccion,
} from './explorer-extract-plan.js'

export {
  DESCRIPCION_DE_CAMPO,
  NO_EXISTE,
  armarSelect,
  campoReal,
  decidir,
  describirCampo,
  hayDecision,
  normalizarFilas,
  olvidar,
  revisarCampos,
  revisarTodo,
  sugerirCampo,
} from './explorer-fields.js'

export { deleteExplorerMap, getExplorerMap, saveExplorerMap } from './explorer-map.js'

export {
  ROLES_DEL_ARBOL,
  ROLES_DE_RED,
  detectarRoles,
  entidadesDelTenant,
  gruposEfectivos,
  esTablaDeTraduccion,
  mejorEntidadPara,
  prefijoDelTenant,
  rolesEfectivos,
  rolesPorRevisar,
} from './explorer-entities.js'

export {
  CAMPOS_DE_SOLO_LECTURA,
  OPERADORES,
  catalogoDesdeVsmt,
  clavesDesdeUri,
  columnasPorOmision,
  etiquetaDeCondicion,
  filasPorPagina,
  filasPorPaginaSegunCampos,
  filtroDeCondiciones,
  filtroDeDatos,
  literalOdata,
  partirValores,
  sinCamposDeSoloLectura,
  sinMetadatos,
  valorLegible,
} from './master-data-model.js'

export {
  MAX_CAMBIOS_LISTADOS,
  cambiosParaRevisar,
  filasParaBorrar,
  filasParaModificar,
  resumirCambios,
} from './master-data-edit.js'

export { escribirDatoMaestro } from './master-data-edit-run.js'

export {
  countEntity,
  masterDataRoot,
  readDistinctValues,
  readEntityPage,
  readEntityPageWithTotal,
  readImportableMdts,
  readMasterMetadata,
  readSchema,
  readVsmt,
} from './master-data.js'

export {
  IDS_DE_SECCION,
  MODULOS,
  SECCIONES,
  aObjetos,
  areaDeArchivo,
  campo as campoDelCsv,
  ingerirCsv,
  leerCsv,
  limpiarEncabezado,
  loRecibido,
  resumirArea,
  seccionDeArchivo,
  seccionesQueFaltan,
} from './pa-doc-model.js'

export {
  CATEGORIAS,
  IDS_DE_CATEGORIA,
  MATRIZ,
  SEVERIDADES,
  TEXTOS as TEXTOS_DE_COMPROBACION,
  configuracionInicial,
  laMasPermisiva,
  reglasDe,
  repartirTipos,
  sinClasificar,
} from './production-rules.js'

export {
  COLUMNAS as COLUMNAS_DE_LA_RED,
  MAX_CICLOS,
  analizarRed,
  callejones,
  ciclos,
  claseDeProblema,
  conjuntosDeRed,
  estadoDeRed,
  estadoEsperado,
  filaDeRed,
  grafoVacio,
  llegaAUnCliente,
  nodosFantasma,
  plantasAisladas,
  plazosFaltantes,
  resumirRedes,
} from './network-analysis.js'

export {
  COLUMNAS as COLUMNAS_DEL_ANALISIS,
  analizarProducto,
  esCeroOVacio,
  filaDelInforme,
  laPeor,
  resumirAnalisis,
} from './production-analysis.js'

export {
  COLUMNAS as COLUMNAS_DE_UBICACION,
  EXIGENCIAS as EXIGENCIAS_DE_UBICACION,
  ROLES as ROLES_DE_UBICACION,
  analizarUbicacion,
  filaDeUbicacion,
  resumirUbicaciones,
  rolesDe,
} from './location-analysis.js'

export {
  COLUMNAS as COLUMNAS_DE_RECURSO,
  ESTADOS as ESTADOS_DE_RECURSO,
  analizarRecurso,
  filaDeRecurso,
  resumirRecursos,
} from './resource-analysis.js'

export {
  ARCOS as ARCOS_DE_RED,
  CLASES as CLASES_DE_RED,
  COLUMNAS as COLUMNAS_DE_RED,
  TIPO_PROVEEDOR,
  armarRed,
  claseDeUbicacion,
  nodosSueltos,
  plazoLegible,
  repartirEnColumnas,
  resumirRed,
  vecinosDe,
} from './supply-network.js'

export {
  TIPOS as TIPOS_DEL_ARBOL,
  abrirTodo,
  armarHijos,
  armarNodo,
  buscarNodo,
  claveDePlanta,
  indexarCabeceras,
  indexarComponentes,
  indexarMaestro,
  indexarPorReceta,
  indicesVacios,
  profundidad,
  raicesPorPlanta,
  soltarHijos,
} from './bom-tree.js'

export {
  CONVERSIONES,
  MAX_VALORES as MAX_VALORES_DE_CONVERSION,
  mdtsDelArea,
  readConversionValues,
  tablaDeConversion,
} from './conversion-values.js'

export {
  CONJUNTOS_DE_CONSUMO,
  LIMITE_DE_RESPUESTA,
  METERING_MAX,
  METERING_PAGE,
  entidadesDelServicio,
  meteringRoot,
  ordenEstable,
  readMetering,
  readMeteringModel,
  readMeteringSet,
  toMeteringTimestamp,
} from './metering.js'

export { compactRows, dayKey, expandRows } from './metering-rows.js'

export {
  EXCEL_ADDIN_PREFIX,
  appsView,
  buildComponentMap,
  buildUserMap,
  excelView,
  filterByContext,
  filterInactiveUsers,
  formatDuration,
  generalView,
  listPlanningAreas,
  paProfileView,
  presetDates,
  toSecs,
  userProfileView,
} from './metering-summary.js'

export {
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
