import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createClient,
  createUser,
  deleteUser,
  listUsers,
  setClientStatus,
  setSubscription,
  setUserRoles,
  setUserStatus,
} from './accounts.js'
import { queryOne } from '../persistence/postgres.js'
import { queryOneScoped, queryScoped } from '../persistence/tenant-scope.js'
import { destroyUserSessions } from '../auth/sessions.js'

vi.mock('../persistence/postgres.js', () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
}))
vi.mock('../persistence/tenant-scope.js', () => ({
  queryScoped: vi.fn(async () => []),
  queryOneScoped: vi.fn(async () => null),
}))
vi.mock('../auth/sessions.js', () => ({ destroyUserSessions: vi.fn(async () => 0) }))

const CLIENTE = 'c-1'
const USUARIO = 'u-1'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createClient', () => {
  it('crea el cliente con el identificador en minúsculas', async () => {
    queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'nuevo' })
    await createClient({ name: '  Acme  ', slug: 'ACME' })
    expect(queryOne.mock.calls[1][1]).toEqual(['Acme', 'acme'])
  })

  it('no deja dos clientes con el mismo identificador', async () => {
    queryOne.mockResolvedValue({ id: 'ya-existe' })
    await expect(createClient({ name: 'Acme', slug: 'acme' })).rejects.toThrow(/Ya existe un cliente/)
  })

  it.each([['', /nombre/], [undefined, /nombre/]])('exige nombre (%s)', async (name, mensaje) => {
    await expect(createClient({ name, slug: 'acme' })).rejects.toThrow(mensaje)
  })

  it.each(['a', 'con espacio', 'MAYUS CULAS', 'símbolos!', 'x'.repeat(41)])(
    'rechaza el identificador "%s"',
    async (slug) => {
      await expect(createClient({ name: 'Acme', slug })).rejects.toThrow(/identificador del cliente/)
    },
  )
})

describe('setClientStatus', () => {
  it('suspender cierra las sesiones de toda la gente del cliente', async () => {
    queryOne.mockResolvedValue({ id: CLIENTE, status: 'suspended' })
    queryScoped.mockResolvedValue([{ id: 'u-1' }, { id: 'u-2' }])

    await setClientStatus(CLIENTE, 'suspended')

    expect(destroyUserSessions).toHaveBeenCalledTimes(2)
    expect(destroyUserSessions).toHaveBeenCalledWith('u-1')
  })

  it('reactivar no cierra sesiones de nadie', async () => {
    queryOne.mockResolvedValue({ id: CLIENTE, status: 'active' })
    await setClientStatus(CLIENTE, 'active')
    expect(destroyUserSessions).not.toHaveBeenCalled()
  })

  it('rechaza un estado que no existe', async () => {
    await expect(setClientStatus(CLIENTE, 'inventado')).rejects.toThrow(/Estado de cliente/)
  })

  it('avisa si el cliente no existe', async () => {
    queryOne.mockResolvedValue(null)
    await expect(setClientStatus(CLIENTE, 'active')).rejects.toThrow(/no existe/)
  })
})

describe('createUser', () => {
  it('rechaza un correo que no lo parece, sin tocar la base', async () => {
    await expect(createUser(CLIENTE, { email: 'esto-no-es' })).rejects.toThrow(/correo no es válido/)
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('no deja dos usuarios con el mismo correo en toda la plataforma', async () => {
    queryOne.mockResolvedValue({ client_id: 'otro-cliente' })
    await expect(createUser(CLIENTE, { email: 'a@b.com' })).rejects.toThrow(/Ya hay un usuario con ese correo/)
  })

  it('guarda el correo en minúsculas y con el cliente en la fila', async () => {
    queryOne.mockResolvedValue(null)
    queryOneScoped.mockResolvedValue({ id: USUARIO })
    await createUser(CLIENTE, { email: '  Persona@Empresa.COM ', name: 'Persona' })
    const [clientId, , params] = queryOneScoped.mock.calls[0]
    expect(clientId).toBe(CLIENTE)
    expect(params[0]).toBe(CLIENTE)
    expect(params[1]).toBe('persona@empresa.com')
  })

  it('nace sin rol de plataforma aunque se pida administrador', async () => {
    queryOne.mockResolvedValue(null)
    queryOneScoped.mockResolvedValue({ id: USUARIO })
    await createUser(CLIENTE, { email: 'a@b.com', isAdmin: true })
    const sql = queryOneScoped.mock.calls[0][1]
    // Se mira la lista de columnas que se insertan, no el resto de la sentencia: el rol sí
    // aparece en lo que se devuelve, y eso está bien.
    const columnas = sql.match(/insert into users \(([^)]*)\)/i)[1]
    expect(columnas).not.toContain('is_platform_admin')
    expect(columnas).toContain('is_admin')
  })
})

describe('listUsers', () => {
  it('consulta con el filtro de cliente puesto', async () => {
    await listUsers(CLIENTE)
    const [clientId, sql, params] = queryScoped.mock.calls[0]
    expect(clientId).toBe(CLIENTE)
    expect(sql).toContain('client_id = $1')
    expect(params).toEqual([CLIENTE])
  })
})

describe('setUserStatus', () => {
  it('dar de baja cierra sus sesiones al instante', async () => {
    queryOneScoped.mockResolvedValue({ id: USUARIO, status: 'disabled' })
    await setUserStatus(CLIENTE, USUARIO, 'disabled')
    expect(destroyUserSessions).toHaveBeenCalledWith(USUARIO)
  })

  it('reactivar no cierra nada', async () => {
    queryOneScoped.mockResolvedValue({ id: USUARIO, status: 'active' })
    await setUserStatus(CLIENTE, USUARIO, 'active')
    expect(destroyUserSessions).not.toHaveBeenCalled()
  })

  it('no toca a alguien de otro cliente', async () => {
    queryOneScoped.mockResolvedValue(null)
    await expect(setUserStatus(CLIENTE, USUARIO, 'disabled')).rejects.toThrow(/no existe para este cliente/)
  })
})

describe('setUserRoles', () => {
  it('cambiar permisos cierra las sesiones: si no, los antiguos seguirían vigentes', async () => {
    queryOneScoped
      .mockResolvedValueOnce({ id: USUARIO, is_admin: false, is_platform_admin: false })
      .mockResolvedValueOnce({ id: USUARIO, is_admin: true, is_platform_admin: false })

    await setUserRoles(CLIENTE, USUARIO, { isAdmin: true })

    expect(destroyUserSessions).toHaveBeenCalledWith(USUARIO)
  })

  it('lo que no se indica se queda como estaba', async () => {
    queryOneScoped
      .mockResolvedValueOnce({ id: USUARIO, is_admin: true, is_platform_admin: true })
      .mockResolvedValueOnce({ id: USUARIO })

    await setUserRoles(CLIENTE, USUARIO, { isAdmin: false })

    const [, , params] = queryOneScoped.mock.calls[1]
    expect(params[0]).toBe(false) // is_admin, el que se cambió
    expect(params[1]).toBe(true)  // is_platform_admin, intacto
  })

  it('nadie puede quitarse a sí mismo el rol de plataforma', async () => {
    queryOneScoped.mockResolvedValue({ id: USUARIO, is_admin: true, is_platform_admin: true })
    await expect(
      setUserRoles(CLIENTE, USUARIO, { isPlatformAdmin: false }, { actingUserId: USUARIO }),
    ).rejects.toThrow(/a ti mismo/)
  })

  it('no se puede quitar al último administrador de plataforma', async () => {
    queryOneScoped.mockResolvedValue({ id: USUARIO, is_admin: true, is_platform_admin: true })
    queryOne.mockResolvedValue({ n: 0 })
    await expect(
      setUserRoles(CLIENTE, USUARIO, { isPlatformAdmin: false }, { actingUserId: 'otro' }),
    ).rejects.toThrow(/último administrador/)
  })

  it('sí se puede quitar si queda otro', async () => {
    queryOneScoped
      .mockResolvedValueOnce({ id: USUARIO, is_admin: true, is_platform_admin: true })
      .mockResolvedValueOnce({ id: USUARIO, is_platform_admin: false })
    queryOne.mockResolvedValue({ n: 1 })
    await expect(
      setUserRoles(CLIENTE, USUARIO, { isPlatformAdmin: false }, { actingUserId: 'otro' }),
    ).resolves.toMatchObject({ isPlatformAdmin: false })
  })
})

describe('deleteUser', () => {
  it('nadie puede borrarse a sí mismo', async () => {
    await expect(deleteUser(CLIENTE, USUARIO, { actingUserId: USUARIO })).rejects.toThrow(/a ti mismo/)
    expect(queryOneScoped).not.toHaveBeenCalled()
  })

  it('devuelve false si el usuario no es de ese cliente', async () => {
    queryOneScoped.mockResolvedValue(null)
    await expect(deleteUser(CLIENTE, USUARIO)).resolves.toBe(false)
  })

  it('no borra al último administrador de plataforma', async () => {
    queryOneScoped.mockResolvedValue({ id: USUARIO, is_platform_admin: true })
    queryOne.mockResolvedValue({ n: 0 })
    await expect(deleteUser(CLIENTE, USUARIO)).rejects.toThrow(/último administrador/)
  })

  it('al borrar cierra sus sesiones', async () => {
    queryOneScoped.mockResolvedValue({ id: USUARIO, is_platform_admin: false })
    await expect(deleteUser(CLIENTE, USUARIO)).resolves.toBe(true)
    expect(destroyUserSessions).toHaveBeenCalledWith(USUARIO)
  })
})

describe('setSubscription', () => {
  it('activa un módulo del cliente', async () => {
    queryOneScoped.mockResolvedValue({ module: 'jobs', status: 'active' })
    await setSubscription(CLIENTE, 'jobs')
    const [clientId, sql, params] = queryOneScoped.mock.calls[0]
    expect(clientId).toBe(CLIENTE)
    expect(sql).toContain('on conflict (client_id, module) do update')
    expect(params).toEqual([CLIENTE, 'jobs', 'active', null, null])
  })

  it('rechaza un módulo que no se vende', async () => {
    await expect(setSubscription(CLIENTE, 'inventado')).rejects.toThrow(/Módulo desconocido/)
    expect(queryOneScoped).not.toHaveBeenCalled()
  })

  it('rechaza un estado que no existe', async () => {
    await expect(setSubscription(CLIENTE, 'jobs', { status: 'regalado' })).rejects.toThrow(/Estado de suscripción/)
  })

  it('rechaza una vigencia que termina antes de empezar', async () => {
    await expect(setSubscription(CLIENTE, 'jobs', { validFrom: '2026-12-01', validUntil: '2026-01-01' }))
      .rejects.toThrow(/anterior a la de inicio/)
  })

  it('acepta una vigencia con fechas', async () => {
    queryOneScoped.mockResolvedValue({ module: 'cids' })
    await setSubscription(CLIENTE, 'cids', { validFrom: '2026-01-01', validUntil: '2026-12-31' })
    expect(queryOneScoped.mock.calls[0][2]).toEqual([CLIENTE, 'cids', 'active', '2026-01-01', '2026-12-31'])
  })
})
