// @vitest-environment jsdom
//
// La paleta de tareas con la forma de v9 (revisión de paridad del 2026-10-05): título, buscador,
// proyectos que se fijan y se filtran, panel que se contrae, asa para el ancho y chips que se
// arrastran al lienzo además de agregarse con un clic.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cidsCall = vi.fn()
vi.mock('../../../lib/cids.js', () => ({
  cidsCall: (...args) => cidsCall(...args),
  isTaskPromoted: (promovidas, nombre) => Boolean(promovidas?.has(String(nombre ?? '').trim().toUpperCase())),
}))

const { default: TaskPalette } = await import('./TaskPalette.jsx')

const DESTINO = { id: 'c1:sandbox', connectionId: 'c1', production: false, name: 'CLARO', label: 'CLARO · Sandbox' }
const CLAVE = 'ibp.cids.paleta-fijados.c1:sandbox'

const PROYECTOS = [{ guid: 'p1', name: 'Ventas' }, { guid: 'p2', name: 'Compras' }]
const TAREAS = {
  p1: [
    { taskGuid: 't1', taskName: 'CARGA_VENTAS', type: 'TASK', description: 'Carga las ventas' },
    { taskGuid: 't2', taskName: 'PROCESO_CIERRE', type: 'PROCESS' },
  ],
  p2: [],
}

let contenedor
let raiz

const esperar = () => act(async () => { await Promise.resolve() })

async function montar(props = {}) {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(TaskPalette, {
      destino: DESTINO, onAgregar: () => {}, onAgregarGrupo: undefined, transportadas: null, ...props,
    }))
  })
  await esperar()
}

beforeEach(() => {
  localStorage.clear()
  cidsCall.mockReset()
  cidsCall.mockImplementation(async (_destino, operacion, parametros) => {
    if (operacion === 'getProjects') return PROYECTOS
    if (operacion === 'getProjectTasks') return TAREAS[parametros.projectGuid]
    return []
  })
})

afterEach(() => {
  act(() => raiz?.unmount())
  contenedor?.remove()
  vi.restoreAllMocks()
})

const texto = () => contenedor.textContent
const porTitulo = (titulo) => contenedor.querySelector(`[title="${titulo}"]`)
const clic = (elemento) => act(async () => { elemento.click() })
const proyecto = (nombre) => [...contenedor.querySelectorAll('.paleta-proyecto')].find((uno) => uno.textContent.includes(nombre))
const chips = () => [...contenedor.querySelectorAll('.paleta-tarea')]

async function abrir(nombre) {
  await clic(proyecto(nombre))
  await esperar()
}

describe('el aspecto de v9', () => {
  it('se llama «Task Palette», con el buscador de v9 y los proyectos del repositorio', async () => {
    await montar()
    expect(contenedor.querySelector('.paleta-titulo').textContent).toBe('Task Palette')
    expect(contenedor.querySelector('input').placeholder).toBe('Buscar proyectos o tasks…')
    expect(texto()).toContain('Ventas')
    expect(texto()).toContain('Compras')
  })

  it('mientras llegan los proyectos dice «Cargando proyectos…»', async () => {
    cidsCall.mockReturnValue(new Promise(() => {}))
    await montar()
    expect(texto()).toContain('Cargando proyectos…')
  })

  it('sin proyectos dice «Sin proyectos»', async () => {
    cidsCall.mockResolvedValue([])
    await montar()
    expect(texto()).toContain('Sin proyectos')
  })

  it('un proyecto sin tareas dice «Sin tasks»', async () => {
    await montar()
    await abrir('Compras')
    expect(texto()).toContain('Sin tasks')
  })

  it('si los proyectos no llegan, el error se ve', async () => {
    cidsCall.mockRejectedValue(new Error('SAP no responde'))
    await montar()
    expect(texto()).toContain('✕ SAP no responde')
  })

  it('«+ Nuevo grupo» avisa al lienzo', async () => {
    const onAgregarGrupo = vi.fn()
    await montar({ onAgregarGrupo })
    await clic(contenedor.querySelector('.paleta-grupo'))
    expect(contenedor.querySelector('.paleta-grupo').textContent).toBe('+ Nuevo grupo')
    expect(onAgregarGrupo).toHaveBeenCalledTimes(1)
  })

  it('sin lienzo que reciba grupos, no hay botón de grupo', async () => {
    await montar()
    expect(contenedor.querySelector('.paleta-grupo')).toBeNull()
  })
})

describe('los chips de tarea', () => {
  it('llevan el grip, la insignia de tipo y el nombre; PROCESS se pinta aparte', async () => {
    await montar()
    await abrir('Ventas')

    expect(chips()).toHaveLength(2)
    expect(chips()[0].querySelector('.paleta-grip').textContent).toBe('⠿')
    expect(chips()[0].querySelector('.type-badge').textContent).toBe('TASK')
    expect(chips()[0].querySelector('.type-badge').classList.contains('process')).toBe(false)
    expect(chips()[1].querySelector('.type-badge').textContent).toBe('PROCESS')
    expect(chips()[1].querySelector('.type-badge').classList.contains('process')).toBe(true)
  })

  it('el title lleva el nombre y, debajo, la descripción', async () => {
    await montar()
    await abrir('Ventas')
    expect(chips()[0].title).toBe('CARGA_VENTAS\n\nCarga las ventas')
    expect(chips()[1].title).toBe('PROCESO_CIERRE')
  })

  it('las ya transportadas llevan «PRD»', async () => {
    await montar({ transportadas: new Set(['CARGA_VENTAS']) })
    await abrir('Ventas')
    expect(chips()[0].querySelector('.promoted-badge')).toBeTruthy()
    expect(chips()[1].querySelector('.promoted-badge')).toBeNull()
  })

  it('son arrastrables y llevan la tarea en application/x-orch-task', async () => {
    await montar()
    await abrir('Ventas')
    expect(chips()[0].draggable).toBe(true)

    const dataTransfer = { setData: vi.fn(), effectAllowed: '' }
    const evento = new Event('dragstart', { bubbles: true })
    Object.defineProperty(evento, 'dataTransfer', { value: dataTransfer })
    await act(async () => { chips()[0].dispatchEvent(evento) })

    expect(dataTransfer.setData).toHaveBeenCalledWith(
      'application/x-orch-task',
      JSON.stringify({ taskName: 'CARGA_VENTAS', taskGuid: 't1', type: 'TASK' }),
    )
  })

  it('un clic (o Enter) agrega el paso con los datos de la tarea', async () => {
    const onAgregar = vi.fn()
    await montar({ onAgregar })
    await abrir('Ventas')

    await clic(chips()[0])
    expect(onAgregar).toHaveBeenCalledWith({
      taskName: 'CARGA_VENTAS',
      taskGuid: 't1',
      taskType: 'TASK',
      label: 'CARGA_VENTAS',
      agentName: null,
      profileName: null,
      globalVariables: [],
    })

    await act(async () => { chips()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(onAgregar).toHaveBeenCalledTimes(2)
  })

  it('la búsqueda encuentra una tarea de un proyecto ya abierto', async () => {
    await montar()
    await abrir('Ventas')
    const buscador = contenedor.querySelector('input')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(buscador, 'cierre')
      buscador.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(texto()).not.toContain('Compras')
    expect(chips().map((chip) => chip.textContent)).toEqual([expect.stringContaining('PROCESO_CIERRE')])
  })
})

describe('fijar proyectos', () => {
  it('📌 fija, el título cambia y se recuerda por destino', async () => {
    await montar()
    await clic(porTitulo('Fijar proyecto'))

    expect(contenedor.querySelectorAll('[title="Quitar de fijados"]')).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem(CLAVE))).toEqual(['p1'])
    expect(porTitulo('Filtrar por proyectos fijados (1)').textContent).toContain('1')
  })

  it('lo fijado de antes se lee al montar', async () => {
    localStorage.setItem(CLAVE, JSON.stringify(['p2']))
    await montar()
    expect(contenedor.querySelectorAll('[title="Quitar de fijados"]')).toHaveLength(1)
    expect(porTitulo('Filtrar por proyectos fijados (1)')).toBeTruthy()
  })

  it('el filtro deja solo los fijados y dice cuántos hay; «Limpiar» los olvida', async () => {
    localStorage.setItem(CLAVE, JSON.stringify(['p2']))
    await montar()

    await clic(porTitulo('Filtrar por proyectos fijados (1)'))
    expect(texto()).not.toContain('Ventas')
    expect(texto()).toContain('Compras')
    expect(texto()).toContain('1 proyecto fijado')
    expect(porTitulo('Mostrando solo proyectos fijados — clic para ver todos')).toBeTruthy()

    await clic(porTitulo('Quitar todos los fijados'))
    expect(texto()).toContain('Ventas')
    expect(localStorage.getItem(CLAVE)).toBeNull()
    expect(texto()).not.toContain('Limpiar')
  })

  it('con dos fijados dice «2 proyectos fijados»', async () => {
    localStorage.setItem(CLAVE, JSON.stringify(['p1', 'p2']))
    await montar()
    await clic(porTitulo('Filtrar por proyectos fijados (2)'))
    expect(texto()).toContain('2 proyectos fijados')
  })

  it('fijados Y una búsqueda sin coincidencias dice «Sin proyectos fijados coincidentes»', async () => {
    localStorage.setItem(CLAVE, JSON.stringify(['p2']))
    await montar()
    await clic(porTitulo('Filtrar por proyectos fijados (1)'))
    const buscador = contenedor.querySelector('input')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(buscador, 'ventas')
      buscador.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(texto()).toContain('Sin proyectos fijados coincidentes')
  })

  it('con el almacenamiento bloqueado la paleta sigue funcionando', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado') })
    await montar()

    await clic(porTitulo('Fijar proyecto'))
    expect(contenedor.querySelectorAll('[title="Quitar de fijados"]')).toHaveLength(1)
  })
})

describe('contraer y ancho', () => {
  it('«‹» deja una barra «TASKS» con «›»; al tocarla vuelve', async () => {
    await montar()
    await clic(porTitulo('Contraer panel'))

    const barra = porTitulo('Expandir panel de tasks')
    expect(barra.textContent).toContain('TASKS')
    expect(barra.textContent).toContain('›')
    expect(contenedor.querySelector('.paleta-titulo')).toBeNull()

    await clic(barra)
    expect(contenedor.querySelector('.paleta-titulo')).toBeTruthy()
  })

  it('arranca en 210 px y el asa lo cambia entre 160 y 520', async () => {
    await montar()
    const paleta = contenedor.querySelector('.paleta')
    expect(paleta.style.width).toBe('210px')

    const asa = contenedor.querySelector('.paleta-asa')
    await act(async () => { asa.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 200 })) })
    await act(async () => { document.dispatchEvent(new MouseEvent('mousemove', { clientX: 260 })) })
    expect(paleta.style.width).toBe('270px')

    await act(async () => { document.dispatchEvent(new MouseEvent('mousemove', { clientX: 2000 })) })
    expect(paleta.style.width).toBe('520px')
    await act(async () => { document.dispatchEvent(new MouseEvent('mousemove', { clientX: -2000 })) })
    expect(paleta.style.width).toBe('160px')

    await act(async () => { document.dispatchEvent(new MouseEvent('mouseup')) })
    await act(async () => { document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 })) })
    expect(paleta.style.width).toBe('160px')
  })
})

describe('en el diálogo del teléfono', () => {
  it('no se contrae, no tiene asa y sus chips se tocan en vez de arrastrarse', async () => {
    await montar({ movil: true })
    await abrir('Ventas')

    expect(porTitulo('Contraer panel')).toBeNull()
    expect(contenedor.querySelector('.paleta-asa')).toBeNull()
    expect(contenedor.querySelector('.paleta').style.width).toBe('')
    expect(chips()[0].draggable).toBe(false)
    expect(chips()[0].querySelector('.paleta-grip')).toBeNull()
  })
})
