import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../transport/sap-fetch.js', () => ({ sapFetch: vi.fn() }))

const { sapFetch } = await import('../transport/sap-fetch.js')
const { SapError } = await vi.importActual('../transport/sap-fetch.js')
const {
  JOB_HEADER_SELECT,
  JOB_HEADER_TOP,
  buildJobHeaderQuery,
  cancelJobRun,
  readCatalogMeta,
  readJobRuns,
  readLogMessages,
  readRunParams,
  readRunSteps,
  readTemplateSequences,
  resetFilterMemory,
  restartJobRun,
  toSapTimestamp,
} = await import('./job-runs.js')

const BASE = 'https://tenant-api.scmibp1.ondemand.com'
const cred = { user: 'u', password: 'p' }

beforeEach(() => { sapFetch.mockReset(); resetFilterMemory() })

describe('toSapTimestamp', () => {
  // SAP no guarda una fecha, guarda una cadena de ancho fijo.
  it('escribe el formato de ancho fijo de SAP', () => {
    expect(toSapTimestamp(new Date('2026-06-11T12:00:00Z'))).toBe('20260611120000')
  })

  it('rellena con ceros los números de un dígito', () => {
    expect(toSapTimestamp(new Date('2026-01-02T03:04:05Z'))).toBe('20260102030405')
  })

  // El campo se declara con MaxLength=20. v8 añadia `.0000000`, con lo que el literal medía 22 y
  // SAP rechazaba el filtro entero con "violates facet" — nunca llegó a filtrar.
  it('mide catorce caracteres, que es lo que admite el campo', () => {
    expect(toSapTimestamp(new Date())).toHaveLength(14)
    expect(toSapTimestamp(new Date())).not.toContain('.')
  })

  // Es lo que hace que comparar alfabéticamente equivalga a comparar cronológicamente.
  it('el orden alfabético coincide con el cronológico', () => {
    const antes = toSapTimestamp(new Date('2026-01-31T23:59:59Z'))
    const despues = toSapTimestamp(new Date('2026-02-01T00:00:00Z'))
    expect(antes < despues).toBe(true)
  })

  it('una fecha inválida no se cuela en el filtro', () => {
    expect(() => toSapTimestamp('no soy una fecha')).toThrow(/Fecha inválida/)
  })
})

describe('buildJobHeaderQuery', () => {
  it('pide solo las columnas que se usan, y con tope', () => {
    const q = buildJobHeaderQuery({})
    expect(decodeURIComponent(q)).toContain(JOB_HEADER_SELECT.join(','))
    expect(q).toContain(`$top=${JOB_HEADER_TOP}`)
  })

  it('el filtro compara con literales entrecomillados', () => {
    const q = decodeURIComponent(buildJobHeaderQuery({ desde: '20260101000000', hasta: '20260102000000' }))
    expect(q).toContain("JobPlannedStartDateTime ge '20260101000000'")
    expect(q).toContain("JobPlannedStartDateTime le '20260102000000'")
  })

  it('sin rango no manda filtro', () => {
    expect(buildJobHeaderQuery({ desde: '20260101000000' })).not.toContain('$filter')
    expect(buildJobHeaderQuery({})).not.toContain('$filter')
  })

  it('sin filtro pedido tampoco lo manda', () => {
    const q = buildJobHeaderQuery({ desde: 'a', hasta: 'b', conFiltro: false })
    expect(q).not.toContain('$filter')
  })
})

describe('readJobRuns', () => {
  it('devuelve las filas y avisa de que filtró', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { results: [{ JobName: 'J1' }] } } })
    const r = await readJobRuns({ baseUrl: BASE, credentials: cred, desde: 'a', hasta: 'b' })

    expect(r).toMatchObject({ filtrado: true })
    expect(r.runs).toEqual([{ JobName: 'J1' }])
  })

  // Hay tenants que tipan el campo de otra forma y rechazan el filtro.
  it('si el tenant rechaza el filtro con 400, reintenta sin él', async () => {
    sapFetch
      .mockRejectedValueOnce(new SapError('SAP devolvió 400', { status: 400 }))
      .mockResolvedValueOnce({ json: { value: [{ JobName: 'J1' }] } })

    const r = await readJobRuns({ baseUrl: BASE, credentials: cred, desde: 'a', hasta: 'b', connectionId: 'c1' })
    expect(r.filtrado).toBe(false)
    expect(r.aviso).toMatch(/no admite filtrar/)
    expect(sapFetch).toHaveBeenCalledTimes(2)
  })

  it('una vez que lo rechazó, no vuelve a intentarlo con ese tenant', async () => {
    sapFetch
      .mockRejectedValueOnce(new SapError('SAP devolvió 400', { status: 400 }))
      .mockResolvedValue({ json: { value: [] } })

    await readJobRuns({ baseUrl: BASE, credentials: cred, desde: 'a', hasta: 'b', connectionId: 'c1' })
    sapFetch.mockClear()

    const r = await readJobRuns({ baseUrl: BASE, credentials: cred, desde: 'a', hasta: 'b', connectionId: 'c1' })
    expect(sapFetch).toHaveBeenCalledTimes(1)
    expect(r.filtrado).toBe(false)
  })

  it('lo aprendido es de ese tenant, no de todos', async () => {
    sapFetch
      .mockRejectedValueOnce(new SapError('SAP devolvió 400', { status: 400 }))
      .mockResolvedValue({ json: { value: [] } })
    await readJobRuns({ baseUrl: BASE, credentials: cred, desde: 'a', hasta: 'b', connectionId: 'c1' })

    const otro = await readJobRuns({ baseUrl: BASE, credentials: cred, desde: 'a', hasta: 'b', connectionId: 'c2' })
    expect(otro.filtrado).toBe(true)
  })

  // Un 401 o un 500 son otra cosa: reintentarlos sin filtro esconderÍa el problema real.
  it('un error que no es 400 se propaga', async () => {
    sapFetch.mockRejectedValueOnce(new SapError('SAP devolvió 401', { status: 401 }))
    await expect(readJobRuns({ baseUrl: BASE, credentials: cred, desde: 'a', hasta: 'b' }))
      .rejects.toThrow(/401/)
    expect(sapFetch).toHaveBeenCalledTimes(1)
  })

  it('sin rango va directo sin filtro', async () => {
    sapFetch.mockResolvedValueOnce({ json: { value: [] } })
    const r = await readJobRuns({ baseUrl: BASE, credentials: cred })
    expect(r.filtrado).toBe(false)
    expect(sapFetch.mock.calls[0][0].url).not.toContain('$filter')
  })
})

describe('readRunSteps', () => {
  it('ordena los pasos por su número', async () => {
    sapFetch.mockResolvedValueOnce({
      json: { d: { results: [{ StepNumber: '10' }, { StepNumber: '2' }, { StepNumber: '1' }] } },
    })
    const pasos = await readRunSteps({ baseUrl: BASE, credentials: cred, jobName: 'J', jobRunCount: '1' })
    expect(pasos.map((uno) => uno.StepNumber)).toEqual(['1', '2', '10'])
  })

  it('la clave de la entidad va entrecomillada', async () => {
    sapFetch.mockResolvedValueOnce({ json: { value: [] } })
    await readRunSteps({ baseUrl: BASE, credentials: cred, jobName: 'MI_JOB', jobRunCount: '7' })

    const { url } = sapFetch.mock.calls[0][0]
    expect(decodeURIComponent(url)).toContain("JobHeaderSet(JobName='MI_JOB',JobRunCount='7')/JobStepSet")
  })

  // Una comilla sin escapar rompería la clave de la entidad.
  it('escapa las comillas del nombre', async () => {
    sapFetch.mockResolvedValueOnce({ json: { value: [] } })
    await readRunSteps({ baseUrl: BASE, credentials: cred, jobName: "O'Brien", jobRunCount: '1' })
    expect(decodeURIComponent(sapFetch.mock.calls[0][0].url)).toContain("JobName='O''Brien'")
  })
})

describe('readLogMessages', () => {
  it('arma la ruta con los cuatro campos de la clave', async () => {
    sapFetch.mockResolvedValueOnce({ json: { value: [{ Message: 'hola' }] } })
    await readLogMessages({
      baseUrl: BASE, credentials: cred, jobName: 'J', jobRunCount: '1', stepNumber: '3', logHandle: 'LH1',
    })

    const ruta = decodeURIComponent(sapFetch.mock.calls[0][0].url)
    expect(ruta).toContain("JobStepLogInfoSet(JobName='J',JobRunCount='1',StepNumber=3,LogHandle='LH1')/JobLogMessageSet")
  })
})

describe('readRunParams', () => {
  it('pide los parámetros de la ejecución con el nombre y la repetición entrecomillados', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { results: [{ StepNr: '1', JobParameterName: 'P_VERS', Low: 'V1' }] } } })
    const filas = await readRunParams({ baseUrl: BASE, credentials: cred, jobName: 'MI_JOB', jobRunCount: '07' })

    const url = decodeURIComponent(sapFetch.mock.calls[0][0].url)
    // `JobCount`, no `JobRunCount`: así se llama el parámetro de esta función en SAP.
    expect(url).toContain("JobParamValuesStructGet?JobName='MI_JOB'&JobCount='07'")
    expect(sapFetch.mock.calls[0][0].method).toBeUndefined()
    expect(filas).toEqual([{ StepNr: '1', JobParameterName: 'P_VERS', Low: 'V1' }])
  })

  // El panel reconoce la falta del rol por el texto de SAP; si esto se tragara el fallo, no podría.
  it('un rechazo de SAP se propaga', async () => {
    sapFetch.mockRejectedValueOnce(new SapError('SAP devolvió 403', { status: 403, detail: '[APJ_RT/028] not authorized' }))
    await expect(readRunParams({ baseUrl: BASE, credentials: cred, jobName: 'J', jobRunCount: '1' }))
      .rejects.toMatchObject({ detail: expect.stringContaining('APJ_RT/028') })
  })
})

describe('readTemplateSequences', () => {
  // Es la consulta del panel de v8: por contención, no por igualdad.
  it('filtra con substringof sobre el nombre de la plantilla', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { results: [{ JobSequencePosition: 1, JobSequenceText: 'Cargar' }] } } })
    const filas = await readTemplateSequences({ baseUrl: BASE, credentials: cred, templateName: 'YY1_ABC' })

    const url = decodeURIComponent(sapFetch.mock.calls[0][0].url)
    expect(url).toContain("JobTemplateSequenceSet?$filter=substringof('YY1_ABC',JobTemplateName)")
    expect(filas).toHaveLength(1)
  })

  it('sin plantilla no pregunta', async () => {
    expect(await readTemplateSequences({ baseUrl: BASE, credentials: cred, templateName: '' })).toEqual([])
    expect(sapFetch).not.toHaveBeenCalled()
  })
})

describe('readCatalogMeta', () => {
  it('hace las tres lecturas de v8 por el catálogo del paso', async () => {
    sapFetch.mockImplementation(({ url }) => {
      if (url.includes('JobTemplateRead')) {
        return Promise.resolve({ json: { d: { TemplateData: JSON.stringify({ templates: [{ sequences: [{ seq_param_val: [{ name: 'P_VERS', label: 'Version' }] }] }] }) } } })
      }
      if (url.includes('JobTemplateParameterSet')) {
        return Promise.resolve({ json: { d: { results: [{ JobTemplateParameterName: 'P_VERS', JobTemplateParamGroupName: 'G1' }] } } })
      }
      return Promise.resolve({ json: { d: { results: [{ JobTemplateParamGroupName: 'G1', JobTemplateParamGroupText: 'General' }] } } })
    })

    const meta = await readCatalogMeta({ baseUrl: BASE, credentials: cred, catalog: '/IBP/OP_COPYVS' })

    const urls = sapFetch.mock.calls.map(([llamada]) => decodeURIComponent(llamada.url))
    expect(urls.some((u) => u.includes("JobTemplateRead?JobTemplateName='/IBP/OP_COPYVS'"))).toBe(true)
    expect(urls.some((u) => u.includes("JobTemplateParameterSet?$filter=BasicJobCatalogEntryName eq '/IBP/OP_COPYVS'"))).toBe(true)
    expect(urls.some((u) => u.includes("JobTemplateParamGroupSet?$filter=JobTemplateName eq '/IBP/OP_COPYVS'"))).toBe(true)
    expect(meta).toMatchObject({ hasData: true, paramOrder: ['P_VERS'], groupMap: { P_VERS: 'General' }, labelMap: { P_VERS: 'Version' } })
  })

  // Ninguna de las tres es imprescindible: sin ellas los parámetros se muestran igual.
  it('si SAP no deja leer nada, devuelve el respaldo en vez de fallar', async () => {
    sapFetch.mockRejectedValue(new SapError('SAP devolvió 403', { status: 403 }))
    const meta = await readCatalogMeta({ baseUrl: BASE, credentials: cred, catalog: 'Z_PROPIO' })
    expect(meta).toMatchObject({ hasData: false, visibleParams: null, paramOrder: [] })
    expect(meta.groupMap.P_VERS).toBe('General')
  })
})

describe('cancelJobRun y restartJobRun', () => {
  it('cancelar va por POST', async () => {
    sapFetch.mockResolvedValueOnce({ json: {} })
    await cancelJobRun({ baseUrl: BASE, credentials: cred, jobName: 'J', jobRunCount: '1' })

    const llamada = sapFetch.mock.calls[0][0]
    expect(llamada.method).toBe('POST')
    expect(decodeURIComponent(llamada.url)).toContain("JobCancel?JobName='J'&JobRunCount='1'")
    // El token CSRF se pide sobre la raíz del servicio, no sobre la URL con parámetros.
    expect(llamada.serviceRoot).toContain('BC_EXT_APPJOB_MANAGEMENT')
  })

  it('reiniciar manda el modo elegido', async () => {
    sapFetch.mockResolvedValueOnce({ json: {} })
    await restartJobRun({ baseUrl: BASE, credentials: cred, jobName: 'J', jobRunCount: '1', modo: 'E' })
    expect(decodeURIComponent(sapFetch.mock.calls[0][0].url)).toContain("JobRestartMode='E'")
  })

  // Otra letra haría que SAP reiniciara con un criterio que nadie eligió.
  it('un modo desconocido no llega a SAP', async () => {
    await expect(restartJobRun({ baseUrl: BASE, credentials: cred, jobName: 'J', jobRunCount: '1', modo: 'X' }))
      .rejects.toThrow(/Modo de reinicio desconocido/)
    expect(sapFetch).not.toHaveBeenCalled()
  })
})
