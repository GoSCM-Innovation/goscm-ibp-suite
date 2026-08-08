import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../transport/sap-fetch.js', () => ({ sapFetch: vi.fn() }))

const { sapFetch } = await import('../transport/sap-fetch.js')
const { SapError } = await vi.importActual('../transport/sap-fetch.js')
const {
  JOB_HEADER_SELECT,
  JOB_HEADER_TOP,
  buildJobHeaderQuery,
  cancelJobRun,
  readJobRuns,
  readLogMessages,
  readRunSteps,
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
