// El cliente de SAP CI-DS.
//
// Portado de v9 con dos añadidos que allí faltaban y que esta capa exige a todas las llamadas
// salientes: la URL pasa por el portero anti-SSRF, y hay un tiempo máximo. Sin tiempo máximo
// una función serverless se queda colgada hasta que la mata el proveedor, y el usuario ve un
// error genérico sin saber que fue el tenant el que no contestó.

import { assertSapUrl } from '../transport/ssrf.js'
import { escapeXml, parseFault, redactSessionId } from './xml.js'
import {
  buildBody,
  fallbackFor,
  looksLikeUnknownOperation,
  parseResponse,
  soapActionFor,
  versionFor,
} from './operations.js'
import { xmlValue } from './xml.js'

export const DEFAULT_TIMEOUT_MS = 60_000

export class SoapError extends Error {
  constructor(message, { faultCode = null, status = 0, rawXml = null } = {}) {
    super(message)
    this.name = 'SoapError'
    this.faultCode = faultCode
    this.status = status
    // Se guarda ya tapado: este XML acaba en registros y pantallas de depuración.
    this.rawXml = rawXml ? redactSessionId(rawXml).slice(0, 2000) : null
  }
}

/** La sesión de CI-DS caducó. Quien llame debe volver a identificarse y repetir. */
export class SoapSessionExpiredError extends SoapError {
  constructor(message = 'La sesión de CI-DS caducó.') {
    super(message)
    this.name = 'SoapSessionExpiredError'
  }
}

export function buildEnvelope(body, sessionId = null, version = null) {
  let header = ''
  if (sessionId) header += `<SessionId>${escapeXml(sessionId)}</SessionId>`
  if (version) header += `<web:Version>${escapeXml(version)}</web:Version>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="http://webservices.dsod.sap.com/">
  ${header ? `<soapenv:Header>${header}</soapenv:Header>` : '<soapenv:Header/>'}
  <soapenv:Body>${body}</soapenv:Body>
</soapenv:Envelope>`
}

/** Una petición SOAP. No interpreta nada: devuelve el texto crudo. */
export async function soapCall({ serviceUrl, soapAction, envelope, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  await assertSapUrl(serviceUrl, { kind: 'cids' })

  let response
  try {
    response = await fetch(serviceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: soapAction },
      body: envelope,
      // Sin seguir redirecciones: un desvío llevaría a una dirección que no pasó por el
      // portero, y ese es el hueco por el que se cuela un ataque de SSRF. Un endpoint legítimo
      // de CI-DS responde 200, o un error SOAP, nunca un desvío.
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new SoapError(`No se pudo contactar con CI-DS: ${error.message}`)
  }

  if (response.status >= 300 && response.status < 400) {
    throw new SoapError('CI-DS respondió con una redirección y no se siguen redirecciones.', {
      status: response.status,
    })
  }

  return { ok: response.ok, status: response.status, text: await response.text() }
}

/** Convierte un error de SAP en la excepción adecuada. */
function throwForFault({ text, status }) {
  const fault = parseFault(text)
  const message = fault?.faultString || fault?.faultCode || `Error de CI-DS (HTTP ${status})`

  if (/session/i.test(fault?.faultCode ?? '') || /session/i.test(fault?.faultString ?? '')) {
    throw new SoapSessionExpiredError(message)
  }

  throw new SoapError(message, {
    faultCode: fault?.faultCode ?? null,
    status,
    // Si no se reconoció el error, se guarda el XML para poder mirarlo.
    rawXml: fault ? null : text,
  })
}

/**
 * Identificarse y obtener el identificador de sesión.
 * Es lo único que necesita usuario y contraseña; el resto de operaciones van con la sesión.
 */
export async function logon({ serviceUrl, orgName, user, password, isProduction, timeoutMs }) {
  if (!user || !password) throw new SoapError('Faltan las credenciales de CI-DS.')

  const body = `<web:logonRequest>
      <orgName>${escapeXml(orgName)}</orgName>
      <userName>${escapeXml(user)}</userName>
      <password>${escapeXml(password)}</password>
      <isProduction>${isProduction ? 'true' : 'false'}</isProduction>
    </web:logonRequest>`

  const { ok, status, text } = await soapCall({
    serviceUrl,
    soapAction: 'function=logon',
    envelope: buildEnvelope(body),
    ...(timeoutMs ? { timeoutMs } : {}),
  })

  if (!ok) throwForFault({ text, status })

  const sessionId = xmlValue(text, 'SessionID') || xmlValue(text, 'sessionID')
  if (!sessionId) throw new SoapError('CI-DS no devolvió el identificador de sesión.')
  return sessionId
}

/**
 * Ejecuta una operación con una sesión ya abierta y devuelve el resultado ya interpretado.
 *
 * Si el tenant no conoce el nombre nuevo de una operación que existe en dos versiones,
 * reintenta solo con el nombre antiguo — hay tenants que únicamente publican ese.
 */
export async function callOperation({
  serviceUrl,
  sessionId,
  operation,
  params = {},
  timeoutMs,
  debug = false,
}) {
  if (!serviceUrl) throw new SoapError('Falta la dirección del servicio de CI-DS.')
  if (!sessionId) throw new SoapError('Falta el identificador de sesión de CI-DS.')

  const attempt = async (name, version) => {
    const body = buildBody(name, params)
    const envelope = buildEnvelope(body, sessionId, version)
    const result = await soapCall({
      serviceUrl,
      soapAction: soapActionFor(name),
      envelope,
      ...(timeoutMs ? { timeoutMs } : {}),
    })
    return { ...result, body, envelope, name }
  }

  let call = await attempt(operation, versionFor(operation))

  const fallback = fallbackFor(operation)
  if (!call.ok && fallback && looksLikeUnknownOperation(call.text)) {
    call = await attempt(fallback, null)
  }

  if (!call.ok) throwForFault({ text: call.text, status: call.status })

  // Hay tenants que devuelven el error dentro de una respuesta correcta, así que se comprueba
  // también cuando la petición fue bien.
  if (parseFault(call.text)) throwForFault({ text: call.text, status: call.status })

  const result = parseResponse(call.name, call.text)

  if (!debug) return result

  return {
    result,
    operation: call.name,
    soapAction: soapActionFor(call.name),
    requestXml: redactSessionId(call.envelope),
    responseXml: call.text,
  }
}

/** Cierra la sesión. Los errores no se propagan: cerrar es un gesto de cortesía. */
export async function logout({ serviceUrl, sessionId, timeoutMs }) {
  try {
    return await callOperation({ serviceUrl, sessionId, operation: 'logout', params: { sessionId }, timeoutMs })
  } catch {
    return null
  }
}
