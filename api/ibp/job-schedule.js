// GET  ?connectionId=…&templateName=…  — qué hace una plantilla y con qué valores.
// POST { connectionId, templateName, jobText } — la lanza.
//
// Lanzar CREA algo en el tenant, así que va por POST y nunca por GET: un enlace que dispara una
// carga de datos es una trampa, lo activa cualquier cosa que precargue enlaces.
//
// El usuario con el que SAP corre el trabajo es el de la conexión, no uno que elija la pantalla:
// dejar elegirlo sería una forma de correr algo en nombre de un tercero.

import { requireModule } from '../../core/auth/guards.js'
import { getConnectionTarget, getCredentials } from '../../core/connections/index.js'
import { readTemplateDetail, scheduleJob } from '../../core/ibp/index.js'

const ACUERDO = 'SAP_COM_0326'

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido.' })
  }

  const session = await requireModule(req, res, 'jobs')
  if (!session) return

  const cuerpo = req.method === 'GET' ? req.query : req.body
  const { connectionId, templateName } = cuerpo ?? {}
  if (!connectionId) return res.status(400).json({ error: 'Falta la conexión.' })
  if (!templateName) return res.status(400).json({ error: 'Falta la plantilla.' })

  try {
    const conexion = await getConnectionTarget(session.clientId, connectionId)
    if (conexion.kind !== 'ibp') return res.status(400).json({ error: 'Esa conexión no es de IBP.' })

    const credentials = await getCredentials(session.clientId, connectionId, ACUERDO)
    const comun = { baseUrl: conexion.baseUrl, credentials, templateName }

    if (req.method === 'GET') {
      return res.status(200).json(await readTemplateDetail(comun))
    }

    const lanzado = await scheduleJob({ ...comun, jobText: req.body?.jobText, jobUser: credentials.user })
    console.log(`[ibp/job-schedule] ${session.clientId} lanzó "${templateName}" -> ${lanzado.jobName || 'sin id'}`)
    return res.status(200).json(lanzado)
  } catch (error) {
    console.error(`[ibp/job-schedule] ${error.stack || error.message}`)
    return res.status(400).json({ error: error.message, detalle: error.detail ?? '' })
  }
}
