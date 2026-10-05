// @vitest-environment jsdom
//
// La barra de ejecución y el diálogo de «Iniciar orquestación» con la forma de v9: los textos por
// estado, la guarda de tasks sueltas, «↺ Repetir», los presets de «Ejecución rápida» y la
// elección de agente, configuración y variables.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cidsCall = vi.fn()
vi.mock('../../../lib/cids.js', () => ({
  cidsCall: (...args) => cidsCall(...args),
}))

const { default: RunBar } = await import('./RunBar.jsx')

const DESTINO = { id: 'c1:sandbox', connectionId: 'c1', production: false, name: 'CLARO', label: 'CLARO · Sandbox' }

const tarea = (id, extra = {}, parentId) => ({
  id, type: 'task', ...(parentId ? { parentId } : {}), data: { taskName: `T_${id}`, ...extra },
})
const GRAFO = { nodes: [tarea('a', { taskGuid: 'G1' }), tarea('b', { taskGuid: 'G2' })], edges: [] }

const CORRIDA = (status, nodes = { a: { status: 'success' }, b: { status: 'running' } }) => ({
  status, startedAt: '2026-10-05T10:00:00.000Z', finishedAt: null, nodes,
})

/** SAP de mentira: dos agentes (uno desconectado), dos configuraciones y las variables de dos tareas. */
function sapDeMentira() {
  cidsCall.mockImplementation(async (_destino, operacion, params) => {
    if (operacion === 'getAgents') {
      return [{ agents: [
        { guid: 'a1', name: 'AG1', agentStatus: 'AGENT:CONNECTED' },
        { guid: 'a2', name: 'AG2', agentStatus: 'AGENT:DISCONNECTED' },
      ] }]
    }
    if (operacion === 'getSystemConfigurations') return [{ guid: 'p1', name: 'PERFIL_A' }, { guid: 'p2', name: 'PERFIL_B' }]
    if (operacion === 'getTaskInfo') {
      return params.taskGuid === 'G1'
        ? { globalVariables: [{ name: 'FECHA', description: 'Fecha de carga' }, { name: 'PAIS' }] }
        : { globalVariables: [{ name: 'PAIS' }, { name: 'MONEDA' }] }
    }
    throw new Error(`operación inesperada: ${operacion}`)
  })
}

let contenedor
let raiz

const propsBase = () => ({
  run: null, error: '', ocupado: false, enMarcha: false, sinGuardar: false,
  onArrancar: vi.fn(), onCortar: vi.fn(), onRetomar: vi.fn(),
  grafo: GRAFO, destino: DESTINO,
})

async function montar(props = {}) {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  const dibujar = (extra) => createElement(RunBar, { ...propsBase(), ...props, ...extra })
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(dibujar())
  })
  return (extra) => act(async () => { raiz.render(dibujar(extra)) })
}

beforeEach(() => {
  cidsCall.mockReset()
  localStorage.clear()
})

afterEach(() => {
  act(() => raiz?.unmount())
  contenedor?.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const texto = () => contenedor.textContent
const boton = (contiene) => [...contenedor.querySelectorAll('button')].find((uno) => uno.textContent.includes(contiene))
/** Un botón del pie del diálogo: «▶ Iniciar» existe también en la barra, y no son el mismo. */
const pie = (exacto) => [...contenedor.querySelectorAll('.modal-foot button')].find((b) => b.textContent === exacto)
const asentar = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

async function clic(elemento) {
  await act(async () => { elemento.click() })
}

/** Escribe en un campo o elige en un desplegable, como lo haría quien usa la pantalla. */
async function poner(elemento, valor) {
  const esSelect = elemento instanceof HTMLSelectElement
  const prototipo = esSelect ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototipo, 'value').set.call(elemento, valor)
    elemento.dispatchEvent(new Event(esSelect ? 'change' : 'input', { bubbles: true }))
  })
}

const campo = (id) => contenedor.querySelector(`#${id}`)

describe('la barra, por estado', () => {
  it('sin corrida dice «Sin ejecutar todavía» y ofrece ▶ Iniciar', async () => {
    await montar()
    expect(texto()).toContain('Sin ejecutar todavía')
    expect(boton('▶ Iniciar').disabled).toBe(false)
    expect(boton('Cancelar')).toBeUndefined()
    expect(boton('Reanudar')).toBeUndefined()
  })

  it('en marcha: insignia «Ejecutando», avance hechos/total y ■ Cancelar; Iniciar bloqueado', async () => {
    await montar({ run: CORRIDA('running'), enMarcha: true })
    expect(texto()).toContain('Ejecutando')
    expect(contenedor.querySelector('.ej-avance').textContent).toBe('1/2')
    expect(boton('■ Cancelar')).toBeTruthy()
    expect(boton('▶ Iniciar').disabled).toBe(true)
    // El recuento por estado de esta plataforma se conserva como extra.
    expect(texto()).toContain('1 corriendo')
  })

  it('el avance cuenta solo los pasos de primer nivel', async () => {
    const run = CORRIDA('running', {
      g: { status: 'running', type: 'group', children: { h1: { status: 'success' }, h2: { status: 'success' }, h3: { status: 'success' } } },
      b: { status: 'success' },
    })
    await montar({ run, enMarcha: true })
    expect(contenedor.querySelector('.ej-avance').textContent).toBe('1/2')
  })

  it('terminada no muestra el avance', async () => {
    await montar({ run: CORRIDA('success'), enMarcha: false })
    expect(texto()).toContain('Completado')
    expect(contenedor.querySelector('.ej-avance')).toBeNull()
  })

  it('con error: insignia «Error» y ⏭ Reanudar con la ayuda de v9', async () => {
    await montar({ run: CORRIDA('error'), enMarcha: false })
    expect(texto()).toContain('Error')
    expect(boton('⏭ Reanudar').title)
      .toBe('Reanudar desde el primer nodo fallido, conservando los resultados ya completados')
  })

  it('«Cancelado» no ofrece Reanudar', async () => {
    await montar({ run: CORRIDA('cancelled'), enMarcha: false })
    expect(texto()).toContain('Cancelado')
    expect(boton('Reanudar')).toBeUndefined()
  })

  it('Reanudar llama a onRetomar y Cancelar a onCortar', async () => {
    const onRetomar = vi.fn()
    const onCortar = vi.fn()
    const rerender = await montar({ run: CORRIDA('error'), enMarcha: false, onRetomar, onCortar })
    await clic(boton('⏭ Reanudar'))
    expect(onRetomar).toHaveBeenCalledTimes(1)

    await rerender({ run: CORRIDA('running'), enMarcha: true, onRetomar, onCortar })
    await clic(boton('■ Cancelar'))
    expect(onCortar).toHaveBeenCalledTimes(1)
  })

  it('con una acción en curso dice «Iniciando…» y, si la corrida vive, «Cancelando…»', async () => {
    const rerender = await montar({ ocupado: true, enMarcha: false })
    expect(boton('Iniciando…').disabled).toBe(true)

    await rerender({ run: CORRIDA('running'), enMarcha: true, ocupado: true })
    expect(boton('Cancelando…').disabled).toBe(true)
  })

  it('con cambios sin guardar bloquea Iniciar y lo explica', async () => {
    await montar({ sinGuardar: true })
    const iniciar = boton('▶ Iniciar')
    expect(iniciar.disabled).toBe(true)
    expect(iniciar.title).toBe('Guarda los cambios antes de ejecutar')
  })

  it('sin nodos de primer nivel no se puede iniciar', async () => {
    await montar({ grafo: { nodes: [tarea('x', {}, 'g')], edges: [] } })
    expect(boton('▶ Iniciar').disabled).toBe(true)
  })

  it('un error se muestra con su texto', async () => {
    await montar({ error: 'no hubo red' })
    expect(texto()).toContain('✕ no hubo red')
  })
})

describe('guarda de tasks fuera de un grupo', () => {
  const conHuerfanas = {
    nodes: [
      { id: 'g', type: 'group', data: { label: 'Grupo' } },
      tarea('a', {}, 'g'),
      tarea('b', { label: 'Suelta uno' }),
      tarea('c'),
    ],
    edges: [],
  }

  it('avisa con los nombres, no abre el diálogo y se apaga a los 6 s', async () => {
    sapDeMentira()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await montar({ grafo: conHuerfanas })

    await clic(boton('▶ Iniciar'))
    expect(texto()).toContain('⚠ Los siguientes tasks deben estar dentro de un grupo para poder iniciar: Suelta uno, T_c')
    expect(texto()).not.toContain('Iniciar orquestación')
    expect(cidsCall).not.toHaveBeenCalled()

    await act(async () => { vi.advanceTimersByTime(5900) })
    expect(texto()).toContain('Los siguientes tasks')
    await act(async () => { vi.advanceTimersByTime(200) })
    expect(texto()).not.toContain('Los siguientes tasks')
  })

  it('la × lo cierra antes', async () => {
    await montar({ grafo: conHuerfanas })
    await clic(boton('▶ Iniciar'))
    await clic(contenedor.querySelector('.ej-franja button'))
    expect(contenedor.querySelector('.ej-franja')).toBeNull()
  })

  it('sin grupos, las tareas sueltas no estorban', async () => {
    sapDeMentira()
    await montar({ grafo: GRAFO })
    await clic(boton('▶ Iniciar'))
    await asentar()
    expect(texto()).not.toContain('Los siguientes tasks')
    expect(texto()).toContain('Iniciar orquestación')
  })
})

describe('el diálogo de «Iniciar orquestación»', () => {
  async function abrir(props = {}) {
    sapDeMentira()
    const rerender = await montar(props)
    await clic(boton('▶ Iniciar'))
    await asentar()
    await asentar()
    return rerender
  }

  it('lleva el título, el subtítulo y las ayudas de v9', async () => {
    await abrir()
    expect(texto()).toContain('Iniciar orquestación')
    expect(texto()).toContain('Agente y configuración por defecto para nodos sin valores propios')
    expect(texto()).toContain('Si dejas agente y configuración vacíos, SAP usará los valores por defecto del sistema.')
    expect(boton('Cancelar')).toBeTruthy()
    expect(boton('Guardar preset')).toBeTruthy()
  })

  it('trae TODOS los agentes (activeOnly: false), marca el desconectado y cuenta lo encontrado', async () => {
    await abrir()
    expect(cidsCall).toHaveBeenCalledWith(DESTINO, 'getAgents', { activeOnly: false })
    expect(cidsCall).toHaveBeenCalledWith(DESTINO, 'getSystemConfigurations')

    const opciones = [...campo('ej-agente').options].map((o) => o.textContent)
    expect(opciones).toEqual(['— Sin agente específico —', 'AG1', 'AG2 (DISCONNECTED)'])
    expect([...campo('ej-configuracion').options].map((o) => o.textContent))
      .toEqual(['— Sin configuración específica —', 'PERFIL_A', 'PERFIL_B'])
    expect(texto()).toContain('2 encontrados')
  })

  it('«Escribir manualmente →» cambia a campos de texto y «← Usar dropdown» vuelve', async () => {
    await abrir()
    await clic(boton('Escribir manualmente →'))
    expect(campo('ej-agente').tagName).toBe('INPUT')
    expect(campo('ej-agente').placeholder).toBe('Nombre del agente (dejar vacío para default)')
    expect(campo('ej-configuracion').placeholder).toBe('Nombre del perfil (dejar vacío para default)')
    await clic(boton('← Usar dropdown'))
    expect(campo('ej-agente').tagName).toBe('SELECT')
  })

  it('si falla la carga muestra el error y pasa a escribir a mano, sin el alternar', async () => {
    cidsCall.mockRejectedValue(new Error('SAP no contesta'))
    await montar()
    await clic(boton('▶ Iniciar'))
    await asentar()
    await asentar()

    expect(texto()).toContain('Error al cargar desde SAP: SAP no contesta')
    expect(campo('ej-agente').tagName).toBe('INPUT')
    expect(boton('← Usar dropdown')).toBeUndefined()
    expect(boton('▶ Iniciar')).toBeTruthy()
  })

  it('sin agentes pasa a escribir a mano', async () => {
    cidsCall.mockImplementation(async (_d, operacion) => (operacion === 'getAgents' ? [] : []))
    await montar({ grafo: { nodes: [tarea('a')], edges: [] } })
    await clic(boton('▶ Iniciar'))
    await asentar()
    await asentar()
    expect(campo('ej-agente').tagName).toBe('INPUT')
    expect(texto()).toContain('0 encontrados')
  })

  it('mientras carga, ▶ Iniciar y Guardar preset están desactivados', async () => {
    cidsCall.mockImplementation(() => new Promise(() => {}))
    await montar()
    await clic(boton('▶ Iniciar'))
    expect(texto()).toContain('Cargando agentes y configuraciones…')
    expect(pie('▶ Iniciar').disabled).toBe(true)
    expect(pie('Guardar preset').disabled).toBe(true)
  })

  it('descubre las variables de TODAS las tareas, sin repetir, con el valor vacío', async () => {
    await abrir()
    const pedidas = cidsCall.mock.calls.filter(([, operacion]) => operacion === 'getTaskInfo').map(([, , p]) => p.taskGuid)
    expect(pedidas.sort()).toEqual(['G1', 'G2'])

    expect(texto()).toContain('Variables globales (3 disponibles en sistema)')
    const filas = [...contenedor.querySelectorAll('.ej-variable')]
    expect(filas.map((f) => f.querySelector('select').value)).toEqual(['FECHA', 'PAIS', 'MONEDA'])
    expect(filas.every((f) => f.querySelector('input').value === '')).toBe(true)
    expect(filas[0].querySelector('input').placeholder).toBe('vacío = usar valor del nodo')
    expect(texto()).toContain('Si escribes un valor, se aplica a TODOS los nodos que usen esa variable (pisa lo del nodo).')
    // La descripción acompaña al nombre en el desplegable.
    expect([...filas[0].querySelector('select').options].map((o) => o.textContent)).toContain('FECHA — Fecha de carga')
  })

  it('«+ Variable» agrega una fila vacía y × la quita', async () => {
    await abrir()
    await clic(boton('+ Variable'))
    expect(contenedor.querySelectorAll('.ej-variable')).toHaveLength(4)
    await clic(contenedor.querySelector('.ej-variable-quitar'))
    expect(contenedor.querySelectorAll('.ej-variable')).toHaveLength(3)
  })

  it('«error al cargar» si SAP no contestó por ninguna tarea', async () => {
    cidsCall.mockImplementation(async (_d, operacion) => {
      if (operacion === 'getTaskInfo') throw new Error('caído')
      return []
    })
    await montar()
    await clic(boton('▶ Iniciar'))
    await asentar()
    await asentar()
    expect(texto()).toContain('Variables globales — error al cargar')
    expect(texto()).toContain('No se pudieron cargar las variables del sistema.')
  })

  it('inicia con el agente, la configuración (como profileName) y solo las variables con valor', async () => {
    const onArrancar = vi.fn()
    await abrir({ onArrancar })

    await poner(campo('ej-agente'), 'AG1')
    await poner(campo('ej-configuracion'), 'PERFIL_B')
    const filas = [...contenedor.querySelectorAll('.ej-variable')]
    await poner(filas[1].querySelector('input'), '20261005')

    await clic(pie('▶ Iniciar'))
    expect(onArrancar).toHaveBeenCalledTimes(1)
    expect(onArrancar).toHaveBeenCalledWith({
      agentName: 'AG1',
      profileName: 'PERFIL_B',
      globalVariables: [{ name: 'PAIS', value: '20261005' }],
    })
    // El diálogo se cierra al iniciar.
    expect(texto()).not.toContain('Iniciar orquestación')
  })

  it('sin elegir nada inicia con los valores por defecto del sistema', async () => {
    const onArrancar = vi.fn()
    await abrir({ onArrancar })
    await clic(pie('▶ Iniciar'))
    expect(onArrancar).toHaveBeenCalledWith({ globalVariables: [] })
  })

  it('cambiar la variable de una fila borra el valor, que era de la otra', async () => {
    await abrir()
    const fila = contenedor.querySelector('.ej-variable')
    await poner(fila.querySelector('input'), 'x')
    await poner(fila.querySelector('select'), 'MONEDA')
    expect(contenedor.querySelector('.ej-variable input').value).toBe('')
  })

  it('Cancelar cierra sin iniciar', async () => {
    const onArrancar = vi.fn()
    await abrir({ onArrancar })
    await clic(pie('Cancelar'))
    expect(texto()).not.toContain('Iniciar orquestación')
    expect(onArrancar).not.toHaveBeenCalled()
  })

  it('sin destino todo se escribe a mano y no se consulta a SAP', async () => {
    const onArrancar = vi.fn()
    await montar({ destino: undefined, onArrancar })
    await clic(boton('▶ Iniciar'))
    await asentar()
    expect(cidsCall).not.toHaveBeenCalled()
    await poner(campo('ej-agente'), 'MI_AGENTE')
    await clic(pie('▶ Iniciar'))
    expect(onArrancar).toHaveBeenCalledWith({ agentName: 'MI_AGENTE', globalVariables: [] })
  })
})

describe('presets de «Ejecución rápida»', () => {
  const CLAVE = 'ibp.cids.presets.c1:sandbox'

  async function abrir(props = {}) {
    sapDeMentira()
    const rerender = await montar(props)
    await clic(boton('▶ Iniciar'))
    await asentar()
    await asentar()
    return rerender
  }

  it('«Guardar preset» pide el nombre y lo guarda por destino con agente, perfil y variables', async () => {
    const pedir = vi.spyOn(window, 'prompt').mockReturnValue('  Diario  ')
    await abrir()

    await poner(campo('ej-agente'), 'AG1')
    await poner(campo('ej-configuracion'), 'PERFIL_A')
    await poner(contenedor.querySelector('.ej-variable input'), '2026')
    await clic(boton('Guardar preset'))

    expect(pedir).toHaveBeenCalledWith('Nombre del preset:')
    const guardados = JSON.parse(localStorage.getItem(CLAVE))
    expect(guardados).toHaveLength(1)
    expect(guardados[0]).toMatchObject({
      label: 'Diario',
      agentName: 'AG1',
      profileName: 'PERFIL_A',
      globalVariables: [{ name: 'FECHA', value: '2026' }],
    })
    // Y aparece en la misma ventana, bajo «Ejecución rápida».
    expect(texto()).toContain('Ejecución rápida')
    expect(boton('▶ Diario')).toBeTruthy()
  })

  it('cancelar el nombre no guarda nada', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null)
    await abrir()
    await clic(boton('Guardar preset'))
    expect(localStorage.getItem(CLAVE)).toBeNull()
    expect(texto()).not.toContain('Ejecución rápida')
  })

  it('un clic en el preset inicia con sus valores', async () => {
    localStorage.setItem(CLAVE, JSON.stringify([{
      id: 'p1', label: 'Nocturno', agentName: 'AG2', profileName: 'PERFIL_B',
      globalVariables: [{ name: 'PAIS', value: 'CL' }],
    }]))
    const onArrancar = vi.fn()
    await abrir({ onArrancar })

    await clic(boton('▶ Nocturno'))
    expect(onArrancar).toHaveBeenCalledWith({
      agentName: 'AG2', profileName: 'PERFIL_B', globalVariables: [{ name: 'PAIS', value: 'CL' }],
    })
  })

  it('la × borra el preset y no inicia nada', async () => {
    localStorage.setItem(CLAVE, JSON.stringify([
      { id: 'p1', label: 'Uno', agentName: null, profileName: null, globalVariables: [] },
      { id: 'p2', label: 'Dos', agentName: null, profileName: null, globalVariables: [] },
    ]))
    const onArrancar = vi.fn()
    await abrir({ onArrancar })

    await clic(contenedor.querySelector('[aria-label="Borrar el preset Uno"]'))
    expect(onArrancar).not.toHaveBeenCalled()
    expect(boton('▶ Uno')).toBeUndefined()
    expect(boton('▶ Dos')).toBeTruthy()
    expect(JSON.parse(localStorage.getItem(CLAVE)).map((p) => p.label)).toEqual(['Dos'])
  })

  it('los presets de otro destino no aparecen', async () => {
    localStorage.setItem('ibp.cids.presets.c1:production', JSON.stringify([
      { id: 'p1', label: 'DeProd', agentName: null, profileName: null, globalVariables: [] },
    ]))
    await abrir()
    expect(boton('▶ DeProd')).toBeUndefined()
  })

  it('un localStorage roto no impide abrir el diálogo ni guardar', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('lleno') })
    vi.spyOn(window, 'prompt').mockReturnValue('Uno')
    await abrir()

    expect(texto()).toContain('Iniciar orquestación')
    await clic(boton('Guardar preset'))
    // No se pudo persistir, pero la pantalla no se rompe y el preset vive mientras el diálogo siga.
    expect(boton('▶ Uno')).toBeTruthy()
  })
})

describe('↺ Repetir', () => {
  async function iniciarConAgente(props) {
    sapDeMentira()
    const rerender = await montar(props)
    await clic(boton('▶ Iniciar'))
    await asentar()
    await asentar()
    await poner(campo('ej-agente'), 'AG1')
    await poner(campo('ej-configuracion'), 'PERFIL_A')
    await clic(pie('▶ Iniciar'))
    return rerender
  }

  it('no aparece sin parámetros guardados, ni con la corrida en marcha', async () => {
    await montar({ run: CORRIDA('success'), enMarcha: false })
    expect(boton('Repetir')).toBeUndefined()
  })

  it('tras iniciar, con la corrida terminada, relanza con el mismo agente, perfil y variables', async () => {
    const onArrancar = vi.fn()
    const rerender = await iniciarConAgente({ onArrancar })
    expect(onArrancar).toHaveBeenCalledTimes(1)
    const primera = onArrancar.mock.calls[0][0]

    // En marcha no se ofrece; terminada, sí.
    await rerender({ run: CORRIDA('running'), enMarcha: true, onArrancar })
    expect(boton('Repetir')).toBeUndefined()

    await rerender({ run: CORRIDA('success'), enMarcha: false, onArrancar })
    const repetir = boton('↺ Repetir')
    expect(repetir.title).toBe('Repetir con AG1 / PERFIL_A')

    await clic(repetir)
    expect(onArrancar).toHaveBeenCalledTimes(2)
    expect(onArrancar.mock.calls[1][0]).toEqual(primera)
  })

  it('dice «Iniciando…» mientras relanza', async () => {
    const onArrancar = vi.fn()
    const rerender = await iniciarConAgente({ onArrancar })
    await rerender({ run: CORRIDA('success'), enMarcha: false, onArrancar, ocupado: true })
    const iniciando = [...contenedor.querySelectorAll('button')].filter((b) => b.textContent === 'Iniciando…')
    expect(iniciando.length).toBeGreaterThan(0)
    expect(iniciando.every((b) => b.disabled)).toBe(true)
  })

  it('usa onRepetir, puedeRepetir y ultimosParametros cuando quien monta la barra los pasa', async () => {
    const onRepetir = vi.fn()
    const onArrancar = vi.fn()
    await montar({
      run: CORRIDA('error'),
      enMarcha: false,
      puedeRepetir: true,
      onRepetir,
      onArrancar,
      ultimosParametros: { agentName: 'AG9', profileName: 'P9', globalVariables: [] },
    })
    const repetir = boton('↺ Repetir')
    expect(repetir.title).toBe('Repetir con AG9 / P9')
    await clic(repetir)
    expect(onRepetir).toHaveBeenCalledTimes(1)
    expect(onArrancar).not.toHaveBeenCalled()
  })

  it('con puedeRepetir en falso no aparece', async () => {
    await montar({ run: CORRIDA('success'), enMarcha: false, puedeRepetir: false, onRepetir: vi.fn() })
    expect(boton('Repetir')).toBeUndefined()
  })
})
