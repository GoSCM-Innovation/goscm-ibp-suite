// Guarda de aislamiento por cliente.
//
// Regla del proyecto: ninguna consulta sin filtro de cliente. v9 no tenía aislamiento
// ninguno — un solo secreto global y quien lo tuviera lo veía todo (deuda #3 del
// levantamiento). La forma de no repetirlo es que el filtro sea obligatorio en el código y
// no una costumbre que alguien olvide un martes.
//
// Alcance honesto de esta guarda: es un cortafuegos sintáctico, no un analizador de SQL.
// Comprueba que la sentencia mencione `client_id` ligado al cliente de la sesión y falla
// CERRADA cuando no puede demostrarlo. No sustituye a escribir bien la consulta: atrapa el
// olvido, que es el error que de verdad ocurre. El endurecimiento siguiente, cuando exista
// una base viva contra la que probarlo, es RLS en Postgres.

import { query, queryOne } from './postgres.js'

/**
 * Tablas cuyas filas pertenecen a un cliente. Toda sentencia que las toque debe llevar el
 * filtro. `clients` no está: es la tabla del propio cliente y solo la consulta el panel de
 * administración, que por definición ve todos.
 */
export const TENANT_SCOPED_TABLES = new Set([
  'users',
  'module_subscriptions',
  'connections',
  'connection_agreements',
])

export class TenantScopeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'TenantScopeError'
  }
}

// Tablas mencionadas tras FROM, JOIN, UPDATE o INTO. Cubre también `delete from` (por el
// FROM) e `insert into` (por el INTO).
const TABLE_REFERENCE = /\b(?:from|join|update|into)\s+(?:only\s+)?"?([a-z_][a-z0-9_]*)"?/gi
const CLIENT_ID_PREDICATE = /\bclient_id\s*=\s*\$(\d+)/gi
const INSERT_COLUMNS = /\binsert\s+into\s+(?:only\s+)?"?[a-z_][a-z0-9_]*"?\s*\(([^)]*)\)/i

function referencedTenantTables(text) {
  const found = new Set()
  for (const match of text.matchAll(TABLE_REFERENCE)) {
    const table = match[1].toLowerCase()
    if (TENANT_SCOPED_TABLES.has(table)) found.add(table)
  }
  return found
}

/**
 * Revienta si `text` toca una tabla de cliente sin atarla a `clientId`.
 * No devuelve nada: o pasa, o lanza `TenantScopeError`.
 */
export function assertTenantScoped(text, params, clientId) {
  if (typeof clientId !== 'string' || clientId.trim() === '') {
    throw new TenantScopeError('Falta el clientId: ninguna consulta de datos de cliente puede correr sin él.')
  }

  const tables = referencedTenantTables(text)
  if (tables.size === 0) return

  const listed = [...tables].join(', ')

  // En un INSERT no hay predicado: el filtro es que client_id esté entre las columnas y que
  // el valor que se inserta sea el del cliente de la sesión.
  if (/^\s*insert\b/i.test(text)) {
    const columns = text.match(INSERT_COLUMNS)
    const names = columns ? columns[1].split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase()) : []
    if (!names.includes('client_id')) {
      throw new TenantScopeError(
        `El INSERT sobre ${listed} no incluye la columna client_id.`,
      )
    }
    if (!params.includes(clientId)) {
      throw new TenantScopeError(
        `El INSERT sobre ${listed} no inserta el clientId de la sesión en client_id.`,
      )
    }
    return
  }

  const predicates = [...text.matchAll(CLIENT_ID_PREDICATE)]
  if (predicates.length === 0) {
    throw new TenantScopeError(
      `La consulta toca ${listed} sin filtrar por client_id.`,
    )
  }

  const boundToSession = predicates.some((match) => params[Number(match[1]) - 1] === clientId)
  if (!boundToSession) {
    throw new TenantScopeError(
      `La consulta filtra ${listed} por un client_id que no es el de la sesión.`,
    )
  }
}

/** Consulta con la guarda puesta. Es la única forma de leer o escribir datos de un cliente. */
export async function queryScoped(clientId, text, params = []) {
  assertTenantScoped(text, params, clientId)
  return query(text, params)
}

/** Primera fila, o `null`, con la guarda puesta. */
export async function queryOneScoped(clientId, text, params = []) {
  assertTenantScoped(text, params, clientId)
  return queryOne(text, params)
}
