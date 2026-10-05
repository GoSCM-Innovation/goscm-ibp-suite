// @vitest-environment jsdom
//
// El panel del nodo con la forma de v9: la rama del grupo, los campos del error, y las variables
// globales como desplegable con lo que SAP declara para la tarea.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cidsCall = vi.fn()
vi.mock('../../../lib/cids.js', () => ({
  cidsCall: (...args) => cidsCall(...args),
}))

const { default: NodeConfigPanel } = await import('./NodeConfigPanel.jsx')

const DESTINO = { id: 'c1:sandbox', connectionId: 'c1', production: false }

const tarea = (datos = {}) => ({
  id: 'n1',
  type: 'task',
  data: {
    taskName: 'CARGA_VENTAS',
    taskGuid: 'guid-1',
    label: 'Carga',
    errorStrategy: 'stop',
    maxRetries: 0,
    retryDelaySeconds: 30,
    globalVariables: [],
    ...datos,
  },
})
const grupo = () => ({ id: 'g1', type: 'group', data: { label: 'Mi grupo' } })

let contenedor
let raiz
let onCambiar
let onBorrar
let onCerrar

async function montar(nodo, extra = {}) {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(NodeConfigPanel, { destino: DESTINO, nodo, onCambiar, onBorrar, onCerrar, ...extra }))
  })
  await act(async () => { await Promise.resolve() })
}

const texto = () => contenedor.textContent
const boton = (contiene) => [...contenedor.querySelectorAll('button')].find((uno) => uno.textContent.includes(contiene))
const opciones = (selector) => [...contenedor.querySelectorAll(`${selector} option`)].map((o) => o.textContent)

async function elegir(select, valor) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, valor)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** Las respuestas de SAP por operación. */
function sap({ info = { globalVariables: [] }, buscadas = [] } = {}) {
  cidsCall.mockImplementation(async (_destino, operacion) => {
    if (operacion === 'getTaskInfo') return info
    if (operacion === 'searchTasks') return buscadas
    if (operacion === 'getAgents') return [{ agents: [{ name: 'AG1', guid: 'a1' }, { name: 'AG2', guid: 'a2' }] }]
    if (operacion === 'getSystemConfigurations') return [{ name: 'PRF1', guid: 'p1' }]
    return []
  })
}

beforeEach(() => {
  cidsCall.mockReset()
  onCambiar = vi.fn()
  onBorrar = vi.fn()
  onCerrar = vi.fn()
})

afterEach(() => {
  act(() => raiz?.unmount())
  contenedor?.remove()
  vi.restoreAllMocks()
})

describe('cabecera y rama de grupo', () => {
  it('una tarea dice «⬡ Task» y su nombre; la × cierra', async () => {
    sap()
    await montar(tarea())
    expect(texto()).toContain('⬡ Task')
    expect(contenedor.querySelector('.cfg-nombre').textContent).toBe('CARGA_VENTAS')
    await act(async () => { contenedor.querySelector('.cfg-cerrar').click() })
    expect(onCerrar).toHaveBeenCalledTimes(1)
  })

  it('un grupo solo muestra «Nombre visible» y la nota del orden, y no pide nada a SAP', async () => {
    sap()
    await montar(grupo())

    expect(texto()).toContain('⊞ Grupo')
    expect(texto()).toContain('Nombre visible')
    expect(texto()).toContain('El orden lo determinan los edges entre sus tasks.')
    expect(texto()).toContain('Sin edges → paralelo · Todos conectados → en secuencia · Mix → híbrido')
    expect(texto()).not.toContain('En caso de error')
    expect(texto()).not.toContain('Variables globales')
    expect(texto()).not.toContain('Agente')
    expect(cidsCall).not.toHaveBeenCalled()
  })

  it('«Eliminar nodo» avisa a quien está arriba', async () => {
    sap()
    await montar(grupo())
    await act(async () => { boton('Eliminar nodo').click() })
    expect(onBorrar).toHaveBeenCalledTimes(1)
  })

  it('el nombre visible se cambia y se avisa con todos los datos', async () => {
    sap()
    await montar(tarea())
    const campo = contenedor.querySelector('#cfg-etiqueta')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(campo, 'Otro')
      campo.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onCambiar).toHaveBeenCalledWith(expect.objectContaining({ label: 'Otro', taskName: 'CARGA_VENTAS' }))
  })
})

describe('en caso de error', () => {
  it('ofrece las tres opciones de v9', async () => {
    sap()
    await montar(tarea())
    expect(opciones('#cfg-falla')).toEqual(['Detener orquestación', 'Continuar al siguiente', 'Reintentar'])
  })

  it('los campos de reintento solo salen con «Reintentar» y llevan los topes de v9', async () => {
    sap()
    await montar(tarea())
    expect(texto()).not.toContain('Máx reintentos')

    await act(async () => { raiz.render(createElement(NodeConfigPanel, { destino: DESTINO, nodo: tarea({ errorStrategy: 'retry', maxRetries: 2, retryDelaySeconds: 40 }), onCambiar, onBorrar, onCerrar })) })
    expect(texto()).toContain('Máx reintentos')
    expect(texto()).toContain('Espera (seg)')
    const intentos = contenedor.querySelector('#cfg-intentos')
    const espera = contenedor.querySelector('#cfg-espera')
    expect([intentos.min, intentos.max, intentos.value]).toEqual(['1', '5', '2'])
    expect([espera.min, espera.max, espera.value]).toEqual(['5', '3600', '40'])
  })

  it('al elegir «Reintentar» con cero intentos sube a uno', async () => {
    sap()
    await montar(tarea())
    await elegir(contenedor.querySelector('#cfg-falla'), 'retry')
    expect(onCambiar).toHaveBeenCalledWith(expect.objectContaining({ errorStrategy: 'retry', maxRetries: 1 }))
  })

  it('conserva la ayuda bajo el campo', async () => {
    sap()
    await montar(tarea({ errorStrategy: 'continue' }))
    expect(texto()).toContain('El fallo se da por asumido y la cadena continúa.')
  })
})

describe('variables globales', () => {
  const info = {
    globalVariables: [
      { name: 'FECHA', description: 'Fecha de carga', defaultValue: '2026-01-01' },
      { name: 'ORG', description: '', defaultValue: 'MX' },
    ],
  }

  it('pide las variables de la tarea por su identificador y dice cuántas hay', async () => {
    sap({ info })
    await montar(tarea())
    expect(cidsCall).toHaveBeenCalledWith(DESTINO, 'getTaskInfo', { taskGuid: 'guid-1' })
    expect(texto()).toContain('Variables globales (2 disponibles)')
    expect(boton('+ Variable')).toBeDefined()
  })

  it('mientras llegan dice «cargando…» y no ofrece agregar', async () => {
    let resolver
    cidsCall.mockImplementation((_destino, operacion) => (
      operacion === 'getTaskInfo' ? new Promise((r) => { resolver = r }) : Promise.resolve([])
    ))
    await montar(tarea({ globalVariables: [{ name: 'FECHA', value: 'x' }] }))
    expect(texto()).toContain('Variables globales — cargando…')
    expect(texto()).toContain('Cargando variables…')
    expect(boton('+ Variable')).toBeUndefined()

    await act(async () => { resolver(info) })
    expect(texto()).toContain('Variables globales (2 disponibles)')
  })

  it('sin identificador busca la tarea por su nombre exacto', async () => {
    sap({
      info,
      buscadas: [{ taskName: 'CARGA_VENTAS_2', taskGuid: 'otro' }, { taskName: ' CARGA_VENTAS ', taskGuid: 'guid-exacto' }],
    })
    await montar(tarea({ taskGuid: null }))
    expect(cidsCall).toHaveBeenCalledWith(DESTINO, 'searchTasks', { nameFilter: 'CARGA_VENTAS' })
    expect(cidsCall).toHaveBeenCalledWith(DESTINO, 'getTaskInfo', { taskGuid: 'guid-exacto' })
    expect(texto()).toContain('(2 disponibles)')
  })

  it('si no encuentra la tarea, dice que hubo un error', async () => {
    sap({ buscadas: [{ taskName: 'OTRA', taskGuid: 'x' }] })
    await montar(tarea({ taskGuid: null }))
    expect(texto()).toContain('Variables globales — error al cargar')
    expect(texto()).toContain('No se pudieron cargar las variables del sistema.')
    expect(boton('+ Variable')).toBeUndefined()
  })

  it('si SAP falla, dice que hubo un error', async () => {
    cidsCall.mockImplementation(async (_d, operacion) => {
      if (operacion === 'getTaskInfo') throw new Error('SAP no responde')
      return []
    })
    await montar(tarea())
    expect(texto()).toContain('Variables globales — error al cargar')
    expect(texto()).toContain('Error SAP')
  })

  it('una tarea sin variables lo dice y no ofrece agregar', async () => {
    sap({ info: { globalVariables: [] } })
    await montar(tarea())
    expect(texto()).toContain('Este task no tiene variables globales en SAP.')
    expect(boton('+ Variable')).toBeUndefined()
  })

  it('cada fila es un desplegable «— Seleccionar —» con «nombre — descripción»', async () => {
    sap({ info })
    await montar(tarea({ globalVariables: [{ name: '', value: '' }] }))
    const [select] = contenedor.querySelectorAll('.cfg-variable select')
    expect([...select.options].map((o) => o.textContent)).toEqual(['— Seleccionar —', 'FECHA — Fecha de carga', 'ORG'])
  })

  it('al elegir una variable, el valor se precarga con el de SAP por omisión', async () => {
    sap({ info })
    await montar(tarea({ globalVariables: [{ name: '', value: '' }] }))
    const [select] = contenedor.querySelectorAll('.cfg-variable select')
    await elegir(select, 'FECHA')
    expect(onCambiar).toHaveBeenCalledWith(expect.objectContaining({
      globalVariables: [{ name: 'FECHA', value: '2026-01-01' }],
    }))
  })

  it('«+ Variable» agrega una fila vacía y la × la quita', async () => {
    sap({ info })
    await montar(tarea({ globalVariables: [{ name: 'FECHA', value: 'x' }] }))

    await act(async () => { boton('+ Variable').click() })
    expect(onCambiar).toHaveBeenLastCalledWith(expect.objectContaining({
      globalVariables: [{ name: 'FECHA', value: 'x' }, { name: '', value: '' }],
    }))

    await act(async () => { contenedor.querySelector('.cfg-quitar-variable').click() })
    expect(onCambiar).toHaveBeenLastCalledWith(expect.objectContaining({ globalVariables: [] }))
  })

  it('una variable que SAP ya no declara se conserva en la lista', async () => {
    sap({ info })
    await montar(tarea({ globalVariables: [{ name: 'VIEJA', value: '1' }] }))
    const [select] = contenedor.querySelectorAll('.cfg-variable select')
    expect([...select.options].map((o) => o.value)).toContain('VIEJA')
    expect(select.value).toBe('VIEJA')
  })
})

describe('lo que se conserva de antes', () => {
  it('el agente y la configuración del sistema se eligen de la lista de SAP', async () => {
    sap()
    await montar(tarea({ agentName: 'AG2' }))
    expect(opciones('#cfg-agente')).toEqual(['— Que lo decida CI-DS —', 'AG1', 'AG2'])
    expect(contenedor.querySelector('#cfg-agente').value).toBe('AG2')

    await elegir(contenedor.querySelector('#cfg-config'), 'PRF1')
    expect(onCambiar).toHaveBeenCalledWith(expect.objectContaining({ profileName: 'PRF1' }))
  })

  it('un paso de IBP no muestra variables, agente ni configuración y no pide nada a CI-DS', async () => {
    sap()
    await montar({ id: 'n2', type: 'task', data: { templateName: 'ZCARGA', jobText: 'Carga', errorStrategy: 'retry', maxRetries: 3, retryDelaySeconds: 60 } })
    expect(texto()).toContain('ZCARGA')
    expect(texto()).not.toContain('Variables globales')
    expect(texto()).not.toContain('Agente')
    expect(cidsCall).not.toHaveBeenCalled()
    // Los topes de v8 para IBP, no los de v9.
    expect(contenedor.querySelector('#cfg-intentos').max).toBe('10')
  })
})
