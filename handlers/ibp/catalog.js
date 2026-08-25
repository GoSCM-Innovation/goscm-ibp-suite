// GET /api/ibp/catalog?connectionId=… — las etiquetas y los tipos de campo del tenant.
//
// El `$metadata` de dato maestro pesa unos 4,8 MB y una función de Vercel no puede devolver una
// respuesta así. Recibirla sí puede: se lee aquí y se devuelve solo el catálogo, que son unos pocos
// cientos de kB.
//
// `entityProps` se manda como listas y no como conjuntos porque tiene que viajar en JSON; quien lo
// use del otro lado lo vuelve a armar.

import { requireModule } from '../../core/auth/guards.js'
import { getAnyCredentials, getConnectionTarget } from '../../core/connections/index.js'
import { explicarFallo } from '../../core/ibp/explicar-fallo.js'
import { readCatalog } from '../../core/ibp/index.js'

/**
 * Los acuerdos que habilitan los servicios de datos, en orden de preferencia.
 *
 * El que corresponde es `SAP_COM_0720` -es el que habilita `MASTER_DATA_API_SRV` y
 * `PLANNING_DATA_API_SRV`, cada servicio por separado-. Se cae a `SAP_COM_0326` porque hay tenants
 * que emiten un único usuario para todo y solo lo tienen dado de alta ahí.
 */
const ACUERDOS = ['SAP_COM_0720', 'SAP_COM_0326']

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' })

  const session = await requireModule(req, res, 'cids')
  if (!session) return

  const connectionId = req.query?.connectionId
  if (!connectionId) return res.status(400).json({ error: 'Falta la conexión.' })

  try {
    const conexion = await getConnectionTarget(session.clientId, connectionId)
    if (conexion.kind !== 'ibp') return res.status(400).json({ error: 'Esa conexión no es de IBP.' })

    const credentials = await getAnyCredentials(session.clientId, connectionId, ACUERDOS)
    const catalogo = await readCatalog({ baseUrl: conexion.baseUrl, credentials })

    return res.status(200).json({
      descs: catalogo.descs,
      types: catalogo.types,
      entitySets: catalogo.entitySets,
      entityProps: Object.fromEntries(
        Object.entries(catalogo.entityProps).map(([entidad, campos]) => [entidad, [...campos]]),
      ),
      planAreas: catalogo.planAreas,
      fallados: catalogo.fallados,
    })
  } catch (error) {
    console.error(`[ibp/catalog] ${error.stack || error.message}`)
    return res.status(400).json({ error: explicarFallo(error, ACUERDOS) })
  }
}
