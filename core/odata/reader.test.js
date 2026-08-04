import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createReader, defaultBackoff } from './reader.js'
import { SapError, sapFetch } from '../transport/sap-fetch.js'

vi.mock('../transport/sap-fetch.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, sapFetch: vi.fn() }
})

const CREDENCIALES = { user: 'COM_0326', password: 'secreta' }
const sinEspera = { backoffMs: () => 0 }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createReader', () => {
  it('devuelve el contenido de la respuesta', async () => {
    sapFetch.mockResolvedValue({ json: { d: { results: [1] } } })
    const read = createReader({ credentials: CREDENCIALES })
    await expect(read('https://x/y')).resolves.toEqual({ d: { results: [1] } })
    expect(sapFetch).toHaveBeenCalledWith({ url: 'https://x/y', credentials: CREDENCIALES, kind: 'ibp' })
  })

  it('repite una lectura cortada y devuelve el resultado bueno', async () => {
    sapFetch
      .mockRejectedValueOnce(new SapError('Respuesta incompleta de SAP', { retryable: true }))
      .mockRejectedValueOnce(new SapError('Respuesta incompleta de SAP', { retryable: true }))
      .mockResolvedValueOnce({ json: { ok: true } })

    const avisos = []
    const read = createReader({ credentials: CREDENCIALES, onRetry: (i) => avisos.push(i.attempt), ...sinEspera })

    await expect(read('https://x/y')).resolves.toEqual({ ok: true })
    expect(sapFetch).toHaveBeenCalledTimes(3)
    expect(avisos).toEqual([1, 2])
  })

  it('no repite un error que no se arregla repitiendo', async () => {
    sapFetch.mockRejectedValue(new SapError('SAP devolvió 400', { status: 400, retryable: false }))
    const read = createReader({ credentials: CREDENCIALES, ...sinEspera })
    await expect(read('https://x/y')).rejects.toThrow(/400/)
    expect(sapFetch).toHaveBeenCalledTimes(1)
  })

  it('se rinde tras agotar los reintentos y propaga el error', async () => {
    sapFetch.mockRejectedValue(new SapError('Respuesta incompleta de SAP', { retryable: true }))
    const read = createReader({ credentials: CREDENCIALES, retries: 2, ...sinEspera })
    await expect(read('https://x/y')).rejects.toThrow(/incompleta/)
    expect(sapFetch).toHaveBeenCalledTimes(3) // el intento original más dos repeticiones
  })

  it('un error que no viene del transporte se propaga sin reintentar', async () => {
    sapFetch.mockRejectedValue(new Error('algo raro'))
    const read = createReader({ credentials: CREDENCIALES, ...sinEspera })
    await expect(read('https://x/y')).rejects.toThrow(/algo raro/)
    expect(sapFetch).toHaveBeenCalledTimes(1)
  })

  it('la espera entre intentos crece y tiene techo', () => {
    expect([1, 2, 3, 4, 10].map(defaultBackoff)).toEqual([400, 800, 1600, 3200, 5000])
  })

  it('pasa el destino y el tiempo máximo al transporte', async () => {
    sapFetch.mockResolvedValue({ json: {} })
    const read = createReader({ credentials: CREDENCIALES, kind: 'cids', timeoutMs: 5000 })
    await read('https://x/y')
    expect(sapFetch).toHaveBeenCalledWith(expect.objectContaining({ kind: 'cids', timeoutMs: 5000 }))
  })
})
