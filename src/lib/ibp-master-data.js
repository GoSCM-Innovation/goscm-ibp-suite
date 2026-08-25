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
