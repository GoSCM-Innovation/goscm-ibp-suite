import { describe, it, expect } from 'vitest'

import { SEPARACION, layoutChainGraph, nivelesPorDependencia } from './chain-layout.js'

describe('nivelesPorDependencia', () => {
  it('lo que no depende de nadie va en la primera columna', () => {
    expect([...nivelesPorDependencia([0, 1], [])]).toEqual([[0, 0], [1, 0]])
  })

  it('una cadena avanza una columna por paso', () => {
    const niveles = nivelesPorDependencia([0, 1, 2], [{ from: 0, to: 1 }, { from: 1, to: 2 }])
    expect([...niveles]).toEqual([[0, 0], [1, 1], [2, 2]])
  })

  // Si se tomara el primer predecesor y no el último, el nodo quedaría a la izquierda de algo que
  // todavía no corrió.
  it('un nodo se coloca detrás del último que lo alimenta', () => {
    const niveles = nivelesPorDependencia([0, 1, 2], [{ from: 0, to: 1 }, { from: 0, to: 2 }, { from: 1, to: 2 }])
    expect(niveles.get(2)).toBe(2)
  })

  it('el orden en el que vienen las aristas no cambia el resultado', () => {
    const derecho = nivelesPorDependencia([0, 1, 2], [{ from: 0, to: 1 }, { from: 1, to: 2 }])
    const alReves = nivelesPorDependencia([0, 1, 2], [{ from: 1, to: 2 }, { from: 0, to: 1 }])
    expect([...derecho]).toEqual([...alReves])
  })

  // Dos integraciones pueden alimentarse mutuamente por vías distintas; esconderlas sería peor.
  it('un ciclo no cuelga y sus nodos quedan al principio', () => {
    const niveles = nivelesPorDependencia([0, 1], [{ from: 0, to: 1 }, { from: 1, to: 0 }])
    expect(niveles.size).toBe(2)
  })

  it('una arista hacia un nodo que no está se ignora', () => {
    expect(nivelesPorDependencia([0], [{ from: 9, to: 0 }]).get(0)).toBe(0)
  })
})

describe('layoutChainGraph', () => {
  it('reparte en columnas por nivel y en filas por orden de llegada', () => {
    const posiciones = layoutChainGraph([0, 1, 2], [{ from: 0, to: 2 }])
    expect(posiciones.get(0)).toEqual({ x: 0, y: 0 })
    expect(posiciones.get(1)).toEqual({ x: 0, y: SEPARACION.y })
    expect(posiciones.get(2)).toEqual({ x: SEPARACION.x, y: 0 })
  })

  it('sin nodos no devuelve posiciones', () => {
    expect(layoutChainGraph([], []).size).toBe(0)
  })
})
