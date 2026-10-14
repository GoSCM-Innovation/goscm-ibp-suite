import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }
vi.mock('./api.js', () => ({ api }))

const ci = await import('./ci.js')

const integracion = (name, folder = '', extra = {}) => ({ id: `id-${name}`, name, folder, resumen: { valido: true }, ...extra })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('llamadas a la API', () => {
  it('pide las conexiones de tipo ci', async () => {
    api.get.mockResolvedValue({ connections: [{ id: 'c' }] })
    await expect(ci.listCiConnections()).resolves.toEqual([{ id: 'c' }])
    expect(api.get).toHaveBeenCalledWith('/api/connections', { kind: 'ci' })
  })

  it('lista, lee, crea, guarda, duplica y borra integraciones', async () => {
    api.get.mockResolvedValueOnce({ integrations: [1] }).mockResolvedValueOnce({ integration: { id: 'x' } })
    api.post.mockResolvedValue({ integration: { id: 'n' } })
    api.patch.mockResolvedValue({ integration: { id: 'p' } })
    api.del.mockResolvedValue({})

    expect(await ci.listIntegraciones('conn')).toEqual([1])
    expect(api.get).toHaveBeenLastCalledWith('/api/ci/integrations', { connectionId: 'conn' })

    expect(await ci.getIntegracion('x')).toEqual({ id: 'x' })
    expect(api.get).toHaveBeenLastCalledWith('/api/ci/integrations', { id: 'x' })

    await ci.crearIntegracion({ connectionId: 'conn', folder: 'A', name: 'N', body: '{}' })
    expect(api.post).toHaveBeenLastCalledWith('/api/ci/integrations', { connectionId: 'conn', folder: 'A', name: 'N', body: '{}' })

    await ci.guardarIntegracion('x', { name: 'Nuevo' })
    expect(api.patch).toHaveBeenCalledWith('/api/ci/integrations', { id: 'x', name: 'Nuevo' })

    await ci.duplicarIntegracion('x')
    expect(api.post).toHaveBeenLastCalledWith('/api/ci/integrations', { action: 'duplicate', id: 'x' })

    await ci.borrarIntegracion('x')
    expect(api.del).toHaveBeenCalledWith('/api/ci/integrations', { id: 'x' })
  })

  it('renombra una carpeta', async () => {
    api.post.mockResolvedValue({ renamed: 4 })
    await expect(ci.renombrarCarpeta('conn', 'A', 'B')).resolves.toBe(4)
    expect(api.post).toHaveBeenCalledWith('/api/ci/integrations', { action: 'rename-folder', connectionId: 'conn', from: 'A', to: 'B' })
  })

  it('ejecuta una integración con sus variables y devuelve el resultado', async () => {
    api.post.mockResolvedValue({ run: { resultado: 'success' } })
    await expect(ci.ejecutarIntegracion({ connectionId: 'c', integrationId: 'i', variables: { D: '1' } }))
      .resolves.toEqual({ resultado: 'success' })
    expect(api.post).toHaveBeenCalledWith('/api/ci/run', { connectionId: 'c', integrationId: 'i', variables: { D: '1' } })
  })

  it('el historial manda solo los filtros que se pidieron', async () => {
    api.get.mockResolvedValue({ runs: [] })
    await ci.listarEjecuciones('c')
    expect(api.get).toHaveBeenLastCalledWith('/api/ci/runs', { connectionId: 'c' })
    await ci.listarEjecuciones('c', { integrationId: 'i', limit: 20 })
    expect(api.get).toHaveBeenLastCalledWith('/api/ci/runs', { connectionId: 'c', integrationId: 'i', limit: '20' })
  })

  it('pide los últimos valores de variables de una integración', async () => {
    api.get.mockResolvedValue({ variables: { D: '1' } })
    await expect(ci.ultimasVariablesDeIntegracion('i')).resolves.toEqual({ D: '1' })
    expect(api.get).toHaveBeenCalledWith('/api/ci/runs', { variablesDe: 'integration', id: 'i' })
  })

  it('pide la información de una orquestación', async () => {
    api.get.mockResolvedValue({ pasos: [] })
    await ci.infoDeOrquestacion('o')
    expect(api.get).toHaveBeenCalledWith('/api/ci/orchestration-info', { id: 'o' })
  })
})

describe('arbolDeCarpetas', () => {
  const lista = [
    integracion('CLIENTES', 'STARBRANDS/Maestros'),
    integracion('PRODUCTOS', 'STARBRANDS/Maestros'),
    integracion('FACTURAS', 'STARBRANDS/Cifras'),
    integracion('SUELTA'),
    integracion('OTRA', 'Zeta'),
  ]

  it('arma las carpetas a partir de las rutas y deja las sueltas en la raíz', () => {
    const raiz = ci.arbolDeCarpetas(lista)
    expect(raiz.integraciones.map((i) => i.name)).toEqual(['SUELTA'])
    expect(raiz.carpetas.map((c) => c.nombre)).toEqual(['STARBRANDS', 'Zeta'])

    const star = raiz.carpetas[0]
    expect(star.ruta).toBe('STARBRANDS')
    expect(star.integraciones).toEqual([])
    expect(star.carpetas.map((c) => c.ruta)).toEqual(['STARBRANDS/Cifras', 'STARBRANDS/Maestros'])
    expect(star.carpetas[1].integraciones.map((i) => i.name)).toEqual(['CLIENTES', 'PRODUCTOS'])
  })

  // Orden del español: «á» va con la «a», no después de la «z».
  it('ordena como el español, sin mandar los acentos al final', () => {
    const raiz = ci.arbolDeCarpetas([integracion('b'), integracion('á'), integracion('A')])
    expect(raiz.integraciones.map((i) => i.name)).toEqual(['A', 'á', 'b'])
  })

  it('con filtro deja solo lo que coincide, y las carpetas que tienen algo', () => {
    const raiz = ci.arbolDeCarpetas(lista, 'factu')
    expect(raiz.integraciones).toEqual([])
    expect(raiz.carpetas.map((c) => c.ruta)).toEqual(['STARBRANDS'])
    expect(raiz.carpetas[0].carpetas.map((c) => c.ruta)).toEqual(['STARBRANDS/Cifras'])
  })

  it('el filtro también mira la carpeta, el lote y el área', () => {
    const conResumen = [
      integracion('A', 'X', { resumen: { nombreDeLote: 'PRODCONF_ABIERTAS' } }),
      integracion('B', 'Y', { resumen: { areaDePlanificacion: 'AREA_DEMO' } }),
    ]
    expect(ci.arbolDeCarpetas(conResumen, 'prodconf').carpetas.map((c) => c.nombre)).toEqual(['X'])
    expect(ci.arbolDeCarpetas(conResumen, 'area_demo').carpetas.map((c) => c.nombre)).toEqual(['Y'])
    expect(ci.arbolDeCarpetas(conResumen, 'x').carpetas.map((c) => c.nombre)).toEqual(['X'])
  })

  it('el filtro no distingue acentos', () => {
    const raiz = ci.arbolDeCarpetas([integracion('Producción')], 'produccion')
    expect(raiz.integraciones.map((i) => i.name)).toEqual(['Producción'])
  })

  it('sin nada devuelve una raíz vacía', () => {
    expect(ci.arbolDeCarpetas([])).toEqual({ ruta: '', nombre: '', carpetas: [], integraciones: [] })
  })
})

describe('carpetasExistentes', () => {
  it('incluye las intermedias, ordenadas y sin repetir', () => {
    expect(ci.carpetasExistentes([integracion('a', 'A/B/C'), integracion('b', 'A/B'), integracion('c', ''), integracion('d', 'Z')]))
      .toEqual(['A', 'A/B', 'A/B/C', 'Z'])
  })
})

describe('lo que se muestra', () => {
  it('etiqueta una integración con su carpeta', () => {
    expect(ci.etiquetaDeIntegracion({ folder: 'A/B', name: 'N' })).toBe('A/B / N')
    expect(ci.etiquetaDeIntegracion({ folder: '', name: 'N' })).toBe('N')
  })

  it('toda ejecución y todo paso tienen un nombre y un color', () => {
    for (const estado of ['running', 'success', 'error', 'unconfirmed']) {
      expect(ci.ESTADOS_DE_EJECUCION[estado]).toMatchObject({ texto: expect.any(String), clase: expect.any(String) })
    }
    for (const estado of ['pending', 'running', 'success', 'success_with_errors', 'error', 'skipped', 'cancelled']) {
      expect(ci.ESTADOS_DE_PASO[estado]).toMatchObject({ texto: expect.any(String), clase: expect.any(String) })
    }
  })

  it('una carga en duda NO se pinta como un error ni como un éxito', () => {
    expect(ci.ESTADOS_DE_EJECUCION.unconfirmed.clase).not.toBe(ci.ESTADOS_DE_EJECUCION.error.clase)
    expect(ci.ESTADOS_DE_EJECUCION.unconfirmed.clase).not.toBe(ci.ESTADOS_DE_EJECUCION.success.clase)
  })

  it('la fecha tolera lo vacío y lo inválido', () => {
    expect(ci.fechaLegible(null)).toBe('—')
    expect(ci.fechaLegible('no es una fecha')).toBe('—')
    expect(ci.fechaLegible('2026-10-14T12:30:00Z')).not.toBe('—')
  })
})
