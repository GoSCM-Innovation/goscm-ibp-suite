import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  MODULES,
  contractedModules,
  getSession,
  hasModule,
  requireAdmin,
  requireClientAccess,
  requireModule,
  requirePlatformAdmin,
  requireSession,
} from './guards.js'
import { readSession } from './sessions.js'
import { queryScoped } from '../persistence/tenant-scope.js'
import { SESSION_COOKIE } from './cookies.js'

vi.mock('./sessions.js', () => ({ readSession: vi.fn() }))
vi.mock('../persistence/tenant-scope.js', () => ({ queryScoped: vi.fn(async () => []) }))

const SESION = { id: 's-1', userId: 'u-1', clientId: 'c-1', isAdmin: false, email: 'a@b.com', name: 'Ana' }

function fakeRes() {
  return {
    code: null,
    body: null,
    status(code) { this.code = code; return this },
    json(body) { this.body = body; return this },
  }
}

const conCookie = (valor) => ({ headers: { cookie: `${SESSION_COOKIE}=${valor}` } })

beforeEach(() => {
  vi.clearAllMocks()
  readSession.mockResolvedValue(SESION)
})

describe('getSession', () => {
  it('devuelve la sesión que corresponde a la cookie', async () => {
    await expect(getSession(conCookie('s-1'))).resolves.toEqual(SESION)
    expect(readSession).toHaveBeenCalledWith('s-1')
  })

  it('devuelve null sin cookie, y ni siquiera consulta', async () => {
    await expect(getSession({ headers: {} })).resolves.toBeNull()
    expect(readSession).not.toHaveBeenCalled()
  })
})

describe('requireSession', () => {
  it('deja pasar con sesión válida', async () => {
    const res = fakeRes()
    await expect(requireSession(conCookie('s-1'), res)).resolves.toEqual(SESION)
    expect(res.code).toBeNull()
  })

  it('responde 401 y null cuando la sesión venció', async () => {
    readSession.mockResolvedValue(null)
    const res = fakeRes()
    await expect(requireSession(conCookie('vieja'), res)).resolves.toBeNull()
    expect(res.code).toBe(401)
  })
})

describe('requireAdmin', () => {
  it('rechaza con 403 a quien no es administrador', async () => {
    const res = fakeRes()
    await expect(requireAdmin(conCookie('s-1'), res)).resolves.toBeNull()
    expect(res.code).toBe(403)
  })

  it('deja pasar al administrador', async () => {
    readSession.mockResolvedValue({ ...SESION, isAdmin: true })
    const res = fakeRes()
    await expect(requireAdmin(conCookie('s-1'), res)).resolves.toMatchObject({ isAdmin: true })
    expect(res.code).toBeNull()
  })

  it('sin sesión responde 401, no 403', async () => {
    readSession.mockResolvedValue(null)
    const res = fakeRes()
    await requireAdmin(conCookie('s-1'), res)
    expect(res.code).toBe(401)
  })
})

describe('requirePlatformAdmin', () => {
  it('rechaza al administrador de un cliente: la palanca comercial no es suya', async () => {
    readSession.mockResolvedValue({ ...SESION, isAdmin: true, isPlatformAdmin: false })
    const res = fakeRes()
    await expect(requirePlatformAdmin(conCookie('s-1'), res)).resolves.toBeNull()
    expect(res.code).toBe(403)
  })

  it('deja pasar al administrador de plataforma', async () => {
    readSession.mockResolvedValue({ ...SESION, isPlatformAdmin: true })
    const res = fakeRes()
    await expect(requirePlatformAdmin(conCookie('s-1'), res)).resolves.toMatchObject({ isPlatformAdmin: true })
    expect(res.code).toBeNull()
  })
})

describe('requireAdmin con los dos niveles', () => {
  it('el administrador de plataforma también administra su cliente', async () => {
    readSession.mockResolvedValue({ ...SESION, isAdmin: false, isPlatformAdmin: true })
    const res = fakeRes()
    await expect(requireAdmin(conCookie('s-1'), res)).resolves.not.toBeNull()
  })
})

describe('requireClientAccess', () => {
  it('sin cliente indicado se administra el propio', async () => {
    readSession.mockResolvedValue({ ...SESION, isAdmin: true })
    const res = fakeRes()
    await expect(requireClientAccess(conCookie('s-1'), res)).resolves.toMatchObject({ clientId: 'c-1' })
  })

  it('el administrador de un cliente no puede administrar otro', async () => {
    readSession.mockResolvedValue({ ...SESION, isAdmin: true, isPlatformAdmin: false })
    const res = fakeRes()
    await expect(requireClientAccess(conCookie('s-1'), res, 'c-2')).resolves.toBeNull()
    // 404 y no 403: un "prohibido" confirmaría que ese cliente existe.
    expect(res.code).toBe(404)
  })

  it('el administrador de plataforma puede con cualquier cliente', async () => {
    readSession.mockResolvedValue({ ...SESION, isPlatformAdmin: true })
    const res = fakeRes()
    await expect(requireClientAccess(conCookie('s-1'), res, 'c-2')).resolves.toMatchObject({ clientId: 'c-2' })
  })

  it('quien no es administrador de nada no pasa', async () => {
    readSession.mockResolvedValue({ ...SESION, isAdmin: false, isPlatformAdmin: false })
    const res = fakeRes()
    await expect(requireClientAccess(conCookie('s-1'), res)).resolves.toBeNull()
    expect(res.code).toBe(403)
  })
})

describe('hasModule', () => {
  it('revienta ante un módulo que no existe, en vez de responder "no contratado"', async () => {
    await expect(hasModule('c-1', 'inventado')).rejects.toThrow(/Módulo desconocido/)
    expect(queryScoped).not.toHaveBeenCalled()
  })

  it('consulta con el filtro de cliente y exige la suscripción vigente', async () => {
    queryScoped.mockResolvedValue([{ '?column?': 1 }])
    await expect(hasModule('c-1', 'jobs')).resolves.toBe(true)

    const [clientId, sql, params] = queryScoped.mock.calls[0]
    expect(clientId).toBe('c-1')
    expect(params).toEqual(['c-1', 'jobs'])
    expect(sql).toContain("status = 'active'")
    expect(sql).toContain('valid_until')
  })

  it('devuelve false cuando no hay suscripción vigente', async () => {
    queryScoped.mockResolvedValue([])
    await expect(hasModule('c-1', 'explorer')).resolves.toBe(false)
  })

  it.each(MODULES)('acepta el módulo %s', async (modulo) => {
    queryScoped.mockResolvedValue([])
    await expect(hasModule('c-1', modulo)).resolves.toBe(false)
  })
})

describe('requireModule', () => {
  it('responde 403 cuando el módulo no está contratado', async () => {
    queryScoped.mockResolvedValue([])
    const res = fakeRes()
    await expect(requireModule(conCookie('s-1'), res, 'jobs')).resolves.toBeNull()
    expect(res.code).toBe(403)
    expect(res.body).toMatchObject({ module: 'jobs' })
  })

  it('deja pasar cuando sí está contratado', async () => {
    queryScoped.mockResolvedValue([{ '?column?': 1 }])
    const res = fakeRes()
    await expect(requireModule(conCookie('s-1'), res, 'jobs')).resolves.toEqual(SESION)
    expect(res.code).toBeNull()
  })

  it('sin sesión no llega a preguntar por el módulo', async () => {
    readSession.mockResolvedValue(null)
    const res = fakeRes()
    await requireModule(conCookie('s-1'), res, 'jobs')
    expect(res.code).toBe(401)
    expect(queryScoped).not.toHaveBeenCalled()
  })
})

describe('contractedModules', () => {
  it('devuelve la lista de módulos vigentes', async () => {
    queryScoped.mockResolvedValue([{ module: 'cids' }, { module: 'jobs' }])
    await expect(contractedModules('c-1')).resolves.toEqual(['cids', 'jobs'])
  })

  it('devuelve lista vacía cuando no hay nada contratado', async () => {
    queryScoped.mockResolvedValue([])
    await expect(contractedModules('c-1')).resolves.toEqual([])
  })
})
