// Lo que los handlers de IBP hacen con lo que llega del navegador: nombres de tabla que no se pegan en la
// ruta de SAP y conexiones que fallan al prepararse. No lee nada de SAP: todo lo de abajo está simulado.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../core/auth/guards.js', () => ({ requireModule: vi.fn() }))
vi.mock('../../core/connections/index.js', () => ({
  getAnyCredentials: vi.fn(),
  getConnectionTarget: vi.fn(),
  getCredentials: vi.fn(),
}))
vi.mock('../../core/ibp/master-data-edit-run.js', () => ({ escribirDatoMaestro: vi.fn() }))

const { requireModule } = await import('../../core/auth/guards.js')
const { getAnyCredentials, getConnectionTarget } = await import('../../core/connections/index.js')
const { escribirDatoMaestro } = await import('../../core/ibp/master-data-edit-run.js')
const { default: edicion } = await import('./master-data-edit.js')
const { default: migracion } = await import('./migration-run.js')
const { default: jobRuns } = await import('./job-runs.js')
const { default: masterData } = await import('./master-data.js')
const { default: planningData } = await import('./planning-data.js')

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
  requireModule.mockResolvedValue({ clientId: 'cliente-1', userId: 'u-1' })
  getConnectionTarget.mockResolvedValue({ kind: 'ibp', baseUrl: 'https://t-api.scmibp1.ondemand.com' })
  getAnyCredentials.mockResolvedValue({ user: 'u', password: 'p' })
})

describe('master-data-edit: el nombre de la tabla', () => {
  const pedido = (entidad) => ({
    method: 'POST',
    body: {
      accion: 'modificar',
      connectionId: 'c-1',
      entidad,
      planningArea: 'PA1',
      claves: ['PRDID'],
      edits: { A: { PRDID: 'A', X: '1' } },
      confirmacion: 'ESCRIBIR',
    },
  })

  it.each(['../PLANNING_DATA_API_SRV/X', 'A/B', 'A?x=1', 'A B'])('rechaza "%s" sin llamar a SAP', async (entidad) => {
    const res = respuesta()
    await edicion(pedido(entidad), res)
    // Pueden salir por la confirmación antes que por el nombre; en los dos casos no se escribe nada.
    expect(res.codigo).toBe(400)
    expect(escribirDatoMaestro).not.toHaveBeenCalled()
  })
})

describe('migration-run: las tablas de origen y de destino', () => {
  it.each([
    ['entidad', { entidad: 'A/../B', entidadDestino: 'OK' }],
    ['entidadDestino', { entidad: 'OK', entidadDestino: 'A?x=1' }],
  ])('rechaza un nombre raro en %s', async (nombre, tablas) => {
    const res = respuesta()
    await migracion({
      method: 'POST',
      body: { accion: 'preparar', origen: { connectionId: 'c-1' }, destino: { connectionId: 'c-2' }, ...tablas },
    }, res)
    expect(res.codigo).toBe(400)
    expect(res.cuerpo.error).toMatch(/nombre de la tabla no es válido/)
    expect(getConnectionTarget).not.toHaveBeenCalled()
  })
})

// Una conexión que no es de este cliente hace que `getConnectionTarget` lance. Eso es un 400 explicado y no un
// 500 sin controlar.
describe.each([
  ['job-runs', jobRuns, { method: 'GET', query: { connectionId: 'ajena', accion: 'lista' } }],
  ['master-data', masterData, { method: 'GET', query: { connectionId: 'ajena', accion: 'catalogo' } }],
  ['planning-data', planningData, { method: 'GET', query: { connectionId: 'ajena', accion: 'catalogo' } }],
])('%s con una conexión que no es de este cliente', (nombre, handler, peticion) => {
  it('responde 400 con el motivo', async () => {
    getConnectionTarget.mockRejectedValue(new Error('La conexión no existe para este cliente.'))
    const res = respuesta()
    await expect(handler(peticion, res)).resolves.not.toThrow()
    expect(res.codigo).toBe(400)
    expect(res.cuerpo.error).toBeTruthy()
  })
})
