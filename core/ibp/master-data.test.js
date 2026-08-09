import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../transport/sap-fetch.js', () => ({ sapFetch: vi.fn() }))

const { sapFetch } = await import('../transport/sap-fetch.js')
const {
  countEntity, masterDataRoot, readDistinctValues, readEntityPage,
  readImportableMdts, readSchema, readVsmt,
} = await import('./master-data.js')

const BASE = 'https://tenant-api.scmibp1.ondemand.com'
const cred = { user: 'u', password: 'p' }
const contexto = { baseUrl: BASE, credentials: cred }

beforeEach(() => { sapFetch.mockReset() })

/** La URL de la llamada número `n`, ya legible. */
const urlDe = (n = 0) => decodeURIComponent(sapFetch.mock.calls[n][0].url)

describe('masterDataRoot', () => {
  it('apunta al servicio de dato maestro', () => {
    expect(masterDataRoot(BASE)).toBe(`${BASE}/sap/opu/odata/IBP/MASTER_DATA_API_SRV`)
  })
})

describe('readVsmt', () => {
  it('pide solo las columnas del catálogo', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { results: [{ PlanningAreaID: 'PA' }] } } })
    await expect(readVsmt(contexto)).resolves.toHaveLength(1)
    expect(urlDe()).toContain('$select=PlanningAreaID,VersionID,MasterDataTypeID,PlanningAreaDescr,VersionName')
  })
})

describe('readImportableMdts', () => {
  // Los tipos de referencia y los virtuales no generan entidad `Trans` y no se pueden cargar;
  // ofrecerlos sería prometer algo que falla al final.
  it('se queda con los tipos que exponen una entidad Trans', async () => {
    sapFetch.mockResolvedValueOnce({
      json: { d: { EntitySets: ['AS1PRODUCT', 'AS1PRODUCTTrans', 'AS1UOMTO', 'AS1UOMTOTrans', 'Solo'] } },
    })
    await expect(readImportableMdts(contexto)).resolves.toEqual(['AS1PRODUCT', 'AS1UOMTO'])
  })

  it('un tenant sin nada importable devuelve una lista vacía', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { EntitySets: [] } } })
    await expect(readImportableMdts(contexto)).resolves.toEqual([])
  })
})

describe('countEntity', () => {
  // Aquí sí es seguro; en PLANNING_DATA_API_SRV revienta el tenant.
  it('cuenta con $top=0 y $inlinecount', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { __count: '8005' } } })

    await expect(countEntity({ ...contexto, entidad: 'AS1PRODUCT', planningArea: 'PA' })).resolves.toBe(8005)
    expect(urlDe()).toContain('$top=0&$inlinecount=allpages')
    expect(urlDe()).toContain("PlanningAreaID eq 'PA'")
  })

  it('sin cuenta devuelve cero, no NaN', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: {} } })
    await expect(countEntity({ ...contexto, entidad: 'X' })).resolves.toBe(0)
  })
})

describe('readEntityPage', () => {
  it('arma la ventana, el orden, las columnas y el filtro', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { results: [] } } })

    await readEntityPage({
      ...contexto,
      entidad: 'AS1PRODUCT',
      skip: 2000,
      top: 500,
      planningArea: 'PA',
      versionId: 'V1',
      select: ['PRDID', 'BRAND'],
      orderby: ['PRDID'],
      extraFilter: "BRAND eq 'ACME'",
    })

    const url = urlDe()
    expect(url).toContain('$top=500&$skip=2000')
    expect(url).toContain('$orderby=PRDID')
    expect(url).toContain('$select=PRDID,BRAND')
    expect(url).toContain("PlanningAreaID eq 'PA' and VersionID eq 'V1' and (BRAND eq 'ACME')")
  })

  it('quita el sobre de OData de cada fila', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { results: [{ __metadata: { uri: 'x' }, PRDID: '1' }] } } })
    await expect(readEntityPage({ ...contexto, entidad: 'X' })).resolves.toEqual([{ PRDID: '1' }])
  })
})

describe('readSchema', () => {
  /** Responde la muestra a la lectura y la cuenta al conteo. */
  const responder = (muestra, total = '10') => sapFetch.mockImplementation(({ url }) => Promise.resolve({
    json: { d: url.includes('%24top=0') || url.includes('$top=0') ? { __count: total } : { results: muestra ? [muestra] : [] } },
  }))

  it('saca columnas y claves de una fila de muestra', async () => {
    responder({
      __metadata: { uri: "https://t/AS1UOMTO(UOMTOID='2X',PlanningAreaID='PA',VersionID='V')" },
      UOMTOID: '2X', PlanningAreaID: 'PA', FACTOR: 3,
    })

    const esquema = await readSchema({ ...contexto, entidad: 'AS1UOMTO', planningArea: 'PA' })
    expect(esquema.columnas).toEqual(['UOMTOID', 'PlanningAreaID', 'FACTOR'])
    expect(esquema.claves).toEqual(['UOMTOID'])
    expect(esquema).toMatchObject({ total: 10, vacia: false })
    expect(esquema.bytesPorFila).toBeGreaterThan(0)
  })

  // No es lo mismo que un fallo de lectura, y la pantalla lo tiene que decir distinto.
  it('una tabla vacía se marca como vacía, no como error', async () => {
    responder(null, '0')
    await expect(readSchema({ ...contexto, entidad: 'X' })).resolves.toMatchObject({
      vacia: true, columnas: [], claves: [], total: 0,
    })
  })
})

describe('readDistinctValues', () => {
  it('proyecta un solo campo y deduplica', async () => {
    sapFetch.mockResolvedValueOnce({
      json: { d: { results: [{ BRAND: 'B' }, { BRAND: 'A' }, { BRAND: 'B' }, { BRAND: '' }, { BRAND: null }] } },
    })

    await expect(readDistinctValues({ ...contexto, entidad: 'AS1PRODUCT', campo: 'BRAND' }))
      .resolves.toEqual(['A', 'B'])
    expect(urlDe()).toContain('$select=BRAND')
  })
})
