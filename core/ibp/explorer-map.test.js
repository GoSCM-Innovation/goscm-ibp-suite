import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../persistence/tenant-scope.js', () => ({ queryOneScoped: vi.fn(), queryScoped: vi.fn() }))
vi.mock('../connections/connections.js', () => ({ getConnectionTarget: vi.fn() }))

const { queryOneScoped } = await import('../persistence/tenant-scope.js')
const { getConnectionTarget } = await import('../connections/connections.js')
const { deleteExplorerMap, getExplorerMap, saveExplorerMap } = await import('./explorer-map.js')

const CLIENTE = 'c-1'
const DESTINO = { connectionId: 'x-1', planningArea: 'GCINDURAMA', versionId: 'GCIDPROD' }

const FILA = {
  connection_id: 'x-1',
  planning_area: 'GCINDURAMA',
  version_id: 'GCIDPROD',
  roles: { product: 'GIDPRODUCT' },
  fields: { GIDSOURCECUSTOMER: { CLEADTIME: 'LEADTIME' } },
  updated_at: '2026-08-08T12:00:00Z',
  updated_by: 'u-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  getConnectionTarget.mockResolvedValue({ id: 'x-1', kind: 'ibp', name: 'Tenant IBP' })
})

describe('getExplorerMap', () => {
  it('devuelve las correcciones guardadas', async () => {
    queryOneScoped.mockResolvedValue(FILA)

    await expect(getExplorerMap(CLIENTE, DESTINO)).resolves.toMatchObject({
      roles: { product: 'GIDPRODUCT' },
      fields: { GIDSOURCECUSTOMER: { CLEADTIME: 'LEADTIME' } },
      updatedBy: 'u-1',
    })
  })

  // "Sin correcciones" es el caso NORMAL, no una excepción: quien llama aplica el mapa siempre.
  it('sin nada guardado devuelve un mapa vacío, no null', async () => {
    queryOneScoped.mockResolvedValue(null)

    await expect(getExplorerMap(CLIENTE, DESTINO)).resolves.toMatchObject({
      roles: {}, fields: {}, updatedAt: null,
    })
  })

  // La versión base es la cadena vacía y no NULL: con NULL, Postgres trata como distintas dos filas
  // que son la misma y la clave única no las detiene.
  it('la versión base se guarda como cadena vacía', async () => {
    queryOneScoped.mockResolvedValue(null)
    await getExplorerMap(CLIENTE, { connectionId: 'x-1', planningArea: 'PA' })

    expect(queryOneScoped.mock.calls[0][2]).toEqual([CLIENTE, 'x-1', 'PA', ''])
  })

  it('la consulta va atada al cliente', async () => {
    queryOneScoped.mockResolvedValue(null)
    await getExplorerMap(CLIENTE, DESTINO)

    expect(queryOneScoped.mock.calls[0][0]).toBe(CLIENTE)
    expect(queryOneScoped.mock.calls[0][1]).toContain('client_id = $1')
  })

  // Un área inventada da un mapa que nunca se usa; una conexión de otro cliente no sería inofensivo.
  it('una conexión de otro cliente no se lee', async () => {
    getConnectionTarget.mockRejectedValue(new Error('La conexión no existe para este cliente.'))
    await expect(getExplorerMap(CLIENTE, DESTINO)).rejects.toThrow(/no existe para este cliente/)
    expect(queryOneScoped).not.toHaveBeenCalled()
  })

  it('una conexión que no es de IBP se rechaza', async () => {
    getConnectionTarget.mockResolvedValue({ kind: 'cids', name: 'CI-DS' })
    await expect(getExplorerMap(CLIENTE, DESTINO)).rejects.toThrow(/no es de IBP/)
  })

  it('sin conexión o sin área no se consulta', async () => {
    await expect(getExplorerMap(CLIENTE, { planningArea: 'PA' })).rejects.toThrow(/Falta la conexión/)
    await expect(getExplorerMap(CLIENTE, { connectionId: 'x-1', planningArea: '  ' }))
      .rejects.toThrow(/Falta el área/)
    expect(queryOneScoped).not.toHaveBeenCalled()
  })
})

describe('saveExplorerMap', () => {
  it('guarda roles y campos, y deja constancia de quién', async () => {
    queryOneScoped.mockResolvedValue(FILA)

    await saveExplorerMap(CLIENTE, DESTINO, {
      roles: { product: 'GIDPRODUCT' },
      fields: { GIDSOURCECUSTOMER: { CLEADTIME: 'LEADTIME' } },
      userId: 'u-1',
    })

    const parametros = queryOneScoped.mock.calls[0][2]
    expect(JSON.parse(parametros[4])).toEqual({ product: 'GIDPRODUCT' })
    expect(JSON.parse(parametros[5])).toEqual({ GIDSOURCECUSTOMER: { CLEADTIME: 'LEADTIME' } })
    expect(parametros[6]).toBe('u-1')
  })

  // Un solo mapeo por destino: es lo que impide que el análisis dependa de quién lo corrió.
  it('un segundo guardado reemplaza al primero en vez de duplicarlo', async () => {
    queryOneScoped.mockResolvedValue(FILA)
    await saveExplorerMap(CLIENTE, DESTINO, { roles: {}, fields: {} })

    const consulta = queryOneScoped.mock.calls[0][1]
    expect(consulta).toContain('on conflict')
    expect(consulta).toContain('do update set')
  })

  // Un campo confirmado como inexistente es `null`, y tiene que sobrevivir el viaje a la base.
  it('conserva los campos marcados como inexistentes', async () => {
    queryOneScoped.mockResolvedValue(FILA)
    await saveExplorerMap(CLIENTE, DESTINO, { fields: { A: { ISALTITEM: null } } })

    expect(JSON.parse(queryOneScoped.mock.calls[0][2][5])).toEqual({ A: { ISALTITEM: null } })
  })

  it('guardar sin nada deja el mapa vacío, no revienta', async () => {
    queryOneScoped.mockResolvedValue(FILA)
    await expect(saveExplorerMap(CLIENTE, DESTINO)).resolves.toBeTruthy()
  })

  it('no se puede guardar contra la conexión de otro cliente', async () => {
    getConnectionTarget.mockRejectedValue(new Error('La conexión no existe para este cliente.'))
    await expect(saveExplorerMap(CLIENTE, DESTINO, {})).rejects.toThrow()
    expect(queryOneScoped).not.toHaveBeenCalled()
  })
})

describe('deleteExplorerMap', () => {
  it('borra y dice que borró', async () => {
    queryOneScoped.mockResolvedValue({ connection_id: 'x-1' })
    await expect(deleteExplorerMap(CLIENTE, DESTINO)).resolves.toBe(true)
  })

  it('borrar lo que no está no es un error', async () => {
    queryOneScoped.mockResolvedValue(null)
    await expect(deleteExplorerMap(CLIENTE, DESTINO)).resolves.toBe(false)
  })

  it('el borrado también va atado al cliente', async () => {
    queryOneScoped.mockResolvedValue(null)
    await deleteExplorerMap(CLIENTE, DESTINO)
    expect(queryOneScoped.mock.calls[0][1]).toContain('client_id = $1')
  })
})
