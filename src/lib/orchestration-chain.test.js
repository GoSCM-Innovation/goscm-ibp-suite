import { describe, it, expect } from 'vitest'
import { enOrden, esCadenaSimple } from './orchestration-chain.js'

const tarea = (id, extra = {}) => ({ id, type: 'task', data: {}, ...extra })
const arista = (desde, hasta) => ({ id: `e-${desde}-${hasta}`, source: desde, target: hasta })

describe('esCadenaSimple', () => {
  it('una cadena de tres pasos lo es', () => {
    expect(esCadenaSimple(
      [tarea('a'), tarea('b'), tarea('c')],
      [arista('a', 'b'), arista('b', 'c')],
    )).toBe(true)
  })

  it('pasos sueltos sin conexiones también', () => {
    expect(esCadenaSimple([tarea('a'), tarea('b')], [])).toBe(true)
  })

  it('sin pasos, también', () => {
    expect(esCadenaSimple([], [])).toBe(true)
  })

  // Una lista no puede representar dos ramas: mostrarla como lista mentiría sobre el orden.
  it('un grafo que se abre en dos NO lo es', () => {
    expect(esCadenaSimple(
      [tarea('a'), tarea('b'), tarea('c')],
      [arista('a', 'b'), arista('a', 'c')],
    )).toBe(false)
  })

  it('un grafo que junta dos ramas NO lo es', () => {
    expect(esCadenaSimple(
      [tarea('a'), tarea('b'), tarea('c')],
      [arista('a', 'c'), arista('b', 'c')],
    )).toBe(false)
  })

  it('con grupos NO lo es', () => {
    expect(esCadenaSimple([{ id: 'g', type: 'group', data: {} }], [])).toBe(false)
    expect(esCadenaSimple([tarea('a', { parentId: 'g' })], [])).toBe(false)
  })
})

describe('enOrden', () => {
  it('sigue la cadena desde el que no tiene nada antes', () => {
    const nodos = [tarea('c'), tarea('a'), tarea('b')]
    const orden = enOrden(nodos, [arista('a', 'b'), arista('b', 'c')])
    expect(orden.map((nodo) => nodo.id)).toEqual(['a', 'b', 'c'])
  })

  it('los pasos sueltos entran cada uno como su propia cadena', () => {
    const orden = enOrden([tarea('a'), tarea('b')], [])
    expect(orden.map((nodo) => nodo.id)).toEqual(['a', 'b'])
  })

  it('varias cadenas se listan una detrás de otra', () => {
    const orden = enOrden(
      [tarea('a'), tarea('b'), tarea('x'), tarea('y')],
      [arista('a', 'b'), arista('x', 'y')],
    )
    expect(orden.map((nodo) => nodo.id)).toEqual(['a', 'b', 'x', 'y'])
  })

  // Red de seguridad: un ciclo no debería llegar acá —el servidor lo rechaza al guardar— pero si
  // llegara, los pasos tienen que aparecer igual en vez de desaparecer de la pantalla.
  it('un ciclo no hace desaparecer pasos', () => {
    const orden = enOrden([tarea('a'), tarea('b')], [arista('a', 'b'), arista('b', 'a')])
    expect(orden).toHaveLength(2)
  })

  it('sin pasos devuelve una lista vacía', () => {
    expect(enOrden([], [])).toEqual([])
  })
})
