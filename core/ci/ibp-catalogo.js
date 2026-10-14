// Lo que CI Tools le pregunta al SAP IBP de destino para ayudar a armar un body: áreas, versiones, tablas, campos,
// cifras clave y valores. Todo de SOLO LECTURA y por el mismo camino que IBP Tools (`core/ibp`), sin una segunda
// implementación: lo que se lee aquí es lo que el visor de dato maestro y el de cifras ya leen.
//
// A qué IBP se pregunta lo dice la conexión de Cloud Integration (`ibp_connection_id`, ver la migración 007). Sus
// credenciales se descifran aquí, en el servidor, y no salen: al navegador solo llega el catálogo.
//
// Lo que se devuelve se guarda 30 minutos en Redis, por cliente y por IBP. Son lecturas caras (el `$metadata` de
// dato maestro pesa varios megas) y cambian poco; «Actualizar» las vuelve a pedir. Los valores de un campo NO se
// guardan: son datos del cliente y se piden al momento.
//
// Si IBP no contesta, el formulario de CI Tools sigue funcionando sin sugerencias: nada de aquí es obligatorio.

import { getRedis, tenantKey } from '../persistence/redis.js'
import { getAnyCredentials, getConnectionTarget } from '../connections/connections.js'
import { sapFetch } from '../transport/sap-fetch.js'
import { readAttrDistinctValues } from '../ibp/attr-values.js'
import { prefijoDelTenant } from '../ibp/explorer-entities.js'
import { catalogoDesdeVsmt } from '../ibp/master-data-model.js'
import { masterDataRoot, readDistinctValues, readImportableMdts, readVsmt } from '../ibp/master-data.js'
import { esNombreSeguro } from '../ibp/nombre-seguro.js'
import { readKfMetadata, readPlanningAreas, readVersions } from '../ibp/planning-data.js'
import { assertConexionCi } from './integrations.js'
import { parseCamposDeEntidad } from './ibp-campos.js'
import { ID_DE_VERSION_BASE_EN_IBP, NOMBRE_DE_VERSION_BASE, VERSION_BASE, esCampoDeTiempo } from './ibp-nombres.js'

/** Los acuerdos que habilitan los servicios de datos, en orden de preferencia: el mismo criterio que IBP Tools. */
export const ACUERDOS_IBP = Object.freeze(['SAP_COM_0720', 'SAP_COM_0326'])

/** Cuánto se guarda lo leído. */
export const SEGUNDOS_DE_CACHE = 30 * 60

/** El `$metadata` de dato maestro pesa varios megas y tarda: IBP Tools le da 110 s. */
const ESPERA_DEL_METADATA_MS = 110_000

/** Tope de valores distintos de un campo. */
export const TOPE_DE_VALORES = 5000

/** Las lecturas reales. Se inyectan en las pruebas. */
export const LECTURAS = Object.freeze({
  readPlanningAreas,
  readVersions,
  readVsmt,
  readImportableMdts,
  readKfMetadata,
  readDistinctValues,
  readAttrDistinctValues,
  async leerMetadataDeMaestro({ baseUrl, credentials }) {
    const { text } = await sapFetch({
      url: `${masterDataRoot(baseUrl)}/$metadata`,
      credentials,
      kind: 'ibp',
      expect: 'xml',
      timeoutMs: ESPERA_DEL_METADATA_MS,
    })
    return text
  },
})

/** El motivo de un fallo de lectura, con lo que dijo SAP, para el aviso. */
const motivoDe = (razon) => {
  const mensaje = String(razon?.message ?? razon ?? 'No se pudo leer.')
  const detalle = String(razon?.detail ?? '')
  return detalle && !mensaje.includes(detalle) ? `${mensaje}: ${detalle}` : mensaje
}

/**
 * Resuelve contra qué IBP se pregunta: el de la conexión de Cloud Integration, con sus credenciales.
 * Revienta con un mensaje que se pueda mostrar si la conexión no tiene IBP de destino.
 */
export async function contextoIbp(clientId, connectionId) {
  const conexion = await assertConexionCi(clientId, connectionId)

  if (!conexion.ibpConnectionId) {
    throw Object.assign(
      new Error(
        `«${conexion.name}» no tiene un IBP de destino. Elígelo en Administración → Conexiones para que CI Tools `
        + 'sugiera áreas, versiones y campos.',
      ),
      { statusCode: 409, codigo: 'sin-vinculo' },
    )
  }

  // La búsqueda lleva el cliente: un IBP de otro cliente «no existe».
  const ibp = await getConnectionTarget(clientId, conexion.ibpConnectionId)
  if (ibp.kind !== 'ibp') throw new Error(`«${ibp.name}» ya no es una conexión de SAP IBP.`)

  return {
    ibp: { id: ibp.id, nombre: ibp.name },
    ctx: { baseUrl: ibp.baseUrl, credentials: await getAnyCredentials(clientId, ibp.id, ACUERDOS_IBP) },
  }
}

/**
 * El resumen del IBP: sus áreas, las versiones de cada una y las tablas de dato maestro que se pueden cargar en
 * cada versión, con el prefijo que usa el área.
 *
 * Es puro: recibe lo leído y lo arma. Las versiones salen del servicio de cifras clave (con sus nombres) y se
 * completan con las del catálogo de dato maestro; la base va siempre primera y con el valor que lleva en el body,
 * vacío. Las tablas son las del catálogo de dato maestro, y solo las IMPORTABLES si se pudo saber cuáles son:
 * ofrecer una que no se puede cargar es prometer algo que falla al final.
 */
export function construirResumen({ areasDeCifras = [], versionesDeCifras = {}, vsmt = [], importables = [] }) {
  const catalogo = catalogoDesdeVsmt(vsmt)
  const cargables = new Set(importables.map((uno) => String(uno).toUpperCase()))
  const filtrar = (tipos) => (cargables.size > 0 ? tipos.filter((uno) => cargables.has(String(uno).toUpperCase())) : tipos)

  const ids = [...new Set([...areasDeCifras, ...Object.keys(catalogo)])].sort((a, b) => a.localeCompare(b))

  return ids.map((id) => {
    const deMaestro = catalogo[id]
    const deMaestroPorVersion = deMaestro?.versions ?? []
    const todosLosTipos = [...new Set(deMaestroPorVersion.flatMap((version) => version.mdts))].sort()

    // La base primero; después las del servicio de cifras (con nombre) y, al final, las que solo conoce el
    // catálogo de dato maestro.
    const versiones = [{ id: VERSION_BASE, nombre: NOMBRE_DE_VERSION_BASE }]
    for (const version of versionesDeCifras[id] ?? []) {
      if (version.id === ID_DE_VERSION_BASE_EN_IBP || versiones.some((una) => una.id === version.id)) continue
      versiones.push({ id: version.id, nombre: version.name || version.id })
    }
    for (const version of deMaestroPorVersion) {
      if (!versiones.some((una) => una.id === version.id)) versiones.push({ id: version.id, nombre: version.name || version.id })
    }

    // Las tablas de cada versión. Una versión que el catálogo de dato maestro no conoce (una versión sin dato
    // maestro propio) usa las tablas de todas, igual que la base.
    const tipos = { [VERSION_BASE]: filtrar(todosLosTipos) }
    for (const version of versiones) {
      if (version.id === VERSION_BASE) continue
      const suya = deMaestroPorVersion.find((una) => una.id === version.id)
      tipos[version.id] = filtrar(suya ? [...suya.mdts].sort() : todosLosTipos)
    }

    return {
      id,
      descripcion: deMaestro?.desc && deMaestro.desc !== id ? deMaestro.desc : '',
      deCifras: areasDeCifras.includes(id),
      prefijo: prefijoDelTenant(todosLosTipos),
      versiones,
      tipos,
    }
  })
}

/**
 * Lee el resumen del IBP. Tolera que una de las tres lecturas falle (cada servicio se habilita por separado en el
 * acuerdo): con lo que conteste se arma lo posible y los fallos van en `avisos`. Solo se falla si NO contesta ni el
 * servicio de dato maestro ni el de cifras.
 */
export async function leerResumen(ctx, { lecturas = LECTURAS } = {}) {
  const [areas, vsmt, importables] = await Promise.allSettled([
    lecturas.readPlanningAreas(ctx),
    lecturas.readVsmt(ctx),
    lecturas.readImportableMdts(ctx),
  ])

  if (areas.status === 'rejected' && vsmt.status === 'rejected') throw vsmt.reason

  const avisos = []
  if (areas.status === 'rejected') avisos.push(`No se pudieron leer las áreas del servicio de cifras clave: ${motivoDe(areas.reason)}`)
  if (vsmt.status === 'rejected') avisos.push(`No se pudo leer el catálogo de dato maestro: ${motivoDe(vsmt.reason)}`)

  const areasDeCifras = areas.status === 'fulfilled' ? areas.value : []

  // Las versiones salen de cada área. Una que falla no tumba el resto: se usan las del catálogo de dato maestro.
  const versionesDeCifras = {}
  await Promise.all(areasDeCifras.map(async (area) => {
    try {
      versionesDeCifras[area] = await lecturas.readVersions({ ...ctx, area })
    } catch {
      versionesDeCifras[area] = []
    }
  }))

  return {
    areas: construirResumen({
      areasDeCifras,
      versionesDeCifras,
      vsmt: vsmt.status === 'fulfilled' ? vsmt.value : [],
      importables: importables.status === 'fulfilled' ? importables.value : [],
    }),
    avisos,
  }
}

/** Los campos de una tabla de dato maestro, con su etiqueta. Revienta si IBP no la declara. */
export async function leerCamposDeMaestro(ctx, entidad, { lecturas = LECTURAS } = {}) {
  if (!esNombreSeguro(entidad)) throw new Error('El nombre de la tabla no es válido.')
  const xml = await lecturas.leerMetadataDeMaestro(ctx)
  const campos = parseCamposDeEntidad(xml, entidad)
  if (!campos) throw new Error(`La tabla «${entidad}» no existe en este IBP.`)
  return { entidad, campos }
}

/** Las dimensiones, las cifras clave y los campos de periodo de un área de planificación, con su etiqueta. */
export async function leerCifrasDeArea(ctx, area, { lecturas = LECTURAS } = {}) {
  if (!esNombreSeguro(area)) throw new Error('El nombre del área no es válido.')
  const { dims, cifras, etiquetas } = await lecturas.readKfMetadata({ ...ctx, area })
  const conEtiqueta = (campo) => ({ campo, etiqueta: etiquetas[campo] && etiquetas[campo] !== campo ? etiquetas[campo] : '' })

  return {
    area,
    dims: dims.filter((campo) => !esCampoDeTiempo(campo)).map(conEtiqueta),
    cifras: cifras.map(conEtiqueta),
    niveles: dims.filter(esCampoDeTiempo),
  }
}

/**
 * Los valores distintos de un campo, para sugerirlos en el filtro.
 *
 * Con `entidad` se leen de esa tabla de dato maestro; sin ella, de la tabla del área que tenga el campo (es lo que
 * hace IBP Tools para filtrar cifras). Un campo que no es de IBP —los del filtro suelen ser del origen— devuelve
 * una lista vacía y un motivo: no es un error, el valor se escribe a mano.
 */
export async function leerValores(ctx, { area, entidad, campo }, { lecturas = LECTURAS } = {}) {
  if (!esNombreSeguro(campo)) throw new Error('El nombre del campo no es válido.')
  if (entidad && !esNombreSeguro(entidad)) throw new Error('El nombre de la tabla no es válido.')
  if (area && !esNombreSeguro(area)) throw new Error('El nombre del área no es válido.')
  if (!entidad && !area) throw new Error('Falta la tabla o el área.')

  try {
    const { tabla, valores } = entidad
      ? { tabla: entidad, valores: await lecturas.readDistinctValues({ ...ctx, entidad, campo, top: TOPE_DE_VALORES }) }
      : await lecturas.readAttrDistinctValues({ ...ctx, area, campo })

    return {
      tabla,
      valores,
      truncado: valores.length >= TOPE_DE_VALORES,
      ...(valores.length === 0 ? { motivo: 'IBP no tiene valores para ese campo.' } : {}),
    }
  } catch (error) {
    // Cuando la tabla no tiene el campo, SAP contesta 404 («Resource not found for the segment 'CAMPO'», visto en un
    // tenant real) o 400. Un 404 solo cuenta si su detalle nombra el campo: otro 404 puede ser que la tabla no existe.
    const dice = String(error?.detail ?? '')
    if (error?.status === 400 || (error?.status === 404 && dice.toUpperCase().includes(campo.toUpperCase()))) {
      return { tabla: entidad ?? null, valores: [], truncado: false, motivo: 'Ese campo no existe en IBP: el valor se escribe a mano.' }
    }
    throw error
  }
}

/**
 * Guarda lo leído. Si Redis falla, se lee igual y no se guarda: el catálogo es una comodidad, no puede depender de
 * que el caché esté arriba.
 */
export async function conCache(clientId, partes, hacer, { actualizar = false, segundos = SEGUNDOS_DE_CACHE } = {}) {
  const clave = tenantKey(clientId, 'ci-ibp', ...partes)

  if (!actualizar) {
    try {
      const guardado = await getRedis().get(clave)
      if (guardado) return guardado
    } catch {
      // Sin caché se lee de IBP.
    }
  }

  const valor = await hacer()
  try {
    await getRedis().set(clave, valor, { ex: segundos })
  } catch {
    // No se guardó: la próxima vez se lee otra vez.
  }
  return valor
}

/**
 * Atiende una petición del formulario: `resumen`, `campos-maestro`, `cifras` o `valores`.
 * Devuelve siempre el nombre del IBP consultado, para que la pantalla diga contra cuál se sugiere.
 */
export async function leerCatalogo({ clientId, connectionId, accion, area, entidad, campo, actualizar = false }, { lecturas = LECTURAS } = {}) {
  const { ibp, ctx } = await contextoIbp(clientId, connectionId)
  const opciones = { actualizar }

  switch (accion) {
    case 'resumen':
      return { ibp, ...(await conCache(clientId, [ibp.id, 'resumen'], () => leerResumen(ctx, { lecturas }), opciones)) }

    case 'campos-maestro':
      if (!esNombreSeguro(entidad)) throw new Error('El nombre de la tabla no es válido.')
      return { ibp, ...(await conCache(clientId, [ibp.id, 'campos', entidad], () => leerCamposDeMaestro(ctx, entidad, { lecturas }), opciones)) }

    case 'cifras':
      if (!esNombreSeguro(area)) throw new Error('El nombre del área no es válido.')
      return { ibp, ...(await conCache(clientId, [ibp.id, 'cifras', area], () => leerCifrasDeArea(ctx, area, { lecturas }), opciones)) }

    case 'valores':
      return { ibp, ...(await leerValores(ctx, { area, entidad, campo }, { lecturas })) }

    default:
      throw new Error(`Acción desconocida: «${accion}».`)
  }
}
