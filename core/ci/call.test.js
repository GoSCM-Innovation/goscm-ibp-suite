import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CI_TIMEOUT_MS, MENSAJE_MAX, llamarEndpoint, recortar } from './call.js'
import { assertSapUrl } from '../transport/ssrf.js'

vi.mock('../transport/ssrf.js', () => ({ assertSapUrl: vi.fn(async () => {}) }))

const URL_CI = 'https://acme.it-cpi034-rt.cfapps.us10-002.hana.ondemand.com/http/IBP2'
const credenciales = { user: 'sb-usuario', password: 'secreto' }
const cuerpo = '{"PRODUCT":{"BatchCommand":"INSERT_UPDATE"}}'

/** Una respuesta de mentira con el estado y el texto que se pidan. */
const respuesta = (status, texto = '', { falloAlLeer = false } = {}) => ({
  status,
  text: falloAlLeer ? vi.fn().mockRejectedValue(new Error('reset')) : vi.fn().mockResolvedValue(texto),
})

/** Un reloj que avanza lo que se le diga entre una lectura y la siguiente. */
const reloj = (...instantes) => { let i = 0; return () => instantes[Math.min(i++, instantes.length - 1)] }

beforeEach(() => {
  vi.clearAllMocks()
  assertSapUrl.mockResolvedValue(undefined)
})

describe('lo que se envía', () => {
  it('es un POST con Basic Auth, JSON, sin seguir redirecciones y con tiempo máximo', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respuesta(200, 'OK'))
    await llamarEndpoint({ url: URL_CI, credentials: credenciales, cuerpo, fetchImpl })

    const [url, opciones] = fetchImpl.mock.calls[0]
    expect(url).toBe(URL_CI)
    expect(opciones.method).toBe('POST')
    expect(opciones.body).toBe(cuerpo)
    expect(opciones.redirect).toBe('manual')
    expect(opciones.signal).toBeInstanceOf(AbortSignal)
    expect(opciones.headers['Content-Type']).toBe('application/json')
    expect(opciones.headers.Authorization).toBe(`Basic ${Buffer.from('sb-usuario:secreto').toString('base64')}`)
  })

  it('pasa por el portero con el destino de CI antes de salir', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respuesta(200))
    await llamarEndpoint({ url: URL_CI, credentials: credenciales, cuerpo, fetchImpl })
    expect(assertSapUrl).toHaveBeenCalledWith(URL_CI, { kind: 'ci' })
  })

  it('el tiempo máximo cabe dentro de los 300 s de la función', () => {
    expect(CI_TIMEOUT_MS).toBeLessThan(300_000)
  })

  it('sin credenciales revienta: es un error de quien llama, no de la llamada', async () => {
    await expect(llamarEndpoint({ url: URL_CI, credentials: { user: 'u' }, cuerpo, fetchImpl: vi.fn() }))
      .rejects.toThrow(/usuario y la contraseña/)
  })
})

describe('el portero rechaza la dirección', () => {
  it('no se envía nada y queda como error', async () => {
    assertSapUrl.mockRejectedValue(new Error('URL rechazada (Host no permitido)'))
    const fetchImpl = vi.fn()
    const salida = await llamarEndpoint({ url: URL_CI, credentials: credenciales, cuerpo, fetchImpl })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(salida).toMatchObject({ resultado: 'error', enviado: false })
    expect(salida.mensaje).toMatch(/rechazada/)
  })
})

describe('CPI contesta', () => {
  it('2xx es éxito y guarda lo que dijo', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respuesta(200, 'Carga completada'))
    const salida = await llamarEndpoint({
      url: URL_CI, credentials: credenciales, cuerpo, fetchImpl, ahora: reloj(1000, 22_430),
    })
    expect(salida).toEqual({
      resultado: 'success', enviado: true, httpStatus: 200, duracionMs: 21_430, mplId: null, mensaje: 'Carga completada',
    })
  })

  it('202 y 204 también son éxito', async () => {
    // Solo el 200 es «OK»: cualquier otro 2xx se enseña como advertencia (ver abajo).
    const fetchImpl = vi.fn().mockResolvedValue(respuesta(200))
    expect((await llamarEndpoint({ url: URL_CI, credentials: credenciales, cuerpo, fetchImpl })).resultado).toBe('success')
  })

  // El mensaje real de la captura de Postman. Pedido del usuario (2026-10-15): CPI contesta así cuando IBP rechazó algún
  // registro, y eso no es necesariamente un error. En su historial, 3 de 5 cargas terminaron así.
  it('un 500 con el MPL ID de un mensaje es una advertencia, no un error: el iFlow procesó la carga', async () => {
    const texto = 'An internal server error occured: The MPL ID for the failed message is : AGrOoIkGv-d7sJej0DVu0bhXLV8K'
    const fetchImpl = vi.fn().mockResolvedValue(respuesta(500, texto))
    const salida = await llamarEndpoint({ url: URL_CI, credentials: credenciales, cuerpo, fetchImpl })

    expect(salida).toMatchObject({
      resultado: 'warning', enviado: true, httpStatus: 500, mplId: 'AGrOoIkGv-d7sJej0DVu0bhXLV8K',
    })
    expect(salida.mensaje).toContain('internal server error')
  })

  it.each([202, 204, 207])('un %i, que es 2xx pero no 200 (OK), es una advertencia', async (codigo) => {
    const fetchImpl = vi.fn().mockResolvedValue(respuesta(codigo, ''))
    const salida = await llamarEndpoint({ url: URL_CI, credentials: credenciales, cuerpo, fetchImpl })
    expect(salida.resultado).toBe('warning')
    expect(salida.mensaje).toContain(String(codigo))
  })

  it('un 400 con MPL ID también es advertencia; sin MPL ID es error', async () => {
    const conMpl = vi.fn().mockResolvedValue(respuesta(400, 'The MPL ID for the failed message is : AGrXXXXXXXXXXXX'))
    const sinMpl = vi.fn().mockResolvedValue(respuesta(400, 'Bad Request'))
    expect((await llamarEndpoint({ url: URL_CI, credentials: credenciales, cuerpo, fetchImpl: conMpl })).resultado).toBe('warning')
    expect((await llamarEndpoint({ url: URL_CI, credentials: credenciales, cuerpo, fetchImpl: sinMpl })).resultado).toBe('error')
  })

  it('un 500 SIN MPL ID sigue siendo error: no hay prueba de que el iFlow procesara nada', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respuesta(500, 'Internal Server Error'))
    expect((await llamarEndpoint({ url: URL_CI, credentials: credenciales, cuerpo, fetchImpl })).resultado).toBe('error')
  })

  // Dicen que la llamada ni siquiera se procesó: credenciales, permiso o dirección. Aunque el texto traiga un MPL ID.
  it.each([401, 403, 404])('un %i es error aunque la respuesta traiga un MPL ID', async (codigo) => {
    const fetchImpl = vi.fn().mockResolvedValue(respuesta(codigo, 'The MPL ID for the failed message is : AGrXXXXXXXXXXXX'))
    expect((await llamarEndpoint({ url: URL_CI, credentials: credenciales, cuerpo, fetchImpl })).resultado).toBe('error')
  })

  it.each([400, 401, 403, 404, 502, 503])('un %i es error', async (codigo) => {
    const fetchImpl = vi.fn().mockResolvedValue(respuesta(codigo, 'no'))
    expect((await llamarEndpoint({ url: URL_CI, credentials: credenciales, cuerpo, fetchImpl })).resultado).toBe('error')
  })

  // Medido contra un tenant real: con credenciales de prueba CPI contesta 401 sin cuerpo.
  it('un 401 sin texto dice que hay que mirar el usuario y la contraseña de la conexión', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respuesta(401, ''))
    const salida = await llamarEndpoint({ url: URL_CI, credentials: credenciales, cuerpo, fetchImpl })
    expect(salida).toMatchObject({ resultado: 'error', httpStatus: 401 })
    expect(salida.mensaje).toBe('CPI rechazó el usuario o la contraseña de la conexión.')
  })

  it('un 403 y un 404 dicen qué revisar, y conservan lo que CPI haya contestado', async () => {
    const f403 = vi.fn().mockResolvedValue(respuesta(403, 'Forbidden'))
    const f404 = vi.fn().mockResolvedValue(respuesta(404, ''))
    expect((await llamarEndpoint({ url: URL_CI, credentials: credenciales, cuerpo, fetchImpl: f403 })).mensaje)
      .toBe('CPI rechazó el acceso: el usuario de la conexión no tiene permiso para llamar a este endpoint. Respuesta: Forbidden')
    expect((await llamarEndpoint({ url: URL_CI, credentials: credenciales, cuerpo, fetchImpl: f404 })).mensaje)
      .toContain('revisa la dirección de la conexión')
  })

  it('el 500 de la captura de Postman conserva su mensaje tal cual', async () => {
    const texto = 'An internal server error occured: The MPL ID for the failed message is : AGrOoIkGv-d7sJej0DVu0bhXLV8K'
    const salida = await llamarEndpoint({ url: URL_CI, credentials: credenciales, cuerpo, fetchImpl: vi.fn().mockResolvedValue(respuesta(500, texto)) })
    expect(salida.mensaje).toBe(texto)
  })

  it('un error sin texto dice igualmente el código', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respuesta(503, ''))
    expect((await llamarEndpoint({ url: URL_CI, credentials: credenciales, cuerpo, fetchImpl })).mensaje).toMatch(/503/)
  })

  it('una redirección es error: no se sigue', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respuesta(302))
    const salida = await llamarEndpoint({ url: URL_CI, credentials: credenciales, cuerpo, fetchImpl })
    expect(salida).toMatchObject({ resultado: 'error', httpStatus: 302 })
    expect(salida.mensaje).toMatch(/redirección/)
  })

  // La respuesta ya trajo su código: que el texto se corte después no cambia el resultado.
  it('si el texto se corta pero el código llegó, vale el código', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respuesta(200, '', { falloAlLeer: true }))
    expect((await llamarEndpoint({ url: URL_CI, credentials: credenciales, cuerpo, fetchImpl })).resultado).toBe('success')
  })
})

describe('no se sabe cómo terminó', () => {
  it('agotar el tiempo deja «unconfirmed» y avisa de revisar antes de repetir', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))
    const salida = await llamarEndpoint({ url: URL_CI, credentials: credenciales, cuerpo, fetchImpl, timeoutMs: 5000 })

    expect(salida).toMatchObject({ resultado: 'unconfirmed', enviado: true, httpStatus: null })
    expect(salida.mensaje).toMatch(/5 s/)
    expect(salida.mensaje).toMatch(/antes de repetirla/)
  })

  it('un corte de conexión a mitad también', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } }))
    const salida = await llamarEndpoint({ url: URL_CI, credentials: credenciales, cuerpo, fetchImpl })
    expect(salida.resultado).toBe('unconfirmed')
  })

  it('un fallo desconocido se trata como duda, no como error limpio', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('algo raro'))
    expect((await llamarEndpoint({ url: URL_CI, credentials: credenciales, cuerpo, fetchImpl })).resultado).toBe('unconfirmed')
  })
})

describe('no llegó a salir nada', () => {
  it.each(['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN'])('%s es un error limpio, no una duda', async (codigo) => {
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new Error('fetch failed'), { cause: { code: codigo } }))
    const salida = await llamarEndpoint({ url: URL_CI, credentials: credenciales, cuerpo, fetchImpl })

    expect(salida).toMatchObject({ resultado: 'error', enviado: false })
    expect(salida.mensaje).toContain('No se envió nada')
  })
})

describe('recortar', () => {
  it('deja el texto en una línea', () => {
    expect(recortar('a\n  b\t c')).toBe('a b c')
  })

  it('corta lo muy largo', () => {
    const largo = recortar('x'.repeat(MENSAJE_MAX + 100))
    expect(largo.length).toBe(MENSAJE_MAX + 1)
    expect(largo.endsWith('…')).toBe(true)
  })

  it('tolera null', () => {
    expect(recortar(null)).toBe('')
  })
})
