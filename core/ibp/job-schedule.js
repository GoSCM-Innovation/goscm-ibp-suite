// Qué hace una plantilla de trabajo y cómo lanzarla.
//
// Portado de `ScheduleModal.jsx` de v8. Lo importante de esa pantalla, y lo que sorprende al leerla,
// es que NO edita parámetros: los MUESTRA. Un Application Job se configura en IBP —ahí se eligen el
// área, la versión, los filtros— y desde aquí solo se dispara con lo que ya tiene guardado.
//
// Por eso lanzar es una llamada de tres datos (plantilla, texto y usuario) y todo el trabajo está en
// leer y ordenar lo que la plantilla trae configurado, para que quien la lanza VEA con qué va a
// correr antes de darle. Es lo correcto: un formulario que dejara cambiar los parámetros aquí
// duplicaría la configuración de IBP y las dos versiones se irían separando.

import { sapFetch } from '../transport/sap-fetch.js'
import { appJobRoot, readAllPages } from './app-jobs.js'
import { etiquetaDeParametro, nombreBase, numeroDeRanura, pasoDesdeSecuencia } from './job-params.js'

/** Escapa un literal de OData: la comilla simple se duplica. */
const literal = (valor) => String(valor ?? '').replace(/'/g, "''")

/** Un literal entrecomillado, listo para meter en la URL. */
const comillado = (valor) => `'${encodeURIComponent(literal(valor))}'`

/** Una llamada de solo lectura que puede no estar permitida; se traga el fallo. */
const opcional = async (promesa, porOmision) => {
  try { return await promesa } catch { return porOmision }
}

const filas = (json) => json?.d?.results ?? json?.value ?? []

/** `JobTemplateRead` devuelve la plantilla como JSON dentro de un campo de texto. */
function secuenciasDe(json) {
  try {
    const dentro = JSON.parse(json?.d?.TemplateData ?? json?.TemplateData ?? 'null')
    return dentro?.templates?.[0]?.sequences ?? []
  } catch {
    return []
  }
}

/**
 * Las plantillas que lista la pantalla «Job Templates»: `JobTemplateSet` entero, TODAS.
 *
 * Es la consulta de `Jobs.jsx` de v8, una lectura directa de la entidad. No pasa por
 * `readJobTemplates` de `app-jobs.js`, que primero lee el `$metadata` para buscar cómo se llama la
 * entidad: ese camino viene del documentador de v9 y lo siguen usando el explorador de CI-DS y el
 * orquestador. Aquí se pide lo mismo que pedía v8, sin la vuelta previa.
 *
 * Si SAP parte la respuesta en páginas, se siguen: la primera petición es la de v8.
 */
export async function readJobTemplateSet({ baseUrl, credentials }) {
  return readAllPages({ baseUrl, credentials, entity: 'JobTemplateSet' })
}

/**
 * Qué va a hacer una plantilla cuando se lance: sus pasos y los valores que trae configurados.
 *
 * Hay plantillas —las de integración con CI-DS, entre otras— donde `JobTemplateRead` no está
 * permitido. Para esas se cae a `JobTemplateParameterValueDataSet`, que sí lo está y trae los
 * valores aunque sin agruparlos por paso. Es lo que hacía v8: un paso por cada secuencia de
 * `JobTemplateSequenceSet`, todos con los mismos parámetros. Sin secuencias, cero pasos.
 */
export async function readTemplateDetail({ baseUrl, credentials, templateName }) {
  const raiz = appJobRoot(baseUrl)
  const pedir = async (ruta) => (await sapFetch({ url: `${raiz}/${ruta}`, credentials, kind: 'ibp' })).json

  const [plantilla, grupos, secuenciasDeclaradas] = await Promise.all([
    opcional(pedir(`JobTemplateRead?JobTemplateName=${comillado(templateName)}&$format=json`), null),
    opcional(pedir(`JobTemplateParamGroupSet?$filter=${encodeURIComponent(`JobTemplateName eq '${literal(templateName)}'`)}&$format=json`), null),
    opcional(readAllPages({
      baseUrl,
      credentials,
      entity: `JobTemplateSet(JobTemplateName=${comillado(templateName)},JobTemplateVersion='0')/JobTemplateSequenceSet`,
    }), []),
  ])

  const etiquetasDeGrupo = {}
  for (const grupo of filas(grupos)) {
    etiquetasDeGrupo[grupo.JobTemplateParamGroupName] = grupo.JobTemplateParamGroupText
  }

  const nombreDelPaso = {}
  for (const una of secuenciasDeclaradas) {
    if (una.JobSequenceText) nombreDelPaso[una.JobSequencePosition] = una.JobSequenceText
  }

  const secuencias = secuenciasDe(plantilla)

  if (secuencias.length > 0) {
    // El texto legible de cada tipo de paso vive en SU propia plantilla.
    const catalogos = [...new Set(secuencias.map((una) => una.basic_jce_name).filter(Boolean))]
    const textosDeCatalogo = {}
    await Promise.all(catalogos.map(async (catalogo) => {
      const suya = await opcional(pedir(`JobTemplateRead?JobTemplateName=${comillado(catalogo)}&$format=json`), null)
      try {
        const dentro = JSON.parse(suya?.d?.TemplateData ?? suya?.TemplateData ?? 'null')
        if (dentro?.templates?.[0]?.text) textosDeCatalogo[catalogo] = dentro.templates[0].text
      } catch { /* se queda con el nombre técnico */ }
    }))

    return {
      pasos: secuencias.map((una, i) => ({
        ...pasoDesdeSecuencia(una, i + 1, { etiquetasDeGrupo, textosDeCatalogo }),
        nombre: nombreDelPaso[una.seq_position] ?? null,
      })),
      completo: true,
    }
  }

  // Respaldo, solo si SAP declara secuencias: los valores sin agrupar por paso.
  if (secuenciasDeclaradas.length === 0) return { pasos: [], completo: false }

  const sueltos = await opcional(readAllPages({
    baseUrl,
    credentials,
    entity: 'JobTemplateParameterValueDataSet',
    query: `$filter=${encodeURIComponent(`JobTemplateName eq '${literal(templateName)}'`)}`,
  }), [])

  const valores = {}
  for (const uno of sueltos) {
    const base = nombreBase(uno.JobTemplateParameterName)
    if (uno.Low !== undefined) valores[base] = [...(valores[base] ?? []), uno.Low]
  }

  const ranurasActivas = Number.parseInt(valores.P_VARNO?.[0] ?? '0', 10) || 0
  const vistos = new Set()
  const params = sueltos
    .filter((uno) => {
      const base = nombreBase(uno.JobTemplateParameterName)
      if (vistos.has(base)) return false
      vistos.add(base)
      const ranura = numeroDeRanura(base)
      return ranura === 0 || ranura <= ranurasActivas
    })
    .map((uno) => ({
      name: uno.JobTemplateParameterName,
      label: etiquetaDeParametro(uno.JobTemplateParameterName),
      group: null,
      // Sin `JobTemplateRead` no se sabe qué es casilla; v8 conocía una: «Production».
      isCheckbox: nombreBase(uno.JobTemplateParameterName) === 'P_ISPRD',
    }))

  const pasos = [...secuenciasDeclaradas]
    .sort((a, b) => (a.JobSequencePosition || 0) - (b.JobSequencePosition || 0))
    .map((una) => ({
      posicion: una.JobSequencePosition || 1,
      catalogo: una.BasicJobCatalogEntryName ?? '',
      titulo: una.JceText || una.BasicJobCatalogEntryName || '',
      nombre: una.JobSequenceText || null,
      params,
      valores,
    }))

  return { pasos, completo: false }
}

/**
 * Lanza la plantilla con lo que tiene configurado.
 *
 * `jobUser` es el usuario con el que SAP corre el trabajo. v8 mandaba el de la conexión y se hace
 * igual: es el usuario de comunicación que ya tiene permiso, y dejar que la pantalla eligiera otro
 * sería una forma de correr algo en nombre de un tercero.
 */
export async function scheduleJob({ baseUrl, credentials, templateName, jobText, jobUser }) {
  if (!templateName) throw new Error('Falta la plantilla que se quiere lanzar.')

  const raiz = appJobRoot(baseUrl)
  const url = `${raiz}/JobSchedule?JobTemplateName=${comillado(templateName)}`
    + `&JobText=${comillado(jobText || templateName)}`
    + (jobUser ? `&JobUser=${comillado(jobUser)}` : '')

  const { json } = await sapFetch({ url, method: 'POST', credentials, kind: 'ibp', serviceRoot: raiz })
  const creado = json?.d ?? json ?? {}
  // Hay tenants que devuelven el trabajo dentro de `JobSchedule`; el orquestador de v8 miraba los dos.
  const trabajo = creado.JobName ? creado : (creado.JobSchedule ?? creado)
  return { ok: true, jobName: trabajo.JobName ?? '', jobRunCount: trabajo.JobRunCount ?? '' }
}
