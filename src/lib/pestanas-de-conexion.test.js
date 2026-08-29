// @vitest-environment jsdom
//
// La tira de pestañas de conexiones se guarda entre sesiones, así que estas pruebas necesitan un
// navegador de mentira. El resto del módulo es puro.

import { beforeEach, describe, expect, it } from 'vitest'

import { abrir, abrirLasGuardadas, cerrar, guardarAbiertas } from './pestanas-de-conexion.js'

const CONEXIONES = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

beforeEach(() => { localStorage.clear() })

describe('abrirLasGuardadas', () => {
  it('devuelve lo guardado la última vez', () => {
    guardarAbiertas('ibp', ['b', 'c'])
    expect(abrirLasGuardadas('ibp', CONEXIONES)).toEqual(['b', 'c'])
  })

  it('descarta las conexiones que ya no existen', () => {
    // Una conexión borrada dejaría una pestaña que no puede pintar nada.
    guardarAbiertas('ibp', ['b', 'borrada'])
    expect(abrirLasGuardadas('ibp', CONEXIONES)).toEqual(['b'])
  })

  it('sin nada guardado abre la primera, para no dejar el módulo en blanco', () => {
    expect(abrirLasGuardadas('ibp', CONEXIONES)).toEqual(['a'])
  })

  it('sin conexiones no abre ninguna', () => {
    expect(abrirLasGuardadas('ibp', [])).toEqual([])
  })

  it('con basura guardada no revienta', () => {
    localStorage.setItem('pestanas_ibp', '{roto')
    expect(abrirLasGuardadas('ibp', CONEXIONES)).toEqual(['a'])
  })

  it('cada módulo tiene su propia lista', () => {
    // Las conexiones de IBP y las de CI-DS son listas distintas.
    guardarAbiertas('ibp', ['b'])
    guardarAbiertas('cids', ['c'])
    expect(abrirLasGuardadas('ibp', CONEXIONES)).toEqual(['b'])
    expect(abrirLasGuardadas('cids', CONEXIONES)).toEqual(['c'])
  })
})

describe('abrir', () => {
  it('agrega la que no estaba, al final', () => {
    expect(abrir(['a'], 'b')).toEqual(['a', 'b'])
  })

  it('una que ya estaba no se duplica', () => {
    const antes = ['a', 'b']
    expect(abrir(antes, 'a')).toBe(antes)
  })
})

describe('cerrar', () => {
  it('quita la pestaña de la lista', () => {
    expect(cerrar(['a', 'b', 'c'], 'a', 'b')).toEqual({ abiertas: ['a', 'c'], activa: 'a' })
  })

  it('al cerrar la activa pasa a la ANTERIOR, que es de donde se venía', () => {
    expect(cerrar(['a', 'b', 'c'], 'c', 'c')).toEqual({ abiertas: ['a', 'b'], activa: 'b' })
  })

  it('al cerrar la primera siendo la activa pasa a la que queda primera', () => {
    expect(cerrar(['a', 'b'], 'a', 'a')).toEqual({ abiertas: ['b'], activa: 'b' })
  })

  it('la última pestaña NO se cierra: un módulo sin ninguna no enseña nada', () => {
    expect(cerrar(['a'], 'a', 'a')).toEqual({ abiertas: ['a'], activa: 'a' })
  })
})
