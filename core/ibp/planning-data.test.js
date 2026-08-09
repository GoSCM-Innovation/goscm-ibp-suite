import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../transport/sap-fetch.js', () => ({ sapFetch: vi.fn() }))

const { sapFetch } = await import('../transport/sap-fetch.js')
const {
  countKf, detectConversions, planningRoot, readKfMetadata, readKfPage, readPlanningAreas, readVersions,
} = await import('./planning-data.js')

const BASE = 'https://tenant-api.scmibp.ondemand.com'
const cred = { user: 'u', password: 'p' }
const ctx = { baseUrl: BASE, credentials: cred, area: 'ASIBPTS' }

beforeEach(() => { sapFetch.mockReset() })

const urlDe = (n = 0) => decodeURIComponent(sapFetch.mock.calls[n][0].url)

/** Un error de SAP tal como lo levanta el transporte. */
const fallo = (detail, status = 400) => Object.assign(new Error('Error de SAP'), { detail, status })

describe('planningRoot', () => {
  it('apunta al servicio de planificación', () => {
    expect(planningRoot(BASE)).toBe(`${BASE}/sap/opu/odata/IBP/PLANNING_DATA_API_SRV`)
  })
})

describe('readPlanningAreas', () => {
  it('descubre el área del documento de servicio', async () => {
    sapFetch.mockResolvedValueOnce({
      json: { d: { EntitySets: ['ASIBPTSMessage', 'KeyFigureDeltaDefinitionSet', 'ASIBPTS', 'ASIBPTSTrans'] } },
    })
    await expect(readPlanningAreas({ baseUrl: BASE, credentials: cred })).resolves.toEqual(['ASIBPTS'])
  })
})

describe('readKfMetadata', () => {
  it('devuelve dimensiones, cifras y etiquetas', async () => {
    sapFetch.mockResolvedValueOnce({
      text: '<EntityType Name="ASIBPTS"><Property Name="PRDID" Type="Edm.String"/>'
        + '<Property Name="KF" Type="Edm.Decimal" sap:aggregation-role="measure"/></EntityType>',
    })

    const leido = await readKfMetadata(ctx)
    expect(leido).toMatchObject({ dims: ['PRDID'], cifras: ['KF'] })
  })

  it('un área que no está en los metadatos es un error claro', async () => {
    sapFetch.mockResolvedValueOnce({ text: '<EntityType Name="OTRA"/>' })
    await expect(readKfMetadata(ctx)).rejects.toThrow(/no aparece en los metadatos/)
  })
})

describe('readVersions', () => {
  // El área devuelve una fila por combinación, así que la misma versión llega repetida.
  it('acota la lectura y quita las repetidas', async () => {
    sapFetch.mockResolvedValueOnce({
      json: { d: { results: [
        { VERSIONID: 'B', VERSIONNAME: 'Base' },
        { VERSIONID: 'A', VERSIONNAME: 'Alta' },
        { VERSIONID: 'B', VERSIONNAME: 'Base' },
      ] } },
    })

    await expect(readVersions(ctx)).resolves.toEqual([
      { id: 'A', name: 'Alta' }, { id: 'B', name: 'Base' },
    ])
    expect(urlDe()).toContain('$top=1000')
  })
})

describe('countKf', () => {
  // `$top=0` puede tumbar el tenant al contar a un nivel detallado.
  it('cuenta con un $top pequeño, nunca cero', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { __count: '106996' } } })

    await expect(countKf({ ...ctx, select: ['PRDID', 'KF'], filtro: "UOMTOID eq 'KG'" })).resolves.toBe(106996)
    expect(urlDe()).toContain('$top=2&$inlinecount=allpages')
    expect(urlDe()).not.toContain('$top=0')
  })
})

describe('readKfPage', () => {
  it('arma select, ventana, orden y filtro', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { results: [] } } })

    await readKfPage({
      ...ctx, select: ['PRDID', 'KF'], filtro: "UOMTOID eq 'KG'", orderby: ['PRDID'], skip: 5000, top: 5000,
    })

    const url = urlDe()
    expect(url).toContain('$select=PRDID,KF')
    expect(url).toContain('$top=5000&$skip=5000')
    expect(url).toContain('$orderby=PRDID')
    expect(url).toContain("UOMTOID eq 'KG'")
  })

  // SAP contesta "You must pass at least one attribute or one key figure"; mejor decirlo antes.
  it('sin select no llega a SAP', async () => {
    await expect(readKfPage({ ...ctx, select: [] })).rejects.toThrow(/al menos un atributo/)
    expect(sapFetch).not.toHaveBeenCalled()
  })

  it('quita el sobre de OData', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { results: [{ __metadata: {}, PRDID: '1' }] } } })
    await expect(readKfPage({ ...ctx, select: ['PRDID'] })).resolves.toEqual([{ PRDID: '1' }])
  })
})

describe('detectConversions', () => {
  it('una cifra que no pide nada no da conversiones', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { results: [] } } })
    await expect(detectConversions({ ...ctx, cifra: 'KF' })).resolves.toEqual([])
  })

  it('descubre la unidad que la cifra exige', async () => {
    sapFetch
      .mockRejectedValueOnce(fallo("requires conversion attribute '(UOMTOID)Target Unit of Measure' to be filled."))
      .mockResolvedValueOnce({ json: { d: { results: [] } } })

    await expect(detectConversions({ ...ctx, cifra: 'KF' })).resolves.toEqual(['UOMTOID'])
    // La segunda ronda ya manda el atributo encontrado, con un valor cualquiera.
    expect(urlDe(1)).toContain("UOMTOID eq 'ZZZ'")
  })

  // SAP nombra UNO por respuesta, así que hay cifras que exigen dos rondas.
  it('descubre las dos cuando la cifra pide unidad y moneda', async () => {
    sapFetch
      .mockRejectedValueOnce(fallo('Add property UOMTOID to a filter condition in $filter'))
      .mockRejectedValueOnce(fallo('Add property CURRTOID to a filter condition in $filter'))
      .mockResolvedValueOnce({ json: { d: { results: [] } } })

    await expect(detectConversions({ ...ctx, cifra: 'KF' })).resolves.toEqual(['UOMTOID', 'CURRTOID'])
  })

  // Tragárselo escondería el problema real detrás de una lista de conversiones incompleta.
  it('un error de otra cosa se propaga', async () => {
    sapFetch.mockRejectedValueOnce(fallo('invalid column name: KF', 500))
    await expect(detectConversions({ ...ctx, cifra: 'KF' })).rejects.toThrow()
  })
})
