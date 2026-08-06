// @vitest-environment jsdom
//
// Hace falta un navegador de mentira solo para el test que vuelve a leer el `.xlsx` generado y
// comprueba que cada XML de adentro está bien formado: usa `DOMParser`, que en Node no existe.

import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'

import {
  HOJA_INDICE,
  STYLES_XML,
  XF,
  buildIntegrationSheet,
  buildParamSheet,
  buildWorkbook,
} from './cids-doc.js'

const integracion = (extra = {}) => ({
  jobName: 'GOSCM_MD_PRODUCTO',
  jobDesc: 'Carga de producto',
  dataflowName: 'DF_PRODUCTO',
  srcDSName: 'ECC',
  dstDSName: 'IBP',
  targetTable: 'PRODUCT',
  tipoIntegracion: 'MD',
  fileLoaderFileName: '',
  mappings: [
    { srcDS: 'ECC', srcTable: 'MARA', srcField: 'MATNR', dstDS: 'IBP', dstTable: 'PRODUCT', dstField: 'PRDID', dstDesc: 'Id de producto', ops: '' },
  ],
  filters: [{ sourceTable: 'MARA', sourceField: '', expression: "MTART = 'FERT'", description: '' }],
  lookups: [{ func: 'lookup(A.B, C, 1, D.E)', transform: 'Q' }],
  variables: [{ name: '$G_PLAN_AREA', value: 'SAPIBP1' }],
  ...extra,
})

const paramRow = (extra = {}) => ({
  sheetName: 'GOSCM_MD_PRODUCTO',
  tipoIntegracion: 'MD',
  jobName: 'GOSCM_MD_PRODUCTO',
  jobDesc: 'Carga de producto',
  dataflowName: 'DF_PRODUCTO',
  srcDS: 'ECC',
  dstDS: 'IBP',
  atlSession: '',
  atlGroup: '',
  ...extra,
})

/** El texto de una fila, sin estilos: alcanza para comprobar el contenido. */
const textoDeFila = (hoja, i) => hoja.rows[i].map((una) => String(una.v ?? ''))

describe('STYLES_XML', () => {
  // Excel referencia los estilos por índice: si el orden se corre, salen los colores cambiados.
  it('declara tantos estilos como usa el documento', () => {
    expect(STYLES_XML).toContain('<cellXfs count="13">')
    expect(Math.max(...Object.values(XF))).toBe(12)
  })

  it('lleva los colores de la plantilla', () => {
    for (const color of ['FF00B0F0', 'FFA9CE91', 'FFED7D31', 'FFDEEBF7', 'FF223962']) {
      expect(STYLES_XML).toContain(color)
    }
  })

  it('va en una sola línea, sin el sangrado del código', () => {
    expect(STYLES_XML).not.toContain('\n')
  })
})

describe('buildParamSheet', () => {
  it('en modo ZIP tiene las columnas del proceso', () => {
    const hoja = buildParamSheet([paramRow()], false)
    expect(textoDeFila(hoja, 0)).toEqual([
      'Dato', 'Tipo de integración', 'Proceso', 'Grupo',
      'Tarea CI-DS', 'Descripción de la tarea', 'Dataflow CI-DS', 'Sistema origen', 'Sistema destino',
    ])
  })

  it('en modo Jobs agrega las columnas del job de IBP', () => {
    const hoja = buildParamSheet([paramRow({ ibpJobName: 'J1', ibpStepName: 'S1', ibpStepType: 'DI' })], true)
    expect(textoDeFila(hoja, 0)).toContain('Job de IBP')
    expect(textoDeFila(hoja, 1)).toEqual([
      '1', 'MD', 'J1', 'S1', 'DI', '', 'GOSCM_MD_PRODUCTO', 'Carga de producto', 'DF_PRODUCTO', 'ECC', 'IBP',
    ])
  })

  it('numera las filas desde uno y enlaza cada una con su hoja', () => {
    const hoja = buildParamSheet([paramRow(), paramRow({ sheetName: 'OTRA' })], false)
    expect(hoja.rows[1][0].v).toBe(1)
    expect(hoja.rows[2][0].v).toBe(2)
    expect(hoja.hyperlinks).toEqual([
      { ref: 'A2', destino: "#'GOSCM_MD_PRODUCTO'!A1" },
      { ref: 'A3', destino: "#'OTRA'!A1" },
    ])
  })

  // Un paso que no es de CI-DS existe para que el orden del job se lea completo, pero no tiene
  // hoja propia a la que enlazar.
  it('un paso que no es de CI-DS va sin enlace', () => {
    const hoja = buildParamSheet([paramRow({ isNonDI: true })], true)
    expect(hoja.hyperlinks).toEqual([])
    expect(hoja.rows[1][0].s).toBe(XF.PRM_ABC)
  })

  it('el ancho de columnas acompaña a la cantidad de columnas', () => {
    expect(buildParamSheet([], false).colWidths).toHaveLength(9)
    expect(buildParamSheet([], true).colWidths).toHaveLength(11)
  })
})

describe('buildIntegrationSheet', () => {
  const hoja = buildIntegrationSheet(integracion())

  it('la primera celda vuelve al índice', () => {
    expect(hoja.rows[0][0].v).toBe('<--')
    expect(hoja.hyperlinks).toEqual([{ ref: 'A1', destino: `#'${HOJA_INDICE}'!A1` }])
  })

  it('cada mapeo es una fila numerada, con la columna A vacía de margen', () => {
    expect(textoDeFila(hoja, 1))
      .toEqual(['', '1', 'PRODUCT.PRDID', 'Id de producto', 'MARA', 'MATNR', '', '', ''])
  })

  // Sin el archivo delante, dos integraciones que escriben el mismo formato se leen igual.
  it('un destino de archivo lleva el nombre del archivo delante del campo', () => {
    const conArchivo = buildIntegrationSheet(integracion({ fileLoaderFileName: 'ventas.csv' }))
    expect(conArchivo.rows[1][2].v).toBe('"ventas.csv".PRODUCT.PRDID')
  })

  it('trae los filtros, los parámetros y los lookups', () => {
    const todo = hoja.rows.map((una) => una.map((otra) => String(otra.v ?? '')).join('|')).join('\n')
    expect(todo).toContain("MTART = 'FERT'")
    expect(todo).toContain('$G_PLAN_AREA')
    expect(todo).toContain('lookup(A.B, C, 1, D.E)')
  })

  it('las tablas vacías lo dicen en vez de quedar en blanco', () => {
    const pelada = buildIntegrationSheet(integracion({ mappings: [], filters: [], lookups: [], variables: [] }))
    const todo = pelada.rows.map((una) => una.map((otra) => String(otra.v ?? '')).join('')).join('\n')

    expect(todo).toContain('Sin mapeos')
    expect(todo).toContain('Sin filtros')
    expect(todo).toContain('Sin parámetros globales')
    expect(todo).toContain('Sin lookups')
  })

  it('todas las filas tienen el mismo ancho', () => {
    expect(new Set(hoja.rows.map((una) => una.length))).toEqual(new Set([9]))
  })
})

describe('buildWorkbook', () => {
  it('arma un .xlsx con la hoja índice primero y una hoja por integración', async () => {
    const buffer = await buildWorkbook([
      { parsed: integracion(), paramRow: paramRow() },
      { parsed: integracion({ jobName: 'OTRO' }), paramRow: paramRow({ sheetName: 'OTRO' }) },
    ])

    const zip = await JSZip.loadAsync(buffer)
    const workbook = await zip.file('xl/workbook.xml').async('string')

    expect(workbook.indexOf(HOJA_INDICE)).toBeLessThan(workbook.indexOf('GOSCM_MD_PRODUCTO'))
    expect(zip.file('xl/worksheets/sheet3.xml')).not.toBeNull()
    expect(zip.file('xl/worksheets/sheet4.xml')).toBeNull()
  })

  it('el documento se puede volver a leer y su XML está bien formado', async () => {
    const zip = await JSZip.loadAsync(await buildWorkbook([{ parsed: integracion(), paramRow: paramRow() }]))

    const rutas = Object.values(zip.files).filter((uno) => !uno.dir).map((uno) => uno.name)
    expect(rutas.length).toBeGreaterThan(4)

    for (const ruta of rutas) {
      const contenido = await zip.file(ruta).async('string')
      const documento = new DOMParser().parseFromString(contenido, 'application/xml')
      expect(documento.getElementsByTagName('parsererror')).toHaveLength(0)
    }
  })

  it('sin integraciones igual sale un documento con su índice', async () => {
    const zip = await JSZip.loadAsync(await buildWorkbook([]))
    expect(zip.file('xl/worksheets/sheet1.xml')).not.toBeNull()
    expect(zip.file('xl/worksheets/sheet2.xml')).toBeNull()
  })
})
