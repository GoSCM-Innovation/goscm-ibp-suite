import { describe, it, expect } from 'vitest'
import { bearerMatches, sameSecret } from './secrets.js'

const SECRETO = 'un-secreto-de-cron-bien-largo'

describe('sameSecret', () => {
  it('reconoce el mismo secreto', () => {
    expect(sameSecret(SECRETO, SECRETO)).toBe(true)
  })

  it('rechaza uno distinto de la misma longitud', () => {
    expect(sameSecret('abcdef', 'abcdeg')).toBe(false)
  })

  it('rechaza uno de otra longitud', () => {
    expect(sameSecret('abc', 'abcdef')).toBe(false)
  })

  // Sin secreto la puerta queda cerrada, no abierta.
  it('nada no es igual a nada', () => {
    expect(sameSecret(null, null)).toBe(false)
    expect(sameSecret(undefined, '')).toBe(false)
    expect(sameSecret('', '')).toBe(false)
  })

  it('no se deja engañar por un prefijo correcto', () => {
    expect(sameSecret('abc', 'abcdef')).toBe(false)
    expect(sameSecret('abcdef', 'abc')).toBe(false)
  })
})

describe('bearerMatches', () => {
  it('acepta la cabecera con el secreto correcto', () => {
    expect(bearerMatches(`Bearer ${SECRETO}`, SECRETO)).toBe(true)
  })

  it('rechaza el secreto equivocado', () => {
    expect(bearerMatches('Bearer otra-cosa-distinta-larga', SECRETO)).toBe(false)
  })

  // Un endpoint de reloj sin proteger lo puede llamar cualquiera.
  it('sin secreto configurado no deja pasar a nadie, ni con cabecera vacía', () => {
    expect(bearerMatches('Bearer ', '')).toBe(false)
    expect(bearerMatches('Bearer x', null)).toBe(false)
    expect(bearerMatches('', undefined)).toBe(false)
  })

  it('exige la palabra Bearer', () => {
    expect(bearerMatches(SECRETO, SECRETO)).toBe(false)
    expect(bearerMatches(`Basic ${SECRETO}`, SECRETO)).toBe(false)
  })

  it('sin cabecera, no pasa', () => {
    expect(bearerMatches(undefined, SECRETO)).toBe(false)
    expect(bearerMatches(null, SECRETO)).toBe(false)
  })

  it('distingue mayúsculas: "bearer" en minúscula no es la cabecera esperada', () => {
    expect(bearerMatches(`bearer ${SECRETO}`, SECRETO)).toBe(false)
  })
})
