// @vitest-environment jsdom
//
// El gancho que lleva la corrida: el error de una vuelta pasajera se borra solo, el de una acción
// no, y «Repetir» relanza con lo mismo.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = {
  getRun: vi.fn(),
  tickRun: vi.fn(),
  startRun: vi.fn(),
  resumeRun: vi.fn(),
  cancelRun: vi.fn(),
}
vi.mock('../../../lib/orchestrations.js', () => ({
  getRun: (...a) => api.getRun(...a),
  tickRun: (...a) => api.tickRun(...a),
  startRun: (...a) => api.startRun(...a),
  resumeRun: (...a) => api.resumeRun(...a),
  cancelRun: (...a) => api.cancelRun(...a),
  isRunFinished: (run) => Boolean(run) && ['success', 'error', 'cancelled'].includes(run.status),
}))
vi.mock('../../../lib/aviso-de-corrida.js', () => ({
  avisarFinDeCorrida: vi.fn(),
  pedirPermisoDeAviso: vi.fn(),
}))

const { useOrchestrationRun } = await import('./useOrchestrationRun.js')

const EN_MARCHA = { status: 'running', nodes: {} }

let contenedor
let raiz
let hook

function Sonda() {
  hook = useOrchestrationRun('o1', 'Mi orquestación')
  return null
}

async function montar() {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(Sonda))
  })
  await act(async () => { await Promise.resolve() })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  Object.values(api).forEach((mock) => mock.mockReset())
  api.getRun.mockResolvedValue(null)
})

afterEach(() => {
  act(() => raiz?.unmount())
  contenedor?.remove()
  vi.useRealTimers()
})

const avanzar = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('el error de una vuelta', () => {
  it('un fallo pasajero se borra solo en la siguiente vuelta buena', async () => {
    api.getRun.mockResolvedValue(EN_MARCHA)
    api.tickRun
      .mockRejectedValueOnce(new Error('sin red'))
      .mockResolvedValue(EN_MARCHA)
    await montar()

    await avanzar(10)
    expect(hook.error).toBe('sin red')

    await avanzar(5000)
    expect(hook.error).toBe('')
  })

  it('el error de una acción NO lo borra una vuelta buena', async () => {
    api.getRun.mockResolvedValue(EN_MARCHA)
    api.tickRun.mockResolvedValue(EN_MARCHA)
    api.cancelRun.mockRejectedValue(new Error('no se pudo cancelar'))
    await montar()
    await avanzar(10)

    await act(async () => { await hook.cortar() })
    expect(hook.error).toBe('no se pudo cancelar')

    await avanzar(5000)
    expect(hook.error).toBe('no se pudo cancelar')
  })
})

describe('arrancar y repetir', () => {
  it('guarda con qué se arrancó y repetir relanza con lo mismo', async () => {
    api.startRun.mockResolvedValue({ status: 'success', nodes: {} })
    await montar()
    expect(hook.ultimosParametros).toBeNull()

    const valores = { agentName: 'AG1', profileName: 'P', globalVariables: [{ name: 'A', value: '1' }] }
    await act(async () => { await hook.arrancar(valores) })
    expect(api.startRun).toHaveBeenLastCalledWith('o1', valores)
    expect(hook.ultimosParametros).toEqual(valores)

    await act(async () => { await hook.repetir() })
    expect(api.startRun).toHaveBeenCalledTimes(2)
    expect(api.startRun).toHaveBeenLastCalledWith('o1', valores)
  })

  it('repetir sin nada guardado no hace nada', async () => {
    await montar()
    await act(async () => { await hook.repetir() })
    expect(api.startRun).not.toHaveBeenCalled()
  })
})
