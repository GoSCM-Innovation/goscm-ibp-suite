import { describe, it, expect, vi, beforeEach } from 'vitest'
import { assertTenantScoped, queryScoped, queryOneScoped, TenantScopeError } from './tenant-scope.js'
import { query, queryOne } from './postgres.js'

vi.mock('./postgres.js', () => ({
  query: vi.fn(async () => [{ id: 'fila' }]),
  queryOne: vi.fn(async () => ({ id: 'fila' })),
}))

const CLIENT = '11111111-1111-1111-1111-111111111111'
const OTRO_CLIENTE = '22222222-2222-2222-2222-222222222222'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('assertTenantScoped — sin clientId', () => {
  it.each([undefined, null, '', '   ', 42])('rechaza un clientId inservible: %s', (clientId) => {
    expect(() => assertTenantScoped('select * from users where client_id = $1', [clientId], clientId))
      .toThrow(TenantScopeError)
  })
})

describe('assertTenantScoped — tablas sin dueño', () => {
  it('deja pasar una consulta que no toca ninguna tabla de cliente', () => {
    expect(() => assertTenantScoped('select * from clients where slug = $1', ['acme'], CLIENT)).not.toThrow()
  })

  it('deja pasar una consulta a una tabla que no está en el esquema de cliente', () => {
    expect(() => assertTenantScoped('select version from schema_migrations', [], CLIENT)).not.toThrow()
  })
})

describe('assertTenantScoped — lectura', () => {
  it('rechaza un SELECT sobre una tabla de cliente sin filtro', () => {
    expect(() => assertTenantScoped('select * from users', [], CLIENT))
      .toThrow(/sin filtrar por client_id/)
  })

  it('acepta un SELECT filtrado por el cliente de la sesión', () => {
    expect(() => assertTenantScoped('select * from users where client_id = $1', [CLIENT], CLIENT)).not.toThrow()
  })

  it('rechaza un SELECT filtrado por OTRO cliente', () => {
    expect(() => assertTenantScoped('select * from users where client_id = $1', [OTRO_CLIENTE], CLIENT))
      .toThrow(/no es el de la sesión/)
  })

  it('acepta el filtro con alias de tabla', () => {
    const text = 'select u.email from clients c join users u on u.client_id = c.id where u.client_id = $1'
    expect(() => assertTenantScoped(text, [CLIENT], CLIENT)).not.toThrow()
  })

  it('rechaza el JOIN a una tabla de cliente sin filtro, aunque la principal no lo sea', () => {
    const text = 'select c.name, u.email from clients c join users u on u.client_id = c.id'
    expect(() => assertTenantScoped(text, [], CLIENT)).toThrow(/users/)
  })

  it('no se despista con las mayúsculas ni con el espaciado', () => {
    expect(() => assertTenantScoped('SELECT * FROM  users  WHERE  CLIENT_ID  =  $2', ['x', CLIENT], CLIENT))
      .not.toThrow()
  })

  it('acepta el filtro cuando hay varios predicados y solo uno es el de la sesión', () => {
    const text = 'select * from connection_agreements where connection_id = $1 and client_id = $2'
    expect(() => assertTenantScoped(text, ['conn-1', CLIENT], CLIENT)).not.toThrow()
  })
})

describe('assertTenantScoped — escritura', () => {
  it('rechaza un INSERT que no lleva la columna client_id', () => {
    const text = 'insert into connections (kind, name, base_url) values ($1, $2, $3)'
    expect(() => assertTenantScoped(text, ['ibp', 'Tenant QA', 'https://x'], CLIENT))
      .toThrow(/no incluye la columna client_id/)
  })

  it('rechaza un INSERT que lleva la columna pero no el cliente de la sesión', () => {
    const text = 'insert into connections (client_id, kind, name) values ($1, $2, $3)'
    expect(() => assertTenantScoped(text, [OTRO_CLIENTE, 'ibp', 'Tenant QA'], CLIENT))
      .toThrow(/no inserta el clientId de la sesión/)
  })

  it('acepta un INSERT con la columna y el cliente correctos', () => {
    const text = 'insert into connections (client_id, kind, name) values ($1, $2, $3)'
    expect(() => assertTenantScoped(text, [CLIENT, 'ibp', 'Tenant QA'], CLIENT)).not.toThrow()
  })

  it('rechaza un UPDATE sin filtro de cliente', () => {
    expect(() => assertTenantScoped('update users set is_admin = true where id = $1', ['user-1'], CLIENT))
      .toThrow(/sin filtrar por client_id/)
  })

  it('acepta un UPDATE con filtro de cliente', () => {
    const text = 'update users set is_admin = true where id = $1 and client_id = $2'
    expect(() => assertTenantScoped(text, ['user-1', CLIENT], CLIENT)).not.toThrow()
  })

  it('rechaza un DELETE sin filtro de cliente', () => {
    expect(() => assertTenantScoped('delete from connections where id = $1', ['conn-1'], CLIENT))
      .toThrow(/sin filtrar por client_id/)
  })

  it('acepta un DELETE con filtro de cliente', () => {
    const text = 'delete from connections where id = $1 and client_id = $2'
    expect(() => assertTenantScoped(text, ['conn-1', CLIENT], CLIENT)).not.toThrow()
  })
})

describe('queryScoped', () => {
  it('delega en query cuando la guarda pasa', async () => {
    const text = 'select * from users where client_id = $1'
    const rows = await queryScoped(CLIENT, text, [CLIENT])
    expect(rows).toEqual([{ id: 'fila' }])
    expect(query).toHaveBeenCalledWith(text, [CLIENT])
  })

  it('no llega a la base cuando la guarda falla', async () => {
    await expect(queryScoped(CLIENT, 'select * from users', [])).rejects.toThrow(TenantScopeError)
    expect(query).not.toHaveBeenCalled()
  })

  it('queryOneScoped delega en queryOne', async () => {
    const text = 'select * from users where client_id = $1 limit 1'
    await expect(queryOneScoped(CLIENT, text, [CLIENT])).resolves.toEqual({ id: 'fila' })
    expect(queryOne).toHaveBeenCalledWith(text, [CLIENT])
  })
})

// Si se añade una tabla con `client_id` y nadie la mete en la guarda, sus consultas dejan de revisarse sin
// que nada avise. Esta prueba lee las migraciones y compara.
describe('TENANT_SCOPED_TABLES — cubre todas las tablas con client_id', () => {
  it('es exactamente el conjunto de tablas de las migraciones que tienen la columna client_id', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const { TENANT_SCOPED_TABLES } = await import('./tenant-scope.js')
    const carpeta = new URL('./migrations/', import.meta.url)
    const sql = readdirSync(carpeta).filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(new URL(f, carpeta), 'utf8')).join('\n')

    const todas = [...sql.matchAll(/create table (?:if not exists )?(\w+)\s*\(([\s\S]*?)\n\)\s*;/gi)]
    // Si el análisis dejara de ver alguna tabla, la prueba no probaría nada: tienen que ser todas.
    expect(todas.length).toBe((sql.match(/create table/gi) ?? []).length)

    const conCliente = todas.filter((m) => /\bclient_id\b/.test(m[2])).map((m) => m[1]).sort()
    expect([...TENANT_SCOPED_TABLES].sort()).toEqual(conCliente)
  })
})
