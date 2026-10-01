import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../connections/index.js', () => ({
  getConnectionTarget: vi.fn(async () => ({ kind: 'ibp', baseUrl: 'https://tenant' })),
  getCredentials: vi.fn(async () => ({ user: 'u', password: 'p' })),
}))
vi.mock('../cids/operations.js', () => ({ runCidsOperation: vi.fn() }))
vi.mock('../ibp/job-schedule.js', () => ({ scheduleJob: vi.fn() }))
vi.mock('../ibp/job-runs.js', () => ({ readJobRun: vi.fn(), cancelJobRun: vi.fn(), readLatestTemplateRun: vi.fn() }))

const { getCredentials } = await import('../connections/index.js')
const { runCidsOperation } = await import('../cids/operations.js')
const { scheduleJob } = await import('../ibp/job-schedule.js')
const { cancelJobRun, readJobRun, readLatestTemplateRun } = await import('../ibp/job-runs.js')
const { ESPERA_ANTES_DE_BUSCAR_MS, POLITICA_IBP, adaptadorPara } = await import('./adapters.js')

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

  // Como v8 (`injectJobUser`) y como «Job Templates»: corre con el usuario de comunicación de la
  // conexión. Dejar que lo ponga la orquestación sería correr algo en nombre de un tercero.
  it('corre con el usuario de la conexión, nunca con uno que diga el paso', async () => {
    scheduleJob.mockResolvedValue({ jobName: 'J', jobRunCount: '1' })
    await ibp.lanzar(destino, { data: { templateName: 'T', jobUser: 'OTRO' } }, {})
    expect(scheduleJob.mock.calls[0][0].jobUser).toBe('u')
  })

  // El respaldo de v8: esperar dos segundos y tomar el último trabajo de la plantilla.
  describe('si SAP no devuelve el nombre del trabajo', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    it('espera y toma el último de la plantilla', async () => {
      scheduleJob.mockResolvedValue({ jobName: '', jobRunCount: '' })
      readLatestTemplateRun.mockResolvedValue({ JobName: 'J9', JobRunCount: '4' })

      const lanzado = ibp.lanzar(destino, { data: { templateName: 'ZCARGA' } }, {})
      await vi.advanceTimersByTimeAsync(ESPERA_ANTES_DE_BUSCAR_MS - 1)
      expect(readLatestTemplateRun).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)

      await expect(lanzado).resolves.toBe('J9|4')
      expect(readLatestTemplateRun.mock.calls[0][0]).toMatchObject({ templateName: 'ZCARGA' })
    })

    it('si tampoco aparece, el paso falla con el mensaje de v8', async () => {
      scheduleJob.mockResolvedValue({ jobName: '' })
      readLatestTemplateRun.mockResolvedValue(null)

      const lanzado = ibp.lanzar(destino, { data: { templateName: 'ZCARGA' } }, {})
      const comprobado = expect(lanzado).rejects.toThrow('No se encontró el job programado para ZCARGA')
      await vi.advanceTimersByTimeAsync(ESPERA_ANTES_DE_BUSCAR_MS)
      await comprobado
    })
  })

  it('sin repetición se lanza igual: se pregunta por el nombre', async () => {
    scheduleJob.mockResolvedValue({ jobName: 'J', jobRunCount: '' })
    await expect(ibp.lanzar(destino, { data: { templateName: 'T' } }, {})).resolves.toBe('J|')
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

  // Sin la repetición no se abren los «Steps SAP»: la que conteste SAP se devuelve para guardarla.
  it('sin repetición pregunta por el nombre y devuelve el identificador completo', async () => {
    readJobRun.mockResolvedValue({ JobName: 'J', JobRunCount: '3', JobStatus: 'R' })
    const estado = await ibp.consultar(destino, 'J|')
    expect(readJobRun.mock.calls[0][0]).toMatchObject({ jobName: 'J', jobRunCount: '' })
    expect(estado).toMatchObject({ statusCode: 'RUNNING', sapRunId: 'J|3', codigoSap: 'R' })
  })

  it('con repetición no toca el identificador', async () => {
    readJobRun.mockResolvedValue({ JobName: 'J', JobRunCount: '3', JobStatus: 'R' })
    expect(await ibp.consultar(destino, 'J|3')).not.toHaveProperty('sapRunId')
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

  // Las reglas del orquestador de v8; el motor las lee de aquí.
  it('trae la política de v8', () => {
    expect(ibp.politica).toBe(POLITICA_IBP)
    expect(POLITICA_IBP).toMatchObject({
      cancelInSap: false,
      cancelledBlocks: false,
      exhaustedRetryBlocks: true,
      assumedFailureFailsRun: false,
      cancelledChildCancelsGroup: true,
    })
  })
})

describe('política de CI-DS', () => {
  it('no trae ninguna: el motor usa la suya, que es la de v9', () => {
    expect(adaptadorPara('cids').politica).toBeUndefined()
  })
})
