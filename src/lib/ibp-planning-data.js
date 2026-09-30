// Lo que la interfaz le pregunta a IBP sobre sus cifras clave.
//
// El navegador no sabe la dirección del tenant ni sus credenciales: solo dice a qué conexión.

import { api } from './api.js'

/** Áreas, dimensiones, cifras clave, etiquetas y versiones. Es una lectura cara: se pide una vez. */
export function fetchPlanningCatalog(connectionId, area) {
  return api.get('/api/ibp/planning-data', { connectionId, accion: 'catalogo', ...(area ? { area } : {}) })
}

/** Qué atributos de conversión exige una cifra: sin ellos SAP no deja leerla. */
export async function fetchConversions(connectionId, { area, cifra }) {
  const { conversiones } = await api.get('/api/ibp/planning-data', {
    connectionId, accion: 'conversiones', area, cifra,
  })
  return conversiones
}

// ── La memoria de 24 h del visor, como en v8 ─────────────────────────────────────────────────────
//
// v8 guardaba en este navegador, por conexión, la lista de áreas y el catálogo de CADA área durante
// 24 h (`fetchKfAreas` / `fetchKfCatalog`), las unidades y monedas de cada área, y la tabla de dato
// maestro donde vive cada atributo del filtro. Abrir una pestaña nueva no volvía a leer el
// `$metadata`, y «↺ Actualizar» borraba el catálogo para leerlo de nuevo tras cambiar algo en IBP.
//
// Solo se guarda lo que vino CON contenido: una lista vacía —un tropiezo pasajero— no debe quedar
// recordada un día entero dejando el desplegable vacío sin forma de salir.

const UN_DIA_MS = 24 * 60 * 60 * 1000
const CLAVE_AREAS = (id) => `ibp:kfareas:${id}`
const CLAVE_CATALOGO = (id, area) => `ibp:kfcatalog:${id}:${area}`
const CLAVE_CONVERSION = (id, area, atributo) => `ibp:viewer:conv:${id}:${area}:${atributo === 'CURRTOID' ? 'CURR' : 'UOM'}`
const CLAVE_TABLA_DEL_ATRIBUTO = (id, area, campo) => `ibp:attrmdt:${id}:${area || ''}:${campo}`

function leerGuardado(clave) {
  try {
    const guardado = JSON.parse(localStorage.getItem(clave))
    return guardado && Date.now() - guardado.ts < UN_DIA_MS ? guardado.data : null
  } catch {
    return null
  }
}

function guardar(clave, data) {
  try { localStorage.setItem(clave, JSON.stringify({ ts: Date.now(), data })) } catch { /* sin espacio */ }
}

/**
 * El catálogo de un área, de la memoria si tiene menos de un día.
 *
 * Sin área, la primera de las que ve este usuario, igual que en v8: un tenant de un área funciona sin
 * elegir nada.
 */
export async function fetchPlanningCatalogCached(connectionId, area) {
  const areas = leerGuardado(CLAVE_AREAS(connectionId))
  const cual = area && (!areas || areas.includes(area)) ? area : (areas?.[0] ?? '')
  if (cual) {
    const guardado = leerGuardado(CLAVE_CATALOGO(connectionId, cual))
    if (guardado) return guardado
  }

  const leido = await fetchPlanningCatalog(connectionId, area)
  if (leido?.areas?.length) guardar(CLAVE_AREAS(connectionId), leido.areas)
  if (leido?.area && (leido.dims?.length || leido.cifras?.length)) guardar(CLAVE_CATALOGO(connectionId, leido.area), leido)
  return leido
}

/** «↺ Actualizar»: olvidar las áreas y los catálogos guardados de esta conexión. */
export function invalidatePlanningCaches(connectionId) {
  try {
    const prefijo = `ibp:kfcatalog:${connectionId}:`
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const clave = localStorage.key(i)
      if (clave === CLAVE_AREAS(connectionId) || clave?.startsWith(prefijo)) localStorage.removeItem(clave)
    }
  } catch { /* nada guardado */ }
}

/**
 * Las unidades (`UOMTOID`) o las monedas (`CURRTOID`) del área: `[{ id, descripcion }]`.
 *
 * De mejor esfuerzo, como en v8: si no se pueden leer, lista vacía y el desplegable no aparece.
 */
export async function fetchConversionValuesCached(connectionId, area, atributo) {
  const clave = CLAVE_CONVERSION(connectionId, area, atributo)
  const guardado = leerGuardado(clave)
  if (guardado) return guardado
  const { valores } = await api.get('/api/ibp/planning-data', {
    connectionId, accion: 'valores-de-conversion', area, atributo,
  })
  if (valores?.length) guardar(clave, valores)
  return valores ?? []
}

/**
 * Los valores reales de un atributo del área, para el desplegable del filtro.
 *
 * El servidor tiene que encontrar la tabla de dato maestro que tiene ese atributo, probando las del
 * área; la que encuentra se recuerda aquí un día para no volver a probar.
 */
export async function fetchAttrValues(connectionId, { area, campo }) {
  const clave = CLAVE_TABLA_DEL_ATRIBUTO(connectionId, area, campo)
  const tabla = leerGuardado(clave)
  const leido = await api.get('/api/ibp/planning-data', {
    connectionId, accion: 'valores-de-atributo', area, campo, ...(tabla ? { tabla } : {}),
  })
  if (leido?.tabla && leido.tabla !== tabla) guardar(clave, leido.tabla)
  return leido?.valores ?? []
}

// ── La consulta del visor ────────────────────────────────────────────────────────────────────────

/**
 * La definición de una consulta del visor, tal como viaja por la red.
 *
 * Es la definición, no el `$filter`: el filtro lo arma el servidor con `core/`, que es donde viven
 * las reglas de SAP.
 */
const comoDefinicion = ({
  area, version, atributos, tiempo, cifras, condiciones, desde, hasta, unidad, moneda, soloConValor,
}) => ({
  area,
  atributos: JSON.stringify(atributos ?? []),
  tiempo: tiempo ?? '',
  cifras: JSON.stringify(cifras ?? []),
  ...(condiciones?.length ? { condiciones: JSON.stringify(condiciones) } : {}),
  ...(desde ? { desde } : {}),
  ...(hasta ? { hasta } : {}),
  ...(unidad ? { unidad } : {}),
  ...(moneda ? { moneda } : {}),
  ...(version ? { version } : {}),
  ...(soloConValor ? { soloConValor: 'true' } : {}),
})

/** Cuántas filas devolvería la consulta, sin traerlas. */
export async function fetchKfCount(connectionId, definicion) {
  const { total } = await api.get('/api/ibp/planning-data', {
    connectionId, accion: 'cuenta', ...comoDefinicion(definicion),
  })
  return total
}

/**
 * Una página de filas: `{ filas, leidas }`.
 *
 * `leidas` son las que llegaron de SAP antes de descartar ceros. Es con eso con lo que se sabe si hay
 * más páginas: si se miraran las que quedaron, una página con algún cero descartado parecería la
 * última.
 */
export function fetchKfRows(connectionId, definicion, { skip = 0, top = 500, orden = null, signal } = {}) {
  return api.get('/api/ibp/planning-data', {
    connectionId,
    accion: 'filas',
    skip,
    top,
    ...(orden ? { orden: JSON.stringify(orden) } : {}),
    ...comoDefinicion(definicion),
  }, { signal })
}
