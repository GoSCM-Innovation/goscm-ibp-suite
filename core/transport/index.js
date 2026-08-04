// Superficie pública de core/transport: el único camino hacia SAP.
//
// Ningún módulo de negocio llama a `fetch` por su cuenta. Si a alguno le falta una operación,
// se agrega aquí — y así queda disponible también para el asistente de IA.

export {
  DEFAULT_ALLOWED_SERVICES,
  DEFAULT_CIDS_HOST_PATTERN,
  DEFAULT_IBP_HOST_PATTERN,
  assertSapHost,
  assertSapUrl,
  checkOdataService,
  isPrivateAddress,
  validateSapHost,
  validateSapUrl,
} from './ssrf.js'

export {
  CSRF_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
  SapError,
  extractSapError,
  fetchCsrf,
  sapFetch,
} from './sap-fetch.js'

export {
  decodeXmlEntities,
  extractFieldLabels,
  extractSimpleTypeCatalog,
  readFieldLabels,
  readSimpleTypeCatalog,
} from './metadata.js'
