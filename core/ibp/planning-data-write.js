// Escribir cifras clave en un tenant: el ciclo de transacción del servicio de planificación.
//
// Portado del lado de ESCRITURA de `services/planningDataApi.js` de v8. El ciclo se parece al del dato
// maestro pero NO es el mismo, y las diferencias son todas trampas que cuestan una tarde:
//
//   1. `getTransactionID` aquí NO lleva parámetros. En dato maestro se le pasa el tipo, el área y la
//      versión; aquí solo `$format=json`. El contexto va en cada envío, no al mintar.
//   2. `Transactionid` va con la I MINÚSCULA en el cuerpo y en los parámetros de la función. En dato
//      maestro es `TransactionID`. SAP no perdona la diferencia.
//   3. `commit` va en minúsculas —`/commit`—; en dato maestro es `/Commit`.
//   4. `Nav<Área>` recibe el ARREGLO directamente, no `{ results: [...] }` como en dato maestro.
//   5. Hace falta `AggregationLevelFieldsString`: la lista ORDENADA de columnas del nivel. Es lo que
//      le dice a SAP a qué nivel está escrito lo que se manda, y sin ella no puede desagregar.
//
// Y una regla que no se deduce de nada: el tope práctico son 2.500 VALORES por envío, no las 5.000
// filas que SAP admite. El tiempo de escritura escala casi lineal con los valores —se midió ~20 ms
// por valor—, así que 5.000 valores tardan más de dos minutos y se pasan del límite de la función:
// el envío muere y se reintenta, con lo que envíos más grandes salen MÁS LENTOS. El caudal se recupera
// con concurrencia, no con envíos más gordos.

import { fetchCsrf, sapFetch } from '../transport/sap-fetch.js'
import { planningRoot } from './planning-data.js'

/**
 * Valores por envío. Un valor es una celda: filas × cifras clave.
 *
 * 2.500 y no 5.000 por lo de la cabecera. Con este tope cada envío queda en unos cincuenta segundos,
 * cómodo por debajo del límite de la función.
 */
export const MAX_VALORES_POR_ENVIO = 2500

/** Cuánto se espera a que SAP termine de aplicar. Diez minutos: una carga grande los usa. */
export const ESPERA_MAXIMA_MS = 600_000

/** Cada cuánto se le pregunta. */
export const INTERVALO_DE_ESPERA_MS = 3000

/** Un literal de texto de OData dentro de una dirección. */
const literal = (valor) => `%27${encodeURIComponent(String(valor ?? ''))}%27`

/**
 * Cuántas FILAS caben en un envío, según cuántas cifras clave lleve cada una.
 *
 * Con una cifra son 2.500 filas; con cinco, 500. Es lo que hace que el tope se respete de verdad:
 * contar filas y no valores deja pasar envíos cinco veces más grandes de lo previsto.
 */
export function filasPorEnvio(cuantasCifras) {
  const cifras = Math.max(1, Number(cuantasCifras) || 1)
  return Math.max(1, Math.floor(MAX_VALORES_POR_ENVIO / cifras))
}

/** Parte las filas en envíos que respeten el tope de valores. */
export function partirEnEnvios(filas, cuantasCifras) {
  const porEnvio = filasPorEnvio(cuantasCifras)
  const envios = []
  for (let desde = 0; desde < (filas ?? []).length; desde += porEnvio) {
    envios.push(filas.slice(desde, desde + porEnvio))
  }
  return envios
}

/** El token de escritura y las cookies, una vez por transacción. */
export const abrirSesionDeEscritura = ({ baseUrl, credentials }) =>
  fetchCsrf({ serviceRoot: planningRoot(baseUrl), credentials, kind: 'ibp' })

/** Paso 1: pedir un identificador de transacción. Sin parámetros — ver el punto 1 de la cabecera. */
export async function getTransactionId({ baseUrl, credentials, csrf }) {
  const { json } = await sapFetch({
    url: `${planningRoot(baseUrl)}/getTransactionID?$format=json`,
    credentials,
    kind: 'ibp',
    csrf,
  })

  const id = json?.d?.Value
  if (!id) throw new Error('SAP no devolvió un identificador de transacción.')
  return id
}

/**
 * Paso 2 (opcional): pedirle a SAP que procese en paralelo.
 *
 * Mejora, no requisito: si el tenant no la admite se sigue igual. `nombre` es lo que le pone etiqueta
 * visible a la ejecución.
 */
export async function initiateParallelProcess({
  baseUrl, credentials, transactionId, area, versionId = '', scenarioId = '', nombre = 'goscm-suite', csrf,
}) {
  const partes = [
    `Transactionid=${literal(transactionId)}`,
    `VersionID=${literal(versionId)}`,
    `ScenarioID=${literal(scenarioId)}`,
    `PlanningArea=${literal(area)}`,
    `TransactionName=${literal(nombre)}`,
    '$format=json',
  ]

  try {
    const { json } = await sapFetch({
      url: `${planningRoot(baseUrl)}/InitiateParallelProcess?${partes.join('&')}`,
      credentials,
      kind: 'ibp',
      method: 'POST',
      csrf,
    })
    return json ?? null
  } catch (error) {
    // Un 4xx significa que este tenant no lo tiene; otra cosa sí es un problema.
    if (error?.status >= 400 && error?.status < 500) return null
    throw error
  }
}

/** Lo que SAP dice cuando se le manda una cifra CALCULADA, que no se puede escribir. */
const CIFRA_CALCULADA = /invalid column name:\s*([A-Z0-9_]+)/i

/**
 * Paso 3: mandar un lote de filas a la zona de preparación.
 *
 * SIN reintento, a propósito, por lo mismo que en dato maestro: repetir un envío que SAP ya guardó
 * duplica valores DENTRO de la misma transacción. El reintento correcto es de la transacción entera.
 *
 * Si la cifra es CALCULADA, SAP contesta 500 con "invalid column name". Se detecta y se marca en el
 * error, porque es la diferencia entre "SAP se cayó" —hay que reintentar— y "esta cifra no se puede
 * escribir nunca" —hay que sacarla del plan—. Sin distinguirlo, se reintenta tres veces algo que no
 * puede funcionar y el mensaje final no explica por qué.
 */
export async function postKfChunk({
  baseUrl, credentials, area, transactionId, filas, campos,
  versionId, scenarioId, confirmarYa = false, csrf,
}) {
  const cuerpo = {
    Transactionid: transactionId,
    // La lista ORDENADA de columnas del nivel: es lo que le dice a SAP a qué nivel está lo que se
    // manda. Sin ella no puede desagregar.
    AggregationLevelFieldsString: Array.isArray(campos) ? campos.join(',') : String(campos ?? ''),
    DoCommit: Boolean(confirmarYa),
    ...(versionId ? { VersionID: versionId } : {}),
    ...(scenarioId ? { ScenarioID: scenarioId } : {}),
    // El arreglo directo, no `{ results }` — ver el punto 4 de la cabecera.
    [`Nav${area}`]: filas ?? [],
  }

  try {
    const { json } = await sapFetch({
      url: `${planningRoot(baseUrl)}/${area}Trans`,
      credentials,
      kind: 'ibp',
      method: 'POST',
      csrf,
      body: cuerpo,
    })
    return json ?? {}
  } catch (error) {
    const calculada = CIFRA_CALCULADA.exec(error?.detail || error?.message || '')
    if (calculada) {
      error.cifraCalculada = calculada[1]
      error.message = `La cifra «${calculada[1]}» es calculada y no se puede escribir.`
    }
    throw error
  }
}

/** Paso 4: confirmar. En minúsculas — ver el punto 3 de la cabecera. */
export async function commitTransaction({ baseUrl, credentials, transactionId, csrf }) {
  const { json } = await sapFetch({
    url: `${planningRoot(baseUrl)}/commit?P_TransactionID=${literal(transactionId)}`,
    credentials,
    kind: 'ibp',
    method: 'POST',
    csrf,
  })
  return json ?? {}
}

/** El resultado de la transacción, aplanado. `null` si el tenant no expone el endpoint. */
export async function getExportResult({ baseUrl, credentials, transactionId }) {
  try {
    const { json } = await sapFetch({
      url: `${planningRoot(baseUrl)}/getExportResult?P_TransactionID=${literal(transactionId)}`,
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
 * Confirmar no es instantáneo y leer antes de tiempo devuelve lo de antes. `esperar` se puede
 * sustituir desde los tests para no dormir de verdad.
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

/** Paso 6: los mensajes que SAP dejó por las filas que rechazó. */
export async function readMessages({ baseUrl, credentials, area, transactionId, porPagina = 2000 }) {
  const base = `${planningRoot(baseUrl)}/${area}Message?$format=json`
    + `&$filter=Transactionid eq ${literal(transactionId)}`

  const todos = []
  let skip = 0

  for (;;) {
    const { json } = await sapFetch({
      url: `${base}&$top=${porPagina}&$skip=${skip}`,
      credentials,
      kind: 'ibp',
    })

    const pagina = json?.d?.results ?? []
    todos.push(...pagina)
    if (pagina.length < porPagina) break
    skip += porPagina
  }

  return todos
}
