import { describe, it, expect } from 'vitest'
import { normalizeGraph } from '../../core/orchestrations/graph.js'
import {
  RETRY_DEFAULTS,
  graphToSteps,
  isV8Steps,
  newGroup,
  planImport,
  readOrchestrationFile,
  stepFromTemplate,
  stepsFromV8File,
  stepsToGraph,
  toV8File,
  v8FileName,
} from './ibp-orchestration.js'

const tarea = (id, extra = {}) => ({
  id, type: 'task', jobTemplateName: `Z_${id}`, jobTemplateText: `Texto ${id}`, ...RETRY_DEFAULTS, ...extra,
})
const grupo = (id, children, extra = {}) => ({ id, type: 'group', label: '', ...RETRY_DEFAULTS, children, ...extra })

describe('pasos nuevos', () => {
  it('desde una plantilla, con los valores de v8', () => {
    const paso = stepFromTemplate({ JobTemplateName: 'ZCARGA', JobTemplateText: 'Carga' })
    expect(paso).toMatchObject({
      type: 'task', jobTemplateName: 'ZCARGA', jobTemplateText: 'Carga',
      errorStrategy: 'stop', maxRetries: 3, retryDelaySec: 60,
    })
    expect(paso.id).toBeTruthy()
  })

  it('sin texto, la plantilla se llama por su nombre técnico', () => {
    expect(stepFromTemplate({ JobTemplateName: 'ZCARGA' }).jobTemplateText).toBe('ZCARGA')
  })

  it('un grupo nace vacío y sin descripción', () => {
    expect(newGroup()).toMatchObject({ type: 'group', label: '', children: [], maxRetries: 3, retryDelaySec: 60 })
  })
})

describe('stepsToGraph', () => {
  const pasos = [tarea('a'), grupo('g', [tarea('x'), tarea('y')]), tarea('b')]

  it('los pasos de primer nivel quedan en cadena', () => {
    const { edges } = stepsToGraph(pasos)
    expect(edges.map((e) => [e.source, e.target])).toEqual([['a', 'g'], ['g', 'b']])
  })

  // Sin conexiones entre ellos, el motor los lanza a la vez.
  it('los hijos de un grupo cuelgan de él y no tienen conexiones', () => {
    const { nodes, edges } = stepsToGraph(pasos)
    expect(nodes.filter((n) => n.parentId === 'g').map((n) => n.id)).toEqual(['x', 'y'])
    expect(edges.some((e) => ['x', 'y'].includes(e.source) || ['x', 'y'].includes(e.target))).toBe(false)
  })

  it('guarda la plantilla con los nombres que lee el adaptador de IBP', () => {
    const { nodes } = stepsToGraph([tarea('a', { retryDelaySec: 120, maxRetries: 7, errorStrategy: 'retry' })])
    expect(nodes[0].data).toMatchObject({
      templateName: 'Z_a', jobText: 'Texto a', errorStrategy: 'retry', maxRetries: 7, retryDelaySeconds: 120,
    })
  })

  it('una lista vacía es un grafo vacío', () => {
    expect(stepsToGraph([])).toEqual({ nodes: [], edges: [] })
  })

  // Lo que se arma aquí tiene que pasar la validación del servidor, o no se podría guardar.
  it('el grafo pasa la validación del servidor y conserva la plantilla', () => {
    const { nodes } = normalizeGraph(stepsToGraph(pasos), { kind: 'ibp' })
    expect(nodes.find((n) => n.id === 'x').data.templateName).toBe('Z_x')
    expect(nodes.find((n) => n.id === 'g').data.label).toBe('')
  })
})

describe('graphToSteps', () => {
  it('ida y vuelta: la lista sale igual que entró', () => {
    const pasos = [tarea('a'), grupo('g', [tarea('x'), tarea('y')], { label: 'Juntos', errorStrategy: 'continue' }), tarea('b')]
    const { nodes, edges } = normalizeGraph(stepsToGraph(pasos), { kind: 'ibp' })
    expect(graphToSteps(nodes, edges)).toEqual({ steps: pasos, isList: true })
  })

  it('el orden lo dan las conexiones, no cómo estén guardados los nodos', () => {
    const { nodes, edges } = stepsToGraph([tarea('a'), tarea('b'), tarea('c')])
    const { steps } = graphToSteps([...nodes].reverse(), edges)
    expect(steps.map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })

  // Algo dibujado en el lienzo no se rompe: se linealiza y se avisa.
  it('un grafo que no es una lista se linealiza en su orden de ejecución', () => {
    const nodo = (id) => ({ id, type: 'task', data: { templateName: id } })
    const nodes = [nodo('a'), nodo('b'), nodo('c'), nodo('d')]
    const edges = [
      { id: '1', source: 'a', target: 'c' },
      { id: '2', source: 'b', target: 'c' },
      { id: '3', source: 'c', target: 'd' },
    ]
    const { steps, isList } = graphToSteps(nodes, edges)
    expect(steps.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(isList).toBe(false)
  })

  it('conexiones entre los hijos de un grupo tampoco son la forma de v8', () => {
    const nodes = [
      { id: 'g', type: 'group', data: {} },
      { id: 'x', type: 'task', parentId: 'g', data: { templateName: 'X' } },
      { id: 'y', type: 'task', parentId: 'g', data: { templateName: 'Y' } },
    ]
    const { steps, isList } = graphToSteps(nodes, [{ id: 'e', source: 'x', target: 'y' }])
    expect(steps[0].children.map((h) => h.id)).toEqual(['x', 'y'])
    expect(isList).toBe(false)
  })

  it('pasos sueltos sin conexiones tampoco', () => {
    const nodo = (id) => ({ id, type: 'task', data: { templateName: id } })
    expect(graphToSteps([nodo('a'), nodo('b')], []).isList).toBe(false)
    expect(graphToSteps([nodo('a')], []).isList).toBe(true)
  })

  it('un grafo vacío es una lista vacía', () => {
    expect(graphToSteps([], [])).toEqual({ steps: [], isList: true })
  })
})

describe('el archivo de v8', () => {
  it('tiene la forma de exportOrchs de v8', () => {
    const ahora = new Date('2026-10-01T10:00:00Z')
    expect(toV8File([{ id: 'x', name: 'Cierre', steps: [tarea('a')], createdAt: 'y' }], 'IBP QA', ahora)).toEqual({
      version: '1.0',
      exportedAt: '2026-10-01T10:00:00.000Z',
      sourceConnection: 'IBP QA',
      orchestrations: [{ name: 'Cierre', steps: [tarea('a')] }],
    })
  })

  it('se llama como en v8, con la conexión y la fecha', () => {
    expect(v8FileName('IBP QA / Norte', new Date('2026-10-01T10:00:00Z')))
      .toBe('ibp-orquestaciones-IBP_QA_Norte-2026-10-01.json')
    expect(v8FileName('', new Date('2026-10-01T10:00:00Z'))).toBe('ibp-orquestaciones-conn-2026-10-01.json')
  })

  it('reconoce los pasos de v8 y no los de v9', () => {
    expect(isV8Steps([{ jobTemplateName: 'Z' }])).toBe(true)
    expect(isV8Steps([{ type: 'group', children: [] }])).toBe(true)
    expect(isV8Steps([{ taskName: 'CARGA' }])).toBe(false)
    expect(isV8Steps(undefined)).toBe(false)
  })

  it('completa lo que falte y descarta lo que no se entiende', () => {
    const pasos = stepsFromV8File([
      { jobTemplateName: 'ZA' },
      { taskName: 'de v9' },
      null,
      { type: 'group', children: [{ jobTemplateName: 'ZB' }] },
    ])
    expect(pasos).toHaveLength(2)
    expect(pasos[0]).toMatchObject({ type: 'task', jobTemplateName: 'ZA', jobTemplateText: 'ZA', maxRetries: 3 })
    expect(pasos[0].id).toBeTruthy()
    expect(pasos[1].children[0]).toMatchObject({ jobTemplateName: 'ZB' })
  })

  it('lee también el formato de esta plataforma, linealizado', () => {
    const { nodes, edges } = stepsToGraph([tarea('a'), tarea('b')])
    const [una] = readOrchestrationFile({ orchestrations: [{ name: 'X', nodes, edges }] })
    expect(una.steps.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('una orquestación sin nombre se descarta', () => {
    expect(readOrchestrationFile({ orchestrations: [{ name: '  ', steps: [] }, { name: 'B', steps: [] }] }))
      .toEqual([{ name: 'B', steps: [] }])
  })
})

describe('planImport', () => {
  const existentes = [{ id: 'o1', name: 'Cierre diario' }]

  it('crea lo nuevo y omite lo repetido si no se pidió reemplazar', () => {
    const plan = planImport([{ name: 'Otra', steps: [] }, { name: ' cierre DIARIO ', steps: [] }], existentes, false)
    expect(plan.crear.map((u) => u.name)).toEqual(['Otra'])
    expect(plan).toMatchObject({ reemplazos: [], reemplazadas: 0, omitidas: 1 })
  })

  it('reemplaza lo repetido si se pidió', () => {
    const pasos = [tarea('a')]
    const plan = planImport([{ name: 'cierre diario', steps: pasos }], existentes, true)
    expect(plan.reemplazos).toEqual([{ id: 'o1', name: 'cierre diario', steps: pasos }])
    expect(plan.reemplazadas).toBe(1)
  })

  // Como v8: lo ya recorrido del archivo cuenta como existente.
  it('dos con el mismo nombre en el archivo no crean dos', () => {
    const plan = planImport([{ name: 'Nueva', steps: [] }, { name: 'nueva', steps: [tarea('b')] }], [], true)
    expect(plan.crear).toHaveLength(1)
    expect(plan.crear[0].steps).toHaveLength(1)
    expect(plan.reemplazadas).toBe(1)
  })
})
