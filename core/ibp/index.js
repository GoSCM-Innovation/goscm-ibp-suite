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

// Solo lo que usa el servidor: la pantalla importa `migration-plan.js` directamente, y su
// `estadoDeCorrida` chocaría con el del informe de cifras.
export {
  compararCampos,
  emparejarTabla,
  emparejarTablas,
  raicesDe,
} from './migration-plan.js'

export { analizarTabla, leerCampos } from './migration.js'

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

export {
  cargarBorrado,
  cargarSegmento,
  confirmarTransaccion,
  estadoDeTransaccion,
  leerMensajes,
  medirPorPagina,
  prepararTabla,
} from './migration-run.js'

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
  CAMPOS_DE_CONVERSION,
  CAMPOS_DE_TIEMPO,
  ENVIOS_EN_PARALELO as ENVIOS_EN_PARALELO_KF,
  ESPERA_DE_CONFIRMACION_MS,
  FASES_CRONOMETRADAS,
  FILAS_POR_LECTURA as FILAS_POR_LECTURA_KF,
  FILAS_POR_SEGMENTO as FILAS_POR_SEGMENTO_KF,
  INTENTOS_POR_SEGMENTO as INTENTOS_POR_SEGMENTO_KF,
  LECTURAS_EN_PARALELO as LECTURAS_EN_PARALELO_KF,
  NIVELES_DE_TIEMPO,
  SEGMENTOS_EN_PARALELO as SEGMENTOS_EN_PARALELO_KF,
  UMBRAL_PARA_PARTIR_POR_TIEMPO,
  camposDeEscritura,
  cifrasPegadas,
  conversionesDe,
  definicionDeLaCifra,
  duracionLegible,
  esFalloTransitorio,
  esMensajeDeRechazo,
  esPeriodoIso,
  esVacio,
  estadoDeCifra,
  estadoDeCorrida,
  filasParaEscribir,
  filtroDePeriodo,
  lecturaDeLaCifra,
  mensajeBreve,
  nombreDelInforme,
  siguienteTramo,
  tiemposDeLaCorrida,
  totalEscrito,
} from './kf-migration-plan.js'

export {
  confirmarTransaccionDeCifra,
  contarCifra,
  copiarSegmentoDeCifra,
  filtroDeLaCifra,
  periodosDeLaCifra,
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
  agregarCsv,
  aObjetos,
  areaDeArchivo,
  categoriasDeOperador,
  clasificarCifras,
  estadoDeSecciones,
  estadoInicial,
  get as campoExacto,
  getLike as campoDelCsv,
  idsDeTiposDeDatoMaestro,
  ingerirCsv,
  leerCsv,
  limpiarEncabezado,
  modulosDetectados,
  nivelesDistintos,
  seccionDeArchivo,
  tiposDeDatoMaestro,
} from './pa-doc-model.js'

export {
  CONTEOS_EN_PARALELO,
  TIPO_CI_DS,
  armarAppJobs,
  conjuntosDeDatoMaestro,
  contarEntidad,
  contarTipos,
  entidadesDeJobs,
  leerAppJobs,
  resolverEntidades,
} from './pa-doc-live.js'

export {
  MATTYPE_CATS,
  TEXTOS_DE_CATEGORIA,
  actualizarTipos,
  categoriasDe,
  desdeClasificacion,
  estaExcluido,
  iniciarTipos,
  reglasDeCategorias,
  resumenDeCategoriasV7,
  resumenDeEjecucionV7,
  resumenDeExclusionV7,
} from './mattype-config.js'

export {
  COLORES as COLORES_DE_INFORME,
  ETIQUETA_DE_SEVERIDAD,
  crearHojaDeTabla,
  crearHojaLibre,
  etiquetaDeRelleno,
  limpiarXml,
  rellenoDeSeveridad,
  severidadDeRelleno,
} from './analisis-hojas.js'

export {
  CAMPOS_OBLIGATORIOS as CAMPOS_OBLIGATORIOS_DE_PA,
  ENTIDADES_CON_EXTRAS as ENTIDADES_CON_EXTRAS_DE_PA,
  NOMBRES_DE_HOJA as NOMBRES_DE_HOJA_DE_PA,
  analizarProduccion,
} from './production-analyzer.js'

export {
  CAMPOS_OBLIGATORIOS_RED,
  CAMPOS_OCULTOS_RED,
  ENTIDADES_CON_EXTRAS_RED,
  FILAS_POR_HOJA,
  NOMBRES_DE_HOJA_RED,
  analizarRed,
  crearIndicesDeRed,
  snComputeHealthScore as puntajeDeSaludDeRed,
} from './network-analyzer.js'

export {
  ARCOS as ARCOS_DE_RED,
  CLASES as CLASES_DE_RED,
  TIPO_PROVEEDOR,
  UMBRAL_DE_CLIENTES,
  armarRed,
  claseDeUbicacion,
  clientesParaFiltro,
  clientesQueSobran,
  coincideConComodin,
  colocarNodos,
  insumosDeProveedor,
  plantasDetectadas,
  resumirRed,
  ubicacionesParaFiltro,
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

export { formatIbpExample, readFieldExample, readSampleRow } from './sample-row.js'

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
