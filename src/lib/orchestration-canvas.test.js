import { describe, expect, it } from 'vitest'
import {
  aristaAnimada,
  autoLayout,
  borrarEnCascada,
  computeGroupMode,
  computeWaves,
  conAlfa,
  datosDeTareaSoltada,
  deepestTailPerContext,
  esConexionValida,
  grafoParaGuardar,
  grupoEnPunto,
  hasCycle,
  hasCycleInContext,
  nodeRunState,
  nodeStatusColor,
  ordenarPadresPrimero,
  reasignarUltimos,
  resumenDeHijos,
} from './orchestration-canvas.js'

const tarea = (id, extra = {}) => ({ id, type: 'task', position: { x: 0, y: 0 }, data: {}, ...extra })
const grupo = (id, extra = {}) => ({ id, type: 'group', position: { x: 0, y: 0 }, data: {}, ...extra })
const arista = (source, target) => ({ id: `e-${source}-${target}`, source, target })

describe('hasCycle', () => {
  it('un grafo sin conexiones o en línea no tiene ciclo', () => {
    expect(hasCycle([tarea('a'), tarea('b')], [])).toBe(false)
    expect(hasCycle([tarea('a'), tarea('b'), tarea('c')], [arista('a', 'b'), arista('b', 'c')])).toBe(false)
  })

  it('detecta un ciclo de dos, de tres y uno que cuelga de otros', () => {
    const nodos = [tarea('a'), tarea('b'), tarea('c')]
    expect(hasCycle(nodos, [arista('a', 'b'), arista('b', 'a')])).toBe(true)
    expect(hasCycle(nodos, [arista('a', 'b'), arista('b', 'c'), arista('c', 'a')])).toBe(true)
    expect(hasCycle(nodos, [arista('a', 'b'), arista('b', 'c'), arista('c', 'b')])).toBe(true)
  })

  it('un rombo (dos caminos que se juntan) no es un ciclo', () => {
    const nodos = [tarea('a'), tarea('b'), tarea('c'), tarea('d')]
    expect(hasCycle(nodos, [arista('a', 'b'), arista('a', 'c'), arista('b', 'd'), arista('c', 'd')])).toBe(false)
  })

  it('un nodo conectado a sí mismo es un ciclo', () => {
    expect(hasCycle([tarea('a')], [arista('a', 'a')])).toBe(true)
  })

  it('mira también dentro de los grupos, cada uno por separado', () => {
    const nodos = [grupo('g'), tarea('x', { parentId: 'g' }), tarea('y', { parentId: 'g' })]
    expect(hasCycle(nodos, [arista('x', 'y')])).toBe(false)
    expect(hasCycle(nodos, [arista('x', 'y'), arista('y', 'x')])).toBe(true)
  })

  it('una arista entre niveles distintos no cierra un ciclo', () => {
    const nodos = [tarea('a'), grupo('g'), tarea('x', { parentId: 'g' })]
    expect(hasCycle(nodos, [arista('a', 'x'), arista('x', 'a')])).toBe(false)
  })

  it('hasCycleInContext mira solo el nivel que se le pide', () => {
    const nodos = [grupo('g'), tarea('x', { parentId: 'g' }), tarea('y', { parentId: 'g' })]
    const ciclo = [arista('x', 'y'), arista('y', 'x')]
    expect(hasCycleInContext(nodos, ciclo, null)).toBe(false)
    expect(hasCycleInContext(nodos, ciclo, 'g')).toBe(true)
  })
})

describe('computeWaves', () => {
  it('los nodos sin entradas son la columna 0 y los demás siguen el orden', () => {
    const nodos = [tarea('a'), tarea('b'), tarea('c'), tarea('d')]
    const { colOf, byCol, cols } = computeWaves(nodos, [arista('a', 'b'), arista('c', 'b'), arista('b', 'd')])
    expect(colOf).toEqual({ a: 0, c: 0, b: 1, d: 2 })
    expect(byCol[0]).toEqual(['a', 'c'])
    expect(cols).toBe(3)
  })

  it('ignora a los hijos de grupo y deja fuera a los de un ciclo', () => {
    const nodos = [tarea('a'), tarea('b'), tarea('c'), grupo('g'), tarea('h', { parentId: 'g' })]
    const { colOf } = computeWaves(nodos, [arista('b', 'c'), arista('c', 'b')])
    expect(colOf).toEqual({ a: 0, g: 0 })
  })
})

describe('autoLayout', () => {
  it('con solo tareas reproduce las posiciones de v9', () => {
    const nodos = [tarea('a'), tarea('b'), tarea('c'), tarea('d')]
    const laid = autoLayout(nodos, [arista('a', 'b'), arista('c', 'b'), arista('b', 'd')])
    const pos = Object.fromEntries(laid.map((nodo) => [nodo.id, nodo.position]))
    expect(pos.a).toEqual({ x: 40, y: 60 })
    expect(pos.c).toEqual({ x: 40, y: 220 })
    expect(pos.b).toEqual({ x: 300, y: 60 })
    expect(pos.d).toEqual({ x: 560, y: 60 })
  })

  it('no mueve a los hijos de un grupo ni a los nodos de un ciclo', () => {
    const hijo = tarea('h', { parentId: 'g', position: { x: 15, y: 25 } })
    const enCiclo = tarea('z', { position: { x: 7, y: 9 } })
    const laid = autoLayout(
      [grupo('g'), hijo, enCiclo, tarea('y')],
      [arista('z', 'y'), arista('y', 'z')],
    )
    expect(laid.find((nodo) => nodo.id === 'h').position).toEqual({ x: 15, y: 25 })
    expect(laid.find((nodo) => nodo.id === 'z').position).toEqual({ x: 7, y: 9 })
  })

  it('deja espacio para un grupo grande: ni se encima con el de abajo ni con la columna de al lado', () => {
    const grande = grupo('g', { style: { width: 400, height: 300 } })
    const laid = autoLayout(
      [grande, tarea('t'), tarea('s')],
      [arista('g', 's')],
    )
    const pos = Object.fromEntries(laid.map((nodo) => [nodo.id, nodo.position]))
    // g y t comparten la columna 0: t baja lo que mide g más el margen.
    expect(pos.g).toEqual({ x: 40, y: 60 })
    expect(pos.t.y).toBeGreaterThanOrEqual(60 + 300)
    // La columna 1 empieza después del ancho de g.
    expect(pos.s.x).toBeGreaterThanOrEqual(40 + 400)
  })
})

describe('computeGroupMode', () => {
  const base = [grupo('g'), tarea('a', { parentId: 'g' }), tarea('b', { parentId: 'g' }), tarea('c', { parentId: 'g' })]

  it('sin hijos o sin conexiones entre ellos es paralelo', () => {
    expect(computeGroupMode('g', [grupo('g')], [])).toBe('parallel')
    expect(computeGroupMode('g', base, [])).toBe('parallel')
  })

  it('con todos los hijos conectados es en secuencia', () => {
    expect(computeGroupMode('g', base, [arista('a', 'b'), arista('b', 'c')])).toBe('serial')
  })

  it('con algún hijo suelto es híbrido', () => {
    expect(computeGroupMode('g', base, [arista('a', 'b')])).toBe('hybrid')
  })

  it('una arista que sale del grupo no cuenta', () => {
    expect(computeGroupMode('g', [...base, tarea('fuera')], [arista('a', 'fuera')])).toBe('parallel')
  })
})

describe('estado de ejecución', () => {
  const nodos = [tarea('a'), grupo('g'), tarea('h', { parentId: 'g' })]
  const run = {
    nodes: {
      a: { status: 'success' },
      g: { status: 'running', children: { h: { status: 'running', sapRunId: '99' } } },
    },
  }

  it('el estado de un hijo se busca bajo su padre, no arriba', () => {
    expect(nodeRunState(run, nodos, 'h')).toEqual({ status: 'running', sapRunId: '99' })
    expect(nodeRunState(run, nodos, 'a')).toEqual({ status: 'success' })
  })

  it('sin ejecución, o con un nodo desconocido, no hay estado', () => {
    expect(nodeRunState(null, nodos, 'a')).toBeNull()
    expect(nodeRunState(run, nodos, 'nope')).toBeNull()
  })

  it('el resumen cuenta como completada todo lo que no está pendiente ni corriendo', () => {
    const grupoEnMarcha = {
      children: { a: { status: 'success' }, b: { status: 'running' }, c: { status: 'error' }, d: { status: 'pending' } },
    }
    expect(resumenDeHijos(grupoEnMarcha)).toBe('2/4 completadas')
    expect(resumenDeHijos({ children: {} })).toBeNull()
    expect(resumenDeHijos(undefined)).toBeNull()
  })

  it('la arista se anima cuando sale de un éxito y llega a uno corriendo', () => {
    const dos = [tarea('a'), tarea('b')]
    const ejecucion = { nodes: { a: { status: 'success' }, b: { status: 'running' } } }
    expect(aristaAnimada(ejecucion, dos, arista('a', 'b'))).toBe(true)
    expect(aristaAnimada({ nodes: { a: { status: 'running' }, b: { status: 'running' } } }, dos, arista('a', 'b'))).toBe(false)
    expect(aristaAnimada(null, dos, arista('a', 'b'))).toBe(false)
  })

  it('un estado desconocido se pinta como pendiente', () => {
    expect(nodeStatusColor('raro')).toBe(nodeStatusColor('pending'))
  })

  it('conAlfa convierte un hex a rgba y deja pasar lo que no entiende', () => {
    expect(conAlfa('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)')
    expect(conAlfa('var(--x)', 0.5)).toBe('var(--x)')
  })
})

describe('conectar solo', () => {
  it('toma la cola de cada contexto y se salta los ambiguos', () => {
    const tareas = [
      tarea('a'), tarea('b'),
      tarea('x', { parentId: 'g1' }), tarea('y', { parentId: 'g1' }),
      tarea('p', { parentId: 'g2' }), tarea('q', { parentId: 'g2' }),
    ]
    const colas = deepestTailPerContext(tareas, [arista('a', 'b'), arista('x', 'y')])
    expect(colas.get(null)).toBe('b')
    expect(colas.get('g1')).toBe('y')
    // g2 tiene dos colas independientes (p y q): ambiguo, no entra.
    expect(colas.has('g2')).toBe(false)
  })

  it('al borrar, el último de un contexto pasa al último que queda', () => {
    const nodos = [tarea('a'), tarea('b'), tarea('x', { parentId: 'g' })]
    const ultimos = new Map([[null, 'c'], ['g', 'x'], ['h', 'zz']])
    const nuevo = reasignarUltimos(ultimos, nodos)
    expect(nuevo.get(null)).toBe('b')
    expect(nuevo.get('g')).toBe('x')
    expect(nuevo.has('h')).toBe(false)
  })
})

describe('esConexionValida', () => {
  const nodos = [tarea('a'), tarea('b'), grupo('g'), tarea('x', { parentId: 'g' }), tarea('y', { parentId: 'g' })]

  it('rechaza conectar un nodo consigo mismo', () => {
    expect(esConexionValida({ source: 'a', target: 'a' }, nodos)).toBe(false)
  })

  it('acepta nodos del mismo nivel y del mismo grupo', () => {
    expect(esConexionValida({ source: 'a', target: 'b' }, nodos)).toBe(true)
    expect(esConexionValida({ source: 'x', target: 'y' }, nodos)).toBe(true)
  })

  it('rechaza unir un hijo con alguien de fuera de su grupo', () => {
    expect(esConexionValida({ source: 'a', target: 'x' }, nodos)).toBe(false)
    expect(esConexionValida({ source: 'x', target: 'g' }, nodos)).toBe(false)
  })
})

describe('grupos y posiciones', () => {
  it('encuentra el grupo de primer nivel que contiene el punto', () => {
    const g = grupo('g', { position: { x: 100, y: 100 }, style: { width: 300, height: 200 } })
    expect(grupoEnPunto([tarea('a'), g], { x: 150, y: 150 })?.id).toBe('g')
    expect(grupoEnPunto([g], { x: 50, y: 150 })).toBeNull()
  })

  it('usa el tamaño medido tras redimensionar antes que el del estilo', () => {
    const g = grupo('g', { position: { x: 0, y: 0 }, style: { width: 300, height: 200 }, width: 600, height: 500 })
    expect(grupoEnPunto([g], { x: 550, y: 450 })?.id).toBe('g')
  })

  it('pone los padres antes que sus hijos sin tocar lo que ya está en orden', () => {
    const ordenado = [grupo('g'), tarea('h', { parentId: 'g' })]
    expect(ordenarPadresPrimero(ordenado)).toBe(ordenado)
    const mal = [tarea('h', { parentId: 'g' }), tarea('a'), grupo('g')]
    expect(ordenarPadresPrimero(mal).map((nodo) => nodo.id)).toEqual(['a', 'g', 'h'])
  })
})

describe('borrarEnCascada', () => {
  const nodos = [tarea('a'), grupo('g'), tarea('h1', { parentId: 'g' }), tarea('h2', { parentId: 'g' }), tarea('b')]
  const aristas = [arista('a', 'g'), arista('h1', 'h2'), arista('a', 'b'), arista('g', 'b')]

  it('borrar un grupo se lleva a sus hijos y las aristas de todos', () => {
    const { nodes, edges, quitados } = borrarEnCascada(nodos, aristas, ['g'])
    expect(nodes.map((nodo) => nodo.id)).toEqual(['a', 'b'])
    expect(edges.map((una) => una.id)).toEqual(['e-a-b'])
    expect([...quitados].sort()).toEqual(['g', 'h1', 'h2'])
  })

  it('borrar un hijo no toca al grupo', () => {
    const { nodes, edges } = borrarEnCascada(nodos, aristas, ['h1'])
    expect(nodes.map((nodo) => nodo.id)).toEqual(['a', 'g', 'h2', 'b'])
    expect(edges.map((una) => una.id)).toEqual(['e-a-g', 'e-a-b', 'e-g-b'])
  })

  it('funciona aunque el grupo ya no esté en la lista de nodos', () => {
    const sinGrupo = nodos.filter((nodo) => nodo.id !== 'g')
    expect(borrarEnCascada(sinGrupo, aristas, ['g']).nodes.map((nodo) => nodo.id)).toEqual(['a', 'b'])
  })
})

describe('datosDeTareaSoltada', () => {
  it('acepta lo que arrastraba v9 y le pone los datos por omisión', () => {
    const datos = datosDeTareaSoltada(JSON.stringify({ taskName: 'CARGA', taskGuid: 'g-1', type: 'PROCESS' }))
    expect(datos).toMatchObject({
      taskName: 'CARGA',
      taskGuid: 'g-1',
      taskType: 'PROCESS',
      label: 'CARGA',
      agentName: null,
      profileName: null,
      errorStrategy: 'stop',
      maxRetries: 0,
      retryDelaySeconds: 30,
      globalVariables: [],
    })
  })

  it('acepta taskType y descarta campos que no describen qué lanzar', () => {
    const datos = datosDeTareaSoltada({ taskName: 'X', taskType: 'TASK', errorStrategy: 'continue', onSelect: 'malo' })
    expect(datos.taskType).toBe('TASK')
    expect(datos.errorStrategy).toBe('stop')
    expect(datos).not.toHaveProperty('onSelect')
  })

  it('sin tarea, o con algo que no es JSON, devuelve null', () => {
    expect(datosDeTareaSoltada('')).toBeNull()
    expect(datosDeTareaSoltada('no es json')).toBeNull()
    expect(datosDeTareaSoltada(JSON.stringify({ taskGuid: 'solo-guid' }))).toBeNull()
    expect(datosDeTareaSoltada('"texto"')).toBeNull()
  })
})

describe('grafoParaGuardar', () => {
  it('manda solo el dibujo: sin lo que pone la librería ni lo que pone la ejecución', () => {
    const { nodes, edges } = grafoParaGuardar(
      [
        {
          id: 'a',
          type: 'task',
          position: { x: 1, y: 2 },
          measured: { width: 210, height: 90 },
          selected: true,
          data: { taskName: 'T', label: 'T', runStep: { status: 'running' }, runStatus: 'running', onRunSingle: () => {} },
        },
      ],
      [{ id: 'e1', source: 'a', target: 'b', selected: true, animated: true }],
    )
    expect(nodes).toEqual([{ id: 'a', type: 'task', position: { x: 1, y: 2 }, data: { taskName: 'T', label: 'T' } }])
    expect(edges).toEqual([{ id: 'e1', source: 'a', target: 'b' }])
  })

  it('el tamaño de un grupo redimensionado se guarda en su estilo', () => {
    const { nodes } = grafoParaGuardar(
      [{ id: 'g', type: 'group', position: { x: 0, y: 0 }, style: { width: 300, height: 180 }, width: 420, height: 260, data: { label: 'G' } }],
      [],
    )
    expect(nodes[0].style).toEqual({ width: 420, height: 260 })
  })

  it('un hijo conserva su padre y su límite', () => {
    const { nodes } = grafoParaGuardar(
      [{ id: 'h', type: 'task', position: { x: 5, y: 5 }, parentId: 'g', extent: 'parent', data: {} }],
      [],
    )
    expect(nodes[0]).toMatchObject({ parentId: 'g', extent: 'parent' })
  })
})
