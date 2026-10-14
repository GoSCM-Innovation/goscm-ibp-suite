// La biblioteca de integraciones de un cliente: guardarlas, leerlas, duplicarlas y borrarlas.
//
// Una integración es un body (ver `body.js`) con nombre y carpeta, atada a UNA conexión de CI: la del
// tenant de CPI contra el que se probó. Cada ambiente tiene su conexión y por tanto su biblioteca.
//
// Toda consulta lleva el cliente (`queryScoped`), y la conexión se comprueba antes de tocar nada: una
// conexión de otro cliente, o de otro tipo, no existe para quien pregunta.

import { queryOneScoped, queryScoped } from '../persistence/tenant-scope.js'
import { getConnectionTarget } from '../connections/connections.js'
import { normalizarBody, resumenDeBody } from './body.js'

export const NOMBRE_MAX = 120
export const CARPETA_MAX = 200

const COLUMNAS = 'id, connection_id, folder, name, body, created_at, updated_at'

/**
 * ¿Es un identificador con forma de UUID? Se comprueba antes de preguntarle a la base: un texto cualquiera
 * en una columna uuid revienta con un mensaje de Postgres que no es para mostrar.
 */
export const esUuid = (valor) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(valor ?? ''))

/** Lo que una lista enseña de cada integración: sin el body entero, que puede pesar decenas de KB. */
const aResumen = (fila) => fila && ({
  id: fila.id,
  connectionId: fila.connection_id,
  folder: fila.folder,
  name: fila.name,
  updatedAt: fila.updated_at,
  resumen: resumenDeBody(fila.body),
})

const aIntegracion = (fila) => fila && ({ ...aResumen(fila), createdAt: fila.created_at, body: fila.body })

/** Una conexión de CI de este cliente, o un error que se pueda mostrar. */
export async function assertConexionCi(clientId, connectionId) {
  if (!connectionId) throw new Error('Falta la conexión.')
  const conexion = await getConnectionTarget(clientId, connectionId)
  if (conexion.kind !== 'ci') throw new Error(`La conexión "${conexion.name}" no es de Cloud Integration.`)
  return conexion
}

/** El nombre, sin espacios sobrantes, o un error si queda vacío o largo. */
export function normalizarNombre(nombre) {
  const limpio = String(nombre ?? '').trim()
  if (limpio === '') throw new Error('La integración necesita un nombre.')
  if (limpio.length > NOMBRE_MAX) throw new Error(`El nombre pasa de ${NOMBRE_MAX} caracteres.`)
  return limpio
}

/**
 * La carpeta como ruta: tramos separados por «/», sin espacios ni tramos vacíos. «STARBRANDS / Maestros/»
 * y «STARBRANDS/Maestros» son la misma, y vacía es «sin carpeta».
 */
export function normalizarCarpeta(carpeta) {
  const limpia = String(carpeta ?? '').split('/').map((tramo) => tramo.trim()).filter(Boolean).join('/')
  if (limpia.length > CARPETA_MAX) throw new Error(`La carpeta pasa de ${CARPETA_MAX} caracteres.`)
  return limpia
}

/** Traduce el choque con la restricción de nombre único a un mensaje que diga qué hacer. */
function conMensajeDeDuplicado(fallo) {
  if (fallo?.code === '23505' || /ci_integrations_nombre_idx/.test(String(fallo?.message))) {
    throw new Error('Ya hay una integración con ese nombre en esa carpeta.')
  }
  throw fallo
}

export async function listIntegrations(clientId, connectionId) {
  await assertConexionCi(clientId, connectionId)
  const filas = await queryScoped(
    clientId,
    `select ${COLUMNAS} from ci_integrations
     where client_id = $1 and connection_id = $2
     order by folder, name`,
    [clientId, connectionId],
  )
  return filas.map(aResumen)
}

export async function getIntegration(clientId, id) {
  if (!esUuid(id)) return null
  return aIntegracion(await queryOneScoped(
    clientId,
    `select ${COLUMNAS} from ci_integrations where id = $1 and client_id = $2`,
    [id, clientId],
  ))
}

/** Varias integraciones de una vez, por identificador. Las que no existan para este cliente no vienen. */
export async function getIntegrations(clientId, ids) {
  const pedidas = [...new Set(ids)].filter(esUuid)
  if (pedidas.length === 0) return []
  // Un marcador por identificador y no un arreglo: ninguna otra consulta de esta base pasa arreglos, así que
  // no se sabe cómo los serializa el driver HTTP, y un marcador por valor no depende de eso.
  const marcadores = pedidas.map((_id, i) => `$${i + 2}`).join(', ')
  const filas = await queryScoped(
    clientId,
    `select ${COLUMNAS} from ci_integrations where client_id = $1 and id in (${marcadores})`,
    [clientId, ...pedidas],
  )
  return filas.map(aIntegracion)
}

export async function createIntegration(clientId, userId, { connectionId, folder, name, body }) {
  await assertConexionCi(clientId, connectionId)
  const nombre = normalizarNombre(name)
  const carpeta = normalizarCarpeta(folder)
  const texto = normalizarBody(body)

  try {
    return aIntegracion(await queryOneScoped(
      clientId,
      `insert into ci_integrations (client_id, connection_id, folder, name, body, updated_by)
       values ($1, $2, $3, $4, $5, $6)
       returning ${COLUMNAS}`,
      [clientId, connectionId, carpeta, nombre, texto, userId ?? null],
    ))
  } catch (fallo) {
    return conMensajeDeDuplicado(fallo)
  }
}

/** Cambia nombre, carpeta, body, o varios. Lo que no se manda no se toca. */
export async function updateIntegration(clientId, userId, id, { name, folder, body } = {}) {
  const actual = await getIntegration(clientId, id)
  if (!actual) throw new Error('La integración no existe para este cliente.')

  const nombre = name === undefined ? actual.name : normalizarNombre(name)
  const carpeta = folder === undefined ? actual.folder : normalizarCarpeta(folder)
  const texto = body === undefined ? actual.body : normalizarBody(body)

  try {
    return aIntegracion(await queryOneScoped(
      clientId,
      `update ci_integrations
         set name = $1, folder = $2, body = $3, updated_by = $4, updated_at = now()
       where id = $5 and client_id = $6
       returning ${COLUMNAS}`,
      [nombre, carpeta, texto, userId ?? null, id, clientId],
    ))
  } catch (fallo) {
    return conMensajeDeDuplicado(fallo)
  }
}

/** Copia una integración con otro nombre, en la misma carpeta: «(copia)», «(copia 2)»… */
export async function duplicateIntegration(clientId, userId, id) {
  const original = await getIntegration(clientId, id)
  if (!original) throw new Error('La integración no existe para este cliente.')

  const hermanas = await queryScoped(
    clientId,
    'select name from ci_integrations where client_id = $1 and connection_id = $2 and folder = $3',
    [clientId, original.connectionId, original.folder],
  )
  const usados = new Set(hermanas.map((una) => una.name))

  let nombre = `${original.name} (copia)`
  for (let numero = 2; usados.has(nombre); numero += 1) nombre = `${original.name} (copia ${numero})`

  return createIntegration(clientId, userId, {
    connectionId: original.connectionId, folder: original.folder, name: nombre, body: original.body,
  })
}

/**
 * Las orquestaciones del cliente que usan una integración. Se mira dentro del grafo (jsonb): un paso guarda
 * el identificador de su integración en `data.integrationId`.
 */
export async function orchestrationsUsing(clientId, integrationId) {
  const filas = await queryScoped(
    clientId,
    `select id, name from orchestrations
     where client_id = $1 and nodes @> $2::jsonb
     order by name`,
    [clientId, JSON.stringify([{ data: { integrationId } }])],
  )
  return filas.map((fila) => ({ id: fila.id, name: fila.name }))
}

/**
 * Borra una integración. Se niega si una orquestación la usa: borrarla dejaría un paso apuntando a nada, y
 * el fallo aparecería al ejecutar, no al borrar. Devuelve si había algo que borrar.
 */
export async function deleteIntegration(clientId, id) {
  const usadaPor = await orchestrationsUsing(clientId, id)
  if (usadaPor.length > 0) {
    throw Object.assign(
      new Error(`No se puede borrar: la usa ${usadaPor.map((una) => `«${una.name}»`).join(', ')}. Quítala de ahí primero.`),
      { statusCode: 409 },
    )
  }
  const filas = await queryScoped(
    clientId,
    'delete from ci_integrations where id = $1 and client_id = $2 returning id',
    [id, clientId],
  )
  return filas.length > 0
}

/**
 * Renombra una carpeta, y las que cuelgan de ella: «A» pasa a «B», y «A/x» a «B/x». Devuelve cuántas
 * integraciones cambiaron. Si el nombre nuevo choca con una integración que ya existe allí, no se cambia
 * nada (el índice único lo impide) y se dice.
 */
export async function renameFolder(clientId, connectionId, desde, hasta) {
  await assertConexionCi(clientId, connectionId)
  const origen = normalizarCarpeta(desde)
  const destino = normalizarCarpeta(hasta)
  if (origen === '') throw new Error('Esa carpeta no existe.')
  if (origen === destino) return 0

  try {
    const filas = await queryScoped(
      clientId,
      `update ci_integrations
         set folder = case
               when folder = $3 then $4
               when $4 = '' then substr(folder, length($3) + 2)
               else $4 || substr(folder, length($3) + 1)
             end,
             updated_at = now()
       where client_id = $1 and connection_id = $2 and (folder = $3 or folder like $5)
       returning id`,
      [clientId, connectionId, origen, destino, `${origen.replace(/[\\%_]/g, '\\$&')}/%`],
    )
    return filas.length
  } catch (fallo) {
    return conMensajeDeDuplicado(fallo)
  }
}
