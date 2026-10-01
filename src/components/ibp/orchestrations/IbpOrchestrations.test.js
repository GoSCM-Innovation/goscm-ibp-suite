// @vitest-environment jsdom
//
// El Orquestador de IBP montado de verdad: que los controles de v8 hagan lo que dicen contra la API
// de la plataforma. Es la prueba de «correr la pantalla»: una función escrita que ningún control
// llama no la detecta ninguna prueba de `core/`.
//
// Se monta con `react-dom` a secas y `createElement`, como las demás pruebas de pantalla.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const orq = vi.hoisted(() => ({
  listOrchestrations: vi.fn(),
  createOrchestration: vi.fn(),
  saveOrchestration: vi.fn(),
  duplicateOrchestration: vi.fn(),
  deleteOrchestration: vi.fn(),
  getRun: vi.fn(),
  startRun: vi.fn(),
  cancelRun: vi.fn(),
  tickRun: vi.fn(),
}))

vi.mock('../../../lib/orchestrations.js', async (importOriginal) => ({ ...(await importOriginal()), ...orq }))
vi.mock('../../../lib/ibp-jobs.js', () => ({
  fetchJobTemplateSet: vi.fn(async () => [
    { JobTemplateName: 'ZCARGA', JobTemplateText: 'Carga diaria' },
    { JobTemplateName: 'ZPLAN', JobTemplateText: 'Planificación' },
  ]),
  fetchTemplateSequences: vi.fn(async () => []),
}))

const { default: IbpOrchestrations } = await import('./IbpOrchestrations.jsx')

const CONEXION = { id: 'conn-1', name: 'IBP QA', isProduction: false, agreements: ['SAP_COM_0326'] }

const GUARDADA = {
  id: 'o1',
  name: 'Cierre mensual',
  createdAt: '2026-09-01T10:00:00Z',
  nodes: [{ id: 's1', type: 'task', data: { templateName: 'ZCARGA', jobText: 'Carga diaria', errorStrategy: 'stop', maxRetries: 3, retryDelaySeconds: 60 } }],
  edges: [],
}

let contenedor
let raiz

async function montar() {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(IbpOrchestrations, { connection: CONEXION }))
  })
}

const boton = (texto) => [...contenedor.querySelectorAll('button')].find((uno) => uno.textContent.trim() === texto)
const conTexto = (texto) => contenedor.textContent.includes(texto)
const esperar = (ms) => act(() => new Promise((resolver) => { setTimeout(resolver, ms) }))

const pulsar = async (elemento) => {
  await act(async () => {
    elemento.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

const escribir = async (campo, texto) => {
  const asignar = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  await act(async () => {
    asignar.call(campo, texto)
    campo.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  orq.listOrchestrations.mockResolvedValue([GUARDADA])
  orq.getRun.mockResolvedValue(null)
  orq.saveOrchestration.mockImplementation(async (id, cambios) => ({ ...GUARDADA, id, ...cambios }))
})

afterEach(async () => {
  await act(async () => { raiz.unmount() })
  contenedor.remove()
})

describe('Orquestador de IBP', () => {
  it('lista las orquestaciones con sus pasos y la fecha, y la vacía tiene su panel', async () => {
    await montar()
    expect(conTexto('Cierre mensual')).toBe(true)
    expect(conTexto('1 paso · ')).toBe(true)
    expect(conTexto('Orquestador de Jobs')).toBe(true)
  })

  it('abrir una muestra su secuencia y la paleta de Job Templates', async () => {
    await montar()
    await pulsar([...contenedor.querySelectorAll('span')].find((s) => s.textContent === 'Cierre mensual'))

    expect(conTexto('Carga diaria')).toBe(true)
    expect(conTexto('Job Templates')).toBe(true)
    expect(boton('▶ Ejecutar').disabled).toBe(false)
  })

  it('crea con el modal y la deja abierta, vacía', async () => {
    orq.createOrchestration.mockResolvedValue({ id: 'o2', name: 'Nueva', createdAt: '2026-10-01T10:00:00Z', nodes: [], edges: [] })
    await montar()

    await pulsar(boton('+ Nueva orquestación'))
    await escribir(contenedor.querySelector('input[placeholder="Nombre de la orquestación…"]'), 'Nueva')
    await pulsar(boton('Crear'))

    expect(orq.createOrchestration).toHaveBeenCalledWith({ connectionId: 'conn-1', production: false }, 'Nueva')
    expect(conTexto('Sin pasos configurados.')).toBe(true)
    expect(boton('▶ Ejecutar').disabled).toBe(true)
  })

  // Sin botón de «Guardar», como v8: el paso llega al servidor con su plantilla.
  it('agregar un template se guarda solo, con la plantilla', async () => {
    await montar()
    await pulsar([...contenedor.querySelectorAll('span')].find((s) => s.textContent === 'Cierre mensual'))
    await esperar(0)

    const mas = [...contenedor.querySelectorAll('button')].filter((b) => b.textContent === '+' && b.title === 'Agregar a la secuencia')
    await pulsar(mas[1])
    expect(conTexto('2. ')).toBe(false) // aún en el editor, no en la ejecución
    await esperar(800)

    expect(orq.saveOrchestration).toHaveBeenCalledTimes(1)
    const [id, cambios] = orq.saveOrchestration.mock.calls[0]
    expect(id).toBe('o1')
    expect(cambios.nodes.map((n) => n.data.templateName)).toEqual(['ZCARGA', 'ZPLAN'])
    expect(cambios.edges.map((e) => [e.source, e.target])).toEqual([['s1', cambios.nodes[1].id]])
  })

  it('ejecutar abre la ejecución y «Volver al editor» la cierra', async () => {
    const corriendo = {
      status: 'running', startedAt: '2026-10-01T10:00:00Z', finishedAt: null,
      nodes: { s1: { status: 'running', startedAt: '2026-10-01T10:00:00Z', sapRunId: 'J1|1', sapStatus: 'R', retryCount: 0 } },
    }
    const terminada = {
      ...corriendo, status: 'success', finishedAt: '2026-10-01T10:01:05Z',
      nodes: { s1: { ...corriendo.nodes.s1, status: 'success', sapStatus: 'F', finishedAt: '2026-10-01T10:01:05Z' } },
    }
    orq.startRun.mockResolvedValue(corriendo)
    orq.tickRun.mockResolvedValue(terminada)

    await montar()
    await pulsar([...contenedor.querySelectorAll('span')].find((s) => s.textContent === 'Cierre mensual'))
    await pulsar(boton('▶ Ejecutar'))
    await esperar(10)

    expect(orq.startRun).toHaveBeenCalledWith('o1', {})
    expect(orq.tickRun).toHaveBeenCalledWith('o1')
    expect(conTexto('Completado')).toBe(true)
    expect(conTexto('1m 5s')).toBe(true)
    expect(conTexto('Job: J1')).toBe(true)
    expect(conTexto('[F]')).toBe(true)
    expect(boton('▼ Steps SAP')).toBeTruthy()
    expect(localStorage.getItem('ibp_orch_run_conn-1')).toBe('o1')

    await pulsar(boton('← Volver al editor'))
    expect(conTexto('▶ Ejecutar')).toBe(true)
    expect(localStorage.getItem('ibp_orch_run_conn-1')).toBeNull()
  })

  it('al volver a la pestaña reabre la ejecución que quedó abierta', async () => {
    localStorage.setItem('ibp_orch_run_conn-1', 'o1')
    orq.getRun.mockResolvedValue({
      status: 'error', startedAt: '2026-10-01T10:00:00Z', finishedAt: '2026-10-01T10:00:30Z',
      nodes: { s1: { status: 'error', error: 'SAP: A', sapRunId: 'J1|1', sapStatus: 'A', retryCount: 0 } },
    })
    await montar()
    await esperar(0)

    expect(conTexto('SAP: A')).toBe(true)
    expect(boton('← Volver al editor')).toBeTruthy()
  })

  it('el borrado pide confirmación con el texto de v8', async () => {
    orq.deleteOrchestration.mockResolvedValue()
    await montar()
    await pulsar(contenedor.querySelector('button[title="Eliminar"]'))
    expect(conTexto('Esta acción no se puede deshacer. ¿Confirmas?')).toBe(true)
    await pulsar(boton('Eliminar'))
    expect(orq.deleteOrchestration).toHaveBeenCalledWith('o1')
    expect(conTexto('Sin orquestaciones. Crea la primera.')).toBe(true)
  })
})
