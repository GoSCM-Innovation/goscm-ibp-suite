import { describe, expect, it } from 'vitest'
import { normalizeGraph } from '../../core/orchestrations/graph.js'
import {
  agregarAGrupo,
  agregarGrupo,
  agregarPaso,
  cambiarHijo,
  cambiarPaso,
  esDeLaMismaVersion,
  etapasDeGrafo,
  grafoDePasos,
  grupoNuevo,
  idsDeEjecucion,
  idsDeNodos,
  moverHijo,
  moverPaso,
  nuevoIdDePaso,
  pasoDeIntegracion,
  pasosDeGrafo,
  quitarHijo,
  quitarPaso,
  reordenar,
  totalDeIntegraciones,
} from './ci-pasos.js'

const paso = (id, extra = {}) => ({ ...pasoDeIntegracion({ id: `int-${id}`, name: `Integración ${id}` }, id), ...extra })
const grupo = (id, hijos = [], extra = {}) => ({ ...grupoNuevo(id), children: hijos, ...extra })
const ids = (lista) => lista.map((una) => una.id)
const aristas = (grafo) => grafo.edges.map((e) => `${e.source}->${e.target}`)

/** Un grafo como lo dejaba el editor de etapas: sin grupos, cada paso de una etapa conectado con todos los de la siguiente. */
function grafoDeEtapas(etapas) {
  const nodes = etapas.flat().map((una) => ({ id: una.id, type: 'task', data: { label: una.label, integrationId: una.integrationId, errorStrategy: una.errorStrategy, maxRetries: una.maxRetries, retryDelaySeconds: una.retryDelaySeconds } }))
  const edges = []
  etapas.forEach((etapa, i) => {
    if (i === 0) return
    for (const antes of etapas[i - 1]) for (const despues of etapa) edges.push({ id: `e-${antes.id}-${despues.id}`, source: antes.id, target: despues.id })
  })
  return { nodes, edges }
}

describe('pasoDeIntegracion y grupoNuevo', () => {
  it('un paso por omisión detiene si falla y no reintenta', () => {
    expect(paso('a')).toMatchObject({
      id: 'a', type: 'task', integrationId: 'int-a', label: 'Integración a', errorStrategy: 'stop', maxRetries: 0, retryDelaySeconds: 60,
    })
  })

  it('un grupo nace vacío, sin descripción y deteniendo si falla', () => {
    expect(grupoNuevo('g')).toMatchObject({ id: 'g', type: 'group', label: '', errorStrategy: 'stop', children: [] })
  })

  it('los identificadores son distintos', () => {
    expect(nuevoIdDePaso()).not.toBe(nuevoIdDePaso())
    expect(pasoDeIntegracion({ id: 'x', name: 'X' }).id).not.toBe(pasoDeIntegracion({ id: 'x', name: 'X' }).id)
  })
})

describe('grafoDePasos', () => {
  it('encadena los pasos de primer nivel', () => {
    const grafo = grafoDePasos([paso('a'), paso('b'), paso('c')])
    expect(grafo.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(aristas(grafo)).toEqual(['a->b', 'b->c'])
  })

  it('un grupo es un nodo y sus integraciones cuelgan de él, sin conexiones entre ellas', () => {
    const grafo = grafoDePasos([paso('a'), grupo('g', [paso('b'), paso('c')]), paso('d')])
    expect(aristas(grafo)).toEqual(['a->g', 'g->d'])
    const porId = Object.fromEntries(grafo.nodes.map((n) => [n.id, n]))
    expect(porId.g.type).toBe('group')
    expect(porId.b.parentId).toBe('g')
    expect(porId.c.parentId).toBe('g')
    expect(porId.a.parentId).toBeUndefined()
  })

  it('lleva lo que el motor lee de cada paso', () => {
    const grafo = grafoDePasos([paso('a', { errorStrategy: 'retry', maxRetries: 2, retryDelaySeconds: 30 })])
    expect(grafo.nodes[0].data).toEqual({
      label: 'Integración a', integrationId: 'int-a', errorStrategy: 'retry', maxRetries: 2, retryDelaySeconds: 30,
    })
  })

  it('una lista vacía es un grafo vacío, y un solo paso no tiene conexiones', () => {
    expect(grafoDePasos([])).toEqual({ nodes: [], edges: [] })
    expect(aristas(grafoDePasos([paso('a')]))).toEqual([])
  })

  it('lo acepta el servidor, con los topes de CI', () => {
    const grafo = grafoDePasos([paso('a'), grupo('g', [paso('b'), paso('c')]), paso('d')])
    expect(() => normalizeGraph(grafo, { kind: 'ci' })).not.toThrow()
  })

  it('un grupo vacío también se puede guardar', () => {
    expect(() => normalizeGraph(grafoDePasos([paso('a'), grupo('g')]), { kind: 'ci' })).not.toThrow()
  })
})

describe('pasosDeGrafo: lo que se guarda aquí', () => {
  const lista = () => [paso('a'), grupo('g', [paso('b'), paso('c', { errorStrategy: 'continue' })], { label: 'Cifras' }), paso('d', { errorStrategy: 'retry', maxRetries: 2 })]

  it('es la inversa de grafoDePasos', () => {
    const { pasos, exacto } = pasosDeGrafo(grafoDePasos(lista()))
    expect(exacto).toBe(true)
    expect(pasos).toEqual(lista())
  })

  it('sobrevive a pasar por el servidor (normalizeGraph)', () => {
    const guardado = normalizeGraph(grafoDePasos(lista()), { kind: 'ci' })
    const { pasos, exacto } = pasosDeGrafo(guardado)
    expect(exacto).toBe(true)
    expect(ids(pasos)).toEqual(['a', 'g', 'd'])
    expect(ids(pasos[1].children)).toEqual(['b', 'c'])
    expect(pasos[1]).toMatchObject({ label: 'Cifras', errorStrategy: 'stop' })
    expect(pasos[2]).toMatchObject({ errorStrategy: 'retry', maxRetries: 2 })
  })

  it('un grafo vacío es una lista vacía y exacta', () => {
    expect(pasosDeGrafo({ nodes: [], edges: [] })).toEqual({ pasos: [], exacto: true })
    expect(pasosDeGrafo()).toEqual({ pasos: [], exacto: true })
  })

  it('un grupo con «reintentar» se enseña como «detener»: el motor no reintenta un grupo', () => {
    const grafo = grafoDePasos([grupo('g', [paso('b')], { errorStrategy: 'retry', maxRetries: 2 })])
    expect(pasosDeGrafo(grafo).pasos[0].errorStrategy).toBe('stop')
  })

  it('una estrategia que no se conoce es «detener»', () => {
    const grafo = grafoDePasos([paso('a')])
    grafo.nodes[0].data.errorStrategy = 'otra'
    expect(pasosDeGrafo(grafo).pasos[0].errorStrategy).toBe('stop')
  })

  // Un grafo dibujado de otra forma no es una lista: se enseña en su orden de ejecución y se dice que no es exacto.
  it('dos cadenas independientes con grupos no son una lista, y lo dice', () => {
    const grafo = {
      nodes: [
        { id: 'g', type: 'group', data: {} },
        { id: 'h', type: 'group', data: {} },
        { id: 'a', type: 'task', parentId: 'g', data: { integrationId: 'int-a' } },
        { id: 'b', type: 'task', parentId: 'h', data: { integrationId: 'int-b' } },
      ],
      edges: [],
    }
    const { pasos, exacto } = pasosDeGrafo(grafo)
    expect(exacto).toBe(false)
    expect(ids(pasos)).toEqual(['g', 'h'])
    expect(ids(pasos[0].children)).toEqual(['a'])
  })

  it('un grupo dentro de un grupo no es una lista', () => {
    const grafo = {
      nodes: [
        { id: 'g', type: 'group', data: {} },
        { id: 'h', type: 'group', parentId: 'g', data: {} },
      ],
      edges: [],
    }
    expect(pasosDeGrafo(grafo).exacto).toBe(false)
  })
})

describe('pasosDeGrafo: orquestaciones hechas con el editor de etapas', () => {
  it('una etapa con una integración es un paso', () => {
    const { pasos, exacto } = pasosDeGrafo(grafoDeEtapas([[paso('a')], [paso('b')], [paso('c')]]))
    expect(exacto).toBe(true)
    expect(ids(pasos)).toEqual(['a', 'b', 'c'])
    expect(pasos.every((una) => una.type === 'task')).toBe(true)
  })

  it('una etapa con varias es un grupo paralelo, con las mismas integraciones y en el mismo orden', () => {
    const { pasos, exacto } = pasosDeGrafo(grafoDeEtapas([[paso('a')], [paso('b'), paso('c')], [paso('d')]]))
    expect(exacto).toBe(true)
    expect(ids(pasos)).toEqual(['a', 'g-b', 'd'])
    expect(pasos[1]).toMatchObject({ type: 'group', label: '' })
    expect(ids(pasos[1].children)).toEqual(['b', 'c'])
  })

  it('el grupo se llama igual cada vez que se lee', () => {
    const grafo = grafoDeEtapas([[paso('b'), paso('c')]])
    expect(pasosDeGrafo(grafo).pasos[0].id).toBe(pasosDeGrafo(grafo).pasos[0].id)
  })

  it('el grupo sigue de largo solo si todas las de la etapa seguían', () => {
    const todas = pasosDeGrafo(grafoDeEtapas([[paso('b', { errorStrategy: 'continue' }), paso('c', { errorStrategy: 'continue' })]])).pasos[0]
    const mezcla = pasosDeGrafo(grafoDeEtapas([[paso('b', { errorStrategy: 'continue' }), paso('c')]])).pasos[0]
    expect(todas.errorStrategy).toBe('continue')
    expect(mezcla.errorStrategy).toBe('stop')
  })

  it('al guardarlo como lista, lo que se ejecuta es lo mismo: cada etapa espera a la anterior', () => {
    const { pasos } = pasosDeGrafo(grafoDeEtapas([[paso('a')], [paso('b'), paso('c')], [paso('d')]]))
    const grafo = grafoDePasos(pasos)
    expect(aristas(grafo)).toEqual(['a->g-b', 'g-b->d'])
    expect(grafo.nodes.filter((n) => n.parentId === 'g-b').map((n) => n.id)).toEqual(['b', 'c'])
  })

  it('pasos sueltos sin conexiones son UN grupo en paralelo', () => {
    const { pasos, exacto } = pasosDeGrafo({ nodes: grafoDeEtapas([[paso('a'), paso('b')]]).nodes, edges: [] })
    expect(exacto).toBe(true)
    expect(pasos).toHaveLength(1)
    expect(pasos[0].type).toBe('group')
  })

  // Dos cadenas independientes no son etapas: A->B y C->D. Enseñarlas como una lista sería enseñar otra cosa.
  it('dos cadenas independientes no caben, y lo dice', () => {
    const { pasos, exacto } = pasosDeGrafo({
      nodes: ['a', 'b', 'c', 'd'].map((id) => grafoDeEtapas([[paso(id)]]).nodes[0]),
      edges: [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'c', target: 'd' }],
    })
    expect(exacto).toBe(false)
    expect(ids(pasos).sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('etapasDeGrafo', () => {
  it('un paso que espera a uno de dos etapas atrás no cabe, y lo dice', () => {
    const { exacto } = etapasDeGrafo({
      nodes: [paso('a'), paso('b'), paso('c')].map((una) => ({ id: una.id, type: 'task', data: {} })),
      edges: [{ id: '1', source: 'a', target: 'b' }, { id: '2', source: 'b', target: 'c' }, { id: '3', source: 'a', target: 'c' }],
    })
    expect(exacto).toBe(false)
  })

  it('un ciclo no se cuelga ni se da por exacto', () => {
    const { exacto } = etapasDeGrafo({
      nodes: [{ id: 'a', type: 'task', data: {} }, { id: 'b', type: 'task', data: {} }],
      edges: [{ id: '1', source: 'a', target: 'b' }, { id: '2', source: 'b', target: 'a' }],
    })
    expect(exacto).toBe(false)
  })

  it('ignora los grupos y las conexiones que apuntan a nodos que no están', () => {
    const { etapas } = etapasDeGrafo({
      nodes: [{ id: 'a', type: 'task', data: {} }, { id: 'g', type: 'group', data: {} }],
      edges: [{ id: '1', source: 'a', target: 'fantasma' }],
    })
    expect(etapas.map((etapa) => etapa.map((n) => n.id))).toEqual([['a']])
  })
})

describe('cambios sobre la lista', () => {
  it('agregarPaso y agregarGrupo suman al final y no tocan lo que reciben', () => {
    const original = [paso('a')]
    expect(ids(agregarPaso(original, paso('b')))).toEqual(['a', 'b'])
    expect(agregarGrupo(original, grupo('g')).at(-1).type).toBe('group')
    expect(ids(original)).toEqual(['a'])
  })

  it('agregarAGrupo mete la integración en ese grupo y en ningún otro', () => {
    const lista = agregarAGrupo([grupo('g1'), grupo('g2')], 'g2', paso('x'))
    expect(lista[0].children).toEqual([])
    expect(ids(lista[1].children)).toEqual(['x'])
  })

  it('agregarAGrupo con un grupo que no existe, o con un paso que no es un grupo, no cambia nada', () => {
    const base = [paso('a')]
    expect(agregarAGrupo(base, 'fantasma', paso('x'))).toEqual(base)
    expect(agregarAGrupo(base, 'a', paso('x'))).toEqual(base)
  })

  it('quitarPaso saca un paso o un grupo entero', () => {
    expect(ids(quitarPaso([paso('a'), grupo('g', [paso('b')]), paso('c')], 'g'))).toEqual(['a', 'c'])
    expect(ids(quitarPaso([paso('a')], 'x'))).toEqual(['a'])
  })

  it('cambiarPaso cambia solo lo que se manda y solo en ese paso', () => {
    const lista = cambiarPaso([paso('a'), paso('b')], 'a', { errorStrategy: 'retry', maxRetries: 2 })
    expect(lista[0]).toMatchObject({ errorStrategy: 'retry', maxRetries: 2, label: 'Integración a' })
    expect(lista[1].errorStrategy).toBe('stop')
  })

  it('moverPaso sube y baja, y en los bordes no hace nada', () => {
    const base = () => [paso('a'), paso('b'), paso('c')]
    expect(ids(moverPaso(base(), 'b', -1))).toEqual(['b', 'a', 'c'])
    expect(ids(moverPaso(base(), 'b', 1))).toEqual(['a', 'c', 'b'])
    expect(ids(moverPaso(base(), 'a', -1))).toEqual(['a', 'b', 'c'])
    expect(ids(moverPaso(base(), 'c', 1))).toEqual(['a', 'b', 'c'])
    expect(ids(moverPaso(base(), 'x', 1))).toEqual(['a', 'b', 'c'])
  })

  describe('dentro de un grupo', () => {
    const base = () => [grupo('g', [paso('a'), paso('b'), paso('c')]), grupo('h', [paso('z')])]

    it('quitarHijo, cambiarHijo y moverHijo solo tocan ese grupo', () => {
      expect(ids(quitarHijo(base(), 'g', 'b')[0].children)).toEqual(['a', 'c'])
      expect(cambiarHijo(base(), 'g', 'a', { errorStrategy: 'continue' })[0].children[0].errorStrategy).toBe('continue')
      expect(ids(moverHijo(base(), 'g', 'c', -1)[0].children)).toEqual(['a', 'c', 'b'])
      expect(ids(moverHijo(base(), 'g', 'a', -1)[0].children)).toEqual(['a', 'b', 'c'])
      expect(ids(quitarHijo(base(), 'g', 'b')[1].children)).toEqual(['z'])
    })

    it('un hijo que está en otro grupo no se toca', () => {
      expect(ids(quitarHijo(base(), 'g', 'z')[1].children)).toEqual(['z'])
    })
  })
})

describe('reordenar (arrastrar)', () => {
  const base = () => [paso('a'), paso('b'), paso('c'), paso('d')]
  const orden = (lista) => ids(lista).join('')

  it.each([
    ['a', 'c', 'top', 'bacd'],
    ['a', 'c', 'bottom', 'bcad'],
    ['d', 'b', 'top', 'adbc'],
    ['d', 'b', 'bottom', 'abdc'],
    ['a', 'd', 'bottom', 'bcda'],
    ['d', 'a', 'top', 'dabc'],
    ['b', 'c', 'top', 'abcd'],
    ['c', 'b', 'bottom', 'abcd'],
  ])('%s sobre %s (%s) queda %s', (desde, hacia, posicion, esperado) => {
    expect(orden(reordenar(base(), desde, hacia, posicion))).toBe(esperado)
  })

  it('soltar sobre sí mismo, o con un paso que no existe, no cambia nada', () => {
    expect(orden(reordenar(base(), 'b', 'b', 'top'))).toBe('abcd')
    expect(orden(reordenar(base(), 'x', 'b', 'top'))).toBe('abcd')
    expect(orden(reordenar(base(), 'b', 'x', 'top'))).toBe('abcd')
  })

  it('nunca pierde ni duplica pasos', () => {
    for (const desde of 'abcd') {
      for (const hacia of 'abcd') {
        for (const posicion of ['top', 'bottom']) {
          expect(ids(reordenar(base(), desde, hacia, posicion)).sort().join(''), `${desde} ${hacia} ${posicion}`).toBe('abcd')
        }
      }
    }
  })
})

describe('contar e identificar', () => {
  const lista = () => [paso('a'), grupo('g', [paso('b'), paso('c')]), grupo('vacio')]

  it('totalDeIntegraciones cuenta las de los pasos y las de los grupos, no los grupos', () => {
    expect(totalDeIntegraciones(lista())).toBe(3)
    expect(totalDeIntegraciones([])).toBe(0)
  })

  it('idsDeNodos y idsDeEjecucion hablan de los mismos nodos', () => {
    const run = { nodes: { a: { status: 'success' }, g: { type: 'group', children: { b: {}, c: {} } }, vacio: { type: 'group', children: {} } } }
    expect([...idsDeNodos(lista())].sort()).toEqual(['a', 'b', 'c', 'g', 'vacio'])
    expect([...idsDeEjecucion(run)].sort()).toEqual(['a', 'b', 'c', 'g', 'vacio'])
    expect(esDeLaMismaVersion(lista(), run)).toBe(true)
  })

  it('una ejecución con otros nodos no es de esta lista', () => {
    expect(esDeLaMismaVersion(lista(), { nodes: { viejo: { status: 'error' } } })).toBe(false)
    expect(esDeLaMismaVersion([paso('a')], { nodes: { a: {}, b: {} } })).toBe(false)
    expect(esDeLaMismaVersion([paso('a'), paso('b')], { nodes: { a: {} } })).toBe(false)
    expect(esDeLaMismaVersion([], null)).toBe(true)
  })
})
