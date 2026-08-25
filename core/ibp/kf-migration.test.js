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

// Lo que hacía el original y aquí no se hacía: acotar la lectura del origen a las filas que TIENEN
// valor. Un nivel de planificación es casi todo ceros; leerlo entero para copiar las pocas celdas con
// dato es la diferencia entre minutos y una tarde. Y escribir esos ceros no es inocuo: pisan con un
// cero lo que el destino ya tenía.
describe('la copia no arrastra las filas en cero', () => {
  it('el conteo acota primero a las filas con valor, y lo dice', async () => {
    countKf.mockResolvedValue(235)

    const plan = await contarLoQueSeCopia({
      ...comun, filtro: '(KF gt 0 or KF lt 0)', filtroBase: '',
    })

    expect(plan).toMatchObject({ total: 235, soloConValor: true })
    expect(countKf.mock.calls[0][0].filtro).toBe('(KF gt 0 or KF lt 0)')
    expect(countKf).toHaveBeenCalledTimes(1)
  })

  // Hay cifras a las que SAP no acepta ese predicado. El original volvía al filtro de todo antes que
  // dejar de poder copiar.
  it('si SAP rechaza ese filtro, cuenta sin él y avisa de por qué', async () => {
    countKf.mockRejectedValueOnce(Object.assign(new Error('no soportado'), { detail: 'Not supported' }))
    countKf.mockResolvedValueOnce(1594)

    const plan = await contarLoQueSeCopia({
      ...comun, filtro: '(KF gt 0 or KF lt 0)', filtroBase: "PRDID eq 'X'",
    })

    expect(plan).toMatchObject({ total: 1594, soloConValor: false, porQueTodo: 'Not supported' })
    expect(countKf.mock.calls[1][0].filtro).toBe("PRDID eq 'X'")
  })

  it('sin filtro de respaldo, el fallo del conteo se propaga', async () => {
    countKf.mockRejectedValue(new Error('SAP se cayó'))
    await expect(contarLoQueSeCopia({ ...comun, filtro: 'X' }))
      .rejects.toThrow('SAP se cayó')
  })

  it('una fila con todas las cifras en cero no se escribe', async () => {
    readKfPage.mockResolvedValueOnce([
      { PRDID: 'P1', PERIODID4_TSTAMP: '/Date(1)/', ADJUSTEDPRODUCTION: '10' },
      { PRDID: 'P2', PERIODID4_TSTAMP: '/Date(1)/', ADJUSTEDPRODUCTION: '0.000000' },
      { PRDID: 'P3', PERIODID4_TSTAMP: '/Date(1)/', ADJUSTEDPRODUCTION: '-4' },
    ])

    const salida = await migrarSegmentoDeCifras({ ...comun, cuantas: 10 })

    // Se leyeron tres y se escribieron dos. Las dos cuentas se dicen: `filas` es lo leído, de lo que
    // depende el `$skip` del segmento siguiente.
    expect(salida).toMatchObject({ ok: true, filas: 3, escritas: 2 })
    const enviadas = postKfChunk.mock.calls[0][0].filas
    expect(enviadas).toHaveLength(2)
    expect(enviadas.map((una) => una.PRDID)).toEqual(['P1', 'P3'])
  })

  // El caso que obliga a mirar «alguna» y no «todas»: el cero de esa fila es parte del dato.
  it('una fila con una cifra en cero y otra con valor sí se escribe', async () => {
    readKfPage.mockResolvedValueOnce([
      { PRDID: 'P1', PERIODID4_TSTAMP: '/Date(1)/', KFA: '0', KFB: '7' },
    ])

    const salida = await migrarSegmentoDeCifras({
      ...comun, cifras: ['KFA', 'KFB'], cuantas: 10,
    })

    expect(salida).toMatchObject({ ok: true, filas: 1, escritas: 1 })
  })

  // Si el segmento entero venía en ceros no hay nada que escribir, y NO es un fallo: hay que seguir
  // paginando desde donde se quedó, no darlo por agotado.
  it('un segmento entero en cero no escribe, no falla y no corta la paginación', async () => {
    readKfPage.mockResolvedValueOnce(Array.from({ length: 10 }, (_, i) => ({
      PRDID: `P${i}`, PERIODID4_TSTAMP: '/Date(1)/', ADJUSTEDPRODUCTION: '0',
    })))

    const salida = await migrarSegmentoDeCifras({ ...comun, cuantas: 10 })

    expect(salida).toMatchObject({ ok: true, filas: 10, escritas: 0, agotado: false })
    expect(getTransactionId).not.toHaveBeenCalled()
  })
})
