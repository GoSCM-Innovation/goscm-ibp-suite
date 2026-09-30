import { describe, it, expect, vi, beforeEach } from 'vitest'

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

const {
  abrirSesionDeEscritura, commitTransaction, getTransactionId,
  initiateParallelProcess, postKfChunk, readMessages, waitForProcessed,
} = await import('./planning-data-write.js')
const { ESPERA_DE_EDICION_MS, escribirCifrasEditadas } = await import('./planning-data-edit-run.js')

const ctx = { baseUrl: 'https://t', credentials: { user: 'u' }, area: 'ASIBPTS' }
const campos = ['PRDID', 'KFA', 'PERIODID4_TSTAMP']
const filas = [{ PRDID: 'P1', KFA: '5', PERIODID4_TSTAMP: '2026-01-01T00:00:00' }]

beforeEach(() => {
  vi.clearAllMocks()
  abrirSesionDeEscritura.mockResolvedValue({ token: 't', cookies: 'c' })
  getTransactionId.mockResolvedValue('TX1')
  initiateParallelProcess.mockResolvedValue(null)
  postKfChunk.mockResolvedValue({})
  commitTransaction.mockResolvedValue({})
  waitForProcessed.mockResolvedValue('PROCESADA')
  readMessages.mockResolvedValue([])
})

describe('escribirCifrasEditadas', () => {
  it('hace el ciclo completo en UNA transacción, sin confirmar en el envío', async () => {
    const salida = await escribirCifrasEditadas({ ...ctx, versionId: 'V1', campos, cifras: ['KFA'], filas })

    expect(getTransactionId).toHaveBeenCalledTimes(1)
    expect(postKfChunk).toHaveBeenCalledTimes(1)
    expect(postKfChunk.mock.calls[0][0]).toMatchObject({
      area: 'ASIBPTS', transactionId: 'TX1', campos, versionId: 'V1', confirmarYa: false, filas,
    })
    expect(commitTransaction).toHaveBeenCalledTimes(1)
    expect(initiateParallelProcess.mock.calls[0][0]).toMatchObject({ nombre: 'IBP-Viewer-KF-EDIT', versionId: 'V1' })
    expect(salida).toEqual({ transactionId: 'TX1', estado: 'PROCESADA', mensajes: [], filas: 1 })
  })

  it('espera dos minutos como mucho, como v8', async () => {
    await escribirCifrasEditadas({ ...ctx, campos, cifras: ['KFA'], filas })
    expect(waitForProcessed.mock.calls[0][0].timeoutMs).toBe(ESPERA_DE_EDICION_MS)
    expect(ESPERA_DE_EDICION_MS).toBe(120_000)
  })

  // El tope es de VALORES por envío: 2.500 filas de una key figure, 1.250 de dos.
  it('parte en envíos según los valores, no las filas', async () => {
    const muchas = Array.from({ length: 2600 }, (_, i) => ({ PRDID: `P${i}`, KFA: '1', KFB: '2', PERIODID4_TSTAMP: 'x' }))
    await escribirCifrasEditadas({ ...ctx, campos, cifras: ['KFA', 'KFB'], filas: muchas })
    expect(postKfChunk).toHaveBeenCalledTimes(3)
    expect(postKfChunk.mock.calls[0][0].filas).toHaveLength(1250)
  })

  // Repetir un envío ya preparado duplicaría valores dentro de la transacción.
  it('un envío que falla NO se repite y no se confirma nada', async () => {
    postKfChunk.mockRejectedValueOnce(Object.assign(new Error('La cifra «KFA» es calculada'), { cifraCalculada: 'KFA' }))
    await expect(escribirCifrasEditadas({ ...ctx, campos, cifras: ['KFA'], filas })).rejects.toMatchObject({ cifraCalculada: 'KFA' })
    expect(postKfChunk).toHaveBeenCalledTimes(1)
    expect(commitTransaction).not.toHaveBeenCalled()
  })

  it('sin token de escritura ni paralelo, escribe igual', async () => {
    abrirSesionDeEscritura.mockRejectedValueOnce(new Error('sin token'))
    initiateParallelProcess.mockRejectedValueOnce(Object.assign(new Error('500'), { status: 500 }))
    await escribirCifrasEditadas({ ...ctx, campos, cifras: ['KFA'], filas })
    expect(postKfChunk.mock.calls[0][0].csrf).toBeNull()
    expect(commitTransaction).toHaveBeenCalledTimes(1)
  })

  it('devuelve los mensajes de SAP, y si no se pueden leer, ninguno', async () => {
    readMessages.mockResolvedValueOnce([{ Severity: 'E', Message: 'rechazada' }])
    await expect(escribirCifrasEditadas({ ...ctx, campos, cifras: ['KFA'], filas }))
      .resolves.toMatchObject({ mensajes: [{ Severity: 'E' }] })

    readMessages.mockRejectedValueOnce(new Error('no'))
    await expect(escribirCifrasEditadas({ ...ctx, campos, cifras: ['KFA'], filas }))
      .resolves.toMatchObject({ mensajes: [] })
  })

  it('sin filas no abre ninguna transacción', async () => {
    await expect(escribirCifrasEditadas({ ...ctx, campos, cifras: ['KFA'], filas: [] })).rejects.toThrow()
    expect(getTransactionId).not.toHaveBeenCalled()
  })
})
