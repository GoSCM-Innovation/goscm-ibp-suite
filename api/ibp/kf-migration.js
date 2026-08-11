// La migración de cifras clave entre dos tenants.
//
// POST { accion: 'revisar', … }   — qué se copiaría y qué lo impide. Solo lee.
// POST { accion: 'contar', … }    — cuántas filas hay al nivel elegido. Solo lee.
// POST { accion: 'copiar', … }    — copia UN segmento. **ESTO ESCRIBE EN SAP.**
//
// Un segmento por llamada, por lo mismo que en dato maestro: una cifra puede ser un millón de filas y
// no cabe en el tiempo de una función, y el segmento ya es la unidad de la transacción.
//
// La confirmación explícita no es decorativa: sin ella, un reintento automático de cualquier capa
// intermedia escribiría cifras en un tenant que puede ser productivo.

import { requireModule } from '../../core/auth/guards.js'
import { getAnyCredentials, getConnectionTarget } from '../../core/connections/index.js'
import {
  contarLoQueSeCopia,
  filtroDePlanificacion,
  migrarSegmentoDeCifras,
  readKfMetadata,
  revisarMigracionDeCifras,
} from '../../core/ibp/index.js'

const ACUERDOS = ['SAP_COM_0720', 'SAP_COM_0326']

/** Lo que hay que mandar para que la copia se ejecute. */
const CONFIRMACION = 'copiar'

/** Tope de filas por llamada, para no pasarse del tiempo de la función. */
const MAX_POR_SEGMENTO = 20_000

/** El contexto de un tenant, comprobando que la conexión sea de este cliente y de IBP. */
async function tenantDe(clientId, connectionId, cual) {
  if (!connectionId) throw new Error(`Falta la conexión de ${cual}.`)

  const conexion = await getConnectionTarget(clientId, connectionId)
  if (conexion.kind !== 'ibp') throw new Error(`La conexión de ${cual} no es de IBP.`)

  return {
    baseUrl: conexion.baseUrl,
    credentials: await getAnyCredentials(clientId, connectionId, ACUERDOS),
    name: conexion.name,
    isProduction: conexion.isProduction,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' })

  const session = await requireModule(req, res, 'jobs')
  if (!session) return

  const {
    accion, origen = {}, destino = {}, cifras = [], dimensiones = [], condiciones = [],
    desde = 0, cuantas = 5000, confirmacion, nombre,
  } = req.body ?? {}

  try {
    const [deOrigen, deDestino] = await Promise.all([
      tenantDe(session.clientId, origen.connectionId, 'origen'),
      tenantDe(session.clientId, destino.connectionId, 'destino'),
    ])

    if (accion === 'revisar') {
      // Los catálogos de los dos lados: es lo que permite decir "el destino no tiene esa cifra" antes
      // de empezar, en vez de que SAP lo rechace a los diez minutos.
      const [delOrigen, delDestino] = await Promise.all([
        readKfMetadata({ ...deOrigen, area: origen.area }),
        readKfMetadata({ ...deDestino, area: destino.area }),
      ])

      return res.status(200).json({
        revision: revisarMigracionDeCifras({
          origen, destino, cifras, dimensiones,
          cifrasDelDestino: delDestino.cifras,
          dimensionesDelDestino: delDestino.dims,
        }),
        origen: { cifras: delOrigen.cifras, dims: delOrigen.dims, etiquetas: delOrigen.etiquetas },
        destinoEsProductivo: Boolean(deDestino.isProduction),
        nombreDelDestino: deDestino.name,
      })
    }

    const revision = revisarMigracionDeCifras({ origen, destino, cifras, dimensiones })
    if (!revision.sePuede) {
      return res.status(400).json({ error: revision.impedimentos.join(' ') })
    }

    const filtro = filtroDePlanificacion({
      conversiones: origen.conversiones ?? {},
      condiciones,
    })

    if (accion === 'contar') {
      return res.status(200).json({
        plan: await contarLoQueSeCopia({
          origen: { ...deOrigen, versionId: origen.versionId },
          area: origen.area,
          nivel: revision.nivel,
          cifras,
          filtro,
        }),
      })
    }

    if (accion === 'copiar') {
      if (confirmacion !== CONFIRMACION) {
        return res.status(400).json({ error: 'Falta la confirmación de que se quiere escribir en el tenant de destino.' })
      }

      const segmento = await migrarSegmentoDeCifras({
        origen: { ...deOrigen, versionId: origen.versionId },
        destino: { ...deDestino, versionId: destino.versionId },
        area: origen.area,
        areaDestino: destino.area,
        nivel: revision.nivel,
        cifras,
        filtro,
        desde: Number(desde) || 0,
        cuantas: Math.min(Number(cuantas) || 5000, MAX_POR_SEGMENTO),
        nombre: nombre || 'goscm-suite',
      })

      // Queda registrado quién escribió cifras en qué tenant.
      console.log(`[ibp/kf-migration] ${session.userId ?? session.clientId} · ${cifras.join(',')}`
        + ` · ${origen.area} → ${destino.area} · ${segmento.filas} filas desde ${segmento.desde}`
        + ` · ${segmento.ok ? 'ok' : `fallo: ${segmento.error}`}`)

      return res.status(200).json(segmento)
    }

    return res.status(400).json({ error: `Acción desconocida: "${accion}".` })
  } catch (error) {
    console.error(`[ibp/kf-migration] ${error.stack || error.message}`)
    return res.status(400).json({ error: error.message, detalle: error.detail ?? '' })
  }
}
