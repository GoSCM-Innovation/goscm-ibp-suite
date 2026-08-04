// Crea el primer cliente y su usuario administrador.
//
// Hace falta porque la base arranca vacía: no hay nadie que pueda dar de alta a nadie, y el
// panel de administración exige ser administrador para entrar. Este es el único punto en
// todo el sistema donde se crea un usuario sin que otro usuario lo autorice — por eso vive
// en un script que se corre a mano contra la base, y no en un endpoint.
//
//   npm run db:seed -- --cliente "GoSCM" --slug goscm --correo persona@empresa.com --nombre "Nombre"
//
// Opcional: --modulos explorer,jobs,cids  (por defecto, los tres)
// Es idempotente: si el cliente o el usuario ya existen, los reutiliza y no duplica nada.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalEnv } from './load-env.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MODULOS_VALIDOS = ['explorer', 'jobs', 'cids']

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      args[key] = true
    } else {
      args[key] = value
      i += 1
    }
  }
  return args
}

async function main() {
  loadLocalEnv(ROOT)

  const args = parseArgs(process.argv.slice(2))
  const nombreCliente = args.cliente
  const slug = args.slug
  const correo = String(args.correo ?? '').trim().toLowerCase()
  const nombre = args.nombre ?? null
  const modulos = String(args.modulos ?? MODULOS_VALIDOS.join(',')).split(',').map((m) => m.trim()).filter(Boolean)

  if (!nombreCliente || !slug || !correo) {
    console.error(
      'Faltan datos. Uso:\n' +
      '  npm run db:seed -- --cliente "GoSCM" --slug goscm --correo persona@empresa.com --nombre "Nombre"',
    )
    process.exit(1)
  }

  const desconocidos = modulos.filter((m) => !MODULOS_VALIDOS.includes(m))
  if (desconocidos.length > 0) {
    console.error(`Módulos desconocidos: ${desconocidos.join(', ')}. Los válidos son ${MODULOS_VALIDOS.join(', ')}.`)
    process.exit(1)
  }

  if (!process.env.DATABASE_URL) {
    console.error('Falta DATABASE_URL. Rellénala en .env.local (o en el entorno) antes de sembrar.')
    process.exit(1)
  }

  const { query } = await import('../core/persistence/postgres.js')
  const { queryScoped, queryOneScoped } = await import('../core/persistence/tenant-scope.js')

  let cliente = (await query('select id, name from clients where slug = $1', [slug]))[0]
  if (cliente) {
    console.log(`Cliente "${slug}" ya existía (${cliente.id}).`)
  } else {
    cliente = (await query(
      'insert into clients (name, slug) values ($1, $2) returning id, name',
      [nombreCliente, slug],
    ))[0]
    console.log(`Cliente "${nombreCliente}" creado (${cliente.id}).`)
  }

  const existente = await queryOneScoped(
    cliente.id,
    'select id, is_admin from users where lower(email) = $1 and client_id = $2',
    [correo, cliente.id],
  )

  if (existente) {
    console.log(`El usuario ${correo} ya existía (${existente.id}, admin: ${existente.is_admin}).`)
  } else {
    const usuario = await queryOneScoped(
      cliente.id,
      `insert into users (client_id, email, name, is_admin, allowed_providers)
       values ($1, $2, $3, true, array['email']::text[])
       returning id`,
      [cliente.id, correo, nombre],
    )
    console.log(`Administrador ${correo} creado (${usuario.id}).`)
  }

  for (const modulo of modulos) {
    await queryScoped(
      cliente.id,
      `insert into module_subscriptions (client_id, module) values ($1, $2)
       on conflict (client_id, module) do nothing`,
      [cliente.id, modulo],
    )
  }
  console.log(`Módulos contratados: ${modulos.join(', ')}.`)

  console.log('\nListo. Ya puedes pedir un código de acceso con ese correo.')
}

main().catch((error) => {
  console.error(`Siembra fallida: ${error.message}`)
  process.exit(1)
})
