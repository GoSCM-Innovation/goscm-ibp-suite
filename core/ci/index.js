// Superficie pública de core/ci: las integraciones de SAP Cloud Integration (CPI) que cargan datos a IBP.
//
// Los módulos de negocio no llaman a CPI por su cuenta: pasan por aquí. Las piezas puras (body, filtro, mapeo,
// campos) las comparte también la pantalla.

export {
  BODY_MAX_BYTES,
  VariableError,
  aplicarVariables,
  esNombreDeVariable,
  extraerMplId,
  leerBody,
  motivoDeValorInvalido,
  normalizarBody,
  resumenDeBody,
  variablesDeBody,
} from './body.js'

export { CI_TIMEOUT_MS, llamarEndpoint } from './call.js'

export {
  CAMPOS_CONOCIDOS,
  CAMPOS_ESPECIALES,
  TIPOS_DE_DATO,
  camposDe,
  plantillaDeBody,
} from './campos.js'

export { escribirFiltro, leerFiltro } from './filter.js'

export { CAMPOS_DEL_MAPEO, escribirMapeo, leerMapeo, leerPegado } from './mapping.js'

export {
  assertConexionCi,
  createIntegration,
  deleteIntegration,
  duplicateIntegration,
  esUuid,
  getIntegration,
  getIntegrations,
  listIntegrations,
  orchestrationsUsing,
  renameFolder,
  updateIntegration,
} from './integrations.js'

export {
  HUERFANA_MS,
  cerrarEjecucion,
  estadoMostrado,
  listarEjecuciones,
  obtenerEjecucion,
  registrarEjecucion,
  ultimasVariables,
} from './history.js'

export { CANDADO_SEGUNDOS, executeIntegration } from './execute.js'

export { defaultsDeCi, infoDeOrquestacion, pasosDeIntegracion, validarInicio } from './orquestacion.js'
