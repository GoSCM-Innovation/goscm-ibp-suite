import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../connections/index.js', () => ({
  getConnectionTarget: vi.fn(async () => ({ kind: 'ibp', baseUrl: 'https://tenant' })),
  getCredentials: vi.fn(async () => ({ user: 'u', password: 'p' })),
}))
vi.mock('../cids/operations.js', () => ({ runCidsOperation: vi.fn() }))
vi.mock('../ibp/job-schedule.js', () => ({ scheduleJob: vi.fn() }))
vi.mock('../ibp/job-runs.js', () => ({ readJobRun: vi.fn(), cancelJobRun: vi.fn() }))

const { getCredentials } = await import('../connections/index.js')
const { runCidsOperation } = await import('../cids/operations.js')
const { scheduleJob } = await import('../ibp/job-schedule.js')
const { cancelJobRun, readJobRun } = await import('../ibp/job-runs.js')
const { adaptadorPara } = await import('./adapters.js')

const destino = { clientId: 'c-1', connectionId: 'x-1', production: false }

beforeEach(() => { vi.clearAllMocks() })

describe('adaptadorPara', () => {
  it('conoce los dos tipos', () => {
    expect(adaptadorPara('cids')).toBeTruthy()
    expect(adaptadorPara('ibp')).toBeTruthy()
  })

  // Un tipo que no se sabe orquestar tiene que decirlo, no fallar más tarde de forma rara.
  it('un tipo desconocido es un error claro', () => {
    expect(() => adaptadorPara('otro')).toThrow(/No hay forma de orquestar/)
  })
})

describe('adaptador de CI-DS', () => {
  const cids = adaptadorPara('cids')

  it('lanza una tarea y devuelve su identificador', async () => {
    runCidsOperation.mockResolvedValue({ runId: 'R-9' })
    await expect(cids.lanzar(destino, { data: { taskName: 'CARGA' } }, {})).resolves.toBe('R-9')
    expect(runCidsOperation.mock.calls[0][0]).toMatchObject({ operation: 'runTask' })
  })

  // Lo específico manda sobre lo que se puso para todos.
  it('lo del paso pisa a lo general', async () => {
    runCidsOperation.mockResolvedValue({ runId: 'R-9' })
    await cids.lanzar(destino, { data: { taskName: 'T', agentName: 'DEL_PASO' } }, { agentName: 'GENERAL' })
    expect(runCidsOperation.mock.calls[0][0].params.agentName).toBe('DEL_PASO')
  })

  it('sin identificador de ejecución no se sigue', async () => {
    runCidsOperation.mockResolvedValue({})
    await expect(cids.lanzar(destino, { data: { taskName: 'T' } }, {})).rejects.toThrow(/no devolvió el identificador/)
  })
})

describe('adaptador de IBP', () => {
  const ibp = adaptadorPara('ibp')

  it('lanza una plantilla y guarda nombre y repetición juntos', async () => {
    scheduleJob.mockResolvedValue({ jobName: 'FA163E', jobRunCount: '7' })
    await expect(ibp.lanzar(destino, { data: { templateName: 'CARGA' } }, {})).resolves.toBe('FA163E|7')
    expect(scheduleJob.mock.calls[0][0]).toMatchObject({ templateName: 'CARGA' })
  })

  // Dejar que lo ponga la orquestación sería correr algo en nombre de un tercero.
  it('no deja elegir con qué usuario corre', async () => {
    scheduleJob.mockResolvedValue({ jobName: 'J', jobRunCount: '1' })
    await ibp.lanzar(destino, { data: { templateName: 'T', jobUser: 'OTRO' } }, {})
    expect(scheduleJob.mock.calls[0][0]).not.toHaveProperty('jobUser')
  })

  it('usa el acuerdo de los Application Jobs', async () => {
    scheduleJob.mockResolvedValue({ jobName: 'J', jobRunCount: '1' })
    await ibp.lanzar(destino, { data: { templateName: 'T' } }, {})
    expect(getCredentials).toHaveBeenCalledWith('c-1', 'x-1', 'SAP_COM_0326')
  })

  it('un paso sin plantilla no llega a SAP', async () => {
    await expect(ibp.lanzar(destino, { data: {} }, {})).rejects.toThrow(/qué plantilla/)
    expect(scheduleJob).not.toHaveBeenCalled()
  })

  it('traduce el estado del trabajo al idioma del motor', async () => {
    readJobRun.mockResolvedValue({ JobName: 'FA163E', JobRunCount: '7', JobStatus: 'F' })
    await expect(ibp.consultar(destino, 'FA163E|7')).resolves.toMatchObject({ statusCode: 'SUCCESS' })
  })

  // El motor pregunta una vez por vuelta y por paso: traer el lote entero para buscar dentro sería
  // pagar una lectura de dos mil filas muchas veces.
  it('pide SOLO esa ejecución, por nombre y repetición', async () => {
    readJobRun.mockResolvedValue(null)
    await ibp.consultar(destino, 'FA163E|7')
    expect(readJobRun.mock.calls[0][0]).toMatchObject({ jobName: 'FA163E', jobRunCount: '7' })
  })

  // Darla por perdida en la primera vuelta cortaría la cadena por nada: el motor toma «desconocido»
  // como fallo, así que sin registrar tiene que traducirse como «en cola».
  it('una ejecución que SAP todavía no registró queda en cola, no fallada', async () => {
    readJobRun.mockResolvedValue(null)
    await expect(ibp.consultar(destino, 'FA163E|7')).resolves.toMatchObject({ statusCode: 'QUEUEING' })
  })

  it('un identificador roto se dice, no se consulta', async () => {
    await expect(ibp.consultar(destino, 'roto')).rejects.toThrow(/ilegible/)
    expect(readJobRun).not.toHaveBeenCalled()
  })

  it('cancela por nombre y repetición', async () => {
    cancelJobRun.mockResolvedValue({ ok: true })
    await ibp.cancelar(destino, 'FA163E|7')
    expect(cancelJobRun.mock.calls[0][0]).toMatchObject({ jobName: 'FA163E', jobRunCount: '7' })
  })

  it('cancelar algo sin identificador válido no llega a SAP', async () => {
    await expect(ibp.cancelar(destino, '')).resolves.toBeNull()
    expect(cancelJobRun).not.toHaveBeenCalled()
  })
})
