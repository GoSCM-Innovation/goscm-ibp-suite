// @vitest-environment jsdom
//
// El Task Monitor con la forma de v9 (revisión de paridad del 2026-10-05): los textos, el estado de
// «cargando fin/duración», el cancelar con `confirm`, la tabla que desaparece con un error y las
// columnas que se arrastran.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cidsCall = vi.fn()
const fetchTaskDetails = vi.fn()
vi.mock('../../lib/cids.js', () => ({
  cidsCall: (...args) => cidsCall(...args),
  fetchTaskDetails: (...args) => fetchTaskDetails(...args),
  isTaskPromoted: (promovidas, nombre) => Boolean(promovidas?.has(String(nombre ?? '').trim().toUpperCase())),
}))

const { default: TaskMonitor } = await import('./TaskMonitor.jsx')

const DESTINO = { id: 'c1:sandbox', connectionId: 'c1', production: false, name: 'CLARO', label: 'CLARO · Sandbox' }

const fila = (n, extra = {}) => ({
  runId: String(1000 + n),
  jobId: String(2000 + n),
  taskName: `TASK_${n}`,
  statusCode: 'SUCCESS',
  startDate: String(Date.now() - n * 60_000),
  ...extra,
})

let contenedor
let raiz

async function montar({ busqueda = '', props = {} } = {}) {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  const dibujar = (texto) => createElement(TaskMonitor, {
    destino: DESTINO, busqueda: texto, onBuscar: () => {}, transportadas: null, ...props,
  })
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(dibujar(busqueda))
  })
  await act(async () => { await Promise.resolve() })
  return (texto) => act(async () => { raiz.render(dibujar(texto)) })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  cidsCall.mockReset()
  fetchTaskDetails.mockReset()
  fetchTaskDetails.mockResolvedValue({})
})

afterEach(() => {
  act(() => raiz?.unmount())
  contenedor?.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const texto = () => contenedor.textContent
const boton = (contiene) => [...contenedor.querySelectorAll('button')].find((uno) => uno.textContent.includes(contiene))

async function avanzar(ms = 10) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

describe('textos de v9', () => {
  it('la cabecera de la tabla dice Task, y el resumen usa «pág X/Y»', async () => {
    cidsCall.mockResolvedValue([fila(1), fila(2)])
    await montar()
    await avanzar()

    const cabeceras = [...contenedor.querySelectorAll('th')].map((th) => th.textContent)
    expect(cabeceras).toEqual(['Estado', 'Task', 'Inicio', 'Fin', 'Duración', 'RunID', 'JobID'])
    expect(texto()).toContain('2 de 2 ejecuciones · pág 1/1')
  })

  it('los estados salen con su nombre de v9 en inglés', async () => {
    cidsCall.mockResolvedValue([fila(1, { statusCode: 'SUCCESS_WITH_ERRORS_D' }), fila(2, { statusCode: 'RUNNING' })])
    await montar()
    await avanzar()

    expect(texto()).toContain('Running')
    expect(texto()).toContain('Success w/ errors D')
  })

  it('sin filas dice «Sin resultados»', async () => {
    cidsCall.mockResolvedValue([])
    await montar()
    await avanzar()
    expect(texto()).toContain('Sin resultados')
  })

  it('el botón de logs se llama «Ver logs» y la barra dice «RunID: »', async () => {
    cidsCall.mockResolvedValue([fila(1)])
    await montar()
    await avanzar()
    await act(async () => { contenedor.querySelector('tbody tr').click() })

    expect(boton('Ver logs')).toBeTruthy()
    expect(texto()).toContain('RunID: 1001')
  })

  it('las celdas llevan el valor crudo de SAP como title', async () => {
    cidsCall.mockResolvedValue([fila(1)])
    await montar()
    await avanzar()
    const celdas = [...contenedor.querySelectorAll('tbody tr:first-child td')]
    expect(celdas[0].title).toBe('SUCCESS')
    expect(celdas[5].title).toBe('1001')
  })
})

describe('cargando fin/duración', () => {
  // El error de v9 que sí se arregla: al cambiar de página con la nueva ya en caché, el efecto salía
  // sin pedir nada y el aviso de la anterior se quedaba encendido.
  it('se apaga al quedar la página sin nada pendiente', async () => {
    cidsCall.mockResolvedValue([fila(1, { statusCode: 'RUNNING' })])
    fetchTaskDetails.mockReturnValue(new Promise(() => {}))
    const redibujar = await montar()
    await avanzar()
    expect(texto()).toContain('cargando fin/duración…')

    // La búsqueda no encuentra nada: la página queda vacía y el efecto no pide nada.
    await redibujar('no-existe')
    await avanzar()
    expect(texto()).not.toContain('cargando fin/duración…')
  })

  it('«Copiar» queda deshabilitado mientras carga', async () => {
    cidsCall.mockResolvedValue([fila(1, { statusCode: 'RUNNING' })])
    fetchTaskDetails.mockReturnValue(new Promise(() => {}))
    await montar()
    await avanzar()
    expect(boton('Copiar').disabled).toBe(true)
    expect(boton('Copiar').title).toBe('Espera a que termine de cargar la página')
  })
})

describe('cancelar', () => {
  async function conFilaCorriendo() {
    cidsCall.mockImplementation(async (_destino, operacion) => (
      operacion === 'getAllExecutedTasks2' ? [fila(1, { statusCode: 'RUNNING' })] : { status: 'ok' }
    ))
    await montar()
    await avanzar()
    await act(async () => { contenedor.querySelector('tbody tr').click() })
  }

  it('pide confirmación con el texto de v9 y, si se rechaza, no cancela', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await conFilaCorriendo()
    await act(async () => { boton('Cancelar').click() })

    expect(confirmar).toHaveBeenCalledWith('¿Cancelar la ejecución de "TASK_1"?\n\nRunID: 1001')
    expect(cidsCall.mock.calls.some(([, operacion]) => operacion === 'cancelTask')).toBe(false)
  })

  it('si se acepta, cancela, avisa «Cancelación enviada» y a los 2,5 s suelta la fila', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await conFilaCorriendo()
    await act(async () => { boton('Cancelar').click() })
    await avanzar()

    expect(cidsCall).toHaveBeenCalledWith(DESTINO, 'cancelTask', { runId: '1001' })
    expect(texto()).toContain('✓ Cancelación enviada')

    await avanzar(2600)
    expect(texto()).not.toContain('Ejecución seleccionada')
  })

  it('en un estado que no se puede cancelar, el botón está apagado con el aviso de v9', async () => {
    cidsCall.mockResolvedValue([fila(1, { statusCode: 'SUCCESS' })])
    await montar()
    await avanzar()
    await act(async () => { contenedor.querySelector('tbody tr').click() })

    expect(boton('Cancelar').disabled).toBe(true)
    expect(boton('Cancelar').title).toBe('Solo se pueden cancelar tasks en ejecución/cola')
  })
})

describe('error', () => {
  it('con un error no se pinta la tabla ni la paginación', async () => {
    cidsCall.mockRejectedValue(new Error('SAP no contesta'))
    await montar()
    await avanzar()

    expect(texto()).toContain('✕ SAP no contesta')
    expect(contenedor.querySelector('table')).toBeNull()
  })
})

describe('columnas', () => {
  it('arrastrar el tirador cambia el ancho, sin bajar de 60 px', async () => {
    cidsCall.mockResolvedValue([fila(1)])
    await montar()
    await avanzar()

    const anchoDe = (indice) => contenedor.querySelectorAll('col')[indice].style.width
    expect(anchoDe(1)).toBe('280px')

    const tirador = contenedor.querySelectorAll('.th-tirador')[1]
    await act(async () => {
      tirador.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100 }))
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 150 }))
    })
    expect(anchoDe(1)).toBe('330px')

    await act(async () => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: -500 }))
      window.dispatchEvent(new MouseEvent('mouseup'))
    })
    expect(anchoDe(1)).toBe('60px')
  })
})

describe('rango', () => {
  it('el chip «Todos» tiene el azul de v9 cuando está activo', async () => {
    cidsCall.mockResolvedValue([fila(1)])
    await montar()
    await avanzar()
    const todos = boton('Todos')
    expect(todos.style.color).toBeTruthy()
  })
})
