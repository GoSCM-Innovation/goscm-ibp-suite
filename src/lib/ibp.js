// Lo que la interfaz le pregunta a un tenant de IBP, siempre a través de nuestra API.
//
// El navegador no sabe la dirección del tenant ni sus credenciales: solo dice a qué conexión.

import { api } from './api.js'

/**
 * Cómo se compara un nombre de tarea entre el export de CI-DS y el índice de IBP.
 *
 * Tiene que coincidir con lo que hace `readTaskIndex` al armar las claves.
 */
export const claveDeTarea = (nombre) => String(nombre ?? '').trim().toUpperCase()

/** Las conexiones de IBP a las que puede apuntar este usuario. */
export async function listIbpConnections() {
  const { connections } = await api.get('/api/connections', { kind: 'ibp' })
  return connections
}

/**
 * El catálogo de campos del tenant: etiquetas, tipos, entidades y áreas de planificación.
 *
 * `entityProps` viaja como listas porque tiene que ir en JSON, y se vuelve a armar como conjuntos:
 * es lo que espera el resolvedor de entidad, y comprobar pertenencia sobre una lista larga en cada
 * campo de cada integración se nota.
 */
export async function fetchCatalog(connectionId) {
  const catalogo = await api.get('/api/ibp/catalog', { connectionId })
  return {
    ...catalogo,
    entityProps: Object.fromEntries(
      Object.entries(catalogo.entityProps ?? {}).map(([entidad, campos]) => [entidad, new Set(campos)]),
    ),
  }
}

/** Una fila real de una entidad, para el ejemplo de la documentación. */
export function fetchSampleRow(connectionId, { service, entitySet, planArea, selectFields }) {
  return api.post('/api/ibp/sample', { connectionId, service, entitySet, planArea, selectFields })
}

/** Las plantillas de Application Job del tenant. */
export async function fetchJobTemplates(connectionId) {
  const { jobs } = await api.get('/api/ibp/jobs', { connectionId })
  return jobs
}

/**
 * Qué trabajo y qué paso de IBP ejecutan cada tarea de CI-DS, para todo el tenant.
 *
 * Las claves vienen en mayúsculas, que es como se comparan con los nombres de tarea del export.
 */
export async function fetchTaskIndex(connectionId) {
  const { indice } = await api.get('/api/ibp/jobs', { connectionId, indice: 'true' })
  return indice
}

/** Los pasos de las plantillas elegidas, ya con su identificador técnico de tarea. */
export function fetchJobSteps(connectionId, plantillas) {
  return api.post('/api/ibp/jobs', { connectionId, plantillas })
}

/**
 * Cómo se llama una plantilla de trabajo para el usuario.
 *
 * El nombre técnico de un job creado por el cliente es ilegible —`YY1_Z7ILD43UW3IP5DG7Z7RTFOEHW7U`—
 * y el nombre de verdad va en `JobTemplateText` ("Datos Maestros Indurama - Supply"). Los nombres
 * técnicos solo se muestran cuando no hay texto.
 */
export function nombreDeJob(job) {
  return job?.JobTemplateText || job?.Text || job?.TextEn || job?.JobTemplateName || ''
}

/** Una plantilla, reducida a lo que hace falta para pedir sus pasos. */
export const plantillaDe = (job) => ({
  templateName: job.JobTemplateName || '',
  templateVersion: String(job.JobTemplateVersion ?? '0'),
})
