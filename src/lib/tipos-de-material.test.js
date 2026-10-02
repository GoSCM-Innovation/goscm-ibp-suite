import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMasterPage = vi.fn()
vi.mock('./ibp-master-data.js', () => ({ fetchMasterPage }))

const { leerTiposDeMaterial } = await import('./tipos-de-material.js')

const DESTINO = { connectionId: 'c1', planningArea: 'SAP4', versionId: 'V1' }

beforeEach(() => { fetchMasterPage.mockReset() })

describe('leerTiposDeMaterial', () => {
  it('pide solo PRDID y MATTYPEID de la tabla de productos, con orden estable', async () => {
    fetchMasterPage.mockResolvedValue({ filas: [], total: 0 })
    await leerTiposDeMaterial({ destino: DESTINO, entidad: 'GIDPRODUCT' })

    expect(fetchMasterPage).toHaveBeenCalledWith('c1', expect.objectContaining({
      entidad: 'GIDPRODUCT',
      planningArea: 'SAP4',
      versionId: 'V1',
      select: ['PRDID', 'MATTYPEID'],
      orderby: ['PRDID'],
      skip: 0,
      conTotal: true,
    }))
  })

  it('cuenta los productos por tipo y descarta los que no tienen', async () => {
    fetchMasterPage.mockResolvedValue({
      filas: [
        { PRDID: 'A', MATTYPEID: 'FERT' },
        { PRDID: 'B', MATTYPEID: 'FERT ' },
        { PRDID: 'C', MATTYPEID: 'ROH' },
        { PRDID: 'D', MATTYPEID: '' },
      ],
      total: 4,
    })
    const { cuenta, productos } = await leerTiposDeMaterial({ destino: DESTINO, entidad: 'P' })
    expect(cuenta).toEqual({ FERT: 2, ROH: 1 })
    expect(productos).toBe(4)
  })

  it('un producto repetido cuenta una vez y gana el último, como en v7', async () => {
    fetchMasterPage.mockResolvedValue({
      filas: [{ PRDID: 'A', MATTYPEID: 'FERT' }, { PRDID: 'A', MATTYPEID: 'ROH' }],
      total: 2,
    })
    const { cuenta } = await leerTiposDeMaterial({ destino: DESTINO, entidad: 'P' })
    expect(cuenta).toEqual({ ROH: 1 })
  })

  it('sigue pidiendo páginas hasta llegar al total que dijo SAP', async () => {
    const pagina = (desde, n) => Array.from({ length: n }, (_, i) => ({ PRDID: `P${desde + i}`, MATTYPEID: 'FERT' }))
    fetchMasterPage
      .mockResolvedValueOnce({ filas: pagina(0, 5000), total: 7000 })
      .mockResolvedValueOnce({ filas: pagina(5000, 2000), total: 7000 })

    const { cuenta } = await leerTiposDeMaterial({ destino: DESTINO, entidad: 'P' })
    expect(fetchMasterPage).toHaveBeenCalledTimes(2)
    expect(fetchMasterPage.mock.calls[1][1]).toMatchObject({ skip: 5000, conTotal: false })
    expect(cuenta).toEqual({ FERT: 7000 })
  })

  it('usa los nombres reales de los campos de este tenant', async () => {
    fetchMasterPage.mockResolvedValue({ filas: [{ ID: 'A', TIPO: 'FERT' }], total: 1 })
    const mapa = { GIDP: { PRDID: 'ID', MATTYPEID: 'TIPO' } }
    const { cuenta } = await leerTiposDeMaterial({ destino: DESTINO, entidad: 'GIDP', mapa })

    expect(fetchMasterPage.mock.calls[0][1].select).toEqual(['ID', 'TIPO'])
    expect(cuenta).toEqual({ FERT: 1 })
  })

  it('sin tabla de productos no pregunta nada', async () => {
    expect(await leerTiposDeMaterial({ destino: DESTINO, entidad: null })).toEqual({ cuenta: {}, productos: 0 })
    expect(fetchMasterPage).not.toHaveBeenCalled()
  })
})
