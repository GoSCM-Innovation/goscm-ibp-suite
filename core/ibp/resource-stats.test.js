import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../transport/sap-fetch.js', () => ({ sapFetch: vi.fn() }))

const { sapFetch } = await import('../transport/sap-fetch.js')
const { readResourceStats, resourceRoot } = await import('./resource-stats.js')

const BASE = 'https://tenant-api.scmibp.ondemand.com'
const cred = { user: 'u', password: 'p' }
const AHORA = Date.parse('2026-08-08T12:00:00Z')

beforeEach(() => { sapFetch.mockReset() })

/** Una fila tal como la devuelve el servicio. */
const fila = (msDesdeElInicio, cpu, mem) => ({
  Timestamp: `/Date(${AHORA - 3600_000 + msDesdeElInicio}+0000)/`,
  CpuUsage: cpu,
  MemoryUsage: mem,
})

describe('resourceRoot', () => {
  it('arma la raíz sin duplicar la barra', () => {
    expect(resourceRoot(`${BASE}/`)).toBe(`${BASE}/sap/opu/odata/IBP/RES_CONS_STATS_API_SRV`)
  })
})

describe('readResourceStats', () => {
  it('filtra desde el arranque de la ventana pedida', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { results: [] } } })
    await readResourceStats({ baseUrl: BASE, credentials: cred, horas: 4, ahora: AHORA })

    const url = decodeURIComponent(sapFetch.mock.calls[0][0].url)
    expect(url).toContain("Timestamp gt datetimeoffset'2026-08-08T08:00:00.000Z'")
  })

  it('devuelve la serie y su resumen', async () => {
    sapFetch.mockResolvedValueOnce({
      json: { d: { results: [fila(0, '2.00', '35.60'), fila(600_000, '8.00', '40.00')] } },
    })

    const salida = await readResourceStats({ baseUrl: BASE, credentials: cred, horas: 4, ahora: AHORA })
    expect(salida.serie).toHaveLength(2)
    expect(salida.resumen).toMatchObject({ cpu: 8, mem: 40, cpuMax: 8, muestras: 2 })
  })

  // Con 4.320 puntos el gráfico es una mancha y la respuesta pesa; el navegador los promediaría igual.
  it('en treinta días agrupa por hora', async () => {
    const puntos = Array.from({ length: 6 }, (_, i) => fila(i * 600_000, '10.00', '20.00'))
    sapFetch.mockResolvedValueOnce({ json: { d: { results: puntos } } })

    const salida = await readResourceStats({ baseUrl: BASE, credentials: cred, horas: 720, ahora: AHORA })
    expect(salida.serie.length).toBeLessThan(puntos.length)
  })

  it('un tenant sin datos no es un error', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { results: [] } } })
    const salida = await readResourceStats({ baseUrl: BASE, credentials: cred, ahora: AHORA })
    expect(salida.serie).toEqual([])
    expect(salida.resumen.muestras).toBe(0)
  })

  it('un rango disparatado no llega a SAP', async () => {
    await expect(readResourceStats({ baseUrl: BASE, credentials: cred, horas: 'ayer' })).rejects.toThrow(/no es válido/)
    expect(sapFetch).not.toHaveBeenCalled()
  })
})
