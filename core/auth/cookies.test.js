import { describe, it, expect } from 'vitest'
import {
  SESSION_COOKIE,
  expiredSessionCookie,
  isSecureRequest,
  readSessionCookie,
  sessionCookie,
} from './cookies.js'

describe('sessionCookie', () => {
  it('marca la cookie como httpOnly para que el JavaScript de la página no pueda leerla', () => {
    expect(sessionCookie('abc', { maxAge: 100, secure: false })).toContain('HttpOnly')
  })

  it('usa SameSite=Lax, no Strict', () => {
    expect(sessionCookie('abc', { maxAge: 100, secure: false })).toContain('SameSite=Lax')
  })

  it('añade Secure solo cuando la petición viene por https', () => {
    expect(sessionCookie('abc', { maxAge: 100, secure: true })).toContain('; Secure')
    expect(sessionCookie('abc', { maxAge: 100, secure: false })).not.toContain('Secure')
  })

  it('escapa el identificador', () => {
    expect(sessionCookie('a b;c', { maxAge: 100, secure: false })).toContain(`${SESSION_COOKIE}=a%20b%3Bc`)
  })
})

describe('expiredSessionCookie', () => {
  it('vence de inmediato y deja el valor vacío', () => {
    const cookie = expiredSessionCookie({ secure: false })
    expect(cookie).toContain(`${SESSION_COOKIE}=;`)
    expect(cookie).toContain('Max-Age=0')
  })
})

describe('readSessionCookie', () => {
  it('encuentra la cookie entre varias', () => {
    expect(readSessionCookie(`tema=oscuro; ${SESSION_COOKIE}=xyz; otra=1`)).toBe('xyz')
  })

  it('descodifica el valor', () => {
    expect(readSessionCookie(`${SESSION_COOKIE}=a%20b`)).toBe('a b')
  })

  it('no confunde una cookie con nombre parecido', () => {
    expect(readSessionCookie(`${SESSION_COOKIE}_otra=xyz`)).toBeNull()
  })

  it.each([undefined, '', 'sin_igual', 'otra=1'])('devuelve null con %s', (header) => {
    expect(readSessionCookie(header)).toBeNull()
  })

  it('devuelve null si la cookie está vacía', () => {
    expect(readSessionCookie(`${SESSION_COOKIE}=`)).toBeNull()
  })
})

describe('isSecureRequest', () => {
  it('detecta https por la cabecera del proxy', () => {
    expect(isSecureRequest({ headers: { 'x-forwarded-proto': 'https' } })).toBe(true)
  })

  it('toma el primer protocolo cuando la cabecera trae varios', () => {
    expect(isSecureRequest({ headers: { 'x-forwarded-proto': 'https,http' } })).toBe(true)
    expect(isSecureRequest({ headers: { 'x-forwarded-proto': 'http,https' } })).toBe(false)
  })

  it('cae al socket cuando no hay cabecera', () => {
    expect(isSecureRequest({ headers: {}, socket: { encrypted: true } })).toBe(true)
    expect(isSecureRequest({ headers: {} })).toBe(false)
  })
})
