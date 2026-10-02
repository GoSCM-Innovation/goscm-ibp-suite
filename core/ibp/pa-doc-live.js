// Los datos en vivo que enriquecen el documento de un área: volumetría y Application Jobs.
//
// Portado de `fetchMdtCounts` y `fetchAppJobs` de `paDoc.js` de v7 (sección 8, «ENRIQUECIMIENTO EN VIVO»).
// En v7 las llamadas salían del navegador con las credenciales en la mano; aquí salen del servidor, por
// `sapFetch` —portero de SSRF, lista de servicios permitidos, sin redirecciones—, y las credenciales
// no llegan nunca al navegador.
//
// Son dos fuentes INDEPENDIENTES, cada una de un acuerdo de comunicación distinto:
//
//   - La volumetría cuenta registros por tipo de dato maestro en `MASTER_DATA_API_SRV`
//     (`SAP_COM_0720`).
//   - Los Application Jobs salen de `BC_EXT_APPJOB_MANAGEMENT` (`SAP_COM_0326`).
//
// Si solo hay uno de los dos acuerdos activo, el otro falla aislado y el documento se genera con lo
// disponible: por eso son dos operaciones y no una.

import { sapFetch } from '../transport/sap-fetch.js'
import { appJobRoot, entitySetNames, readAllPages } from './app-jobs.js'
import { masterDataRoot } from './master-data.js'
import { getLike } from './pa-doc-model.js'

/** El texto que marca un paso de integración de CI-DS en el tipo de paso (`JCE_DATA_INT` de v7). */
export const TIPO_CI_DS = 'DATA INTEGRATION'

/** Cuántos conteos van a la vez. El manual de IBP recomienda unos 6 en paralelo. */
export const CONTEOS_EN_PARALELO = 6

/** El `$metadata` de dato maestro pesa unos 4,8 MB y tarda: se le da lo mismo que a su catálogo. */
const ESPERA_DEL_METADATA_MS = 110_000

/** Lo más que se sigue paginando una entidad de Application Jobs (el tope de páginas de v7 era 500). */
const MAX_PAGINAS = 100

/** El tamaño de página que pedía v7. SAP lo recorta si quiere y manda el enlace a la siguiente. */
const TAMANO_DE_PAGINA = 50000

// ── Volumetría ───────────────────────────────────────────────────────────────────────────────────

/**
 * Los conjuntos de entidades que expone el servicio de dato maestro.
 *
 * v7 los sacaba del `$metadata` (4,8 MB). El documento del servicio los lista igual y pesa unos
 * kilobytes, así que se lee ese y solo se cae al `$metadata` si no trajo ninguno. El resultado es el
 * mismo: los nombres de entidad.
 */
export async function conjuntosDeDatoMaestro({ baseUrl, credentials }) {
  try {
    const { json } = await sapFetch({
      url: `${masterDataRoot(baseUrl)}/?$format=json`,
      credentials,
      kind: 'ibp',
    })
    const conjuntos = json?.d?.EntitySets ?? []
    if (conjuntos.length > 0) return conjuntos
  } catch (error) {
    // Un permiso que falta lo dirá igual la lectura de abajo, con el mismo código: no se esconde.
    if (error?.status === 401 || error?.status === 403) throw error
  }

  const { text } = await sapFetch({
    url: `${masterDataRoot(baseUrl)}/$metadata`,
    credentials,
    kind: 'ibp',
    expect: 'xml',
    timeoutMs: ESPERA_DEL_METADATA_MS,
  })
  return entitySetNames(text)
}

/**
 * Qué entidad corresponde a cada tipo de dato maestro: `{ ID: 'Entidad' | null }`.
 *
 * En IBP la entidad base de un tipo se llama igual que su identificador técnico (comprobado en un
 * tenant real, según v7), así que se cruza por nombre EXACTO sin distinguir mayúsculas. Un tipo sin
 * entidad —los virtuales, por ejemplo— queda en `null`.
 */
export function resolverEntidades(ids, conjuntos) {
  const porMayuscula = {}
  for (const nombre of conjuntos ?? []) {
    if (nombre) porMayuscula[String(nombre).toUpperCase()] = nombre
  }
  return Object.fromEntries((ids ?? []).map((id) => [id, porMayuscula[String(id).toUpperCase()] || null]))
}

/**
 * Cuántos registros tiene una entidad, sin traerlos: `$top=1&$inlinecount=allpages` y se lee
 * `d.__count`. `null` si SAP no contestó un número o si la lectura falló.
 */
export async function contarEntidad({ baseUrl, credentials, entidad }) {
  try {
    const { json } = await sapFetch({
      url: `${masterDataRoot(baseUrl)}/${entidad}?$format=json&$top=1&$inlinecount=allpages`,
      credentials,
      kind: 'ibp',
    })
    const cuenta = Number.parseInt(json?.d?.__count, 10)
    return Number.isNaN(cuenta) ? null : cuenta
  } catch {
    // Un tipo que no se puede contar no tumba a los demás: queda con guion en el documento.
    return null
  }
}

/**
 * La volumetría de varios tipos, con un grupo de lectores a la vez.
 *
 * Devuelve `{ ID: número | null }`. Los lectores sacan trabajo de una cola común, como el pool de v7.
 */
export async function contarTipos({
  baseUrl, credentials, ids, conjuntos, concurrencia = CONTEOS_EN_PARALELO,
}) {
  const entidades = resolverEntidades(ids, conjuntos ?? await conjuntosDeDatoMaestro({ baseUrl, credentials }))
  const cuentas = {}
  const cola = Object.entries(entidades)

  async function lector() {
    while (cola.length > 0) {
      const [id, entidad] = cola.shift()
      cuentas[id] = entidad ? await contarEntidad({ baseUrl, credentials, entidad }) : null
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrencia, cola.length) }, lector))
  return cuentas
}

// ── Application Jobs ─────────────────────────────────────────────────────────────────────────────

/** Elige la entidad entre las que declara el servicio, con el criterio de v7 (`pick`). */
function elegir(conjuntos, expresiones, porOmision) {
  for (const expresion of expresiones) {
    const encontrada = conjuntos.find((nombre) => expresion.test(nombre))
    if (encontrada) return encontrada
  }
  return porOmision
}

/** La entidad de plantillas y la de pasos, como las elegía v7 sin adivinar nombres. */
export function entidadesDeJobs(conjuntos) {
  return {
    plantillas: elegir(conjuntos, [/^JobTemplateSet$/i, /JobTemplate(Set)?$/i], 'JobTemplateSet'),
    pasos: elegir(conjuntos, [/^JobTemplateSequenceSet$/i, /Sequence/i], 'JobTemplateSequenceSet'),
  }
}

/**
 * Agrupa los pasos por plantilla y arma la lista final. Es el final de `fetchAppJobs` de v7.
 *
 * Sin plantillas se arma desde los pasos. La lista sale sin repetidos y ordenada por nombre; los
 * pasos, por posición. Un paso es de CI-DS si su tipo (`JceText`) contiene «DATA INTEGRATION».
 *
 * Devuelve `[{ name, text, steps: [{ pos, name, type, cids }] }]`.
 */
export function armarAppJobs(plantillas, pasos) {
  const nombreDe = (plantilla) => getLike(plantilla, 'JobTemplateName')
    || getLike(plantilla, 'TemplateName') || getLike(plantilla, 'Name')

  const textoPorNombre = {}
  for (const plantilla of plantillas) {
    const nombre = nombreDe(plantilla)
    if (nombre) textoPorNombre[nombre] = getLike(plantilla, 'JobTemplateText') || getLike(plantilla, 'Text') || nombre
  }

  const porJob = {}
  for (const paso of pasos) {
    const job = getLike(paso, 'JobTemplateName')
    if (!job) continue
    const tipo = getLike(paso, 'JceText') || ''
    ;(porJob[job] || (porJob[job] = [])).push({
      pos: Number.parseInt(getLike(paso, 'JobSequencePosition'), 10) || 0,
      name: getLike(paso, 'JobSequenceText') || getLike(paso, 'JobSequenceName') || '',
      type: tipo,
      cids: tipo.toUpperCase().indexOf(TIPO_CI_DS) >= 0,
    })
  }

  let nombres = plantillas.length > 0 ? plantillas.map(nombreDe) : Object.keys(porJob)
  const vistos = {}
  nombres = nombres.filter((nombre) => nombre && !vistos[nombre] && (vistos[nombre] = true))
  nombres.sort()

  return nombres.map((name) => ({
    name,
    text: textoPorNombre[name] || name,
    steps: (porJob[name] || []).slice().sort((a, c) => a.pos - c.pos),
  }))
}

/** Lee una entidad entera; si no existe (404) se trata como vacía, como hacía `fetchAllPages` de v7. */
async function leerEntidad({ baseUrl, credentials, entidad }) {
  try {
    return await readAllPages({
      baseUrl,
      credentials,
      entity: entidad,
      query: `$top=${TAMANO_DE_PAGINA}`,
      maxPages: MAX_PAGINAS,
    })
  } catch (error) {
    if (error?.status === 404) return []
    throw error
  }
}

/**
 * Los Application Jobs del tenant con sus pasos, vía `SAP_COM_0326`.
 *
 * Sin filtrar: v7 documenta TODAS las plantillas, también las estándar `/IBP/`. Devuelve además qué
 * entidades usó, porque la pantalla las nombra en su registro.
 */
export async function leerAppJobs({ baseUrl, credentials }) {
  const { text } = await sapFetch({
    url: `${appJobRoot(baseUrl)}/$metadata`,
    credentials,
    kind: 'ibp',
    expect: 'xml',
  })

  const entidades = entidadesDeJobs(entitySetNames(text))
  const plantillas = await leerEntidad({ baseUrl, credentials, entidad: entidades.plantillas })
  const pasos = await leerEntidad({ baseUrl, credentials, entidad: entidades.pasos })

  return { entidades, jobs: armarAppJobs(plantillas, pasos) }
}
