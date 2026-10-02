import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { armarLibroDeAnalisis, partesDelLibro, xmlDeHoja } from './xlsx-analisis.js'

const tabla = () => ({
  tipo: 'tabla',
  nombre: 'Product',
  color: 'FF29ABE2',
  encabezados: ['Estado', 'Observación', 'PRDID', '# Plantas'],
  notas: ['Color de alerta', 'Detalle & más', null, 'Número de plantas'],
  grupos: ['control', 'control', 'ibp', 'metric'],
  conEstado: true,
  filas: [
    { c: ['⛔ Alerta', 'Sin LP', 'A1', 3], s: 'red' },
    { c: ['⚠ Advertencia', 'PLEADTIME', 'A2', 0], s: 'yel' },
    { c: ['✅ OK', 'todo bien <ok>', 'A3', null], s: 'ok' },
    { c: ['✅ OK', '—', 'A4', 1], s: 'ok' },
  ],
  extras: [],
})

describe('xmlDeHoja', () => {
  it('congela la fila 1, pinta la pestaña y pone el ancho por el texto más largo', () => {
    const { xml } = xmlDeHoja(tabla())
    expect(xml).toContain('<sheetPr><tabColor rgb="FF29ABE2"/></sheetPr>')
    expect(xml).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>')
    // «Observación» (11) + 2 = 13; «todo bien <ok>» (14) + 2 = 16.
    expect(xml).toContain('<col min="2" max="2" width="16" customWidth="1"/>')
    // Mínimo de 10.
    expect(xml).toContain('<col min="3" max="3" width="10" customWidth="1"/>')
    expect(xml).toContain('<dimension ref="A1:D5"/>')
  })

  it('el encabezado va con el color de su grupo y 22 de alto', () => {
    const { xml } = xmlDeHoja(tabla())
    // control → xf 5, ibp → xf 6, metric → xf 8.
    expect(xml).toContain('<row r="1" ht="22" customHeight="1">')
    expect(xml).toContain('<c r="A1" t="inlineStr" s="5">')
    expect(xml).toContain('<c r="C1" t="inlineStr" s="6">')
    expect(xml).toContain('<c r="D1" t="inlineStr" s="8">')
  })

  it('las filas llevan el relleno de su severidad y los números son números', () => {
    const { xml } = xmlDeHoja(tabla())
    expect(xml).toContain('<c r="A2" t="inlineStr" s="2"><is><t>⛔ Alerta</t></is></c>')
    expect(xml).toContain('<c r="D2" t="n" s="2"><v>3</v></c>')
    expect(xml).toContain('<c r="A3" t="inlineStr" s="3">')
    expect(xml).toContain('<c r="D3" t="n" s="3"><v>0</v></c>')
    // Una fila OK no lleva estilo, y un valor nulo es una celda vacía.
    expect(xml).toContain('<c r="A4" t="inlineStr"><is>')
    expect(xml).toContain('<c r="D4"/>')
  })

  it('escapa el texto', () => {
    const { xml } = xmlDeHoja(tabla())
    expect(xml).toContain('todo bien &lt;ok&gt;')
  })

  it('una celda «no aplica» sale en gris itálico aunque la fila esté pintada', () => {
    const h = tabla()
    h.filas[0].c[1] = '—'
    const { xml } = xmlDeHoja(h)
    expect(xml).toContain('<c r="B2" t="inlineStr" s="4"><is><t>—</t></is></c>')
    expect(xml).toContain('<c r="C2" t="inlineStr" s="2">')
  })

  it('las notas de los encabezados se devuelven con su celda', () => {
    const { notas, xml } = xmlDeHoja(tabla())
    expect(notas).toEqual([
      { fila: 0, columna: 0, texto: 'Color de alerta' },
      { fila: 0, columna: 1, texto: 'Detalle & más' },
      { fila: 0, columna: 3, texto: 'Número de plantas' },
    ])
    expect(xml).toContain('<legacyDrawing r:id="rId2"/>')
  })

  it('una hoja libre pone el título como encabezado y el gris en las filas pintadas', () => {
    const { xml } = xmlDeHoja({
      tipo: 'libre',
      nombre: 'Estadísticas',
      color: 'FF29ABE2',
      filas: [
        { celdas: ['Título'], relleno: null },
        { celdas: [], relleno: null },
        { celdas: ['Total', 5], relleno: 'FFE5E7EB' },
      ],
    })
    expect(xml).toContain('<row r="1" ht="20" customHeight="1"><c r="A1" t="inlineStr" s="1">')
    expect(xml).toContain('<row r="2"></row>')
    expect(xml).toContain('<c r="A3" t="inlineStr" s="4"><is><t>Total</t></is></c>')
    expect(xml).toContain('<c r="B3" t="n" s="4"><v>5</v></c>')
  })

  it('las filas libres bajo la tabla del Resumen se escriben después de los datos', () => {
    const h = tabla()
    h.extras = [{ celdas: [] }, { celdas: ['INFORMACION'], relleno: 'FFE5E7EB' }]
    const { xml } = xmlDeHoja(h)
    expect(xml).toContain('<row r="6"></row>')
    expect(xml).toContain('<row r="7"><c r="A7" t="inlineStr" s="4"><is><t>INFORMACION</t></is></c></row>')
  })
})

describe('armarLibroDeAnalisis', () => {
  const informe = () => ({
    hojas: [
      tabla(),
      { tipo: 'libre', nombre: 'Estadísticas', color: 'FF29ABE2', filas: [{ celdas: ['Título'], relleno: null }] },
    ],
  })

  it('el paquete lleva el libro, los estilos de v7 y los comentarios de las hojas con notas', async () => {
    const partes = await partesDelLibro(informe())
    expect(Object.keys(partes).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/comments1.xml',
      'xl/drawings/vmlDrawing1.vml',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/_rels/sheet1.xml.rels',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ])
    expect(partes['xl/styles.xml']).toContain('<name val="DM Sans"/>')
    expect(partes['xl/workbook.xml']).toContain('<sheet name="Product" sheetId="1" r:id="rId2"/>')
    expect(partes['xl/workbook.xml']).toContain('<sheet name="Estadísticas" sheetId="2" r:id="rId3"/>')
    expect(partes['xl/comments1.xml']).toContain('<comment ref="B1" authorId="0"><text><r><t>Detalle &amp; más</t></r></text></comment>')
    expect(partes['[Content_Types].xml']).toContain('Extension="vml"')
  })

  it('es un zip que se vuelve a abrir', async () => {
    const buffer = await armarLibroDeAnalisis(informe())
    const zip = await JSZip.loadAsync(buffer)
    expect(Object.keys(zip.files)).toContain('xl/worksheets/sheet1.xml')
    expect(await zip.file('xl/workbook.xml').async('string')).toContain('Product')
  })

  it('cede el hilo entre hoja y hoja', async () => {
    let cedidas = 0
    await partesDelLibro(informe(), { ceder: () => { cedidas += 1; return Promise.resolve() } })
    expect(cedidas).toBe(2)
  })
})
