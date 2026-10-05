// Guardar y leer orquestaciones de CI-DS.
//
// Sustituye a `api/orchestrations.js` de v9, que las tenía todas —de todos los clientes— en una sola
// clave de Redis como un arreglo JSON. Ver la migración 004 para los tres motivos por los que eso se
// va a Postgres; el que decide es el segundo: allí cada cambio reescribía el arreglo entero, así que
// dos personas guardando a la vez y una perdía su trabajo sin enterarse.
//
// Aquí cada orquestación es una fila. Guardar una no toca a las demás.
//
// La forma del grafo la valida `graph.js`; este archivo se ocupa de a quién pertenece y de que el
// destino exista.

import { queryOneScoped, queryScoped } from '../persistence/tenant-scope.js'
import { getConnectionTarget } from '../connections/connections.js'
import { normalizeGraph } from './graph.js'
import { borrarRun, errorDeConflicto, esTerminal, getRun } from './run-store.js'

const toOrchestration = (row) => row && ({
  id: row.id,
  connectionId: row.connection_id,
  production: row.production,
  name: row.name,
  nodes: row.nodes ?? [],
  edges: row.edges ?? [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const COLUMNAS = 'id, connection_id, production, name, nodes, edges, created_at, updated_at'

function nombreValido(name) {
  const limpio = String(name ?? '').trim()
  if (limpio === '') throw new Error('La orquestación necesita un nombre.')
  return limpio
}

/** Los tipos de conexión que el motor sabe orquestar: tareas de CI-DS y Application Jobs de IBP. */
const TIPOS_ORQUESTABLES = Object.freeze(['cids', 'ibp'])

/**
 * Comprueba que el destino exista, sea de este cliente y sea de un tipo que se pueda orquestar.
 *
 * Lo tercero importa: apuntar una orquestación a una conexión que el motor no sabe ejecutar daría
 * una imposible de lanzar, y el error aparecería al lanzarla y no al crearla.
 */
async function assertDestino(clientId, connectionId) {
  const conexion = await getConnectionTarget(clientId, connectionId)
  if (!TIPOS_ORQUESTABLES.includes(conexion.kind)) {
    throw new Error(`La conexión "${conexion.name}" no se puede orquestar: es de tipo "${conexion.kind}".`)
  }
  return conexion
}

/** Las orquestaciones de un destino: un tenant y uno de sus dos repositorios. */
export async function listOrchestrations(clientId, { connectionId, production = false }) {
  if (!connectionId) throw new Error('Falta la conexión.')
  const rows = await queryScoped(
    clientId,
    `select ${COLUMNAS} from orchestrations
     where client_id = $1 and connection_id = $2 and production = $3
     order by name`,
    [clientId, connectionId, Boolean(production)],
  )
  return rows.map(toOrchestration)
}

export async function getOrchestration(clientId, id) {
  return toOrchestration(await queryOneScoped(
    clientId,
    `select ${COLUMNAS} from orchestrations where id = $1 and client_id = $2`,
    [id, clientId],
  ))
}

export async function createOrchestration(clientId, { connectionId, production = false, name, nodes, edges }) {
  const nombre = nombreValido(name)
  const conexion = await assertDestino(clientId, connectionId)
  // El tipo decide los topes de los reintentos: los de IBP son los de v8 y no los de v9.
  const grafo = normalizeGraph({ nodes, edges }, { kind: conexion.kind })

  return toOrchestration(await queryOneScoped(
    clientId,
    `insert into orchestrations (client_id, connection_id, production, name, nodes, edges)
     values ($1, $2, $3, $4, $5, $6)
     returning ${COLUMNAS}`,
    [clientId, connectionId, Boolean(production), nombre, JSON.stringify(grafo.nodes), JSON.stringify(grafo.edges)],
  ))
}

/**
 * Cambia el nombre, el grafo, o los dos. Lo que no se manda no se toca.
 *
 * El destino NO se puede cambiar a propósito: una orquestación apunta a tareas que existen en un
 * repositorio concreto, y moverla a otro dejaría pasos que apuntan a tareas inexistentes. Para eso
 * está duplicar.
 */
export async function updateOrchestration(clientId, id, { name, nodes, edges } = {}) {
  const actual = await getOrchestration(clientId, id)
  if (!actual) throw new Error('La orquestación no existe para este cliente.')

  const nombre = name === undefined ? actual.name : nombreValido(name)
  // El grafo se valida completo aunque solo venga una de las dos mitades: una arista nueva puede
  // apuntar a un nodo que no está, y validar media cosa no demuestra nada.
  const { kind } = await getConnectionTarget(clientId, actual.connectionId)
  const grafo = normalizeGraph({
    nodes: nodes === undefined ? actual.nodes : nodes,
    edges: edges === undefined ? actual.edges : edges,
  }, { kind })

  return toOrchestration(await queryOneScoped(
    clientId,
    `update orchestrations set name = $1, nodes = $2, edges = $3, updated_at = now()
     where id = $4 and client_id = $5
     returning ${COLUMNAS}`,
    [nombre, JSON.stringify(grafo.nodes), JSON.stringify(grafo.edges), id, clientId],
  ))
}

/**
 * Copia una orquestación con otro nombre, en el mismo destino.
 *
 * El nombre se busca hasta que no choque: v9 le ponía "(copia)" siempre, así que duplicar dos veces
 * dejaba dos con el mismo nombre y no se sabía cuál era cuál.
 */
export async function duplicateOrchestration(clientId, id) {
  const original = await getOrchestration(clientId, id)
  if (!original) throw new Error('La orquestación no existe para este cliente.')

  const hermanas = await listOrchestrations(clientId, {
    connectionId: original.connectionId,
    production: original.production,
  })
  const usados = new Set(hermanas.map((una) => una.name))

  let nombre = `${original.name} (copia)`
  for (let numero = 2; usados.has(nombre); numero += 1) {
    nombre = `${original.name} (copia ${numero})`
  }

  return toOrchestration(await queryOneScoped(
    clientId,
    `insert into orchestrations (client_id, connection_id, production, name, nodes, edges)
     values ($1, $2, $3, $4, $5, $6)
     returning ${COLUMNAS}`,
    [
      clientId,
      original.connectionId,
      original.production,
      nombre,
      JSON.stringify(original.nodes),
      JSON.stringify(original.edges),
    ],
  ))
}

/**
 * Borra una orquestación. Devuelve si había algo que borrar.
 *
 * Como v9, se niega si tiene una ejecución activa (409): borrarla a mitad dejaría la carga corriendo
 * en SAP sin nadie que la siga. Para borrarla hay que cortar la ejecución antes. Al borrar se limpia
 * también el estado de su última ejecución y su lugar en el índice del reloj, que de otro modo
 * quedarían huérfanos hasta que venza el estado.
 *
 * La ejecución se busca con el cliente de la sesión: una orquestación ajena no tiene ejecución aquí,
 * y por eso tampoco se puede usar este borrado para ver si existe.
 */
export async function deleteOrchestration(clientId, id) {
  const run = await getRun(clientId, id)
  if (run && !esTerminal(run.status)) {
    throw errorDeConflicto('No se puede eliminar con una ejecución activa')
  }

  const rows = await queryScoped(
    clientId,
    'delete from orchestrations where id = $1 and client_id = $2 returning id',
    [id, clientId],
  )
  if (rows.length === 0) return false

  await borrarRun(clientId, id)
  return true
}
