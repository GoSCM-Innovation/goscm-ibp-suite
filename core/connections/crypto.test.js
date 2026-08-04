import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { decryptSecret, encryptSecret } from './crypto.js'

const CONTEXTO = { clientId: 'c-1', connectionId: 'conn-1', agreement: 'SAP_COM_0326' }
const CLAVE_ORIGINAL = process.env.CREDENTIALS_ENCRYPTION_KEY

beforeEach(() => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('hex')
})

afterEach(() => {
  if (CLAVE_ORIGINAL === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY
  else process.env.CREDENTIALS_ENCRYPTION_KEY = CLAVE_ORIGINAL
})

describe('encryptSecret', () => {
  it('el texto cifrado no contiene la contraseña', () => {
    const secreto = encryptSecret('Contraseña$SAP123', CONTEXTO)
    const todo = JSON.stringify(secreto)
    expect(todo).not.toContain('Contraseña$SAP123')
    expect(todo).not.toContain('SAP123')
  })

  it('cifrar dos veces lo mismo da resultados distintos', () => {
    // Si diera lo mismo, se podría saber que dos clientes usan la misma contraseña.
    const a = encryptSecret('igual', CONTEXTO)
    const b = encryptSecret('igual', CONTEXTO)
    expect(a.ciphertext).not.toBe(b.ciphertext)
    expect(a.iv).not.toBe(b.iv)
  })

  it('no cifra una contraseña vacía', () => {
    expect(() => encryptSecret('', CONTEXTO)).toThrow(/vacía/)
    expect(() => encryptSecret(null, CONTEXTO)).toThrow(/vacía/)
  })

  it('exige saber a qué fila pertenece el secreto', () => {
    expect(() => encryptSecret('x', { clientId: 'c-1' })).toThrow(/cliente, conexión y acuerdo/)
  })
})

describe('decryptSecret', () => {
  it('devuelve la contraseña original', () => {
    const secreto = encryptSecret('Contraseña con ñ y €', CONTEXTO)
    expect(decryptSecret(secreto, CONTEXTO)).toBe('Contraseña con ñ y €')
  })

  it('falla si alguien alteró el texto cifrado', () => {
    const secreto = encryptSecret('original', CONTEXTO)
    const alterado = Buffer.from(secreto.ciphertext, 'base64')
    alterado[0] ^= 0xff
    expect(() => decryptSecret({ ...secreto, ciphertext: alterado.toString('base64') }, CONTEXTO))
      .toThrow(/no se pudo descifrar/i)
  })

  it('falla con otra clave de cifrado', () => {
    const secreto = encryptSecret('original', CONTEXTO)
    process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('hex')
    expect(() => decryptSecret(secreto, CONTEXTO)).toThrow(/no se pudo descifrar/i)
  })

  it.each([
    ['otro cliente', { ...CONTEXTO, clientId: 'c-2' }],
    ['otra conexión', { ...CONTEXTO, connectionId: 'conn-2' }],
    ['otro acuerdo', { ...CONTEXTO, agreement: 'SAP_COM_0720' }],
  ])('un secreto copiado a %s no descifra', (_, otroContexto) => {
    // Sin esta atadura, quien pudiera escribir en la base reutilizaría secretos ajenos sin
    // llegar a conocerlos.
    const secreto = encryptSecret('original', CONTEXTO)
    expect(() => decryptSecret(secreto, otroContexto)).toThrow(/no se pudo descifrar/i)
  })

  it('el mensaje de error no revela nada del secreto ni de la clave', () => {
    const secreto = encryptSecret('SuperSecreta', CONTEXTO)
    try {
      decryptSecret(secreto, { ...CONTEXTO, clientId: 'otro' })
      throw new Error('debería haber fallado')
    } catch (error) {
      expect(error.message).not.toContain('SuperSecreta')
      expect(error.message).not.toContain(process.env.CREDENTIALS_ENCRYPTION_KEY)
    }
  })

  it('exige las tres partes', () => {
    expect(() => decryptSecret({ ciphertext: 'a', iv: 'b' }, CONTEXTO)).toThrow(/Faltan partes/)
  })
})

describe('la clave de cifrado', () => {
  it('sin clave, no se cifra ni se descifra', () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY
    expect(() => encryptSecret('x', CONTEXTO)).toThrow(/CREDENTIALS_ENCRYPTION_KEY/)
  })

  it('rechaza una clave del tamaño equivocado en vez de cifrar mal', () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = 'abcd'
    expect(() => encryptSecret('x', CONTEXTO)).toThrow(/32 bytes/)
  })
})
