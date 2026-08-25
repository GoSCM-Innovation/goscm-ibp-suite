// POST /api/ibp/migration — el plan de una migración de dato maestro entre dos tenants.
//
// Solo LEE. Devuelve, tabla por tabla, con qué se emparejó en el destino, qué columnas se copiarían,
// cuáles se perderían y cuántas filas hay. La carga en sí es otra cosa y va aparte.
//
// Va por POST porque la petición lleva la lista de tablas y las parejas puestas a mano, que no
// entran razonablemente en una dirección — no porque cambie nada.

import { requireModule } from '../../core/auth/guards.js'
import { getAnyCredentials, getConnectionTarget } from '../../core/connections/index.js'
import { explicarFallo } from '../../core/ibp/explicar-fallo.js'
import { filtroDeCondiciones, planificarMigracion } from '../../core/ibp/index.js'

const ACUERDOS = ['SAP_COM_0720', 'SAP_COM_0326']

/** Tope de tablas por plan: cada una son tres lecturas a SAP. */
const MAX_TABLAS = 60

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

  const {
    origen = {}, destino = {}, tablas = [], tablasDelDestino = [], destinoDe = {},
    // Las condiciones son POR TABLA: `{ tabla: [condiciones] }`. Un filtro global no serviria —
    // filtrar por marca solo tiene sentido en la tabla de productos.
    condicionesPorTabla = {},
  } = req.body ?? {}

  if (!Array.isArray(tablas) || tablas.length === 0) {
    return res.status(400).json({ error: 'Hay que elegir al menos una tabla.' })
  }
  if (tablas.length > MAX_TABLAS) {
    return res.status(400).json({ error: `Como máximo ${MAX_TABLAS} tablas; elige menos y repite el plan.` })
  }
  // Copiar un tenant sobre sí mismo con la misma área y versión sobrescribiría el origen con el
  // origen: no rompe nada, pero no es lo que nadie quiere, y es un error fácil de cometer.
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

    const plan = await planificarMigracion({
      origen: { ...deOrigen, planningArea: origen.planningArea, versionId: origen.versionId },
      destino: { ...deDestino, planningArea: destino.planningArea, versionId: destino.versionId },
      tablas,
      tablasDelDestino,
      destinoDe,
      filtroPorTabla: Object.fromEntries(
        Object.entries(condicionesPorTabla).map(([tabla, suyas]) => [tabla, filtroDeCondiciones(suyas)]),
      ),
    })

    return res.status(200).json(plan)
  } catch (error) {
    console.error(`[ibp/migration] ${error.stack || error.message}`)
    return res.status(400).json({ error: explicarFallo(error, ACUERDOS), detalle: error.detail ?? '' })
  }
}
