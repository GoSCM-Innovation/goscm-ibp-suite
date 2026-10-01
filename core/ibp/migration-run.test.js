import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../transport/sap-fetch.js', () => ({ sapFetch: vi.fn() }))
vi.mock('./master-data.js', async (real) => ({
  ...(await real()),
  countEntity: vi.fn(),
  readEntityPage: vi.fn(),
}))
vi.mock('./master-data-write.js', async (real) => ({
  ...(await real()),
  abrirSesionDeEscritura: vi.fn(),
  commitTransaction: vi.fn(),
  getExportResult: vi.fn(),
  getTransactionId: vi.fn(),
  initiateParallelProcess: vi.fn(),
  postTransChunk: vi.fn(),
}))

const { sapFetch } = await import('../transport/sap-fetch.js')
const { countEntity, readEntityPage } = await import('./master-data.js')
const {
  abrirSesionDeEscritura, commitTransaction, getExportResult, getTransactionId,
  initiateParallelProcess, postTransChunk,
} = await import('./master-data-write.js')
const {
  cargarBorrado, cargarSegmento, confirmarTransaccion, estadoDeTransaccion, leerMensajes,
  medirPorPagina, prepararTabla,
} = await import('./migration-run.js')

const origen = { baseUrl: 'https://a.scmibp.ondemand.com', credentials: { user: 'a' }, planningArea: 'PA1', versionId: 'V1' }
const destino = { baseUrl: 'https://b.scmibp.ondemand.com', credentials: { user: 'b' }, planningArea: 'PA2', versionId: 'V2' }

const comun = {
  origen, destino, entidad: 'GIDPRODUCT', entidadDestino: 'AS1PRODUCT',
  columnas: ['PRDID', 'BRAND'], claves: ['PRDID'], porPagina: 100,
}

/** Una tabla de `n` filas que responde a `$skip`/`$top`. */
function conFilas(n) {
  readEntityPage.mockImplementation(({ skip, top }) => {
    const cuantas = Math.max(0, Math.min(top, n - skip))
    return Promise.resolve(Array.from({ length: cuantas }, (_, i) => ({ PRDID: String(skip + i), BRAND: 'X' })))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  abrirSesionDeEscritura.mockResolvedValue({ token: 't', cookies: 'c' })
  getTransactionId.mockImplementation(() => Promise.resolve(`TX${getTransactionId.mock.calls.length}`))
  initiateParallelProcess.mockResolvedValue(null)
  postTransChunk.mockResolvedValue({})
  commitTransaction.mockResolvedValue({})
})

describe('cargarSegmento', () => {
  it('lee del origen y manda al destino, cada uno con su nombre', async () => {
    conFilas(50)
    const salida = await cargarSegmento({ ...comun, desde: 0, cuantas: 50 })

    expect(readEntityPage.mock.calls[0][0]).toMatchObject({
      entidad: 'GIDPRODUCT', select: ['PRDID', 'BRAND'], orderby: ['PRDID'], planningArea: 'PA1', versionId: 'V1',
    })
    expect(postTransChunk.mock.calls[0][0]).toMatchObject({ entidad: 'AS1PRODUCT', borrar: false, transactionId: 'TX1' })
    expect(salida).toMatchObject({ transactionId: 'TX1', filas: 50, agotado: false })
  })

  // La confirmación es otra llamada: así una cancelación a mitad no deja nada confirmado.
  it('NO confirma la transacción', async () => {
    conFilas(10)
    await cargarSegmento({ ...comun, cuantas: 10 })
    expect(commitTransaction).not.toHaveBeenCalled()
  })

  // v8: seis páginas a la vez dentro del segmento.
  it('lee las páginas en tandas paralelas, desde donde empieza el segmento', async () => {
    conFilas(10_000)
    await cargarSegmento({ ...comun, desde: 2000, cuantas: 1000, paralelo: 6 })

    const skips = readEntityPage.mock.calls.map(([uno]) => uno.skip)
    expect(skips).toEqual([2000, 2100, 2200, 2300, 2400, 2500, 2600, 2700, 2800, 2900])
    expect(readEntityPage.mock.calls.every(([uno]) => uno.top === 100)).toBe(true)
  })

  it('la última página no pide más allá del segmento', async () => {
    conFilas(10_000)
    await cargarSegmento({ ...comun, desde: 0, cuantas: 250 })
    expect(readEntityPage.mock.calls.map(([uno]) => uno.top)).toEqual([100, 100, 50])
  })

  // Sin columnas verificadas se mandan todas las del origen: no se recorta con `$select`.
  it('sin columnas lee la tabla entera, sin $select', async () => {
    conFilas(5)
    await cargarSegmento({ ...comun, columnas: [], cuantas: 5 })
    expect(readEntityPage.mock.calls[0][0].select).toBeUndefined()
  })

  it('marca agotado cuando llegan menos filas de las pedidas', async () => {
    conFilas(30)
    await expect(cargarSegmento({ ...comun, cuantas: 500 })).resolves.toMatchObject({ filas: 30, agotado: true })
  })

  // Un segmento vacío no deja una transacción abierta en SAP.
  it('sin filas no abre transacción', async () => {
    conFilas(0)
    const salida = await cargarSegmento({ ...comun, cuantas: 500 })
    expect(salida).toMatchObject({ transactionId: null, filas: 0, agotado: true })
    expect(getTransactionId).not.toHaveBeenCalled()
  })

  // EL punto: un envío ya mandado no se repite. Si falla, falla la llamada y se repite ENTERA.
  it('un envío que falla no se reintenta: la llamada lanza', async () => {
    conFilas(10)
    postTransChunk.mockRejectedValue(Object.assign(new Error('504'), { status: 504 }))

    await expect(cargarSegmento({ ...comun, cuantas: 10 })).rejects.toThrow('504')
    expect(postTransChunk).toHaveBeenCalledTimes(1)
    expect(getTransactionId).toHaveBeenCalledTimes(1)
    expect(commitTransaction).not.toHaveBeenCalled()
  })

  it('le pone el nombre a la transacción', async () => {
    conFilas(5)
    await cargarSegmento({ ...comun, cuantas: 5, nombre: 'MI-CARGA' })
    expect(initiateParallelProcess.mock.calls[0][0]).toMatchObject({ nombre: 'MI-CARGA', transactionId: 'TX1' })
  })

  // v8 ignoraba cualquier fallo del proceso en paralelo: es una mejora, no un requisito.
  it('un fallo del proceso en paralelo no para la carga', async () => {
    conFilas(5)
    initiateParallelProcess.mockRejectedValue(Object.assign(new Error('500'), { status: 500 }))
    await expect(cargarSegmento({ ...comun, cuantas: 5 })).resolves.toMatchObject({ filas: 5 })
  })

  it('devuelve cuánto tardó leyendo y escribiendo', async () => {
    conFilas(5)
    const { tiempos } = await cargarSegmento({ ...comun, cuantas: 5 })
    expect(tiempos).toHaveProperty('reading')
    expect(tiempos).toHaveProperty('writing')
  })
})

describe('cargarBorrado', () => {
  it('manda las claves con DeleteEntries y no confirma', async () => {
    const salida = await cargarBorrado({ destino, entidadDestino: 'AS1PRODUCT', claves: [{ PRDID: '1' }, { PRDID: '2' }] })

    expect(postTransChunk.mock.calls[0][0]).toMatchObject({ borrar: true, entidad: 'AS1PRODUCT', filas: [{ PRDID: '1' }, { PRDID: '2' }] })
    expect(initiateParallelProcess.mock.calls[0][0]).toMatchObject({ nombre: 'IBP-ControlTower-DEL' })
    expect(commitTransaction).not.toHaveBeenCalled()
    expect(salida).toMatchObject({ transactionId: 'TX1', filas: 2 })
  })

  it('sin claves no hace nada', async () => {
    await expect(cargarBorrado({ destino, entidadDestino: 'T', claves: [] })).resolves.toMatchObject({ transactionId: null })
    expect(getTransactionId).not.toHaveBeenCalled()
  })
})

describe('confirmarTransaccion', () => {
  it('confirma con un token de escritura propio', async () => {
    await confirmarTransaccion({ destino, transactionId: 'TX9' })
    expect(commitTransaction.mock.calls[0][0]).toMatchObject({ transactionId: 'TX9', csrf: { token: 't' } })
  })
})

describe('estadoDeTransaccion', () => {
  it('traduce lo que dice SAP', async () => {
    getExportResult.mockResolvedValueOnce({ Status: 'PROCESSED' })
    await expect(estadoDeTransaccion({ destino, transactionId: 'T' })).resolves.toBe('PROCESADA')
    getExportResult.mockResolvedValueOnce({ Status: 'ERROR' })
    await expect(estadoDeTransaccion({ destino, transactionId: 'T' })).resolves.toBe('CON_ERROR')
    getExportResult.mockResolvedValueOnce({ Status: 'PROCESSING' })
    await expect(estadoDeTransaccion({ destino, transactionId: 'T' })).resolves.toBe('PROCESANDO')
    getExportResult.mockResolvedValueOnce(null)
    await expect(estadoDeTransaccion({ destino, transactionId: 'T' })).resolves.toBe('SIN_SOPORTE')
  })
})

describe('medirPorPagina', () => {
  it('mide la respuesta de verdad y la convierte en filas por página', async () => {
    const filas = Array.from({ length: 200 }, () => ({ PRDID: 'x' }))
    sapFetch.mockResolvedValue({ text: 'x'.repeat(200 * 3000), json: { d: { results: filas } } })

    // 3.000 bytes por fila → 900.000 / 3.000 = 300 filas por página.
    await expect(medirPorPagina({ origen, entidad: 'T', columnas: ['PRDID'] })).resolves.toBe(300)
    const url = decodeURIComponent(sapFetch.mock.calls[0][0].url)
    expect(url).toContain('$top=200')
    expect(url).toContain('$select=PRDID')
    expect(url).toContain("VersionID eq 'V1'")
  })

  it('una tabla vacía no se puede medir', async () => {
    sapFetch.mockResolvedValue({ text: '{}', json: { d: { results: [] } } })
    await expect(medirPorPagina({ origen, entidad: 'T' })).resolves.toBeNull()
  })
})

describe('prepararTabla', () => {
  // v8 contaba la versión base del destino como `__BASELINE`.
  it('cuenta el destino; la versión base, como __BASELINE', async () => {
    countEntity.mockResolvedValue(42)
    sapFetch.mockResolvedValue({ text: 'x'.repeat(2000), json: { d: { results: [{}, {}] } } })

    const salida = await prepararTabla({ ...comun, destino: { ...destino, versionId: '' } })
    expect(countEntity.mock.calls[0][0]).toMatchObject({ entidad: 'AS1PRODUCT', versionId: '__BASELINE', planningArea: 'PA2' })
    expect(salida).toMatchObject({ dstBefore: 42, porPagina: 900, medido: true })
  })

  it('ningún fallo tumba la carga: sin cuenta y con la estimación por columnas', async () => {
    countEntity.mockRejectedValue(new Error('no'))
    sapFetch.mockRejectedValue(new Error('no'))

    const salida = await prepararTabla({ ...comun, campos: 10 })
    expect(salida.dstBefore).toBeNull()
    expect(salida.medido).toBe(false)
    expect(salida.porPagina).toBeGreaterThan(0)
  })
})

describe('leerMensajes', () => {
  it('se queda solo con los rechazos, y dice cuántos llegaron', async () => {
    sapFetch.mockResolvedValue({ json: { d: { results: [
      { Severity: 'E', Message: 'clave duplicada', __metadata: {} },
      { Severity: 'I', Message: 'ok' },
      { Severity: 'A', Message: 'abortado' },
    ] } } })

    const salida = await leerMensajes({ destino, entidad: 'AS1PRODUCT', transactionId: 'TX1' })
    expect(salida).toMatchObject({ leidos: 3, conExpand: true })
    expect(salida.rechazos).toEqual([
      { Severity: 'E', Message: 'clave duplicada' },
      { Severity: 'A', Message: 'abortado' },
    ])
    expect(sapFetch.mock.calls[0][0].url).toContain('$expand=NavAS1PRODUCT')
  })

  // Hay tenants que rechazan el `$expand`: mejor un mensaje sin su fila que ningún mensaje.
  it('si el tenant rechaza el $expand, pide sin él', async () => {
    sapFetch
      .mockRejectedValueOnce(Object.assign(new Error('400'), { status: 400 }))
      .mockResolvedValueOnce({ json: { d: { results: [{ Severity: 'E' }] } } })

    const salida = await leerMensajes({ destino, entidad: 'T', transactionId: 'TX1' })
    expect(salida).toMatchObject({ leidos: 1, conExpand: false })
    expect(sapFetch.mock.calls[1][0].url).not.toContain('$expand')
  })
})
