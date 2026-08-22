// POST /api/ibp/migration-run — copia UN segmento de una tabla de un tenant a otro.
//
// ESTO ESCRIBE EN SAP. Es la única llamada de la aplicación que modifica dato maestro.
//
// Un segmento por llamada y no una tabla entera, por dos motivos que apuntan al mismo sitio: una
// tabla de trescientas mil filas no cabe en el tiempo de una función serverless, y cada segmento es
// ya una transacción propia de SAP, así que es la unidad natural del reintento. Quien llama
// encadena y va viendo el avance.
//
// La confirmación explícita no es decorativa: sin ella, una petición repetida por un reintento
// automático de cualquier capa intermedia escribiría en un tenant que puede ser productivo.

import { requireModule } from '../../core/auth/guards.js'
import { getAnyCredentials, getConnectionTarget } from '../../core/connections/index.js'
import { filtroDeCondiciones, migrarSegmento } from '../../core/ibp/index.js'

const ACUERDOS = ['SAP_COM_0720', 'SAP_COM_0326']

/** Lo que hay que mandar para que la carga se ejecute. */
const CONFIRMACION = 'copiar'

/** Tope de filas por llamada, para no pasarse del tiempo de la función. */
const MAX_POR_SEGMENTO = 40_000

async function tenantDe(clientId, connectionId, cual) {
  if (!connectionId) throw new Error(`Falta la conexión de ${cual}.`)

  const conexion = await getConnectionTarget(clientId, connectionId)
  if (conexion.kind !== 'ibp') throw new Error(`La conexión de ${cual} no es de IBP.`)

  return {
    baseUrl: conexion.baseUrl,
    credentials: await getAnyCredentials(clientId, connectionId, ACUERDOS),
    isProduction: conexion.isProduction,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' })

  const session = await requireModule(req, res, 'jobs')
  if (!session) return

  const {
    origen = {}, destino = {}, entidad, entidadDestino, columnas = [], claves = [],
    desde = 0, cuantas = 5000, condiciones = [], borrar = false, nombre, confirmacion,
  } = req.body ?? {}

  if (confirmacion !== CONFIRMACION) {
    return res.status(400).json({ error: 'Falta la confirmación de que se quiere escribir en el tenant de destino.' })
  }
  if (!entidad || !entidadDestino) return res.status(400).json({ error: 'Falta la tabla de origen o la de destino.' })
  if (!Array.isArray(columnas) || columnas.length === 0) {
    return res.status(400).json({ error: 'Falta la lista de columnas que se van a copiar.' })
  }
  if (origen.connectionId === destino.connectionId
    && origen.planningArea === destino.planningArea
    && origen.versionId === destino.versionId) {
    return res.status(400).json({ error: 'El origen y el destino son el mismo tenant, área y versión.' })
  }

  try {
    const [deOrigen, deDestino] = await Promise.all([
      tenantDe(session.clientId, origen.connectionId, 'origen'),
      tenantDe(session.clientId, destino.connectionId, 'destino'),
    ])

    const segmento = await migrarSegmento({
      origen: { ...deOrigen, planningArea: origen.planningArea, versionId: origen.versionId },
      destino: { ...deDestino, planningArea: destino.planningArea, versionId: destino.versionId },
      entidad,
      entidadDestino,
      columnas,
      claves,
      desde: Number(desde) || 0,
      cuantas: Math.min(Number(cuantas) || 5000, MAX_POR_SEGMENTO),
      condiciones: filtroDeCondiciones(condiciones),
      borrar: Boolean(borrar),
      nombre,
    })

    // Queda registrado quién escribió en qué tenant: es la única operación que cambia dato maestro.
    console.log(`[ibp/migration-run] ${session.userId ?? session.clientId} · ${entidad} → ${entidadDestino}`
      + ` · ${segmento.filas} filas desde ${segmento.desde} · ${segmento.ok ? 'ok' : `fallo: ${segmento.error}`}`)

    return res.status(200).json(segmento)
  } catch (error) {
    console.error(`[ibp/migration-run] ${error.stack || error.message}`)
    return res.status(400).json({ error: error.message, detalle: error.detail ?? '' })
  }
}
