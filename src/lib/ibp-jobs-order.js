// Ordenar la documentación como la corre IBP: por job, por paso y por el orden del ATL.
//
// Portado de la parte de emparejamiento de `generateFromJobs` de `docs.js` de v9.
//
// El problema: el export de CI-DS trae los dataflows sin ningún orden, y el ATL sabe el orden dentro
// de un proceso pero no en qué momento del día corre ese proceso. Eso lo sabe el Application Job de
// IBP. Cruzando los tres queda un documento que se lee de arriba abajo en el orden real.
//
// Un paso de IBP se empareja con su proceso por `P_TSKID`, el identificador técnico de la tarea de
// CI-DS. Es lo único invariable: el texto del paso lo edita cualquiera desde IBP.

import { SIN_GRUPO, matchATLtoIntegrations } from './cids-atl.js'

/** El texto que identifica a un paso de integración dentro de un job. */
export const TIPO_INTEGRACION = 'DATA INTEGRATION'

const enMayuscula = (valor) => String(valor ?? '').toUpperCase()

/**
 * El paso que corresponde a una sesión de ATL, entre todos los jobs elegidos.
 *
 * Se prueba primero la coincidencia exacta y solo después la parcial: con nombres largos y
 * parecidos, buscar por "contiene" desde el principio empareja el proceso equivocado.
 */
export function buscarPaso(pasosPorJob, sessionName) {
  const sesion = enMayuscula(sessionName)
  if (!sesion) return null

  const exacto = (paso) => enMayuscula(paso.taskId) === sesion || enMayuscula(paso.text) === sesion
  const parcial = (paso) => {
    const tarea = enMayuscula(paso.taskId)
    const texto = enMayuscula(paso.text)
    if (tarea && (tarea.includes(sesion) || sesion.includes(tarea))) return true
    return Boolean(texto) && (texto.includes(sesion) || sesion.includes(texto))
  }

  for (const comparar of [exacto, parcial]) {
    for (let jobIdx = 0; jobIdx < pasosPorJob.length; jobIdx += 1) {
      const paso = (pasosPorJob[jobIdx] ?? []).find(comparar)
      if (paso) return { paso, jobIdx }
    }
  }

  return null
}

/**
 * Cruza los ATL, los pasos de los jobs y las integraciones del export.
 *
 * Devuelve `filas` en el orden en que IBP las corre. Las filas que no son de integración —copias de
 * versión, algoritmos— van marcadas con `isNonDI`: aparecen en el índice para que el job se lea
 * completo, pero no tienen hoja de detalle porque no hay ningún dataflow que documentar.
 *
 * Una integración que ningún paso reclama NO se pierde: queda al final, sin job ni paso.
 */
export function ordenarPorJobs({ atls, entradas, jobs, pasosPorJob }) {
  const filas = []
  const yaPuestas = new Set()
  const avisos = []

  const nombreDeJob = (i) => jobs[i]?.nombre || ''

  // ── Los procesos: cada ATL cae en el paso que lo ejecuta.
  for (let i = 0; i < atls.length; i += 1) {
    const atl = atls[i]
    // Sin paso que lo reclame, el proceso igual se documenta: se lo cuelga del último job elegido y
    // se manda al final con una posición alta. Perderlo sería peor.
    const encontrado = buscarPaso(pasosPorJob, atl.sessionName)
    const jobIdx = encontrado?.jobIdx ?? Math.min(i, jobs.length - 1)

    if (!encontrado) avisos.push(`Ningún paso de IBP corresponde al proceso "${atl.sessionName}".`)

    const { ordenadas } = matchATLtoIntegrations(atl, entradas)
    for (const item of ordenadas) {
      if (item.atlGroup === SIN_GRUPO || yaPuestas.has(item.sheetName)) continue
      yaPuestas.add(item.sheetName)
      filas.push({
        ...item,
        ibpJobName: nombreDeJob(jobIdx),
        ibpStepName: encontrado?.paso.text ?? atl.sessionName,
        ibpStepType: encontrado?.paso.jceText ?? '',
        ibpStepPos: encontrado?.paso.pos ?? Number.MAX_SAFE_INTEGER,
        ibpJobIdx: Math.max(0, jobIdx),
      })
    }
  }

  // ── Las tareas sueltas: pasos de integración que no son un proceso y por eso no tienen ATL.
  const conAtl = new Set(atls.map((una) => enMayuscula(una.sessionName)))
  const porTarea = new Map()
  for (const entrada of entradas) {
    const clave = enMayuscula(entrada.parsed.jobName)
    if (clave) porTarea.set(clave, [...(porTarea.get(clave) ?? []), entrada])
  }

  for (let jobIdx = 0; jobIdx < pasosPorJob.length; jobIdx += 1) {
    for (const paso of pasosPorJob[jobIdx] ?? []) {
      if (!enMayuscula(paso.jceText).includes(TIPO_INTEGRACION)) continue

      const clave = enMayuscula(paso.taskId || paso.text)
      if (conAtl.has(clave)) continue

      const propias = (porTarea.get(clave) ?? porTarea.get(enMayuscula(paso.text)) ?? [])
        .filter((una) => !yaPuestas.has(una.sheetName))

      if (propias.length === 0) {
        avisos.push(`El paso "${paso.text}" no encontró su tarea en los ZIP cargados.`)
        continue
      }

      for (const item of propias) {
        yaPuestas.add(item.sheetName)
        filas.push({
          ...item,
          atlGroup: '',
          atlSession: '',
          atlOrder: filas.length + 1,
          ibpJobName: nombreDeJob(jobIdx),
          ibpStepName: paso.text,
          ibpStepType: paso.jceText || '',
          ibpStepPos: paso.pos,
          ibpJobIdx: jobIdx,
        })
      }
    }
  }

  // ── Lo que ningún paso reclamó. Sigue existiendo y hay que documentarlo.
  for (const entrada of entradas) {
    if (yaPuestas.has(entrada.sheetName)) continue
    filas.push({
      ...entrada,
      atlGroup: entrada.atlGroup === SIN_GRUPO ? '' : entrada.atlGroup ?? '',
      ibpJobName: '',
      ibpStepName: '',
      ibpStepType: '',
      ibpStepPos: Number.MAX_SAFE_INTEGER,
      ibpJobIdx: jobs.length,
    })
  }

  // ── Los pasos que no son de integración, como filas informativas sin hoja propia.
  for (let jobIdx = 0; jobIdx < pasosPorJob.length; jobIdx += 1) {
    for (const paso of pasosPorJob[jobIdx] ?? []) {
      if (enMayuscula(paso.jceText).includes(TIPO_INTEGRACION)) continue
      filas.push({
        isNonDI: true,
        sheetName: '',
        parsed: null,
        paramRow: {
          isNonDI: true,
          sheetName: '',
          tipoIntegracion: paso.jceText || paso.text,
          jobName: '',
          jobDesc: '',
          dataflowName: '',
          srcDS: '',
          dstDS: '',
          atlGroup: '',
          ibpJobName: nombreDeJob(jobIdx),
          ibpStepName: paso.text,
          ibpStepType: paso.jceText || '',
        },
        atlOrder: 0,
        ibpStepPos: paso.pos,
        ibpJobIdx: jobIdx,
      })
    }
  }

  filas.sort((a, b) => (
    (a.ibpJobIdx ?? 0) - (b.ibpJobIdx ?? 0)
    || (a.ibpStepPos ?? 0) - (b.ibpStepPos ?? 0)
    || (a.atlOrder ?? 0) - (b.atlOrder ?? 0)
  ))

  return { filas, avisos }
}
