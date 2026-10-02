// El endpoint del enriquecimiento del documentador: lo que decide el handler, no lo que lee SAP.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../core/auth/guards.js', () => ({ requireModule: vi.fn() }))
vi.mock('../../core/connections/index.js', () => ({
  getAnyCredentials: vi.fn(),
  getConnectionTarget: vi.fn(),
}))
vi.mock('../../core/ibp/pa-doc-live.js', () => ({
  conjuntosDeDatoMaestro: vi.fn(),
  contarTipos: vi.fn(),
  leerAppJobs: vi.fn(),
  resolverEntidades: vi.fn((ids) => Object.fromEntries(ids.map((id) => [id, id]))),
}))

const { requireModule } = await import('../../core/auth/guards.js')
const { getAnyCredentials, getConnectionTarget } = await import('../../core/connections/index.js')
const { contarTipos, leerAppJobs } = await import('../../core/ibp/pa-doc-live.js')
const { default: handler, idsDe, MAX_IDS } = await import('./pa-doc-live.js')

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
  requireModule.mockResolvedValue({ clientId: 'cliente-1' })
  getConnectionTarget.mockResolvedValue({ kind: 'ibp', baseUrl: 'https://t-api.scmibp1.ondemand.com' })
  getAnyCredentials.mockResolvedValue({ user: 'u', password: 'p' })
})

describe('idsDe', () => {
  it('deja solo textos, sin repetir ni vacíos', () => {
    expect(idsDe(['A', ' A ', '', 3, null, 'B'])).toEqual(['A', 'B'])
  })

  it('lo que no es una lista no es nada', () => {
    expect(idsDe('A')).toEqual([])
    expect(idsDe(undefined)).toEqual([])
  })

  it('tiene tope', () => {
    const muchos = Array.from({ length: MAX_IDS + 50 }, (nada, i) => `T${i}`)
    expect(idsDe(muchos)).toHaveLength(MAX_IDS)
  })

  it('descarta un identificador absurdamente largo', () => {
    expect(idsDe(['x'.repeat(101)])).toEqual([])
  })
})

describe('el handler', () => {
  it('solo acepta POST', async () => {
    const res = respuesta()
    await handler({ method: 'GET' }, res)
    expect(res.codigo).toBe(405)
  })

  // La verificación de módulo vive en el servidor: ocultar un botón no restringe nada.
  it('exige el módulo Data Tools', async () => {
    const res = respuesta()
    await handler({ method: 'POST', body: { connectionId: 'c', accion: 'volumetria', ids: ['A'] } }, res)
    expect(requireModule).toHaveBeenCalledWith(expect.anything(), res, 'explorer')
  })

  it('sin sesión no hace nada más', async () => {
    requireModule.mockResolvedValueOnce(null)
    const res = respuesta()
    await handler({ method: 'POST', body: { connectionId: 'c', accion: 'volumetria', ids: ['A'] } }, res)
    expect(getConnectionTarget).not.toHaveBeenCalled()
  })

  it('pide la conexión', async () => {
    const res = respuesta()
    await handler({ method: 'POST', body: { accion: 'volumetria' } }, res)
    expect(res.codigo).toBe(400)
  })

  it('la conexión se busca con el cliente de la sesión, nunca con uno que mande el navegador', async () => {
    const res = respuesta()
    await handler({
      method: 'POST',
      body: { connectionId: 'c1', clientId: 'otro-cliente', accion: 'volumetria', ids: ['A'] },
    }, res)
    expect(getConnectionTarget).toHaveBeenCalledWith('cliente-1', 'c1')
  })

  it('rechaza una conexión que no es de IBP', async () => {
    getConnectionTarget.mockResolvedValueOnce({ kind: 'cids' })
    const res = respuesta()
    await handler({ method: 'POST', body: { connectionId: 'c', accion: 'application-jobs' } }, res)
    expect(res.codigo).toBe(400)
  })

  it('la volumetría usa el acuerdo de dato maestro y devuelve las cuentas', async () => {
    contarTipos.mockResolvedValueOnce({ A: 5 })
    const res = respuesta()
    await handler({ method: 'POST', body: { connectionId: 'c', accion: 'volumetria', ids: ['A'] } }, res)

    expect(getAnyCredentials).toHaveBeenCalledWith('cliente-1', 'c', ['SAP_COM_0720', 'SAP_COM_0326'])
    expect(res.cuerpo).toEqual({ cuentas: { A: 5 } })
  })

  it('la volumetría sin tipos es un error del que llama', async () => {
    const res = respuesta()
    await handler({ method: 'POST', body: { connectionId: 'c', accion: 'volumetria', ids: [] } }, res)
    expect(res.codigo).toBe(400)
    expect(contarTipos).not.toHaveBeenCalled()
  })

  it('los Application Jobs usan el acuerdo 0326', async () => {
    leerAppJobs.mockResolvedValueOnce({ entidades: {}, jobs: [] })
    const res = respuesta()
    await handler({ method: 'POST', body: { connectionId: 'c', accion: 'application-jobs' } }, res)

    expect(getAnyCredentials).toHaveBeenCalledWith('cliente-1', 'c', ['SAP_COM_0326', 'SAP_COM_0720'])
    expect(res.cuerpo).toEqual({ entidades: {}, jobs: [] })
  })

  it('una acción desconocida es un 400', async () => {
    const res = respuesta()
    await handler({ method: 'POST', body: { connectionId: 'c', accion: 'borrar' } }, res)
    expect(res.codigo).toBe(400)
  })

  it('un permiso que falta se explica con el acuerdo', async () => {
    leerAppJobs.mockRejectedValueOnce(Object.assign(new Error('SAP devolvió 403'), { status: 403 }))
    const res = respuesta()
    await handler({ method: 'POST', body: { connectionId: 'c', accion: 'application-jobs' } }, res)

    expect(res.codigo).toBe(400)
    expect(res.cuerpo.error).toContain('SAP_COM_0326')
  })
})
