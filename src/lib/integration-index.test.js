import { describe, it, expect } from 'vitest'

import {
  buildIndexes,
  detectChains,
  extractFilterFields,
  extractLookupPairs,
  normFileKey,
  normTableKey,
} from './integration-index.js'

/** Una integración con lo mínimo que piden los índices, más lo que le pase quien llame. */
let siguienteIdx = 0
const integracion = (extra = {}) => ({
  _idx: siguienteIdx++,
  jobName: 'JOB',
  dataflowName: 'DF',
  srcDSName: '',
  dstDSName: '',
  targetTable: '',
  tipoIntegracion: 'MD',
  fileLoaderFileName: '',
  mappings: [],
  filters: [],
  lookups: [],
  variables: [],
  ...extra,
})

const conIdx = (lista) => { siguienteIdx = 0; return lista.map((una) => ({ ...una, _idx: siguienteIdx++ })) }

describe('normTableKey', () => {
  it('normaliza a mayúsculas y recorta', () => {
    expect(normTableKey(' erp ', ' mara ')).toBe('ERP::MARA')
  })

  // Recortar la ruta rompería los nombres con namespace de ABAP, que son tablas distintas.
  it('conserva entero un nombre con namespace de ABAP', () => {
    expect(normTableKey('BW', '/BIC/AZPP_RVO022')).toBe('BW::/BIC/AZPP_RVO022')
  })

  it('sin datastore igual arma una clave usable', () => {
    expect(normTableKey('', 'MARA')).toBe('::MARA')
  })
})

describe('normFileKey', () => {
  it('se queda con el nombre, no con la ruta: cada lado usa la suya', () => {
    expect(normFileKey('/data/salida/ventas.csv')).toBe('FILE::VENTAS.CSV')
    expect(normFileKey('C:\\datos\\ventas.csv')).toBe('FILE::VENTAS.CSV')
  })

  it('sin archivo no hay clave', () => {
    expect(normFileKey('')).toBe('')
  })
})

describe('extractFilterFields', () => {
  it('de TABLA.CAMPO se queda con el campo', () => {
    expect(extractFilterFields("MARA.MTART = 'FERT'")).toEqual(['MTART'])
  })

  // Sin esto, buscar por campo devolvería medio proyecto en cada término.
  it('descarta las palabras de SQL y las funciones', () => {
    expect(extractFilterFields('upper(A.MATNR) is not null and B.WERKS in (1)')).toEqual(['MATNR', 'WERKS'])
  })

  it('un campo suelto también cuenta', () => {
    expect(extractFilterFields('MATNR = 1')).toEqual(['MATNR'])
  })

  // Una sola letra es casi siempre el alias de una tabla.
  it('ignora los nombres de una letra', () => {
    expect(extractFilterFields('a = 1')).toEqual([])
  })

  it('no repite un campo que aparece dos veces', () => {
    expect(extractFilterFields('A.MATNR = 1 or A.MATNR = 2')).toEqual(['MATNR'])
  })

  it('sin expresión no devuelve nada', () => {
    expect(extractFilterFields('')).toEqual([])
    expect(extractFilterFields(null)).toEqual([])
  })
})

describe('extractLookupPairs', () => {
  it('separa el formato del archivo que nombra el lookup', () => {
    expect(extractLookupPairs([{ func: 'lookup(VENTAS."/data/ventas_all.csv", X, 1, A.B)' }]))
      .toEqual([{ ds: 'VENTAS', file: 'VENTAS_ALL.CSV' }])
  })

  it('un lookup a tabla deja el archivo vacío', () => {
    expect(extractLookupPairs([{ func: 'lookup(ERP.MARA, MAKTX, 1, A.B)' }]))
      .toEqual([{ ds: 'ERP', file: 'MARA' }])
  })

  it('encuentra los dos lookups de una misma expresión', () => {
    expect(extractLookupPairs([{ func: 'lookup(A.T1, x) || lookup(B.T2, y)' }]).map((uno) => uno.ds))
      .toEqual(['A', 'B'])
  })

  it('sin lookups no devuelve nada', () => {
    expect(extractLookupPairs([])).toEqual([])
  })
})

describe('buildIndexes', () => {
  const integraciones = conIdx([
    integracion({
      jobName: 'GOSCM_MD_PRODUCTO',
      dstDSName: 'IBP',
      targetTable: 'PRODUCT',
      mappings: [
        { srcDS: 'ERP', srcTable: 'MARA', srcField: 'MATNR', dstDS: 'IBP', dstTable: 'PRODUCT', dstField: 'PRDID', dstDesc: 'Id', ops: '' },
        { srcDS: 'ERP', srcTable: 'MARA, MAKT', srcField: 'MARA.MATNR, MAKT.MAKTX', dstDS: 'IBP', dstTable: 'PRODUCT', dstField: 'TXT', dstDesc: '', ops: 'x' },
      ],
      filters: [{ sourceTable: 'MARA, MAKT', sourceField: '', expression: "MARA.MTART = 'FERT'", description: '' }],
      lookups: [{ func: 'lookup(DS.TARIFAS, X, 1, A.B)', transform: 'Q' }],
      variables: [{ name: '$G_PLAN_AREA', value: "'SAPIBP1'" }],
    }),
  ])
  const indices = buildIndexes(integraciones)

  it('indexa el destino por datastore y tabla', () => {
    expect(indices.byTargetKey['IBP::PRODUCT']).toEqual([0])
  })

  // Un campo puede salir de varias tablas y hay que poder llegar por cualquiera de ellas.
  it('parte las tablas de origen que vienen juntas en un mapeo', () => {
    expect(indices.bySrcTable['ERP::MARA']).toHaveLength(2)
    expect(indices.bySrcTable['ERP::MAKT']).toEqual([{ intIdx: 0, mIdx: 1 }])
  })

  it('a un campo de origen le quita el nombre de la tabla de adelante', () => {
    expect(Object.keys(indices.bySrcField).sort()).toEqual(['MAKTX', 'MATNR'])
  })

  it('indexa los filtros por tabla y por cada campo de la expresión', () => {
    expect(indices.byFilterTable['::MARA']).toEqual([{ intIdx: 0, fIdx: 0 }])
    expect(indices.byFilterField.MTART).toEqual([{ intIdx: 0, fIdx: 0 }])
  })

  it('la búsqueda global alcanza al trabajo, a los campos y a los lookups', () => {
    const { tokens } = indices.searchTokens[0]
    expect(tokens).toContain('goscm_md_producto')
    expect(tokens).toContain('prdid')
    expect(tokens).toContain('tarifas')
  })

  it('un destino de archivo se indexa también como archivo escrito', () => {
    const [uno] = conIdx([integracion({ dstDSName: 'FILE_DC', targetTable: 'VENTAS.CSV' })])
    expect(buildIndexes([uno]).byFileWritten['FILE::VENTAS.CSV']).toEqual([0])
  })

  it('un origen de archivo se indexa como archivo leído', () => {
    const [uno] = conIdx([integracion({
      mappings: [{ srcDS: 'ARCHIVOS', srcTable: 'VENTAS.CSV', srcField: 'X', dstDS: '', dstTable: '', dstField: 'Y', dstDesc: '', ops: '' }],
    })])
    expect(buildIndexes([uno]).byFileRead['FILE::VENTAS.CSV']).toEqual([0])
  })
})

describe('detectChains', () => {
  const mapeo = (extra) => ({ srcDS: '', srcTable: '', srcField: '', dstDS: '', dstTable: '', dstField: 'X', dstDesc: '', ops: '', ...extra })

  it('une por tabla cuando coinciden datastore y nombre', () => {
    const cadena = detectChains(conIdx([
      integracion({ dstDSName: 'STG', targetTable: 'PRODUCT_STG' }),
      integracion({ mappings: [mapeo({ srcDS: 'STG', srcTable: 'PRODUCT_STG' })] }),
    ]))
    expect(cadena).toEqual([{ from: 0, to: 1, via: 'table', label: 'PRODUCT_STG' }])
  })

  it('une por tabla aunque el datastore no coincida, si es base de datos', () => {
    const cadena = detectChains(conIdx([
      integracion({ dstDSName: 'STG', targetTable: 'PRODUCT_STG' }),
      integracion({ mappings: [mapeo({ srcDS: 'OTRO', srcTable: 'PRODUCT_STG' })] }),
    ]))
    expect(cadena.map((una) => una.via)).toEqual(['table'])
  })

  // Con nombres cortos los falsos positivos superan a los aciertos.
  it('no une por un nombre de menos de cuatro letras si el datastore no coincide', () => {
    expect(detectChains(conIdx([
      integracion({ dstDSName: 'STG', targetTable: 'T1' }),
      integracion({ mappings: [mapeo({ srcDS: 'OTRO', srcTable: 'T1' })] }),
    ]))).toEqual([])
  })

  // Dos formatos de archivo con el mismo nombre no significan que uno alimente al otro.
  it('no aplica la coincidencia por nombre suelto entre archivos', () => {
    expect(detectChains(conIdx([
      integracion({ tipoIntegracion: 'FILE', dstDSName: 'FILE_DC', targetTable: 'VENTAS' }),
      integracion({ mappings: [mapeo({ srcDS: 'ARCHIVOS', srcTable: 'VENTAS' })] }),
    ])).map((una) => una.via)).toEqual(['file'])
  })

  it('une por archivo cuando el lector nombra el mismo formato', () => {
    const cadena = detectChains(conIdx([
      integracion({ tipoIntegracion: 'FILE', targetTable: 'ECC_AUSP', fileLoaderFileName: '/out/ECC_AUSP.csv' }),
      integracion({ mappings: [mapeo({ srcDS: 'FILE', srcTable: 'ECC_AUSP' })] }),
    ]))
    expect(cadena).toEqual([{ from: 0, to: 1, via: 'file', label: 'ECC_AUSP' }])
  })

  it('une por lookup cuando el consumidor nombra el formato del productor', () => {
    const cadena = detectChains(conIdx([
      integracion({ tipoIntegracion: 'FILE', targetTable: 'TARIFAS' }),
      integracion({ lookups: [{ func: 'lookup(TARIFAS."tarifas.csv", P, 1, A.B)', transform: 'Q' }] }),
    ]))
    expect(cadena.map((una) => una.via)).toEqual(['lookup'])
  })

  // El productor puede llamar a su formato distinto del csv que escribe; el archivo es la clave
  // fiable porque está en los dos lados.
  it('une por lookup cuando solo coincide el archivo físico', () => {
    const cadena = detectChains(conIdx([
      integracion({ tipoIntegracion: 'FILE', targetTable: 'ECC_AUSP_CTYTTS', fileLoaderFileName: 'ECC_AUSP_CTYTTS_ALL.csv' }),
      integracion({ lookups: [{ func: 'lookup(OTRO_NOMBRE."ECC_AUSP_CTYTTS_ALL.csv", P, 1, A.B)', transform: 'Q' }] }),
    ]))
    expect(cadena).toEqual([{ from: 0, to: 1, via: 'lookup', label: 'ECC_AUSP_CTYTTS_ALL.CSV' }])
  })

  // La primera vía que empareja es la más fiable; volver a unir el mismo par sería ruido.
  it('no une dos veces el mismo par por vías distintas', () => {
    const cadena = detectChains(conIdx([
      integracion({ tipoIntegracion: 'FILE', dstDSName: 'FILE_DC', targetTable: 'TARIFAS' }),
      integracion({
        mappings: [mapeo({ srcDS: 'FILE_DC', srcTable: 'TARIFAS' })],
        lookups: [{ func: 'lookup(TARIFAS."tarifas.csv", P, 1, A.B)', transform: 'Q' }],
      }),
    ]))
    expect(cadena).toHaveLength(1)
    expect(cadena[0].via).toBe('table')
  })

  it('una integración no se encadena consigo misma', () => {
    expect(detectChains(conIdx([
      integracion({ dstDSName: 'STG', targetTable: 'PRODUCT_STG', mappings: [mapeo({ srcDS: 'STG', srcTable: 'PRODUCT_STG' })] }),
    ]))).toEqual([])
  })

  it('sin nada en común no inventa cadenas', () => {
    expect(detectChains(conIdx([
      integracion({ dstDSName: 'IBP', targetTable: 'PRODUCT' }),
      integracion({ mappings: [mapeo({ srcDS: 'ERP', srcTable: 'KNA1' })] }),
    ]))).toEqual([])
  })
})
