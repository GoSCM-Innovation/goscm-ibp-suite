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
const { FILAS_POR_SEGMENTO } = await import('./kf-migration-plan.js')
const {
  INTENTOS_POR_SEGMENTO, contarLoQueSeCopia, migrarCifras, migrarSegmentoDeCifras,
} = await import('./kf-migration.js')

const origen = { baseUrl: 'https://a', credentials: { user: 'a' }, versionId: 'V1' }
const destino = { baseUrl: 'https://b', credentials: { user: 'b' }, versionId: 'V2' }

const comun = {
  origen,
  destino,
  area: 'ASIBPTS',
  nivel: ['PRDID', 'PERIODID4_TSTAMP'],
  cifras: ['ADJUSTEDPRODUCTION'],
}

/** Sirve `n` filas repartidas en páginas. */
function conFilas(n) {
  readKfPage.mockImplementation(({ skip, top }) => Promise.resolve(
    Array.from({ length: Math.max(0, Math.min(top, n - skip)) }, (_, i) => ({
      PRDID: `P${skip + i}`,
      PERIODID4_TSTAMP: '/Date(1)/',
      ADJUSTEDPRODUCTION: '10',
      VERSIONID: 'V1',
      SOBRA: 'z',
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

describe('contarLoQueSeCopia', () => {
  it('cuenta al NIVEL elegido y planifica los segmentos', async () => {
    countKf.mockResolvedValue(FILAS_POR_SEGMENTO * 2)

    await expect(contarLoQueSeCopia(comun)).resolves.toMatchObject({ total: FILAS_POR_SEGMENTO * 2, segmentos: 2 })
    // El select lleva el nivel y después las cifras.
    expect(countKf.mock.calls[0][0].select).toEqual(['PRDID', 'PERIODID4_TSTAMP', 'ADJUSTEDPRODUCTION'])
  })
})

describe('migrarSegmentoDeCifras', () => {
  it('lee del origen y escribe en el destino', async () => {
    conFilas(10)
    const salida = await migrarSegmentoDeCifras({ ...comun, cuantas: 10 })

    expect(salida).toMatchObject({ filas: 10, ok: true })
    expect(postKfChunk).toHaveBeenCalled()
  })

  // Si el select y la lista del nivel no coinciden, se lee a un nivel y se escribe a otro.
  it('el nivel de la escritura es el MISMO que el de la lectura', async () => {
    conFilas(5)
    await migrarSegmentoDeCifras({ ...comun, cuantas: 5 })

    expect(readKfPage.mock.calls[0][0].select).toEqual(['PRDID', 'PERIODID4_TSTAMP', 'ADJUSTEDPRODUCTION'])
    expect(postKfChunk.mock.calls[0][0].campos).toEqual(['PRDID', 'PERIODID4_TSTAMP'])
  })

  // Sin orden estable, dos ventanas se solapan y dejan huecos.
  it('ordena por el nivel al paginar', async () => {
    conFilas(5)
    await migrarSegmentoDeCifras({ ...comun, cuantas: 5 })
    expect(readKfPage.mock.calls[0][0].orderby).toEqual(['PRDID', 'PERIODID4_TSTAMP'])
  })

  // SAP rechaza el envío si llegan atributos que no se pueden escribir.
  it('las filas se limpian: solo el nivel y las cifras', async () => {
    conFilas(1)
    await migrarSegmentoDeCifras({ ...comun, cuantas: 1 })

    const enviada = postKfChunk.mock.calls[0][0].filas[0]
    expect(enviada).toEqual({ PRDID: 'P0', PERIODID4_TSTAMP: '/Date(1)/', ADJUSTEDPRODUCTION: '10' })
    expect(enviada).not.toHaveProperty('VERSIONID')
    expect(enviada).not.toHaveProperty('SOBRA')
  })

  it('dice si la tabla se acabó, para que quien encadena pare', async () => {
    conFilas(30)
    await expect(migrarSegmentoDeCifras({ ...comun, cuantas: 500 }))
      .resolves.toMatchObject({ filas: 30, agotado: true })
  })

  // Reenviar dentro de la transacción vieja duplicaría valores; en una nueva es seguro.
  it('un fallo al escribir rehace el segmento en una transacción NUEVA', async () => {
    conFilas(10)
    postKfChunk.mockRejectedValueOnce(new Error('tiempo agotado'))

    await expect(migrarSegmentoDeCifras({ ...comun, cuantas: 10 })).resolves.toMatchObject({ ok: true })
    expect(getTransactionId).toHaveBeenCalledTimes(2)
  })

  it('tras agotar los intentos el segmento queda fallado', async () => {
    conFilas(10)
    postKfChunk.mockRejectedValue(new Error('no hay caso'))

    const salida = await migrarSegmentoDeCifras({ ...comun, cuantas: 10 })
    expect(salida).toMatchObject({ ok: false, fase: 'escritura' })
    expect(getTransactionId).toHaveBeenCalledTimes(INTENTOS_POR_SEGMENTO)
  })

  // Una cifra calculada no mejora reintentando: gastar tres intentos solo retrasa el mensaje.
  it('una cifra CALCULADA corta al primer intento', async () => {
    conFilas(10)
    postKfChunk.mockRejectedValue(Object.assign(new Error('La cifra «KF» es calculada y no se puede escribir.'), { cifraCalculada: 'KF' }))

    const salida = await migrarSegmentoDeCifras({ ...comun, cuantas: 10 })
    expect(salida).toMatchObject({ ok: false, cifraCalculada: 'KF' })
    expect(getTransactionId).toHaveBeenCalledTimes(1)
  })

  it('un fallo de lectura no lanza: sale en el resultado', async () => {
    readKfPage.mockRejectedValue(Object.assign(new Error('SAP'), { detail: 'se cayó' }))

    await expect(migrarSegmentoDeCifras({ ...comun, cuantas: 10 }))
      .resolves.toMatchObject({ ok: false, fase: 'lectura', error: 'se cayó' })
    expect(postKfChunk).not.toHaveBeenCalled()
  })

  it('reutiliza la sesión de escritura si se la pasan', async () => {
    conFilas(5)
    await migrarSegmentoDeCifras({ ...comun, cuantas: 5, csrf: { token: 't', cookies: 'c' } })
    expect(abrirSesionDeEscritura).not.toHaveBeenCalled()
  })

  it('escribe en el área del destino cuando se llama distinto', async () => {
    conFilas(5)
    await migrarSegmentoDeCifras({ ...comun, areaDestino: 'GCINDURAMA', cuantas: 5 })
    expect(postKfChunk.mock.calls[0][0].area).toBe('GCINDURAMA')
  })

  it('un segmento sin filas no manda nada a SAP', async () => {
    conFilas(0)
    await expect(migrarSegmentoDeCifras({ ...comun, cuantas: 10 })).resolves.toMatchObject({ ok: true, filas: 0 })
    expect(postKfChunk).not.toHaveBeenCalled()
  })

  it('cuenta lo que pasa para que la pantalla pueda seguirlo', async () => {
    conFilas(5)
    const fases = []
    await migrarSegmentoDeCifras({ ...comun, cuantas: 5, onProgreso: (uno) => fases.push(uno.fase) })

    expect(fases).toContain('leyendo')
    expect(fases).toContain('enviando')
    expect(fases).toContain('confirmando')
    expect(fases).toContain('procesada')
  })
})

describe('migrarCifras', () => {
  it('parte en segmentos y confirma cada uno', async () => {
    conFilas(FILAS_POR_SEGMENTO + 100)
    const salida = await migrarCifras({ ...comun, total: FILAS_POR_SEGMENTO + 100 })

    expect(salida.segmentos).toHaveLength(2)
    expect(commitTransaction).toHaveBeenCalledTimes(2)
    expect(salida).toMatchObject({ copiadas: FILAS_POR_SEGMENTO + 100, ok: true })
  })

  it('abre la sesión de escritura una sola vez', async () => {
    conFilas(10)
    await migrarCifras({ ...comun, total: 10 })
    expect(abrirSesionDeEscritura).toHaveBeenCalledTimes(1)
  })

  // No mejora en el segmento siguiente.
  it('una cifra calculada para la copia entera', async () => {
    conFilas(FILAS_POR_SEGMENTO * 3)
    postKfChunk.mockRejectedValue(Object.assign(new Error('calculada'), { cifraCalculada: 'KF' }))

    const salida = await migrarCifras({ ...comun, total: FILAS_POR_SEGMENTO * 3 })
    expect(salida).toMatchObject({ cifraCalculada: 'KF', ok: false })
    expect(salida.segmentos).toHaveLength(1)
  })

  it('trae los mensajes de las filas que SAP rechazó', async () => {
    conFilas(10)
    readMessages.mockResolvedValue([{ Message: 'fuera de horizonte' }])

    await expect(migrarCifras({ ...comun, total: 10 })).resolves.toMatchObject({
      mensajes: [{ Message: 'fuera de horizonte' }],
    })
  })
})
