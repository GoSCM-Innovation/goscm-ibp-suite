import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryRedis } from '../persistence/redis-in-memory.js'
import { ALLOWED_OPERATIONS, isWriteOperation, runCidsOperation } from './operations.js'
import { CACHED_SESSION_SECONDS, forgetCidsSession, getCidsSession } from './session.js'
import { callOperation, logon, SoapSessionExpiredError, SoapError } from '../soap/client.js'
import { getConnectionTarget, getCredentials } from '../connections/connections.js'

const entorno = vi.hoisted(() => ({ ms: 1_700_000_000_000, redis: null }))

vi.mock('../persistence/redis.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getRedis: () => entorno.redis }
})

vi.mock('../connections/connections.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getConnectionTarget: vi.fn(), getCredentials: vi.fn() }
})

vi.mock('../soap/client.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, logon: vi.fn(), callOperation: vi.fn() }
})

const CLIENTE = 'c-1'
const CONEXION = 'conn-1'
const DESTINO = {
  id: CONEXION,
  kind: 'cids',
  name: 'CI-DS productivo',
  baseUrl: 'https://tenant.kyma.ondemand.com/services',
  organization: 'ORG',
  isProduction: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  entorno.ms = 1_700_000_000_000
  entorno.redis = createInMemoryRedis({ now: () => entorno.ms })
  getConnectionTarget.mockResolvedValue(DESTINO)
  getCredentials.mockResolvedValue({ user: 'usuario', password: 'clave' })
  logon.mockResolvedValue('sesion-1')
  callOperation.mockResolvedValue([{ name: 'Proyecto' }])
})

describe('getCidsSession', () => {
  it('se identifica con los datos de la conexión y guarda la sesión', async () => {
    await expect(getCidsSession(CLIENTE, CONEXION)).resolves.toBe('sesion-1')
    expect(logon).toHaveBeenCalledWith({
      serviceUrl: DESTINO.baseUrl,
      orgName: 'ORG',
      user: 'usuario',
      password: 'clave',
      isProduction: false,
    })
  })

  it('reutiliza la sesión guardada en vez de identificarse otra vez', async () => {
    await getCidsSession(CLIENTE, CONEXION)
    await getCidsSession(CLIENTE, CONEXION)
    expect(logon).toHaveBeenCalledTimes(1)
  })

  it('la sesión guardada caduca sola', async () => {
    await getCidsSession(CLIENTE, CONEXION)
    entorno.ms += (CACHED_SESSION_SECONDS + 60) * 1000
    await getCidsSession(CLIENTE, CONEXION)
    expect(logon).toHaveBeenCalledTimes(2)
  })

  it('con force se identifica de nuevo aunque haya una guardada', async () => {
    await getCidsSession(CLIENTE, CONEXION)
    await getCidsSession(CLIENTE, CONEXION, { force: true })
    expect(logon).toHaveBeenCalledTimes(2)
  })

  it('la sesión de un cliente no sirve para otro', async () => {
    await getCidsSession(CLIENTE, CONEXION)
    logon.mockResolvedValue('sesion-de-otro')
    await expect(getCidsSession('c-2', CONEXION)).resolves.toBe('sesion-de-otro')
    expect(logon).toHaveBeenCalledTimes(2)
  })

  it('no intenta nada con una conexión que no es de CI-DS', async () => {
    getConnectionTarget.mockResolvedValue({ ...DESTINO, kind: 'ibp' })
    await expect(getCidsSession(CLIENTE, CONEXION)).rejects.toThrow(/no es de CI-DS/)
    expect(logon).not.toHaveBeenCalled()
  })

  it('forgetCidsSession obliga a identificarse de nuevo', async () => {
    await getCidsSession(CLIENTE, CONEXION)
    await forgetCidsSession(CLIENTE, CONEXION)
    await getCidsSession(CLIENTE, CONEXION)
    expect(logon).toHaveBeenCalledTimes(2)
  })

  // Una conexión de CI-DS da acceso a DOS repositorios: `isProduction` es un campo del logon, no de
  // la conexión. Misma dirección, misma organización, mismas credenciales, otro repositorio.
  describe('los dos repositorios de una misma conexión', () => {
    beforeEach(() => {
      getConnectionTarget.mockResolvedValue({ ...DESTINO, isProduction: false })
    })

    it('sin pedir nada se entra al repositorio de pruebas', async () => {
      await getCidsSession(CLIENTE, CONEXION)
      expect(logon).toHaveBeenCalledWith(expect.objectContaining({ isProduction: false }))
    })

    // Para CI-DS la columna is_production no significa nada: la conexión es las dos cosas. Leerla
    // haría que pedir pruebas devolviera producción, y los datos parecerían correctos.
    it('NO mira la marca de la conexión: manda solo el repositorio pedido', async () => {
      getConnectionTarget.mockResolvedValue({ ...DESTINO, isProduction: true })

      await getCidsSession(CLIENTE, CONEXION)

      expect(logon).toHaveBeenCalledWith(expect.objectContaining({ isProduction: false }))
    })

    it('pide el productivo con la misma dirección y las mismas credenciales', async () => {
      await getCidsSession(CLIENTE, CONEXION, { production: true })
      expect(logon).toHaveBeenCalledWith({
        serviceUrl: DESTINO.baseUrl,
        orgName: 'ORG',
        user: 'usuario',
        password: 'clave',
        isProduction: true,
      })
    })

    // Si se guardaran juntas, una consulta al productivo podría contestar con datos de pruebas.
    it('guarda las dos por separado y reutiliza cada una', async () => {
      logon.mockResolvedValueOnce('sesion-pruebas')
      await expect(getCidsSession(CLIENTE, CONEXION)).resolves.toBe('sesion-pruebas')
      logon.mockResolvedValueOnce('sesion-productiva')
      await expect(getCidsSession(CLIENTE, CONEXION, { production: true })).resolves.toBe('sesion-productiva')
      expect(logon).toHaveBeenCalledTimes(2)

      await expect(getCidsSession(CLIENTE, CONEXION)).resolves.toBe('sesion-pruebas')
      await expect(getCidsSession(CLIENTE, CONEXION, { production: true })).resolves.toBe('sesion-productiva')
      expect(logon).toHaveBeenCalledTimes(2)
    })

    it('olvidar la del productivo no toca la de pruebas', async () => {
      await getCidsSession(CLIENTE, CONEXION)
      await getCidsSession(CLIENTE, CONEXION, { production: true })
      logon.mockClear()

      await forgetCidsSession(CLIENTE, CONEXION, { production: true })

      await getCidsSession(CLIENTE, CONEXION)
      expect(logon).not.toHaveBeenCalled()
      await getCidsSession(CLIENTE, CONEXION, { production: true })
      expect(logon).toHaveBeenCalledTimes(1)
    })
  })
})

describe('runCidsOperation', () => {
  it('con production ejecuta contra el repositorio productivo de la misma conexión', async () => {
    getConnectionTarget.mockResolvedValue({ ...DESTINO, isProduction: false })

    await runCidsOperation({
      clientId: CLIENTE, connectionId: CONEXION, operation: 'getProjects', production: true,
    })

    expect(logon).toHaveBeenCalledWith(expect.objectContaining({ isProduction: true }))
  })

  it('ejecuta la operación con la sesión y la dirección de la conexión', async () => {
    const resultado = await runCidsOperation({ clientId: CLIENTE, connectionId: CONEXION, operation: 'getProjects' })

    expect(resultado).toEqual([{ name: 'Proyecto' }])
    expect(callOperation).toHaveBeenCalledWith({
      serviceUrl: DESTINO.baseUrl,
      sessionId: 'sesion-1',
      operation: 'getProjects',
      params: {},
      debug: false,
    })
  })

  it('rechaza una operación que no está en la lista', async () => {
    await expect(runCidsOperation({ clientId: CLIENTE, connectionId: CONEXION, operation: 'borrarTodo' }))
      .rejects.toThrow(/no permitida/)
    expect(callOperation).not.toHaveBeenCalled()
  })

  it.each(ALLOWED_OPERATIONS)('acepta la operación %s', async (operation) => {
    await expect(runCidsOperation({ clientId: CLIENTE, connectionId: CONEXION, operation })).resolves.toBeDefined()
  })

  it('si SAP rechaza la sesión, se identifica de nuevo y reintenta una vez', async () => {
    callOperation
      .mockRejectedValueOnce(new SoapSessionExpiredError())
      .mockResolvedValueOnce([{ name: 'Proyecto' }])
    logon.mockResolvedValueOnce('sesion-1').mockResolvedValueOnce('sesion-2')

    const resultado = await runCidsOperation({ clientId: CLIENTE, connectionId: CONEXION, operation: 'getProjects' })

    expect(resultado).toEqual([{ name: 'Proyecto' }])
    expect(logon).toHaveBeenCalledTimes(2)
    expect(callOperation.mock.calls[1][0].sessionId).toBe('sesion-2')
  })

  it('no reintenta en bucle: si la segunda también falla, propaga el error', async () => {
    callOperation.mockRejectedValue(new SoapSessionExpiredError())
    await expect(runCidsOperation({ clientId: CLIENTE, connectionId: CONEXION, operation: 'getProjects' }))
      .rejects.toThrow(SoapSessionExpiredError)
    expect(callOperation).toHaveBeenCalledTimes(2)
  })

  it('un error que no es de sesión no provoca reintento', async () => {
    callOperation.mockRejectedValue(new SoapError('Task not found'))
    await expect(runCidsOperation({ clientId: CLIENTE, connectionId: CONEXION, operation: 'getTaskInfo' }))
      .rejects.toThrow(/Task not found/)
    expect(callOperation).toHaveBeenCalledTimes(1)
    expect(logon).toHaveBeenCalledTimes(1)
  })
})

describe('isWriteOperation', () => {
  it('distingue lo que solo lee de lo que ejecuta', () => {
    expect(isWriteOperation('getProjects')).toBe(false)
    expect(isWriteOperation('runTask')).toBe(true)
    expect(isWriteOperation('cancelTask')).toBe(true)
  })
})
