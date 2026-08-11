import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./master-data.js', () => ({
  readEntityPage: vi.fn(),
  readVsmt: vi.fn(),
}))

const { readEntityPage, readVsmt } = await import('./master-data.js')
const {
  CONVERSIONES, mdtsDelArea, readConversionValues, tablaDeConversion,
} = await import('./conversion-values.js')

const ctx = { baseUrl: 'https://t', credentials: { user: 'u' }, area: 'ASIBPTS' }

const VSMT = [
  { PlanningAreaID: 'ASIBPTS', VersionID: 'V1', MasterDataTypeID: 'AS1UOMTO' },
  { PlanningAreaID: 'ASIBPTS', VersionID: 'V1', MasterDataTypeID: 'AS1PRODUCT' },
  { PlanningAreaID: 'ASIBPTS', VersionID: 'V2', MasterDataTypeID: 'AS1CURRENCYTO' },
  { PlanningAreaID: 'OTRA', VersionID: 'V1', MasterDataTypeID: 'GIDUOMTO' },
]

beforeEach(() => {
  vi.clearAllMocks()
  readVsmt.mockResolvedValue(VSMT)
  readEntityPage.mockResolvedValue([
    { UOMTOID: 'KG', UOMTODESCR: 'Kilogramo' },
    { UOMTOID: 'EA', UOMTODESCR: 'Unidad' },
  ])
})

describe('tablaDeConversion', () => {
  // El prefijo es del tenant: AS1UOMTO, GIDUOMTO, GMXUOMTO. Fijar un nombre no funciona.
  it('busca por sufijo, no por nombre', () => {
    expect(tablaDeConversion(['AS1PRODUCT', 'AS1UOMTO'], 'UOMTO')).toBe('AS1UOMTO')
    expect(tablaDeConversion(['GIDUOMTO'], 'UOMTO')).toBe('GIDUOMTO')
  })

  it('no distingue mayúsculas', () => {
    expect(tablaDeConversion(['as1uomto'], 'UOMTO')).toBe('as1uomto')
  })

  // El atributo es CURRTOID pero la tabla acaba en CURRENCYTO. Es de SAP, no un error.
  it('la moneda se busca por CURRENCYTO', () => {
    expect(tablaDeConversion(['AS1CURRENCYTO', 'AS1CURRENCY'], 'CURRENCYTO')).toBe('AS1CURRENCYTO')
  })

  it('sin tabla que acabe así devuelve null', () => {
    expect(tablaDeConversion(['AS1PRODUCT'], 'UOMTO')).toBe(null)
    expect(tablaDeConversion([], 'UOMTO')).toBe(null)
    expect(tablaDeConversion(undefined, 'UOMTO')).toBe(null)
  })

  it('sin sufijo no adivina', () => {
    expect(tablaDeConversion(['AS1UOMTO'], '')).toBe(null)
  })
})

describe('mdtsDelArea', () => {
  it('junta las tablas de todas las versiones del área, sin repetir', () => {
    const catalogo = {
      A: { versions: [{ mdts: ['UNO', 'DOS'] }, { mdts: ['DOS', 'TRES'] }] },
    }
    expect(mdtsDelArea(catalogo, 'A').sort()).toEqual(['DOS', 'TRES', 'UNO'])
  })

  it('un área que no está no revienta', () => {
    expect(mdtsDelArea({}, 'A')).toEqual([])
    expect(mdtsDelArea(undefined, 'A')).toEqual([])
  })
})

describe('readConversionValues', () => {
  it('trae los valores con su descripción, ordenados', async () => {
    await expect(readConversionValues({ ...ctx, atributo: 'UOMTOID' })).resolves.toEqual([
      { id: 'EA', descripcion: 'Unidad' },
      { id: 'KG', descripcion: 'Kilogramo' },
    ])
  })

  it('lee la tabla del área elegida y solo sus dos campos', async () => {
    await readConversionValues({ ...ctx, atributo: 'UOMTOID' })

    expect(readEntityPage).toHaveBeenCalledWith(expect.objectContaining({
      entidad: 'AS1UOMTO',
      planningArea: 'ASIBPTS',
      select: ['UOMTOID', 'UOMTODESCR'],
    }))
  })

  // La tabla es específica de versión: el mismo valor sale una vez por versión del área.
  it('no repite un valor que aparece en varias versiones', async () => {
    readEntityPage.mockResolvedValue([
      { UOMTOID: 'KG', UOMTODESCR: 'Kilogramo' },
      { UOMTOID: 'KG', UOMTODESCR: 'Kilogramo' },
    ])
    await expect(readConversionValues({ ...ctx, atributo: 'UOMTOID' })).resolves.toHaveLength(1)
  })

  it('sin descripción usa el propio identificador', async () => {
    readEntityPage.mockResolvedValue([{ UOMTOID: 'KG' }])
    await expect(readConversionValues({ ...ctx, atributo: 'UOMTOID' }))
      .resolves.toEqual([{ id: 'KG', descripcion: 'KG' }])
  })

  it('descarta las filas sin identificador', async () => {
    readEntityPage.mockResolvedValue([{ UOMTOID: '' }, { UOMTOID: 'KG' }])
    await expect(readConversionValues({ ...ctx, atributo: 'UOMTOID' })).resolves.toHaveLength(1)
  })

  // Ofrecer los valores es una comodidad: romper la pantalla por no poder rellenar un desplegable
  // seria peor que no tenerlo.
  it('un tenant sin esa tabla devuelve lista vacía, no un error', async () => {
    readVsmt.mockResolvedValue([{ PlanningAreaID: 'ASIBPTS', VersionID: 'V1', MasterDataTypeID: 'AS1PRODUCT' }])
    await expect(readConversionValues({ ...ctx, atributo: 'UOMTOID' })).resolves.toEqual([])
    expect(readEntityPage).not.toHaveBeenCalled()
  })

  it('si la lectura falla devuelve lista vacía', async () => {
    readEntityPage.mockRejectedValue(new Error('403'))
    await expect(readConversionValues({ ...ctx, atributo: 'UOMTOID' })).resolves.toEqual([])
  })

  it('un atributo que no es de conversión no consulta nada', async () => {
    await expect(readConversionValues({ ...ctx, atributo: 'PRDID' })).resolves.toEqual([])
    expect(readVsmt).not.toHaveBeenCalled()
  })

  it('los dos atributos de conversión están declarados', () => {
    expect(Object.keys(CONVERSIONES)).toEqual(['UOMTOID', 'CURRTOID'])
  })
})
