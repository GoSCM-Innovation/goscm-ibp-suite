import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryRedis } from '../persistence/redis-in-memory.js'
import {
  SESSION_TTL_SECONDS,
  createSession,
  destroySession,
  destroyUserSessions,
  generateSessionId,
  readSession,
} from './sessions.js'

const reloj = vi.hoisted(() => ({ ms: 1_700_000_000_000, redis: null }))

vi.mock('../persistence/redis.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getRedis: () => reloj.redis }
})

const USUARIO = { userId: 'u-1', clientId: 'c-1', isAdmin: false, email: 'a@b.com', name: 'Ana' }

beforeEach(() => {
  reloj.ms = 1_700_000_000_000
  reloj.redis = createInMemoryRedis({ now: () => reloj.ms })
})

const avanzarHoras = (horas) => { reloj.ms += horas * 60 * 60 * 1000 }

describe('generateSessionId', () => {
  it('devuelve identificadores largos y distintos entre sí', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateSessionId()))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(id.length).toBeGreaterThanOrEqual(43)
  })
})

describe('createSession y readSession', () => {
  it('guarda y devuelve los datos de la sesión', async () => {
    const id = await createSession(USUARIO)
    await expect(readSession(id)).resolves.toMatchObject({
      id,
      userId: 'u-1',
      clientId: 'c-1',
      isAdmin: false,
      email: 'a@b.com',
      name: 'Ana',
    })
  })

  it('nace con la duración de una jornada laboral', async () => {
    const id = await createSession(USUARIO)
    const restante = await reloj.redis.ttl(`g:session:${id}`)
    expect(restante).toBe(SESSION_TTL_SECONDS)
  })

  it('vence sola al pasar la jornada', async () => {
    const id = await createSession(USUARIO)
    avanzarHoras(13)
    await expect(readSession(id)).resolves.toBeNull()
  })

  it.each([undefined, '', null, 'inventado'])('devuelve null con el identificador %s', async (id) => {
    await expect(readSession(id)).resolves.toBeNull()
  })
})

describe('renovación por uso', () => {
  it('no renueva mientras queda más de la mitad del tiempo', async () => {
    const id = await createSession(USUARIO)
    avanzarHoras(2)
    await readSession(id)
    expect(await reloj.redis.ttl(`g:session:${id}`)).toBe(SESSION_TTL_SECONDS - 2 * 3600)
  })

  it('renueva cuando ya se consumió más de la mitad', async () => {
    const id = await createSession(USUARIO)
    avanzarHoras(7)
    await readSession(id)
    expect(await reloj.redis.ttl(`g:session:${id}`)).toBe(SESSION_TTL_SECONDS)
  })

  it('trabajando toda la jornada la sesión no se cae', async () => {
    const id = await createSession(USUARIO)
    for (let hora = 0; hora < 20; hora += 1) {
      avanzarHoras(1)
      await expect(readSession(id)).resolves.not.toBeNull()
    }
  })
})

describe('cierre de sesión', () => {
  it('destroySession la invalida', async () => {
    const id = await createSession(USUARIO)
    await destroySession(id)
    await expect(readSession(id)).resolves.toBeNull()
  })

  it('destroySession no revienta con un identificador que no existe', async () => {
    await expect(destroySession('inventado')).resolves.toBeUndefined()
  })

  it('destroyUserSessions cierra TODAS las sesiones abiertas de esa persona', async () => {
    const escritorio = await createSession(USUARIO)
    const portatil = await createSession(USUARIO)
    const ajena = await createSession({ ...USUARIO, userId: 'u-2' })

    const cerradas = await destroyUserSessions('u-1')

    expect(cerradas).toBe(2)
    await expect(readSession(escritorio)).resolves.toBeNull()
    await expect(readSession(portatil)).resolves.toBeNull()
    await expect(readSession(ajena)).resolves.not.toBeNull()
  })

  it('una sesión cerrada individualmente ya no cuenta en el índice del usuario', async () => {
    const primera = await createSession(USUARIO)
    await createSession(USUARIO)
    await destroySession(primera)
    await expect(destroyUserSessions('u-1')).resolves.toBe(1)
  })
})
