import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../connections/index.js', () => ({
  getConnectionTarget: vi.fn(async () => ({ kind: 'ibp', baseUrl: 'https://tenant' })),
  getCredentials: vi.fn(async () => ({ user: 'u', password: 'p' })),
}))
vi.mock('../cids/operations.js', () => ({ runCidsOperation: vi.fn() }))
vi.mock('../ibp/job-schedule.js', () => ({ scheduleJob: vi.fn() }))
vi.mock('../ibp/job-runs.js', () => ({ readJobRun: vi.fn(), cancelJobRun: vi.fn(), readLatestTemplateRun: vi.fn() }))
vi.mock('../ci/execute.js', () => ({ executeIntegration: vi.fn() }))

const { getCredentials } = await import('../connections/index.js')
const { runCidsOperation } = await import('../cids/operations.js')
const { scheduleJob } = await import('../ibp/job-schedule.js')
const { cancelJobRun, readJobRun, readLatestTemplateRun } = await import('../ibp/job-runs.js')
const { executeIntegration } = await import('../ci/execute.js')
const {
  ESPERA_ANTES_DE_BUSCAR_MS,
  ESPERA_ANTES_DE_RELANZAR_MS,
  POLITICA_CI,
  POLITICA_IBP,
  adaptadorPara,
  mergeVariables,
} = await import('./adapters.js')

const destino = { clientId: 'c-1', connectionId: 'x-1', production: false }

beforeEach(() => { vi.clearAllMocks() })

describe('adaptadorPara', () => {
  it('conoce los tres tipos', () => {
    expect(adaptadorPara('cids')).toBeTruthy()
    expect(adaptadorPara('ibp')).toBeTruthy()
    expect(adaptadorPara('ci')).toBeTruthy()
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

  // Si CI-DS contestó sin identificador pudo haber arrancado la tarea: volver a lanzarla duplicaría una
  // carga. v9 reintentaba también aquí; esto es a propósito más prudente.
  it('una respuesta sin identificador NO se reintenta', async () => {
    runCidsOperation.mockResolvedValue({})
    const esperar = vi.fn()
    await expect(cids.lanzar(destino, { data: { taskName: 'T' } }, {}, { esperar })).rejects.toThrow()
    expect(runCidsOperation).toHaveBeenCalledTimes(1)
    expect(esperar).not.toHaveBeenCalled()
  })

  describe('variables globales de la ejecución', () => {
    const lanzarCon = async (delPaso, deLaEjecucion) => {
      runCidsOperation.mockResolvedValue({ runId: 'R-1' })
      await cids.lanzar(
        destino,
        { data: { taskName: 'T', globalVariables: delPaso } },
        { globalVariables: deLaEjecucion },
      )
      return runCidsOperation.mock.calls[0][0].params.globalVariables
    }

    // Como v9: la variable de la ejecución pisa el valor del paso.
    it('pisan el valor de la variable que el paso ya tiene', async () => {
      const mandadas = await lanzarCon(
        [{ name: 'FECHA', value: 'del-paso' }],
        [{ name: 'FECHA', value: 'de-la-ejecucion' }],
      )
      expect(mandadas).toEqual([{ name: 'FECHA', value: 'de-la-ejecucion' }])
    })

    // Mandarle a una tarea una variable que no declaró es pedirle algo que esa tarea no definió.
    it('las que el paso no declara NO se mandan', async () => {
      const mandadas = await lanzarCon(
        [{ name: 'FECHA', value: 'x' }],
        [{ name: 'OTRA', value: 'y' }],
      )
      expect(mandadas).toEqual([{ name: 'FECHA', value: 'x' }])
    })

    it('un paso sin variables no recibe ninguna de la ejecución', async () => {
      expect(await lanzarCon([], [{ name: 'FECHA', value: 'y' }])).toEqual([])
    })

    it('sin variables de la ejecución, las del paso van tal cual', async () => {
      expect(await lanzarCon([{ name: 'A', value: '1' }], undefined)).toEqual([{ name: 'A', value: '1' }])
    })
  })

  // Como v9 (`launchTask`): CI-DS a veces rechaza la primera llamada en frío y la segunda entra.
  describe('si CI-DS rechaza el lanzamiento', () => {
    const paso = { data: { taskName: 'T' } }

    it('reintenta UNA vez tras 1,5 s y, si entra, devuelve el identificador', async () => {
      runCidsOperation
        .mockRejectedValueOnce(new Error('SOAP error HTTP 500'))
        .mockResolvedValueOnce({ runId: 'R-2' })
      const esperar = vi.fn(async () => {})

      await expect(cids.lanzar(destino, paso, {}, { esperar })).resolves.toBe('R-2')

      expect(runCidsOperation).toHaveBeenCalledTimes(2)
      expect(esperar).toHaveBeenCalledTimes(1)
      expect(esperar).toHaveBeenCalledWith(ESPERA_ANTES_DE_RELANZAR_MS)
      expect(ESPERA_ANTES_DE_RELANZAR_MS).toBe(1500)
    })

    it('el reintento lleva los mismos parámetros', async () => {
      runCidsOperation
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ runId: 'R-2' })
      await cids.lanzar(destino, { data: { taskName: 'T', agentName: 'AG' } }, {}, { esperar: async () => {} })
      expect(runCidsOperation.mock.calls[1][0]).toEqual(runCidsOperation.mock.calls[0][0])
    })

    it('si falla dos veces, el error es el del segundo intento y no hay un tercero', async () => {
      runCidsOperation
        .mockRejectedValueOnce(new Error('primero'))
        .mockRejectedValueOnce(new Error('segundo'))
      await expect(cids.lanzar(destino, paso, {}, { esperar: async () => {} })).rejects.toThrow('segundo')
      expect(runCidsOperation).toHaveBeenCalledTimes(2)
    })

    it('un error de sesión no se reintenta aquí', async () => {
      runCidsOperation.mockRejectedValue(new Error('La sesión de CI-DS venció (invalid session)'))
      const esperar = vi.fn()
      await expect(cids.lanzar(destino, paso, {}, { esperar })).rejects.toThrow(/session/)
      expect(runCidsOperation).toHaveBeenCalledTimes(1)
      expect(esperar).not.toHaveBeenCalled()
    })

    it('espera de verdad 1,5 s si no se le inyecta la espera', async () => {
      vi.useFakeTimers()
      try {
        runCidsOperation
          .mockRejectedValueOnce(new Error('boom'))
          .mockResolvedValueOnce({ runId: 'R-3' })
        const lanzado = cids.lanzar(destino, paso, {})
        await vi.advanceTimersByTimeAsync(ESPERA_ANTES_DE_RELANZAR_MS - 1)
        expect(runCidsOperation).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(1)
        await expect(lanzado).resolves.toBe('R-3')
      } finally {
        vi.useRealTimers()
      }
    })
  })
})

describe('mergeVariables', () => {
  it('sin variables de la ejecución devuelve las del paso sin tocarlas', () => {
    const delPaso = [{ name: 'A', value: '1' }]
    expect(mergeVariables(delPaso, [])).toBe(delPaso)
    expect(mergeVariables(delPaso, undefined)).toBe(delPaso)
  })

  it('conserva el orden y los demás campos de la variable del paso', () => {
    const resultado = mergeVariables(
      [{ name: 'A', value: '1', tipo: 'texto' }, { name: 'B', value: '2' }],
      [{ name: 'B', value: 'nuevo' }, { name: 'A', value: 'otro' }],
    )
    expect(resultado).toEqual([{ name: 'A', value: 'otro', tipo: 'texto' }, { name: 'B', value: 'nuevo' }])
  })

  it('una entrada rota de la ejecución no tumba el lanzamiento', () => {
    expect(mergeVariables([{ name: 'A', value: '1' }], [null, {}, { name: 'A', value: '2' }]))
      .toEqual([{ name: 'A', value: '2' }])
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
      // Cortar no distingue «omitido» y no reintenta el cerrojo: IBP sigue como estaba.
      cancelSkipsPending: false,
      cancelLockAttempts: 1,
    })
  })
})

describe('política de CI-DS', () => {
  it('no trae ninguna: el motor usa la suya, que es la de v9', () => {
    expect(adaptadorPara('cids').politica).toBeUndefined()
  })
})

describe('adaptador de CI Tools', () => {
  const ci = adaptadorPara('ci')
  const nodo = { id: 'a', data: { integrationId: 'int-1' } }
  const bien = { runId: 'r', resultado: 'success', enviado: true, httpStatus: 200, duracionMs: 21_000, mplId: null, mensaje: 'OK' }

  it('es síncrono: la llamada a CPI es el resultado', () => {
    expect(ci.sincrono).toBe(true)
    expect(ci.lanzar).toBeUndefined()
  })

  it('no le pide nada a CPI al cortar, y una carga fallida para la cadena', () => {
    expect(POLITICA_CI).toMatchObject({ cancelInSap: false, exhaustedRetryBlocks: true })
  })

  it('ejecuta la integración del paso, con las variables de la ejecución y quién la lanzó', async () => {
    executeIntegration.mockResolvedValue(bien)
    await ci.ejecutar(destino, nodo, { variables: { D: '1' }, startedBy: { id: 'u-1', email: 'a@x.com' } }, { sapRunId: 'run-1', orchestrationId: 'orq-1' })

    expect(executeIntegration).toHaveBeenCalledWith({
      clientId: 'c-1', connectionId: 'x-1', integrationId: 'int-1', variables: { D: '1' },
      origin: 'orchestration', orchestrationId: 'orq-1', user: { id: 'u-1', email: 'a@x.com' }, runId: 'run-1',
    })
  })

  it('un 2xx es SUCCESS y trae la duración', async () => {
    executeIntegration.mockResolvedValue(bien)
    expect(await ci.ejecutar(destino, nodo, {}, {})).toMatchObject({
      statusCode: 'SUCCESS', duracionMs: 21_000, sinConfirmar: false, textoDeError: null,
      detalle: { httpStatus: 200, enviado: true },
    })
  })

  it('un error es ERROR con el código y el MPL ID en el texto y en el detalle', async () => {
    executeIntegration.mockResolvedValue({ ...bien, resultado: 'error', httpStatus: 500, mplId: 'MPL-1', mensaje: 'boom' })
    expect(await ci.ejecutar(destino, nodo, {}, {})).toMatchObject({
      statusCode: 'ERROR', textoDeError: 'HTTP 500: boom', sinConfirmar: false, detalle: { mplId: 'MPL-1' },
    })
  })

  // «Con advertencias» = CPI procesó la carga y contestó algo distinto de OK: el motor lo cuenta como paso COMPLETADO.
  it('una advertencia es un paso completado con advertencias: ni error ni reintento, con el MPL ID en el detalle', async () => {
    executeIntegration.mockResolvedValue({ ...bien, resultado: 'warning', httpStatus: 500, mplId: 'MPL-1', mensaje: 'rechazo' })
    const salida = await ci.ejecutar(destino, nodo, {}, {})
    expect(salida).toMatchObject({
      statusCode: 'SUCCESS_WITH_ERRORS_E', textoDeError: null, sinConfirmar: false,
      detalle: { advertencia: true, httpStatus: 500, mplId: 'MPL-1', mensaje: 'rechazo' },
    })
  })

  it('una carga en duda es ERROR marcada «sin confirmar»', async () => {
    executeIntegration.mockResolvedValue({ ...bien, resultado: 'unconfirmed', httpStatus: null, mensaje: 'sin respuesta' })
    expect(await ci.ejecutar(destino, nodo, {}, {})).toMatchObject({ statusCode: 'ERROR', sinConfirmar: true })
  })

  it('un paso sin integración no llama a nada', async () => {
    const salida = await ci.ejecutar(destino, { id: 'a', data: {} }, {}, {})
    expect(executeIntegration).not.toHaveBeenCalled()
    expect(salida).toMatchObject({ statusCode: 'ERROR', textoDeError: expect.stringMatching(/qué integración/) })
    expect(salida.detalle.enviado).toBe(false)
  })

  it('el detalle guarda un recorte de la respuesta, no entera', async () => {
    executeIntegration.mockResolvedValue({ ...bien, mensaje: 'x'.repeat(1500) })
    expect((await ci.ejecutar(destino, nodo, {}, {})).detalle.mensaje).toHaveLength(300)
  })

  it('si no se sabe quién la lanzó, no inventa un usuario', async () => {
    executeIntegration.mockResolvedValue(bien)
    await ci.ejecutar(destino, nodo, {}, {})
    expect(executeIntegration.mock.calls[0][0].user).toBeNull()
  })

  // Lo que queda «en marcha» al empezar una vuelta nueva es lo que nadie recogió: no se sabe cómo terminó.
  it('consultar lee un paso huérfano como «sin confirmar», sin preguntarle nada a CPI', async () => {
    const estado = await ci.consultar(destino, 'huerfano')
    expect(estado).toMatchObject({ statusCode: 'ERROR', sinConfirmar: true })
    expect(estado.textoDeError).toMatch(/Sin confirmar/)
    expect(executeIntegration).not.toHaveBeenCalled()
  })
})
