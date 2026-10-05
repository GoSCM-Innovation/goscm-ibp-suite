// @vitest-environment jsdom
//
// El editor del teléfono (revisión de paridad del 2026-10-05): ahora ejecuta, corta y enseña el
// resultado —monta la barra de ejecución y el detalle con el mismo gancho que el lienzo—, el nombre
// se toca para cambiarlo, cuenta «N/M» mientras corre, y su texto de «no se puede editar» es cierto.
// La barra y el detalle se sustituyen por muñecos: son de otro módulo y aquí se prueba que estén y
// reciban lo que deben.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let propsDeLaBarra = null
let propsDelDetalle = null
vi.mock('./RunBar.jsx', () => ({
  default: (props) => {
    propsDeLaBarra = props
    return createElement('div', { 'data-barra': true }, 'RunBar')
  },
}))
vi.mock('./RunDetail.jsx', () => ({
  default: (props) => {
    propsDelDetalle = props
    return createElement('div', { 'data-detalle': true }, 'RunDetail')
  },
}))

let ejecucion
const useOrchestrationRun = vi.fn(() => ejecucion)
vi.mock('./useOrchestrationRun.js', () => ({
  useOrchestrationRun: (...args) => useOrchestrationRun(...args),
}))

const { default: MobileEditor } = await import('./MobileEditor.jsx')

const DESTINO = { id: 'c1:sandbox', connectionId: 'c1', production: false, name: 'CLARO' }

const paso = (id, nombre, datos = {}) => ({
  id, type: 'task', position: { x: 0, y: 0 }, data: { taskName: nombre, label: nombre, errorStrategy: 'stop', ...datos },
})
const cadena = {
  id: 'o1',
  name: 'Carga diaria',
  nodes: [paso('a', 'EXTRAER'), paso('b', 'CARGAR')],
  edges: [{ id: 'e-a-b', source: 'a', target: 'b' }],
}
const conRamas = {
  id: 'o2',
  name: 'Con ramas',
  nodes: [paso('a', 'A'), paso('b', 'B'), paso('c', 'C')],
  edges: [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'a', target: 'c' }],
}

let contenedor
let raiz

// Un muñeco de la paleta: un botón que «elige» una tarea y avisa con los datos que daría la de verdad.
const Paleta = (props) => createElement('button', {
  type: 'button',
  'data-paleta': props.movil ? 'movil' : 'escritorio',
  onClick: () => props.onAgregar({ taskName: 'NUEVA_TAREA', taskGuid: 'g9', label: 'NUEVA_TAREA', globalVariables: [] }),
}, 'Elegir NUEVA_TAREA')

async function montar(props = {}) {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(MobileEditor, {
      destino: DESTINO,
      orquestacion: cadena,
      onGuardar: vi.fn().mockResolvedValue(undefined),
      guardando: false,
      error: '',
      Paleta,
      transportadas: null,
      onRenombrar: vi.fn().mockResolvedValue(undefined),
      onSinGuardar: vi.fn(),
      leerRegistro: vi.fn(),
      ...props,
    }))
  })
}

beforeEach(() => {
  propsDeLaBarra = null
  propsDelDetalle = null
  useOrchestrationRun.mockClear()
  ejecucion = {
    run: null, error: '', ocupado: false, enMarcha: false,
    arrancar: vi.fn(), cortar: vi.fn(), retomar: vi.fn(),
  }
})

afterEach(() => {
  act(() => raiz?.unmount())
  contenedor?.remove()
  vi.restoreAllMocks()
})

const texto = () => contenedor.textContent
const boton = (contiene) => [...contenedor.querySelectorAll('button')].find((uno) => uno.textContent.includes(contiene))
const clic = (elemento) => act(async () => { elemento.click() })
const cabecerasDePaso = () => [...contenedor.querySelectorAll('.movil-paso-cabeza')]

async function escribir(campo, valor) {
  await act(async () => {
    const propio = campo instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement
    Object.getOwnPropertyDescriptor(propio.prototype, 'value').set.call(campo, valor)
    campo.dispatchEvent(new Event(campo instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

describe('ejecutar y ver el resultado', () => {
  it('monta la barra de ejecución y el detalle, con el gancho del lienzo', async () => {
    await montar()

    expect(texto()).toContain('RunBar')
    expect(texto()).toContain('RunDetail')
    expect(useOrchestrationRun).toHaveBeenCalledWith('o1', 'Carga diaria')
    expect(propsDeLaBarra).toMatchObject({
      run: null, enMarcha: false, sinGuardar: false, destino: DESTINO,
      onArrancar: ejecucion.arrancar, onCortar: ejecucion.cortar, onRetomar: ejecucion.retomar,
    })
    expect(propsDeLaBarra.grafo.nodes.map((nodo) => nodo.id)).toEqual(['a', 'b'])
    expect(propsDeLaBarra.grafo.edges).toHaveLength(1)
    expect(propsDelDetalle.run).toBeNull()
    expect(propsDelDetalle.orquestacion.nodes.map((nodo) => nodo.id)).toEqual(['a', 'b'])
  })

  it('le pasa a la barra lo que el gancho sabe de la corrida', async () => {
    ejecucion = { ...ejecucion, run: { status: 'error', nodes: {} }, error: 'se cayó', ocupado: true }
    await montar()
    expect(propsDeLaBarra).toMatchObject({ run: ejecucion.run, error: 'se cayó', ocupado: true })
    expect(propsDelDetalle.run).toBe(ejecucion.run)
  })

  it('con cambios sin guardar la barra lo sabe, y avisa a quien pregunta antes de descartar', async () => {
    const onSinGuardar = vi.fn()
    await montar({ onSinGuardar })
    expect(propsDeLaBarra.sinGuardar).toBe(false)

    await clic(cabecerasDePaso()[0])
    await clic(boton('↓ Bajar'))
    expect(propsDeLaBarra.sinGuardar).toBe(true)
    expect(onSinGuardar).toHaveBeenLastCalledWith(true)
    expect(texto()).toContain('sin guardar')
  })

  it('guardar manda el grafo y apaga la marca', async () => {
    const onGuardar = vi.fn().mockResolvedValue(undefined)
    const onSinGuardar = vi.fn()
    await montar({ onGuardar, onSinGuardar })

    await clic(cabecerasDePaso()[0])
    await clic(boton('↓ Bajar'))
    await clic(boton('Guardar'))
    await act(async () => { await Promise.resolve() })

    const [grafo] = onGuardar.mock.calls[0]
    expect(grafo.nodes.map((nodo) => nodo.id)).toEqual(['b', 'a'])
    expect(grafo.edges).toEqual([{ id: 'e-b-a', source: 'b', target: 'a' }])
    expect(onSinGuardar).toHaveBeenLastCalledWith(false)
    expect(propsDeLaBarra.sinGuardar).toBe(false)
  })

  it('una orquestación con ramas también se ejecuta desde aquí, y el texto lo dice con verdad', async () => {
    await montar({ orquestacion: conRamas })

    expect(texto()).toContain('Esta orquestación no se puede editar desde el teléfono')
    expect(texto()).toContain('Se puede ejecutar y ver el resultado desde aquí')
    expect(texto()).toContain('RunBar')
    expect(texto()).toContain('RunDetail')
    // Y no ofrece editar lo que no puede.
    expect(boton('Guardar')).toBeUndefined()
    expect(boton('Agregar paso')).toBeUndefined()
  })
})

describe('la cabecera', () => {
  it('el nombre se toca para cambiarlo, con prompt como v9', async () => {
    const onRenombrar = vi.fn().mockResolvedValue(undefined)
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('  Carga nocturna ')
    await montar({ onRenombrar })

    await clic(contenedor.querySelector('.movil-nombre'))
    expect(prompt).toHaveBeenCalledWith('Nuevo nombre de la orquestación:', 'Carga diaria')
    expect(onRenombrar).toHaveBeenCalledWith('Carga nocturna')
  })

  it('cancelar, dejarlo vacío o no cambiarlo no pide nada', async () => {
    const onRenombrar = vi.fn()
    const prompt = vi.spyOn(window, 'prompt')
    await montar({ onRenombrar })

    for (const respuesta of [null, '   ', 'Carga diaria']) {
      prompt.mockReturnValue(respuesta)
      await clic(contenedor.querySelector('.movil-nombre'))
    }
    expect(onRenombrar).not.toHaveBeenCalled()
  })

  it('si el servidor rechaza el nombre, el motivo se ve', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Otra')
    await montar({ onRenombrar: vi.fn().mockRejectedValue(new Error('Ese nombre ya existe')) })

    await clic(contenedor.querySelector('.movil-nombre'))
    await act(async () => { await Promise.resolve() })
    expect(texto()).toContain('Ese nombre ya existe')
  })

  it('mientras corre el nombre no se toca y se ve el avance «N/M»', async () => {
    ejecucion = {
      ...ejecucion,
      enMarcha: true,
      run: { status: 'running', nodes: {
        a: { status: 'success' }, b: { status: 'running' }, c: { status: 'pending' },
      } },
    }
    await montar()

    expect(contenedor.querySelector('.movil-nombre').disabled).toBe(true)
    expect(contenedor.querySelector('.movil-cuenta').textContent).toBe('1/3')
  })

  it('sin correr no hay contador', async () => {
    ejecucion = { ...ejecucion, run: { status: 'success', nodes: { a: { status: 'success' } } } }
    await montar()
    expect(contenedor.querySelector('.movil-cuenta')).toBeNull()
  })

  it('mientras corre no se edita nada', async () => {
    ejecucion = { ...ejecucion, enMarcha: true, run: { status: 'running', nodes: { a: { status: 'running' } } } }
    await montar()
    await clic(cabecerasDePaso()[0])

    expect(boton('↓ Bajar').disabled).toBe(true)
    expect(boton('Quitar').disabled).toBe(true)
    expect(boton('Agregar paso').disabled).toBe(true)
    expect(boton('Guardar').disabled).toBe(true)
  })
})

describe('los campos del paso', () => {
  it('«Reintenta» muestra los intentos y la espera entre ellos', async () => {
    await montar({ orquestacion: { ...cadena, nodes: [paso('a', 'EXTRAER', { errorStrategy: 'retry', maxRetries: 2, retryDelaySeconds: 90 }), cadena.nodes[1]], edges: cadena.edges } })
    await clic(cabecerasDePaso()[0])

    expect(contenedor.querySelector('#m-intentos-a').value).toBe('2')
    const espera = contenedor.querySelector('#m-espera-a')
    expect(espera.value).toBe('90')
    expect(texto()).toContain('Espera (segundos)')

    await escribir(espera, '120')
    expect(contenedor.querySelector('#m-espera-a').value).toBe('120')
    expect(propsDeLaBarra.grafo.nodes[0].data.retryDelaySeconds).toBe(120)
  })

  it('con «Para la orquestación» no hay intentos ni espera', async () => {
    await montar()
    await clic(cabecerasDePaso()[0])
    expect(contenedor.querySelector('#m-intentos-a')).toBeNull()
    expect(contenedor.querySelector('#m-espera-a')).toBeNull()
  })

  it('las variables globales se agregan, se escriben y se quitan', async () => {
    await montar()
    await clic(cabecerasDePaso()[0])

    await clic(boton('+ Agregar variable'))
    const [nombre, valor] = contenedor.querySelectorAll('.movil-variable input')
    await escribir(nombre, 'FECHA')
    await escribir(valor, '20260804')
    expect(propsDeLaBarra.grafo.nodes[0].data.globalVariables).toEqual([{ name: 'FECHA', value: '20260804' }])

    await clic(contenedor.querySelector('[title="Quitar la variable"]'))
    expect(propsDeLaBarra.grafo.nodes[0].data.globalVariables).toEqual([])
  })

  it('un paso de IBP no muestra variables globales, como el panel del lienzo', async () => {
    const deIbp = { ...cadena, nodes: [paso('a', 'ZJOB', { templateName: 'ZJOB' }), cadena.nodes[1]] }
    await montar({ orquestacion: deIbp })
    await clic(cabecerasDePaso()[0])
    expect(texto()).not.toContain('Variables globales')
  })
})

describe('agregar un paso', () => {
  it('abre la paleta del teléfono; elegir una tarea la suma al final y queda sin guardar', async () => {
    const onSinGuardar = vi.fn()
    await montar({ onSinGuardar })

    await clic(boton('+ Agregar paso'))
    expect(contenedor.querySelector('[data-paleta="movil"]')).toBeTruthy()

    await clic(contenedor.querySelector('[data-paleta]'))
    expect(contenedor.querySelector('[data-paleta]')).toBeNull()
    expect(cabecerasDePaso().map((c) => c.querySelector('.movil-paso-nombre').textContent))
      .toEqual(['EXTRAER', 'CARGAR', 'NUEVA_TAREA'])

    const { nodes, edges } = propsDeLaBarra.grafo
    expect(nodes[2].data).toMatchObject({ taskName: 'NUEVA_TAREA', errorStrategy: 'stop', maxRetries: 0, retryDelaySeconds: 30 })
    expect(edges.map((e) => [e.source, e.target])).toEqual([['a', 'b'], ['b', nodes[2].id]])
    expect(onSinGuardar).toHaveBeenLastCalledWith(true)
  })
})
