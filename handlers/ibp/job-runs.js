// Las ejecuciones de los Application Jobs: listarlas, ver sus pasos y registros, cancelar y reiniciar.
//
// GET  ?connectionId=…&desde=…&hasta=…       — las ejecuciones del rango.
// GET  ?connectionId=…&estados=true          — el catálogo de estados del tenant.
// GET  ?connectionId=…&jobName=…&runCount=…  — los pasos de una ejecución.
// GET  ?connectionId=…&jobName=…&runCount=…&parametros=true — con qué parámetros corrió cada paso.
// GET  ?connectionId=…&secuencias=…          — los nombres de paso de una plantilla.
// GET  ?connectionId=…&catalogo=…            — qué parámetros muestra un tipo de paso, y cómo.
// POST { accion: 'logs' | 'cancelar' | 'reiniciar', … }
//
// Todo en un archivo porque es una sola pantalla y comparten el preámbulo. Vercel cuenta funciones.
//
// Cancelar y reiniciar CAMBIAN algo en SAP, así que van por POST: un GET que detiene una carga es
// una trampa —lo dispara cualquier cosa que precargue enlaces—.

import { requireModule } from '../../core/auth/guards.js'
import { getConnectionTarget, getCredentials } from '../../core/connections/index.js'
import { explicarFallo } from '../../core/ibp/explicar-fallo.js'
import {
  cancelJobRun,
  readCatalogMeta,
  readJobRuns,
  readJobStatuses,
  readLogMessages,
  readRunParams,
  readRunSteps,
  readStepLogInfo,
  readTemplateSequences,
  restartJobRun,
} from '../../core/ibp/index.js'

const ACUERDO = 'SAP_COM_0326'

/** Prepara lo común: sesión, conexión de IBP y credenciales. Devuelve `null` si ya contestó. */
async function preparar(req, res) {
  const session = await requireModule(req, res, 'jobs')
  if (!session) return null

  const connectionId = req.method === 'GET' ? req.query?.connectionId : req.body?.connectionId
  if (!connectionId) {
    res.status(400).json({ error: 'Falta la conexión.' })
    return null
  }

  const conexion = await getConnectionTarget(session.clientId, connectionId)
  if (conexion.kind !== 'ibp') {
    res.status(400).json({ error: 'Esa conexión no es de IBP.' })
    return null
  }

  return {
    connectionId,
    baseUrl: conexion.baseUrl,
    credentials: await getCredentials(session.clientId, connectionId, ACUERDO),
  }
}

async function conGet(req, res, ctx) {
  if (req.query?.estados === 'true') {
    return res.status(200).json({ estados: await readJobStatuses(ctx) })
  }

  // Lo que el panel «Pasos del job» lee además de los pasos, igual que v8.
  if (req.query?.catalogo) {
    return res.status(200).json({ meta: await readCatalogMeta({ ...ctx, catalog: req.query.catalogo }) })
  }
  if (req.query?.secuencias) {
    return res.status(200).json({
      secuencias: await readTemplateSequences({ ...ctx, templateName: req.query.secuencias }),
    })
  }

  const { jobName, runCount } = req.query ?? {}
  if (jobName && runCount) {
    if (req.query.parametros === 'true') {
      return res.status(200).json({
        parametros: await readRunParams({ ...ctx, jobName, jobRunCount: runCount }),
      })
    }
    return res.status(200).json({
      pasos: await readRunSteps({ ...ctx, jobName, jobRunCount: runCount }),
    })
  }

  const { runs, filtrado, aviso } = await readJobRuns({
    ...ctx,
    desde: req.query?.desde,
    hasta: req.query?.hasta,
  })
  return res.status(200).json({ runs, filtrado, aviso: aviso ?? null })
}

async function conPost(req, res, ctx) {
  const { accion, jobName, runCount } = req.body ?? {}
  if (!jobName || !runCount) return res.status(400).json({ error: 'Falta la ejecución.' })

  const comun = { ...ctx, jobName, jobRunCount: runCount }

  switch (accion) {
    case 'logs': {
      const { stepNumber, logHandle } = req.body
      if (stepNumber === undefined) return res.status(400).json({ error: 'Falta el paso.' })

      // Sin `logHandle` se devuelve QUÉ registros dejó el paso; con él, sus líneas. Son dos
      // consultas distintas y la pantalla necesita las dos.
      return res.status(200).json(logHandle
        ? { lineas: await readLogMessages({ ...comun, stepNumber, logHandle }) }
        : { registros: await readStepLogInfo({ ...comun, stepNumber }) })
    }

    case 'cancelar':
      return res.status(200).json(await cancelJobRun(comun))

    case 'reiniciar':
      return res.status(200).json(await restartJobRun({ ...comun, modo: req.body?.modo }))

    default:
      return res.status(400).json({ error: `Acción desconocida: "${accion}".` })
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido.' })
  }

  // `preparar` también puede lanzar (una conexión que no es de este cliente, un acuerdo sin configurar):
  // eso es un 400 explicado, no un 500 sin controlar.
  let ctx
  try {
    ctx = await preparar(req, res)
  } catch (error) {
    console.error(`[ibp/job-runs] ${error.stack || error.message}`)
    return res.status(400).json({ error: explicarFallo(error, ACUERDO), detalle: error.detail ?? '' })
  }
  if (!ctx) return

  try {
    return req.method === 'GET' ? await conGet(req, res, ctx) : await conPost(req, res, ctx)
  } catch (error) {
    console.error(`[ibp/job-runs] ${error.stack || error.message}`)
    return res.status(400).json({ error: explicarFallo(error, ACUERDO), detalle: error.detail ?? '' })
  }
}
