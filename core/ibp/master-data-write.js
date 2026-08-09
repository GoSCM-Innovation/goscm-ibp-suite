// Escribir dato maestro en un tenant: el ciclo completo de una transacción de SAP.
//
// Portado del lado de ESCRITURA de `services/masterDataApi.js` de v8. El ciclo es:
//
//   GetTransactionID → [InitiateParallelProcess] → POST <T>Trans (uno o varios) → Commit
//   → esperar a que SAP procese → leer los mensajes por fila
//
// Cinco cosas de aquí son conocimiento ganado contra tenants reales y no se deducen de la
// documentación de SAP. Las cinco están como código, no como comentario suelto:
//
//   1. UN CHUNK YA ENVIADO NO SE REINTENTA. Nunca. Enviar filas no es idempotente: si el envío
//      expira DESPUÉS de que SAP ya las guardó en la zona de preparación, repetirlo deja una
//      SEGUNDA copia de cada clave en la MISMA transacción, y al confirmar SAP rechaza LAS DOS
//      copias con "Duplicate master data". El registro se pierde, no solo el sobrante. El reintento
//      correcto es de la transacción ENTERA: se descarta la que no se confirmó y se vuelve a
//      empezar en una nueva, porque reaplicar una alta-o-modificación sí es seguro.
//
//   2. Una transacción no puede mezclar `DeleteEntries: true` y `false`. SAP responde "Create a new
//      transaction ID to use a different DeleteEntries value". Reemplazar del todo son DOS
//      transacciones: primero la de borrado, confirmada, y después la de carga.
//
//   3. La versión base se mienta OMITIENDO el área y la versión. Mandarlas hace que el envío falle
//      con 400 "check the planning area and version values". Una versión real las manda las dos.
//
//   4. `InitiateParallelProcess` NO existe para la versión base: devuelve 4xx con cualquier
//      combinación de parámetros. Es opcional de todas formas, así que se salta.
//
//   5. SAP confirma de forma ASÍNCRONA. Justo después de confirmar, los datos todavía se están
//      aplicando y una lectura devuelve lo de antes. Hay que preguntar hasta que diga PROCESSED.

import { fetchCsrf, sapFetch } from '../transport/sap-fetch.js'
import { masterDataRoot } from './master-data.js'
import { sinCamposDeSoloLectura } from './master-data-model.js'

/** Cuántos bytes puede pesar el cuerpo de un envío, por debajo del límite de la función. */
export const MAX_BYTES_POR_ENVIO = 3_500_000

/** Cuántas filas como mucho por envío. SAP recomienda no pasar de cinco mil. */
export const MAX_FILAS_POR_ENVIO = 5000

/** Cuánto se espera a que SAP termine de aplicar una transacción. */
export const ESPERA_MAXIMA_MS = 120_000

/** Cada cuánto se le pregunta si ya terminó. */
export const INTERVALO_DE_ESPERA_MS = 2000

/** Un literal de texto de OData dentro de una dirección. */
const literal = (valor) => `%27${encodeURIComponent(String(valor ?? ''))}%27`

/**
 * Parte las filas en envíos que no pasen ni de `maxBytes` ni de `maxFilas`.
 *
 * Se cuentan los bytes DE VERDAD y no un promedio por fila: hay tablas de pocas columnas con
 * valores enormes donde un número fijo de filas produce de vez en cuando un cuerpo por encima del
 * límite, y eso es un 413 que no se puede reintentar.
 */
export function partirEnEnvios(filas, { maxBytes = MAX_BYTES_POR_ENVIO, maxFilas = MAX_FILAS_POR_ENVIO } = {}) {
  const envios = []
  let actual = []
  let bytes = 0

  for (const fila of filas ?? []) {
    const suyos = JSON.stringify(fila).length + 1
    if (actual.length > 0 && (bytes + suyos > maxBytes || actual.length >= maxFilas)) {
      envios.push(actual)
      actual = []
      bytes = 0
    }
    actual.push(fila)
    bytes += suyos
  }

  if (actual.length > 0) envios.push(actual)
  return envios
}

/** El token de escritura y las cookies, una vez por transacción. */
export const abrirSesionDeEscritura = ({ baseUrl, credentials }) =>
  fetchCsrf({ serviceRoot: masterDataRoot(baseUrl), credentials, kind: 'ibp' })

/**
 * Paso 1: pedirle a SAP un identificador de transacción.
 *
 * La versión base se mienta con SOLO el tipo de dato maestro. Ver el punto 3 de la cabecera.
 */
export async function getTransactionId({ baseUrl, credentials, entidad, planningArea, versionId, csrf }) {
  const partes = [
    `TransactionID=${literal('')}`,
    `MasterDataTypeID=${literal(entidad)}`,
    ...(versionId ? [`VersionID=${literal(versionId)}`, `PlanningArea=${literal(planningArea)}`] : []),
    '$format=json',
  ]

  const { json } = await sapFetch({
    url: `${masterDataRoot(baseUrl)}/GetTransactionID?${partes.join('&')}`,
    credentials,
    kind: 'ibp',
    csrf,
  })

  const id = json?.d?.Value
  if (!id) throw new Error('SAP no devolvió un identificador de transacción.')
  return id
}

/**
 * Paso 2 (opcional): pedirle a SAP que procese la transacción en paralelo.
 *
 * Es una mejora, no un requisito: si el tenant no la admite se sigue igual. No existe para la
 * versión base, así que ahí ni se intenta. `nombre` es lo ÚNICO que le pone etiqueta visible a la
 * ejecución en SAP.
 */
export async function initiateParallelProcess({
  baseUrl, credentials, transactionId, entidad, planningArea, versionId, nombre, csrf,
}) {
  if (!versionId) return null

  const partes = [
    `TransactionID=${literal(transactionId)}`,
    `VersionID=${literal(versionId)}`,
    ...(entidad ? [`MasterDataTypeID=${literal(entidad)}`] : []),
    ...(planningArea ? [`PlanningArea=${literal(planningArea)}`] : []),
    ...(nombre ? [`TransactionName=${literal(nombre)}`] : []),
    '$format=json',
  ]

  try {
    const { json } = await sapFetch({
      url: `${masterDataRoot(baseUrl)}/InitiateParallelProcess?${partes.join('&')}`,
      credentials,
      kind: 'ibp',
      method: 'POST',
      csrf,
    })
    return json ?? null
  } catch (error) {
    // Un 4xx significa que este tenant no lo tiene; cualquier otra cosa sí es un problema.
    if (error?.status >= 400 && error?.status < 500) return null
    throw error
  }
}

/**
 * Paso 3: mandar un lote de filas a la zona de preparación.
 *
 * SIN reintento, a propósito. Ver el punto 1 de la cabecera: repetir un envío duplica claves y al
 * confirmar SAP rechaza las dos copias.
 */
export async function postTransChunk({
  baseUrl, credentials, entidad, transactionId, filas,
  borrar = false, planningArea, versionId, csrf,
}) {
  const limpias = sinCamposDeSoloLectura(filas)
  const atributos = limpias.length > 0 ? Object.keys(limpias[0]).join(',') : ''

  // La versión base no lleva NI área NI versión en el cuerpo; una real lleva las dos.
  const contexto = versionId
    ? { ...(planningArea ? { PlanningAreaID: planningArea } : {}), VersionID: versionId }
    : {}

  const { json } = await sapFetch({
    url: `${masterDataRoot(baseUrl)}/${entidad}Trans`,
    credentials,
    kind: 'ibp',
    method: 'POST',
    csrf,
    body: {
      TransactionID: transactionId,
      ...contexto,
      DoCommit: false,
      DeleteEntries: borrar,
      RequestedAttributes: atributos,
      [`Nav${entidad}`]: { results: limpias },
    },
  })

  return json ?? {}
}

/** Paso 4: confirmar. A partir de aquí lo enviado se guarda de verdad. */
export async function commitTransaction({ baseUrl, credentials, transactionId, csrf }) {
  const { json } = await sapFetch({
    url: `${masterDataRoot(baseUrl)}/Commit?P_TransactionID=${literal(transactionId)}`,
    credentials,
    kind: 'ibp',
    method: 'POST',
    csrf,
  })
  return json ?? {}
}

/**
 * El resultado de una transacción, aplanado.
 *
 * SAP lo devuelve como una lista de pares `{ Name, Value }`. Devuelve `null` cuando el tenant no
 * expone el endpoint, que no es lo mismo que un fallo.
 */
export async function getExportResult({ baseUrl, credentials, transactionId }) {
  try {
    const { json } = await sapFetch({
      url: `${masterDataRoot(baseUrl)}/GetExportResult?P_TransactionID=${literal(transactionId)}`,
      credentials,
      kind: 'ibp',
    })

    const pares = json?.d?.results ?? (Array.isArray(json?.d) ? json.d : null)
    if (!pares) return json?.d ?? null

    return Object.fromEntries(pares.filter((uno) => uno?.Name != null).map((uno) => [uno.Name, uno.Value]))
  } catch (error) {
    if (error?.status >= 400 && error?.status < 500) return null
    throw error
  }
}

/**
 * Paso 5: esperar a que SAP termine de aplicarla.
 *
 * Ver el punto 5 de la cabecera: confirmar no es instantáneo y leer antes de tiempo devuelve lo de
 * antes. `esperar` se puede sustituir desde los tests para no dormir de verdad.
 */
export async function waitForProcessed({
  baseUrl, credentials, transactionId,
  timeoutMs = ESPERA_MAXIMA_MS, intervalMs = INTERVALO_DE_ESPERA_MS,
  ahora = () => Date.now(),
  esperar = (ms) => new Promise((listo) => { setTimeout(listo, ms) }),
}) {
  const limite = ahora() + timeoutMs

  for (;;) {
    let resultado
    try {
      resultado = await getExportResult({ baseUrl, credentials, transactionId })
    } catch {
      // Un fallo puntual al preguntar no dice nada del estado de la transacción.
      resultado = undefined
    }

    if (resultado === null) return 'SIN_SOPORTE'
    if (resultado?.Status === 'PROCESSED') return 'PROCESADA'
    if (resultado?.Status === 'ERROR') return 'CON_ERROR'
    if (ahora() >= limite) return 'SIN_RESPUESTA'

    await esperar(intervalMs)
  }
}

/**
 * Paso 6: los mensajes que SAP dejó por cada fila rechazada.
 *
 * Se pide con `$expand` para traer los valores de la fila que falló al lado del mensaje —si no, hay
 * un motivo pero no se sabe de qué registro—. Hay tenants que rechazan el `$expand`, y ahí se
 * vuelve a pedir sin él: es mejor un mensaje sin la fila que ningún mensaje.
 */
export async function readMessages({ baseUrl, credentials, entidad, transactionId, porPagina = 2000 }) {
  const base = `${masterDataRoot(baseUrl)}/${entidad}Message?$format=json`
    + `&$filter=TransactionID eq ${literal(transactionId)}`

  const todos = []
  let conExpand = true
  let skip = 0

  for (;;) {
    const url = `${base}&$top=${porPagina}&$skip=${skip}${conExpand ? `&$expand=Nav${entidad}` : ''}`

    let pagina
    try {
      const { json } = await sapFetch({ url, credentials, kind: 'ibp' })
      pagina = json?.d?.results ?? []
    } catch (error) {
      if (conExpand && skip === 0) { conExpand = false; continue }
      throw error
    }

    todos.push(...pagina)
    if (pagina.length < porPagina) break
    skip += porPagina
  }

  return todos
}