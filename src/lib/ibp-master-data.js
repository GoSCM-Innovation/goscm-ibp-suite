// Lo que la interfaz le pregunta a IBP sobre su dato maestro.
//
// El navegador no sabe la dirección del tenant ni sus credenciales: solo dice a qué conexión.

import { api } from './api.js'

/** Las condiciones viajan como JSON, que es como las lee el servidor. */
const conCondiciones = (condiciones) =>
  (condiciones?.length ? { condiciones: JSON.stringify(condiciones) } : {})

/** Áreas, versiones y tipos del tenant, y cuáles se pueden cargar. */
export function fetchMasterCatalog(connectionId) {
  return api.get('/api/ibp/master-data', { connectionId, accion: 'catalogo' })
}

// ── La memoria de 24 h del visor, como en v8 ─────────────────────────────────────────────────────
//
// v8 guardaba en este navegador, por conexión y durante 24 h, el catálogo de áreas y tablas, las
// etiquetas de los campos y el catálogo de tablas simples. Abrir una pestaña nueva no volvía a
// preguntarle a SAP, y «↺ Actualizar» lo borraba para leer de nuevo tras cambiar algo en IBP.
//
// Solo se guarda lo que vino CON contenido: un catálogo vacío —un tropiezo pasajero— no debe quedar
// recordado un día entero dejando el desplegable vacío sin forma de salir.

const UN_DIA_MS = 24 * 60 * 60 * 1000
const CLAVE_CATALOGO = (id) => `ibp:vsmt:${id}`
const CLAVE_METADATOS = (id) => `ibp:mdmeta:${id}`

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

/** El catálogo, de la memoria si tiene menos de un día. */
export async function fetchMasterCatalogCached(connectionId) {
  const guardado = leerGuardado(CLAVE_CATALOGO(connectionId))
  if (guardado) return guardado
  const leido = await fetchMasterCatalog(connectionId)
  if (Object.keys(leido?.catalogo ?? {}).length > 0) guardar(CLAVE_CATALOGO(connectionId), leido)
  return leido
}

/**
 * Las etiquetas de los campos y las tablas simples, de la memoria si tiene menos de un día.
 *
 * Es de mejor esfuerzo, como en v8: si falla, el visor sigue con los nombres técnicos y sin el área
 * de dato maestro simple, pero no se queda sin funcionar.
 */
export async function fetchMasterMetadataCached(connectionId) {
  const guardado = leerGuardado(CLAVE_METADATOS(connectionId))
  if (guardado) return guardado
  try {
    const leido = await api.get('/api/ibp/master-data', { connectionId, accion: 'metadatos' })
    const datos = { etiquetas: leido?.etiquetas ?? {}, simples: leido?.simples ?? {} }
    if (Object.keys(datos.etiquetas).length > 0 || Object.keys(datos.simples).length > 0) {
      guardar(CLAVE_METADATOS(connectionId), datos)
    }
    return datos
  } catch {
    return { etiquetas: {}, simples: {} }
  }
}

/** «↺ Actualizar»: olvidar lo guardado de esta conexión. */
export function invalidateMasterCaches(connectionId) {
  try {
    localStorage.removeItem(CLAVE_CATALOGO(connectionId))
    localStorage.removeItem(CLAVE_METADATOS(connectionId))
  } catch { /* nada guardado */ }
}

/** Qué columnas tiene una tabla, cuáles son sus claves y cuántas filas hay. */
export function fetchMasterSchema(connectionId, { entidad, planningArea, versionId, condiciones }) {
  return api.get('/api/ibp/master-data', {
    connectionId, accion: 'esquema', entidad, planningArea, versionId, ...conCondiciones(condiciones),
  })
}

/** Cuántas filas devolvería el filtro puesto, sin traerlas. */
export async function fetchMasterCount(connectionId, { entidad, planningArea, versionId, condiciones }) {
  const { total } = await api.get('/api/ibp/master-data', {
    connectionId, accion: 'cuenta', entidad, planningArea, versionId, ...conCondiciones(condiciones),
  })
  return total
}

/** Una página de filas. `orderby` son las claves, para que las ventanas no se solapen. */
export async function fetchMasterRows(connectionId, opciones) {
  const { filas } = await fetchMasterPage(connectionId, opciones)
  return filas
}

/**
 * Lo mismo, y además cuántas filas dice SAP que hay.
 *
 * `conTotal` no cuesta otra petición —el total viaja con las filas— y es lo que permite que quien
 * pagina sepa si terminó de verdad. `total` sale `null` si no se pidió: `null` no es cero.
 */
export async function fetchMasterPage(connectionId, {
  entidad, planningArea, versionId, condiciones, select, orderby,
  skip = 0, top = 500, conTotal = false, signal,
}) {
  const { filas, total } = await api.get('/api/ibp/master-data', {
    connectionId,
    accion: 'filas',
    entidad,
    planningArea,
    versionId,
    skip,
    top,
    ...(conTotal ? { conTotal: '1' } : {}),
    ...(select?.length ? { select: select.join(',') } : {}),
    ...(orderby?.length ? { orderby: orderby.join(',') } : {}),
    ...conCondiciones(condiciones),
  }, { signal })
  return { filas, total: total ?? null }
}

/** Los valores distintos de un campo, para ofrecerlos en un desplegable. */
export async function fetchMasterValues(connectionId, { entidad, campo, planningArea, versionId }) {
  const { valores } = await api.get('/api/ibp/master-data', {
    connectionId, accion: 'valores', entidad, campo, planningArea, versionId,
  })
  return valores
}
