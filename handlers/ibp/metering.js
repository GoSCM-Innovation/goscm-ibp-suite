// GET /api/ibp/metering?connectionId=…&desde=ISO&hasta=ISO — la telemetría del período.
//
// Devuelve las filas de los diez conjuntos que leía v8, compactadas (`core/ibp/metering-rows.js`), y
// la pantalla hace las cuentas como allí. El período llega como dos marcas ISO porque v8 permitía
// cualquier rango —los botones y los campos «Desde» / «Hasta»—, no solo un número de días.
//
// El contexto (un usuario o un área) no viaja: v8 lo aplicaba en el navegador sobre lo ya leído, y
// cambiarlo era instantáneo.

import { requireModule } from '../../core/auth/guards.js'
import { getConnectionTarget, getCredentials } from '../../core/connections/index.js'
import { explicarFallo } from '../../core/ibp/explicar-fallo.js'
import { readMetering } from '../../core/ibp/index.js'

/** El acuerdo que habilita el servicio de actividad medida. */
const ACUERDO = 'SAP_COM_0924'

/** Una marca ISO válida, o `null`. */
function fecha(valor) {
  if (!valor) return null
  const d = new Date(String(valor))
  return Number.isNaN(d.getTime()) ? null : d
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' })

  const session = await requireModule(req, res, 'jobs')
  if (!session) return

  const connectionId = req.query?.connectionId
  if (!connectionId) return res.status(400).json({ error: 'Falta la conexión.' })

  const desde = fecha(req.query?.desde)
  const hasta = fecha(req.query?.hasta)
  if (!desde || !hasta) return res.status(400).json({ error: 'El período no es válido.' })

  try {
    const conexion = await getConnectionTarget(session.clientId, connectionId)
    if (conexion.kind !== 'ibp') return res.status(400).json({ error: 'Esa conexión no es de IBP.' })

    const credentials = await getCredentials(session.clientId, connectionId, ACUERDO)
    const salida = await readMetering({ baseUrl: conexion.baseUrl, credentials, desde, hasta })

    return res.status(200).json({ desde: desde.toISOString(), hasta: hasta.toISOString(), ...salida })
  } catch (error) {
    console.error(`[ibp/metering] ${error.stack || error.message}`)
    return res.status(400).json({ error: explicarFallo(error, ACUERDO), detalle: error.detail ?? '' })
  }
}
