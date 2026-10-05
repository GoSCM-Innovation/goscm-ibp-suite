// @vitest-environment jsdom
//
// El cliente de nuestra API: anota las llamadas con su operación y avisa una vez cuando la sesión
// ya no vale.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SESION_VENCIDA, api } from './api.js'
import { limpiarLlamadas, llamadas } from './tech-logs.js'

const responder = (estado, cuerpo) => vi.fn(async () => ({
  ok: estado >= 200 && estado < 300,
  status: estado,
  text: async () => JSON.stringify(cuerpo),
}))

beforeEach(() => { limpiarLlamadas() })
afterEach(() => { vi.unstubAllGlobals() })

describe('sesión vencida', () => {
  it('avisa a la aplicación cuando una ruta normal contesta 401', async () => {
    vi.stubGlobal('fetch', responder(401, { error: 'Sesión no válida o vencida.' }))
    const aviso = vi.fn()
    window.addEventListener(SESION_VENCIDA, aviso)

    await expect(api.get('/api/connections', { kind: 'cids' })).rejects.toThrow('Sesión no válida')
    window.removeEventListener(SESION_VENCIDA, aviso)

    expect(aviso).toHaveBeenCalledTimes(1)
  })

  it('no avisa en las rutas de acceso: allí un 401 es «código incorrecto»', async () => {
    vi.stubGlobal('fetch', responder(401, { error: 'Código incorrecto o vencido.' }))
    const aviso = vi.fn()
    window.addEventListener(SESION_VENCIDA, aviso)

    await expect(api.post('/api/auth/verify-code', { code: '1' })).rejects.toThrow('Código incorrecto')
    window.removeEventListener(SESION_VENCIDA, aviso)

    expect(aviso).not.toHaveBeenCalled()
  })

  it('un error que no es 401 no lo dispara', async () => {
    vi.stubGlobal('fetch', responder(500, { error: 'Falló' }))
    const aviso = vi.fn()
    window.addEventListener(SESION_VENCIDA, aviso)
    await expect(api.get('/api/x')).rejects.toThrow('Falló')
    window.removeEventListener(SESION_VENCIDA, aviso)
    expect(aviso).not.toHaveBeenCalled()
  })
})

describe('panel de diagnóstico', () => {
  it('anota la operación junto a la ruta, para distinguir getProjects de runTask', async () => {
    vi.stubGlobal('fetch', responder(200, { result: [] }))
    await api.post('/api/cids/call', { operation: 'getProjects' })
    await api.post('/api/cids/call', { operation: 'runTask' })

    expect(llamadas().map((una) => una.ruta)).toEqual([
      '/api/cids/call · runTask',
      '/api/cids/call · getProjects',
    ])
  })

  it('sin operación deja la ruta tal cual', async () => {
    vi.stubGlobal('fetch', responder(200, {}))
    await api.get('/api/connections')
    expect(llamadas()[0].ruta).toBe('/api/connections')
  })
})
