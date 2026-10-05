// @vitest-environment jsdom
//
// El lienzo de orquestaciones con la forma de v9: el estado de los pasos de un grupo, borrar un grupo
// con sus hijos, la tecla Supr, renombrar, el autoguardado, soltar una tarea de la paleta, rechazar un
// ciclo y «⚡ Auto».
//
// La librería del lienzo necesita en jsdom lo que el navegador trae (ResizeObserver, medidas); se
// simula lo mínimo, como indica su documentación. `ReactFlow` se envuelve para poder llamar a
// `onConnect` sin arrastrar con el ratón, que en jsdom no existe.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const capturado = { props: null }
vi.mock('@xyflow/react', async (importOriginal) => {
  const original = await importOriginal()
  const { createElement: crear } = await import('react')
  return {
    ...original,
    ReactFlow: (props) => {
      capturado.props = props
      return crear(original.ReactFlow, props)
    },
  }
})

const cidsCall = vi.fn()
vi.mock('../../../lib/cids.js', () => ({
  cidsCall: (...args) => cidsCall(...args),
  isTaskPromoted: (promovidas, nombre) => Boolean(promovidas?.has(String(nombre ?? '').trim().toUpperCase())),
}))

const ejecucionFalsa = { run: null, error: '', ocupado: false, enMarcha: false }
vi.mock('./useOrchestrationRun.js', () => ({
  useOrchestrationRun: () => ejecucionFalsa,
}))

const propsDeRunBar = { actuales: null }
vi.mock('./RunBar.jsx', () => ({
  default: (props) => {
    propsDeRunBar.actuales = props
    return null
  },
}))
vi.mock('./RunDetail.jsx', () => ({ default: () => null }))
vi.mock('./RunSingleModal.jsx', async () => {
  const { createElement: crear } = await import('react')
  return {
    default: ({ nodo, onClose }) => crear(
      'div',
      { className: 'ejecutar-solo-falso', 'data-nodo': JSON.stringify(nodo) },
      crear('button', { type: 'button', onClick: onClose }, 'cerrar'),
    ),
  }
})

const { default: OrchestrationCanvas } = await import('./OrchestrationCanvas.jsx')

const DESTINO = { id: 'c1:sandbox', connectionId: 'c1', production: false, name: 'CLARO', label: 'CLARO · Sandbox' }

beforeAll(() => {
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback }
    observe(target) { this.callback([{ target, contentRect: { width: 210, height: 90 } }], this) }
    unobserve() {}
    disconnect() {}
  }
  globalThis.DOMMatrixReadOnly = class {
    constructor(transform) {
      const escala = String(transform ?? '').match(/scale\(([\d.]+)\)/)?.[1]
      this.m22 = escala ? Number(escala) : 1
    }
  }
  Object.defineProperties(globalThis.HTMLElement.prototype, {
    offsetHeight: { get() { return parseFloat(this.style.height) || 90 } },
    offsetWidth: { get() { return parseFloat(this.style.width) || 210 } },
  })
  globalThis.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 })
})

const tarea = (id, extra = {}) => ({
  id,
  type: 'task',
  position: { x: 20, y: 20 },
  data: { taskName: `TASK_${id}`, label: `TASK_${id}`, errorStrategy: 'stop', maxRetries: 0, retryDelaySeconds: 30, globalVariables: [] },
  ...extra,
})
const grupo = (id, extra = {}) => ({
  id,
  type: 'group',
  position: { x: 300, y: 40 },
  style: { width: 300, height: 180 },
  data: { label: 'Mi grupo', errorStrategy: 'stop', maxRetries: 0, retryDelaySeconds: 30, globalVariables: [] },
  ...extra,
})

let contenedor
let raiz
let onGuardar
let onRenombrar
let onSinGuardar

/** Una paleta de mentira: dos botones que llaman a lo que la real recibe por props. */
function PaletaFalsa({ onAgregar, onAgregarGrupo, transportadas }) {
  return createElement(
    'div',
    { className: 'paleta-falsa', 'data-transportadas': transportadas ? 'si' : 'no' },
    createElement('button', {
      type: 'button',
      onClick: () => onAgregar({ taskName: 'NUEVA', taskGuid: 'g-n', taskType: 'TASK', label: 'NUEVA', agentName: null, profileName: null, globalVariables: [] }),
    }, 'agregar tarea'),
    createElement('button', { type: 'button', onClick: onAgregarGrupo }, '+ Nuevo grupo'),
  )
}

async function montar({ nodes = [], edges = [], props = {} } = {}) {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(OrchestrationCanvas, {
      destino: DESTINO,
      orquestacion: { id: 'o1', name: 'Carga diaria', nodes, edges },
      onGuardar,
      guardando: false,
      error: '',
      Paleta: PaletaFalsa,
      onRenombrar,
      onSinGuardar,
      ...props,
    }))
  })
  await act(async () => { await Promise.resolve() })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  cidsCall.mockReset()
  cidsCall.mockResolvedValue([])
  onGuardar = vi.fn().mockResolvedValue({})
  onRenombrar = vi.fn().mockResolvedValue(undefined)
  onSinGuardar = vi.fn()
  Object.assign(ejecucionFalsa, { run: null, error: '', ocupado: false, enMarcha: false })
  capturado.props = null
  propsDeRunBar.actuales = null
})

afterEach(() => {
  act(() => raiz?.unmount())
  contenedor?.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const texto = () => contenedor.textContent
const boton = (contiene) => [...contenedor.querySelectorAll('button')].find((uno) => uno.textContent.includes(contiene))
const nodoEnPantalla = (id) => contenedor.querySelector(`.react-flow__node[data-id="${id}"]`)

async function avanzar(ms = 10) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

async function pulsar(elemento) {
  await act(async () => {
    elemento.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

const ultimaGuardada = () => onGuardar.mock.calls.at(-1)?.[0]

/** Pone una conexión «a mano», como lo haría la librería al soltar un arrastre entre dos nodos. */
const conectar = (source, target) => act(async () => { capturado.props.onConnect({ source, target }) })

describe('el estado de los pasos dentro de un grupo', () => {
  it('se lee del estado de su grupo y se pinta en el hijo y en el resumen del grupo', async () => {
    Object.assign(ejecucionFalsa, {
      run: {
        status: 'running',
        nodes: {
          g1: {
            status: 'running',
            children: {
              h1: { status: 'success', sapRunId: '987654321', retryCount: 0 },
              h2: { status: 'running', sapRunId: null, retryCount: 0 },
            },
          },
        },
      },
      enMarcha: true,
    })
    await montar({
      nodes: [grupo('g1'), tarea('h1', { parentId: 'g1', extent: 'parent' }), tarea('h2', { parentId: 'g1', extent: 'parent' })],
    })

    expect(nodoEnPantalla('h1').textContent).toContain('Correcta')
    expect(nodoEnPantalla('h1').textContent).toContain('#654321')
    expect(nodoEnPantalla('h2').textContent).toContain('Corriendo')
    expect(nodoEnPantalla('g1').textContent).toContain('1/2 completadas')
  })

  it('mientras corre, el lienzo dice que está bloqueado y la paleta sigue a la vista', async () => {
    Object.assign(ejecucionFalsa, { run: { status: 'running', nodes: {} }, enMarcha: true })
    await montar({ nodes: [tarea('a')] })

    expect(texto()).toContain('Canvas bloqueado — orquestacion en ejecucion')
    expect(contenedor.querySelector('.paleta-falsa')).not.toBeNull()
    expect(capturado.props.nodesDraggable).toBe(false)
    expect(capturado.props.nodesConnectable).toBe(false)
    expect(capturado.props.deleteKeyCode).toBeNull()
  })

  it('una arista se anima en acento cuando sale de un éxito y llega a un paso corriendo', async () => {
    Object.assign(ejecucionFalsa, {
      run: { status: 'running', nodes: { a: { status: 'success' }, b: { status: 'running' } } },
      enMarcha: true,
    })
    await montar({ nodes: [tarea('a'), tarea('b', { position: { x: 300, y: 20 } })], edges: [{ id: 'e-a-b', source: 'a', target: 'b' }] })

    const arista = capturado.props.edges[0]
    expect(arista.animated).toBe(true)
    expect(arista.style.stroke).toBe('var(--accent)')
  })
})

describe('textos y valores de v9', () => {
  it('el lienzo vacío dice qué hacer', async () => {
    await montar()
    expect(texto()).toContain('Arrastra tasks desde el panel izquierdo')
    expect(texto()).toContain('Conecta los nodos para definir el orden de ejecución')
  })

  it('la tecla de borrar es Supr, y no hay botón Guardar ni «sin guardar»', async () => {
    await montar({ nodes: [tarea('a')] })
    expect(capturado.props.deleteKeyCode).toBe('Delete')
    expect(boton('Guardar')).toBeUndefined()
    expect(texto()).not.toContain('sin guardar')
  })

  it('los nodos llevan el nombre, lo que hacen si fallan y el ⚡ Auto está en la barra', async () => {
    await montar({ nodes: [tarea('a', { data: { ...tarea('a').data, errorStrategy: 'retry', maxRetries: 3, agentName: 'AG1', globalVariables: [{ name: 'V', value: '1' }] } })] })
    const nodo = nodoEnPantalla('a').textContent
    expect(nodo).toContain('TASK_a')
    expect(nodo).toContain('error: reintentar ×3')
    expect(nodo).toContain('agent: AG1')
    expect(nodo).toContain('vars: 1')
    expect(boton('⚡ Auto').title).toBe('Conectar automáticamente cada task al anterior al soltarlo en el canvas')
    expect(boton('⊞ Auto Layout')).toBeDefined()
  })

  it('marca con PRD la tarea que ya se promovió y se lo pasa también a la paleta', async () => {
    await montar({ nodes: [tarea('a')], props: { transportadas: new Set(['TASK_A']) } })
    expect(nodoEnPantalla('a').querySelector('.promoted-badge')).not.toBeNull()
    expect(contenedor.querySelector('.paleta-falsa').dataset.transportadas).toBe('si')
  })

  it('le pasa a la barra de ejecución el grafo actual y el destino', async () => {
    await montar({ nodes: [tarea('a')] })
    expect(propsDeRunBar.actuales.destino).toBe(DESTINO)
    expect(propsDeRunBar.actuales.grafo.nodes.map((n) => n.id)).toEqual(['a'])
  })
})

describe('ejecutar solo un task', () => {
  it('el ▶ aparece al pasar el ratón y abre el modal con los datos del nodo', async () => {
    await montar({
      nodes: [tarea('a', { data: { ...tarea('a').data, taskGuid: 'guid-a', agentName: 'AG1', profileName: 'PRF', globalVariables: [{ name: 'V', value: '1' }] } })],
    })
    expect(boton('▶')).toBeUndefined()

    await act(async () => {
      nodoEnPantalla('a').querySelector('.orq-nodo').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    const ejecutar = boton('▶')
    expect(ejecutar.title).toBe('Ejecutar solo este task')

    await pulsar(ejecutar)
    const modal = contenedor.querySelector('.ejecutar-solo-falso')
    expect(JSON.parse(modal.dataset.nodo)).toEqual({
      id: 'a', taskName: 'TASK_a', taskGuid: 'guid-a', agentName: 'AG1', profileName: 'PRF', globalVariables: [{ name: 'V', value: '1' }],
    })

    await pulsar(modal.querySelector('button'))
    expect(contenedor.querySelector('.ejecutar-solo-falso')).toBeNull()
  })
})

describe('borrar', () => {
  it('«Eliminar nodo» sobre un grupo se lleva a sus hijos y a las conexiones de todos', async () => {
    await montar({
      nodes: [
        tarea('a'),
        grupo('g1', { selected: true }),
        tarea('h1', { parentId: 'g1', extent: 'parent' }),
        tarea('h2', { parentId: 'g1', extent: 'parent' }),
      ],
      edges: [
        { id: 'e-a-g1', source: 'a', target: 'g1' },
        { id: 'e-h1-h2', source: 'h1', target: 'h2' },
      ],
    })
    await avanzar()

    expect(texto()).toContain('⊞ Grupo')
    await pulsar(boton('Eliminar nodo'))
    await avanzar(700)

    const guardado = ultimaGuardada()
    expect(guardado.nodes.map((nodo) => nodo.id)).toEqual(['a'])
    expect(guardado.edges).toEqual([])
  })

  it('la tecla Supr sobre un grupo seleccionado borra también a sus hijos', async () => {
    await montar({
      nodes: [
        grupo('g1', { selected: true }),
        tarea('h1', { parentId: 'g1', extent: 'parent' }),
        tarea('b', { position: { x: 20, y: 300 } }),
      ],
      edges: [{ id: 'e-g1-b', source: 'g1', target: 'b' }],
    })
    await avanzar()

    // Pulsar y soltar van en pasos separados: la librería actúa al ver la tecla pulsada, y si ambas
    // llegan en el mismo ciclo nunca la ve.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete', bubbles: true }))
    })
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Delete', code: 'Delete', bubbles: true }))
    })
    await avanzar(700)

    const guardado = ultimaGuardada()
    expect(guardado.nodes.map((nodo) => nodo.id)).toEqual(['b'])
    expect(guardado.edges).toEqual([])
  })
})

describe('autoguardado', () => {
  it('guarda 600 ms después del último cambio, con un solo guardado aunque haya varios cambios', async () => {
    await montar()
    await pulsar(boton('agregar tarea'))
    await avanzar(400)
    await pulsar(boton('agregar tarea'))
    await avanzar(599)
    expect(onGuardar).not.toHaveBeenCalled()

    await avanzar(2)
    expect(onGuardar).toHaveBeenCalledTimes(1)
    expect(ultimaGuardada().nodes).toHaveLength(2)
  })

  it('un paso nuevo lleva los datos por omisión', async () => {
    await montar()
    await pulsar(boton('agregar tarea'))
    await avanzar(700)

    const [nuevo] = ultimaGuardada().nodes
    expect(nuevo.type).toBe('task')
    expect(nuevo.data).toMatchObject({
      taskName: 'NUEVA',
      agentName: null,
      profileName: null,
      errorStrategy: 'stop',
      maxRetries: 0,
      retryDelaySeconds: 30,
      globalVariables: [],
    })
  })

  it('dice «Guardando…» mientras guarda y avisa a quien está arriba de los cambios pendientes', async () => {
    let terminar
    onGuardar.mockImplementation(() => new Promise((resolver) => { terminar = resolver }))
    await montar()
    expect(onSinGuardar).toHaveBeenLastCalledWith(false)

    await pulsar(boton('agregar tarea'))
    expect(onSinGuardar).toHaveBeenLastCalledWith(true)

    await avanzar(650)
    expect(texto()).toContain('Guardando…')

    await act(async () => { terminar({}) })
    await avanzar()
    expect(texto()).not.toContain('Guardando…')
    expect(onSinGuardar).toHaveBeenLastCalledWith(false)
  })

  it('no guarda nada al abrir: medir los nodos no es un cambio', async () => {
    await montar({ nodes: [tarea('a'), grupo('g1')] })
    await avanzar(2000)
    expect(onGuardar).not.toHaveBeenCalled()
  })

  it('si el guardado falla no reintenta solo, y vuelve a intentar con el siguiente cambio', async () => {
    onGuardar.mockRejectedValue(new Error('el servidor dijo que no'))
    await montar()
    await pulsar(boton('agregar tarea'))
    await avanzar(700)
    await avanzar(5000)
    expect(onGuardar).toHaveBeenCalledTimes(1)
    expect(onSinGuardar).toHaveBeenLastCalledWith(true)

    await pulsar(boton('agregar tarea'))
    await avanzar(700)
    expect(onGuardar).toHaveBeenCalledTimes(2)
  })

  it('muestra el error que le pasan arriba', async () => {
    await montar({ props: { error: 'Hay un ciclo en las conexiones' } })
    expect(texto()).toContain('Hay un ciclo en las conexiones')
  })

  it('con una ejecución en marcha no autoguarda lo pendiente hasta que termina', async () => {
    await montar()
    await pulsar(boton('agregar tarea'))

    Object.assign(ejecucionFalsa, { run: { status: 'running', nodes: {} }, enMarcha: true })
    await act(async () => { raiz.render(createElement(OrchestrationCanvas, {
      destino: DESTINO, orquestacion: { id: 'o1', name: 'Carga diaria', nodes: [], edges: [] },
      onGuardar, guardando: false, error: '', Paleta: PaletaFalsa, onSinGuardar,
    })) })
    await avanzar(2000)
    expect(onGuardar).not.toHaveBeenCalled()

    Object.assign(ejecucionFalsa, { run: null, enMarcha: false })
    await act(async () => { raiz.render(createElement(OrchestrationCanvas, {
      destino: DESTINO, orquestacion: { id: 'o1', name: 'Carga diaria', nodes: [], edges: [] },
      onGuardar, guardando: false, error: '', Paleta: PaletaFalsa, onSinGuardar,
    })) })
    await avanzar(700)
    expect(onGuardar).toHaveBeenCalledTimes(1)
  })
})

describe('conectar', () => {
  it('rechaza al instante una conexión que cerraría un ciclo, la avisa 2,5 s y no la crea', async () => {
    await montar({
      nodes: [tarea('a'), tarea('b', { position: { x: 300, y: 20 } })],
      edges: [{ id: 'e-a-b', source: 'a', target: 'b' }],
    })

    await conectar('b', 'a')
    expect(texto()).toContain('⚠ Ciclo detectado — esa conexión crearía un bucle')
    await avanzar(700)
    expect(onGuardar).not.toHaveBeenCalled()

    await avanzar(2000)
    expect(texto()).not.toContain('Ciclo detectado')
  })

  it('una conexión válida se crea y se guarda', async () => {
    await montar({ nodes: [tarea('a'), tarea('b', { position: { x: 300, y: 20 } })] })
    await conectar('a', 'b')
    await avanzar(700)
    expect(ultimaGuardada().edges).toEqual([{ id: 'e-a-b', source: 'a', target: 'b' }])
  })

  it('isValidConnection rechaza a sí mismo y a un nodo de otro contexto', async () => {
    await montar({ nodes: [tarea('a'), grupo('g1'), tarea('h', { parentId: 'g1', extent: 'parent' })] })
    const { isValidConnection } = capturado.props
    expect(isValidConnection({ source: 'a', target: 'a' })).toBe(false)
    expect(isValidConnection({ source: 'a', target: 'h' })).toBe(false)
    expect(isValidConnection({ source: 'a', target: 'g1' })).toBe(true)
  })

  it('«⚡ Auto» conecta cada paso nuevo con el anterior', async () => {
    await montar()
    await pulsar(boton('⚡ Auto'))
    expect(texto()).toContain('Auto ON')

    await pulsar(boton('agregar tarea'))
    await pulsar(boton('agregar tarea'))
    await pulsar(boton('agregar tarea'))
    await avanzar(700)

    const { nodes, edges } = ultimaGuardada()
    expect(nodes).toHaveLength(3)
    expect(edges).toHaveLength(2)
    expect(edges[0]).toMatchObject({ source: nodes[0].id, target: nodes[1].id })
    expect(edges[1]).toMatchObject({ source: nodes[1].id, target: nodes[2].id })
  })

  it('sin «Auto» los pasos nuevos quedan sueltos', async () => {
    await montar()
    await pulsar(boton('agregar tarea'))
    await pulsar(boton('agregar tarea'))
    await avanzar(700)
    expect(ultimaGuardada().edges).toEqual([])
  })

  it('al encender «Auto» sobre una cadena ya dibujada sigue desde su cola', async () => {
    await montar({
      nodes: [tarea('a'), tarea('b', { position: { x: 300, y: 20 } })],
      edges: [{ id: 'e-a-b', source: 'a', target: 'b' }],
    })
    await pulsar(boton('⚡ Auto'))
    await pulsar(boton('agregar tarea'))
    await avanzar(700)

    const { nodes, edges } = ultimaGuardada()
    expect(edges).toContainEqual({ id: `e-b-${nodes[2].id}`, source: 'b', target: nodes[2].id })
  })
})

describe('soltar una tarea de la paleta', () => {
  function soltar(destino, { x, y, carga }) {
    const evento = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(evento, 'clientX', { value: x })
    Object.defineProperty(evento, 'clientY', { value: y })
    Object.defineProperty(evento, 'dataTransfer', {
      value: { getData: (tipo) => (tipo === 'application/x-orch-task' ? JSON.stringify(carga) : ''), types: ['application/x-orch-task'] },
    })
    return act(async () => { destino.dispatchEvent(evento) })
  }

  it('crea el paso en el sitio donde se suelta, con los datos por omisión', async () => {
    await montar()
    await soltar(contenedor.querySelector('.lienzo-dibujo'), {
      x: 120, y: 80, carga: { taskName: 'CARGA_VENTAS', taskGuid: 'g-1', type: 'PROCESS' },
    })
    await avanzar(700)

    const [nuevo] = ultimaGuardada().nodes
    expect(nuevo).toMatchObject({ type: 'task' })
    expect(nuevo.parentId).toBeUndefined()
    expect(nuevo.data).toMatchObject({
      taskName: 'CARGA_VENTAS', taskGuid: 'g-1', taskType: 'PROCESS', label: 'CARGA_VENTAS',
      agentName: null, profileName: null, errorStrategy: 'stop', maxRetries: 0, retryDelaySeconds: 30, globalVariables: [],
    })
  })

  it('si cae dentro de un grupo de primer nivel, nace como hijo suyo', async () => {
    await montar({ nodes: [grupo('g1', { position: { x: 0, y: 0 } })] })
    await soltar(contenedor.querySelector('.lienzo-dibujo'), { x: 100, y: 60, carga: { taskName: 'T', taskGuid: 'g-2' } })
    await avanzar(700)

    const hijo = ultimaGuardada().nodes.find((nodo) => nodo.id !== 'g1')
    expect(hijo.parentId).toBe('g1')
    expect(hijo.extent).toBe('parent')
  })

  it('una carga que no es de una tarea se ignora', async () => {
    await montar()
    await soltar(contenedor.querySelector('.lienzo-dibujo'), { x: 10, y: 10, carga: { cualquier: 'cosa' } })
    await avanzar(700)
    expect(onGuardar).not.toHaveBeenCalled()
  })

  it('con el lienzo bloqueado no suelta nada', async () => {
    Object.assign(ejecucionFalsa, { run: { status: 'running', nodes: {} }, enMarcha: true })
    await montar()
    await soltar(contenedor.querySelector('.lienzo-dibujo'), { x: 10, y: 10, carga: { taskName: 'T' } })
    await avanzar(700)
    expect(onGuardar).not.toHaveBeenCalled()
    expect(capturado.props.nodes).toHaveLength(0)
  })
})

describe('grupos', () => {
  it('«+ Nuevo grupo» crea uno de 300×180 llamado «Nuevo grupo»', async () => {
    await montar()
    await pulsar(boton('+ Nuevo grupo'))
    await avanzar(700)

    const [nuevo] = ultimaGuardada().nodes
    expect(nuevo.type).toBe('group')
    expect(nuevo.data.label).toBe('Nuevo grupo')
    expect(nuevo.style).toEqual({ width: 300, height: 180 })
  })

  it('un grupo redimensionado guarda su nuevo tamaño', async () => {
    await montar({ nodes: [grupo('g1')] })
    await act(async () => {
      capturado.props.onNodesChange([
        { id: 'g1', type: 'dimensions', resizing: true, setAttributes: true, dimensions: { width: 420, height: 260 } },
      ])
    })
    await avanzar(700)
    expect(ultimaGuardada().nodes[0].style).toMatchObject({ width: 420, height: 260 })
  })

  it('el nodo de grupo enseña su modo según las conexiones entre sus hijos', async () => {
    await montar({
      nodes: [
        grupo('g1'),
        tarea('h1', { parentId: 'g1', extent: 'parent' }),
        tarea('h2', { parentId: 'g1', extent: 'parent' }),
        tarea('h3', { parentId: 'g1', extent: 'parent' }),
      ],
      edges: [{ id: 'e-h1-h2', source: 'h1', target: 'h2' }],
    })
    expect(nodoEnPantalla('g1').textContent).toContain('⟛ Híbrido')

    await conectar('h2', 'h3')
    expect(nodoEnPantalla('g1').textContent).toContain('→ En secuencia')
  })

  it('«⊞ Auto Layout» ordena por columnas y guarda las nuevas posiciones', async () => {
    await montar({
      nodes: [tarea('a', { position: { x: 500, y: 500 } }), tarea('b', { position: { x: 1, y: 1 } })],
      edges: [{ id: 'e-a-b', source: 'a', target: 'b' }],
    })
    await pulsar(boton('⊞ Auto Layout'))
    await avanzar(700)

    const pos = Object.fromEntries(ultimaGuardada().nodes.map((nodo) => [nodo.id, nodo.position]))
    expect(pos.a).toEqual({ x: 40, y: 60 })
    expect(pos.b).toEqual({ x: 300, y: 60 })
  })
})

describe('renombrar', () => {
  const nombre = () => contenedor.querySelector('.lienzo-nombre')
  const campo = () => contenedor.querySelector('.lienzo-nombre-input')

  async function escribir(valor) {
    const input = campo()
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, valor)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  const tecla = (key) => act(async () => {
    campo().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })

  it('un clic en el nombre lo vuelve un campo, y Enter guarda el nuevo', async () => {
    await montar()
    expect(nombre().title).toBe('Click para editar')

    await pulsar(nombre())
    expect(campo().value).toBe('Carga diaria')

    await escribir('Carga semanal')
    await tecla('Enter')
    expect(onRenombrar).toHaveBeenCalledTimes(1)
    expect(onRenombrar).toHaveBeenCalledWith('Carga semanal')
    expect(campo()).toBeNull()
    expect(nombre().textContent).toBe('Carga semanal')
  })

  it('Escape cancela sin guardar', async () => {
    await montar()
    await pulsar(nombre())
    await escribir('Otro nombre')
    await tecla('Escape')
    expect(onRenombrar).not.toHaveBeenCalled()
    expect(nombre().textContent).toBe('Carga diaria')
  })

  it('al perder el foco guarda', async () => {
    await montar()
    await pulsar(nombre())
    await escribir('Por desenfoque')
    await act(async () => {
      campo().dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(onRenombrar).toHaveBeenCalledWith('Por desenfoque')
  })

  it('un nombre vacío o igual al de antes no guarda nada', async () => {
    await montar()
    await pulsar(nombre())
    await escribir('   ')
    await tecla('Enter')
    await pulsar(nombre())
    await tecla('Enter')
    expect(onRenombrar).not.toHaveBeenCalled()
  })

  it('si guardar el nombre falla, vuelve el anterior', async () => {
    onRenombrar.mockRejectedValue(new Error('no se pudo'))
    await montar()
    await pulsar(nombre())
    await escribir('Fallará')
    await tecla('Enter')
    await avanzar()
    expect(nombre().textContent).toBe('Carga diaria')
  })

  it('con una ejecución en marcha el nombre no se edita', async () => {
    Object.assign(ejecucionFalsa, { run: { status: 'running', nodes: {} }, enMarcha: true })
    await montar()
    expect(nombre().title).toBe('')
    await pulsar(nombre())
    expect(campo()).toBeNull()
  })
})

describe('el panel del nodo dentro del lienzo', () => {
  it('un grupo seleccionado solo muestra su nombre y la nota del orden', async () => {
    await montar({ nodes: [grupo('g1', { selected: true })] })
    await avanzar()
    expect(texto()).toContain('Nombre visible')
    expect(texto()).toContain('El orden lo determinan los edges entre sus tasks.')
    expect(texto()).not.toContain('En caso de error')
    expect(texto()).not.toContain('Variables globales')
  })

  it('la × cierra el panel', async () => {
    await montar({ nodes: [tarea('a', { selected: true })] })
    await avanzar()
    expect(texto()).toContain('⬡ Task')
    await pulsar(contenedor.querySelector('.cfg-cerrar'))
    await avanzar()
    expect(texto()).not.toContain('⬡ Task')
  })
})
