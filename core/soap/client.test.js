import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  SoapError,
  SoapSessionExpiredError,
  buildEnvelope,
  callOperation,
  logon,
  logout,
  soapCall,
} from './client.js'
import { assertSapUrl } from '../transport/ssrf.js'

vi.mock('../transport/ssrf.js', () => ({ assertSapUrl: vi.fn(async () => {}) }))

const URL_CIDS = 'https://tenant.kyma.ondemand.com/services'
const SESION = 'sesion-abc'

const responde = ({ status = 200, body = '' } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
})

beforeEach(() => {
  vi.clearAllMocks()
  assertSapUrl.mockResolvedValue(undefined)
})

describe('buildEnvelope', () => {
  it('mete la sesión en la cabecera', () => {
    expect(buildEnvelope('<web:pingRequest/>', SESION)).toContain(`<SessionId>${SESION}</SessionId>`)
  })

  it('añade la versión cuando se pide', () => {
    expect(buildEnvelope('<x/>', SESION, '2.0')).toContain('<web:Version>2.0</web:Version>')
  })

  it('deja la cabecera vacía si no hay nada que poner', () => {
    expect(buildEnvelope('<x/>')).toContain('<soapenv:Header/>')
  })

  it('escapa la sesión', () => {
    expect(buildEnvelope('<x/>', 'a&b')).toContain('<SessionId>a&amp;b</SessionId>')
  })
})

describe('soapCall', () => {
  it('pasa la dirección por el portero antes de llamar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde({ body: '<ok/>' })))
    await soapCall({ serviceUrl: URL_CIDS, soapAction: 'function=ping', envelope: '<x/>' })
    expect(assertSapUrl).toHaveBeenCalledWith(URL_CIDS, { kind: 'cids' })
  })

  it('no llama si el portero rechaza la dirección', async () => {
    vi.stubGlobal('fetch', vi.fn())
    assertSapUrl.mockRejectedValue(new Error('URL rechazada (Host no permitido)'))
    await expect(soapCall({ serviceUrl: URL_CIDS, soapAction: 'x', envelope: '<x/>' })).rejects.toThrow(/rechazada/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('manda la acción SOAP y el tipo de contenido que espera CI-DS', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde({ body: '<ok/>' })))
    await soapCall({ serviceUrl: URL_CIDS, soapAction: 'function=ping', envelope: '<x/>' })
    const [, opciones] = fetch.mock.calls[0]
    expect(opciones.headers.SOAPAction).toBe('function=ping')
    expect(opciones.headers['Content-Type']).toBe('text/xml; charset=utf-8')
    expect(opciones.redirect).toBe('manual')
  })

  it('rechaza una redirección', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde({ status: 302 })))
    await expect(soapCall({ serviceUrl: URL_CIDS, soapAction: 'x', envelope: '<x/>' }))
      .rejects.toThrow(/redirección/)
  })

  it('convierte un corte de red en un error propio', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket hang up') }))
    const error = await soapCall({ serviceUrl: URL_CIDS, soapAction: 'x', envelope: '<x/>' }).catch((e) => e)
    expect(error).toBeInstanceOf(SoapError)
    expect(error.message).toMatch(/No se pudo contactar/)
  })
})

describe('logon', () => {
  it('devuelve el identificador de sesión', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde({ body: '<r><SessionID>s-1</SessionID></r>' })))
    await expect(logon({ serviceUrl: URL_CIDS, orgName: 'ORG', user: 'u', password: 'p' })).resolves.toBe('s-1')
  })

  it('manda si el tenant es productivo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde({ body: '<r><SessionID>s</SessionID></r>' })))
    await logon({ serviceUrl: URL_CIDS, orgName: 'ORG', user: 'u', password: 'p', isProduction: true })
    expect(fetch.mock.calls[0][1].body).toContain('<isProduction>true</isProduction>')
  })

  it('exige credenciales y no llama sin ellas', async () => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(logon({ serviceUrl: URL_CIDS, orgName: 'ORG', user: 'u' })).rejects.toThrow(/credenciales/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('propaga el mensaje de SAP cuando el ingreso falla', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde({
      status: 500,
      body: '<Fault><faultstring>Invalid credentials</faultstring></Fault>',
    })))
    await expect(logon({ serviceUrl: URL_CIDS, orgName: 'O', user: 'u', password: 'p' }))
      .rejects.toThrow(/Invalid credentials/)
  })

  it('revienta si la respuesta no trae sesión', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde({ body: '<r/>' })))
    await expect(logon({ serviceUrl: URL_CIDS, orgName: 'O', user: 'u', password: 'p' }))
      .rejects.toThrow(/no devolvió el identificador/)
  })
})

describe('callOperation', () => {
  it('devuelve el resultado ya interpretado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde({
      body: '<r><projects><name>P1</name><guid>G1</guid></projects></r>',
    })))
    const proyectos = await callOperation({ serviceUrl: URL_CIDS, sessionId: SESION, operation: 'getProjects' })
    expect(proyectos).toEqual([{ name: 'P1', guid: 'G1', description: null }])
  })

  it('exige dirección y sesión', async () => {
    await expect(callOperation({ sessionId: SESION, operation: 'ping' })).rejects.toThrow(/dirección/)
    await expect(callOperation({ serviceUrl: URL_CIDS, operation: 'ping' })).rejects.toThrow(/sesión/)
  })

  it('reintenta con el nombre antiguo cuando el tenant no conoce el nuevo', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(responde({ status: 500, body: '<Fault><faultstring>Unknown operation</faultstring></Fault>' }))
      .mockResolvedValueOnce(responde({ body: '<r><return jobId="J1" statusCode="TASK:SUCCESS">1</return></r>' })))

    const tareas = await callOperation({ serviceUrl: URL_CIDS, sessionId: SESION, operation: 'getAllExecutedTasks2' })

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[0][1].headers.SOAPAction).toBe('function=getAllExecutedTasks2')
    expect(fetch.mock.calls[1][1].headers.SOAPAction).toBe('function=getAllExecutedTasks')
    // El primer intento pide la versión 2.0; el reintento, ninguna.
    expect(fetch.mock.calls[0][1].body).toContain('<web:Version>2.0</web:Version>')
    expect(fetch.mock.calls[1][1].body).not.toContain('web:Version')
    expect(tareas[0]).toMatchObject({ runId: '1', statusCode: 'SUCCESS' })
  })

  it('no reintenta cuando el error es otro', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde({
      status: 500, body: '<Fault><faultstring>Task not found</faultstring></Fault>',
    })))
    await expect(callOperation({ serviceUrl: URL_CIDS, sessionId: SESION, operation: 'getAllExecutedTasks2' }))
      .rejects.toThrow(/Task not found/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('distingue la sesión caducada, para que quien llame pueda volver a entrar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde({
      status: 500, body: '<Fault><faultcode>Server</faultcode><faultstring>Session expired</faultstring></Fault>',
    })))
    const error = await callOperation({ serviceUrl: URL_CIDS, sessionId: SESION, operation: 'ping' }).catch((e) => e)
    expect(error).toBeInstanceOf(SoapSessionExpiredError)
  })

  it('detecta el error también cuando viene dentro de una respuesta correcta', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde({
      status: 200, body: '<r><Fault><faultstring>Algo falló</faultstring></Fault></r>',
    })))
    await expect(callOperation({ serviceUrl: URL_CIDS, sessionId: SESION, operation: 'ping' }))
      .rejects.toThrow(/Algo falló/)
  })

  it('guarda el XML tapado cuando no reconoce el error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde({
      status: 500, body: `<algo><SessionId>${SESION}</SessionId>sin formato conocido</algo>`,
    })))
    const error = await callOperation({ serviceUrl: URL_CIDS, sessionId: SESION, operation: 'ping' }).catch((e) => e)
    expect(error.rawXml).toContain('[oculto]')
    expect(error.rawXml).not.toContain(SESION)
  })

  it('en modo depuración devuelve el XML enviado con la sesión tapada', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde({ body: '<r><Message>pong</Message></r>' })))
    const salida = await callOperation({
      serviceUrl: URL_CIDS, sessionId: SESION, operation: 'ping', debug: true,
    })
    expect(salida.result).toEqual({ message: 'pong' })
    expect(salida.requestXml).toContain('[oculto]')
    expect(salida.requestXml).not.toContain(SESION)
    expect(salida.soapAction).toBe('function=ping')
  })
})

describe('logout', () => {
  it('cierra la sesión', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde({ body: '<r><LogoutMessage>chao</LogoutMessage></r>' })))
    await expect(logout({ serviceUrl: URL_CIDS, sessionId: SESION })).resolves.toEqual({ message: 'chao' })
  })

  it('si falla no revienta: cerrar es un gesto de cortesía', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde({ status: 500, body: '<Fault><faultstring>x</faultstring></Fault>' })))
    await expect(logout({ serviceUrl: URL_CIDS, sessionId: SESION })).resolves.toBeNull()
  })
})
