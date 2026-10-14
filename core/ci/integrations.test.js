import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertConexionCi,
  createIntegration,
  deleteIntegration,
  duplicateIntegration,
  esUuid,
  getIntegration,
  getIntegrations,
  listIntegrations,
  normalizarCarpeta,
  normalizarNombre,
  orchestrationsUsing,
  renameFolder,
  updateIntegration,
} from './integrations.js'
import { queryOneScoped, queryScoped } from '../persistence/tenant-scope.js'
import { getConnectionTarget } from '../connections/connections.js'

vi.mock('../persistence/tenant-scope.js', () => ({
  queryScoped: vi.fn(async () => []),
  queryOneScoped: vi.fn(async () => null),
}))
vi.mock('../connections/connections.js', () => ({ getConnectionTarget: vi.fn() }))

const CLIENTE = 'c-1'
const USUARIO = 'u-1'
const CONEXION = '11111111-1111-4111-8111-111111111111'
const ID = '22222222-2222-4222-8222-222222222222'

const BODY = JSON.stringify({ KEYFIGURE: { BatchCommand: 'REPLACE', PlanningArea: 'AREA_DEMO', TypeOfData: 'KEYFIGURES' } })

const FILA = {
  id: ID, connection_id: CONEXION, folder: 'AREA/Cifras', name: 'FACTURAS', body: BODY,
  created_at: '2026-10-14T10:00:00Z', updated_at: '2026-10-14T10:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  getConnectionTarget.mockResolvedValue({ id: CONEXION, kind: 'ci', name: 'CPI dev' })
  queryOneScoped.mockResolvedValue(FILA)
  queryScoped.mockResolvedValue([])
})

describe('assertConexionCi', () => {
  it('acepta una conexión de CI', async () => {
    await expect(assertConexionCi(CLIENTE, CONEXION)).resolves.toMatchObject({ kind: 'ci' })
  })

  it('rechaza la de otro tipo, diciendo cuál es', async () => {
    getConnectionTarget.mockResolvedValue({ id: CONEXION, kind: 'ibp', name: 'Tenant IBP' })
    await expect(assertConexionCi(CLIENTE, CONEXION)).rejects.toThrow(/Tenant IBP.*no es de Cloud Integration/)
  })

  it('exige la conexión', async () => {
    await expect(assertConexionCi(CLIENTE, '')).rejects.toThrow(/Falta la conexión/)
  })

  // `getConnectionTarget` filtra por cliente: una conexión de otro cliente revienta como si no existiera.
  it('una conexión de otro cliente no existe', async () => {
    getConnectionTarget.mockRejectedValue(new Error('La conexión no existe para este cliente.'))
    await expect(assertConexionCi(CLIENTE, CONEXION)).rejects.toThrow(/no existe/)
  })
})

describe('normalizar nombre y carpeta', () => {
  it('el nombre no puede quedar vacío ni pasar del tope', () => {
    expect(normalizarNombre('  PRODUCT  ')).toBe('PRODUCT')
    expect(() => normalizarNombre('   ')).toThrow(/necesita un nombre/)
    expect(() => normalizarNombre('x'.repeat(121))).toThrow(/120/)
  })

  it.each([
    ['STARBRANDS / Maestros/', 'STARBRANDS/Maestros'],
    ['/a//b/', 'a/b'],
    ['', ''],
    [undefined, ''],
    ['  ', ''],
  ])('la carpeta %j queda %j', (entrada, esperada) => {
    expect(normalizarCarpeta(entrada)).toBe(esperada)
  })

  it('una carpeta demasiado larga se rechaza', () => {
    expect(() => normalizarCarpeta('x'.repeat(201))).toThrow(/200/)
  })
})

describe('esUuid', () => {
  it('reconoce los de verdad y descarta el resto', () => {
    expect(esUuid(ID)).toBe(true)
    expect(esUuid('no-es-uno')).toBe(false)
    expect(esUuid("1' or '1'='1")).toBe(false)
    expect(esUuid(undefined)).toBe(false)
  })
})

describe('listIntegrations', () => {
  it('filtra por cliente y conexión, y no devuelve el body entero', async () => {
    queryScoped.mockResolvedValue([FILA])
    const [una] = await listIntegrations(CLIENTE, CONEXION)

    const [clienteDeLaConsulta, sql, params] = queryScoped.mock.calls[0]
    expect(clienteDeLaConsulta).toBe(CLIENTE)
    expect(sql).toContain('client_id = $1')
    expect(sql).toContain('connection_id = $2')
    expect(params).toEqual([CLIENTE, CONEXION])

    expect(una).not.toHaveProperty('body')
    expect(una).toMatchObject({ id: ID, folder: 'AREA/Cifras', name: 'FACTURAS', connectionId: CONEXION })
    expect(una.resumen).toMatchObject({ valido: true, tipo: 'KEYFIGURES', comando: 'REPLACE', areaDePlanificacion: 'AREA_DEMO' })
  })

  it('no lista nada si la conexión no es de CI', async () => {
    getConnectionTarget.mockResolvedValue({ id: CONEXION, kind: 'cids', name: 'X' })
    await expect(listIntegrations(CLIENTE, CONEXION)).rejects.toThrow()
    expect(queryScoped).not.toHaveBeenCalled()
  })
})

describe('getIntegration', () => {
  it('devuelve el body completo, filtrando por cliente', async () => {
    const una = await getIntegration(CLIENTE, ID)
    expect(una.body).toBe(BODY)
    expect(queryOneScoped.mock.calls[0][1]).toContain('client_id = $2')
    expect(queryOneScoped.mock.calls[0][2]).toEqual([ID, CLIENTE])
  })

  it('un identificador que no es un UUID no llega a la base', async () => {
    await expect(getIntegration(CLIENTE, 'abc')).resolves.toBeNull()
    expect(queryOneScoped).not.toHaveBeenCalled()
  })

  it('una que no existe es null', async () => {
    queryOneScoped.mockResolvedValue(null)
    await expect(getIntegration(CLIENTE, ID)).resolves.toBeNull()
  })
})

describe('getIntegrations', () => {
  it('pide cada una con un marcador y sin repetir', async () => {
    const OTRO = '33333333-3333-4333-8333-333333333333'
    queryScoped.mockResolvedValue([FILA])
    await getIntegrations(CLIENTE, [ID, ID, OTRO, 'basura', null])

    const [, sql, params] = queryScoped.mock.calls[0]
    expect(sql).toContain('id in ($2, $3)')
    expect(params).toEqual([CLIENTE, ID, OTRO])
  })

  it('sin identificadores válidos no consulta', async () => {
    await expect(getIntegrations(CLIENTE, ['x', undefined])).resolves.toEqual([])
    expect(queryScoped).not.toHaveBeenCalled()
  })
})

describe('createIntegration', () => {
  const datos = { connectionId: CONEXION, folder: ' AREA / Cifras ', name: ' FACTURAS ', body: BODY }

  it('guarda con el cliente en la fila, el nombre y la carpeta normalizados, y quién la guardó', async () => {
    await createIntegration(CLIENTE, USUARIO, datos)
    const [, sql, params] = queryOneScoped.mock.calls[0]
    expect(sql).toMatch(/insert into ci_integrations \(client_id,/)
    expect(params.slice(0, 4)).toEqual([CLIENTE, CONEXION, 'AREA/Cifras', 'FACTURAS'])
    expect(params[5]).toBe(USUARIO)
  })

  it('guarda el body como el JSON que se escribió, en su orden', async () => {
    await createIntegration(CLIENTE, USUARIO, { ...datos, body: '{"B":{"Z":"1","A":"2"}}' })
    const guardado = queryOneScoped.mock.calls[0][2][4]
    expect(Object.keys(JSON.parse(guardado).B)).toEqual(['Z', 'A'])
  })

  it('rechaza un body con varios bloques y no guarda nada', async () => {
    await expect(createIntegration(CLIENTE, USUARIO, { ...datos, body: '{"A":{"x":"1"},"B":{"y":"2"}}' }))
      .rejects.toThrow(/2 bloques/)
    expect(queryOneScoped).not.toHaveBeenCalled()
  })

  it('rechaza un body que no es JSON', async () => {
    await expect(createIntegration(CLIENTE, USUARIO, { ...datos, body: '{ roto' })).rejects.toThrow(/JSON válido/)
  })

  it('traduce el choque de nombre a un mensaje que diga qué hacer', async () => {
    queryOneScoped.mockRejectedValue(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }))
    await expect(createIntegration(CLIENTE, USUARIO, datos)).rejects.toThrow('Ya hay una integración con ese nombre en esa carpeta.')
  })

  it('otro error de la base se deja pasar tal cual', async () => {
    queryOneScoped.mockRejectedValue(new Error('conexión caída'))
    await expect(createIntegration(CLIENTE, USUARIO, datos)).rejects.toThrow('conexión caída')
  })

  it('no guarda en una conexión que no es de CI', async () => {
    getConnectionTarget.mockResolvedValue({ id: CONEXION, kind: 'ibp', name: 'IBP' })
    await expect(createIntegration(CLIENTE, USUARIO, datos)).rejects.toThrow(/no es de Cloud Integration/)
    expect(queryOneScoped).not.toHaveBeenCalled()
  })
})

describe('updateIntegration', () => {
  it('lo que no se manda no se toca', async () => {
    queryOneScoped.mockResolvedValueOnce(FILA).mockResolvedValueOnce(FILA)
    await updateIntegration(CLIENTE, USUARIO, ID, { name: 'NUEVO' })

    const [, sql, params] = queryOneScoped.mock.calls[1]
    expect(sql).toContain('client_id = $6')
    expect(params).toEqual(['NUEVO', 'AREA/Cifras', BODY, USUARIO, ID, CLIENTE])
  })

  it('valida el body nuevo', async () => {
    queryOneScoped.mockResolvedValueOnce(FILA)
    await expect(updateIntegration(CLIENTE, USUARIO, ID, { body: '[]' })).rejects.toThrow(/objeto/)
  })

  it('una integración ajena o inexistente no se actualiza', async () => {
    queryOneScoped.mockResolvedValueOnce(null)
    await expect(updateIntegration(CLIENTE, USUARIO, ID, { name: 'X' })).rejects.toThrow(/no existe para este cliente/)
    expect(queryOneScoped).toHaveBeenCalledTimes(1)
  })
})

describe('duplicateIntegration', () => {
  it('numera la copia hasta que el nombre esté libre', async () => {
    queryOneScoped.mockResolvedValue(FILA)
    queryScoped.mockResolvedValue([{ name: 'FACTURAS (copia)' }, { name: 'FACTURAS (copia 2)' }])
    await duplicateIntegration(CLIENTE, USUARIO, ID)

    const insercion = queryOneScoped.mock.calls.find(([, sql]) => /insert into/.test(sql))
    expect(insercion[2][3]).toBe('FACTURAS (copia 3)')
    expect(insercion[2][2]).toBe('AREA/Cifras')
  })
})

describe('orchestrationsUsing', () => {
  it('busca dentro del grafo con el cliente puesto', async () => {
    queryScoped.mockResolvedValue([{ id: 'o-1', name: 'Carga diaria' }])
    await expect(orchestrationsUsing(CLIENTE, ID)).resolves.toEqual([{ id: 'o-1', name: 'Carga diaria' }])

    const [, sql, params] = queryScoped.mock.calls[0]
    expect(sql).toContain('client_id = $1')
    expect(sql).toContain('nodes @> $2::jsonb')
    expect(JSON.parse(params[1])).toEqual([{ data: { integrationId: ID } }])
  })
})

describe('deleteIntegration', () => {
  it('se niega si una orquestación la usa, y dice cuál', async () => {
    queryScoped.mockResolvedValueOnce([{ id: 'o-1', name: 'Carga diaria' }])
    await expect(deleteIntegration(CLIENTE, ID)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('«Carga diaria»'),
    })
    expect(queryScoped).toHaveBeenCalledTimes(1)
  })

  it('borra con el cliente en la consulta y dice si había algo', async () => {
    queryScoped.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: ID }])
    await expect(deleteIntegration(CLIENTE, ID)).resolves.toBe(true)
    const [, sql, params] = queryScoped.mock.calls[1]
    expect(sql).toContain('client_id = $2')
    expect(params).toEqual([ID, CLIENTE])
  })

  it('una que no existe devuelve false', async () => {
    queryScoped.mockResolvedValue([])
    await expect(deleteIntegration(CLIENTE, ID)).resolves.toBe(false)
  })
})

describe('renameFolder', () => {
  it('cambia la carpeta y sus subcarpetas, con el patrón escapado', async () => {
    queryScoped.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    await expect(renameFolder(CLIENTE, CONEXION, 'A_B', 'Nueva')).resolves.toBe(2)

    const [, sql, params] = queryScoped.mock.calls[0]
    expect(sql).toContain('client_id = $1')
    expect(params).toEqual([CLIENTE, CONEXION, 'A_B', 'Nueva', 'A\\_B/%'])
  })

  it('no hace nada si el nombre no cambia, ni con la carpeta raíz', async () => {
    await expect(renameFolder(CLIENTE, CONEXION, 'A', 'A')).resolves.toBe(0)
    await expect(renameFolder(CLIENTE, CONEXION, '', 'B')).rejects.toThrow(/no existe/)
    expect(queryScoped).not.toHaveBeenCalled()
  })

  it('un choque de nombres se explica', async () => {
    queryScoped.mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }))
    await expect(renameFolder(CLIENTE, CONEXION, 'A', 'B')).rejects.toThrow(/Ya hay una integración con ese nombre/)
  })
})
