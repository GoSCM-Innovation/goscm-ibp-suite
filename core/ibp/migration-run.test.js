import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./master-data.js', () => ({ readEntityPage: vi.fn() }))
vi.mock('./master-data-write.js', async (real) => ({
  ...(await real()),
  abrirSesionDeEscritura: vi.fn(),
  commitTransaction: vi.fn(),
  getTransactionId: vi.fn(),
  initiateParallelProcess: vi.fn(),
  postTransChunk: vi.fn(),
  readMessages: vi.fn(),
  waitForProcessed: vi.fn(),
}))

const { readEntityPage } = await import('./master-data.js')
const {
  abrirSesionDeEscritura, commitTransaction, getTransactionId,
  initiateParallelProcess, postTransChunk, readMessages, waitForProcessed,
} = await import('./master-data-write.js')
const {
  FILAS_POR_SEGMENTO, INTENTOS_POR_SEGMENTO, migrarSegmento, migrarTabla,
} = await import('./migration-run.js')

const origen = { baseUrl: 'https://a', credentials: { user: 'a' }, planningArea: 'PA1', versionId: 'V1' }
const destino = { baseUrl: 'https://b', credentials: { user: 'b' }, planningArea: 'PA2', versionId: 'V2' }

const comun = {
  origen, destino, entidad: 'GIDPRODUCT', entidadDestino: 'AS1PRODUCT',
  columnas: ['PRDID', 'BRAND'], claves: ['PRDID'],
}

/** Devuelve `n` filas repartidas en páginas de `porPagina`. */
function conFilas(n) {
  let servidas = 0
  readEntityPage.mockImplementation(({ top }) => {
    const cuantas = Math.max(0, Math.min(top, n - servidas))
    servidas += cuantas
    return Promise.resolve(Array.from({ length: cuantas }, (_, i) => ({ PRDID: String(servidas - cuantas + i) })))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  abrirSesionDeEscritura.mockResolvedValue({ token: 't', cookies: 'c' })
  getTransactionId.mockImplementation(() => Promise.resolve(`TX${getTransactionId.mock.calls.length}`))
  initiateParallelProcess.mockResolvedValue(null)
  postTransChunk.mockResolvedValue({})
  commitTransaction.mockResolvedValue({})
  waitForProcessed.mockResolvedValue('PROCESADA')
  readMessages.mockResolvedValue([])
})

describe('migrarTabla', () => {
  it('lee del origen y escribe en el destino, con sus nombres respectivos', async () => {
    conFilas(10)
    const salida = await migrarTabla({ ...comun, total: 10 })

    expect(readEntityPage.mock.calls[0][0]).toMatchObject({ entidad: 'GIDPRODUCT', select: ['PRDID', 'BRAND'], orderby: ['PRDID'] })
    expect(postTransChunk.mock.calls[0][0]).toMatchObject({ entidad: 'AS1PRODUCT' })
    expect(salida).toMatchObject({ copiadas: 10, ok: true })
  })

  it('abre la sesión de escritura una sola vez', async () => {
    conFilas(10)
    await migrarTabla({ ...comun, total: 10 })
    expect(abrirSesionDeEscritura).toHaveBeenCalledTimes(1)
  })

  // Sin segmentos, un tropiezo en la fila 300.000 tira las 299.999 anteriores.
  it('parte en segmentos y confirma cada uno', async () => {
    conFilas(FILAS_POR_SEGMENTO + 100)
    const salida = await migrarTabla({ ...comun, total: FILAS_POR_SEGMENTO + 100 })

    expect(salida.segmentos).toHaveLength(2)
    expect(commitTransaction).toHaveBeenCalledTimes(2)
    expect(getTransactionId).toHaveBeenCalledTimes(2)
  })

  // Reenviar dentro de la transacción vieja duplicaría claves; en una nueva es seguro.
  it('un fallo al escribir rehace el segmento en una transacción NUEVA', async () => {
    conFilas(10)
    postTransChunk.mockRejectedValueOnce(new Error('tiempo agotado'))

    const salida = await migrarTabla({ ...comun, total: 10 })
    expect(getTransactionId).toHaveBeenCalledTimes(2)
    expect(salida).toMatchObject({ ok: true, copiadas: 10 })
  })

  it('tras agotar los intentos, el segmento queda marcado como fallado', async () => {
    conFilas(10)
    postTransChunk.mockRejectedValue(new Error('no hay caso'))

    const salida = await migrarTabla({ ...comun, total: 10 })
    expect(getTransactionId).toHaveBeenCalledTimes(INTENTOS_POR_SEGMENTO)
    expect(salida).toMatchObject({ ok: false, copiadas: 0 })
    expect(salida.segmentos[0]).toMatchObject({ ok: false, fase: 'escritura' })
  })

  // Una migración de veinte tablas no debe pararse entera por una.
  it('un fallo de lectura no lanza: sale en el resultado', async () => {
    readEntityPage.mockRejectedValue(Object.assign(new Error('SAP'), { detail: 'se cayó' }))

    const salida = await migrarTabla({ ...comun, total: 10 })
    expect(salida.ok).toBe(false)
    expect(salida.segmentos[0]).toMatchObject({ fase: 'lectura', error: 'se cayó' })
    expect(postTransChunk).not.toHaveBeenCalled()
  })

  it('una tabla que devuelve menos filas de las contadas no se cuelga', async () => {
    conFilas(3)
    const salida = await migrarTabla({ ...comun, total: 1000 })
    expect(salida.copiadas).toBe(3)
  })

  it('un borrado se propaga a los envíos', async () => {
    conFilas(5)
    await migrarTabla({ ...comun, total: 5, borrar: true })
    expect(postTransChunk.mock.calls[0][0].borrar).toBe(true)
  })

  it('cuenta lo que pasa para que la pantalla pueda seguirlo', async () => {
    conFilas(5)
    const eventos = []
    await migrarTabla({ ...comun, total: 5, onProgreso: (uno) => eventos.push(uno.fase) })

    expect(eventos).toContain('leyendo')
    expect(eventos).toContain('enviando')
    expect(eventos).toContain('confirmando')
    expect(eventos).toContain('procesada')
  })

  it('trae los mensajes de las filas que SAP rechazó', async () => {
    conFilas(5)
    readMessages.mockResolvedValue([{ Message: 'clave duplicada' }])

    const salida = await migrarTabla({ ...comun, total: 5 })
    expect(salida.mensajes).toHaveLength(1)
  })

  // Que no se puedan leer los mensajes no cambia lo que se copió.
  it('un fallo al leer los mensajes no invalida la carga', async () => {
    conFilas(5)
    readMessages.mockRejectedValue(new Error('no se pudo'))

    const salida = await migrarTabla({ ...comun, total: 5 })
    expect(salida).toMatchObject({ ok: true, copiadas: 5, mensajes: [] })
  })

  it('una tabla vacía no manda nada a SAP', async () => {
    conFilas(0)
    const salida = await migrarTabla({ ...comun, total: 0 })
    expect(salida).toMatchObject({ copiadas: 0, ok: true })
    expect(postTransChunk).not.toHaveBeenCalled()
  })
})

describe('migrarSegmento', () => {
  // Es la unidad que cabe en una función serverless: quien llama encadena.
  it('copia solo la ventana pedida y dice si la tabla se acabó', async () => {
    conFilas(1000)
    const segmento = await migrarSegmento({ ...comun, desde: 0, cuantas: 500 })

    expect(segmento).toMatchObject({ desde: 0, filas: 500, ok: true, agotado: false })
    expect(readEntityPage.mock.calls[0][0].skip).toBe(0)
  })

  it('marca agotado cuando llegan menos filas de las pedidas', async () => {
    conFilas(30)
    await expect(migrarSegmento({ ...comun, desde: 0, cuantas: 500 }))
      .resolves.toMatchObject({ filas: 30, agotado: true })
  })

  it('arranca donde se le diga', async () => {
    conFilas(1000)
    await migrarSegmento({ ...comun, desde: 500, cuantas: 500 })
    expect(readEntityPage.mock.calls[0][0].skip).toBe(500)
  })

  // Encadenando segmentos, abrir la sesión en cada llamada sería un viaje de más por segmento.
  it('reutiliza la sesión de escritura si se le pasa', async () => {
    conFilas(10)
    await migrarSegmento({ ...comun, cuantas: 10, csrf: { token: 't', cookies: 'c' } })
    expect(abrirSesionDeEscritura).not.toHaveBeenCalled()
  })

  it('un segmento que falla no lanza', async () => {
    conFilas(10)
    postTransChunk.mockRejectedValue(new Error('no hay caso'))
    await expect(migrarSegmento({ ...comun, cuantas: 10 }))
      .resolves.toMatchObject({ ok: false, fase: 'escritura' })
  })
})
