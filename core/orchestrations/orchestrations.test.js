import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createOrchestration,
  deleteOrchestration,
  duplicateOrchestration,
  getOrchestration,
  listOrchestrations,
  updateOrchestration,
} from './orchestrations.js'
import { queryOneScoped, queryScoped } from '../persistence/tenant-scope.js'
import { getConnectionTarget } from '../connections/connections.js'

vi.mock('../persistence/tenant-scope.js', () => ({
  queryScoped: vi.fn(async () => []),
  queryOneScoped: vi.fn(async () => null),
}))
vi.mock('../connections/connections.js', () => ({ getConnectionTarget: vi.fn() }))

const CLIENTE = 'c-1'
const CONEXION = 'conn-1'
const ORQUESTACION = 'orq-1'

const FILA = {
  id: ORQUESTACION,
  connection_id: CONEXION,
  production: false,
  name: 'Carga diaria',
  nodes: [{ id: 'a', type: 'task', position: { x: 0, y: 0 }, data: { label: 'Extraer' } }],
  edges: [],
  created_at: '2026-08-04T12:00:00Z',
  updated_at: '2026-08-04T12:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  getConnectionTarget.mockResolvedValue({ id: CONEXION, kind: 'cids', name: 'CI-DS' })
  queryOneScoped.mockResolvedValue(FILA)
})

describe('listOrchestrations', () => {
  it('consulta con el filtro de cliente y del destino completo', async () => {
    await listOrchestrations(CLIENTE, { connectionId: CONEXION, production: true })

    const [clientId, sql, params] = queryScoped.mock.calls[0]
    expect(clientId).toBe(CLIENTE)
    expect(sql).toContain('client_id = $1')
    expect(sql).toContain('connection_id = $2')
    expect(sql).toContain('production = $3')
    expect(params).toEqual([CLIENTE, CONEXION, true])
  })

  // Los dos repositorios de una conexión tienen tareas distintas, así que también orquestaciones
  // distintas: mezclarlas mostraría pasos que apuntan a tareas que en ese repositorio no existen.
  it('el repositorio separa: pruebas y productivo no comparten orquestaciones', async () => {
    await listOrchestrations(CLIENTE, { connectionId: CONEXION, production: false })
    expect(queryScoped.mock.calls[0][2].at(-1)).toBe(false)
  })

  it('exige la conexión', async () => {
    await expect(listOrchestrations(CLIENTE, {})).rejects.toThrow(/Falta la conexión/)
    expect(queryScoped).not.toHaveBeenCalled()
  })

  it('devuelve los nombres en el estilo de la aplicación, no los de la base', async () => {
    queryScoped.mockResolvedValue([FILA])
    const [una] = await listOrchestrations(CLIENTE, { connectionId: CONEXION })

    expect(una.connectionId).toBe(CONEXION)
    expect(una).not.toHaveProperty('connection_id')
  })
})

describe('getOrchestration', () => {
  it('filtra por cliente: una orquestación ajena no se lee', async () => {
    await getOrchestration(CLIENTE, ORQUESTACION)
    const [, sql, params] = queryOneScoped.mock.calls[0]
    expect(sql).toContain('client_id = $2')
    expect(params).toEqual([ORQUESTACION, CLIENTE])
  })

  it('devuelve null si no existe para este cliente', async () => {
    queryOneScoped.mockResolvedValue(null)
    await expect(getOrchestration(CLIENTE, ORQUESTACION)).resolves.toBeNull()
  })
})

describe('createOrchestration', () => {
  const nueva = { connectionId: CONEXION, name: 'Carga diaria', nodes: [], edges: [] }

  it('guarda con el cliente en la propia fila', async () => {
    await createOrchestration(CLIENTE, nueva)
    const [clientId, sql, params] = queryOneScoped.mock.calls[0]
    expect(clientId).toBe(CLIENTE)
    expect(sql).toContain('insert into orchestrations')
    expect(params[0]).toBe(CLIENTE)
  })

  it('exige un nombre que no esté en blanco', async () => {
    await expect(createOrchestration(CLIENTE, { ...nueva, name: '   ' })).rejects.toThrow(/necesita un nombre/)
    expect(queryOneScoped).not.toHaveBeenCalled()
  })

  it('recorta el nombre', async () => {
    await createOrchestration(CLIENTE, { ...nueva, name: '  Carga  ' })
    expect(queryOneScoped.mock.calls[0][2][3]).toBe('Carga')
  })

  // Una orquestación encadena tareas de CI-DS: apuntarla a un tenant de IBP daría algo imposible de
  // ejecutar, y el error aparecería al lanzarla en vez de al crearla.
  it('rechaza una conexión que no es de CI-DS', async () => {
    getConnectionTarget.mockResolvedValue({ id: CONEXION, kind: 'ibp', name: 'IBP QA' })
    await expect(createOrchestration(CLIENTE, nueva)).rejects.toThrow(/no es de CI-DS/)
    expect(queryOneScoped).not.toHaveBeenCalled()
  })

  it('no guarda nada si la conexión no es del cliente', async () => {
    getConnectionTarget.mockRejectedValue(new Error('La conexión no existe para este cliente.'))
    await expect(createOrchestration(CLIENTE, nueva)).rejects.toThrow(/no existe para este cliente/)
    expect(queryOneScoped).not.toHaveBeenCalled()
  })

  // La validación del grafo es de graph.js; acá solo importa que se aplique antes de escribir.
  it('no guarda un grafo que no se podría ejecutar', async () => {
    await expect(createOrchestration(CLIENTE, {
      ...nueva,
      nodes: [{ id: 'a', type: 'task', data: {} }, { id: 'b', type: 'task', data: {} }],
      edges: [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'b', target: 'a' }],
    })).rejects.toThrow(/ciclo/)
    expect(queryOneScoped).not.toHaveBeenCalled()
  })

  it('el grafo se guarda como texto JSON', async () => {
    await createOrchestration(CLIENTE, nueva)
    const params = queryOneScoped.mock.calls[0][2]
    expect(typeof params[4]).toBe('string')
    expect(typeof params[5]).toBe('string')
  })
})

describe('updateOrchestration', () => {
  it('lo que no se manda no se toca', async () => {
    await updateOrchestration(CLIENTE, ORQUESTACION, { name: 'Otro nombre' })

    const params = queryOneScoped.mock.calls.at(-1)[2]
    expect(params[0]).toBe('Otro nombre')
    // Los nodos guardados son los que ya tenía.
    expect(JSON.parse(params[1])).toHaveLength(1)
  })

  it('falla si la orquestación no es de este cliente', async () => {
    queryOneScoped.mockResolvedValue(null)
    await expect(updateOrchestration(CLIENTE, ORQUESTACION, { name: 'X' }))
      .rejects.toThrow(/no existe para este cliente/)
  })

  // Validar media cosa no demuestra nada: una arista nueva puede apuntar a un nodo que no está.
  it('valida el grafo completo aunque solo cambien las conexiones', async () => {
    await expect(updateOrchestration(CLIENTE, ORQUESTACION, {
      edges: [{ id: 'e', source: 'a', target: 'fantasma' }],
    })).rejects.toThrow(/no existe/)
  })

  it('toca la marca de tiempo de modificación', async () => {
    await updateOrchestration(CLIENTE, ORQUESTACION, { name: 'X' })
    expect(queryOneScoped.mock.calls.at(-1)[1]).toContain('updated_at = now()')
  })

  it('no deja quedarse sin nombre', async () => {
    await expect(updateOrchestration(CLIENTE, ORQUESTACION, { name: '' })).rejects.toThrow(/necesita un nombre/)
  })
})

describe('duplicateOrchestration', () => {
  it('copia el grafo y el destino, con otro nombre', async () => {
    queryScoped.mockResolvedValue([FILA])

    await duplicateOrchestration(CLIENTE, ORQUESTACION)

    const params = queryOneScoped.mock.calls.at(-1)[2]
    expect(params[1]).toBe(CONEXION)
    expect(params[2]).toBe(false)
    expect(params[3]).toBe('Carga diaria (copia)')
    expect(JSON.parse(params[4])).toEqual(FILA.nodes)
  })

  // v9 ponía "(copia)" siempre, así que duplicar dos veces dejaba dos con el mismo nombre.
  it('busca un nombre libre en vez de repetir el mismo', async () => {
    queryScoped.mockResolvedValue([FILA, { ...FILA, name: 'Carga diaria (copia)' }])

    await duplicateOrchestration(CLIENTE, ORQUESTACION)

    expect(queryOneScoped.mock.calls.at(-1)[2][3]).toBe('Carga diaria (copia 2)')
  })

  it('sigue buscando mientras el nombre esté ocupado', async () => {
    queryScoped.mockResolvedValue([
      FILA,
      { ...FILA, name: 'Carga diaria (copia)' },
      { ...FILA, name: 'Carga diaria (copia 2)' },
    ])

    await duplicateOrchestration(CLIENTE, ORQUESTACION)

    expect(queryOneScoped.mock.calls.at(-1)[2][3]).toBe('Carga diaria (copia 3)')
  })

  it('falla si la orquestación no es de este cliente', async () => {
    queryOneScoped.mockResolvedValue(null)
    await expect(duplicateOrchestration(CLIENTE, ORQUESTACION)).rejects.toThrow(/no existe para este cliente/)
  })
})

describe('deleteOrchestration', () => {
  it('borra filtrando por cliente y dice si había algo', async () => {
    queryScoped.mockResolvedValue([{ id: ORQUESTACION }])

    await expect(deleteOrchestration(CLIENTE, ORQUESTACION)).resolves.toBe(true)

    const [, sql, params] = queryScoped.mock.calls[0]
    expect(sql).toContain('client_id = $2')
    expect(params).toEqual([ORQUESTACION, CLIENTE])
  })

  it('una orquestación ajena no se borra y se contesta que no había nada', async () => {
    queryScoped.mockResolvedValue([])
    await expect(deleteOrchestration(CLIENTE, ORQUESTACION)).resolves.toBe(false)
  })
})
