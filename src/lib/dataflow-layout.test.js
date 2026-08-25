import { describe, it, expect } from 'vitest'

import { SEPARACION, agruparCoordenadas, layoutDataflow } from './dataflow-layout.js'

describe('agruparCoordenadas', () => {
  it('cada valor lejano es su propio grupo, en orden', () => {
    expect([...agruparCoordenadas([300, 100, 200])]).toEqual([[100, 0], [200, 1], [300, 2]])
  })

  // Un desalineado de dibujo no es un nivel distinto del dataflow.
  it('junta los valores casi iguales', () => {
    expect([...agruparCoordenadas([100, 104, 500])]).toEqual([[100, 0], [104, 0], [500, 1]])
  })

  it('todos iguales dan un solo grupo', () => {
    expect([...agruparCoordenadas([50, 50, 50])]).toEqual([[50, 0]])
  })

  it('sin valores no hay grupos', () => {
    expect(agruparCoordenadas([]).size).toBe(0)
  })
})

describe('layoutDataflow', () => {
  it('respeta el orden del dibujo original, a distancia fija', () => {
    expect(layoutDataflow([
      { location: { x: 10, y: 20 } },
      { location: { x: 900, y: 20 } },
      { location: { x: 1800, y: 20 } },
    ])).toEqual([
      { x: 0, y: 0 },
      { x: SEPARACION.x, y: 0 },
      { x: SEPARACION.x * 2, y: 0 },
    ])
  })

  // Es lo que hace que el diagrama se lea igual venga de donde venga la escala del XMI.
  it('la escala del origen no cambia el resultado', () => {
    const pequeño = layoutDataflow([{ location: { x: 1, y: 1 } }, { location: { x: 4, y: 9 } }])
    const grande = layoutDataflow([{ location: { x: 1000, y: 1000 } }, { location: { x: 4000, y: 9000 } }])
    expect(pequeño).toEqual(grande)
  })

  it('dos nodos alineados quedan en la misma fila', () => {
    const posiciones = layoutDataflow([
      { location: { x: 0, y: 0 } },
      { location: { x: 500, y: 0 } },
      { location: { x: 500, y: 400 } },
    ])
    expect(posiciones[0].y).toBe(posiciones[1].y)
    expect(posiciones[2].y).toBe(SEPARACION.y)
  })

  it('los nodos sin coordenadas van en una columna al final', () => {
    expect(layoutDataflow([
      { location: { x: 0, y: 0 } },
      { location: null },
      { location: null },
    ])).toEqual([
      { x: 0, y: 0 },
      { x: SEPARACION.x, y: 0 },
      { x: SEPARACION.x, y: SEPARACION.y },
    ])
  })

  it('sin ninguna coordenada igual los apila', () => {
    expect(layoutDataflow([{ location: null }, { location: null }]))
      .toEqual([{ x: 0, y: 0 }, { x: 0, y: SEPARACION.y }])
  })

  it('sin nodos no devuelve nada', () => {
    expect(layoutDataflow([])).toEqual([])
  })
})
