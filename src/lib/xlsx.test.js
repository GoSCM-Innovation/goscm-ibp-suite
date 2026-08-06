import { describe, it, expect } from 'vitest'

import { SheetBuilder, cellRef, escapeXml, uniqueSheetName, workbookParts } from './xlsx.js'

describe('escapeXml', () => {
  it('escapa lo que rompería el XML', () => {
    expect(escapeXml('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;')
  })

  it('sin valor devuelve cadena vacía', () => {
    expect(escapeXml(null)).toBe('')
    expect(escapeXml(undefined)).toBe('')
  })

  it('el cero no se pierde', () => {
    expect(escapeXml(0)).toBe('0')
  })
})

describe('cellRef', () => {
  it.each([
    [0, 0, 'A1'],
    [2, 1, 'B3'],
    [0, 25, 'Z1'],
    [0, 26, 'AA1'],
    [0, 51, 'AZ1'],
    [0, 52, 'BA1'],
  ])('fila %i columna %i es %s', (fila, columna, esperado) => {
    expect(cellRef(fila, columna)).toBe(esperado)
  })
})

describe('uniqueSheetName', () => {
  it('reemplaza lo que Excel no admite', () => {
    expect(uniqueSheetName('A/B:C*D?E[F]', new Set())).toBe('A_B_C_D_E_F_')
  })

  // Excel rechaza el archivo entero si dos hojas se llaman igual.
  it('desempata los repetidos', () => {
    const usados = new Set()
    expect(uniqueSheetName('JOB', usados)).toBe('JOB')
    expect(uniqueSheetName('JOB', usados)).toBe('JOB_1')
    expect(uniqueSheetName('JOB', usados)).toBe('JOB_2')
  })

  it('corta los nombres largos y deja lugar para el sufijo', () => {
    const largo = 'X'.repeat(60)
    const usados = new Set()
    expect(uniqueSheetName(largo, usados)).toHaveLength(28)
    expect(uniqueSheetName(largo, usados)).toBe(`${'X'.repeat(25)}_1`)
  })

  it('sin nombre no revienta', () => {
    expect(uniqueSheetName(null, new Set())).toBe('')
  })
})

describe('SheetBuilder', () => {
  it('escribe cada celda con su referencia y su estilo', () => {
    const hoja = new SheetBuilder().addRow([{ v: 'Hola', s: 6 }, { v: 2, s: 7 }])
    const { xml } = hoja.toXml()

    expect(xml).toContain('<c r="A1" s="6" t="inlineStr"><is><t>Hola</t></is></c>')
    expect(xml).toContain('<c r="B1" s="7" t="inlineStr"><is><t>2</t></is></c>')
  })

  // Una celda vacía igual se escribe: es la que lleva el color de fondo y el borde.
  it('una celda vacía conserva su estilo', () => {
    const { xml } = new SheetBuilder().addRow([{ v: '', s: 9 }]).toXml()
    expect(xml).toContain('<c r="A1" s="9"/>')
  })

  it('escapa el contenido de las celdas', () => {
    const { xml } = new SheetBuilder().addRow([{ v: 'a & <b>', s: 0 }]).toXml()
    expect(xml).toContain('<t>a &amp; &lt;b&gt;</t>')
  })

  it('anota el alto de cada fila y el ancho de cada columna', () => {
    const { xml } = new SheetBuilder().addRow([{ v: 'x', s: 0 }], 22).setColWidths([4.6, 30]).toXml()
    expect(xml).toContain('<row r="1" ht="22" customHeight="1">')
    expect(xml).toContain('<col min="1" max="1" width="4.6" customWidth="1"/>')
    expect(xml).toContain('<col min="2" max="2" width="30" customWidth="1"/>')
  })

  it('calcula el rango de la hoja', () => {
    const { xml } = new SheetBuilder()
      .addRow([{ v: 'a', s: 0 }, { v: 'b', s: 0 }, { v: 'c', s: 0 }])
      .addRow([{ v: 'd', s: 0 }])
      .toXml()
    expect(xml).toContain('<dimension ref="A1:C2"/>')
  })

  it('sin filas devuelve una hoja válida', () => {
    const { xml, relsXml } = new SheetBuilder().toXml()
    expect(xml).toContain('<dimension ref="A1:A1"/>')
    expect(xml).toContain('<sheetData></sheetData>')
    expect(relsXml).toBeNull()
  })

  it('combina celdas', () => {
    const { xml } = new SheetBuilder().addRow([{ v: 'x', s: 0 }]).merge(0, 0, 0, 3).toXml()
    expect(xml).toContain('<mergeCell ref="A1:D1"/>')
  })

  // Excel guarda los enlaces como relaciones aparte; dentro de la celda no los abre.
  it('un hipervínculo genera su relación', () => {
    const hoja = new SheetBuilder().addRow([{ v: 'ir', s: 0 }]).addHyperlink(0, 0, "#'Hoja 2'!A1")
    const { xml, relsXml } = hoja.toXml()

    expect(xml).toContain('ref="A1" r:id="rId1"')
    expect(relsXml).toContain(`Target="#'Hoja 2'!A1"`)
    expect(relsXml).toContain('Id="rId1"')
  })
})

describe('workbookParts', () => {
  const hojas = [
    { name: 'Parámetros', sb: new SheetBuilder().addRow([{ v: 'a', s: 0 }]).addHyperlink(0, 0, "#'Detalle'!A1") },
    { name: 'Detalle', sb: new SheetBuilder().addRow([{ v: 'b', s: 0 }]) },
  ]
  const partes = workbookParts(hojas, '<styleSheet/>')

  it('arma los archivos que Excel espera encontrar', () => {
    expect(Object.keys(partes).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/_rels/sheet1.xml.rels',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ])
  })

  it('nombra las hojas y las numera en orden', () => {
    expect(partes['xl/workbook.xml']).toContain('<sheet name="Parámetros" sheetId="1" r:id="rId1"')
    expect(partes['xl/workbook.xml']).toContain('<sheet name="Detalle" sheetId="2" r:id="rId2"')
  })

  // Sin declararla, Excel abre el archivo pero descarta todos los colores.
  it('declara la hoja de estilos', () => {
    expect(partes['xl/_rels/workbook.xml.rels']).toContain('Target="styles.xml" Id="rIdS"')
    expect(partes['[Content_Types].xml']).toContain('PartName="/xl/styles.xml"')
    expect(partes['xl/styles.xml']).toBe('<styleSheet/>')
  })

  it('solo la hoja con enlaces tiene archivo de relaciones', () => {
    expect(partes['xl/worksheets/_rels/sheet1.xml.rels']).toBeDefined()
    expect(partes['xl/worksheets/_rels/sheet2.xml.rels']).toBeUndefined()
  })

  it('declara el tipo de contenido de cada hoja', () => {
    expect(partes['[Content_Types].xml']).toContain('PartName="/xl/worksheets/sheet1.xml"')
    expect(partes['[Content_Types].xml']).toContain('PartName="/xl/worksheets/sheet2.xml"')
  })
})
