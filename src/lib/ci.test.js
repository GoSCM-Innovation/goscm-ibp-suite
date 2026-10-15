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

describe('arbolPorDestino', () => {
  const con = (id, name, folder, destino, claseDeDestino) => ({
    id, name, folder, resumen: { valido: true, destino, claseDeDestino },
  })
  const LISTA = [
    con('1', 'PRODUCTOS B', 'DM', 'SBPRODUCT', 'tabla'),
    con('2', 'UOMTO', 'DM', 'SBUOMTO', 'tabla'),
    con('3', 'PRODUCTOS A', 'PRD/DM', 'SBPRODUCT', 'tabla'),
    con('4', 'FACTURAS', 'Cifras', 'ZFACTURAS', 'cifra'),
    con('5', 'A MEDIAS', '', '', ''),
    { id: '6', name: 'ROTA', folder: '', resumen: { valido: false, error: 'x' } },
  ]
  const forma = (arbol) => arbol.grupos.map((g) => [g.id, g.destinos.map((d) => [d.destino, d.integraciones.map((i) => i.name)])])

  it('tablas primero, cifras después y al final las que no tienen destino', () => {
    expect(forma(ci.arbolPorDestino(LISTA))).toEqual([
      ['tabla', [['SBPRODUCT', ['PRODUCTOS A', 'PRODUCTOS B']], ['SBUOMTO', ['UOMTO']]]],
      ['cifra', [['ZFACTURAS', ['FACTURAS']]]],
      ['sin', [['', ['A MEDIAS', 'ROTA']]]],
    ])
  })

  it('las integraciones que cargan a la misma tabla quedan juntas, aunque estén en carpetas distintas', () => {
    const [tablas] = ci.arbolPorDestino(LISTA).grupos
    const producto = tablas.destinos.find((d) => d.destino === 'SBPRODUCT')
    expect(producto.integraciones.map((i) => i.folder).sort()).toEqual(['DM', 'PRD/DM'])
  })

  it('destinos e integraciones en orden alfabético, sin distinguir acentos en el orden', () => {
    const desordenada = [con('1', 'b', '', 'ZB', 'cifra'), con('2', 'a', '', 'ZA', 'cifra'), con('3', 'á', '', 'ZA', 'cifra')]
    expect(forma(ci.arbolPorDestino(desordenada))).toEqual([['cifra', [['ZA', ['a', 'á']], ['ZB', ['b']]]]])
  })

  it('un destino se agrupa sin distinguir mayúsculas y se enseña como lo escribió la primera', () => {
    const lista = [con('1', 'x', '', 'SBProduct', 'tabla'), con('2', 'y', '', 'SBPRODUCT', 'tabla')]
    const [tablas] = ci.arbolPorDestino(lista).grupos
    expect(tablas.destinos).toHaveLength(1)
    expect(tablas.destinos[0].destino).toBe('SBProduct')
    expect(tablas.destinos[0].integraciones).toHaveLength(2)
  })

  it('no enseña grupos vacíos', () => {
    expect(ci.arbolPorDestino([con('1', 'x', '', 'SBPRODUCT', 'tabla')]).grupos.map((g) => g.id)).toEqual(['tabla'])
    expect(ci.arbolPorDestino([]).grupos).toEqual([])
  })

  it('un destino con una clase que no se conoce va a «Sin destino»: no se pierde', () => {
    expect(forma(ci.arbolPorDestino([con('1', 'x', '', 'RARO', 'otra')]))).toEqual([['sin', [['', ['x']]]]])
  })

  it('el filtro deja solo lo que coincide, también por destino, y quita lo vacío', () => {
    expect(forma(ci.arbolPorDestino(LISTA, 'uomto'))).toEqual([['tabla', [['SBUOMTO', ['UOMTO']]]]])
    expect(forma(ci.arbolPorDestino(LISTA, 'zfact'))).toEqual([['cifra', [['ZFACTURAS', ['FACTURAS']]]]])
    expect(ci.arbolPorDestino(LISTA, 'nada que coincida').grupos).toEqual([])
  })

  it('el filtro de carpetas también busca por destino', () => {
    const arbol = ci.arbolDeCarpetas(LISTA, 'sbuomto')
    const nombres = (nodo) => [...nodo.integraciones.map((i) => i.name), ...nodo.carpetas.flatMap(nombres)]
    expect(nombres(arbol)).toEqual(['UOMTO'])
  })

  it('no repite ni pierde ninguna integración', () => {
    const todas = ci.arbolPorDestino(LISTA).grupos.flatMap((g) => g.destinos.flatMap((d) => d.integraciones.map((i) => i.id))).sort()
    expect(todas).toEqual(['1', '2', '3', '4', '5', '6'])
  })
})

describe('opcionesDeCarpeta', () => {
  it('«Sin carpeta» primero, con valor vacío, y después las existentes tal cual', () => {
    expect(ci.opcionesDeCarpeta(['A', 'A/B'])).toEqual([
      { value: '', label: 'Sin carpeta' },
      { value: 'A', label: 'A' },
      { value: 'A/B', label: 'A/B' },
    ])
  })

  it('sin carpetas, solo «Sin carpeta»', () => {
    expect(ci.opcionesDeCarpeta([])).toEqual([{ value: '', label: 'Sin carpeta' }])
  })

  it('crear una carpeta nueva no se trata como error', () => {
    expect(ci.TEXTOS_DE_CARPETA.aviso).toBe('')
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
      expect(ci.ESTADOS_DE_PASO[estado]).toMatchObject({ texto: expect.any(String), clase: expect.any(String), icono: expect.any(String) })
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
