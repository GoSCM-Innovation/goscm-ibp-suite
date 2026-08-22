// El dato maestro de un tenant, de solo lectura.
//
// GET ?connectionId=…&accion=catalogo                       — áreas, versiones, tipos e importables.
// GET ?connectionId=…&accion=esquema&entidad=…              — columnas, claves y cuántas filas hay.
// GET ?connectionId=…&accion=filas&entidad=…&skip=…&top=…   — una página.
// GET ?connectionId=…&accion=valores&entidad=…&campo=…      — los valores distintos de un campo.
//
// Todo en un archivo porque es una sola pantalla y comparten el preámbulo. Vercel cuenta funciones.
//
// Solo lectura a propósito: escribir y borrar dato maestro son operaciones que cambian el tenant y
// van en su propia pantalla, con su confirmación.

import { requireModule } from '../../core/auth/guards.js'
import { getAnyCredentials, getConnectionTarget } from '../../core/connections/index.js'
import { explicarFallo } from '../../core/ibp/explicar-fallo.js'
import {
  catalogoDesdeVsmt,
  countEntity,
  filasPorPagina,
  filtroDeCondiciones,
  readDistinctValues,
  readEntityPage,
  readImportableMdts,
  readSchema,
  readVsmt,
} from '../../core/ibp/index.js'

/**
 * Los acuerdos que habilitan el servicio, en orden de preferencia.
 *
 * El que corresponde es `SAP_COM_0720`; se cae a `SAP_COM_0326` porque hay tenants que emiten un
 * único usuario para todo. Comprobado que la separación es real: un usuario de 0326 de un tenant con
 * los acuerdos separados recibe 403 al leer dato maestro.
 */
const ACUERDOS = ['SAP_COM_0720', 'SAP_COM_0326']

/** Tope de filas por respuesta, pase lo que pase. */
const TOPE_DE_PAGINA = 5000

/** Prepara lo común. Devuelve `null` si ya contestó. */
async function preparar(req, res) {
  // El visor es una pestaña de IBP Tools, como lo era en v8: allí colgaba de la vista del sistema.
  const session = await requireModule(req, res, 'jobs')
  if (!session) return null

  const connectionId = req.query?.connectionId
  if (!connectionId) {
    res.status(400).json({ error: 'Falta la conexión.' })
    return null
  }

  const conexion = await getConnectionTarget(session.clientId, connectionId)
  if (conexion.kind !== 'ibp') {
    res.status(400).json({ error: 'Esa conexión no es de IBP.' })
    return null
  }

  return {
    baseUrl: conexion.baseUrl,
    credentials: await getAnyCredentials(session.clientId, connectionId, ACUERDOS),
  }
}

/** Las condiciones llegan como JSON en la consulta; una mal formada no debe tumbar la petición. */
function condicionesDe(req) {
  if (!req.query?.condiciones) return []
  try {
    const leidas = JSON.parse(req.query.condiciones)
    return Array.isArray(leidas) ? leidas : []
  } catch {
    return []
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' })

  const ctx = await preparar(req, res)
  if (!ctx) return

  const { accion, entidad, campo, planningArea, versionId } = req.query ?? {}
  const contexto = { ...ctx, entidad, planningArea, versionId }

  try {
    switch (accion) {
      case 'catalogo': {
        // Los importables se piden a la vez, pero un fallo suyo no debe dejar sin catálogo: sin la
        // lista, todas las tablas se muestran y solo se pierde la marca de "se puede cargar".
        const [vsmt, importables] = await Promise.all([
          readVsmt(ctx),
          readImportableMdts(ctx).catch(() => []),
        ])
        return res.status(200).json({ catalogo: catalogoDesdeVsmt(vsmt), importables })
      }

      case 'esquema': {
        if (!entidad) return res.status(400).json({ error: 'Falta la tabla.' })
        const esquema = await readSchema({ ...contexto, extraFilter: filtroDeCondiciones(condicionesDe(req)) })
        return res.status(200).json({ ...esquema, filasPorPagina: filasPorPagina(esquema.bytesPorFila) })
      }

      case 'filas': {
        if (!entidad) return res.status(400).json({ error: 'Falta la tabla.' })

        const select = req.query?.select ? String(req.query.select).split(',').filter(Boolean) : undefined
        const orderby = req.query?.orderby ? String(req.query.orderby).split(',').filter(Boolean) : undefined

        const filas = await readEntityPage({
          ...contexto,
          skip: Number(req.query?.skip) || 0,
          top: Math.min(Number(req.query?.top) || 500, TOPE_DE_PAGINA),
          select,
          orderby,
          extraFilter: filtroDeCondiciones(condicionesDe(req)),
        })
        return res.status(200).json({ filas })
      }

      case 'cuenta': {
        if (!entidad) return res.status(400).json({ error: 'Falta la tabla.' })
        const total = await countEntity({ ...contexto, extraFilter: filtroDeCondiciones(condicionesDe(req)) })
        return res.status(200).json({ total })
      }

      case 'valores': {
        if (!entidad || !campo) return res.status(400).json({ error: 'Falta la tabla o el campo.' })
        return res.status(200).json({ valores: await readDistinctValues({ ...contexto, campo }) })
      }

      default:
        return res.status(400).json({ error: `Acción desconocida: "${accion}".` })
    }
  } catch (error) {
    console.error(`[ibp/master-data] ${error.stack || error.message}`)
    return res.status(400).json({ error: explicarFallo(error, ACUERDOS), detalle: error.detail ?? '' })
  }
}
