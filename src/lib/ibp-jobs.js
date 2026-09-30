// Lo que la interfaz le pregunta a IBP sobre sus Application Jobs: plantillas, ejecuciones, pasos.
//
// El navegador no sabe la dirección del tenant ni sus credenciales: solo dice a qué conexión.

import { ApiError } from './api.js'
import { anotarLlamada } from './tech-logs.js'

/**
 * Una llamada a nuestra API que, cuando falla, dice lo que dijo SAP.
 *
 * Es la de `api.js` con UNA diferencia: el mensaje de error lleva pegado el `detalle` que manda el
 * servidor —el texto de SAP, «[APJ_RT/028] …»—. `api.js` se queda solo con el resumen («SAP devolvió
 * 400»), y con eso no se sabe qué pasó. Las pantallas de Jobs de v8 mostraban siempre
 * `error: detalle`, y el panel de pasos lo necesita para reconocer la falta del rol
 * `SAP_BCG_APPLICATION_JOB_DISP`.
 *
 * Anota la llamada en el panel de diagnóstico igual que `api.js`.
 */
async function pedir(path, { method = 'GET', params, body } = {}) {
  const query = params ? `?${new URLSearchParams(params)}` : ''
  const arranque = Date.now()

  let response
  try {
    response = await fetch(`${path}${query}`, {
      method,
      credentials: 'same-origin',
      ...(body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    })
  } catch (fallo) {
    anotarLlamada({ metodo: method, ruta: path, estado: 0, ms: Date.now() - arranque, detalle: fallo.message })
    throw fallo
  }

  const text = await response.text()
  const anotar = (detalle) => anotarLlamada({
    metodo: method, ruta: path, estado: response.status, ms: Date.now() - arranque, detalle,
  })

  let data = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    anotar('respuesta ilegible')
    throw new ApiError('El servidor devolvió una respuesta ilegible.', response.status)
  }

  if (!response.ok) {
    const mensaje = data.error
      ? `${data.error}${data.detalle ? `: ${data.detalle}` : ''}`
      : `Error ${response.status}`
    anotar(mensaje)
    throw new ApiError(mensaje, response.status)
  }

  anotar('')
  return data
}

const get = (path, params) => pedir(path, { params })
const post = (path, body) => pedir(path, { method: 'POST', body })

/**
 * De una fecha a la cadena de catorce dígitos con la que SAP compara ese campo.
 *
 * Se hace aquí y no en `useDateRange` porque es una peculiaridad de este servicio, no de las fechas:
 * CI-DS quiere la misma fecha en ISO. Ver `core/ibp/job-runs.js` para por qué son catorce y no más.
 * Acepta un ISO o un `Date`; una fecha inválida da la cadena vacía, y sin fechas no se filtra.
 */
export function aMarcaSap(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''

  const dos = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${dos(d.getUTCMonth() + 1)}${dos(d.getUTCDate())}`
    + `${dos(d.getUTCHours())}${dos(d.getUTCMinutes())}${dos(d.getUTCSeconds())}`
}

/** Las ejecuciones de un rango. Dice además si el tenant admitió filtrar. */
export function fetchJobRuns(connectionId, { desde, hasta } = {}) {
  return get('/api/ibp/job-runs', {
    connectionId,
    ...(desde && hasta ? { desde: aMarcaSap(desde), hasta: aMarcaSap(hasta) } : {}),
  })
}

/** El catálogo de estados del tenant: las etiquetas las escribe SAP. */
export async function fetchJobStatuses(connectionId) {
  const { estados } = await get('/api/ibp/job-runs', { connectionId, estados: 'true' })
  return estados
}

/** Los pasos de una ejecución, en orden. */
export async function fetchRunSteps(connectionId, { jobName, runCount }) {
  const { pasos } = await get('/api/ibp/job-runs', { connectionId, jobName, runCount })
  return pasos
}

/** Con qué parámetros corrió cada paso de una ejecución (`JobParamValuesStructGet`). */
export async function fetchRunParams(connectionId, { jobName, runCount }) {
  const { parametros } = await get('/api/ibp/job-runs', { connectionId, jobName, runCount, parametros: 'true' })
  return parametros
}

/** Las secuencias de las plantillas cuyo nombre contiene el dado: de ahí salen los nombres de paso. */
export async function fetchTemplateSequences(connectionId, templateName) {
  const { secuencias } = await get('/api/ibp/job-runs', { connectionId, secuencias: templateName })
  return secuencias
}

/** Qué parámetros muestra un tipo de paso, en qué orden, con qué etiqueta y en qué sección. */
export async function fetchCatalogMeta(connectionId, catalog) {
  const { meta } = await get('/api/ibp/job-runs', { connectionId, catalogo: catalog })
  return meta
}

/** Qué registros dejó un paso. */
export async function fetchStepLogs(connectionId, { jobName, runCount, stepNumber }) {
  const { registros } = await post('/api/ibp/job-runs', {
    connectionId, accion: 'logs', jobName, runCount, stepNumber,
  })
  return registros
}

/** Las líneas de un registro concreto. */
export async function fetchLogMessages(connectionId, { jobName, runCount, stepNumber, logHandle }) {
  const { lineas } = await post('/api/ibp/job-runs', {
    connectionId, accion: 'logs', jobName, runCount, stepNumber, logHandle,
  })
  return lineas
}

/** Le pide a SAP que detenga una ejecución. */
export function cancelRun(connectionId, { jobName, runCount }) {
  return post('/api/ibp/job-runs', { connectionId, accion: 'cancelar', jobName, runCount })
}

/** Vuelve a lanzarla. `modo` es 'E' (desde el paso fallado) o 'A' (todo). */
export function restartRun(connectionId, { jobName, runCount, modo }) {
  return post('/api/ibp/job-runs', { connectionId, accion: 'reiniciar', jobName, runCount, modo })
}

/**
 * Cómo se llama una ejecución para el usuario.
 *
 * `JobText` es el nombre que le puso quien la programó; cuando está vacío, el de la plantilla. El
 * `JobName` técnico es un identificador ilegible (`FA163E6E96DA1FD1A3ED5FB99BD1D743`), así que solo
 * se muestra si no hay nada mejor.
 */
export const nombreDeEjecucion = (run) => run?.JobText || run?.JobTemplateText || run?.JobTemplateName || run?.JobName || '—'

/** Las plantillas que lista «Job Templates»: `JobTemplateSet` entero, como lo leía v8. */
export async function fetchJobTemplateSet(connectionId) {
  const { plantillas } = await get('/api/ibp/job-schedule', { connectionId })
  return plantillas
}

/** Qué hace una plantilla y con qué valores está configurada. */
export function fetchTemplateDetail(connectionId, templateName) {
  return get('/api/ibp/job-schedule', { connectionId, templateName })
}

/**
 * Lanza una plantilla. CREA una ejecución en el tenant.
 *
 * El usuario con el que corre lo pone el servidor, no esta llamada.
 */
export function scheduleJob(connectionId, { templateName, jobText }) {
  return post('/api/ibp/job-schedule', { connectionId, templateName, jobText })
}
