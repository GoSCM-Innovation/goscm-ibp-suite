// POST /api/ibp/sample — una fila real de una entidad, para el ejemplo de la documentación.
//
// Va por POST y no por GET porque la lista de campos del `$select` puede ser larga y no tiene por
// qué ir en la URL.
//
// Nunca devuelve error por que la entidad no conteste: eso es un ejemplo en blanco, no un fallo.
// El motivo viaja en `detail` para que la pantalla lo pueda mostrar como aviso.

import { requireModule } from '../../core/auth/guards.js'
import { getAnyCredentials, getConnectionTarget } from '../../core/connections/index.js'
import { explicarFallo } from '../../core/ibp/explicar-fallo.js'
import { readSampleRow } from '../../core/ibp/index.js'

/**
 * Los acuerdos que habilitan los servicios de datos, en orden de preferencia.
 *
 * El que corresponde es `SAP_COM_0720` —es el que habilita `MASTER_DATA_API_SRV` y
 * `PLANNING_DATA_API_SRV`, cada servicio por separado—. Se cae a `SAP_COM_0326` porque hay tenants
 * que emiten un único usuario para todo y solo lo tienen dado de alta ahí.
 */
const ACUERDOS = ['SAP_COM_0720', 'SAP_COM_0326']

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' })

  const session = await requireModule(req, res, 'cids')
  if (!session) return

  const { connectionId, service, entitySet, planArea, selectFields = [] } = req.body ?? {}
  if (!connectionId) return res.status(400).json({ error: 'Falta la conexión.' })
  if (!service || !entitySet || !planArea) {
    return res.status(400).json({ error: 'Falta el servicio, la entidad o el área de planificación.' })
  }

  try {
    const conexion = await getConnectionTarget(session.clientId, connectionId)
    if (conexion.kind !== 'ibp') return res.status(400).json({ error: 'Esa conexión no es de IBP.' })

    const credentials = await getAnyCredentials(session.clientId, connectionId, ACUERDOS)
    const { row, detail } = await readSampleRow({
      baseUrl: conexion.baseUrl,
      credentials,
      service,
      entitySet,
      planArea,
      selectFields: Array.isArray(selectFields) ? selectFields : [],
    })

    return res.status(200).json({ row, detail })
  } catch (error) {
    console.error(`[ibp/sample] ${error.stack || error.message}`)
    return res.status(400).json({ error: explicarFallo(error, ACUERDOS) })
  }
}
