// Las cifras clave de un tenant, de solo lectura.
//
// GET ?connectionId=…&accion=catalogo[&area=…]                        — áreas, dimensiones, cifras y versiones.
// GET ?connectionId=…&accion=conversiones&area=…&cifra=…              — qué atributos exige esa cifra.
// GET ?connectionId=…&accion=valores-de-conversion&area=…&atributo=…  — unidades o monedas del tenant.
// GET ?connectionId=…&accion=valores-de-atributo&area=…&campo=…       — los valores reales de un atributo.
// GET ?connectionId=…&accion=cuenta&area=…&<definición>               — cuántas filas devolvería.
// GET ?connectionId=…&accion=filas&area=…&<definición>&skip=…&top=…   — una página.
//
// La <definición> es la del visor «Ver Dato Transaccional» de v8: `atributos` y `cifras` (JSON), el
// campo de `tiempo`, y opcionales `condiciones` (JSON), `desde`/`hasta`, `unidad`, `moneda`,
// `version`, `soloConValor` y `orden` (JSON `{ field, dir }`). El `$select`, el `$filter` y el
// `$orderby` se arman AQUÍ con las funciones de `core/`, no en el navegador: son las que llevan las
// reglas de SAP como código.
//
// El catálogo es caro: el `$metadata` del servicio trae 222 dimensiones y 1.137 cifras, y leerlo
// tarda unos segundos. Se devuelve entero una vez y la pantalla lo guarda un día.

import { requireModule } from '../../core/auth/guards.js'
import { getAnyCredentials, getConnectionTarget } from '../../core/connections/index.js'
import { explicarFallo } from '../../core/ibp/explicar-fallo.js'
import {
  countKf,
  detectConversions,
  esNombreDeCampo,
  filtroDePlanificacion,
  ordenDelVisor,
  readAttrDistinctValues,
  readConversionValues,
  readKfMetadata,
  readKfPage,
  readPlanningAreas,
  readVersions,
  selectDelVisor,
  sinFilasEnCero,
} from '../../core/ibp/index.js'

/** Los acuerdos que habilitan el servicio, en orden de preferencia. */
const ACUERDOS = ['SAP_COM_0720', 'SAP_COM_0326']

/** Tope de filas por respuesta. Pocas páginas grandes: el costo por petición es casi fijo. */
const TOPE_DE_PAGINA = 5000

/** Contar antes de enseñar: un reintento y 60 s, como v8. Leer una página: 90 s. */
const CUENTA = Object.freeze({ reintentos: 1, timeoutMs: 60_000 })
const PAGINA = Object.freeze({ reintentos: 2, timeoutMs: 90_000 })

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

/** Una fecha del `<input type="date">`; cualquier otra cosa no llega al filtro. */
const fecha = (valor) => (/^\d{4}-\d{2}-\d{2}$/.test(String(valor ?? '')) ? valor : '')

/**
 * La definición del visor, leída de la consulta.
 *
 * Los nombres de campo van a la dirección de SAP, así que solo pasan los que son nombres de campo de
 * verdad. Una condición sobre un campo que no lo es se descarta, igual que una a medio escribir.
 */
function definicionDe(query) {
  const lista = (valor) => (Array.isArray(valor) ? valor.filter(esNombreDeCampo) : [])
  const atributos = lista(leerJson(query?.atributos, []))
  const cifras = lista(leerJson(query?.cifras, []))
  const tiempo = esNombreDeCampo(query?.tiempo) ? query.tiempo : ''
  const condiciones = (() => {
    const leidas = leerJson(query?.condiciones, [])
    return Array.isArray(leidas) ? leidas.filter((una) => esNombreDeCampo(una?.field)) : []
  })()
  const orden = leerJson(query?.orden, null)

  return {
    atributos,
    tiempo,
    cifras,
    condiciones,
    desde: fecha(query?.desde),
    hasta: fecha(query?.hasta),
    unidad: query?.unidad ? String(query.unidad) : '',
    moneda: query?.moneda ? String(query.moneda) : '',
    version: query?.version ? String(query.version) : '',
    soloConValor: query?.soloConValor === 'true',
    orden: esNombreDeCampo(orden?.field) ? { field: orden.field, dir: orden.dir === 'desc' ? 'desc' : 'asc' } : null,
  }
}

/**
 * El mensaje de un fallo, con lo que dijo SAP.
 *
 * v8 enseñaba `[400] <detalle de SAP>`. El detalle es lo que importa: es donde SAP nombra la
 * conversión que falta —«Add property UOMTOID to a filter condition»— y es lo que la pantalla busca
 * para decir «Esta key figure requiere una unidad destino».
 */
function mensajeDeFallo(error) {
  const mensaje = explicarFallo(error, ACUERDOS)
  const detalle = String(error?.detail ?? '')
  return detalle && !mensaje.includes(detalle) ? `${mensaje}: ${detalle}` : mensaje
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' })

  // `preparar` también puede lanzar (una conexión que no es de este cliente, un acuerdo sin configurar):
  // eso es un 400 explicado, no un 500 sin controlar.
  let ctx
  try {
    ctx = await preparar(req, res)
  } catch (error) {
    console.error(`[ibp/planning-data] ${error.stack || error.message}`)
    return res.status(400).json({ error: explicarFallo(error, ACUERDOS), detalle: error.detail ?? '' })
  }
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

      // El área ELEGIDA; si no se eligió ninguna —o ya no existe—, la primera, como en v8.
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

    if (accion === 'valores-de-conversion') {
      // Las unidades o monedas del tenant, para los desplegables «Unidad destino» y «Moneda
      // destino». De mejor esfuerzo: sin la tabla, lista vacía y el desplegable no aparece.
      return res.status(200).json({
        valores: await readConversionValues({ ...ctx, area, atributo: req.query?.atributo }),
      })
    }

    if (accion === 'valores-de-atributo') {
      const campo = req.query?.campo
      if (!esNombreDeCampo(campo)) return res.status(400).json({ error: 'Falta el atributo.' })
      return res.status(200).json(await readAttrDistinctValues({ ...ctx, area, campo, tabla: req.query?.tabla }))
    }

    const definicion = definicionDe(req.query)
    if (!definicion.tiempo || definicion.cifras.length === 0) {
      return res.status(400).json({ error: 'Selecciona al menos un key figure y un nivel de tiempo.' })
    }

    const select = selectDelVisor(definicion)
    const filtro = filtroDePlanificacion({
      condiciones: definicion.condiciones,
      campoDeTiempo: definicion.tiempo,
      desde: definicion.desde,
      hasta: definicion.hasta,
      conversiones: { UOMTOID: definicion.unidad, CURRTOID: definicion.moneda },
      version: definicion.version,
      // «Ocultar filas en cero»: la fila entra si ALGUNA key figure elegida es distinta de cero. Con
      // `gt 0 or lt 0`, nunca `ne 0`, que SAP ignora en silencio.
      cifras: definicion.cifras,
      soloConValor: definicion.soloConValor,
    })

    if (accion === 'cuenta') {
      return res.status(200).json({ total: await countKf({ ...ctx, area, select, filtro, ...CUENTA }) })
    }

    if (accion === 'filas') {
      // El orden se toma solo si es una columna de lo que se lee; si no, SAP lo rechazaría.
      const orden = definicion.orden && select.includes(definicion.orden.field) ? definicion.orden : null
      const top = Math.min(Math.max(Number(req.query?.top) || 500, 1), TOPE_DE_PAGINA)

      const filas = await readKfPage({
        ...ctx,
        area,
        select,
        filtro,
        orderby: ordenDelVisor(orden, [...definicion.atributos, definicion.tiempo]),
        skip: Math.max(Number(req.query?.skip) || 0, 0),
        top,
        ...PAGINA,
      })

      // Los ceros se descartan también aquí: el filtro de SAP es la primera barrera, no la única. Se
      // devuelve cuántas filas llegaron de SAP (`leidas`), porque es con eso —y no con las que
      // quedaron— con lo que quien pagina sabe si ya no hay más.
      const limpias = definicion.soloConValor ? sinFilasEnCero(filas, definicion.cifras) : filas
      return res.status(200).json({ filas: limpias, leidas: filas.length })
    }

    return res.status(400).json({ error: `Acción desconocida: "${accion}".` })
  } catch (error) {
    console.error(`[ibp/planning-data] ${error.stack || error.message}`)
    return res.status(400).json({ error: mensajeDeFallo(error), detalle: error.detail ?? '' })
  }
}
