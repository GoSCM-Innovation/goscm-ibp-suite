import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../transport/sap-fetch.js', () => ({ sapFetch: vi.fn(), fetchCsrf: vi.fn() }))

const { sapFetch } = await import('../transport/sap-fetch.js')
const {
  commitTransaction, getExportResult, getTransactionId, initiateParallelProcess,
  partirEnEnvios, postTransChunk, readMessages, waitForProcessed,
} = await import('./master-data-write.js')

const BASE = 'https://tenant-api.scmibp1.ondemand.com'
const cred = { user: 'u', password: 'p' }
const ctx = { baseUrl: BASE, credentials: cred }

beforeEach(() => { sapFetch.mockReset() })

const urlDe = (n = 0) => decodeURIComponent(sapFetch.mock.calls[n][0].url)
const cuerpoDe = (n = 0) => sapFetch.mock.calls[n][0].body
const fallo = (status, detail = 'no') => Object.assign(new Error('SAP'), { status, detail })

describe('partirEnEnvios', () => {
  it('corta por número de filas', () => {
    expect(partirEnEnvios(Array(12).fill({ a: 1 }), { maxFilas: 5 }).map((uno) => uno.length))
      .toEqual([5, 5, 2])
  })

  // Hay tablas de pocas columnas con valores enormes: un número fijo de filas produce de vez en
  // cuando un cuerpo por encima del límite, y eso es un 413 que no se puede reintentar.
  it('corta por bytes aunque quepan las filas', () => {
    const gorda = { texto: 'x'.repeat(500) }
    expect(partirEnEnvios([gorda, gorda, gorda], { maxBytes: 1100, maxFilas: 5000 }).length).toBeGreaterThan(1)
  })

  it('una fila más grande que el tope va sola, no se pierde', () => {
    const enorme = { texto: 'x'.repeat(5000) }
    expect(partirEnEnvios([enorme], { maxBytes: 100 })).toEqual([[enorme]])
  })

  it('sin filas no hay envíos', () => {
    expect(partirEnEnvios([])).toEqual([])
  })
})

describe('getTransactionId', () => {
  // Mandarlas hace que el envío falle con 400 "check the planning area and version values".
  it('la versión base se mienta sin área ni versión', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { Value: 'TX1' } } })
    await getTransactionId({ ...ctx, entidad: 'T', planningArea: 'PA', versionId: '' })

    const url = urlDe()
    expect(url).toContain("MasterDataTypeID='T'")
    expect(url).not.toContain('VersionID')
    expect(url).not.toContain('PlanningArea')
  })

  it('una versión real las manda las dos', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { Value: 'TX1' } } })
    await getTransactionId({ ...ctx, entidad: 'T', planningArea: 'PA', versionId: 'V1' })

    expect(urlDe()).toContain("VersionID='V1'")
    expect(urlDe()).toContain("PlanningArea='PA'")
  })

  it('sin identificador no se sigue', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: {} } })
    await expect(getTransactionId({ ...ctx, entidad: 'T' })).rejects.toThrow(/no devolvió un identificador/)
  })
})

describe('initiateParallelProcess', () => {
  // No existe para la base: devuelve 4xx con cualquier combinación de parámetros.
  it('no se intenta con la versión base', async () => {
    await expect(initiateParallelProcess({ ...ctx, transactionId: 'TX', versionId: '' })).resolves.toBeNull()
    expect(sapFetch).not.toHaveBeenCalled()
  })

  it('manda el nombre visible de la ejecución', async () => {
    sapFetch.mockResolvedValueOnce({ json: {} })
    await initiateParallelProcess({ ...ctx, transactionId: 'TX', versionId: 'V1', nombre: 'Carga de prueba' })
    expect(urlDe()).toContain("TransactionName='Carga de prueba'")
  })

  // Es una mejora, no un requisito: un tenant que no la tenga sigue cargando igual.
  it('un tenant que no lo admite no rompe la carga', async () => {
    sapFetch.mockRejectedValueOnce(fallo(404))
    await expect(initiateParallelProcess({ ...ctx, transactionId: 'TX', versionId: 'V1' })).resolves.toBeNull()
  })

  it('un fallo del servidor sí se propaga', async () => {
    sapFetch.mockRejectedValueOnce(fallo(500))
    await expect(initiateParallelProcess({ ...ctx, transactionId: 'TX', versionId: 'V1' })).rejects.toThrow()
  })
})

describe('postTransChunk', () => {
  const filas = [{ PRDID: '1', BRAND: 'X', PlanningAreaID: 'PA', CREATEDDATE: 'ayer' }]

  it('arma el cuerpo con la entidad de navegación y los atributos', async () => {
    sapFetch.mockResolvedValueOnce({ json: {} })
    await postTransChunk({ ...ctx, entidad: 'AS1PRODUCT', transactionId: 'TX', filas, versionId: 'V1', planningArea: 'PA' })

    const cuerpo = cuerpoDe()
    expect(cuerpo).toMatchObject({ TransactionID: 'TX', DoCommit: false, DeleteEntries: false })
    expect(cuerpo.NavAS1PRODUCT.results[0]).toEqual({ PRDID: '1', BRAND: 'X' })
    expect(cuerpo.RequestedAttributes).toBe('PRDID,BRAND')
    expect(sapFetch.mock.calls[0][0].method).toBe('POST')
  })

  it('quita los campos que SAP rechaza al escribir', async () => {
    sapFetch.mockResolvedValueOnce({ json: {} })
    await postTransChunk({ ...ctx, entidad: 'T', transactionId: 'TX', filas, versionId: 'V1' })
    expect(Object.keys(cuerpoDe().NavT.results[0])).not.toContain('CREATEDDATE')
  })

  // La base no lleva NI área NI versión; incluirlas se rechaza con 400.
  it('la versión base no lleva contexto en el cuerpo', async () => {
    sapFetch.mockResolvedValueOnce({ json: {} })
    await postTransChunk({ ...ctx, entidad: 'T', transactionId: 'TX', filas, versionId: '', planningArea: 'PA' })

    expect(cuerpoDe()).not.toHaveProperty('VersionID')
    expect(cuerpoDe()).not.toHaveProperty('PlanningAreaID')
  })

  it('una versión real lleva las dos', async () => {
    sapFetch.mockResolvedValueOnce({ json: {} })
    await postTransChunk({ ...ctx, entidad: 'T', transactionId: 'TX', filas, versionId: 'V1', planningArea: 'PA' })
    expect(cuerpoDe()).toMatchObject({ VersionID: 'V1', PlanningAreaID: 'PA' })
  })

  it('un borrado se marca como tal', async () => {
    sapFetch.mockResolvedValueOnce({ json: {} })
    await postTransChunk({ ...ctx, entidad: 'T', transactionId: 'TX', filas, borrar: true })
    expect(cuerpoDe().DeleteEntries).toBe(true)
  })

  // Repetir un envío ya mandado duplica claves y al confirmar SAP rechaza LAS DOS copias.
  it('un envío que falla NO se reintenta', async () => {
    sapFetch.mockRejectedValueOnce(fallo(500, 'tiempo agotado'))
    await expect(postTransChunk({ ...ctx, entidad: 'T', transactionId: 'TX', filas })).rejects.toThrow()
    expect(sapFetch).toHaveBeenCalledTimes(1)
  })
})

describe('commitTransaction', () => {
  it('confirma por POST con el identificador', async () => {
    sapFetch.mockResolvedValueOnce({ json: {} })
    await commitTransaction({ ...ctx, transactionId: 'TX' })

    expect(urlDe()).toContain("P_TransactionID='TX'")
    expect(sapFetch.mock.calls[0][0].method).toBe('POST')
  })
})

describe('getExportResult', () => {
  it('aplana los pares que devuelve SAP', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { results: [{ Name: 'Status', Value: 'PROCESSED' }] } } })
    await expect(getExportResult({ ...ctx, transactionId: 'TX' })).resolves.toEqual({ Status: 'PROCESSED' })
  })

  // No es lo mismo que un fallo, y quien llama lo distingue.
  it('un tenant sin ese endpoint devuelve null', async () => {
    sapFetch.mockRejectedValueOnce(fallo(404))
    await expect(getExportResult({ ...ctx, transactionId: 'TX' })).resolves.toBeNull()
  })
})

describe('waitForProcessed', () => {
  const sinDormir = { esperar: () => Promise.resolve() }

  it('espera hasta que SAP dice que terminó', async () => {
    sapFetch
      .mockResolvedValueOnce({ json: { d: { results: [{ Name: 'Status', Value: 'PROCESSING' }] } } })
      .mockResolvedValueOnce({ json: { d: { results: [{ Name: 'Status', Value: 'PROCESSED' }] } } })

    await expect(waitForProcessed({ ...ctx, transactionId: 'TX', ...sinDormir })).resolves.toBe('PROCESADA')
  })

  it('un error de SAP se distingue de un acierto', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { results: [{ Name: 'Status', Value: 'ERROR' }] } } })
    await expect(waitForProcessed({ ...ctx, transactionId: 'TX', ...sinDormir })).resolves.toBe('CON_ERROR')
  })

  it('sin ese endpoint no se espera para siempre', async () => {
    sapFetch.mockRejectedValueOnce(fallo(404))
    await expect(waitForProcessed({ ...ctx, transactionId: 'TX', ...sinDormir })).resolves.toBe('SIN_SOPORTE')
  })

  it('si tarda demasiado se dice, no se miente', async () => {
    sapFetch.mockResolvedValue({ json: { d: { results: [{ Name: 'Status', Value: 'PROCESSING' }] } } })
    let reloj = 0
    await expect(waitForProcessed({
      ...ctx, transactionId: 'TX', ...sinDormir, timeoutMs: 10, ahora: () => { reloj += 6; return reloj },
    })).resolves.toBe('SIN_RESPUESTA')
  })

  // Un fallo puntual al preguntar no dice nada del estado de la transacción.
  it('un tropiezo al preguntar no se toma por un final', async () => {
    sapFetch
      .mockRejectedValueOnce(fallo(500))
      .mockResolvedValueOnce({ json: { d: { results: [{ Name: 'Status', Value: 'PROCESSED' }] } } })

    await expect(waitForProcessed({ ...ctx, transactionId: 'TX', ...sinDormir })).resolves.toBe('PROCESADA')
  })
})

describe('readMessages', () => {
  it('trae los valores de la fila que falló junto al mensaje', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { results: [{ Message: 'mal' }] } } })
    await expect(readMessages({ ...ctx, entidad: 'T', transactionId: 'TX', porPagina: 10 }))
      .resolves.toEqual([{ Message: 'mal' }])
    expect(urlDe()).toContain('$expand=NavT')
  })

  // Mejor un mensaje sin la fila que ningún mensaje.
  it('un tenant que rechaza el expand se atiende igual', async () => {
    sapFetch
      .mockRejectedValueOnce(fallo(400))
      .mockResolvedValueOnce({ json: { d: { results: [{ Message: 'mal' }] } } })

    await expect(readMessages({ ...ctx, entidad: 'T', transactionId: 'TX', porPagina: 10 })).resolves.toHaveLength(1)
    expect(urlDe(1)).not.toContain('$expand')
  })

  it('pagina hasta traerlos todos', async () => {
    sapFetch
      .mockResolvedValueOnce({ json: { d: { results: Array(10).fill({ Message: 'a' }) } } })
      .mockResolvedValueOnce({ json: { d: { results: [{ Message: 'b' }] } } })

    await expect(readMessages({ ...ctx, entidad: 'T', transactionId: 'TX', porPagina: 10 })).resolves.toHaveLength(11)
  })
})
