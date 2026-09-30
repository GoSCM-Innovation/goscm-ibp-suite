import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./master-data.js', () => ({
  readDistinctValues: vi.fn(),
  readEntityPage: vi.fn(),
  readVsmt: vi.fn(),
}))

const { readDistinctValues, readEntityPage, readVsmt } = await import('./master-data.js')
const { readAttrDistinctValues, tablaDelAtributo } = await import('./attr-values.js')

const ctx = { baseUrl: 'https://t', credentials: { user: 'u' }, area: 'ASIBPTS' }

const VSMT = [
  { PlanningAreaID: 'ASIBPTS', VersionID: 'V1', MasterDataTypeID: 'AS1PRODUCT' },
  { PlanningAreaID: 'ASIBPTS', VersionID: 'V2', MasterDataTypeID: 'AS1PRODUCT' },
  { PlanningAreaID: 'ASIBPTS', VersionID: 'V1', MasterDataTypeID: 'AS1CUSTOMER' },
  { PlanningAreaID: 'ASIBPTS', VersionID: 'V1', MasterDataTypeID: 'AS1LOCATION' },
  { PlanningAreaID: 'OTRA', VersionID: 'V1', MasterDataTypeID: 'ZZCUSTOMER' },
]

beforeEach(() => {
  vi.clearAllMocks()
  readVsmt.mockResolvedValue(VSMT)
  readDistinctValues.mockResolvedValue(['C1', 'C2'])
})

describe('tablaDelAtributo', () => {
  // Una tabla que no tiene el campo contesta 400; la que sí, devuelve una fila.
  it('prueba las tablas del área y se queda con la primera que devuelve el campo', async () => {
    readEntityPage.mockImplementation(async ({ entidad }) => {
      if (entidad === 'AS1CUSTOMER') return [{ CUSTID: 'C1' }]
      throw Object.assign(new Error('SAP devolvió 400'), { status: 400 })
    })

    await expect(tablaDelAtributo({ ...ctx, campo: 'CUSTID' })).resolves.toBe('AS1CUSTOMER')
    // Solo las del área, sin repetir la misma tabla de dos versiones, y con una fila como mucho.
    const probadas = readEntityPage.mock.calls.map(([una]) => una.entidad)
    expect(probadas.sort()).toEqual(['AS1CUSTOMER', 'AS1LOCATION', 'AS1PRODUCT'])
    expect(readEntityPage.mock.calls[0][0]).toMatchObject({ select: ['CUSTID'], top: 1 })
  })

  it('una tabla con el campo pero vacía no cuenta', async () => {
    readEntityPage.mockResolvedValue([])
    await expect(tablaDelAtributo({ ...ctx, campo: 'CUSTID' })).resolves.toBeNull()
  })

  it('de cuatro en cuatro: si la primera tanda acierta, no se prueba la siguiente', async () => {
    readVsmt.mockResolvedValue(['T1', 'T2', 'T3', 'T4', 'T5', 'T6'].map((tabla) => ({ PlanningAreaID: 'ASIBPTS', MasterDataTypeID: tabla })))
    readEntityPage.mockImplementation(async ({ entidad }) => (entidad === 'T2' ? [{ X: 1 }] : []))

    await expect(tablaDelAtributo({ ...ctx, campo: 'X' })).resolves.toBe('T2')
    expect(readEntityPage).toHaveBeenCalledTimes(4)
  })
})

describe('readAttrDistinctValues', () => {
  it('busca la tabla y devuelve sus valores, con la tabla para recordarla', async () => {
    readEntityPage.mockImplementation(async ({ entidad }) => (entidad === 'AS1CUSTOMER' ? [{ CUSTID: 'C1' }] : []))

    await expect(readAttrDistinctValues({ ...ctx, campo: 'CUSTID' }))
      .resolves.toEqual({ tabla: 'AS1CUSTOMER', valores: ['C1', 'C2'] })
    expect(readDistinctValues).toHaveBeenCalledWith(expect.objectContaining({ entidad: 'AS1CUSTOMER', campo: 'CUSTID' }))
  })

  it('con una tabla ya conocida no vuelve a probar', async () => {
    await readAttrDistinctValues({ ...ctx, campo: 'CUSTID', tabla: 'AS1CUSTOMER' })
    expect(readVsmt).not.toHaveBeenCalled()
    expect(readEntityPage).not.toHaveBeenCalled()
  })

  it('sin tabla que tenga el campo, lista vacía y no un error', async () => {
    readEntityPage.mockResolvedValue([])
    await expect(readAttrDistinctValues({ ...ctx, campo: 'NADA' })).resolves.toEqual({ tabla: null, valores: [] })
    expect(readDistinctValues).not.toHaveBeenCalled()
  })

  // El campo y la tabla van a la dirección de SAP.
  it('un nombre que no es de campo no llega a SAP', async () => {
    await expect(readAttrDistinctValues({ ...ctx, campo: 'X&$top=0' })).rejects.toThrow(/no es válido/)
    readEntityPage.mockResolvedValue([])
    await readAttrDistinctValues({ ...ctx, campo: 'CUSTID', tabla: 'AS1?x=1' })
    expect(readVsmt).toHaveBeenCalled()
  })
})
