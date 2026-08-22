// GET /api/ibp/metering?connectionId=…&dias=30[&usuario=…][&area=…] — el consumo, ya resumido.
//
// Lo que se resume aquí y no en el navegador: treinta días de actividad de aplicaciones son unas
// 15.600 filas en un tenant mediano —un par de megas— y de ahí salen unos pocos kB de rankings.
//
// `usuario` y `area` acotan la lectura EN SAP, no después: mirar a una persona baja de 15.623 filas
// a 4.397 en el tenant de pruebas. v8 se traía todo el tenant y filtraba en memoria.

import { requireModule } from '../../core/auth/guards.js'
import { getConnectionTarget, getCredentials } from '../../core/connections/index.js'
import { explicarFallo } from '../../core/ibp/explicar-fallo.js'
import { readMetering, resumirConsumo } from '../../core/ibp/index.js'

/** El acuerdo que habilita el servicio de actividad medida. */
const ACUERDO = 'SAP_COM_0924'

/** El tope de días. Noventa es lo que ofrecía v8, y ya son cuatro páginas del conjunto más grande. */
const MAX_DIAS = 90

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' })

  const session = await requireModule(req, res, 'jobs')
  if (!session) return

  const connectionId = req.query?.connectionId
  if (!connectionId) return res.status(400).json({ error: 'Falta la conexión.' })

  const dias = Math.min(Number(req.query?.dias) || 30, MAX_DIAS)
  if (dias <= 0) return res.status(400).json({ error: 'El rango de días no es válido.' })

  try {
    const conexion = await getConnectionTarget(session.clientId, connectionId)
    if (conexion.kind !== 'ibp') return res.status(400).json({ error: 'Esa conexión no es de IBP.' })

    const hasta = new Date()
    const desde = new Date(hasta.getTime() - dias * 86_400_000)

    const credentials = await getCredentials(session.clientId, connectionId, ACUERDO)
    const usuario = req.query?.usuario || ''
    const area = req.query?.area || ''

    const { datos, avisos, totales } = await readMetering({
      baseUrl: conexion.baseUrl,
      credentials,
      desde,
      hasta,
      usuario,
      area,
    })

    return res.status(200).json({
      dias,
      desde: desde.toISOString(),
      hasta: hasta.toISOString(),
      usuario,
      area,
      avisos,
      totales,
      ...resumirConsumo(datos, {
        desde: desde.toISOString(),
        hasta: hasta.toISOString(),
        conContexto: Boolean(usuario || area),
      }),
    })
  } catch (error) {
    console.error(`[ibp/metering] ${error.stack || error.message}`)
    return res.status(400).json({ error: explicarFallo(error, ACUERDO), detalle: error.detail ?? '' })
  }
}
