import { describe, expect, it } from 'vitest'
import {
  agregarPaso,
  cambiarPaso,
  etapasDeGrafo,
  grafoDeEtapas,
  moverEtapa,
  moverPaso,
  nuevoIdDePaso,
  nuevoPaso,
  quitarPaso,
  totalDePasos,
} from './ci-etapas.js'
import { normalizeGraph } from '../../core/orchestrations/graph.js'

const paso = (id) => nuevoPaso({ id: `int-${id}`, name: `Integración ${id}` }, id)
const ids = (etapas) => etapas.map((etapa) => etapa.map((uno) => uno.id))

describe('nuevoPaso', () => {
  it('por omisión detiene si falla y no reintenta', () => {
    expect(paso('a')).toMatchObject({
      id: 'a',
      type: 'task',
      data: { label: 'Integración a', integrationId: 'int-a', errorStrategy: 'stop', maxRetries: 0, retryDelaySeconds: 60 },
    })
  })

  it('los identificadores son distintos', () => {
    expect(nuevoIdDePaso()).not.toBe(nuevoIdDePaso())
  })
})

describe('grafoDeEtapas', () => {
  it('una etapa sola no tiene conexiones', () => {
    const { nodes, edges } = grafoDeEtapas([[paso('a'), paso('b')]])
    expect(nodes).toHaveLength(2)
    expect(edges).toEqual([])
  })

  it('cada paso de una etapa se conecta con todos los de la siguiente', () => {
    const { edges } = grafoDeEtapas([[paso('a'), paso('b')], [paso('c')], [paso('d'), paso('e')]])
    expect(edges.map((e) => `${e.source}->${e.target}`)).toEqual(['a->c', 'b->c', 'c->d', 'c->e'])
  })

  it('pone una columna por etapa', () => {
    const { nodes } = grafoDeEtapas([[paso('a')], [paso('b'), paso('c')]])
    const por = Object.fromEntries(nodes.map((n) => [n.id, n.position]))
    expect(por.a.x).toBeLessThan(por.b.x)
    expect(por.b.x).toBe(por.c.x)
    expect(por.b.y).toBeLessThan(por.c.y)
  })

  it('un grafo armado así lo acepta el servidor, con los topes de CI', () => {
    const grafo = grafoDeEtapas([[paso('a')], [paso('b'), paso('c')]])
    expect(() => normalizeGraph(grafo, { kind: 'ci' })).not.toThrow()
  })

  it('sin etapas, un grafo vacío', () => {
    expect(grafoDeEtapas([])).toEqual({ nodes: [], edges: [] })
  })
})

describe('etapasDeGrafo', () => {
  it('es la inversa de grafoDeEtapas', () => {
    const original = [[paso('a')], [paso('b'), paso('c')], [paso('d')]]
    const { etapas, exacto } = etapasDeGrafo(grafoDeEtapas(original))
    expect(exacto).toBe(true)
    expect(ids(etapas)).toEqual([['a'], ['b', 'c'], ['d']])
  })

  it('sobrevive a pasar por el servidor (normalizeGraph)', () => {
    const guardado = normalizeGraph(grafoDeEtapas([[paso('a')], [paso('b'), paso('c')]]), { kind: 'ci' })
    const { etapas, exacto } = etapasDeGrafo(guardado)
    expect(exacto).toBe(true)
    expect(ids(etapas)).toEqual([['a'], ['b', 'c']])
    expect(etapas[1][0].data.integrationId).toBe('int-b')
  })

  it('un grafo vacío no tiene etapas y es exacto', () => {
    expect(etapasDeGrafo({ nodes: [], edges: [] })).toEqual({ etapas: [], exacto: true })
    expect(etapasDeGrafo()).toEqual({ etapas: [], exacto: true })
  })

  it('pasos sueltos sin conexiones son UNA etapa en paralelo', () => {
    const { etapas, exacto } = etapasDeGrafo({ nodes: [paso('a'), paso('b')], edges: [] })
    expect(ids(etapas)).toEqual([['a', 'b']])
    expect(exacto).toBe(true)
  })

  // Dos cadenas independientes no son etapas: A->B y C->D. Mostrarlas como etapas sería enseñar otra cosa.
  it('dos cadenas independientes no caben en etapas, y lo dice', () => {
    const { exacto } = etapasDeGrafo({
      nodes: [paso('a'), paso('b'), paso('c'), paso('d')],
      edges: [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'c', target: 'd' }],
    })
    expect(exacto).toBe(false)
  })

  it('un paso que espera a uno de dos etapas atrás no cabe, y lo dice', () => {
    const { exacto } = etapasDeGrafo({
      nodes: [paso('a'), paso('b'), paso('c')],
      edges: [
        { id: '1', source: 'a', target: 'b' },
        { id: '2', source: 'b', target: 'c' },
        { id: '3', source: 'a', target: 'c' },
      ],
    })
    expect(exacto).toBe(false)
  })

  it('un ciclo no se cuelga ni se da por exacto', () => {
    const { exacto } = etapasDeGrafo({
      nodes: [paso('a'), paso('b')],
      edges: [{ id: '1', source: 'a', target: 'b' }, { id: '2', source: 'b', target: 'a' }],
    })
    expect(exacto).toBe(false)
  })

  it('ignora los grupos y las conexiones que apuntan a nodos que no están', () => {
    const { etapas } = etapasDeGrafo({
      nodes: [paso('a'), { id: 'g', type: 'group', data: {} }],
      edges: [{ id: '1', source: 'a', target: 'fantasma' }],
    })
    expect(ids(etapas)).toEqual([['a']])
  })
})

describe('agregarPaso', () => {
  it('sin etapa elegida abre una al final', () => {
    expect(ids(agregarPaso([[paso('a')]], paso('b')))).toEqual([['a'], ['b']])
  })

  it('con una etapa elegida entra en paralelo con lo que haya', () => {
    expect(ids(agregarPaso([[paso('a')], [paso('b')]], paso('c'), 0))).toEqual([['a', 'c'], ['b']])
  })

  it('un índice fuera de rango abre una etapa nueva', () => {
    expect(ids(agregarPaso([[paso('a')]], paso('b'), 7))).toEqual([['a'], ['b']])
    expect(ids(agregarPaso([[paso('a')]], paso('b'), -1))).toEqual([['a'], ['b']])
  })

  it('en una lista vacía crea la primera', () => {
    expect(ids(agregarPaso([], paso('a')))).toEqual([['a']])
  })

  it('no modifica lo que recibe', () => {
    const original = [[paso('a')]]
    agregarPaso(original, paso('b'), 0)
    expect(ids(original)).toEqual([['a']])
  })
})

describe('quitarPaso', () => {
  it('quita el paso y, si su etapa queda vacía, la etapa desaparece', () => {
    expect(ids(quitarPaso([[paso('a')], [paso('b')], [paso('c')]], 'b'))).toEqual([['a'], ['c']])
  })

  it('en una etapa con varios solo se va el suyo', () => {
    expect(ids(quitarPaso([[paso('a'), paso('b')]], 'a'))).toEqual([['b']])
  })

  it('uno que no existe no cambia nada', () => {
    expect(ids(quitarPaso([[paso('a')]], 'x'))).toEqual([['a']])
  })
})

describe('cambiarPaso', () => {
  it('cambia solo lo que se manda y solo en ese paso', () => {
    const etapas = cambiarPaso([[paso('a'), paso('b')]], 'a', { errorStrategy: 'retry', maxRetries: 2 })
    expect(etapas[0][0].data).toMatchObject({ errorStrategy: 'retry', maxRetries: 2, label: 'Integración a' })
    expect(etapas[0][1].data.errorStrategy).toBe('stop')
  })
})

describe('moverPaso', () => {
  const base = () => [[paso('a')], [paso('b'), paso('c')], [paso('d')]]

  it('a otra etapa existente: entra en paralelo y la de origen, si queda vacía, desaparece', () => {
    expect(ids(moverPaso(base(), 'a', 1))).toEqual([['b', 'c', 'a'], ['d']])
  })

  it('a otra etapa existente, sin que la de origen quede vacía', () => {
    expect(ids(moverPaso(base(), 'b', 2))).toEqual([['a'], ['c'], ['d', 'b']])
  })

  it('a una etapa nueva al final', () => {
    expect(ids(moverPaso(base(), 'b', null))).toEqual([['a'], ['c'], ['d'], ['b']])
  })

  it('un índice fuera de rango también abre una etapa nueva, sin perder el paso', () => {
    const movidas = moverPaso(base(), 'c', 99)
    expect(ids(movidas)).toEqual([['a'], ['b'], ['d'], ['c']])
    expect(totalDePasos(movidas)).toBe(4)
  })

  it('a su propia etapa no cambia nada', () => {
    expect(ids(moverPaso(base(), 'b', 1))).toEqual([['a'], ['b', 'c'], ['d']])
  })

  it('un paso que no existe no cambia nada', () => {
    expect(ids(moverPaso(base(), 'x', 0))).toEqual([['a'], ['b', 'c'], ['d']])
  })

  it('nunca pierde ni duplica pasos', () => {
    for (const id of ['a', 'b', 'c', 'd']) {
      for (const destino of [null, 0, 1, 2, 3]) {
        const movidas = moverPaso(base(), id, destino)
        expect(ids(movidas).flat().sort(), `${id} -> ${destino}`).toEqual(['a', 'b', 'c', 'd'])
      }
    }
  })
})

describe('moverEtapa', () => {
  const base = () => [[paso('a')], [paso('b')], [paso('c')]]

  it('sube y baja una etapa', () => {
    expect(ids(moverEtapa(base(), 1, -1))).toEqual([['b'], ['a'], ['c']])
    expect(ids(moverEtapa(base(), 1, 1))).toEqual([['a'], ['c'], ['b']])
  })

  it('en los bordes no hace nada', () => {
    expect(ids(moverEtapa(base(), 0, -1))).toEqual([['a'], ['b'], ['c']])
    expect(ids(moverEtapa(base(), 2, 1))).toEqual([['a'], ['b'], ['c']])
  })

  it('un índice inválido no hace nada', () => {
    expect(ids(moverEtapa(base(), 9, 1))).toEqual([['a'], ['b'], ['c']])
  })
})

describe('totalDePasos', () => {
  it('cuenta todos', () => {
    expect(totalDePasos([[paso('a'), paso('b')], [paso('c')]])).toBe(3)
    expect(totalDePasos([])).toBe(0)
  })
})
