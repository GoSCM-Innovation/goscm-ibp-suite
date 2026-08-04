import { describe, it, expect, vi, beforeEach } from 'vitest'
import { findUserForLogin, looksLikeEmail, normalizeEmail, recordLogin } from './identity.js'
import { query } from '../persistence/postgres.js'
import { queryScoped } from '../persistence/tenant-scope.js'

vi.mock('../persistence/postgres.js', () => ({ query: vi.fn(async () => []) }))
vi.mock('../persistence/tenant-scope.js', () => ({ queryScoped: vi.fn(async () => []) }))

const FILA = {
  id: 'u-1',
  client_id: 'c-1',
  email: 'Gerardo@go-scm.com',
  name: 'Gerardo',
  is_admin: true,
  allowed_providers: ['email'],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('normalizeEmail', () => {
  it.each([
    ['  Gerardo@GO-SCM.com  ', 'gerardo@go-scm.com'],
    ['ya@minusculas.com', 'ya@minusculas.com'],
    [undefined, ''],
    [null, ''],
  ])('normaliza %s', (entrada, esperado) => {
    expect(normalizeEmail(entrada)).toBe(esperado)
  })
})

describe('looksLikeEmail', () => {
  it.each(['a@b.co', 'nombre.apellido@empresa.com.mx', '  MAYUS@x.io  '])('acepta %s', (valor) => {
    expect(looksLikeEmail(valor)).toBe(true)
  })

  it.each(['', 'sin-arroba', 'a@b', 'a@ b.com', 'dos@arrobas@x.com', undefined])('rechaza %s', (valor) => {
    expect(looksLikeEmail(valor)).toBe(false)
  })

  it('rechaza direcciones absurdamente largas', () => {
    expect(looksLikeEmail(`${'a'.repeat(250)}@b.com`)).toBe(false)
  })
})

describe('findUserForLogin', () => {
  it('busca por el correo en minúsculas y exige usuario y cliente activos', async () => {
    query.mockResolvedValue([FILA])
    const usuario = await findUserForLogin('  Gerardo@GO-SCM.com ')

    expect(usuario).toEqual({
      id: 'u-1',
      clientId: 'c-1',
      email: 'Gerardo@go-scm.com',
      name: 'Gerardo',
      isAdmin: true,
    })

    const [sql, params] = query.mock.calls[0]
    expect(params).toEqual(['gerardo@go-scm.com'])
    expect(sql).toContain("u.status = 'active'")
    expect(sql).toContain("c.status = 'active'")
  })

  it('devuelve null cuando no hay fila', async () => {
    query.mockResolvedValue([])
    await expect(findUserForLogin('nadie@go-scm.com')).resolves.toBeNull()
  })

  it('devuelve null si el usuario no tiene habilitada esa puerta de entrada', async () => {
    query.mockResolvedValue([{ ...FILA, allowed_providers: ['microsoft'] }])
    await expect(findUserForLogin('gerardo@go-scm.com', 'email')).resolves.toBeNull()
  })

  it('no toca la base con un correo que ni siquiera lo parece', async () => {
    await expect(findUserForLogin('esto-no-es-un-correo')).resolves.toBeNull()
    expect(query).not.toHaveBeenCalled()
  })
})

describe('recordLogin', () => {
  it('anota la última entrada con el filtro de cliente puesto', async () => {
    await recordLogin('c-1', 'u-1')
    expect(queryScoped).toHaveBeenCalledWith(
      'c-1',
      expect.stringContaining('last_login_at = now()'),
      ['u-1', 'c-1'],
    )
  })
})
