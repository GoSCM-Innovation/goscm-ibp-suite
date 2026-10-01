import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./planning-data.js', () => ({ countKf: vi.fn(), readKfPage: vi.fn(), planningRoot: vi.fn() }))
vi.mock('./planning-data-write.js', async (real) => ({
  ...(await real()),
  abrirSesionDeEscritura: vi.fn(),
  commitTransaction: vi.fn(),
  getTransactionId: vi.fn(),
  initiateParallelProcess: vi.fn(),
  postKfChunk: vi.fn(),
  readMessages: vi.fn(),
  waitForProcessed: vi.fn(),
}))

const { countKf, readKfPage } = await import('./planning-data.js')
const {
  abrirSesionDeEscritura, commitTransaction, getTransactionId,
  initiateParallelProcess, postKfChunk, readMessages, waitForProcessed,
} = await import('./planning-data-write.js')
const { FILAS_POR_LECTURA } = await import('./kf-migration-plan.js')
const {
  confirmarTransaccionDeCifra, contarCifra, copiarSegmentoDeCifra, filtroDeLaCifra, periodosDeLaCifra,
} = await import('./kf-migration.js')

const origen = { baseUrl: 'https://a', credentials: { user: 'a' }, versionId: 'V1' }
const destino = { baseUrl: 'https://b', credentials: { user: 'b' }, versionId: 'V2' }

const definicion = {
  nivel: [{ destino: 'PRDID', origen: 'PRDID' }, { destino: 'CUSTID', origen: 'ATRIBUTOZ' }],
  cifra: { origen: 'ZSRC', destino: 'ZDST' },
  campoDeTiempo: 'PERIODID4_TSTAMP',
  conversiones: {},
  condiciones: [],
  desde: '',
  hasta: '',
  soloConValor: true,
}

const comun = { origen, destino, areaOrigen: 'AREA1', areaDestino: 'AREA2', definicion }

/** Sirve `n` filas repartidas en páginas; la fila `cero` vale 0. */
function conFilas(n, { cero = -1 } = {}) {
  readKfPage.mockImplementation(({ skip, top }) => Promise.resolve(
    Array.from({ length: Math.max(0, Math.min(top, n - skip)) }, (_, i) => ({
      PRDID: `P${skip + i}`,
      ATRIBUTOZ: 'C',
      PERIODID4_TSTAMP: '/Date(1767225600000)/',
      ZSRC: skip + i === cero ? '0' : '10',
    })),
  ))
}

beforeEach(() => {
  vi.clearAllMocks()
  abrirSesionDeEscritura.mockResolvedValue({ token: 't', cookies: 'c' })
  getTransactionId.mockImplementation(() => Promise.resolve(`TX${getTransactionId.mock.calls.length}`))
  initiateParallelProcess.mockResolvedValue(null)
  postKfChunk.mockResolvedValue({})
  commitTransaction.mockResolvedValue({})
  waitForProcessed.mockResolvedValue('PROCESADA')
  readMessages.mockResolvedValue([])
})

describe('filtroDeLaCifra', () => {
  it('acota a la versión del ORIGEN y a las filas no cero, sin `ne 0`', () => {
    const filtro = filtroDeLaCifra(definicion, 'V1')
    expect(filtro).toContain("VERSIONID eq 'V1'")
    expect(filtro).toContain('(ZSRC gt 0 or ZSRC lt 0)')
    expect(filtro).not.toContain('ne 0')
  })

  it('la versión base no lleva predicado', () => {
    expect(filtroDeLaCifra(definicion, '')).not.toContain('VERSIONID')
  })

  it('lleva las condiciones, las fechas sobre el tiempo y las conversiones', () => {
    const filtro = filtroDeLaCifra({
      ...definicion,
      soloConValor: false,
      condiciones: [{ field: 'BRAND', op: 'in', value: 'X' }],
      desde: '2026-01-01',
      conversiones: { UOMTOID: 'EA' },
    }, '')
    expect(filtro).toContain("BRAND eq 'X'")
    expect(filtro).toContain("PERIODID4_TSTAMP ge datetime'2026-01-01T00:00:00'")
    expect(filtro).toContain("UOMTOID eq 'EA'")
    expect(filtro).not.toContain('gt 0')
  })
})

describe('contarCifra', () => {
  it('cuenta con el select de la lectura y el filtro de la key figure', async () => {
    countKf.mockResolvedValue(42)
    await expect(contarCifra({ origen, area: 'AREA1', definicion, reintentos: 1 })).resolves.toBe(42)
    const llamada = countKf.mock.calls[0][0]
    expect(llamada.select).toEqual(['PRDID', 'ATRIBUTOZ', 'ZSRC', 'PERIODID4_TSTAMP'])
    expect(llamada.filtro).toContain("VERSIONID eq 'V1'")
    expect(llamada).toMatchObject({ area: 'AREA1', reintentos: 1, timeoutMs: 60_000 })
  })
})

describe('periodosDeLaCifra', () => {
  it('devuelve los periodos distintos en ISO, ordenados', async () => {
    readKfPage.mockResolvedValue([
      { PERIODID4_TSTAMP: '/Date(1767830400000)/', ZSRC: '1' },
      { PERIODID4_TSTAMP: '/Date(1767225600000)/', ZSRC: '2' },
      { PERIODID4_TSTAMP: '/Date(1767225600000)/', ZSRC: '3' },
    ])
    await expect(periodosDeLaCifra({ origen, area: 'AREA1', definicion }))
      .resolves.toEqual(['2026-01-01T00:00:00', '2026-01-08T00:00:00'])
    expect(readKfPage.mock.calls[0][0].select).toEqual(['PERIODID4_TSTAMP', 'ZSRC'])
  })
})

describe('copiarSegmentoDeCifra', () => {
  it('lee del origen, escribe en el destino y confirma una transacción', async () => {
    conFilas(10, { cero: 3 })
    const salida = await copiarSegmentoDeCifra({ ...comun, cuantas: 100 })

    expect(salida).toMatchObject({ ok: true, leidas: 10, escritas: 9, agotado: true, transactionId: 'TX1' })
    expect(commitTransaction).toHaveBeenCalledTimes(1)

    const envio = postKfChunk.mock.calls[0][0]
    expect(envio).toMatchObject({ area: 'AREA2', versionId: 'V2', transactionId: 'TX1' })
    expect(envio.campos).toEqual(['PRDID', 'CUSTID', 'ZDST', 'PERIODID4_TSTAMP'])
    // El periodo va en ISO: la importación no acepta `/Date(…)/`.
    expect(envio.filas[0]).toEqual({ PRDID: 'P0', CUSTID: 'C', PERIODID4_TSTAMP: '2026-01-01T00:00:00', ZDST: '10' })
  })

  it('lee con orden estable, en el área y con la versión del ORIGEN', async () => {
    conFilas(3)
    await copiarSegmentoDeCifra({ ...comun, cuantas: 100 })
    const lectura = readKfPage.mock.calls[0][0]
    expect(lectura).toMatchObject({ area: 'AREA1', baseUrl: 'https://a' })
    expect(lectura.orderby).toEqual(['PRDID', 'ATRIBUTOZ', 'PERIODID4_TSTAMP'])
    expect(lectura.filtro).toContain("VERSIONID eq 'V1'")
  })

  it('lee la ventana pedida, de a dos páginas, y no dice agotado si la ventana se llenó', async () => {
    conFilas(FILAS_POR_LECTURA * 10)
    const salida = await copiarSegmentoDeCifra({ ...comun, desde: FILAS_POR_LECTURA, cuantas: FILAS_POR_LECTURA * 3 })
    expect(salida).toMatchObject({ ok: true, leidas: FILAS_POR_LECTURA * 3, agotado: false })
    expect(readKfPage.mock.calls.map((c) => c[0].skip))
      .toEqual([FILAS_POR_LECTURA, FILAS_POR_LECTURA * 2, FILAS_POR_LECTURA * 3])
  })

  it('con periodo, el filtro lo acota', async () => {
    conFilas(1)
    await copiarSegmentoDeCifra({ ...comun, periodo: '2026-01-01T00:00:00' })
    expect(readKfPage.mock.calls[0][0].filtro).toContain("PERIODID4_TSTAMP eq datetime'2026-01-01T00:00:00'")
  })

  it('sin nada con valor no abre transacción', async () => {
    conFilas(2, { cero: 0 })
    readKfPage.mockResolvedValueOnce([{ PRDID: 'P', ATRIBUTOZ: 'C', PERIODID4_TSTAMP: '/Date(1)/', ZSRC: '0' }])
    const salida = await copiarSegmentoDeCifra({ ...comun, cuantas: 100 })
    expect(salida).toMatchObject({ ok: true, escritas: 0, transactionId: null })
    expect(getTransactionId).not.toHaveBeenCalled()
  })

  it('parte los envíos en 2.500 valores, de tres en tres', async () => {
    conFilas(7600)
    const salida = await copiarSegmentoDeCifra({ ...comun, cuantas: 10_000 })
    expect(salida.escritas).toBe(7600)
    expect(postKfChunk.mock.calls.map((c) => c[0].filas.length)).toEqual([2500, 2500, 2500, 100])
  })

  it('un fallo de escritura NO se reintenta aquí y se marca transitorio si lo es', async () => {
    conFilas(5)
    postKfChunk.mockRejectedValue(Object.assign(new Error('caído'), { status: 503, retryable: true }))
    const salida = await copiarSegmentoDeCifra({ ...comun })
    expect(salida).toMatchObject({ ok: false, transitorio: true, fase: 'writing', leidas: 5 })
    expect(postKfChunk).toHaveBeenCalledTimes(1)
    expect(commitTransaction).not.toHaveBeenCalled()
  })

  it('una key figure calculada no es transitoria', async () => {
    conFilas(5)
    postKfChunk.mockRejectedValue(Object.assign(new Error('calculada'), { status: 500, cifraCalculada: 'ZDST' }))
    const salida = await copiarSegmentoDeCifra({ ...comun })
    expect(salida).toMatchObject({ ok: false, transitorio: false, cifraCalculada: 'ZDST' })
  })

  it('un 400 no es transitorio', async () => {
    readKfPage.mockRejectedValue(Object.assign(new Error('mal'), { status: 400, detail: 'Invalid filter' }))
    const salida = await copiarSegmentoDeCifra({ ...comun })
    expect(salida).toMatchObject({ ok: false, transitorio: false, fase: 'reading', error: '[400] Invalid filter' })
  })

  it('el procesamiento en paralelo es de mejor esfuerzo', async () => {
    conFilas(2)
    initiateParallelProcess.mockRejectedValue(new Error('no'))
    await expect(copiarSegmentoDeCifra({ ...comun })).resolves.toMatchObject({ ok: true })
  })
})

describe('confirmarTransaccionDeCifra', () => {
  it('una transacción limpia no pide mensajes', async () => {
    await expect(confirmarTransaccionDeCifra({ destino, area: 'AREA2', transactionId: 'T' }))
      .resolves.toEqual({ estado: 'PROCESADA', mensajes: [] })
    expect(readMessages).not.toHaveBeenCalled()
    expect(waitForProcessed.mock.calls[0][0].timeoutMs).toBe(120_000)
  })

  it('si no quedó limpia, devuelve solo los rechazos E/A', async () => {
    waitForProcessed.mockResolvedValue('PROCESADA_CON_ERRORES')
    readMessages.mockResolvedValue([
      { ExceptionId: 'E1', MsgText: 'mal', Severity: 'E', Transactionid: 'T' },
      { ExceptionId: 'I1', MsgText: 'info', Severity: 'I' },
    ])
    await expect(confirmarTransaccionDeCifra({ destino, area: 'AREA2', transactionId: 'T' }))
      .resolves.toEqual({ estado: 'PROCESADA_CON_ERRORES', mensajes: [{ ExceptionId: 'E1', MsgText: 'mal', Severity: 'E' }] })
  })

  it('si los mensajes no se pueden leer, se sigue', async () => {
    waitForProcessed.mockResolvedValue('SIN_RESPUESTA')
    readMessages.mockRejectedValue(new Error('x'))
    await expect(confirmarTransaccionDeCifra({ destino, area: 'AREA2', transactionId: 'T' }))
      .resolves.toEqual({ estado: 'SIN_RESPUESTA', mensajes: [] })
  })
})
