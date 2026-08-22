// Las cifras clave de un tenant, de solo lectura.
//
// GET ?connectionId=…&accion=catalogo[&area=…]     — áreas, dimensiones, cifras y versiones.
// GET ?connectionId=…&accion=conversiones&cifra=…  — qué atributos exige esa cifra.
// GET ?connectionId=…&accion=cuenta                — cuántas filas devolvería la consulta.
// GET ?connectionId=…&accion=filas&skip=…&top=…    — una página.
//
// El catálogo es caro: el `$metadata` del servicio trae 222 dimensiones y 1.137 cifras, y leerlo
// tarda unos segundos. Se devuelve entero una vez y la pantalla trabaja con eso.

import { requireModule } from '../../core/auth/guards.js'
import { getAnyCredentials, getConnectionTarget } from '../../core/connections/index.js'
import {
  countKf,
  detectConversions,
  filtroDePlanificacion,
  readKfMetadata,
  readKfPage,
  readPlanningAreas,
  readVersions,
  selectDePlanificacion,
  sinCeros,
} from '../../core/ibp/index.js'

/** Los acuerdos que habilitan el servicio, en orden de preferencia. */
const ACUERDOS = ['SAP_COM_0720', 'SAP_COM_0326']

/** Tope de filas por respuesta. Pocas páginas grandes: el costo por petición es casi fijo. */
const TOPE_DE_PAGINA = 5000

async function preparar(req, res) {
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

/** Lo que llega como JSON en la consulta; mal formado se toma como vacío. */
function leerJson(valor, siFalla) {
  if (!valor) return siFalla
  try {
    const leido = JSON.parse(valor)
    return leido ?? siFalla
  } catch {
    return siFalla
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' })

  const ctx = await preparar(req, res)
  if (!ctx) return

  const { accion, area, cifra } = req.query ?? {}

  try {
    if (accion === 'catalogo') {
      const areas = await readPlanningAreas(ctx)
      if (areas.length === 0) {
        return res.status(400).json({
          error: 'Este servicio no expone ningún área de planificación para este usuario. '
            + 'Hay que habilitarla en el acuerdo SAP_COM_0720, que se configura por separado en cada servicio.',
        })
      }

      const elegida = areas.includes(area) ? area : areas[0]
      const [metadatos, versiones] = await Promise.all([
        readKfMetadata({ ...ctx, area: elegida }),
        // Las versiones son una comodidad; sin ellas la pantalla sigue funcionando.
        readVersions({ ...ctx, area: elegida }).catch(() => []),
      ])

      return res.status(200).json({ areas, area: elegida, ...metadatos, versiones })
    }

    if (!area) return res.status(400).json({ error: 'Falta el área de planificación.' })

    if (accion === 'conversiones') {
      if (!cifra) return res.status(400).json({ error: 'Falta la cifra clave.' })
      return res.status(200).json({ conversiones: await detectConversions({ ...ctx, area, cifra }) })
    }

    const dimensiones = leerJson(req.query?.dimensiones, [])
    const condiciones = leerJson(req.query?.condiciones, [])
    const conversiones = leerJson(req.query?.conversiones, {})
    const soloConValor = req.query?.soloConValor === 'true'

    const select = selectDePlanificacion(dimensiones, cifra)
    const filtro = filtroDePlanificacion({ conversiones, condiciones, cifra, soloConValor })

    if (select.length === 0) {
      return res.status(400).json({ error: 'Hay que elegir al menos un atributo o una cifra clave.' })
    }

    if (accion === 'cuenta') {
      return res.status(200).json({ total: await countKf({ ...ctx, area, select, filtro }) })
    }

    if (accion === 'filas') {
      const filas = await readKfPage({
        ...ctx,
        area,
        select,
        filtro,
        orderby: dimensiones,
        skip: Number(req.query?.skip) || 0,
        top: Math.min(Number(req.query?.top) || 500, TOPE_DE_PAGINA),
      })

      // Los ceros se descartan también aquí: el filtro de SAP los deja pasar cuando la cifra no es
      // la única del `$select`, y una tabla de ceros es lo que quien pidió «solo con valor» no
      // quiere ver. Se dice cuántos se quitaron para que el número de filas no parezca un error.
      const limpias = soloConValor && cifra ? sinCeros(filas, cifra) : filas
      return res.status(200).json({ filas: limpias, descartadas: filas.length - limpias.length })
    }

    return res.status(400).json({ error: `Acción desconocida: "${accion}".` })
  } catch (error) {
    console.error(`[ibp/planning-data] ${error.stack || error.message}`)
    return res.status(400).json({ error: error.message, detalle: error.detail ?? '' })
  }
}
