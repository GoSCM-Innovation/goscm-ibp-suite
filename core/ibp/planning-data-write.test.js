import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../transport/sap-fetch.js', () => ({ sapFetch: vi.fn(), fetchCsrf: vi.fn() }))

const { sapFetch } = await import('../transport/sap-fetch.js')
const {
  MAX_VALORES_POR_ENVIO, commitTransaction, filasPorEnvio, getExportResult, getTransactionId,
  initiateParallelProcess, partirEnEnvios, postKfChunk, readMessages, waitForProcessed,
} = await import('./planning-data-write.js')

const BASE = 'https://tenant-api.scmibp.ondemand.com'
const cred = { user: 'u', password: 'p' }
const ctx = { baseUrl: BASE, credentials: cred }
const AREA = 'ASIBPTS'

beforeEach(() => { sapFetch.mockReset() })

const urlDe = (n = 0) => decodeURIComponent(sapFetch.mock.calls[n][0].url)
const cuerpoDe = (n = 0) => sapFetch.mock.calls[n][0].body
const fallo = (status, detail) => Object.assign(new Error('SAP'), { status, detail })

describe('filasPorEnvio', () => {
  // Contar filas y no valores deja pasar envios cinco veces mas grandes de lo previsto.
  it('reparte el tope entre las cifras clave que lleve cada fila', () => {
    expect(filasPorEnvio(1)).toBe(MAX_VALORES_POR_ENVIO)
    expect(filasPorEnvio(5)).toBe(MAX_VALORES_POR_ENVIO / 5)
  })

  it('sin cifras se trata como una', () => {
    expect(filasPorEnvio(0)).toBe(MAX_VALORES_POR_ENVIO)
    expect(filasPorEnvio(undefined)).toBe(MAX_VALORES_POR_ENVIO)
  })

  it('con muchisimas cifras manda al menos una fila', () => {
    expect(filasPorEnvio(99_999)).toBe(1)
  })
})

describe('partirEnEnvios', () => {
  it('respeta el tope de VALORES, no de filas', () => {
    const filas = Array.from({ length: 1200 }, (_, i) => ({ PRDID: `P${i}` }))
    // Con cinco cifras caben 500 filas por envio.
    expect(partirEnEnvios(filas, 5).map((uno) => uno.length)).toEqual([500, 500, 200])
  })

  it('sin filas no hay envios', () => {
    expect(partirEnEnvios([], 1)).toEqual([])
    expect(partirEnEnvios(undefined, 1)).toEqual([])
  })
})

describe('getTransactionId', () => {
  // En dato maestro se le pasa el tipo, el area y la version; aqui NO lleva parametros.
  it('se pide sin parametros', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { Value: 'TX1' } } })
    await expect(getTransactionId(ctx)).resolves.toBe('TX1')

    const url = urlDe()
    expect(url).toContain('/getTransactionID?$format=json')
    expect(url).not.toContain('VersionID')
    expect(url).not.toContain('PlanningArea')
  })

  it('sin identificador no se sigue', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: {} } })
    await expect(getTransactionId(ctx)).rejects.toThrow(/no devolvió un identificador/)
  })
})

describe('initiateParallelProcess', () => {
  // Con la I minuscula: en dato maestro es `TransactionID`, y SAP no perdona la diferencia.
  it('manda Transactionid con i minuscula', async () => {
    sapFetch.mockResolvedValueOnce({ json: {} })
    await initiateParallelProcess({ ...ctx, transactionId: 'TX1', area: AREA, versionId: 'V1' })

    expect(urlDe()).toContain("Transactionid='TX1'")
    expect(urlDe()).not.toContain('TransactionID=')
  })

  it('lleva el area y la etiqueta visible', async () => {
    sapFetch.mockResolvedValueOnce({ json: {} })
    await initiateParallelProcess({ ...ctx, transactionId: 'TX1', area: AREA, nombre: 'Carga de prueba' })

    expect(urlDe()).toContain(`PlanningArea='${AREA}'`)
    expect(urlDe()).toContain("TransactionName='Carga de prueba'")
  })

  // Es una mejora, no un requisito.
  it('un tenant que no lo admite no rompe la carga', async () => {
    sapFetch.mockRejectedValueOnce(fallo(404, 'no'))
    await expect(initiateParallelProcess({ ...ctx, transactionId: 'TX', area: AREA })).resolves.toBeNull()
  })

  it('un fallo del servidor si se propaga', async () => {
    sapFetch.mockRejectedValueOnce(fallo(500, 'se cayo'))
    await expect(initiateParallelProcess({ ...ctx, transactionId: 'TX', area: AREA })).rejects.toThrow()
  })
})

describe('postKfChunk', () => {
  const filas = [{ PRDID: 'P1', PERIODID4_TSTAMP: '/Date(1)/', ADJUSTEDPRODUCTION: '10' }]
  const enviar = (extra = {}) => postKfChunk({
    ...ctx, area: AREA, transactionId: 'TX1', filas, campos: ['PRDID', 'PERIODID4_TSTAMP'], ...extra,
  })

  it('escribe en la entidad de transaccion del area', async () => {
    sapFetch.mockResolvedValueOnce({ json: {} })
    await enviar()

    expect(sapFetch.mock.calls[0][0].url).toContain(`/${AREA}Trans`)
    expect(sapFetch.mock.calls[0][0].method).toBe('POST')
  })

  // Sin ella SAP no sabe a que nivel esta lo que se manda y no puede desagregar.
  it('manda la lista ordenada de columnas del nivel', async () => {
    sapFetch.mockResolvedValueOnce({ json: {} })
    await enviar()
    expect(cuerpoDe().AggregationLevelFieldsString).toBe('PRDID,PERIODID4_TSTAMP')
  })

  // En dato maestro es `{ results: [...] }`; aqui el arreglo directo.
  it('la entidad de navegacion recibe el arreglo directo', async () => {
    sapFetch.mockResolvedValueOnce({ json: {} })
    await enviar()
    expect(cuerpoDe()[`Nav${AREA}`]).toEqual(filas)
  })

  it('el identificador va con i minuscula tambien en el cuerpo', async () => {
    sapFetch.mockResolvedValueOnce({ json: {} })
    await enviar()

    expect(cuerpoDe().Transactionid).toBe('TX1')
    expect(cuerpoDe()).not.toHaveProperty('TransactionID')
  })

  it('la version y el escenario solo viajan si los hay', async () => {
    sapFetch.mockResolvedValueOnce({ json: {} })
    await enviar({ versionId: 'V1' })
    expect(cuerpoDe()).toMatchObject({ VersionID: 'V1' })
    expect(cuerpoDe()).not.toHaveProperty('ScenarioID')
  })

  // Es la diferencia entre "SAP se cayo" —reintentar— y "esta cifra no se puede escribir nunca".
  it('reconoce una cifra CALCULADA y lo dice', async () => {
    sapFetch.mockRejectedValueOnce(fallo(500, 'invalid column name: ADJUSTEDPRODUCTION'))

    await expect(enviar()).rejects.toMatchObject({
      cifraCalculada: 'ADJUSTEDPRODUCTION',
      message: expect.stringMatching(/es calculada y no se puede escribir/),
    })
  })

  it('otro error se propaga tal cual', async () => {
    sapFetch.mockRejectedValueOnce(fallo(500, 'tiempo agotado'))
    await expect(enviar()).rejects.not.toHaveProperty('cifraCalculada')
  })

  // Repetir un envio que SAP ya guardo duplica valores DENTRO de la misma transaccion.
  it('un envio que falla NO se reintenta', async () => {
    sapFetch.mockRejectedValueOnce(fallo(500, 'tiempo agotado'))
    await expect(enviar()).rejects.toThrow()
    expect(sapFetch).toHaveBeenCalledTimes(1)
  })
})

describe('commitTransaction', () => {
  // En minusculas: en dato maestro es `/Commit`.
  it('confirma con la ruta en minusculas', async () => {
    sapFetch.mockResolvedValueOnce({ json: {} })
    await commitTransaction({ ...ctx, transactionId: 'TX1' })

    expect(urlDe()).toContain("/commit?P_TransactionID='TX1'")
    expect(sapFetch.mock.calls[0][0].method).toBe('POST')
  })
})

describe('getExportResult y waitForProcessed', () => {
  const sinDormir = { esperar: () => Promise.resolve() }

  it('aplana los pares que devuelve SAP', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { results: [{ Name: 'Status', Value: 'PROCESSED' }] } } })
    await expect(getExportResult({ ...ctx, transactionId: 'TX' })).resolves.toEqual({ Status: 'PROCESSED' })
  })

  it('espera hasta que SAP dice que termino', async () => {
    sapFetch
      .mockResolvedValueOnce({ json: { d: { results: [{ Name: 'Status', Value: 'PROCESSING' }] } } })
      .mockResolvedValueOnce({ json: { d: { results: [{ Name: 'Status', Value: 'PROCESSED' }] } } })

    await expect(waitForProcessed({ ...ctx, transactionId: 'TX', ...sinDormir })).resolves.toBe('PROCESADA')
  })

  it('distingue el error del acierto', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { results: [{ Name: 'Status', Value: 'ERROR' }] } } })
    await expect(waitForProcessed({ ...ctx, transactionId: 'TX', ...sinDormir })).resolves.toBe('CON_ERROR')
  })

  it('si tarda demasiado se dice, no se miente', async () => {
    sapFetch.mockResolvedValue({ json: { d: { results: [{ Name: 'Status', Value: 'PROCESSING' }] } } })
    let reloj = 0
    await expect(waitForProcessed({
      ...ctx, transactionId: 'TX', ...sinDormir, timeoutMs: 10, ahora: () => { reloj += 6; return reloj },
    })).resolves.toBe('SIN_RESPUESTA')
  })

  it('sin ese endpoint no se espera para siempre', async () => {
    sapFetch.mockRejectedValueOnce(fallo(404, 'no'))
    await expect(waitForProcessed({ ...ctx, transactionId: 'TX', ...sinDormir })).resolves.toBe('SIN_SOPORTE')
  })
})

describe('readMessages', () => {
  it('filtra por la transaccion, con i minuscula', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { results: [] } } })
    await readMessages({ ...ctx, area: AREA, transactionId: 'TX1', porPagina: 10 })

    expect(urlDe()).toContain(`/${AREA}Message`)
    expect(urlDe()).toContain("Transactionid eq 'TX1'")
  })

  it('pagina hasta traerlos todos', async () => {
    sapFetch
      .mockResolvedValueOnce({ json: { d: { results: Array(10).fill({ m: 'a' }) } } })
      .mockResolvedValueOnce({ json: { d: { results: [{ m: 'b' }] } } })

    await expect(readMessages({ ...ctx, area: AREA, transactionId: 'TX', porPagina: 10 }))
      .resolves.toHaveLength(11)
  })
})
