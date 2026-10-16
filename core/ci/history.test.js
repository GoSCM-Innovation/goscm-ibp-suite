import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HUERFANA_MS,
  cerrarEjecucion,
  estadoMostrado,
  listarEjecuciones,
  obtenerEjecucion,
  registrarEjecucion,
  ultimasVariables,
} from './history.js'
import { queryOneScoped, queryScoped } from '../persistence/tenant-scope.js'

vi.mock('../persistence/tenant-scope.js', () => ({
  queryScoped: vi.fn(async () => []),
  queryOneScoped: vi.fn(async () => null),
}))
vi.mock('./integrations.js', async () => ({
  assertConexionCi: vi.fn(async () => ({ id: 'conn', kind: 'ci' })),
  esUuid: (valor) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(valor ?? '')),
}))

const CLIENTE = 'c-1'
const CONEXION = '11111111-1111-4111-8111-111111111111'
const INTEGRACION = '22222222-2222-4222-8222-222222222222'
const AHORA = Date.UTC(2026, 9, 14, 12, 0, 0)

const fila = (extra = {}) => ({
  id: 'r-1', integration_id: INTEGRACION, integration_name: 'FACTURAS', folder: 'A', orchestration_id: null,
  orchestration_name: null, origin: 'manual', user_email: 'a@x.com', status: 'success', http_status: 200,
  duration_ms: 21_430, mpl_id: null, message: 'OK', variables: { DESDE: '20261005' }, adjustments: [],
  started_at: new Date(AHORA - 60_000).toISOString(), finished_at: new Date(AHORA - 40_000).toISOString(), ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  queryScoped.mockResolvedValue([])
  queryOneScoped.mockResolvedValue(null)
})

describe('estadoMostrado', () => {
  it('lo cerrado se enseña como está', () => {
    expect(estadoMostrado(fila({ status: 'error', message: 'boom' }), AHORA)).toEqual({ status: 'error', message: 'boom' })
  })

  it('una ejecución reciente en marcha sigue en marcha', () => {
    const reciente = fila({ status: 'running', started_at: new Date(AHORA - 30_000).toISOString() })
    expect(estadoMostrado(reciente, AHORA).status).toBe('running')
  })

  // Una fila que se quedó «running» porque la función murió no puede decir «en curso» para siempre.
  it('una en marcha desde hace más de lo que dura una llamada se lee «sin confirmar»', () => {
    const vieja = fila({ status: 'running', started_at: new Date(AHORA - HUERFANA_MS - 1000).toISOString() })
    const { status, message } = estadoMostrado(vieja, AHORA)
    expect(status).toBe('unconfirmed')
    expect(message).toMatch(/antes de repetirla/)
  })

  it('el tiempo de espera es mayor que el de la función (300 s)', () => {
    expect(HUERFANA_MS).toBeGreaterThan(300_000)
  })
})

describe('registrarEjecucion', () => {
  const base = {
    id: 'r-1', connectionId: CONEXION, integracion: { id: INTEGRACION, name: 'FACTURAS', folder: 'A' },
    origin: 'manual', user: { id: 'u-1', email: 'a@x.com' }, variables: { DESDE: '1' },
  }

  it('nace «running» con el cliente en la fila', async () => {
    await registrarEjecucion(CLIENTE, base)
    const [, sql, params] = queryScoped.mock.calls[0]
    expect(sql).toMatch(/insert into ci_runs\s*\(id, client_id,/)
    expect(sql).toContain('null)')
    expect(params[1]).toBe(CLIENTE)
    expect(params).toContain('running')
    expect(params.at(-2)).toBe('{"DESDE":"1"}')
    // Sin ajustes, una lista vacía: las ejecuciones de siempre no cambian.
    expect(params.at(-1)).toBe('[]')
  })

  it('anota qué cambió una orquestación de la integración (sus ajustes), para que el historial lo diga', async () => {
    const cambios = [{ clave: 'version', etiqueta: 'Versión', de: 'PVSMD', a: 'PV2', fuente: 'orquestacion' }]
    await registrarEjecucion(CLIENTE, { ...base, ajustes: cambios })
    const [, sql, params] = queryScoped.mock.calls[0]
    expect(sql).toContain('adjustments')
    expect(JSON.parse(params.at(-1))).toEqual(cambios)
  })

  it('con resultado, nace ya cerrada', async () => {
    await registrarEjecucion(CLIENTE, {
      ...base, resultado: { resultado: 'error', httpStatus: null, duracionMs: 0, mplId: null, mensaje: 'falta una variable' },
    })
    const [, sql, params] = queryScoped.mock.calls[0]
    expect(sql).toContain('now())')
    expect(params).toContain('error')
    expect(params).toContain('falta una variable')
  })

  it('anota quién la lanzó, con su correo', async () => {
    await registrarEjecucion(CLIENTE, base)
    const params = queryScoped.mock.calls[0][2]
    expect(params).toContain('u-1')
    expect(params).toContain('a@x.com')
  })

  it('una ejecución sin usuario conocido se anota igual', async () => {
    await registrarEjecucion(CLIENTE, { ...base, user: null })
    expect(queryScoped).toHaveBeenCalledTimes(1)
  })
})

describe('cerrarEjecucion', () => {
  it('actualiza con el cliente puesto y redondea la duración', async () => {
    await cerrarEjecucion(CLIENTE, 'r-1', { resultado: 'success', httpStatus: 200, duracionMs: 21_430.6, mplId: null, mensaje: 'OK' })
    const [, sql, params] = queryScoped.mock.calls[0]
    expect(sql).toContain('client_id = $7')
    expect(params).toEqual(['success', 200, 21_431, null, 'OK', 'r-1', CLIENTE])
  })
})

describe('listarEjecuciones', () => {
  it('trae las de la conexión, filtrando por cliente, de la más reciente a la más antigua', async () => {
    queryScoped.mockResolvedValue([fila()])
    const [una] = await listarEjecuciones(CLIENTE, { connectionId: CONEXION }, AHORA)

    const [, sql, params] = queryScoped.mock.calls[0]
    expect(sql).toContain('r.client_id = $1')
    expect(sql).toContain('order by r.started_at desc')
    expect(params).toEqual([CLIENTE, CONEXION])
    expect(una).toMatchObject({
      id: 'r-1', integrationName: 'FACTURAS', status: 'success', httpStatus: 200, durationMs: 21_430, userEmail: 'a@x.com',
    })
  })

  it('puede limitarse a una integración', async () => {
    await listarEjecuciones(CLIENTE, { connectionId: CONEXION, integrationId: INTEGRACION })
    const [, sql, params] = queryScoped.mock.calls[0]
    expect(sql).toContain('r.integration_id = $3')
    expect(params).toEqual([CLIENTE, CONEXION, INTEGRACION])
  })

  it('una integración que no es un UUID no consulta', async () => {
    await expect(listarEjecuciones(CLIENTE, { connectionId: CONEXION, integrationId: 'x' })).resolves.toEqual([])
    expect(queryScoped).not.toHaveBeenCalled()
  })

  it.each([[0, 100], [-5, 1], [10_000, 500], ['abc', 100], [25, 25]])('el límite %j queda en %j', async (pedido, quedo) => {
    await listarEjecuciones(CLIENTE, { connectionId: CONEXION, limit: pedido })
    expect(queryScoped.mock.calls[0][1]).toContain(`limit ${quedo}`)
  })

  it('una en marcha vieja sale como «sin confirmar»', async () => {
    queryScoped.mockResolvedValue([fila({ status: 'running', started_at: new Date(AHORA - HUERFANA_MS - 5000).toISOString() })])
    const [una] = await listarEjecuciones(CLIENTE, { connectionId: CONEXION }, AHORA)
    expect(una.status).toBe('unconfirmed')
  })

  it('trae el nombre de la orquestación, uniendo por cliente', async () => {
    await listarEjecuciones(CLIENTE, { connectionId: CONEXION })
    expect(queryScoped.mock.calls[0][1]).toContain('o.client_id = r.client_id')
  })
})

describe('ultimasVariables', () => {
  it('reúne las de las últimas ejecuciones y lo más reciente manda', async () => {
    // Llegan de la más reciente a la más antigua.
    queryScoped.mockResolvedValue([
      { variables: { DESDE: '20261014' } },
      { variables: { DESDE: '20261005', HASTA: '20270412' } },
    ])
    await expect(ultimasVariables(CLIENTE, { integrationId: INTEGRACION })).resolves.toEqual({
      DESDE: '20261014', HASTA: '20270412',
    })
  })

  it('por orquestación mira las ejecuciones de la orquestación', async () => {
    await ultimasVariables(CLIENTE, { orchestrationId: INTEGRACION })
    expect(queryScoped.mock.calls[0][1]).toContain('orchestration_id = $2')
  })

  it('con el cliente puesto', async () => {
    await ultimasVariables(CLIENTE, { integrationId: INTEGRACION })
    const [, sql, params] = queryScoped.mock.calls[0]
    expect(sql).toContain('client_id = $1')
    expect(params[0]).toBe(CLIENTE)
  })

  it('un identificador que no es un UUID no consulta', async () => {
    await expect(ultimasVariables(CLIENTE, { integrationId: 'x' })).resolves.toEqual({})
    expect(queryScoped).not.toHaveBeenCalled()
  })
})

describe('obtenerEjecucion', () => {
  it('filtra por cliente y devuelve null si no existe', async () => {
    await expect(obtenerEjecucion(CLIENTE, INTEGRACION)).resolves.toBeNull()
    expect(queryOneScoped.mock.calls[0][1]).toContain('r.client_id = $2')
  })

  it('un identificador que no es un UUID no consulta', async () => {
    await expect(obtenerEjecucion(CLIENTE, 'x')).resolves.toBeNull()
    expect(queryOneScoped).not.toHaveBeenCalled()
  })
})
