import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../transport/sap-fetch.js', () => ({ sapFetch: vi.fn() }))

const { sapFetch } = await import('../transport/sap-fetch.js')
const { meteringRoot, readMetering, readMeteringSet, toMeteringTimestamp } = await import('./metering.js')

const BASE = 'https://tenant-api.scmibp.ondemand.com'
const cred = { user: 'u', password: 'p' }

beforeEach(() => { sapFetch.mockReset() })

describe('toMeteringTimestamp', () => {
  // Con la fracción, SAP contesta 500: "violates facet information 'Precision'".
  it('recorta la fracción de segundo', () => {
    expect(toMeteringTimestamp(new Date('2026-08-08T12:00:00.855Z'))).toBe('2026-08-08T12:00:00Z')
  })

  it('acepta una fecha ya escrita', () => {
    expect(toMeteringTimestamp('2026-08-08T12:00:00.000Z')).toBe('2026-08-08T12:00:00Z')
  })

  it('una fecha inválida no llega a SAP', () => {
    expect(() => toMeteringTimestamp('ayer')).toThrow(/inválida/)
  })
})

describe('meteringRoot', () => {
  it('arma la raíz de v4 sin duplicar la barra', () => {
    expect(meteringRoot(`${BASE}/`)).toBe(`${BASE}/sap/opu/odata4/ibp/api_meteringactivity/srvd_a2x/ibp/api_meteringactivity/0001`)
  })
})

describe('readMeteringSet', () => {
  const pedir = (entidad = 'MtrgActyExcelAddInLogon', extra = {}) => readMeteringSet({
    baseUrl: BASE, credentials: cred, entidad, campo: 'Timestamp',
    desde: '2026-07-09T12:00:00.500Z', hasta: '2026-08-08T12:00:00.500Z', ...extra,
  })

  it('filtra por el rango, sin fracción de segundo', async () => {
    sapFetch.mockResolvedValueOnce({ json: { value: [], '@odata.count': 0 } })
    await pedir()

    const url = decodeURIComponent(sapFetch.mock.calls[0][0].url)
    expect(url).toContain('Timestamp ge 2026-07-09T12:00:00Z and Timestamp le 2026-08-08T12:00:00Z')
    expect(url).not.toContain('.500Z')
  })

  it('un catálogo sin campo de fecha va sin filtro', async () => {
    sapFetch.mockResolvedValueOnce({ json: { value: [{ UserID: 'U1' }], '@odata.count': 1 } })
    await pedir('MtrgActyBusinessUser', { campo: undefined })
    expect(sapFetch.mock.calls[0][0].url).not.toContain('$filter')
  })

  // El servicio devuelve como mucho 5.000 filas aunque se pida más.
  it('pagina hasta traer el total', async () => {
    sapFetch
      .mockResolvedValueOnce({ json: { value: Array(5000).fill({ x: 1 }), '@odata.count': 7000 } })
      .mockResolvedValueOnce({ json: { value: Array(2000).fill({ x: 1 }) } })

    const salida = await pedir()
    expect(salida.filas).toHaveLength(7000)
    expect(salida.truncado).toBe(false)
    expect(sapFetch.mock.calls[1][0].url).toContain('$skip=5000')
  })

  // v8 se quedaba con las primeras 1.000 de 15.623 y dibujaba el ranking con eso, sin avisar.
  it('al llegar al tope lo dice en vez de callarlo', async () => {
    sapFetch.mockResolvedValue({ json: { value: Array(100).fill({ x: 1 }), '@odata.count': 900 } })
    const salida = await pedir('MtrgGenericUIActionUsage', { maxFilas: 100 })
    expect(salida).toMatchObject({ total: 900, truncado: true })
    expect(salida.filas).toHaveLength(100)
  })

  // Mirar a una persona baja de 15.623 filas a 4.397 en el tenant de pruebas: el filtro vale la pena.
  it('acota a un usuario y a un área del lado de SAP', async () => {
    sapFetch.mockResolvedValueOnce({ json: { value: [], '@odata.count': 0 } })
    await pedir('MtrgActyExcelAddInPlanningView', { usuario: 'CB89', area: 'ASIBPTS' })

    const url = decodeURIComponent(sapFetch.mock.calls[0][0].url)
    expect(url).toContain("UserID eq 'CB89'")
    expect(url).toContain("PlanningAreaID eq 'ASIBPTS'")
  })

  // Saber a quién NO se vio en el período exige la lista entera, no la de quienes sí aparecieron.
  it('los catálogos no se acotan al contexto', async () => {
    sapFetch.mockResolvedValueOnce({ json: { value: [], '@odata.count': 0 } })
    await pedir('MtrgActyBusinessUser', { campo: undefined, usuario: 'CB89', sinContexto: true })
    expect(sapFetch.mock.calls[0][0].url).not.toContain('$filter')
  })

  // Una comilla sin escapar cambiaría el filtro entero.
  it('escapa las comillas del contexto', async () => {
    sapFetch.mockResolvedValueOnce({ json: { value: [], '@odata.count': 0 } })
    await pedir('MtrgActyExcelAddInPlanningView', { usuario: "O'Brien" })
    expect(decodeURIComponent(sapFetch.mock.calls[0][0].url)).toContain("UserID eq 'O''Brien'")
  })

  it('una página vacía corta el bucle', async () => {
    sapFetch.mockResolvedValueOnce({ json: { value: [], '@odata.count': 500 } })
    expect((await pedir()).filas).toEqual([])
    expect(sapFetch).toHaveBeenCalledTimes(1)
  })
})

describe('readMetering', () => {
  it('lee los ocho conjuntos y los devuelve por su clave', async () => {
    sapFetch.mockResolvedValue({ json: { value: [{ UserID: 'U1' }], '@odata.count': 1 } })

    const { datos, avisos } = await readMetering({ baseUrl: BASE, credentials: cred, desde: '2026-07-09T00:00:00Z', hasta: '2026-08-08T00:00:00Z' })
    expect(Object.keys(datos)).toEqual([
      'sesiones', 'vistas', 'entradas', 'aplicaciones', 'alertas', 'cifras',
      'tableros', 'historias', 'usuarios', 'componentes',
    ])
    expect(avisos).toEqual([])
  })

  // Que el tenant no tenga historias analíticas no es motivo para dejar la pestaña en blanco.
  it('un conjunto que falla no tumba a los demás', async () => {
    sapFetch.mockImplementation(({ url }) => (url.includes('MtrgActyAlertMonitor')
      ? Promise.reject(Object.assign(new Error('no autorizado'), { status: 403 }))
      : Promise.resolve({ json: { value: [{ UserID: 'U1' }], '@odata.count': 1 } })))

    const { datos, avisos } = await readMetering({ baseUrl: BASE, credentials: cred, desde: '2026-07-09T00:00:00Z', hasta: '2026-08-08T00:00:00Z' })
    expect(datos.alertas).toEqual([])
    expect(datos.vistas).toHaveLength(1)
    expect(avisos.join(' ')).toMatch(/MtrgActyAlertMonitor/)
  })
})
