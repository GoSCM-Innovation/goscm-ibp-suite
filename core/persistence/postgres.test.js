import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getSql, query, queryOne, transaction, resetSqlClient } from './postgres.js'

const { neonMock, queryMock, transactionMock } = vi.hoisted(() => {
  const queryMock = vi.fn(async () => [{ id: 'a' }, { id: 'b' }])
  const transactionMock = vi.fn(async () => [])
  const neonMock = vi.fn(() =>
    Object.assign(vi.fn(), { query: queryMock, transaction: transactionMock }),
  )
  return { neonMock, queryMock, transactionMock }
})

vi.mock('@neondatabase/serverless', () => ({ neon: neonMock }))

const URL_ORIGINAL = process.env.DATABASE_URL

beforeEach(() => {
  vi.clearAllMocks()
  resetSqlClient()
  process.env.DATABASE_URL = 'postgres://usuario:clave@host/base'
})

afterEach(() => {
  resetSqlClient()
  if (URL_ORIGINAL === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = URL_ORIGINAL
})

describe('getSql', () => {
  it('revienta con un mensaje claro si falta DATABASE_URL', () => {
    delete process.env.DATABASE_URL
    expect(() => getSql()).toThrow(/DATABASE_URL/)
    expect(neonMock).not.toHaveBeenCalled()
  })

  it('crea el cliente una sola vez y lo reutiliza', () => {
    const primero = getSql()
    const segundo = getSql()
    expect(primero).toBe(segundo)
    expect(neonMock).toHaveBeenCalledTimes(1)
    expect(neonMock).toHaveBeenCalledWith('postgres://usuario:clave@host/base')
  })

  it('no lee DATABASE_URL al importar el módulo, sino al primer uso', () => {
    // Si se leyera al importar, el borrado de arriba no habría bastado para provocar el
    // error: el cliente ya existiría. Este test protege la creación perezosa.
    expect(neonMock).not.toHaveBeenCalled()
  })
})

describe('query', () => {
  it('pasa el texto y los parámetros tal cual y devuelve las filas', async () => {
    const rows = await query('select * from clients where slug = $1', ['acme'])
    expect(queryMock).toHaveBeenCalledWith('select * from clients where slug = $1', ['acme'])
    expect(rows).toEqual([{ id: 'a' }, { id: 'b' }])
  })

  it('usa un array vacío cuando no se pasan parámetros', async () => {
    await query('select 1')
    expect(queryMock).toHaveBeenCalledWith('select 1', [])
  })
})

describe('queryOne', () => {
  it('devuelve la primera fila', async () => {
    await expect(queryOne('select 1')).resolves.toEqual({ id: 'a' })
  })

  it('devuelve null cuando no hay filas', async () => {
    queryMock.mockResolvedValueOnce([])
    await expect(queryOne('select 1')).resolves.toBeNull()
  })
})

describe('transaction', () => {
  it('manda todas las sentencias juntas', async () => {
    await transaction([
      ['insert into clients (name, slug) values ($1, $2)', ['Acme', 'acme']],
      ['select 1'],
    ])
    expect(transactionMock).toHaveBeenCalledTimes(1)
    expect(transactionMock.mock.calls[0][0]).toHaveLength(2)
    expect(queryMock).toHaveBeenCalledWith('select 1', [])
  })
})
