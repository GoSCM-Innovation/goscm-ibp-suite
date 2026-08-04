// Runner de migraciones: aplica en orden los archivos de core/persistence/migrations que
// todavía no estén registrados en `schema_migrations`. Es idempotente — volver a correrlo
// no hace nada si no hay archivos nuevos.
//
//   npm run db:migrate
//
// Cada archivo se aplica como una transacción: o entra entero con su fila de registro, o no
// entra nada.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { splitStatements } from '../core/persistence/split-statements.js'
import { loadLocalEnv } from './load-env.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS_DIR = join(ROOT, 'core', 'persistence', 'migrations')

async function main() {
  loadLocalEnv(ROOT)

  if (!process.env.DATABASE_URL) {
    console.error(
      'Falta DATABASE_URL. Rellénala en .env (o en el entorno) antes de migrar.\n' +
      'Es la cadena de conexión que da Neon al crear la base de datos.',
    )
    process.exit(1)
  }

  // Se importa después de cargar el entorno: el cliente se crea al primer uso.
  const { getSql, query } = await import('../core/persistence/postgres.js')
  const sql = getSql()

  await query(`
    create table if not exists schema_migrations (
      version    text primary key,
      applied_at timestamptz not null default now()
    )
  `)

  const applied = new Set((await query('select version from schema_migrations')).map((r) => r.version))
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  const pending = files.filter((f) => !applied.has(f))

  if (pending.length === 0) {
    console.log(`Nada que aplicar: ${files.length} migración(es) ya en la base.`)
    return
  }

  for (const file of pending) {
    const statements = splitStatements(readFileSync(join(MIGRATIONS_DIR, file), 'utf-8'))
    console.log(`Aplicando ${file} (${statements.length} sentencias)...`)
    await sql.transaction([
      ...statements.map((statement) => sql.query(statement)),
      sql.query('insert into schema_migrations (version) values ($1)', [file]),
    ])
    console.log(`  ${file} aplicada.`)
  }

  console.log(`Listo: ${pending.length} migración(es) nueva(s).`)
}

main().catch((error) => {
  console.error(`Migración fallida: ${error.message}`)
  process.exit(1)
})
