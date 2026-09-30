import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../transport/sap-fetch.js', () => ({ sapFetch: vi.fn() }))

const { sapFetch } = await import('../transport/sap-fetch.js')
const {
  CONJUNTOS_DE_CONSUMO, entidadesDelServicio, meteringRoot, ordenEstable, readMetering, readMeteringSet,
  toMeteringTimestamp,
} = await import('./metering.js')
const { expandRows } = await import('./metering-rows.js')

const BASE = 'https://tenant-api.scmibp.ondemand.com'
const cred = { user: 'u', password: 'p' }

beforeEach(() => { sapFetch.mockReset() })

/** Un `$metadata` de v4 con la forma del de SAP: los tipos en el esquema, los conjuntos en el contenedor. */
function metadata(tipos) {
  const entidades = Object.entries(tipos).map(([nombre, { claves, campos }]) => `
    <EntityType Name="${nombre}Type">
      <Key>${claves.map(c => `<PropertyRef Name="${c}"/>`).join('')}</Key>
      ${campos.map(c => `<Property Name="${c}" Type="Edm.String"/>`).join('')}
      <NavigationProperty Name="_Nav" Type="SAP__self.OtroType"/>
    </EntityType>`).join('')
  const conjuntos = Object.keys(tipos)
    .map(nombre => `<EntitySet Name="${nombre}" EntityType="SAP__self.${nombre}Type"><NavigationPropertyBinding Path="_Nav" Target="Otro"/></EntitySet>`)
    .join('')
  return `<?xml version="1.0"?><edmx:Edmx Version="4.0"><edmx:DataServices><Schema Namespace="x" Alias="SAP__self">${entidades}<EntityContainer Name="Container">${conjuntos}</EntityContainer></Schema></edmx:DataServices></edmx:Edmx>`
}

/** El modelo completo: cada conjunto de v8 con una clave `ActivityID` y todos sus campos. */
function modeloCompleto(extra = {}) {
  return Object.fromEntries(CONJUNTOS_DE_CONSUMO.map(uno => [
    uno.entidad,
    { claves: ['ActivityID'], campos: ['ActivityID', ...uno.campos], ...extra[uno.entidad] },
  ]))
}

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

describe('entidadesDelServicio', () => {
  it('saca la clave y los campos de cada conjunto, pasando por su tipo', () => {
    const xml = metadata({ MtrgDashboard: { claves: ['ActivityID', 'UserID'], campos: ['ActivityID', 'UserID', 'Timestamp'] } })
    expect(entidadesDelServicio(xml)).toEqual({
      MtrgDashboard: { claves: ['ActivityID', 'UserID'], campos: ['ActivityID', 'UserID', 'Timestamp'] },
    })
  })

  it('un texto que no es un $metadata no da conjuntos', () => {
    expect(entidadesDelServicio('')).toEqual({})
  })
})

describe('ordenEstable', () => {
  it('ordena por la clave', () => {
    expect(ordenEstable(['ActivityID'])).toBe('ActivityID')
  })

  // `TotalDuration` se repite: sin la clave detrás, dos filas con la misma duración no desempatan.
  it('pone la clave detrás del orden pedido', () => {
    expect(ordenEstable(['ActivityID'], ['TotalDuration desc'])).toBe('TotalDuration desc,ActivityID')
  })

  it('no repite un campo que ya está en el orden', () => {
    expect(ordenEstable(['UserID', 'ActivityID'], ['UserID desc'])).toBe('UserID desc,ActivityID')
  })

  // Es una de las reglas de SAP del proyecto: paginar sin orden estable da solapes y huecos.
  it('sin clave se niega a paginar', () => {
    expect(() => ordenEstable([])).toThrow(/orden estable/)
    expect(() => ordenEstable(undefined)).toThrow(/orden estable/)
  })
})

describe('readMeteringSet', () => {
  const pedir = (extra = {}) => readMeteringSet({
    baseUrl: BASE, credentials: cred, entidad: 'MtrgActyExcelAddInLogon', campo: 'Timestamp',
    desde: '2026-07-09T12:00:00.500Z', hasta: '2026-08-08T12:00:00.500Z',
    claves: ['ActivityID'], campos: ['UserID', 'TotalDuration'], ...extra,
  })
  const url = (n = 0) => decodeURIComponent(sapFetch.mock.calls[n][0].url)

  it('filtra por el rango, sin fracción de segundo', async () => {
    sapFetch.mockResolvedValueOnce({ json: { value: [], '@odata.count': 0 } })
    await pedir()
    expect(url()).toContain('Timestamp ge 2026-07-09T12:00:00Z and Timestamp le 2026-08-08T12:00:00Z')
    expect(url()).not.toContain('.500Z')
  })

  it('pide solo los campos de la pantalla', async () => {
    sapFetch.mockResolvedValueOnce({ json: { value: [], '@odata.count': 0 } })
    await pedir()
    expect(url()).toContain('$select=UserID,TotalDuration')
  })

  it('un catálogo sin campo de fecha va sin filtro', async () => {
    sapFetch.mockResolvedValueOnce({ json: { value: [{ UserID: 'U1' }], '@odata.count': 1 } })
    await pedir({ entidad: 'MtrgActyBusinessUser', campo: undefined })
    expect(url()).not.toContain('$filter')
  })

  // El arreglo: antes se paginaba con `$skip` y sin ningún `$orderby`, y las páginas se solapaban.
  it('pagina con el MISMO orden estable en todas las páginas', async () => {
    sapFetch
      .mockResolvedValueOnce({ json: { value: Array(5000).fill({ x: 1 }), '@odata.count': 7000 } })
      .mockResolvedValueOnce({ json: { value: Array(2000).fill({ x: 1 }) } })

    const salida = await pedir({ orden: ['TotalDuration desc'] })
    expect(salida.filas).toHaveLength(7000)
    expect(salida.truncado).toBe(false)
    expect(url(0)).toContain('$orderby=TotalDuration desc,ActivityID')
    expect(url(1)).toContain('$orderby=TotalDuration desc,ActivityID')
    expect(url(1)).toContain('$skip=5000')
    expect(url(1)).not.toContain('$count')
  })

  it('sin clave no llega a pedir nada', async () => {
    await expect(pedir({ claves: [] })).rejects.toThrow(/orden estable/)
    expect(sapFetch).not.toHaveBeenCalled()
  })

  // v8 se quedaba con las primeras 1.000 de 15.623 y dibujaba el ranking con eso, sin avisar.
  it('al llegar al tope lo dice en vez de callarlo', async () => {
    sapFetch.mockResolvedValue({ json: { value: Array(100).fill({ x: 1 }), '@odata.count': 900 } })
    const salida = await pedir({ maxFilas: 100 })
    expect(salida).toMatchObject({ total: 900, truncado: true })
    expect(salida.filas).toHaveLength(100)
  })

  it('una página vacía corta el bucle', async () => {
    sapFetch.mockResolvedValueOnce({ json: { value: [], '@odata.count': 500 } })
    expect((await pedir()).filas).toEqual([])
    expect(sapFetch).toHaveBeenCalledTimes(1)
  })
})

describe('readMetering', () => {
  const leer = () => readMetering({ baseUrl: BASE, credentials: cred, desde: '2026-07-09T00:00:00Z', hasta: '2026-08-08T00:00:00Z' })

  /** SAP de mentira: el `$metadata` y, para cada conjunto, las filas que se le den. */
  function sap({ modelo = modeloCompleto(), filas = {}, falla = null } = {}) {
    sapFetch.mockImplementation(({ url }) => {
      if (url.endsWith('/$metadata')) return Promise.resolve({ text: metadata(modelo), json: null })
      const entidad = url.split('/').pop().split('?')[0]
      if (entidad === falla) return Promise.reject(Object.assign(new Error('SAP devolvió 403'), { status: 403 }))
      const lote = filas[entidad] ?? [{ UserID: 'U1' }]
      return Promise.resolve({ json: { value: lote, '@odata.count': lote.length } })
    })
  }
  const urlDe = entidad => decodeURIComponent(sapFetch.mock.calls.map(c => c[0].url).find(u => u.includes(`/${entidad}?`)))

  it('lee el $metadata y los diez conjuntos de v8, con sus nombres', async () => {
    sap()
    const { conjuntos, avisos } = await leer()
    expect(Object.keys(conjuntos)).toEqual([
      'overview', 'planningViews', 'logons', 'fiori', 'dashboards', 'stories', 'alerts', 'users', 'components', 'chgKeyFig',
    ])
    expect(avisos).toEqual([])
    expect(sapFetch.mock.calls[0][0]).toMatchObject({ url: `${meteringRoot(BASE)}/$metadata`, expect: 'xml' })
  })

  it('cada conjunto se pagina por la clave que declara el servicio', async () => {
    sap({ modelo: modeloCompleto({ MtrgDashboard: { claves: ['UserID', 'Timestamp'] } }) })
    await leer()
    expect(urlDe('MtrgDashboard')).toContain('$orderby=UserID,Timestamp')
    expect(urlDe('MtrgActyGroupOverview')).toContain('$orderby=ActivityID')
  })

  // v8 pedía las vistas de Excel de la más lenta a la más rápida; sus «Errores» dependen de eso.
  it('las vistas de Excel van de la más lenta a la más rápida', async () => {
    sap()
    await leer()
    expect(urlDe('MtrgActyExcelAddInPlanningView')).toContain('$orderby=TotalDuration desc,ActivityID')
  })

  // Pedir en `$select` un campo que el servicio no tiene hace que SAP rechace la consulta entera.
  it('pide solo los campos que el servicio declara', async () => {
    sap({ modelo: modeloCompleto({ MtrgActyExcelAddInLogon: { campos: ['ActivityID', 'UserID', 'TotalDuration'] } }) })
    const { conjuntos } = await leer()
    expect(urlDe('MtrgActyExcelAddInLogon')).toContain('$select=UserID,TotalDuration&')
    expect(conjuntos.logons.campos).toEqual(['UserID', 'TotalDuration'])
  })

  it('manda las filas compactadas, con el día de cada marca', async () => {
    sap({ filas: { MtrgActyAlertMonitor: [{ UserID: 'U1', PlanningAreaID: null, Timestamp: '2026-08-01T10:00:00Z' }] } })
    const { conjuntos } = await leer()
    expect(expandRows(conjuntos.alerts)).toEqual([{ UserID: 'U1', PlanningAreaID: null, Timestamp: '2026-08-01' }])
  })

  // Como en v8: con un conjunto vacío, la pantalla cruzaría datos y daría cifras que parecen buenas.
  it('un conjunto que falla tumba la lectura y se dice cuál', async () => {
    sap({ falla: 'MtrgActyAlertMonitor' })
    await expect(leer()).rejects.toMatchObject({ status: 403, message: 'MtrgActyAlertMonitor: SAP devolvió 403' })
  })

  it('un conjunto que el servicio no declara es un fallo, no una lista vacía', async () => {
    const modelo = modeloCompleto()
    delete modelo.MtrgMngAnalyticStory
    sap({ modelo })
    await expect(leer()).rejects.toThrow(/MtrgMngAnalyticStory/)
  })

  it('avisa del conjunto que pasó el tope', async () => {
    sapFetch.mockImplementation(({ url }) => {
      if (url.endsWith('/$metadata')) return Promise.resolve({ text: metadata(modeloCompleto()) })
      const muchas = url.includes('/MtrgGenericUIActionUsage?')
      return Promise.resolve({ json: { value: [{ UserID: 'U1' }], '@odata.count': muchas ? 30_000 : 1 } })
    })
    const { avisos } = await readMetering({ baseUrl: BASE, credentials: cred, desde: '2026-07-09T00:00:00Z', hasta: '2026-08-08T00:00:00Z', maxFilas: 1 })
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).toMatch(/MtrgGenericUIActionUsage.*1 de 30\.000/)
  })

  // Vercel corta en 4,5 MB con un error genérico; mejor decirlo claro.
  it('una respuesta demasiado grande da un mensaje claro', async () => {
    const enorme = Array.from({ length: 5000 }, (_, i) => ({ UserID: `U${i}`, FioriProjectTitle: 'x'.repeat(900) + i }))
    sap({ filas: { MtrgGenericUIActionUsage: enorme } })
    await expect(leer()).rejects.toThrow(/período más corto/)
  })
})
