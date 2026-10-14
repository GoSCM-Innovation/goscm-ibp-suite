import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInMemoryRedis } from '../persistence/redis-in-memory.js'
import {
  ACUERDOS_IBP,
  conCache,
  construirResumen,
  contextoIbp,
  leerCamposDeMaestro,
  leerCatalogo,
  leerCifrasDeArea,
  leerResumen,
  leerValores,
} from './ibp-catalogo.js'
import { assertConexionCi } from './integrations.js'
import { getAnyCredentials, getConnectionTarget } from '../connections/connections.js'

const entorno = vi.hoisted(() => ({ redis: null }))

vi.mock('../persistence/redis.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getRedis: () => entorno.redis }
})
vi.mock('./integrations.js', () => ({ assertConexionCi: vi.fn() }))
vi.mock('../connections/connections.js', () => ({ getAnyCredentials: vi.fn(), getConnectionTarget: vi.fn() }))

const CLIENTE = 'c-1'
const CI = 'ci-1'
const IBP = 'ibp-1'

// Lo que devuelve el catálogo de dato maestro (VSMT) de un tenant: dos áreas, una con dos versiones.
const VSMT = [
  { PlanningAreaID: 'AREA1', PlanningAreaDescr: 'Unified Planning Area', VersionID: 'PVSMD', VersionName: 'Versión con maestro', MasterDataTypeID: 'ABPRODUCT' },
  { PlanningAreaID: 'AREA1', PlanningAreaDescr: 'Unified Planning Area', VersionID: 'PVSMD', VersionName: 'Versión con maestro', MasterDataTypeID: 'ABLOCATION' },
  { PlanningAreaID: 'AREA1', PlanningAreaDescr: 'Unified Planning Area', VersionID: 'PVSMD', VersionName: 'Versión con maestro', MasterDataTypeID: 'ABREFERENCIA' },
  { PlanningAreaID: 'AREA1', PlanningAreaDescr: 'Unified Planning Area', VersionID: 'SOPMTH', VersionName: 'SOP Mensual', MasterDataTypeID: 'ABPRODUCT' },
  { PlanningAreaID: 'AREA2', PlanningAreaDescr: 'AREA2', VersionID: 'PVSMD', VersionName: 'PVSMD', MasterDataTypeID: 'CDPRODUCT' },
  { PlanningAreaID: 'AREA2', PlanningAreaDescr: 'AREA2', VersionID: 'PVSMD', VersionName: 'PVSMD', MasterDataTypeID: 'CDLOCATION' },
]
const VERSIONES_AREA1 = [
  { id: '__BASELINE', name: 'Base Version' },
  { id: 'PVSMD', name: 'Planning Version with Version-Specific Master Data' },
  { id: 'SOPMTH', name: 'SOP Mensual' },
  { id: 'UPSIDE', name: 'Upside Version' },
]
const CTX = { baseUrl: 'https://tenant-api.scmibp1.ondemand.com', credentials: { user: 'u', password: 'p' } }

const lecturasQue = (cambios = {}) => ({
  readPlanningAreas: vi.fn(async () => ['AREA1', 'AREA2']),
  readVersions: vi.fn(async ({ area }) => (area === 'AREA1' ? VERSIONES_AREA1 : [{ id: '__BASELINE', name: 'Base Version' }])),
  readVsmt: vi.fn(async () => VSMT),
  readImportableMdts: vi.fn(async () => ['ABLOCATION', 'ABPRODUCT', 'CDLOCATION', 'CDPRODUCT']),
  readKfMetadata: vi.fn(async () => ({
    dims: ['LOCID', 'PERIODID0_TSTAMP', 'PERIODID2_TSTAMP', 'PRDID'],
    cifras: ['ZFACTURAS', 'ZSINETIQUETA'],
    etiquetas: { LOCID: 'Location ID', PRDID: 'Product ID', ZFACTURAS: 'Facturas', ZSINETIQUETA: 'ZSINETIQUETA' },
  })),
  readDistinctValues: vi.fn(async () => ['ZFER', 'ZHAW']),
  readAttrDistinctValues: vi.fn(async () => ({ tabla: 'ABPRODUCT', valores: ['ZFER'] })),
  leerMetadataDeMaestro: vi.fn(async () => '<EntitySet Name="ABPRODUCT" EntityType="IBP.ABPType"/><EntityType Name="ABPType"><Property Name="PRDID" Type="Edm.String" MaxLength="60" sap:label="Product ID"/></EntityType>'),
  ...cambios,
})

beforeEach(() => {
  vi.clearAllMocks()
  entorno.redis = createInMemoryRedis()
  assertConexionCi.mockResolvedValue({ id: CI, kind: 'ci', name: 'CPI dev', ibpConnectionId: IBP })
  getConnectionTarget.mockResolvedValue({ id: IBP, kind: 'ibp', name: 'IBP QAS', baseUrl: CTX.baseUrl })
  getAnyCredentials.mockResolvedValue(CTX.credentials)
})

describe('contextoIbp', () => {
  it('resuelve el IBP de la conexión y sus credenciales, con los acuerdos de los servicios de datos', async () => {
    const { ibp, ctx } = await contextoIbp(CLIENTE, CI)
    expect(ibp).toEqual({ id: IBP, nombre: 'IBP QAS' })
    expect(ctx).toEqual(CTX)
    expect(getAnyCredentials).toHaveBeenCalledWith(CLIENTE, IBP, ['SAP_COM_0720', 'SAP_COM_0326'])
    expect(ACUERDOS_IBP).toEqual(['SAP_COM_0720', 'SAP_COM_0326'])
  })

  it('busca el IBP con el cliente puesto: uno de otro cliente no existe', async () => {
    getConnectionTarget.mockRejectedValue(new Error('La conexión no existe para este cliente.'))
    await expect(contextoIbp(CLIENTE, CI)).rejects.toThrow(/no existe/)
    expect(getConnectionTarget).toHaveBeenCalledWith(CLIENTE, IBP)
    expect(getAnyCredentials).not.toHaveBeenCalled()
  })

  it('sin IBP de destino lo dice y dónde elegirlo, con 409', async () => {
    assertConexionCi.mockResolvedValue({ id: CI, kind: 'ci', name: 'CPI dev', ibpConnectionId: null })
    await expect(contextoIbp(CLIENTE, CI)).rejects.toMatchObject({
      statusCode: 409,
      codigo: 'sin-vinculo',
      message: expect.stringMatching(/«CPI dev» no tiene un IBP de destino.*Administración → Conexiones/),
    })
    expect(getConnectionTarget).not.toHaveBeenCalled()
  })

  it('si el destino ya no es de IBP, lo dice', async () => {
    getConnectionTarget.mockResolvedValue({ id: IBP, kind: 'cids', name: 'Otra' })
    await expect(contextoIbp(CLIENTE, CI)).rejects.toThrow(/«Otra» ya no es una conexión de SAP IBP/)
  })

  it('una conexión que no es de CI no llega a nada', async () => {
    assertConexionCi.mockRejectedValue(new Error('no es de Cloud Integration'))
    await expect(contextoIbp(CLIENTE, CI)).rejects.toThrow(/Cloud Integration/)
  })
})

describe('construirResumen', () => {
  const resumen = () => construirResumen({
    areasDeCifras: ['AREA1', 'AREA2'],
    versionesDeCifras: { AREA1: VERSIONES_AREA1, AREA2: [{ id: '__BASELINE', name: 'Base Version' }] },
    vsmt: VSMT,
    importables: ['ABLOCATION', 'ABPRODUCT', 'CDLOCATION', 'CDPRODUCT'],
  })

  it('una entrada por área, con su descripción y su prefijo', () => {
    const [area1, area2] = resumen()
    expect(area1).toMatchObject({ id: 'AREA1', descripcion: 'Unified Planning Area', deCifras: true, prefijo: 'AB' })
    expect(area2).toMatchObject({ id: 'AREA2', descripcion: '', prefijo: 'CD' })
  })

  it('la base va primera y con el valor que lleva en el body: vacío', () => {
    expect(resumen()[0].versiones[0]).toEqual({ id: '', nombre: 'Versión base (vacío)' })
  })

  it('las versiones salen del servicio de cifras con su nombre, sin repetir la base, y se completan con las del maestro', () => {
    const ids = resumen()[0].versiones.map((v) => v.id)
    expect(ids).toEqual(['', 'PVSMD', 'SOPMTH', 'UPSIDE'])
    expect(resumen()[0].versiones[1].nombre).toBe('Planning Version with Version-Specific Master Data')
  })

  it('una versión que solo conoce el catálogo de maestro también se ofrece', () => {
    const r = construirResumen({ areasDeCifras: ['A'], versionesDeCifras: { A: [] }, vsmt: [
      { PlanningAreaID: 'A', VersionID: 'V1', VersionName: 'Una', MasterDataTypeID: 'XXPRODUCT' },
      { PlanningAreaID: 'A', VersionID: 'V1', VersionName: 'Una', MasterDataTypeID: 'XXLOCATION' },
    ] })
    expect(r[0].versiones.map((v) => v.id)).toEqual(['', 'V1'])
  })

  it('las tablas de cada versión son las de esa versión, y la base reúne las de todas', () => {
    const { tipos } = resumen()[0]
    expect(tipos.PVSMD).toEqual(['ABLOCATION', 'ABPRODUCT'])
    expect(tipos.SOPMTH).toEqual(['ABPRODUCT'])
    expect(tipos['']).toEqual(['ABLOCATION', 'ABPRODUCT'])
  })

  it('una versión sin maestro propio usa las tablas de todas, como la base', () => {
    expect(resumen()[0].tipos.UPSIDE).toEqual(['ABLOCATION', 'ABPRODUCT'])
  })

  // Ofrecer una tabla que no se puede cargar es prometer algo que falla al final.
  it('solo se ofrecen las tablas que se pueden cargar', () => {
    for (const lista of Object.values(resumen()[0].tipos)) expect(lista).not.toContain('ABREFERENCIA')
  })

  it('si no se supo cuáles se pueden cargar, se ofrecen todas', () => {
    const r = construirResumen({ areasDeCifras: ['AREA1'], versionesDeCifras: {}, vsmt: VSMT, importables: [] })
    expect(r[0].tipos.PVSMD).toContain('ABREFERENCIA')
  })

  it('un área que solo existe en el catálogo de maestro se ofrece, marcada como tal', () => {
    const r = construirResumen({ areasDeCifras: [], versionesDeCifras: {}, vsmt: VSMT, importables: [] })
    expect(r.map((a) => a.id)).toEqual(['AREA1', 'AREA2'])
    expect(r[0].deCifras).toBe(false)
  })

  it('sin nada devuelve una lista vacía', () => {
    expect(construirResumen({})).toEqual([])
  })
})

describe('leerResumen', () => {
  it('arma el resumen con las tres lecturas y pide las versiones de cada área', async () => {
    const lecturas = lecturasQue()
    const { areas, avisos } = await leerResumen(CTX, { lecturas })

    expect(areas.map((a) => a.id)).toEqual(['AREA1', 'AREA2'])
    expect(avisos).toEqual([])
    expect(lecturas.readVersions).toHaveBeenCalledTimes(2)
    expect(lecturas.readVersions).toHaveBeenCalledWith({ ...CTX, area: 'AREA1' })
  })

  // Cada servicio se habilita por separado en el acuerdo: lo que conteste alcanza.
  it('si el servicio de cifras falla, arma lo posible con el de maestro y lo avisa', async () => {
    const lecturas = lecturasQue({
      readPlanningAreas: vi.fn().mockRejectedValue(Object.assign(new Error('SAP devolvió 500'), { detail: 'You need to set a business user' })),
    })
    const { areas, avisos } = await leerResumen(CTX, { lecturas })

    expect(areas.map((a) => a.id)).toEqual(['AREA1', 'AREA2'])
    expect(avisos[0]).toMatch(/cifras clave.*SAP devolvió 500: You need to set a business user/)
    expect(lecturas.readVersions).not.toHaveBeenCalled()
  })

  it('si el de maestro falla, ofrece las áreas del de cifras y lo avisa', async () => {
    const lecturas = lecturasQue({ readVsmt: vi.fn().mockRejectedValue(new Error('SAP devolvió 403')) })
    const { areas, avisos } = await leerResumen(CTX, { lecturas })
    expect(areas.map((a) => a.id)).toEqual(['AREA1', 'AREA2'])
    expect(avisos[0]).toMatch(/dato maestro.*403/)
  })

  it('una versión que no se pudo leer no tumba el resto', async () => {
    const lecturas = lecturasQue({ readVersions: vi.fn().mockRejectedValue(new Error('x')) })
    const { areas } = await leerResumen(CTX, { lecturas })
    expect(areas[0].versiones.map((v) => v.id)).toEqual(['', 'PVSMD', 'SOPMTH'])
  })

  it('una lectura de tablas importables que falla no impide el resumen', async () => {
    const lecturas = lecturasQue({ readImportableMdts: vi.fn().mockRejectedValue(new Error('x')) })
    const { areas } = await leerResumen(CTX, { lecturas })
    expect(areas[0].tipos.PVSMD).toContain('ABREFERENCIA')
  })

  it('si no contesta ninguno de los dos servicios, falla con el motivo', async () => {
    const lecturas = lecturasQue({
      readPlanningAreas: vi.fn().mockRejectedValue(new Error('uno')),
      readVsmt: vi.fn().mockRejectedValue(Object.assign(new Error('SAP devolvió 403'), { status: 403 })),
    })
    await expect(leerResumen(CTX, { lecturas })).rejects.toMatchObject({ status: 403 })
  })
})

describe('leerCamposDeMaestro', () => {
  it('devuelve los campos de la tabla con su etiqueta', async () => {
    const r = await leerCamposDeMaestro(CTX, 'ABPRODUCT', { lecturas: lecturasQue() })
    expect(r).toEqual({ entidad: 'ABPRODUCT', campos: [{ campo: 'PRDID', etiqueta: 'Product ID', tipo: 'NVARCHAR(60)', sistema: false }] })
  })

  it('una tabla que IBP no declara se dice', async () => {
    await expect(leerCamposDeMaestro(CTX, 'ABNADA', { lecturas: lecturasQue() })).rejects.toThrow(/«ABNADA» no existe en este IBP/)
  })

  // El nombre se pega en una URL: con un `/` o un `?` cambiaría a qué se llama con las credenciales.
  it.each(['AB/../X', 'AB?x=1', 'AB&y', 'A B', '', undefined])('un nombre que no es de tabla (%j) no llega a IBP', async (nombre) => {
    const lecturas = lecturasQue()
    await expect(leerCamposDeMaestro(CTX, nombre, { lecturas })).rejects.toThrow(/no es válido/)
    expect(lecturas.leerMetadataDeMaestro).not.toHaveBeenCalled()
  })
})

describe('leerCifrasDeArea', () => {
  it('separa dimensiones, cifras y campos de periodo, con sus etiquetas', async () => {
    const r = await leerCifrasDeArea(CTX, 'AREA1', { lecturas: lecturasQue() })
    expect(r.dims).toEqual([{ campo: 'LOCID', etiqueta: 'Location ID' }, { campo: 'PRDID', etiqueta: 'Product ID' }])
    expect(r.niveles).toEqual(['PERIODID0_TSTAMP', 'PERIODID2_TSTAMP'])
    expect(r.cifras[0]).toEqual({ campo: 'ZFACTURAS', etiqueta: 'Facturas' })
  })

  it('una etiqueta igual al campo se deja vacía: no aporta nada', async () => {
    const r = await leerCifrasDeArea(CTX, 'AREA1', { lecturas: lecturasQue() })
    expect(r.cifras[1]).toEqual({ campo: 'ZSINETIQUETA', etiqueta: '' })
  })

  it.each(['A/B', 'A?x', '', undefined])('un área que no es un nombre (%j) no llega a IBP', async (area) => {
    const lecturas = lecturasQue()
    await expect(leerCifrasDeArea(CTX, area, { lecturas })).rejects.toThrow(/no es válido/)
    expect(lecturas.readKfMetadata).not.toHaveBeenCalled()
  })
})

describe('leerValores', () => {
  it('con tabla lee sus valores', async () => {
    const lecturas = lecturasQue()
    const r = await leerValores(CTX, { entidad: 'ABPRODUCT', campo: 'MATTYPEID' }, { lecturas })
    expect(r).toMatchObject({ tabla: 'ABPRODUCT', valores: ['ZFER', 'ZHAW'], truncado: false })
    expect(lecturas.readDistinctValues).toHaveBeenCalledWith(expect.objectContaining({ entidad: 'ABPRODUCT', campo: 'MATTYPEID', top: 5000 }))
  })

  it('sin tabla busca la del área que tenga el campo', async () => {
    const lecturas = lecturasQue()
    const r = await leerValores(CTX, { area: 'AREA1', campo: 'MATTYPEID' }, { lecturas })
    expect(r).toMatchObject({ tabla: 'ABPRODUCT', valores: ['ZFER'] })
    expect(lecturas.readAttrDistinctValues).toHaveBeenCalledWith(expect.objectContaining({ area: 'AREA1', campo: 'MATTYPEID' }))
  })

  it('un campo que no es de IBP devuelve una lista vacía y un motivo, no un error', async () => {
    const lecturas = lecturasQue({ readDistinctValues: vi.fn().mockRejectedValue(Object.assign(new Error('SAP devolvió 400'), { status: 400 })) })
    const r = await leerValores(CTX, { entidad: 'ABPRODUCT', campo: 'ZVIGENTE' }, { lecturas })
    expect(r).toMatchObject({ valores: [], motivo: expect.stringMatching(/no existe en IBP.*a mano/) })
  })

  // Lo que contestó un tenant real: no un 400, sino un 404 que nombra el campo.
  it('SAP contesta 404 «Resource not found for the segment» cuando el campo no existe: igual, lista vacía y motivo', async () => {
    const fallo = Object.assign(new Error('SAP devolvió 404'), { status: 404, detail: "[0050] Resource not found for the segment 'ZVIGENTE'." })
    const lecturas = lecturasQue({ readDistinctValues: vi.fn().mockRejectedValue(fallo) })
    const r = await leerValores(CTX, { entidad: 'ABPRODUCT', campo: 'ZVIGENTE' }, { lecturas })
    expect(r).toMatchObject({ valores: [], motivo: expect.stringMatching(/no existe en IBP.*a mano/) })
  })

  it('un 404 que no nombra el campo (la tabla no existe) se deja pasar', async () => {
    const fallo = Object.assign(new Error('SAP devolvió 404'), { status: 404, detail: "Resource not found for the segment 'ABNADA'." })
    const lecturas = lecturasQue({ readDistinctValues: vi.fn().mockRejectedValue(fallo) })
    await expect(leerValores(CTX, { entidad: 'ABNADA', campo: 'MATTYPEID' }, { lecturas })).rejects.toMatchObject({ status: 404 })
  })

  it('un fallo que no es del campo se deja pasar', async () => {
    const lecturas = lecturasQue({ readDistinctValues: vi.fn().mockRejectedValue(Object.assign(new Error('SAP devolvió 403'), { status: 403 })) })
    await expect(leerValores(CTX, { entidad: 'ABPRODUCT', campo: 'X' }, { lecturas })).rejects.toMatchObject({ status: 403 })
  })

  it('sin valores lo dice', async () => {
    const lecturas = lecturasQue({ readDistinctValues: vi.fn(async () => []) })
    expect((await leerValores(CTX, { entidad: 'ABPRODUCT', campo: 'X' }, { lecturas })).motivo).toMatch(/no tiene valores/)
  })

  it('avisa cuando el tope cortó la lista', async () => {
    const lecturas = lecturasQue({ readDistinctValues: vi.fn(async () => Array.from({ length: 5000 }, (_v, i) => `V${i}`)) })
    expect((await leerValores(CTX, { entidad: 'ABPRODUCT', campo: 'X' }, { lecturas })).truncado).toBe(true)
  })

  it.each([
    [{ entidad: 'A/B', campo: 'X' }],
    [{ entidad: 'AB', campo: "X' or 1=1" }],
    [{ area: 'A?b', campo: 'X' }],
    [{ campo: 'X' }],
  ])('lo que no es un nombre, o no dice dónde buscar (%j), no llega a IBP', async (peticion) => {
    const lecturas = lecturasQue()
    await expect(leerValores(CTX, peticion, { lecturas })).rejects.toThrow()
    expect(lecturas.readDistinctValues).not.toHaveBeenCalled()
    expect(lecturas.readAttrDistinctValues).not.toHaveBeenCalled()
  })
})

describe('conCache', () => {
  it('la segunda vez no vuelve a leer', async () => {
    const hacer = vi.fn(async () => ({ a: 1 }))
    expect(await conCache(CLIENTE, [IBP, 'x'], hacer)).toEqual({ a: 1 })
    expect(await conCache(CLIENTE, [IBP, 'x'], hacer)).toEqual({ a: 1 })
    expect(hacer).toHaveBeenCalledTimes(1)
  })

  it('«actualizar» salta lo guardado y lo reemplaza', async () => {
    const hacer = vi.fn().mockResolvedValueOnce({ v: 1 }).mockResolvedValueOnce({ v: 2 })
    await conCache(CLIENTE, [IBP, 'x'], hacer)
    expect(await conCache(CLIENTE, [IBP, 'x'], hacer, { actualizar: true })).toEqual({ v: 2 })
    expect(await conCache(CLIENTE, [IBP, 'x'], hacer)).toEqual({ v: 2 })
  })

  it('lo guardado es por cliente y por IBP', async () => {
    const hacer = vi.fn(async () => ({ ok: true }))
    await conCache('c-1', ['ibp-A', 'x'], hacer)
    await conCache('c-2', ['ibp-A', 'x'], hacer)
    await conCache('c-1', ['ibp-B', 'x'], hacer)
    expect(hacer).toHaveBeenCalledTimes(3)
    expect(entorno.redis.keys().sort()).toEqual([
      'c:c-1:ci-ibp:ibp-A:x', 'c:c-1:ci-ibp:ibp-B:x', 'c:c-2:ci-ibp:ibp-A:x',
    ])
  })

  it('vence a los 30 minutos', async () => {
    await conCache(CLIENTE, [IBP, 'x'], async () => ({ a: 1 }))
    expect(await entorno.redis.ttl(`c:${CLIENTE}:ci-ibp:${IBP}:x`)).toBeLessThanOrEqual(30 * 60)
  })

  // El catálogo es una comodidad: no puede depender de que el caché esté arriba.
  it('si Redis falla, lee igual', async () => {
    entorno.redis = { get: vi.fn().mockRejectedValue(new Error('caído')), set: vi.fn().mockRejectedValue(new Error('caído')) }
    expect(await conCache(CLIENTE, [IBP, 'x'], async () => ({ a: 1 }))).toEqual({ a: 1 })
  })
})

describe('leerCatalogo', () => {
  const pedir = (extra) => leerCatalogo({ clientId: CLIENTE, connectionId: CI, ...extra }, { lecturas: lecturasQue() })

  it('el resumen dice contra qué IBP se sugiere', async () => {
    const r = await pedir({ accion: 'resumen' })
    expect(r.ibp).toEqual({ id: IBP, nombre: 'IBP QAS' })
    expect(r.areas).toHaveLength(2)
  })

  it('los campos y las cifras se guardan por tabla y por área', async () => {
    await pedir({ accion: 'campos-maestro', entidad: 'ABPRODUCT' })
    await pedir({ accion: 'cifras', area: 'AREA1' })
    expect(entorno.redis.keys().sort()).toEqual([`c:${CLIENTE}:ci-ibp:${IBP}:campos:ABPRODUCT`, `c:${CLIENTE}:ci-ibp:${IBP}:cifras:AREA1`])
  })

  // Los valores son datos del cliente: no se guardan.
  it('los valores NO se guardan', async () => {
    await pedir({ accion: 'valores', entidad: 'ABPRODUCT', campo: 'MATTYPEID' })
    expect(entorno.redis.keys()).toEqual([])
  })

  it('una acción desconocida se rechaza', async () => {
    await expect(pedir({ accion: 'borrar-todo' })).rejects.toThrow(/Acción desconocida/)
  })

  it('un nombre inválido se rechaza ANTES de leer o guardar nada', async () => {
    await expect(pedir({ accion: 'campos-maestro', entidad: 'A/B' })).rejects.toThrow(/no es válido/)
    await expect(pedir({ accion: 'cifras', area: 'A?x' })).rejects.toThrow(/no es válido/)
    expect(entorno.redis.keys()).toEqual([])
  })
})
