// Cómo contestan `/api/orchestrations` y `/api/orchestration-run` cuando lo pedido choca con una
// ejecución en marcha: como v9, con 409 y el mensaje, no con un 400 genérico.
//
// Va en `handlers/` y no junto a los archivos de `api/` porque Vercel cuenta cada archivo de `api/`
// como una función, y una prueba ahí se desplegaría como si lo fuera.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../core/auth/guards.js', () => ({
  requireSession: vi.fn(),
  hasModule: vi.fn(),
}))
vi.mock('../core/connections/index.js', () => ({ getConnectionTarget: vi.fn() }))
vi.mock('../core/orchestrations/orchestrations.js', () => ({
  createOrchestration: vi.fn(),
  deleteOrchestration: vi.fn(),
  duplicateOrchestration: vi.fn(),
  getOrchestration: vi.fn(),
  listOrchestrations: vi.fn(),
  updateOrchestration: vi.fn(),
}))
vi.mock('../core/orchestrations/runner.js', () => ({
  cancelRun: vi.fn(),
  getRun: vi.fn(),
  resumeRun: vi.fn(),
  startRun: vi.fn(),
  tickRun: vi.fn(),
}))

const { hasModule, requireSession } = await import('../core/auth/guards.js')
const { getConnectionTarget } = await import('../core/connections/index.js')
const { deleteOrchestration, getOrchestration } = await import('../core/orchestrations/orchestrations.js')
const { startRun } = await import('../core/orchestrations/runner.js')
const { errorDeConflicto } = await import('../core/orchestrations/run-store.js')
const { default: orchestrations } = await import('../api/orchestrations.js')
const { default: orchestrationRun } = await import('../api/orchestration-run.js')

function respuesta() {
  const res = {
    codigo: null,
    cuerpo: null,
    status(codigo) { res.codigo = codigo; return res },
    json(cuerpo) { res.cuerpo = cuerpo; return res },
  }
  return res
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  requireSession.mockResolvedValue({ clientId: 'c-1' })
  hasModule.mockResolvedValue(true)
  getConnectionTarget.mockResolvedValue({ kind: 'cids' })
  getOrchestration.mockResolvedValue({ id: 'o-1', connectionId: 'x-1' })
})

describe('DELETE /api/orchestrations', () => {
  it('con una ejecución activa contesta 409 con el mensaje de v9', async () => {
    deleteOrchestration.mockRejectedValue(errorDeConflicto('No se puede eliminar con una ejecución activa'))
    const res = respuesta()

    await orchestrations({ method: 'DELETE', body: { id: 'o-1' } }, res)

    expect(res.codigo).toBe(409)
    expect(res.cuerpo).toEqual({ error: 'No se puede eliminar con una ejecución activa' })
  })

  it('un error común sigue siendo 400', async () => {
    deleteOrchestration.mockRejectedValue(new Error('algo falló'))
    const res = respuesta()

    await orchestrations({ method: 'DELETE', body: { id: 'o-1' } }, res)

    expect(res.codigo).toBe(400)
  })

  it('borra y contesta que se borró', async () => {
    deleteOrchestration.mockResolvedValue(true)
    const res = respuesta()

    await orchestrations({ method: 'DELETE', body: { id: 'o-1' } }, res)

    expect(res.codigo).toBe(200)
    expect(res.cuerpo).toEqual({ deleted: true })
  })
})

describe('POST /api/orchestration-run', () => {
  it('arrancar con una ejecución activa contesta 409', async () => {
    startRun.mockRejectedValue(errorDeConflicto('Ya hay una ejecución activa'))
    const res = respuesta()

    await orchestrationRun({ method: 'POST', body: { id: 'o-1', action: 'start' } }, res)

    expect(res.codigo).toBe(409)
    expect(res.cuerpo).toEqual({ error: 'Ya hay una ejecución activa' })
  })

  it('un error común sigue siendo 400', async () => {
    startRun.mockRejectedValue(new Error('La orquestación no tiene nodos'))
    const res = respuesta()

    await orchestrationRun({ method: 'POST', body: { id: 'o-1', action: 'start' } }, res)

    expect(res.codigo).toBe(400)
    expect(res.cuerpo).toEqual({ error: 'La orquestación no tiene nodos' })
  })
})
