// Guardar y leer las correcciones del explorador: qué entidad cumple cada papel y cómo se llama cada
// campo en ESTE tenant.
//
// Sustituye a la persistencia en `localStorage` de `fieldmap.js` de v7. Ver la migración 005 para los
// dos motivos; el que decide es que en el navegador la corrección que hace una persona no la ve nadie
// más, así que el siguiente vuelve a resolver lo mismo y puede resolverlo distinto. Un análisis de
// calidad de datos que da dos resultados según quién lo corra no sirve para llevarlo a una reunión.
//
// Aquí el mapeo es del CLIENTE y está atado al destino exacto: conexión, área y versión.

import { queryOneScoped } from '../persistence/tenant-scope.js'
import { getConnectionTarget } from '../connections/connections.js'

const COLUMNAS = 'connection_id, planning_area, version_id, roles, fields, updated_at, updated_by'

const aMapa = (row) => row && ({
  connectionId: row.connection_id,
  planningArea: row.planning_area,
  versionId: row.version_id,
  roles: row.roles ?? {},
  fields: row.fields ?? {},
  updatedAt: row.updated_at,
  updatedBy: row.updated_by,
})

/** El mapa vacío que se devuelve cuando todavía nadie corrigió nada de ese destino. */
const sinCorregir = ({ connectionId, planningArea, versionId }) => ({
  connectionId,
  planningArea,
  versionId,
  roles: {},
  fields: {},
  updatedAt: null,
  updatedBy: null,
})

/**
 * Comprueba el destino: que la conexión exista, sea de este cliente y sea de IBP.
 *
 * Que el área exista NO se comprueba aquí: hace falta hablar con SAP y esto solo guarda. Un área
 * inventada da un mapa que nunca se usa, que es inofensivo; una conexión de otro cliente no lo sería.
 */
async function exigirDestino(clientId, { connectionId, planningArea }) {
  if (!connectionId) throw new Error('Falta la conexión.')
  if (!String(planningArea ?? '').trim()) throw new Error('Falta el área de planificación.')

  const conexion = await getConnectionTarget(clientId, connectionId)
  if (conexion.kind !== 'ibp') throw new Error(`La conexión "${conexion.name}" no es de IBP.`)
}

/**
 * Las correcciones de un destino. Nunca `null`: sin corregir nada devuelve un mapa vacío.
 *
 * Devolver un mapa vacío en vez de `null` es lo que permite a quien llama aplicarlo siempre, sin
 * preguntarse si existe. El caso "sin correcciones" es el normal, no una excepción.
 */
export async function getExplorerMap(clientId, destino) {
  await exigirDestino(clientId, destino)

  const row = await queryOneScoped(
    clientId,
    `select ${COLUMNAS} from explorer_maps
     where client_id = $1 and connection_id = $2 and planning_area = $3 and version_id = $4`,
    [clientId, destino.connectionId, destino.planningArea, destino.versionId ?? ''],
  )

  return aMapa(row) ?? sinCorregir({ ...destino, versionId: destino.versionId ?? '' })
}

/**
 * Guarda las correcciones de un destino, reemplazando las que hubiera.
 *
 * Se escribe el mapa COMPLETO y no campo por campo: la pantalla lo tiene entero, y así dos personas
 * corrigiendo a la vez no acaban con una mezcla que no revisó nadie —gana la última, y se ve quién y
 * cuándo—. Es lo contrario de lo que hacía v9 con las orquestaciones, y por el mismo motivo: allí el
 * problema era reescribir un arreglo de TODOS los clientes; aquí la unidad es el destino y es lo que
 * se mira de una vez.
 */
export async function saveExplorerMap(clientId, destino, { roles = {}, fields = {}, userId = null } = {}) {
  await exigirDestino(clientId, destino)

  const row = await queryOneScoped(
    clientId,
    `insert into explorer_maps (client_id, connection_id, planning_area, version_id, roles, fields, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (client_id, connection_id, planning_area, version_id)
     do update set roles = $5, fields = $6, updated_at = now(), updated_by = $7
     returning ${COLUMNAS}`,
    [clientId, destino.connectionId, destino.planningArea, destino.versionId ?? '',
      JSON.stringify(roles), JSON.stringify(fields), userId],
  )

  return aMapa(row)
}

/** Borra las correcciones de un destino, para volver a la detección automática. */
export async function deleteExplorerMap(clientId, destino) {
  await exigirDestino(clientId, destino)

  const row = await queryOneScoped(
    clientId,
    `delete from explorer_maps
     where client_id = $1 and connection_id = $2 and planning_area = $3 and version_id = $4
     returning connection_id`,
    [clientId, destino.connectionId, destino.planningArea, destino.versionId ?? ''],
  )

  return Boolean(row)
}
