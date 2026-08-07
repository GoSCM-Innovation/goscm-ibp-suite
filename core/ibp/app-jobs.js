// Los Application Jobs de IBP: qué trabajos hay y qué pasos ejecuta cada uno.
//
// Portado de `fetchAndDisplayJobs` y de la parte de pasos de `generateFromJobs` de `docs.js` de v9.
// Sirve para documentar un proyecto DESDE IBP: en vez de listar los dataflows del export sin más,
// el documento sale en el orden en que IBP los corre, con el job y el paso al que pertenece cada uno.
//
// El servicio es `BC_EXT_APPJOB_MANAGEMENT`, que a diferencia de los otros cuelga de
// `/sap/opu/odata/sap/` (en minúscula) y lleva versión en la ruta.

import { sapFetch } from '../transport/sap-fetch.js'

/** La raíz del servicio de Application Jobs. La versión va pegada al nombre, con punto y coma. */
export const APPJOB_ROOT = '/sap/opu/odata/sap/BC_EXT_APPJOB_MANAGEMENT;v=0002'

export const appJobRoot = (baseUrl) => `${String(baseUrl).replace(/\/+$/, '')}${APPJOB_ROOT}`

/**
 * Un paso de CI-DS se reconoce por este texto en su tipo.
 *
 * Un job de IBP mezcla pasos de integración con otros —copias de versión, algoritmos—, y solo los de
 * integración tienen un dataflow que documentar. Los demás igual aparecen en el índice para que el
 * orden del job se lea completo.
 */
export const TIPO_INTEGRACION = 'DATA INTEGRATION'

/** Cómo se identifica un paso dentro de una plantilla concreta. */
export const stepKey = (plantilla, version, secuencia) => `${plantilla || ''}|${version || ''}|${secuencia || ''}`

/** Las filas de una respuesta de OData, sea V2 (`d.results`) o V4 (`value`). */
const filasDe = (json) => json?.d?.results ?? json?.value ?? []

/** El enlace a la página siguiente, que SAP manda cuando la respuesta no entró entera. */
const siguienteDe = (json) => json?.d?.__next ?? json?.['@odata.nextLink'] ?? null

/**
 * Lee una entidad entera, siguiendo las páginas que SAP vaya indicando.
 *
 * El tope de páginas es un cortafuegos: una función de Vercel se corta a los diez segundos, y sin
 * límite una entidad grande consumiría el tiempo entero sin devolver nada.
 */
export async function readAllPages({ baseUrl, credentials, entity, query = '', maxPages = 20 }) {
  const filas = []
  let url = `${appJobRoot(baseUrl)}/${entity}?${query ? `${query}&` : ''}$format=json`

  for (let pagina = 0; pagina < maxPages && url; pagina += 1) {
    const { json } = await sapFetch({ url, credentials, kind: 'ibp' })
    filas.push(...filasDe(json))

    const siguiente = siguienteDe(json)
    url = siguiente ? new URL(siguiente, url).href : null
  }

  return filas
}

/**
 * Qué entidad del servicio lista las plantillas de trabajo.
 *
 * No se da por sentado su nombre: el servicio cambió de forma entre versiones, así que se busca en
 * su propio catálogo y solo si no aparece ninguna conocida se usa la primera que haya.
 */
export function pickJobEntity(entitySets) {
  return entitySets.find((uno) => /JobTemplate|CatalogEntries|JobSchedule/i.test(uno)) ?? entitySets[0] ?? null
}

/** Los nombres de conjunto que declara un `$metadata`. */
export function entitySetNames(xml) {
  return [...String(xml ?? '').matchAll(/<EntitySet\b[^>]*\bName="([^"]*)"/g)].map((una) => una[1])
}

/** Las plantillas de trabajo del tenant, con la entidad de la que salieron. */
export async function readJobTemplates({ baseUrl, credentials }) {
  const { text } = await sapFetch({
    url: `${appJobRoot(baseUrl)}/$metadata`,
    credentials,
    kind: 'ibp',
    expect: 'xml',
  })

  const conjuntos = entitySetNames(text)
  const entidad = pickJobEntity(conjuntos)
  if (!entidad) throw new Error('El servicio de Application Jobs no declara ninguna entidad.')

  return { entidad, entitySets: conjuntos, jobs: await readAllPages({ baseUrl, credentials, entity: entidad }) }
}

/** Escapa un literal de texto de OData: la comilla simple se duplica. */
const literal = (valor) => String(valor ?? '').replace(/'/g, "''")

/**
 * Los pasos de una plantilla, en el orden en que corren.
 *
 * El orden lo da SAP en `JobSequencePosition`, pero no garantiza devolverlos ordenados.
 */
export async function readJobSteps({ baseUrl, credentials, templateName, templateVersion }) {
  if (!templateName) return []

  const filtro = `JobTemplateName eq '${literal(templateName)}' and JobTemplateVersion eq '${literal(templateVersion ?? '0')}'`
  const filas = await readAllPages({
    baseUrl,
    credentials,
    entity: 'JobTemplateSequenceSet',
    query: `$filter=${encodeURIComponent(filtro)}`,
  })

  return filas
    .sort((a, b) => (a.JobSequencePosition || 0) - (b.JobSequencePosition || 0))
    .map((uno) => ({
      pos: uno.JobSequencePosition || 0,
      text: uno.JobSequenceText || uno.JceText || '',
      jceText: uno.JceText || '',
      seqName: uno.JobSequenceName || '',
      tpl: templateName,
      ver: String(templateVersion ?? '0'),
      taskId: '',
    }))
}

/**
 * El identificador técnico de la tarea de CI-DS de cada paso (`P_TSKID`).
 *
 * Es lo que permite emparejar un paso con su tarea aunque en IBP le hayan cambiado el nombre: el
 * texto del paso lo edita cualquiera, este identificador no. Una sola consulta trae todos.
 *
 * En un trabajo de UN SOLO paso, el parámetro se llama `P_TSKID` a secas y la secuencia no tiene
 * nombre. Se indexa igual, con la cadena vacía como nombre de paso: v9 exigía nombre y perdía justo
 * esos trabajos, que son los de tarea directa.
 */
export async function readTaskIds({ baseUrl, credentials }) {
  const filas = await readAllPages({
    baseUrl,
    credentials,
    entity: 'JobTemplateParameterValueDataSet',
    query: `$filter=${encodeURIComponent("startswith(JobTemplateParameterName,'P_TSKID') eq true")}`,
  })

  const porPaso = {}
  for (const fila of filas) {
    const taskId = (fila.Low || '').trim()
    if (!taskId) continue
    const secuencia = (fila.JobTemplateParameterName || '').replace(/^P_TSKID\s*/, '').trim()
    porPaso[stepKey(fila.JobTemplateName, fila.JobTemplateVersion, secuencia)] = taskId
  }

  return porPaso
}

/**
 * Qué trabajo y qué paso de IBP ejecutan cada tarea de CI-DS.
 *
 * Tres consultas para todo el tenant: los parámetros `P_TSKID`, todas las secuencias y todas las
 * plantillas. Pedir los pasos plantilla por plantilla serían cientos de consultas y no entraría en
 * el tiempo de una función.
 *
 * Una tarea puede aparecer más de una vez, y eso se conserva: a veces es legítimo —dos trabajos que
 * cargan lo mismo en momentos distintos— y a veces es un paso copiado al que no le cambiaron la
 * tarea. Las dos cosas hay que poder verlas.
 */
export async function readTaskIndex({ baseUrl, credentials }) {
  const [tareas, secuencias, plantillas] = await Promise.all([
    readTaskIds({ baseUrl, credentials }),
    readAllPages({ baseUrl, credentials, entity: 'JobTemplateSequenceSet', maxPages: 40 }),
    readAllPages({ baseUrl, credentials, entity: 'JobTemplateSet', maxPages: 40 }),
  ])

  const textoDePlantilla = new Map(plantillas.map((una) => [
    una.JobTemplateName,
    una.JobTemplateText || una.Text || una.JobTemplateName,
  ]))

  const indice = {}
  for (const secuencia of secuencias) {
    const tarea = tareas[stepKey(secuencia.JobTemplateName, secuencia.JobTemplateVersion, secuencia.JobSequenceName || '')]
    if (!tarea) continue

    const clave = tarea.toUpperCase()
    indice[clave] = [...(indice[clave] ?? []), {
      jobName: textoDePlantilla.get(secuencia.JobTemplateName) || secuencia.JobTemplateName,
      template: secuencia.JobTemplateName,
      stepName: secuencia.JobSequenceText || secuencia.JceText || '',
      stepPos: secuencia.JobSequencePosition || 0,
      stepType: secuencia.JceText || '',
    }]
  }

  for (const usos of Object.values(indice)) usos.sort((a, b) => a.stepPos - b.stepPos)
  return indice
}

/**
 * Los pasos de varias plantillas, ya con su identificador de tarea puesto.
 *
 * Si `P_TSKID` no se puede leer, los pasos se devuelven igual sin él: el emparejamiento cae al texto
 * del paso, que es lo que hacía v9 antes de que existiera esta consulta.
 */
export async function readJobsWithSteps({ baseUrl, credentials, plantillas }) {
  const pasos = await Promise.all(plantillas.map((una) => readJobSteps({
    baseUrl,
    credentials,
    templateName: una.templateName,
    templateVersion: una.templateVersion,
  })))

  let porPaso = {}
  let avisoDeTaskId = ''
  try {
    porPaso = await readTaskIds({ baseUrl, credentials })
  } catch (error) {
    avisoDeTaskId = error?.message || 'no se pudo leer P_TSKID'
  }

  for (const lista of pasos) {
    for (const paso of lista) paso.taskId = porPaso[stepKey(paso.tpl, paso.ver, paso.seqName)] || ''
  }

  return { pasos, avisoDeTaskId }
}
