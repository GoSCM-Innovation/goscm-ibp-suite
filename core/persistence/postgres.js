// El único acceso a Postgres de toda la aplicación.
//
// v9 tenía cuatro copias a mano del acceso a su almacén (deuda del levantamiento §2); aquí
// hay un solo cliente y se crea perezosamente, para que importar este módulo no exija que
// DATABASE_URL exista — los tests y el build no la tienen.
//
// Se usa el driver HTTP de Neon: cada consulta es una petición https sin conexión
// persistente, que es lo que conviene en funciones serverless. No hay sesión, así que
// tampoco hay transacciones interactivas: para varias sentencias atómicas está
// `transaction()`, que las manda juntas.

import { neon } from '@neondatabase/serverless'

let client = null

export function getSql() {
  if (client) return client
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('Falta DATABASE_URL: no hay conexión a Postgres configurada.')
  }
  client = neon(url)
  return client
}

/** Consulta parametrizada. Devuelve las filas. Nunca interpolar valores en `text`. */
export async function query(text, params = []) {
  return getSql().query(text, params)
}

/** Primera fila, o `null` si no hay ninguna. */
export async function queryOne(text, params = []) {
  const rows = await query(text, params)
  return rows[0] ?? null
}

/**
 * Varias sentencias en una sola transacción no interactiva.
 * `statements` es un array de `[text, params]`.
 */
export async function transaction(statements) {
  const sql = getSql()
  return sql.transaction(statements.map(([text, params = []]) => sql.query(text, params)))
}

/** Solo para los tests: descarta el cliente memorizado. */
export function resetSqlClient() {
  client = null
}
