import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../transport/sap-fetch.js', () => ({ sapFetch: vi.fn() }))

const { sapFetch } = await import('../transport/sap-fetch.js')
const { analizarTabla, leerCampos } = await import('./migration.js')

const origen = { baseUrl: 'https://a.scmibp.ondemand.com', credentials: { user: 'a' }, planningArea: 'PA1', versionId: 'V1' }
const destino = { baseUrl: 'https://b.scmibp.ondemand.com', credentials: { user: 'b' }, planningArea: 'PA2', versionId: '' }
const esperar = () => Promise.resolve()

/** Una fila de muestra con su dirección, de la que salen las claves. */
const muestra = (entidad, columnas) => ({
  __metadata: { uri: `https://x/${entidad}(${columnas[0]}='1',PlanningAreaID='PA',VersionID='V')` },
  ...Object.fromEntries(columnas.map((uno) => [uno, 'x'])),
})

/** Responde según la tabla y según sea cuenta o muestra. `null` = vacía; `undefined` = falla. */
function tenants({ cuenta = 0, porEntidad = {} } = {}) {
  sapFetch.mockImplementation(({ url }) => {
    if (url.includes('$inlinecount')) {
      if (cuenta === 'falla') return Promise.reject(Object.assign(new Error('500'), { status: 500, retryable: true }))
      return Promise.resolve({ json: { d: { __count: String(cuenta), results: [] } } })
    }
    const entidad = /\/MASTER_DATA_API_SRV\/([A-Z0-9_]+)\?/.exec(url)[1]
    const columnas = porEntidad[entidad]
    if (columnas === undefined) return Promise.reject(Object.assign(new Error('400'), { status: 400, retryable: false }))
    return Promise.resolve({ json: { d: { results: columnas === null ? [] : [muestra(entidad, columnas)] } } })
  })
}

beforeEach(() => { sapFetch.mockReset() })

describe('analizarTabla', () => {
  it('compara las columnas de los dos lados y cuenta el origen', async () => {
    tenants({
      cuenta: 8005,
      porEntidad: { GIDPRODUCT: ['PRDID', 'BRAND', 'SOLOAQUI'], AS1PRODUCT: ['PRDID', 'BRAND', 'SOLOALLA'] },
    })

    const salida = await analizarTabla({ origen, destino, entidad: 'GIDPRODUCT', entidadDestino: 'AS1PRODUCT', esperar })
    expect(salida).toMatchObject({
      count: 8005,
      verifiable: true,
      common: ['PRDID', 'BRAND'],
      omitted: ['SOLOAQUI'],
      unfilled: ['SOLOALLA'],
      srcKeys: ['PRDID'],
      dstKeys: ['PRDID'],
    })
  })

  // Cada petición cuesta unos seis segundos fijos: el análisis de v8 eran tres por tabla.
  it('hace exactamente tres lecturas por tabla', async () => {
    tenants({ cuenta: 1, porEntidad: { T: ['A'], T2: ['A'] } })
    await analizarTabla({ origen, destino, entidad: 'T', entidadDestino: 'T2', esperar })
    expect(sapFetch).toHaveBeenCalledTimes(3)
  })

  // Las columnas no dependen de la versión, y una lectura filtrada por versión puede tardar minutos.
  it('las muestras se leen por área y SIN versión; la cuenta, con versión y filtro', async () => {
    tenants({ cuenta: 1, porEntidad: { T: ['A'], T2: ['A'] } })
    await analizarTabla({ origen, destino, entidad: 'T', entidadDestino: 'T2', extraFilter: "BRAND eq 'X'", esperar })

    const urls = sapFetch.mock.calls.map(([uno]) => decodeURIComponent(uno.url))
    const cuenta = urls.find((uno) => uno.includes('$inlinecount'))
    expect(cuenta).toContain("PlanningAreaID eq 'PA1' and VersionID eq 'V1' and (BRAND eq 'X')")
    for (const una of urls.filter((uno) => uno.includes('$top=1'))) {
      expect(una).not.toContain('VersionID')
      expect(una).not.toContain('BRAND')
    }
  })

  it('no cuenta los campos de solo lectura como diferencias', async () => {
    tenants({ cuenta: 1, porEntidad: { T: ['A', 'PlanningAreaID', 'CREATEDDATE'], T2: ['A', 'VersionID'] } })
    const salida = await analizarTabla({ origen, destino, entidad: 'T', entidadDestino: 'T2', esperar })
    expect(salida).toMatchObject({ common: ['A'], omitted: [], unfilled: [], srcFields: ['A'] })
  })

  // Sin fila de muestra en el destino no se puede recortar: se mandan todas las del origen (v8).
  it('un destino vacío deja el esquema sin verificar, con todas las columnas del origen', async () => {
    tenants({ cuenta: 5, porEntidad: { T: ['A', 'B', 'VersionID'], T2: null } })
    const salida = await analizarTabla({ origen, destino, entidad: 'T', entidadDestino: 'T2', esperar })
    expect(salida).toMatchObject({ verifiable: false, common: null, srcFields: ['A', 'B'], dstKeys: [] })
  })

  it('una muestra que no se puede leer también deja el esquema sin verificar', async () => {
    tenants({ cuenta: 5, porEntidad: { T: ['A'] } })
    const salida = await analizarTabla({ origen, destino, entidad: 'T', entidadDestino: 'NOEXISTE', esperar })
    expect(salida).toMatchObject({ verifiable: false, srcFields: ['A'] })
  })

  it('una cuenta que no se pudo hacer sale como null, no como cero', async () => {
    tenants({ cuenta: 'falla', porEntidad: { T: ['A'], T2: ['A'] } })
    const salida = await analizarTabla({ origen, destino, entidad: 'T', entidadDestino: 'T2', esperar })
    expect(salida.count).toBeNull()
  })
})

describe('leerCampos', () => {
  it('una tabla vacía devuelve null', async () => {
    tenants({ porEntidad: { T: null } })
    await expect(leerCampos({ ...origen, entidad: 'T', esperar })).resolves.toBeNull()
  })

  it('repite un fallo pasajero y no uno de datos', async () => {
    sapFetch
      .mockRejectedValueOnce(Object.assign(new Error('502'), { status: 502, retryable: true }))
      .mockResolvedValueOnce({ json: { d: { results: [muestra('T', ['A'])] } } })
    await expect(leerCampos({ ...origen, entidad: 'T', esperar })).resolves.toMatchObject({ columnas: ['A'] })

    sapFetch.mockReset()
    sapFetch.mockRejectedValue(Object.assign(new Error('400'), { status: 400, retryable: false }))
    await expect(leerCampos({ ...origen, entidad: 'T', esperar })).rejects.toThrow('400')
    expect(sapFetch).toHaveBeenCalledTimes(1)
  })
})
