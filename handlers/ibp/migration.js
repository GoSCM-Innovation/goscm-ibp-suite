// POST /api/ibp/migration — el análisis de campos de UNA tabla antes de migrarla.
//
// Solo LEE: cuántas filas tiene el origen con su filtro, y qué columnas se copian, cuáles se omiten
// y cuáles quedan vacías en el destino. Son las tres lecturas por tabla de `analyzeFields` de v8.
//
// Una tabla por llamada: la pantalla encadena las que se hayan elegido, y así ninguna llamada
// acumula el tiempo de veinte tablas. Va por POST porque lleva las condiciones del filtro.

import { requireModule } from '../../core/auth/guards.js'
import { getAnyCredentials, getConnectionTarget } from '../../core/connections/index.js'
import { explicarFallo } from '../../core/ibp/explicar-fallo.js'
import { analizarTabla, filtroDeCondiciones } from '../../core/ibp/index.js'

const ACUERDOS = ['SAP_COM_0720', 'SAP_COM_0326']

/** El contexto de un tenant, comprobando que la conexión sea de este cliente y de IBP. */
async function tenantDe(clientId, connectionId, cual) {
  if (!connectionId) throw new Error(`Falta la conexión de ${cual}.`)

  const conexion = await getConnectionTarget(clientId, connectionId)
  if (conexion.kind !== 'ibp') throw new Error(`La conexión de ${cual} no es de IBP.`)

  return {
    baseUrl: conexion.baseUrl,
    credentials: await getAnyCredentials(clientId, connectionId, ACUERDOS),
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' })

  const session = await requireModule(req, res, 'jobs')
  if (!session) return

  const { origen = {}, destino = {}, entidad, entidadDestino, condiciones = [] } = req.body ?? {}

  if (!entidad || !entidadDestino) return res.status(400).json({ error: 'Falta la tabla de origen o la de destino.' })
  if (!origen.planningArea || !destino.planningArea) {
    return res.status(400).json({ error: 'Falta el área de planificación de origen o de destino.' })
  }

  try {
    const [deOrigen, deDestino] = await Promise.all([
      tenantDe(session.clientId, origen.connectionId, 'origen'),
      tenantDe(session.clientId, destino.connectionId, 'destino'),
    ])

    const analisis = await analizarTabla({
      origen: { ...deOrigen, planningArea: origen.planningArea, versionId: origen.versionId || '' },
      destino: { ...deDestino, planningArea: destino.planningArea, versionId: destino.versionId || '' },
      entidad,
      entidadDestino,
      // El filtro es DE ESA TABLA: filtrar por marca solo tiene sentido en la de productos.
      extraFilter: filtroDeCondiciones(Array.isArray(condiciones) ? condiciones : []),
    })

    return res.status(200).json(analisis)
  } catch (error) {
    console.error(`[ibp/migration] ${error.stack || error.message}`)
    const detalle = error.detail ?? ''
    return res.status(400).json({ error: `${explicarFallo(error, ACUERDOS)}${detalle ? ` — ${detalle}` : ''}`, detalle })
  }
}
