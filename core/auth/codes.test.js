import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createInMemoryRedis } from '../persistence/redis-in-memory.js'
import { MAX_VERIFICATION_ATTEMPTS, generateCode, requestCode, verifyCode } from './codes.js'
import { findUserForLogin } from './identity.js'
import { deliverCode } from './delivery.js'

const entorno = vi.hoisted(() => ({ ms: 1_700_000_000_000, redis: null }))

vi.mock('../persistence/redis.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getRedis: () => entorno.redis }
})

vi.mock('./identity.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, findUserForLogin: vi.fn() }
})

vi.mock('./delivery.js', () => ({ deliverCode: vi.fn() }))

const USUARIO = { id: 'u-1', clientId: 'c-1', email: 'Gerardo@Go-Scm.com', name: 'Gerardo', isAdmin: true }
const CORREO = 'gerardo@go-scm.com'
const SECRETO_ORIGINAL = process.env.SESSION_SECRET

beforeEach(() => {
  vi.clearAllMocks()
  entorno.ms = 1_700_000_000_000
  entorno.redis = createInMemoryRedis({ now: () => entorno.ms })
  process.env.SESSION_SECRET = 'secreto-de-prueba'
  findUserForLogin.mockResolvedValue(USUARIO)
})

afterEach(() => {
  if (SECRETO_ORIGINAL === undefined) delete process.env.SESSION_SECRET
  else process.env.SESSION_SECRET = SECRETO_ORIGINAL
})

/** El código solo existe dentro de la entrega: así se comprueba que nunca sale por otro lado. */
const codigoEntregado = () => deliverCode.mock.calls.at(-1)[0].code

describe('generateCode', () => {
  it('son seis dígitos', () => {
    for (let i = 0; i < 200; i += 1) expect(generateCode()).toMatch(/^\d{6}$/)
  })

  it('no se repite siempre el mismo', () => {
    const codigos = new Set(Array.from({ length: 100 }, () => generateCode()))
    expect(codigos.size).toBeGreaterThan(50)
  })
})

describe('requestCode', () => {
  it('entrega un código de seis dígitos al usuario', async () => {
    await expect(requestCode({ email: CORREO, ip: '1.2.3.4' })).resolves.toEqual({ delivered: true })
    expect(deliverCode).toHaveBeenCalledTimes(1)
    expect(codigoEntregado()).toMatch(/^\d{6}$/)
    expect(deliverCode.mock.calls[0][0].email).toBe(USUARIO.email)
  })

  it('nunca devuelve el código a quien lo pide', async () => {
    const resultado = await requestCode({ email: CORREO, ip: '1.2.3.4' })
    expect(JSON.stringify(resultado)).not.toContain(codigoEntregado())
  })

  it('no entrega nada si el correo no corresponde a un usuario que pueda entrar', async () => {
    findUserForLogin.mockResolvedValue(null)
    await expect(requestCode({ email: 'ajeno@ejemplo.com', ip: '1.2.3.4' }))
      .resolves.toEqual({ delivered: false, reason: expect.stringContaining('sin usuario activo') })
    expect(deliverCode).not.toHaveBeenCalled()
  })

  it('no deja el código en claro en Redis', async () => {
    await requestCode({ email: CORREO, ip: '1.2.3.4' })
    const guardado = JSON.stringify(await Promise.all(entorno.redis.keys().map((k) => entorno.redis.get(k))))
    expect(guardado).not.toContain(codigoEntregado())
  })

  it('pedir un código nuevo invalida el anterior', async () => {
    await requestCode({ email: CORREO, ip: '1.2.3.4' })
    const viejo = codigoEntregado()
    await requestCode({ email: CORREO, ip: '1.2.3.4' })

    await expect(verifyCode({ email: CORREO, code: viejo })).resolves.toMatchObject({ ok: false })
    await expect(verifyCode({ email: CORREO, code: codigoEntregado() })).resolves.toMatchObject({ ok: true })
  })

  it('el código caduca a los diez minutos', async () => {
    await requestCode({ email: CORREO, ip: '1.2.3.4' })
    const codigo = codigoEntregado()
    entorno.ms += 11 * 60 * 1000
    await expect(verifyCode({ email: CORREO, code: codigo }))
      .resolves.toMatchObject({ ok: false, reason: expect.stringContaining('no hay código vigente') })
  })
})

describe('límites de envío', () => {
  it('corta al sexto intento para el mismo correo', async () => {
    for (let i = 0; i < 5; i += 1) {
      await expect(requestCode({ email: CORREO, ip: `10.0.0.${i}` })).resolves.toEqual({ delivered: true })
    }
    await expect(requestCode({ email: CORREO, ip: '10.0.0.9' }))
      .resolves.toMatchObject({ delivered: false, reason: expect.stringContaining('para ese correo') })
  })

  it('corta por IP aunque los correos sean distintos', async () => {
    for (let i = 0; i < 20; i += 1) {
      findUserForLogin.mockResolvedValue({ ...USUARIO, id: `u-${i}`, email: `persona${i}@go-scm.com` })
      await requestCode({ email: `persona${i}@go-scm.com`, ip: '9.9.9.9' })
    }
    await expect(requestCode({ email: 'otro@go-scm.com', ip: '9.9.9.9' }))
      .resolves.toMatchObject({ delivered: false, reason: expect.stringContaining('esta IP') })
  })

  it('un correo que no existe no consume el cupo del correo', async () => {
    findUserForLogin.mockResolvedValue(null)
    for (let i = 0; i < 10; i += 1) await requestCode({ email: CORREO, ip: '1.2.3.4' })

    findUserForLogin.mockResolvedValue(USUARIO)
    await expect(requestCode({ email: CORREO, ip: '1.2.3.4' })).resolves.toEqual({ delivered: true })
  })

  it('una IPv6 no rompe la construcción de la clave', async () => {
    await expect(requestCode({ email: CORREO, ip: '2001:db8::ff00:42:8329' })).resolves.toEqual({ delivered: true })
  })
})

describe('verifyCode', () => {
  it('acepta el código correcto y dice de quién es', async () => {
    await requestCode({ email: CORREO, ip: '1.2.3.4' })
    await expect(verifyCode({ email: CORREO, code: codigoEntregado() }))
      .resolves.toEqual({ ok: true, userId: 'u-1', clientId: 'c-1' })
  })

  it('el código sirve una sola vez', async () => {
    await requestCode({ email: CORREO, ip: '1.2.3.4' })
    const codigo = codigoEntregado()
    await verifyCode({ email: CORREO, code: codigo })
    await expect(verifyCode({ email: CORREO, code: codigo })).resolves.toMatchObject({ ok: false })
  })

  it('rechaza un código equivocado', async () => {
    await requestCode({ email: CORREO, ip: '1.2.3.4' })
    const equivocado = String((Number(codigoEntregado()) + 1) % 1_000_000).padStart(6, '0')
    await expect(verifyCode({ email: CORREO, code: equivocado }))
      .resolves.toMatchObject({ ok: false, reason: 'código incorrecto' })
  })

  it('rechaza cuando no se pidió ningún código', async () => {
    await expect(verifyCode({ email: CORREO, code: '123456' }))
      .resolves.toMatchObject({ ok: false, reason: expect.stringContaining('no hay código vigente') })
  })

  it('quema el código tras agotar los intentos, aunque después llegue el correcto', async () => {
    await requestCode({ email: CORREO, ip: '1.2.3.4' })
    const codigo = codigoEntregado()

    for (let i = 0; i < MAX_VERIFICATION_ATTEMPTS; i += 1) {
      await verifyCode({ email: CORREO, code: '000000' })
    }

    await expect(verifyCode({ email: CORREO, code: codigo }))
      .resolves.toMatchObject({ ok: false, reason: 'demasiados intentos' })
    await expect(verifyCode({ email: CORREO, code: codigo }))
      .resolves.toMatchObject({ ok: false, reason: expect.stringContaining('no hay código vigente') })
  })

  it('el código de una persona no sirve para otra', async () => {
    await requestCode({ email: CORREO, ip: '1.2.3.4' })
    const codigo = codigoEntregado()

    findUserForLogin.mockResolvedValue({ ...USUARIO, id: 'u-2', email: 'otra@go-scm.com' })
    await requestCode({ email: 'otra@go-scm.com', ip: '1.2.3.4' })

    await expect(verifyCode({ email: 'otra@go-scm.com', code: codigo }))
      .resolves.toMatchObject({ ok: false, reason: 'código incorrecto' })
  })

  it('no distingue mayúsculas en el correo al validar', async () => {
    await requestCode({ email: CORREO, ip: '1.2.3.4' })
    await expect(verifyCode({ email: 'GERARDO@GO-SCM.COM', code: codigoEntregado() }))
      .resolves.toMatchObject({ ok: true })
  })
})
