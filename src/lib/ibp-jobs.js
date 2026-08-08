// Lo que la interfaz le pregunta a IBP sobre las ejecuciones de sus Application Jobs.
//
// El navegador no sabe la dirección del tenant ni sus credenciales: solo dice a qué conexión.

import { api } from './api.js'

/**
 * De una fecha a la cadena de catorce dígitos con la que SAP compara ese campo.
 *
 * Se hace aquí y no en `useDateRange` porque es una peculiaridad de este servicio, no de las fechas:
 * CI-DS quiere la misma fecha en ISO. Ver `core/ibp/job-runs.js` para por qué son catorce y no más.
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
  return api.get('/api/ibp/job-runs', {
    connectionId,
    ...(desde && hasta ? { desde: aMarcaSap(desde), hasta: aMarcaSap(hasta) } : {}),
  })
}

/** El catálogo de estados del tenant: las etiquetas las escribe SAP. */
export async function fetchJobStatuses(connectionId) {
  const { estados } = await api.get('/api/ibp/job-runs', { connectionId, estados: 'true' })
  return estados
}

/** Los pasos de una ejecución, en orden. */
export async function fetchRunSteps(connectionId, { jobName, runCount }) {
  const { pasos } = await api.get('/api/ibp/job-runs', { connectionId, jobName, runCount })
  return pasos
}

/** Qué registros dejó un paso. */
export async function fetchStepLogs(connectionId, { jobName, runCount, stepNumber }) {
  const { registros } = await api.post('/api/ibp/job-runs', {
    connectionId, accion: 'logs', jobName, runCount, stepNumber,
  })
  return registros
}

/** Las líneas de un registro concreto. */
export async function fetchLogMessages(connectionId, { jobName, runCount, stepNumber, logHandle }) {
  const { lineas } = await api.post('/api/ibp/job-runs', {
    connectionId, accion: 'logs', jobName, runCount, stepNumber, logHandle,
  })
  return lineas
}

/** Le pide a SAP que detenga una ejecución. */
export function cancelRun(connectionId, { jobName, runCount }) {
  return api.post('/api/ibp/job-runs', { connectionId, accion: 'cancelar', jobName, runCount })
}

/** Vuelve a lanzarla. `modo` es 'E' (desde el paso fallado) o 'A' (todo). */
export function restartRun(connectionId, { jobName, runCount, modo }) {
  return api.post('/api/ibp/job-runs', { connectionId, accion: 'reiniciar', jobName, runCount, modo })
}

/**
 * Cómo se llama una ejecución para el usuario.
 *
 * `JobText` es el nombre que le puso quien la programó; cuando está vacío, el de la plantilla. El
 * `JobName` técnico es un identificador ilegible (`FA163E6E96DA1FD1A3ED5FB99BD1D743`), así que solo
 * se muestra si no hay nada mejor.
 */
export const nombreDeEjecucion = (run) => run?.JobText || run?.JobTemplateText || run?.JobTemplateName || run?.JobName || '—'
