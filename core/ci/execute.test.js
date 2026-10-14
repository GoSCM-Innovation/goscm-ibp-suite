// Ejecutar una integración: el candado, el registro y el orden de las cosas.
//
// Lo que se protege: que una carga a IBP no salga dos veces a la vez, que nunca salga con una variable sin
// resolver, y que no salga sin dejar rastro de quién la lanzó.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInMemoryRedis } from '../persistence/redis-in-memory.js'
import { CANDADO_SEGUNDOS, executeIntegration } from './execute.js'
import { assertConexionCi, getIntegration } from './integrations.js'
import { cerrarEjecucion, registrarEjecucion } from './history.js'
import { getCredentials } from '../connections/connections.js'

const entorno = vi.hoisted(() => ({ redis: null }))

vi.mock('../persistence/redis.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getRedis: () => entorno.redis }
})
vi.mock('./integrations.js', () => ({ assertConexionCi: vi.fn(), getIntegration: vi.fn() }))
vi.mock('./history.js', () => ({ registrarEjecucion: vi.fn(async () => {}), cerrarEjecucion: vi.fn(async () => {}) }))
vi.mock('../connections/connections.js', () => ({ CI_AGREEMENT: 'CI', getCredentials: vi.fn() }))

const CLIENTE = 'c-1'
const CONEXION = 'conn-1'
const INTEGRACION = 'int-1'
const URL_CI = 'https://acme.it-cpi034-rt.cfapps.us10-002.hana.ondemand.com/http/IBP2'
const BODY = JSON.stringify({ KEYFIGURE: { BatchCommand: 'REPLACE', FilterForTheDataSource: "KEYFIGUREDATE BT '{{DESDE}}' '{{HASTA}}'" } })
const USUARIO = { id: 'u-1', email: 'a@x.com' }

const integracion = { id: INTEGRACION, connectionId: CONEXION, name: 'FACTURAS', folder: 'A', body: BODY }
const exito = { resultado: 'success', enviado: true, httpStatus: 200, duracionMs: 5_000, mplId: null, mensaje: 'OK' }

/** Una llamada de mentira que anota con qué se la llamó. */
const llamadaQue = (resultado) => vi.fn(async () => resultado)

const ejecutar = (extra = {}) => executeIntegration({
  clientId: CLIENTE, connectionId: CONEXION, integrationId: INTEGRACION,
  variables: { DESDE: '20261005', HASTA: '20270412' }, user: USUARIO, runId: 'run-1', ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  entorno.redis = createInMemoryRedis()
  assertConexionCi.mockResolvedValue({ id: CONEXION, kind: 'ci', name: 'CPI dev', baseUrl: URL_CI })
  getIntegration.mockResolvedValue(integracion)
  getCredentials.mockResolvedValue({ user: 'sb-u', password: 'p' })
})

describe('el camino feliz', () => {
  it('envía el body con las variables resueltas, a la dirección y con las credenciales de la conexión', async () => {
    const llamar = llamadaQue(exito)
    const salida = await ejecutar({ llamar })

    expect(llamar).toHaveBeenCalledTimes(1)
    const { url, credentials, cuerpo } = llamar.mock.calls[0][0]
    expect(url).toBe(URL_CI)
    expect(credentials).toEqual({ user: 'sb-u', password: 'p' })
    expect(JSON.parse(cuerpo).KEYFIGURE.FilterForTheDataSource).toBe("KEYFIGUREDATE BT '20261005' '20270412'")
    expect(getCredentials).toHaveBeenCalledWith(CLIENTE, CONEXION, 'CI')

    expect(salida).toMatchObject({ runId: 'run-1', nombre: 'FACTURAS', resultado: 'success', httpStatus: 200 })
  })

  it('anota la ejecución ANTES de enviar y la cierra DESPUÉS, con quién la lanzó y las variables', async () => {
    const orden = []
    registrarEjecucion.mockImplementation(async () => { orden.push('registrar') })
    cerrarEjecucion.mockImplementation(async () => { orden.push('cerrar') })
    const llamar = vi.fn(async () => { orden.push('llamar'); return exito })

    await ejecutar({ llamar, origin: 'orchestration', orchestrationId: 'orq-1' })

    expect(orden).toEqual(['registrar', 'llamar', 'cerrar'])
    expect(registrarEjecucion).toHaveBeenCalledWith(CLIENTE, expect.objectContaining({
      id: 'run-1', connectionId: CONEXION, origin: 'orchestration', orchestrationId: 'orq-1', user: USUARIO,
      variables: { DESDE: '20261005', HASTA: '20270412' },
    }))
    expect(cerrarEjecucion).toHaveBeenCalledWith(CLIENTE, 'run-1', exito)
  })

  it('suelta el candado al terminar, para poder ejecutarla otra vez', async () => {
    await ejecutar({ llamar: llamadaQue(exito) })
    expect(entorno.redis.keys()).toEqual([])
    const otra = await ejecutar({ llamar: llamadaQue(exito), runId: 'run-2' })
    expect(otra.resultado).toBe('success')
  })

  it('el candado dura lo que la llamada más larga', () => {
    expect(CANDADO_SEGUNDOS).toBeGreaterThanOrEqual(300)
  })
})

describe('el candado', () => {
  // El caso que justifica todo el archivo: doble clic, o dos pestañas.
  it('una segunda ejecución de la misma integración no sale mientras la primera sigue', async () => {
    let terminar
    const primera = ejecutar({
      llamar: vi.fn(() => new Promise((resolver) => { terminar = () => resolver(exito) })),
    })
    // Deja que la primera tome el candado y llegue a la llamada.
    await vi.waitFor(() => expect(terminar).toBeTypeOf('function'))

    const llamarSegunda = llamadaQue(exito)
    const segunda = await ejecutar({ llamar: llamarSegunda, runId: 'run-2' })

    expect(llamarSegunda).not.toHaveBeenCalled()
    expect(segunda).toMatchObject({ resultado: 'error', enviado: false, bloqueada: true })
    expect(segunda.mensaje).toMatch(/ya se está ejecutando/)

    terminar()
    expect((await primera).resultado).toBe('success')
  })

  it('el candado es por integración: otra distinta sí sale', async () => {
    let terminar
    const primera = ejecutar({ llamar: vi.fn(() => new Promise((resolver) => { terminar = () => resolver(exito) })) })
    await vi.waitFor(() => expect(terminar).toBeTypeOf('function'))

    getIntegration.mockResolvedValue({ ...integracion, id: 'int-2' })
    const otra = await executeIntegration({
      clientId: CLIENTE, connectionId: CONEXION, integrationId: 'int-2',
      variables: { DESDE: '1', HASTA: '2' }, runId: 'run-2', llamar: llamadaQue(exito),
    })
    expect(otra.resultado).toBe('success')

    terminar()
    await primera
  })

  it('suelta el candado aunque la llamada reviente', async () => {
    await expect(ejecutar({ llamar: vi.fn().mockRejectedValue(new Error('inesperado')) })).rejects.toThrow('inesperado')
    expect(entorno.redis.keys()).toEqual([])
  })

  it('no suelta un candado que ya es de otra ejecución', async () => {
    const llamar = vi.fn(async () => {
      // El candado venció y otra ejecución tomó el suyo.
      await entorno.redis.set(`c:${CLIENTE}:ci-lock:${INTEGRACION}`, 'de-otra', { ex: 300 })
      return exito
    })
    await ejecutar({ llamar })
    expect(await entorno.redis.get(`c:${CLIENTE}:ci-lock:${INTEGRACION}`)).toBe('de-otra')
  })

  // Sin candado no se puede garantizar que no se duplique: no se envía.
  it('si no se puede tomar el candado, no se envía', async () => {
    entorno.redis = { ...createInMemoryRedis(), set: vi.fn().mockRejectedValue(new Error('Redis caído')) }
    const llamar = llamadaQue(exito)
    const salida = await ejecutar({ llamar })

    expect(llamar).not.toHaveBeenCalled()
    expect(salida).toMatchObject({ resultado: 'error', enviado: false })
    expect(salida.mensaje).toMatch(/no se envió/)
  })
})

describe('lo que se comprueba antes de enviar', () => {
  it('una variable sin valor NO se envía y queda anotada como error', async () => {
    const llamar = llamadaQue(exito)
    const salida = await ejecutar({ llamar, variables: { DESDE: '20261005' } })

    expect(llamar).not.toHaveBeenCalled()
    expect(salida).toMatchObject({ resultado: 'error', enviado: false })
    expect(salida.mensaje).toMatch(/\{\{HASTA\}\}/)
    expect(registrarEjecucion).toHaveBeenCalledWith(CLIENTE, expect.objectContaining({
      resultado: expect.objectContaining({ resultado: 'error' }),
    }))
  })

  it('un valor con comillas NO se envía', async () => {
    const llamar = llamadaQue(exito)
    const salida = await ejecutar({ llamar, variables: { DESDE: "1' ,X EQ 'y", HASTA: '2' } })
    expect(llamar).not.toHaveBeenCalled()
    expect(salida.mensaje).toMatch(/comillas/)
  })

  it('sin credenciales no se envía', async () => {
    getCredentials.mockRejectedValue(new Error('La conexión no tiene configurado el acuerdo CI.'))
    const llamar = llamadaQue(exito)
    const salida = await ejecutar({ llamar })
    expect(llamar).not.toHaveBeenCalled()
    expect(salida.mensaje).toMatch(/acuerdo CI/)
  })

  it('una integración de OTRA conexión no sale: correría contra un tenant que no es el suyo', async () => {
    getIntegration.mockResolvedValue({ ...integracion, connectionId: 'otra-conexion' })
    const llamar = llamadaQue(exito)
    const salida = await ejecutar({ llamar })
    expect(llamar).not.toHaveBeenCalled()
    expect(salida.mensaje).toMatch(/no existe en esta conexión/)
  })

  it('una integración que no existe no sale', async () => {
    getIntegration.mockResolvedValue(null)
    const salida = await ejecutar({ llamar: llamadaQue(exito) })
    expect(salida).toMatchObject({ resultado: 'error', enviado: false })
  })

  it('una conexión que no es de CI no sale', async () => {
    assertConexionCi.mockRejectedValue(new Error('La conexión "X" no es de Cloud Integration.'))
    const llamar = llamadaQue(exito)
    const salida = await ejecutar({ llamar })
    expect(llamar).not.toHaveBeenCalled()
    expect(salida.mensaje).toMatch(/no es de Cloud Integration/)
  })

  // Sin registro no hay rastro de quién lanzó una carga a IBP: no se envía.
  it('si no se puede anotar la ejecución, no se envía', async () => {
    registrarEjecucion.mockRejectedValueOnce(new Error('base caída'))
    const llamar = llamadaQue(exito)
    const salida = await ejecutar({ llamar })
    expect(llamar).not.toHaveBeenCalled()
    expect(salida.mensaje).toMatch(/no se envió/)
    expect(entorno.redis.keys()).toEqual([])
  })
})

describe('lo que pasa después de enviar', () => {
  // La carga ya salió: que no se pueda anotar el cierre no cambia su resultado.
  it('si no se puede cerrar el registro, igual se devuelve lo que CPI contestó', async () => {
    cerrarEjecucion.mockRejectedValueOnce(new Error('base caída'))
    const salida = await ejecutar({ llamar: llamadaQue(exito) })
    expect(salida.resultado).toBe('success')
  })

  it('un error de CPI se devuelve con su código y su MPL ID', async () => {
    const fallo = { resultado: 'error', enviado: true, httpStatus: 500, duracionMs: 21_430, mplId: 'MPL-9', mensaje: 'boom' }
    const salida = await ejecutar({ llamar: llamadaQue(fallo) })
    expect(salida).toMatchObject({ resultado: 'error', httpStatus: 500, mplId: 'MPL-9', nombre: 'FACTURAS' })
  })

  it('una carga en duda se devuelve como tal', async () => {
    const duda = { resultado: 'unconfirmed', enviado: true, httpStatus: null, duracionMs: 270_000, mplId: null, mensaje: 'sin respuesta' }
    expect((await ejecutar({ llamar: llamadaQue(duda) })).resultado).toBe('unconfirmed')
  })
})
