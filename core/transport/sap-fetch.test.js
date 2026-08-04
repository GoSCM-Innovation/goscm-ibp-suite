import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SapError, extractSapError, fetchCsrf, sapFetch } from './sap-fetch.js'
import { assertSapUrl } from './ssrf.js'

vi.mock('./ssrf.js', () => ({ assertSapUrl: vi.fn(async () => {}) }))

const URL_IBP = 'https://c-api.scmibp.ondemand.com/sap/opu/odata/IBP/MASTER_DATA_API_SRV/Producto'
const CREDENCIALES = { user: 'COM_0326', password: 'secreta' }

/** Respuesta falsa con la forma mínima que usa el transporte. */
function respuesta({ status = 200, body = '', headers = {}, setCookie = [] } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => lower[name.toLowerCase()] ?? null,
      getSetCookie: () => setCookie,
    },
    text: async () => body,
  }
}

const json = (obj, extra = {}) => respuesta({
  body: JSON.stringify(obj),
  headers: { 'content-type': 'application/json' },
  ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  assertSapUrl.mockResolvedValue(undefined)
})

describe('sapFetch — el camino normal', () => {
  it('devuelve el contenido y manda la autenticación', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ d: { results: [{ id: 1 }] } })))

    const result = await sapFetch({ url: URL_IBP, credentials: CREDENCIALES })

    expect(result.json).toEqual({ d: { results: [{ id: 1 }] } })
    const [, opciones] = fetch.mock.calls[0]
    expect(opciones.headers.Authorization).toBe(`Basic ${Buffer.from('COM_0326:secreta').toString('base64')}`)
  })

  it('pasa la URL por el portero antes de llamar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({})))
    await sapFetch({ url: URL_IBP, credentials: CREDENCIALES })
    expect(assertSapUrl).toHaveBeenCalledWith(URL_IBP, { kind: 'ibp' })
  })

  it('no llama si el portero rechaza la URL', async () => {
    vi.stubGlobal('fetch', vi.fn())
    assertSapUrl.mockRejectedValue(new Error('URL rechazada (Host no permitido)'))
    await expect(sapFetch({ url: URL_IBP, credentials: CREDENCIALES })).rejects.toThrow(/rechazada/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('no sigue redirecciones', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta({ status: 302 })))
    await sapFetch({ url: URL_IBP, credentials: CREDENCIALES }).catch(() => {})
    expect(fetch.mock.calls[0][1].redirect).toBe('manual')
  })

  it('revienta si SAP responde con una redirección', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta({ status: 302, headers: { location: 'http://10.0.0.1/' } })))
    await expect(sapFetch({ url: URL_IBP, credentials: CREDENCIALES })).rejects.toThrow(/redirección/)
  })

  it('exige credenciales', async () => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(sapFetch({ url: URL_IBP, credentials: { user: 'x' } })).rejects.toThrow(/credenciales/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('un cuerpo vacío en una respuesta correcta es válido, no una respuesta cortada', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta({ status: 200, headers: { 'content-type': 'application/json' } })))
    await expect(sapFetch({ url: URL_IBP, credentials: CREDENCIALES })).resolves.toMatchObject({ json: {} })
  })

  it('devuelve el XML tal cual cuando se pide XML', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta({ body: '<edmx/>', headers: { 'content-type': 'application/xml' } })))
    const result = await sapFetch({ url: URL_IBP, credentials: CREDENCIALES, expect: 'xml' })
    expect(result.text).toBe('<edmx/>')
    expect(result.json).toBeNull()
  })
})

describe('sapFetch — respuestas cortadas', () => {
  it('detecta que llegaron menos bytes de los anunciados y avisa de que se puede repetir', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta({
      body: '{"d":{"resu',
      headers: { 'content-type': 'application/json', 'content-length': '5000' },
    })))

    const error = await sapFetch({ url: URL_IBP, credentials: CREDENCIALES }).catch((e) => e)
    expect(error).toBeInstanceOf(SapError)
    expect(error.retryable).toBe(true)
    expect(error.detail).toMatch(/llegaron 11 de 5000/)
  })

  it('detecta el contenido incompleto aunque no se anuncie el tamaño', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta({
      body: '{"d":{"results":[{"a":1}',
      headers: { 'content-type': 'application/json' },
    })))
    const error = await sapFetch({ url: URL_IBP, credentials: CREDENCIALES }).catch((e) => e)
    expect(error.retryable).toBe(true)
    expect(error.detail).toMatch(/inválido o cortado/)
  })

  it('no confunde una respuesta comprimida con una cortada', async () => {
    // Comprimida: llegan MÁS bytes de los anunciados. No debe dar falso positivo.
    vi.stubGlobal('fetch', vi.fn(async () => json({ d: { results: [1, 2, 3] } }, { headers: { 'content-type': 'application/json', 'content-length': '5' } })))
    await expect(sapFetch({ url: URL_IBP, credentials: CREDENCIALES })).resolves.toBeTruthy()
  })

  it('un corte de red se marca como repetible', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket hang up') }))
    const error = await sapFetch({ url: URL_IBP, credentials: CREDENCIALES }).catch((e) => e)
    expect(error.retryable).toBe(true)
  })
})

describe('sapFetch — errores de SAP', () => {
  it('saca el mensaje del error en JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta({
      status: 400,
      body: JSON.stringify({ error: { code: 'SY/530', message: { lang: 'en', value: 'Add property UOMTOID' } } }),
    })))
    const error = await sapFetch({ url: URL_IBP, credentials: CREDENCIALES }).catch((e) => e)
    expect(error.status).toBe(400)
    expect(error.detail).toBe('[SY/530] Add property UOMTOID')
    expect(error.retryable).toBe(false)
  })

  it.each([[429, true], [500, true], [503, true], [400, false], [403, false], [404, false]])(
    'marca el %s como repetible=%s',
    async (status, retryable) => {
      vi.stubGlobal('fetch', vi.fn(async () => respuesta({ status, body: 'algo' })))
      const error = await sapFetch({ url: URL_IBP, credentials: CREDENCIALES }).catch((e) => e)
      expect(error.retryable).toBe(retryable)
    },
  )
})

describe('extractSapError', () => {
  it('lee el mensaje suelto en JSON', () => {
    expect(extractSapError(JSON.stringify({ error: { message: 'Roto' } }))).toBe('Roto')
  })

  it('lee el mensaje del XML', () => {
    expect(extractSapError('<error><code>A/1</code><message xml:lang="es">Fallo</message></error>'))
      .toBe('[A/1] Fallo')
  })

  it('si no reconoce nada, devuelve el principio del cuerpo', () => {
    expect(extractSapError('desastre sin formato')).toBe('desastre sin formato')
  })
})

describe('token de escritura', () => {
  it('lo pide una vez y lo reutiliza en el envío', async () => {
    const csrf = respuesta({ headers: { 'x-csrf-token': 'TOKEN-1' }, setCookie: ['SAP_SESSIONID=abc; path=/'] })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(csrf)
      .mockResolvedValueOnce(json({ d: {} })))

    await sapFetch({ url: URL_IBP, method: 'POST', body: { a: 1 }, credentials: CREDENCIALES, serviceRoot: 'https://c-api.scmibp.ondemand.com/sap/opu/odata/IBP/MASTER_DATA_API_SRV/' })

    expect(fetch).toHaveBeenCalledTimes(2)
    const [, envio] = fetch.mock.calls[1]
    expect(envio.headers['X-CSRF-Token']).toBe('TOKEN-1')
    expect(envio.headers.Cookie).toBe('SAP_SESSIONID=abc')
    expect(envio.body).toBe('{"a":1}')
  })

  it('si le dan el token no lo vuelve a pedir — es lo que evita un viaje por cada envío', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ d: {} })))
    await sapFetch({
      url: URL_IBP, method: 'POST', body: { a: 1 }, credentials: CREDENCIALES,
      csrf: { token: 'TOKEN-YA', cookies: 'SAP_SESSIONID=zzz' },
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1].headers['X-CSRF-Token']).toBe('TOKEN-YA')
  })

  it('una lectura no pide token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ d: {} })))
    await sapFetch({ url: URL_IBP, credentials: CREDENCIALES })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1].headers['X-CSRF-Token']).toBeUndefined()
  })

  it('revienta si SAP no entrega token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta({})))
    await expect(fetchCsrf({ serviceRoot: URL_IBP, credentials: CREDENCIALES }))
      .rejects.toThrow(/no entregó el token/)
  })
})
