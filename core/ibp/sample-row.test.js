import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../transport/sap-fetch.js', () => ({ sapFetch: vi.fn() }))

const { sapFetch } = await import('../transport/sap-fetch.js')
const { formatIbpExample, readSampleRow } = await import('./sample-row.js')

describe('formatIbpExample', () => {
  it('una fecha de OData V2 se muestra legible', () => {
    expect(formatIbpExample('/Date(1735689600000)/')).toBe('2025-01-01')
  })

  it('un texto se muestra tal cual', () => {
    expect(formatIbpExample('FG-100')).toBe('FG-100')
  })

  it('un número se pasa a texto', () => {
    expect(formatIbpExample(42)).toBe('42')
    expect(formatIbpExample(0)).toBe('0')
  })

  // Una propiedad de navegación viene como objeto y no es un dato que mostrar.
  it('un objeto no se muestra', () => {
    expect(formatIbpExample({ __deferred: {} })).toBe('')
  })

  it('sin valor no muestra nada', () => {
    expect(formatIbpExample(null)).toBe('')
    expect(formatIbpExample(undefined)).toBe('')
  })
})

// El servicio y la entidad van pegados a la ruta y los campos al `$select`, con las credenciales de la
// conexión: lo que llega del navegador no puede armar otra consulta.
describe('readSampleRow — lo que se acepta', () => {
  const base = { baseUrl: 'https://t-api.scmibp1.ondemand.com', credentials: { user: 'u', password: 'p' }, planArea: 'PA1' }

  beforeEach(() => {
    vi.clearAllMocks()
    sapFetch.mockResolvedValue({ json: { d: { results: [{ ID: 'A' }] } } })
  })

  it('consulta con nombres normales', async () => {
    const salida = await readSampleRow({ ...base, service: 'MASTER_DATA_API_SRV', entitySet: 'SBPRODUCT', selectFields: ['PRDID', 'PRDDESCR'] })
    expect(salida.row).toEqual({ ID: 'A' })
    expect(sapFetch.mock.calls[0][0].url).toContain('/IBP/MASTER_DATA_API_SRV/SBPRODUCT?')
    expect(sapFetch.mock.calls[0][0].url).toContain('$select=PRDID,PRDDESCR')
  })

  it('un servicio que no es uno de los dos no se consulta', async () => {
    const salida = await readSampleRow({ ...base, service: '../OTRO_SRV', entitySet: 'SBPRODUCT' })
    expect(salida).toEqual({ row: null, detail: 'servicio no válido' })
    expect(sapFetch).not.toHaveBeenCalled()
  })

  it('una entidad que cambiaría la ruta o los parámetros no se consulta', async () => {
    for (const entitySet of ['X/../Y', 'X?$expand=Z', 'X&top=1']) {
      const salida = await readSampleRow({ ...base, service: 'MASTER_DATA_API_SRV', entitySet })
      expect(salida.row, entitySet).toBeNull()
    }
    expect(sapFetch).not.toHaveBeenCalled()
  })

  it('un campo raro se descarta y el resto se consulta', async () => {
    await readSampleRow({ ...base, service: 'MASTER_DATA_API_SRV', entitySet: 'SBPRODUCT', selectFields: ['PRDID', 'A,B', 'X&Y=1'] })
    expect(sapFetch.mock.calls[0][0].url).toContain('$select=PRDID&')
    expect(sapFetch.mock.calls[0][0].url).not.toContain('Y=1')
  })
})
