// GET  /api/ibp/jobs?connectionId=…                 — las plantillas de trabajo del tenant.
// GET  /api/ibp/jobs?connectionId=…&indice=true      — qué trabajo y paso ejecutan cada tarea.
// POST /api/ibp/jobs  { connectionId, plantillas }   — los pasos de las plantillas elegidas.
//
// Las tres van en un archivo porque son partes de la misma pregunta y comparten todo el preámbulo.
// Vercel cuenta funciones, no rutas.
//
// El acuerdo es `SAP_COM_0326`, que es el de los Application Jobs. Los datos maestros y de
// planificación van por otro (`SAP_COM_0720`) y con su propio usuario.

import { requireModule } from '../../core/auth/guards.js'
import { getConnectionTarget, getCredentials } from '../../core/connections/index.js'
import { explicarFallo } from '../../core/ibp/explicar-fallo.js'
import { readJobTemplates, readJobsWithSteps, readTaskIndex } from '../../core/ibp/index.js'

const ACUERDO = 'SAP_COM_0326'

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido.' })
  }

  const session = await requireModule(req, res, 'cids')
  if (!session) return

  const connectionId = req.method === 'GET' ? req.query?.connectionId : req.body?.connectionId
  if (!connectionId) return res.status(400).json({ error: 'Falta la conexión.' })

  try {
    const conexion = await getConnectionTarget(session.clientId, connectionId)
    if (conexion.kind !== 'ibp') return res.status(400).json({ error: 'Esa conexión no es de IBP.' })

    const credentials = await getCredentials(session.clientId, connectionId, ACUERDO)

    if (req.method === 'GET') {
      if (req.query?.indice === 'true') {
        return res.status(200).json({ indice: await readTaskIndex({ baseUrl: conexion.baseUrl, credentials }) })
      }
      const { entidad, jobs } = await readJobTemplates({ baseUrl: conexion.baseUrl, credentials })
      return res.status(200).json({ entidad, jobs })
    }

    const plantillas = Array.isArray(req.body?.plantillas) ? req.body.plantillas : []
    if (plantillas.length === 0) return res.status(400).json({ error: 'No se eligió ninguna plantilla.' })

    const { pasos, avisoDeTaskId } = await readJobsWithSteps({
      baseUrl: conexion.baseUrl,
      credentials,
      plantillas,
    })
    return res.status(200).json({ pasos, avisoDeTaskId })
  } catch (error) {
    console.error(`[ibp/jobs] ${error.stack || error.message}`)
    return res.status(400).json({ error: explicarFallo(error, ACUERDO) })
  }
}
