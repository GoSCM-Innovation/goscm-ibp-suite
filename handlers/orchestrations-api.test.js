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
// La comprobación de arranque de CI Tools (las integraciones y sus variables) vive en la base: aquí se mira solo qué viaja con la ejecución.
vi.mock('../core/ci/orquestacion.js', async (importOriginal) => ({ ...(await importOriginal()), validarInicio: vi.fn(async () => ({})) }))
vi.mock('../core/orchestrations/runner.js', () => ({
  cancelRun: vi.fn(),
  getRun: vi.fn(),
  resumeRun: vi.fn(),
  startRun: vi.fn(),
  tickRun: vi.fn(),
}))

const { hasModule, requireSession } = await import('../core/auth/guards.js')
const { getConnectionTarget } = await import('../core/connections/index.js')
const { createOrchestration, deleteOrchestration, getOrchestration, updateOrchestration } = await import('../core/orchestrations/orchestrations.js')
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

// Los ajustes de una orquestación de CI Tools (otra versión, otras fechas…) viajan por estas dos rutas.
describe('ajustes del lote por /api/orchestrations', () => {
  const AJUSTES = { version: 'PV2', fechas: { desde: '20260101' } }

  it('crear los manda al guardado', async () => {
    createOrchestration.mockResolvedValue({ id: 'o-1' })
    const res = respuesta()
    await orchestrations({ method: 'POST', body: { connectionId: 'x-1', name: 'Carga', nodes: [], edges: [], ajustes: AJUSTES } }, res)
    expect(res.codigo).toBe(201)
    expect(createOrchestration.mock.calls[0][1]).toMatchObject({ connectionId: 'x-1', ajustes: AJUSTES })
  })

  it('guardar los manda, y sin ellos no los toca (llega `undefined`)', async () => {
    updateOrchestration.mockResolvedValue({ id: 'o-1' })

    await orchestrations({ method: 'PATCH', body: { id: 'o-1', ajustes: AJUSTES } }, respuesta())
    expect(updateOrchestration.mock.calls.at(-1)[2].ajustes).toEqual(AJUSTES)

    await orchestrations({ method: 'PATCH', body: { id: 'o-1', name: 'Otro' } }, respuesta())
    expect(updateOrchestration.mock.calls.at(-1)[2].ajustes).toBeUndefined()
  })

  it('unos ajustes que no valen contestan 400 con el motivo', async () => {
    updateOrchestration.mockRejectedValue(new Error('Comando: lleva comillas o barras invertidas.'))
    const res = respuesta()
    await orchestrations({ method: 'PATCH', body: { id: 'o-1', ajustes: { comando: "x'y" } } }, res)
    expect(res.codigo).toBe(400)
    expect(res.cuerpo.error).toMatch(/Comando/)
  })
})

describe('arrancar una orquestación de CI Tools con ajustes', () => {
  beforeEach(() => {
    requireSession.mockResolvedValue({ clientId: 'c-1', userId: 'u-1', email: 'a@x.com' })
    getConnectionTarget.mockResolvedValue({ kind: 'ci' })
  })

  // Los del lote salen de la orquestación guardada y se fijan al lanzar: lo que mande el navegador no los decide.
  it('los ajustes que viajan con la ejecución son los guardados, no los que traiga la petición', async () => {
    getOrchestration.mockResolvedValue({ id: 'o-1', connectionId: 'x-1', ajustes: { version: 'PV2' } })
    startRun.mockResolvedValue({ status: 'running' })
    const res = respuesta()

    await orchestrationRun({
      method: 'POST',
      body: { id: 'o-1', action: 'start', defaults: { variables: { DESDE: '20260101' }, ajustes: { version: 'LA_DEL_NAVEGADOR' } } },
    }, res)

    expect(res.codigo).toBe(200)
    const { defaults } = startRun.mock.calls[0][2]
    expect(defaults.ajustes).toEqual({ version: 'PV2' })
    expect(defaults.variables).toEqual({ DESDE: '20260101' })
    expect(defaults.startedBy).toEqual({ id: 'u-1', email: 'a@x.com' })
  })

  it('sin ajustes guardados viaja un lote vacío', async () => {
    getOrchestration.mockResolvedValue({ id: 'o-1', connectionId: 'x-1' })
    startRun.mockResolvedValue({ status: 'running' })
    await orchestrationRun({ method: 'POST', body: { id: 'o-1', action: 'start' } }, respuesta())
    expect(startRun.mock.calls[0][2].defaults.ajustes).toEqual({})
  })

  it('unos ajustes guardados que no valen no dejan arrancar', async () => {
    getOrchestration.mockResolvedValue({ id: 'o-1', connectionId: 'x-1', ajustes: { comando: "x'y" } })
    const res = respuesta()
    await orchestrationRun({ method: 'POST', body: { id: 'o-1', action: 'start' } }, res)
    expect(res.codigo).toBe(400)
    expect(startRun).not.toHaveBeenCalled()
  })
})
