// @vitest-environment jsdom
//
// «Ejecutar task individual» con la forma de v9: el nodo da los valores iniciales, SAP da las
// opciones, y `runTask` se llama con las precauciones de `RunTaskModal`.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cidsCall = vi.fn()
vi.mock('../../../lib/cids.js', () => ({
  cidsCall: (...args) => cidsCall(...args),
}))

const { default: RunSingleModal } = await import('./RunSingleModal.jsx')

const DESTINO = { id: 'c1:sandbox', connectionId: 'c1', production: false }

const NODO = {
  id: 'n1',
  taskName: 'CARGA_VENTAS',
  taskGuid: 'G1',
  agentName: 'AG1',
  profileName: 'PERFIL_A',
  globalVariables: [{ name: 'FECHA', value: '20261005' }, { name: 'PAIS', value: '' }, { name: '', value: 'x' }],
}

let contenedor
let raiz

async function montar(nodo = NODO, onClose = vi.fn()) {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(RunSingleModal, { destino: DESTINO, nodo, onClose }))
  })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  return onClose
}

function sapDeMentira({ runTask = async () => ({ runId: '1234567' }) } = {}) {
  cidsCall.mockImplementation(async (_d, operacion, params) => {
    if (operacion === 'getAgents') return [{ agents: [{ guid: 'a1', name: 'AG1' }, { guid: 'a2', name: 'AG2' }] }, { agents: [{ guid: 'a3', name: 'AG3' }] }]
    if (operacion === 'getSystemConfigurations') return [{ guid: 'p1', name: 'PERFIL_A' }, { guid: 'p2', name: 'PERFIL_B' }]
    if (operacion === 'runTask') return runTask(params)
    throw new Error(`operación inesperada: ${operacion}`)
  })
}

beforeEach(() => { cidsCall.mockReset() })

afterEach(() => {
  act(() => raiz?.unmount())
  contenedor?.remove()
  vi.restoreAllMocks()
})

const texto = () => contenedor.textContent
const boton = (exacto) => [...contenedor.querySelectorAll('button')].find((b) => b.textContent === exacto)
const campo = (id) => contenedor.querySelector(`#${id}`)

async function elegir(select, valor) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, valor)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('los textos de v9', () => {
  it('título, nombre de la tarea, contadores y valores iniciales del nodo', async () => {
    sapDeMentira()
    await montar()

    expect(texto()).toContain('Ejecutar task individual')
    expect(texto()).toContain('CARGA_VENTAS')
    expect(texto()).toContain('Agente (3 disponibles)')
    expect(texto()).toContain('Configuración (2 disponibles)')
    expect(cidsCall).toHaveBeenCalledWith(DESTINO, 'getAgents', { activeOnly: false })

    expect(campo('ej-single-agente').value).toBe('AG1')
    expect(campo('ej-single-perfil').value).toBe('PERFIL_A')
    expect([...campo('ej-single-agente').options][0].textContent).toBe('— Default del sistema —')
    // Las variables con nombre se listan; la de nombre vacío no.
    expect(texto()).toContain('Variables: FECHA=20261005, PAIS=""')
    expect(boton('Cancelar')).toBeTruthy()
    expect(boton('▶ Ejecutar')).toBeTruthy()
  })

  it('un agente del nodo que SAP no lista sigue seleccionado', async () => {
    sapDeMentira()
    await montar({ ...NODO, agentName: 'AG_VIEJO' })
    expect(campo('ej-single-agente').value).toBe('AG_VIEJO')
  })

  it('mientras carga dice «Cargando…» y no deja ejecutar', async () => {
    cidsCall.mockImplementation(() => new Promise(() => {}))
    await montar()
    expect(texto()).toContain('Cargando…')
    expect(boton('▶ Ejecutar').disabled).toBe(true)
  })
})

describe('ejecutar', () => {
  it('llama a runTask con el nodo y NO manda la variable que quedó vacía', async () => {
    sapDeMentira()
    await montar()

    await act(async () => { boton('▶ Ejecutar').click() })

    const llamada = cidsCall.mock.calls.find(([, operacion]) => operacion === 'runTask')
    expect(llamada[0]).toBe(DESTINO)
    expect(llamada[2]).toEqual({
      taskName: 'CARGA_VENTAS',
      agentName: 'AG1',
      profileName: 'PERFIL_A',
      globalVariables: [{ name: 'FECHA', value: '20261005' }],
    })
  })

  it('con el agente y la configuración cambiados manda los nuevos; en «default» no manda ninguno', async () => {
    sapDeMentira()
    await montar()
    await elegir(campo('ej-single-agente'), 'AG3')
    await elegir(campo('ej-single-perfil'), '')

    await act(async () => { boton('▶ Ejecutar').click() })
    const params = cidsCall.mock.calls.find(([, operacion]) => operacion === 'runTask')[2]
    expect(params.agentName).toBe('AG3')
    expect(params).not.toHaveProperty('profileName')
  })

  it('el resultado dice «Iniciado — RunID: …», quita Ejecutar y el botón pasa a «Cerrar»', async () => {
    sapDeMentira()
    const onClose = await montar()
    await act(async () => { boton('▶ Ejecutar').click() })

    expect(texto()).toContain('Iniciado — RunID: 1234567')
    expect(boton('▶ Ejecutar')).toBeUndefined()
    expect(boton('Cancelar')).toBeUndefined()
    await act(async () => { boton('Cerrar').click() })
    expect(onClose).toHaveBeenCalled()
  })

  it('mientras envía dice «Iniciando…»', async () => {
    let soltar
    sapDeMentira({ runTask: () => new Promise((resolver) => { soltar = resolver }) })
    await montar()
    await act(async () => { boton('▶ Ejecutar').click() })

    expect(boton('Iniciando…').disabled).toBe(true)
    await act(async () => { soltar({ runId: '9' }); await Promise.resolve() })
    expect(texto()).toContain('RunID: 9')
  })

  it('un fallo de SAP se muestra y deja volver a intentar', async () => {
    sapDeMentira({ runTask: async () => { throw new Error('el agente no responde') } })
    await montar()
    await act(async () => { boton('▶ Ejecutar').click() })

    expect(contenedor.querySelector('.notice-error').textContent).toBe('el agente no responde')
    expect(boton('▶ Ejecutar').disabled).toBe(false)
    expect(boton('Cancelar')).toBeTruthy()
  })

  it('si no se pudieron cargar las listas lo dice y aun así se puede ejecutar', async () => {
    cidsCall.mockImplementation(async (_d, operacion) => {
      if (operacion === 'runTask') return { runId: '5' }
      throw new Error('sin red')
    })
    await montar()
    expect(texto()).toContain('Error al cargar desde SAP: sin red')
    await act(async () => { boton('▶ Ejecutar').click() })
    expect(texto()).toContain('RunID: 5')
  })
})
