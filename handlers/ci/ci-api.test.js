// Cómo contesta la API de CI Tools: el módulo se exige en el servidor, quién ejecutó sale de la sesión, y los
// choques esperados son 409 y no un fallo.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../core/auth/guards.js', () => ({ requireModule: vi.fn() }))
vi.mock('../../core/connections/index.js', () => ({ getConnectionTarget: vi.fn() }))
vi.mock('../../core/orchestrations/orchestrations.js', () => ({ getOrchestration: vi.fn() }))
vi.mock('../../core/ci/index.js', () => ({
  createIntegration: vi.fn(),
  deleteIntegration: vi.fn(),
  duplicateIntegration: vi.fn(),
  esNombreDeVariable: (nombre) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(nombre),
  executeIntegration: vi.fn(),
  getIntegration: vi.fn(),
  infoDeOrquestacion: vi.fn(),
  listIntegrations: vi.fn(),
  listarEjecuciones: vi.fn(),
  renameFolder: vi.fn(),
  ultimasVariables: vi.fn(),
  updateIntegration: vi.fn(),
}))

const { requireModule } = await import('../../core/auth/guards.js')
const { getConnectionTarget } = await import('../../core/connections/index.js')
const { getOrchestration } = await import('../../core/orchestrations/orchestrations.js')
const ci = await import('../../core/ci/index.js')
const { RUTAS } = await import('./index.js')

const SESION = { clientId: 'c-1', userId: 'u-1', email: 'a@x.com' }

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
  requireModule.mockResolvedValue(SESION)
})

describe('el módulo se exige en el servidor', () => {
  // `requireModule` responde él mismo 403 y devuelve null: el handler no debe seguir.
  it.each([
    ['integrations', { method: 'GET', query: { connectionId: 'x' } }],
    ['run', { method: 'POST', body: { connectionId: 'x', integrationId: 'y' } }],
    ['runs', { method: 'GET', query: { connectionId: 'x' } }],
    ['orchestration-info', { method: 'GET', query: { id: 'x' } }],
  ])('%s sin el módulo contratado no hace nada', async (nombre, req) => {
    requireModule.mockResolvedValue(null)
    const res = respuesta()
    await RUTAS[nombre](req, res)

    expect(requireModule).toHaveBeenCalledWith(req, res, 'ci')
    expect(res.codigo).toBeNull()
    for (const funcion of Object.values(ci)) if (vi.isMockFunction(funcion)) expect(funcion).not.toHaveBeenCalled()
  })
})

describe('POST /api/ci/run', () => {
  it('ejecuta con el cliente y el usuario de la SESIÓN, no los del cuerpo', async () => {
    ci.executeIntegration.mockResolvedValue({ resultado: 'success', runId: 'r-1' })
    const res = respuesta()
    await RUTAS.run({
      method: 'POST',
      body: { connectionId: 'conn-1', integrationId: 'int-1', variables: { DESDE: '1' }, clientId: 'otro', user: { email: 'falso@x.com' } },
    }, res)

    expect(ci.executeIntegration).toHaveBeenCalledWith({
      clientId: 'c-1', connectionId: 'conn-1', integrationId: 'int-1', variables: { DESDE: '1' },
      origin: 'manual', user: { id: 'u-1', email: 'a@x.com' },
    })
    expect(res.codigo).toBe(200)
    expect(res.cuerpo.run.resultado).toBe('success')
  })

  // Que CPI conteste un error es un resultado, no un fallo de la API.
  it('una carga fallada contesta 200 con el resultado', async () => {
    ci.executeIntegration.mockResolvedValue({ resultado: 'error', httpStatus: 500, mensaje: 'boom' })
    const res = respuesta()
    await RUTAS.run({ method: 'POST', body: { connectionId: 'c', integrationId: 'i' } }, res)
    expect(res.codigo).toBe(200)
    expect(res.cuerpo.run).toMatchObject({ resultado: 'error', httpStatus: 500 })
  })

  it('descarta las variables mal formadas', async () => {
    ci.executeIntegration.mockResolvedValue({ resultado: 'success' })
    await RUTAS.run({
      method: 'POST',
      body: { connectionId: 'c', integrationId: 'i', variables: { BIEN: 'v', '1mala': 'x', NUM: 5 } },
    }, respuesta())
    expect(ci.executeIntegration.mock.calls[0][0].variables).toEqual({ BIEN: 'v' })
  })

  it('exige conexión e integración', async () => {
    const res = respuesta()
    await RUTAS.run({ method: 'POST', body: { integrationId: 'i' } }, res)
    expect(res.codigo).toBe(400)
    await RUTAS.run({ method: 'POST', body: { connectionId: 'c' } }, res)
    expect(res.codigo).toBe(400)
    expect(ci.executeIntegration).not.toHaveBeenCalled()
  })

  it('solo acepta POST', async () => {
    const res = respuesta()
    await RUTAS.run({ method: 'GET' }, res)
    expect(res.codigo).toBe(405)
  })

  it('un fallo inesperado es 400 con el mensaje', async () => {
    ci.executeIntegration.mockRejectedValue(new Error('se cayó'))
    const res = respuesta()
    await RUTAS.run({ method: 'POST', body: { connectionId: 'c', integrationId: 'i' } }, res)
    expect(res.codigo).toBe(400)
    expect(res.cuerpo).toEqual({ error: 'se cayó' })
  })
})

describe('/api/ci/integrations', () => {
  it('lista las de una conexión, con el cliente de la sesión', async () => {
    ci.listIntegrations.mockResolvedValue([{ id: 'i-1' }])
    const res = respuesta()
    await RUTAS.integrations({ method: 'GET', query: { connectionId: 'conn-1' } }, res)
    expect(ci.listIntegrations).toHaveBeenCalledWith('c-1', 'conn-1')
    expect(res.cuerpo).toEqual({ integrations: [{ id: 'i-1' }] })
  })

  it('una que no existe es 404', async () => {
    ci.getIntegration.mockResolvedValue(null)
    const res = respuesta()
    await RUTAS.integrations({ method: 'GET', query: { id: 'x' } }, res)
    expect(res.codigo).toBe(404)
  })

  it('crea con quién la guardó', async () => {
    ci.createIntegration.mockResolvedValue({ id: 'i-1' })
    const res = respuesta()
    await RUTAS.integrations({
      method: 'POST', body: { connectionId: 'conn-1', folder: 'A', name: 'N', body: '{}' },
    }, res)
    expect(ci.createIntegration).toHaveBeenCalledWith('c-1', 'u-1', { connectionId: 'conn-1', folder: 'A', name: 'N', body: '{}' })
    expect(res.codigo).toBe(201)
  })

  it('duplica y renombra carpetas', async () => {
    ci.duplicateIntegration.mockResolvedValue({ id: 'copia' })
    ci.renameFolder.mockResolvedValue(3)

    let res = respuesta()
    await RUTAS.integrations({ method: 'POST', body: { action: 'duplicate', id: 'i-1' } }, res)
    expect(res.codigo).toBe(201)

    res = respuesta()
    await RUTAS.integrations({ method: 'POST', body: { action: 'rename-folder', connectionId: 'conn-1', from: 'A', to: 'B' } }, res)
    expect(ci.renameFolder).toHaveBeenCalledWith('c-1', 'conn-1', 'A', 'B')
    expect(res.cuerpo).toEqual({ renamed: 3 })
  })

  it('PATCH pasa tal cual lo que viene: lo que falta no se toca', async () => {
    ci.updateIntegration.mockResolvedValue({ id: 'i-1' })
    await RUTAS.integrations({ method: 'PATCH', body: { id: 'i-1', name: 'Nuevo' } }, respuesta())
    expect(ci.updateIntegration).toHaveBeenCalledWith('c-1', 'u-1', 'i-1', { name: 'Nuevo', folder: undefined, body: undefined })
  })

  // Borrar algo que usa una orquestación es un choque esperado: 409 y sin llenar el registro de errores.
  it('borrar una integración en uso es 409 con el mensaje', async () => {
    ci.deleteIntegration.mockRejectedValue(Object.assign(new Error('No se puede borrar: la usa «Carga»'), { statusCode: 409 }))
    const res = respuesta()
    await RUTAS.integrations({ method: 'DELETE', body: { id: 'i-1' } }, res)

    expect(res.codigo).toBe(409)
    expect(res.cuerpo.error).toMatch(/la usa/)
    expect(console.error).not.toHaveBeenCalled()
  })

  it('borrar una que no existe es 404', async () => {
    ci.deleteIntegration.mockResolvedValue(false)
    const res = respuesta()
    await RUTAS.integrations({ method: 'DELETE', body: { id: 'i-1' } }, res)
    expect(res.codigo).toBe(404)
  })

  it('un body inválido es 400 con el motivo', async () => {
    ci.createIntegration.mockRejectedValue(new Error('El body trae 2 bloques'))
    const res = respuesta()
    await RUTAS.integrations({ method: 'POST', body: { connectionId: 'c', name: 'N', body: '{}' } }, res)
    expect(res.codigo).toBe(400)
    expect(res.cuerpo.error).toMatch(/2 bloques/)
  })
})

describe('/api/ci/runs', () => {
  it('trae el historial de la conexión', async () => {
    ci.listarEjecuciones.mockResolvedValue([{ id: 'r-1' }])
    const res = respuesta()
    await RUTAS.runs({ method: 'GET', query: { connectionId: 'conn-1', integrationId: 'i-1', limit: '20' } }, res)
    expect(ci.listarEjecuciones).toHaveBeenCalledWith('c-1', { connectionId: 'conn-1', integrationId: 'i-1', limit: '20' })
    expect(res.cuerpo).toEqual({ runs: [{ id: 'r-1' }] })
  })

  it('trae los valores de la última corrida de una integración', async () => {
    ci.ultimasVariables.mockResolvedValue({ DESDE: '1' })
    const res = respuesta()
    await RUTAS.runs({ method: 'GET', query: { variablesDe: 'integration', id: 'i-1' } }, res)
    expect(ci.ultimasVariables).toHaveBeenCalledWith('c-1', { integrationId: 'i-1' })
    expect(res.cuerpo).toEqual({ variables: { DESDE: '1' } })
  })

  it('exige la conexión', async () => {
    const res = respuesta()
    await RUTAS.runs({ method: 'GET', query: {} }, res)
    expect(res.codigo).toBe(400)
  })
})

describe('/api/ci/orchestration-info', () => {
  const orquestacion = { id: 'o-1', connectionId: 'conn-1', nodes: [] }

  it('una orquestación ajena o inexistente es 404', async () => {
    getOrchestration.mockResolvedValue(null)
    const res = respuesta()
    await RUTAS['orchestration-info']({ method: 'GET', query: { id: 'o-1' } }, res)
    expect(res.codigo).toBe(404)
  })

  it('una orquestación de otro tipo no se explica', async () => {
    getOrchestration.mockResolvedValue(orquestacion)
    getConnectionTarget.mockResolvedValue({ kind: 'cids' })
    const res = respuesta()
    await RUTAS['orchestration-info']({ method: 'GET', query: { id: 'o-1' } }, res)
    expect(res.codigo).toBe(400)
  })

  it('devuelve los pasos SIN el body de cada integración, las variables y los últimos valores', async () => {
    getOrchestration.mockResolvedValue(orquestacion)
    getConnectionTarget.mockResolvedValue({ kind: 'ci' })
    ci.infoDeOrquestacion.mockResolvedValue({
      pasos: [{ nodeId: 'a', label: 'A', integrationId: 'i-1', variables: ['DESDE'], integracion: { id: 'i-1', name: 'N', folder: 'F', resumen: { valido: true }, body: 'SECRETO-GRANDE' } }],
      variables: ['DESDE'],
      rotos: [],
    })
    ci.ultimasVariables.mockResolvedValue({ DESDE: '20261005' })
    const res = respuesta()
    await RUTAS['orchestration-info']({ method: 'GET', query: { id: 'o-1' } }, res)

    expect(res.codigo).toBe(200)
    expect(JSON.stringify(res.cuerpo)).not.toContain('SECRETO-GRANDE')
    expect(res.cuerpo.pasos[0].integracion).toEqual({ id: 'i-1', name: 'N', folder: 'F', resumen: { valido: true } })
    expect(res.cuerpo.ultimas).toEqual({ DESDE: '20261005' })
    expect(ci.ultimasVariables).toHaveBeenCalledWith('c-1', { orchestrationId: 'o-1' })
  })
})
