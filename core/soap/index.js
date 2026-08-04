// Superficie pública de core/soap: el cliente de SAP CI-DS.
//
// Portado de `api/soap.js` de v9, que era la única implementación viva de las tres (v7 tenía
// unos ayudantes de XML que se descartan).

export {
  escapeXml,
  parseFault,
  redactSessionId,
  xmlAll,
  xmlAttribute,
  xmlText,
  xmlValue,
} from './xml.js'

export {
  buildBody,
  fallbackFor,
  looksLikeUnknownOperation,
  parseResponse,
  soapActionFor,
  versionFor,
} from './operations.js'

export {
  DEFAULT_TIMEOUT_MS,
  SoapError,
  SoapSessionExpiredError,
  buildEnvelope,
  callOperation,
  logon,
  logout,
  soapCall,
} from './client.js'
