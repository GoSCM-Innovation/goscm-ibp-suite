// El ejemplo de IBP de cada campo: muestra de 50, escalado a 200 y consulta dirigida.
// Portado de `enrichMappingsFromIbp` de v9. Antes se pedía una sola fila y los campos que esa fila
// tenía vacíos salían en blanco en el Excel.

import { describe, expect, it, vi } from 'vitest'

import { enrichAll, nuevaCache } from './ibp-enrich.js'

const catalogo = (extra = {}) => ({
  entitySets: [
    { service: 'MASTER_DATA_API_SRV', name: 'PRODUCT', nameUC: 'PRODUCT' },
    { service: 'PLANNING_DATA_API_SRV', name: 'SAP1', nameUC: 'SAP1' },
  ],
  entityProps: { SAP1: new Set(['PRDID', 'KF1']) },
  types: { PRDID: 'NVARCHAR(20)', BRAND: 'NVARCHAR(20)', ABCID: 'NVARCHAR(5)', KF1: 'DECIMAL(15,2)' },
  descs: {},
  ...extra,
})

const entrada = (campos, extra = {}) => ({
  sheetName: 'H1',
  parsed: {
    jobName: 'J1',
    tipoIntegracion: 'MD',
    targetTable: 'SOPMD_STAG_PRODUCT',
    planArea: 'SAP1',
    mappings: campos.map((dstField) => ({ dstField, dstDesc: '' })),
    ...extra,
  },
})

const ejemplos = (resultado) => Object.fromEntries(
  resultado.entradas[0].parsed.mappings.map((m) => [m.dstField, m.ibpExample]),
)

describe('la muestra de 50 y el escalado a 200', () => {
  it('pide primero 50 filas', async () => {
    const pedirFila = vi.fn(async () => ({ row: { PRDID: 'P1' }, detail: '' }))
    await enrichAll([entrada(['PRDID'])], catalogo(), pedirFila, '')
    expect(pedirFila).toHaveBeenCalledTimes(1)
    expect(pedirFila.mock.calls[0][0]).toMatchObject({ entitySet: 'PRODUCT', top: 50 })
  })

  it('si con 50 cubre todos los campos, NO escala', async () => {
    const pedirFila = vi.fn(async () => ({ row: { PRDID: 'P1', BRAND: 'M' }, detail: '' }))
    await enrichAll([entrada(['PRDID', 'BRAND'])], catalogo(), pedirFila, '')
    expect(pedirFila).toHaveBeenCalledTimes(1)
  })

  it('si con 50 faltan campos, pide también 200 y junta lo de las dos', async () => {
    const pedirFila = vi.fn(async ({ top }) => ({
      row: top === 50 ? { PRDID: 'P1' } : { PRDID: 'OTRO', BRAND: 'MARCA' },
      detail: '',
    }))
    const resultado = await enrichAll([entrada(['PRDID', 'BRAND'])], catalogo(), pedirFila, '')

    expect(pedirFila.mock.calls.map((c) => c[0].top)).toEqual([50, 200])
    // Lo visto con 50 manda; la de 200 solo completa lo que faltaba.
    expect(ejemplos(resultado)).toEqual({ PRDID: 'P1', BRAND: 'MARCA' })
  })

  it('no repite una consulta que ya hizo para otra integración de la misma entidad', async () => {
    const pedirFila = vi.fn(async () => ({ row: { PRDID: 'P1' }, detail: '' }))
    await enrichAll([entrada(['PRDID', 'BRAND']), { ...entrada(['PRDID', 'BRAND']), sheetName: 'H2' }], catalogo(), pedirFila, '')
    // Dos tamaños para la primera; la segunda reutiliza ambos.
    expect(pedirFila).toHaveBeenCalledTimes(2)
  })

  it('un campo que ya se vio en otra tabla no vuelve a consultarse', async () => {
    const pedirFila = vi.fn(async () => ({ row: { PRDID: 'P1' }, detail: '' }))
    const otra = { ...entrada(['PRDID']), sheetName: 'H2', parsed: { ...entrada(['PRDID']).parsed, targetTable: 'SOPMD_STAG_OTRA' } }
    await enrichAll([entrada(['PRDID']), otra], catalogo(), pedirFila, '')
    expect(pedirFila).toHaveBeenCalledTimes(1)
  })

  it('avisa con el motivo y el tamaño cuando SAP no contesta', async () => {
    const pedirFila = vi.fn(async () => ({ row: null, detail: 'falta el área' }))
    const resultado = await enrichAll([entrada(['PRDID'])], catalogo(), pedirFila, '')
    expect(resultado.avisos.some((a) => a.includes('falta el área') && a.includes('top 50'))).toBe(true)
  })
})

describe('la consulta dirigida', () => {
  const sinNada = async () => ({ row: { PRDID: 'P1' }, detail: '' })

  it('rellena un campo de texto que la muestra dejó vacío', async () => {
    const pedirCampo = vi.fn(async () => 'MARCA')
    const resultado = await enrichAll([entrada(['PRDID', 'BRAND'])], catalogo(), sinNada, '', pedirCampo)

    expect(pedirCampo).toHaveBeenCalledWith({ entitySet: 'PRODUCT', planArea: 'SAP1', field: 'BRAND' })
    expect(ejemplos(resultado).BRAND).toBe('MARCA')
  })

  it('una sola vez por campo en toda la corrida, aunque no salga nada', async () => {
    const pedirCampo = vi.fn(async () => null)
    const otra = { ...entrada(['BRAND']), sheetName: 'H2', parsed: { ...entrada(['BRAND']).parsed, targetTable: 'SOPMD_STAG_OTRA' } }
    await enrichAll([entrada(['PRDID', 'BRAND']), otra], catalogo(), sinNada, '', pedirCampo)
    expect(pedirCampo).toHaveBeenCalledTimes(1)
  })

  it('solo para campos de TEXTO', async () => {
    const pedirCampo = vi.fn(async () => 'x')
    await enrichAll(
      [entrada(['PRDID', 'KF1'])],
      catalogo({ types: { PRDID: 'NVARCHAR(20)', KF1: 'DECIMAL(15,2)' } }),
      sinNada, '', pedirCampo,
    )
    expect(pedirCampo.mock.calls.map((c) => c[0].field)).not.toContain('KF1')
  })

  it('no en planning: seleccionar un solo atributo lo rechaza el servicio', async () => {
    const pedirCampo = vi.fn(async () => 'x')
    const kf = entrada(['PRDID', 'KF1'], { tipoIntegracion: 'KF', targetTable: 'SOPDD_STAGING_KFTAB_SAP1' })
    await enrichAll([kf], catalogo(), sinNada, '', pedirCampo)
    expect(pedirCampo).not.toHaveBeenCalled()
  })

  it('sin la función no hace nada (compatible con quien no la pase)', async () => {
    const resultado = await enrichAll([entrada(['PRDID', 'BRAND'])], catalogo(), sinNada, '')
    expect(ejemplos(resultado).BRAND).toBe('')
  })

  it('el valor que llega como fecha de OData se muestra legible', async () => {
    const pedirCampo = vi.fn(async () => '/Date(1735689600000)/')
    const resultado = await enrichAll([entrada(['PRDID', 'BRAND'])], catalogo(), sinNada, '', pedirCampo)
    expect(ejemplos(resultado).BRAND).toBe('2025-01-01')
  })
})

describe('lo que no cambia', () => {
  it('un archivo (FILE) no se consulta ni avisa', async () => {
    const pedirFila = vi.fn()
    const resultado = await enrichAll([entrada(['A'], { tipoIntegracion: 'FILE' })], catalogo(), pedirFila, '')
    expect(pedirFila).not.toHaveBeenCalled()
    expect(resultado.avisos).toEqual([])
  })

  it('nuevaCache trae el conjunto de campos ya intentados', () => {
    expect(nuevaCache().intentados).toBeInstanceOf(Set)
  })
})
