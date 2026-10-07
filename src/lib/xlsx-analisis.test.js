import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import {
  LIMITE_DE_FILAS,
  armarLibroDeAnalisis,
  crearEscritorDeTabla,
  hojasDelLibro,
  nombreDeParte,
  partesDelLibro,
  xmlDeHoja,
} from './xlsx-analisis.js'

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

  // v7 escribe `hdrs.map(cleanXml)`: sin el emoji (que XML 1.0 no admite) y sin el espacio que dejaba,
  // pero con el ancho medido sobre el texto crudo.
  it('el encabezado se escribe limpio y su ancho se mide con el texto crudo', () => {
    const hoja = { ...tabla(), encabezados: ['Estado', 'Alertas 🔴', 'PRDID', '# Plantas'], filas: [], limpiarEncabezados: true }
    const { xml } = xmlDeHoja(hoja)
    expect(xml).toContain('<c r="B1" t="inlineStr" s="5"><is><t>Alertas</t></is></c>')
    expect(xml).not.toContain('Alertas </t>')
    // «Alertas 🔴» mide 10 (el emoji son dos unidades) + 2 = 12.
    expect(xml).toContain('<col min="2" max="2" width="12" customWidth="1"/>')

    const escritor = crearEscritorDeTabla({ color: 'FF29ABE2', encabezados: hoja.encabezados, grupos: hoja.grupos, limpiarEncabezados: true, unir: (pedazos) => pedazos.join('') })
    expect(escritor.cerrar()[0].xml).toContain('<is><t>Alertas</t></is>')
  })

  // El Network Analyzer de v7 escribe `ws.addRow(headers)` sin limpiar: queda el espacio que deja el emoji.
  it('sin limpiarEncabezados el encabezado conserva el espacio, como el Network Analyzer de v7', () => {
    const hoja = { ...tabla(), encabezados: ['Estado', 'Alertas 🔴', 'PRDID', '# Plantas'], filas: [] }
    expect(xmlDeHoja(hoja).xml).toContain('<c r="B1" t="inlineStr" s="5"><is><t>Alertas </t></is></c>')

    const escritor = crearEscritorDeTabla({ color: 'FF29ABE2', encabezados: hoja.encabezados, grupos: hoja.grupos, unir: (pedazos) => pedazos.join('') })
    expect(escritor.cerrar()[0].xml).toContain('<is><t>Alertas </t></is>')
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

describe('hojas partidas (analyzeAndStreamExcel de v7: ROW_LIMIT)', () => {
  const conFilas = (n) => ({
    ...tabla(),
    filas: Array.from({ length: n }, (_, i) => ({ c: ['✅ OK', `obs ${i}`, `A${i}`, i], s: 'ok' })),
  })

  it('una hoja con más filas que el límite se parte en «Hoja», «Hoja (2)»…, cada una con su encabezado', () => {
    const libro = hojasDelLibro({ hojas: [conFilas(7)] }, 3)
    expect(libro.map((h) => h.nombre)).toEqual(['Product', 'Product (2)', 'Product (3)'])
    const [uno, dos, tres] = libro.map((h) => h.generar())
    // Tres, tres y una fila de datos, más la fila 1 de encabezados en cada parte.
    expect(uno.xml).toContain('<dimension ref="A1:D4"/>')
    expect(dos.xml).toContain('<dimension ref="A1:D4"/>')
    expect(tres.xml).toContain('<dimension ref="A1:D2"/>')
    expect(dos.xml).toContain('<t>PRDID</t>')
    expect(dos.xml).toContain('<t>A3</t>')
    expect(dos.xml).not.toContain('<t>A2</t>')
    expect(tres.notas).toHaveLength(3) // los comentarios de los encabezados se repiten en cada parte
  })

  it('una hoja que cabe no se parte', async () => {
    expect(hojasDelLibro({ hojas: [conFilas(3)] }, 3).map((h) => h.nombre)).toEqual(['Product'])
    const partes = await partesDelLibro({ hojas: [conFilas(5)] })
    expect(Object.keys(partes)).toContain('xl/worksheets/sheet1.xml')
    expect(partes['xl/workbook.xml']).not.toContain('Product (2)') // 5 < 900.000
  })

  it('el límite de v7 es 900.000 filas de datos', () => {
    expect(LIMITE_DE_FILAS).toBe(900000)
    expect(nombreDeParte('Location Source', 1)).toBe('Location Source')
    expect(nombreDeParte('Location Source', 2)).toBe('Location Source (2)')
  })
})

describe('crearEscritorDeTabla — la hoja que no se retiene en memoria', () => {
  const base = tabla()
  const escribir = (limite, lote, filas = base.filas) => {
    const e = crearEscritorDeTabla({
      color: base.color, encabezados: base.encabezados, notas: base.notas, grupos: base.grupos,
      limite, lote, unir: (pedazos) => pedazos.join(''),
    })
    for (const f of filas) e.agregar(f.c, f.s)
    return e.cerrar()
  }

  it('escribe EXACTAMENTE el mismo XML que la hoja en memoria', () => {
    const [parte] = escribir(900000, 20000)
    expect(parte.xml).toBe(xmlDeHoja(base).xml)
    expect(parte.notas).toEqual(xmlDeHoja(base).notas)
  })

  it('da lo mismo vaciar el lote cada fila que al final', () => {
    expect(escribir(900000, 1)[0].xml).toBe(escribir(900000, 20000)[0].xml)
  })

  it('abre otra parte, con su encabezado, al llegar al límite', () => {
    const partes = escribir(3, 2)
    // Cuatro filas de datos con límite 3: tres y una.
    expect(partes).toHaveLength(2)
    expect(partes[0].xml).toContain('<dimension ref="A1:D4"/>')
    expect(partes[1].xml).toContain('<dimension ref="A1:D2"/>')
    expect(partes[1].xml).toContain('<t>PRDID</t>')
    expect(partes[1].xml).toContain('<c r="C2" t="inlineStr"><is><t>A4</t></is></c>')
    expect(partes[1].notas).toHaveLength(3)
  })

  it('sin filas queda la hoja con su encabezado, como en v7', () => {
    const [parte] = escribir(900000, 20000, [])
    expect(parte.xml).toContain('<dimension ref="A1:D1"/>')
    expect(parte.xml).toContain('<t>Estado</t>')
  })

  it('en el navegador junta el XML en un Blob y el libro lo lleva tal cual a sus partes', async () => {
    // (JSZip de pruebas no lee el Blob de jsdom, pero sí el del navegador: v7 hacía lo mismo.)
    const e = crearEscritorDeTabla({ color: base.color, encabezados: base.encabezados, notas: base.notas, grupos: base.grupos, lote: 2 })
    for (const f of base.filas) e.agregar(f.c, f.s)
    const partes = e.cerrar()
    expect(partes[0].xml).toBeInstanceOf(Blob)
    const libro = await partesDelLibro({ hojas: [{ ...base, filas: [], partes }] })
    expect(libro['xl/worksheets/sheet1.xml']).toBe(partes[0].xml)
    expect(libro['xl/comments1.xml']).toContain('Detalle &amp; más')
    expect(await new Response(partes[0].xml).text()).toBe(xmlDeHoja(base).xml)
  })
})
