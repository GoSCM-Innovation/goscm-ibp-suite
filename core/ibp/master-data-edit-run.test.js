import { describe, it, expect, vi, beforeEach } from 'vitest'

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

const {
  abrirSesionDeEscritura, commitTransaction, getTransactionId,
  initiateParallelProcess, postTransChunk, readMessages, waitForProcessed,
} = await import('./master-data-write.js')
const { escribirDatoMaestro } = await import('./master-data-edit-run.js')

const ctx = { baseUrl: 'https://t', credentials: { user: 'u' }, entidad: 'GIDPRODUCT' }

beforeEach(() => {
  vi.clearAllMocks()
  abrirSesionDeEscritura.mockResolvedValue({ token: 't', cookies: 'c' })
  getTransactionId.mockResolvedValue('TX1')
  initiateParallelProcess.mockResolvedValue(null)
  postTransChunk.mockResolvedValue({})
  commitTransaction.mockResolvedValue({})
  waitForProcessed.mockResolvedValue('PROCESADA')
  readMessages.mockResolvedValue([])
})

describe('escribirDatoMaestro', () => {
  const filas = [{ PRDID: 'P1', BRAND: 'NUEVA' }]

  it('hace el ciclo completo en UNA transacción', async () => {
    const salida = await escribirDatoMaestro({ ...ctx, filas, versionId: 'V1' })

    expect(getTransactionId).toHaveBeenCalledTimes(1)
    expect(commitTransaction).toHaveBeenCalledTimes(1)
    expect(salida).toMatchObject({ transactionId: 'TX1', estado: 'PROCESADA', ok: true, filas: 1 })
  })

  it('modifica cuando no se le pide borrar', async () => {
    await escribirDatoMaestro({ ...ctx, filas })
    expect(postTransChunk.mock.calls[0][0].borrar).toBe(false)
  })

  // Una transacción no puede mezclar borrado y modificación: SAP lo rechaza.
  it('borra cuando se le pide, en la misma transacción', async () => {
    await escribirDatoMaestro({ ...ctx, filas, borrar: true })

    expect(postTransChunk.mock.calls.every((una) => una[0].borrar === true)).toBe(true)
    expect(getTransactionId).toHaveBeenCalledTimes(1)
  })

  // Un rechazo de SAP no es un éxito silencioso: la pantalla tiene que poder decirlo.
  it('con mensajes de rechazo NO se da por bueno', async () => {
    readMessages.mockResolvedValue([{ Message: 'clave duplicada' }])

    const salida = await escribirDatoMaestro({ ...ctx, filas })
    expect(salida).toMatchObject({ ok: false })
    expect(salida.mensajes).toHaveLength(1)
  })

  it('un estado que no es PROCESADA no se da por bueno', async () => {
    waitForProcessed.mockResolvedValue('CON_ERROR')
    await expect(escribirDatoMaestro({ ...ctx, filas })).resolves.toMatchObject({ ok: false })
  })

  // Un tenant sin ese endpoint no puede dejar la edición marcada como fallida para siempre.
  it('sin soporte para consultar el estado se da por bueno si no hay mensajes', async () => {
    waitForProcessed.mockResolvedValue('SIN_SOPORTE')
    await expect(escribirDatoMaestro({ ...ctx, filas })).resolves.toMatchObject({ ok: true })
  })

  it('que no se puedan leer los mensajes no invalida la escritura', async () => {
    readMessages.mockRejectedValue(new Error('no se pudo'))
    await expect(escribirDatoMaestro({ ...ctx, filas })).resolves.toMatchObject({ ok: true, mensajes: [] })
  })

  it('sin filas no llega a SAP', async () => {
    await expect(escribirDatoMaestro({ ...ctx, filas: [] })).rejects.toThrow(/ninguna fila/)
    expect(getTransactionId).not.toHaveBeenCalled()
  })
})
