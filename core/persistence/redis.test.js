import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getRedis, tenantKey, globalKey, resetRedisClient } from './redis.js'

const { RedisMock } = vi.hoisted(() => ({ RedisMock: vi.fn(function Redis() {}) }))

vi.mock('@upstash/redis', () => ({ Redis: RedisMock }))

const ENV_ORIGINAL = { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN }

beforeEach(() => {
  vi.clearAllMocks()
  resetRedisClient()
  process.env.KV_REST_API_URL = 'https://redis.example.upstash.io'
  process.env.KV_REST_API_TOKEN = 'token-de-prueba'
})

afterEach(() => {
  resetRedisClient()
  for (const [name, value] of [['KV_REST_API_URL', ENV_ORIGINAL.url], ['KV_REST_API_TOKEN', ENV_ORIGINAL.token]]) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

describe('getRedis', () => {
  it('revienta con un mensaje claro si faltan las variables', () => {
    delete process.env.KV_REST_API_TOKEN
    expect(() => getRedis()).toThrow(/KV_REST_API/)
    expect(RedisMock).not.toHaveBeenCalled()
  })

  it('acepta los nombres de la consola de Upstash cuando no están los del marketplace', () => {
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    process.env.UPSTASH_REDIS_REST_URL = 'https://directo.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token-directo'
    try {
      getRedis()
      expect(RedisMock).toHaveBeenCalledWith({
        url: 'https://directo.upstash.io',
        token: 'token-directo',
      })
    } finally {
      delete process.env.UPSTASH_REDIS_REST_URL
      delete process.env.UPSTASH_REDIS_REST_TOKEN
    }
  })

  it('crea el cliente una sola vez y lo reutiliza', () => {
    const primero = getRedis()
    const segundo = getRedis()
    expect(primero).toBe(segundo)
    expect(RedisMock).toHaveBeenCalledTimes(1)
    expect(RedisMock).toHaveBeenCalledWith({
      url: 'https://redis.example.upstash.io',
      token: 'token-de-prueba',
    })
  })
})

describe('tenantKey', () => {
  it('prefija la clave con el cliente', () => {
    expect(tenantKey('cli-1', 'session', 'abc')).toBe('c:cli-1:session:abc')
  })

  it('acepta una sola parte', () => {
    expect(tenantKey('cli-1', 'catalog')).toBe('c:cli-1:catalog')
  })

  it('rechaza dos puntos dentro de una parte — permitiría fabricar la clave de otro cliente', () => {
    expect(() => tenantKey('cli-1', 'session:otra')).toThrow(/":"/)
    expect(() => tenantKey('cli-1:cli-2', 'session')).toThrow(/":"/)
  })

  it.each([['', 'vacía'], [undefined, 'ausente'], [7, 'no textual']])(
    'rechaza una parte %s (%s)',
    (part) => {
      expect(() => tenantKey('cli-1', part)).toThrow(/cadenas no vacías/)
    },
  )

  it('rechaza un clientId vacío', () => {
    expect(() => tenantKey('', 'session')).toThrow(/cadenas no vacías/)
  })
})

describe('globalKey', () => {
  it('usa un espacio de nombres distinto del de los clientes', () => {
    expect(globalKey('cron', 'lock')).toBe('g:cron:lock')
    expect(globalKey('cron', 'lock').startsWith('c:')).toBe(false)
  })

  it('exige al menos una parte', () => {
    expect(() => globalKey()).toThrow(/al menos una parte/)
  })

  it('rechaza dos puntos dentro de una parte', () => {
    expect(() => globalKey('cron:lock')).toThrow(/":"/)
  })
})
