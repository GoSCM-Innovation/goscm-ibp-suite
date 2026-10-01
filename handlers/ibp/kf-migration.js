// La migración de dato transaccional (key figures), como en v8: una key figure a la vez.
//
// POST { accion: 'contar', origen, definicion, reintentos }      — cuántas filas hay. Solo lee.
// POST { accion: 'periodos', origen, definicion }                — los periodos con dato. Solo lee.
// POST { accion: 'copiar', origen, destino, definicion, periodo, desde, cuantas, nombre, confirmacion }
//                                                                — UN segmento. **ESTO ESCRIBE EN SAP.**
// POST { accion: 'confirmar', destino, transactionId }           — su estado y sus rechazos. Solo lee.
//
// `origen` y `destino` son `{ connectionId, area, versionId }`. La `definicion` es la de UNA key figure
// —el nivel con el atributo de origen de cada atributo del destino, el nivel de tiempo, la key figure de
// cada lado, las conversiones, los filtros y si se lee solo lo que no es cero—; el `$select`, el
// `$filter` y el `$orderby` se arman AQUÍ con `core/`, que es donde viven las reglas de SAP.
//
// En v8 la pantalla hacía todo esto detrás de un proxy. Aquí la pantalla ORQUESTA y cada llamada es
// una pieza que cabe en una función; las credenciales no salen del servidor.
//
// La confirmación explícita no es decorativa: sin ella, un reintento automático de cualquier capa
// intermedia escribiría en un tenant que puede ser productivo.

import { requireModule } from '../../core/auth/guards.js'
import { getAnyCredentials, getConnectionTarget } from '../../core/connections/index.js'
import { explicarFallo } from '../../core/ibp/explicar-fallo.js'
import {
  FILAS_POR_SEGMENTO_KF,
  confirmarTransaccionDeCifra,
  contarCifra,
  copiarSegmentoDeCifra,
  definicionDeLaCifra,
  esNombreDeCampo,
  esPeriodoIso,
  periodosDeLaCifra,
} from '../../core/ibp/index.js'

const ACUERDOS = ['SAP_COM_0720', 'SAP_COM_0326']

/** Lo que hay que mandar para que la copia se ejecute. */
const CONFIRMACION = 'copiar'

/** El contexto de un tenant, comprobando que la conexión sea de este cliente y de IBP. */
async function tenantDe(clientId, lado, cual) {
  if (!lado?.connectionId) throw new Error(`Falta la conexión de ${cual}.`)
  if (!esNombreDeCampo(lado.area)) throw new Error(`Falta el área de planificación de ${cual}.`)

  const conexion = await getConnectionTarget(clientId, lado.connectionId)
  if (conexion.kind !== 'ibp') throw new Error(`La conexión de ${cual} no es de IBP.`)

  return {
    baseUrl: conexion.baseUrl,
    credentials: await getAnyCredentials(clientId, lado.connectionId, ACUERDOS),
    versionId: lado.versionId ? String(lado.versionId) : '',
    area: lado.area,
    name: conexion.name,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' })

  const session = await requireModule(req, res, 'jobs')
  if (!session) return

  const {
    accion, origen, destino, definicion: entrada, reintentos, periodo, desde, cuantas,
    nombre, confirmacion, transactionId,
  } = req.body ?? {}

  try {
    if (accion === 'confirmar') {
      if (!transactionId || !/^[A-Za-z0-9_-]+$/.test(String(transactionId))) {
        return res.status(400).json({ error: 'Falta la transacción.' })
      }
      const deDestino = await tenantDe(session.clientId, destino, 'destino')
      return res.status(200).json(await confirmarTransaccionDeCifra({
        destino: deDestino, area: deDestino.area, transactionId: String(transactionId),
      }))
    }

    const { definicion, error } = definicionDeLaCifra(entrada)
    if (error) return res.status(400).json({ error })

    const deOrigen = await tenantDe(session.clientId, origen, 'origen')

    if (accion === 'contar') {
      return res.status(200).json({
        total: await contarCifra({
          origen: deOrigen, area: deOrigen.area, definicion, reintentos: Number(reintentos) > 0 ? 1 : 0,
        }),
      })
    }

    if (accion === 'periodos') {
      return res.status(200).json({ periodos: await periodosDeLaCifra({ origen: deOrigen, area: deOrigen.area, definicion }) })
    }

    if (accion === 'copiar') {
      if (confirmacion !== CONFIRMACION) {
        return res.status(400).json({ error: 'Falta la confirmación de que se quiere escribir en el tenant de destino.' })
      }
      if (periodo && !esPeriodoIso(periodo)) return res.status(400).json({ error: 'El periodo no es válido.' })

      const deDestino = await tenantDe(session.clientId, destino, 'destino')
      const inicio = Math.max(Number(desde) || 0, 0)
      const segmento = await copiarSegmentoDeCifra({
        origen: deOrigen,
        destino: deDestino,
        areaOrigen: deOrigen.area,
        areaDestino: deDestino.area,
        definicion,
        periodo: periodo || null,
        desde: inicio,
        // Nunca más de un segmento por llamada: es lo que cabe en el tiempo de una función.
        cuantas: Math.min(Math.max(Number(cuantas) || FILAS_POR_SEGMENTO_KF, 1), FILAS_POR_SEGMENTO_KF),
        nombre: String(nombre || 'IBP-ControlTower-KF').slice(0, 40),
      })

      // Queda registrado quién escribió cifras en qué tenant.
      console.log(`[ibp/kf-migration] ${session.userId ?? session.clientId}`
        + ` · ${definicion.cifra.origen} → ${definicion.cifra.destino}`
        + ` · ${deOrigen.area} → ${deDestino.area}${periodo ? ` · ${periodo}` : ''}`
        + ` · ${segmento.leidas} leídas desde ${inicio} · ${segmento.ok ? `${segmento.escritas} escritas` : `fallo: ${segmento.error}`}`)

      return res.status(200).json(segmento)
    }

    return res.status(400).json({ error: `Acción desconocida: "${accion}".` })
  } catch (error) {
    console.error(`[ibp/kf-migration] ${error.stack || error.message}`)
    const mensaje = explicarFallo(error, ACUERDOS)
    const detalle = String(error?.detail ?? '')
    return res.status(400).json({
      error: detalle && !mensaje.includes(detalle) ? `${mensaje}: ${detalle}` : mensaje,
      detalle,
    })
  }
}
