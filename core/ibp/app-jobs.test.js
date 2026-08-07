import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../transport/sap-fetch.js', () => ({ sapFetch: vi.fn() }))

const { sapFetch } = await import('../transport/sap-fetch.js')
const {
  appJobRoot,
  entitySetNames,
  pickJobEntity,
  readAllPages,
  readJobSteps,
  readTaskIds,
  stepKey,
} = await import('./app-jobs.js')

const BASE = 'https://tenant-api.scmibp1.ondemand.com'

beforeEach(() => { sapFetch.mockReset() })

describe('appJobRoot', () => {
  it('cuelga de /sap/opu/odata/sap/ y lleva la versión pegada', () => {
    expect(appJobRoot(BASE)).toBe(`${BASE}/sap/opu/odata/sap/BC_EXT_APPJOB_MANAGEMENT;v=0002`)
  })

  it('no duplica la barra final', () => {
    expect(appJobRoot(`${BASE}/`)).toBe(appJobRoot(BASE))
  })
})

describe('entitySetNames y pickJobEntity', () => {
  const xml = '<edmx><EntitySet Name="Otro"/><EntitySet Name="JobTemplateSet"/></edmx>'

  it('lista los conjuntos del catálogo', () => {
    expect(entitySetNames(xml)).toEqual(['Otro', 'JobTemplateSet'])
  })

  // El servicio cambió de forma entre versiones: no se da por sentado el nombre.
  it('prefiere el conjunto de plantillas aunque no sea el primero', () => {
    expect(pickJobEntity(entitySetNames(xml))).toBe('JobTemplateSet')
  })

  it('sin ninguno conocido usa el primero que haya', () => {
    expect(pickJobEntity(['Cualquiera'])).toBe('Cualquiera')
  })

  it('sin conjuntos no hay entidad', () => {
    expect(pickJobEntity([])).toBeNull()
  })
})

describe('readAllPages', () => {
  it('sigue el enlace a la página siguiente', async () => {
    sapFetch
      .mockResolvedValueOnce({ json: { d: { results: [{ a: 1 }], __next: `${appJobRoot(BASE)}/X?p=2` } } })
      .mockResolvedValueOnce({ json: { d: { results: [{ a: 2 }] } } })

    expect(await readAllPages({ baseUrl: BASE, credentials: {}, entity: 'X' })).toEqual([{ a: 1 }, { a: 2 }])
    expect(sapFetch).toHaveBeenCalledTimes(2)
  })

  it('entiende las dos formas de OData', async () => {
    sapFetch.mockResolvedValueOnce({ json: { value: [{ a: 1 }] } })
    expect(await readAllPages({ baseUrl: BASE, credentials: {}, entity: 'X' })).toEqual([{ a: 1 }])
  })

  // Una función de Vercel se corta a los diez segundos; sin tope, una entidad grande la consume
  // entera sin devolver nada.
  it('se planta al llegar al tope de páginas', async () => {
    sapFetch.mockResolvedValue({ json: { d: { results: [{ a: 1 }], __next: `${appJobRoot(BASE)}/X?p=n` } } })
    const filas = await readAllPages({ baseUrl: BASE, credentials: {}, entity: 'X', maxPages: 3 })

    expect(filas).toHaveLength(3)
    expect(sapFetch).toHaveBeenCalledTimes(3)
  })

  it('pide el formato JSON siempre', async () => {
    sapFetch.mockResolvedValueOnce({ json: { value: [] } })
    await readAllPages({ baseUrl: BASE, credentials: {}, entity: 'X', query: '$filter=a' })
    expect(sapFetch.mock.calls[0][0].url).toContain('$filter=a&$format=json')
  })
})

describe('readJobSteps', () => {
  it('devuelve los pasos ordenados por su posición', async () => {
    sapFetch.mockResolvedValueOnce({
      json: {
        d: {
          results: [
            { JobSequencePosition: 2, JobSequenceText: 'Segundo', JceText: 'DATA INTEGRATION', JobSequenceName: 'S2' },
            { JobSequencePosition: 1, JobSequenceText: 'Primero', JceText: 'DATA INTEGRATION', JobSequenceName: 'S1' },
          ],
        },
      },
    })

    const pasos = await readJobSteps({ baseUrl: BASE, credentials: {}, templateName: 'T', templateVersion: '2' })
    expect(pasos.map((uno) => uno.text)).toEqual(['Primero', 'Segundo'])
    expect(pasos[0]).toMatchObject({ pos: 1, seqName: 'S1', tpl: 'T', ver: '2', taskId: '' })
  })

  it('filtra por la plantilla y su versión', async () => {
    sapFetch.mockResolvedValueOnce({ json: { value: [] } })
    await readJobSteps({ baseUrl: BASE, credentials: {}, templateName: 'T', templateVersion: '2' })

    const { url } = sapFetch.mock.calls[0][0]
    expect(decodeURIComponent(url)).toContain("JobTemplateName eq 'T' and JobTemplateVersion eq '2'")
  })

  // Una comilla sin escapar cambiaría el filtro entero.
  it('escapa las comillas del nombre', async () => {
    sapFetch.mockResolvedValueOnce({ json: { value: [] } })
    await readJobSteps({ baseUrl: BASE, credentials: {}, templateName: "O'Brien" })
    expect(decodeURIComponent(sapFetch.mock.calls[0][0].url)).toContain("'O''Brien'")
  })

  it('sin plantilla no consulta nada', async () => {
    expect(await readJobSteps({ baseUrl: BASE, credentials: {}, templateName: '' })).toEqual([])
    expect(sapFetch).not.toHaveBeenCalled()
  })
})

describe('readTaskIds', () => {
  // Es lo que permite emparejar un paso con su tarea aunque le hayan cambiado el nombre en IBP.
  it('indexa el identificador técnico por plantilla, versión y paso', async () => {
    sapFetch.mockResolvedValueOnce({
      json: {
        value: [
          { JobTemplateName: 'T', JobTemplateVersion: '1', JobTemplateParameterName: 'P_TSKID S1', Low: 'TAREA_A' },
          { JobTemplateName: 'T', JobTemplateVersion: '1', JobTemplateParameterName: 'P_TSKID S2', Low: '  ' },
        ],
      },
    })

    expect(await readTaskIds({ baseUrl: BASE, credentials: {} }))
      .toEqual({ [stepKey('T', '1', 'S1')]: 'TAREA_A' })
  })

  it('pide solo los parámetros que empiezan con P_TSKID', async () => {
    sapFetch.mockResolvedValueOnce({ json: { value: [] } })
    await readTaskIds({ baseUrl: BASE, credentials: {} })
    expect(decodeURIComponent(sapFetch.mock.calls[0][0].url)).toContain("startswith(JobTemplateParameterName,'P_TSKID')")
  })
})
