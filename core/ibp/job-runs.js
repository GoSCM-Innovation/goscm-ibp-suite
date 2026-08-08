// Las ejecuciones de los Application Jobs: qué corrió, cómo acabó, y sus pasos y registros.
//
// Portado de `services/jobHeaders.js` y de las llamadas de `JobMonitor`/`StepsPanel` de v8.
//
// Dos cosas de aquí son conocimiento ganado contra tenants reales y no se pueden deducir leyendo la
// documentación de SAP:
//
//   1. `JobPlannedStartDateTime` NO es una fecha para SAP, es una CADENA (`Edm.String`) con el
//      formato `AAAAMMDDHHMMSS` — catorce dígitos y nada más. Por eso el filtro compara con
//      literales entrecomillados, y funciona porque el formato es de ancho fijo y rellenado con
//      ceros: comparar alfabéticamente equivale a comparar cronológicamente.
//
//      v8 le añadía `.0000000` al literal, con lo que medía 22 caracteres. El campo se declara con
//      `MaxLength="20"`, así que SAP lo rechazaba SIEMPRE con
//      "Value '…' violates facet" — el filtro de v8 nunca llegó a aplicarse en ningún tenant, y de
//      ahí venía la necesidad del reintento. Comprobado contra un tenant real: con catorce dígitos
//      filtra, con veintidós no.
//
//   2. El reintento sin filtro se conserva de todos modos. Ya no es el camino habitual, pero un
//      tenant puede tipar el campo de otra forma, y es preferible una pantalla lenta a una vacía.

import { sapFetch } from '../transport/sap-fetch.js'
import { appJobRoot, readAllPages } from './app-jobs.js'

/**
 * Las columnas que las pantallas usan de verdad.
 *
 * Pedirlas con `$select` en vez de traer la fila entera es la diferencia más grande en el tráfico de
 * fondo: el monitor se refresca solo cada minuto y una fila completa de `JobHeaderSet` trae docenas
 * de campos que nadie mira.
 */
export const JOB_HEADER_SELECT = Object.freeze([
  'JobName', 'JobRunCount', 'JobStatus', 'JobText', 'JobTemplateText', 'JobTemplateName',
  'JobCreatedByFormattedName', 'JobCreatedBy', 'JobStepCount',
  'JobPlannedStartDateTime', 'JobStartDateTime', 'JobEndDateTime', 'Periodic',
])

/**
 * Tope de filas por respuesta.
 *
 * El filtro de fecha ya acota el resultado; esto es el cinturón por si un tenant tiene muchísimos
 * trabajos en el rango, para que la respuesta no crezca sin límite.
 */
export const JOB_HEADER_TOP = 2000

/**
 * Cómo escribe SAP ese campo: `AAAAMMDDHHMMSS`, catorce dígitos.
 *
 * Sin fracción de segundo: el campo admite veinte caracteres y añadirla lo pasa a veintidós, con lo
 * que SAP rechaza el filtro entero.
 */
export function toSapTimestamp(fecha) {
  const d = fecha instanceof Date ? fecha : new Date(fecha)
  if (Number.isNaN(d.getTime())) throw new Error('Fecha inválida al armar el filtro de trabajos.')

  const dos = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${dos(d.getUTCMonth() + 1)}${dos(d.getUTCDate())}`
    + `${dos(d.getUTCHours())}${dos(d.getUTCMinutes())}${dos(d.getUTCSeconds())}`
}

/** Escapa un literal de texto de OData: la comilla simple se duplica. */
const literal = (valor) => String(valor ?? '').replace(/'/g, "''")

/** La consulta de `JobHeaderSet`, con o sin el filtro de fechas. */
export function buildJobHeaderQuery({ desde, hasta, conFiltro = true } = {}) {
  const partes = [`$select=${encodeURIComponent(JOB_HEADER_SELECT.join(','))}`, `$top=${JOB_HEADER_TOP}`]

  if (conFiltro && desde && hasta) {
    const filtro = `JobPlannedStartDateTime ge '${literal(desde)}' and JobPlannedStartDateTime le '${literal(hasta)}'`
    partes.push(`$filter=${encodeURIComponent(filtro)}`)
  }

  return partes.join('&')
}

/**
 * Tenants que rechazaron el filtro de fecha.
 *
 * Vive en memoria a propósito, sin pasar por Redis: una función serverless reutiliza su módulo
 * mientras está caliente, así que evita el doble viaje en la mayoría de las llamadas, y cuando
 * arranca en frío el único coste es una petición fallida. Guardarlo costaría una escritura por
 * descubrimiento para ahorrar eso.
 */
const filtroRechazado = new Set()

/** Solo para los tests: olvida lo aprendido sobre los tenants. */
export const resetFilterMemory = () => filtroRechazado.clear()

/**
 * Las ejecuciones del rango pedido.
 *
 * Devuelve además si pudo aplicar el filtro, para que la pantalla lo pueda decir: traer 2.000 filas
 * sin filtrar y traer las 40 del rango se parecen desde fuera, y no es lo mismo.
 */
export async function readJobRuns({ baseUrl, credentials, desde, hasta, connectionId = '' }) {
  const puedeFiltrar = Boolean(desde && hasta) && !filtroRechazado.has(connectionId)

  const pedir = async (conFiltro) => {
    const url = `${appJobRoot(baseUrl)}/JobHeaderSet?${buildJobHeaderQuery({ desde, hasta, conFiltro })}&$format=json`
    const { json } = await sapFetch({ url, credentials, kind: 'ibp' })
    return json?.d?.results ?? json?.value ?? []
  }

  if (!puedeFiltrar) return { runs: await pedir(false), filtrado: false }

  try {
    return { runs: await pedir(true), filtrado: true }
  } catch (error) {
    // Solo el 400 significa "este tenant no admite el filtro". Un 401 o un 500 son otra cosa y
    // reintentarlos sin filtro escondería el problema real.
    if (error?.status !== 400) throw error

    filtroRechazado.add(connectionId)
    return { runs: await pedir(false), filtrado: false, aviso: 'Este tenant no admite filtrar por fecha; se trajo el rango completo.' }
  }
}

/** El catálogo de estados que describe el tenant. Las etiquetas vienen de SAP. */
export async function readJobStatuses({ baseUrl, credentials }) {
  return readAllPages({ baseUrl, credentials, entity: 'JobStatusInfoSet' })
}

/** Una clave de entidad de OData: `Campo='valor'`. */
const clave = (campo, valor) => `${campo}='${encodeURIComponent(literal(valor))}'`

/**
 * Los pasos de una EJECUCIÓN, en orden.
 *
 * No confundir con `readJobSteps` de `app-jobs.js`, que devuelve los de una PLANTILLA: aquellos son
 * el guion, estos son lo que de verdad pasó al correrlo.
 */
export async function readRunSteps({ baseUrl, credentials, jobName, jobRunCount }) {
  const ruta = `JobHeaderSet(${clave('JobName', jobName)},${clave('JobRunCount', jobRunCount)})/JobStepSet`
  const { json } = await sapFetch({
    url: `${appJobRoot(baseUrl)}/${ruta}?$format=json`,
    credentials,
    kind: 'ibp',
  })

  const filas = json?.d?.results ?? json?.value ?? []
  return filas.sort((a, b) => Number(a.StepNumber ?? 0) - Number(b.StepNumber ?? 0))
}

/** Qué registros dejó un paso. Cada uno se identifica con un `LogHandle`. */
export async function readStepLogInfo({ baseUrl, credentials, jobName, jobRunCount, stepNumber }) {
  const ruta = `JobStepSet(${clave('JobName', jobName)},${clave('JobRunCount', jobRunCount)}`
    + `,StepNumber=${Number(stepNumber)})/JobStepLogInfoSet`

  const { json } = await sapFetch({ url: `${appJobRoot(baseUrl)}/${ruta}?$format=json`, credentials, kind: 'ibp' })
  return json?.d?.results ?? json?.value ?? []
}

/** Las líneas de un registro concreto. */
export async function readLogMessages({ baseUrl, credentials, jobName, jobRunCount, stepNumber, logHandle }) {
  const ruta = `JobStepLogInfoSet(${clave('JobName', jobName)},${clave('JobRunCount', jobRunCount)}`
    + `,StepNumber=${Number(stepNumber)},${clave('LogHandle', logHandle)})/JobLogMessageSet`

  const { json } = await sapFetch({ url: `${appJobRoot(baseUrl)}/${ruta}?$format=json`, credentials, kind: 'ibp' })
  return json?.d?.results ?? json?.value ?? []
}

/**
 * Le pide a SAP que detenga una ejecución.
 *
 * Es una función de OData, así que va por POST y necesita el token CSRF — de eso se ocupa
 * `sapFetch`, que lo pide una vez y lo reutiliza.
 */
export async function cancelJobRun({ baseUrl, credentials, jobName, jobRunCount }) {
  const raiz = appJobRoot(baseUrl)
  const url = `${raiz}/JobCancel?JobName='${encodeURIComponent(literal(jobName))}'`
    + `&JobRunCount='${encodeURIComponent(literal(jobRunCount))}'`

  await sapFetch({ url, method: 'POST', credentials, kind: 'ibp', serviceRoot: raiz })
  return { ok: true }
}

/**
 * Vuelve a lanzar una ejecución que ya acabó.
 *
 * `modo` es `'E'` (desde el paso que falló) o `'A'` (todo desde el principio). Se comprueba aquí y no
 * solo en la pantalla: mandar otra letra hace que SAP reinicie con un criterio que nadie eligió.
 */
export async function restartJobRun({ baseUrl, credentials, jobName, jobRunCount, modo }) {
  if (modo !== 'E' && modo !== 'A') {
    throw new Error(`Modo de reinicio desconocido: "${modo}". Debe ser 'E' o 'A'.`)
  }

  const raiz = appJobRoot(baseUrl)
  const url = `${raiz}/JobRestart?JobName='${encodeURIComponent(literal(jobName))}'`
    + `&JobRunCount='${encodeURIComponent(literal(jobRunCount))}'`
    + `&JobRestartMode='${modo}'`

  await sapFetch({ url, method: 'POST', credentials, kind: 'ibp', serviceRoot: raiz })
  return { ok: true }
}
