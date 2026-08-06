// Escribir un `.xlsx` a mano, sin librería de Excel.
//
// Portado de `public/legacy/js/docs.js` de v9. Un `.xlsx` es un ZIP con unos cuantos XML adentro, y
// escribirlos directamente pesa unos pocos kB frente a los cientos que ocupa cualquier librería de
// Excel. El documentador es lo único que genera hojas de cálculo en toda la aplicación.
//
// Esto es la parte GENÉRICA —celdas, hojas, hipervínculos, el armado del paquete—; los estilos y el
// contenido del documento de integraciones están en `cids-doc.js`.
//
// Los textos van como cadenas en línea (`inlineStr`) y no en la tabla compartida de cadenas. Es unos
// kB más grande y no hace falta una segunda pasada para armar la tabla.

import JSZip from 'jszip'

/** Escapa lo que va dentro de un atributo o de un nodo de texto. */
export function escapeXml(valor) {
  if (valor === null || valor === undefined) return ''
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** La referencia de una celda: fila y columna en base cero → `B3`. */
export function cellRef(fila, columna) {
  let letras = ''
  let n = columna + 1
  while (n > 0) {
    letras = String.fromCharCode(65 + ((n - 1) % 26)) + letras
    n = Math.floor((n - 1) / 26)
  }
  return letras + (fila + 1)
}

/** Lo que Excel no admite en el nombre de una hoja, y hasta dónde lo corta. */
const PROHIBIDOS_EN_HOJA = /[:\\/?*[\]]/g
const LARGO_DE_HOJA = 28

/**
 * Un nombre de hoja válido y distinto de los que ya se usaron.
 *
 * Excel rechaza el archivo entero si dos hojas se llaman igual o si un nombre lleva `:\/?*[]`. Se
 * corta a 28 y no a los 31 que admite Excel para dejar lugar al sufijo del desempate.
 */
export function uniqueSheetName(base, usados) {
  const limpio = String(base ?? '').replace(PROHIBIDOS_EN_HOJA, '_').substring(0, LARGO_DE_HOJA)

  let nombre = limpio
  let intento = 0
  while (usados.has(nombre)) {
    intento += 1
    nombre = `${limpio.substring(0, 25)}_${intento}`
  }

  usados.add(nombre)
  return nombre
}

/** Una hoja que se va armando fila por fila. */
export class SheetBuilder {
  constructor() {
    this.rows = []
    this.rowHeights = []
    this.merges = []
    this.hyperlinks = []
    this.colWidths = []
  }

  /** Agrega una fila. Cada celda es `{ v, s }`: el valor y el índice de su estilo. */
  addRow(celdas, alto = 18) {
    this.rows.push(celdas)
    this.rowHeights.push(alto)
    return this
  }

  merge(f1, c1, f2, c2) {
    this.merges.push({ f1, c1, f2, c2 })
    return this
  }

  addHyperlink(fila, columna, destino) {
    this.hyperlinks.push({ ref: cellRef(fila, columna), destino })
    return this
  }

  setColWidths(anchos) {
    this.colWidths = anchos
    return this
  }

  /**
   * El XML de la hoja, y el de sus relaciones si tiene hipervínculos.
   *
   * Los hipervínculos van por relación y no dentro de la celda: es como los guarda Excel, y meterlos
   * de otra forma hace que el archivo se abra pero sin los enlaces.
   */
  toXml() {
    const cols = this.colWidths
      .map((ancho, i) => `<col min="${i + 1}" max="${i + 1}" width="${ancho}" customWidth="1"/>`)
      .join('')

    let filas = ''
    this.rows.forEach((celdas, f) => {
      let fila = `<row r="${f + 1}" ht="${this.rowHeights[f]}" customHeight="1">`
      celdas.forEach((celda, c) => {
        if (!celda) return
        const referencia = cellRef(f, c)
        const estilo = celda.s ?? 0
        const valor = celda.v ?? ''
        // Una celda vacía se escribe igual: es la que lleva el color de fondo y el borde.
        fila += valor === '' || valor === null || valor === undefined
          ? `<c r="${referencia}" s="${estilo}"/>`
          : `<c r="${referencia}" s="${estilo}" t="inlineStr"><is><t>${escapeXml(String(valor))}</t></is></c>`
      })
      filas += `${fila}</row>`
    })

    const combinadas = this.merges.length > 0
      ? `<mergeCells>${this.merges.map((una) => `<mergeCell ref="${cellRef(una.f1, una.c1)}:${cellRef(una.f2, una.c2)}"/>`).join('')}</mergeCells>`
      : ''

    let enlaces = ''
    let relsXml = null
    if (this.hyperlinks.length > 0) {
      const NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
      enlaces = `<hyperlinks>${this.hyperlinks
        .map((uno, i) => `<hyperlink ${NS} ref="${uno.ref}" r:id="rId${i + 1}"/>`)
        .join('')}</hyperlinks>`

      const TIPO = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'
      const entradas = this.hyperlinks
        .map((uno, i) => `<Relationship Type="${TIPO}" Target="${escapeXml(uno.destino)}" TargetMode="External" Id="rId${i + 1}"/>`)
        .join('')
      relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + `${entradas}</Relationships>`
    }

    const ultimaColumna = Math.max(0, ...this.rows.map((una) => una.length)) - 1
    const rango = `A1:${cellRef(Math.max(0, this.rows.length - 1), Math.max(0, ultimaColumna))}`

    const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + `<dimension ref="${rango}"/>`
      + '<sheetViews><sheetView workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews>'
      + '<sheetFormatPr baseColWidth="8" defaultRowHeight="15"/>'
      + `<cols>${cols}</cols>`
      + `<sheetData>${filas}</sheetData>`
      + combinadas
      + enlaces
      + '</worksheet>'

    return { xml, relsXml }
  }
}

/** Los archivos que van dentro del ZIP, sin comprimir todavía. Separado para poder probarlo. */
export function workbookParts(hojas, stylesXml) {
  const partes = {
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml" Id="rId1"/>'
      + '</Relationships>',
    'xl/styles.xml': stylesXml,
  }

  const NS_R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
  partes['xl/workbook.xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<bookViews><workbookView activeTab="0"/></bookViews>'
    + `<sheets>${hojas.map((una, i) => `<sheet name="${escapeXml(una.name)}" sheetId="${i + 1}" r:id="rId${i + 1}" ${NS_R}/>`).join('')}</sheets>`
    + '</workbook>'

  const TIPO_HOJA = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet'
  const TIPO_ESTILOS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles'
  partes['xl/_rels/workbook.xml.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + hojas.map((_, i) => `<Relationship Type="${TIPO_HOJA}" Target="worksheets/sheet${i + 1}.xml" Id="rId${i + 1}"/>`).join('')
    + `<Relationship Type="${TIPO_ESTILOS}" Target="styles.xml" Id="rIdS"/>`
    + '</Relationships>'

  hojas.forEach((una, i) => {
    const { xml, relsXml } = una.sb.toXml()
    partes[`xl/worksheets/sheet${i + 1}.xml`] = xml
    if (relsXml) partes[`xl/worksheets/_rels/sheet${i + 1}.xml.rels`] = relsXml
  })

  const CT_HOJA = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
  partes['[Content_Types].xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${CT_HOJA}"/>`).join('')
    + '</Types>'

  return partes
}

/** Arma el `.xlsx`. `hojas` es `[{ name, sb }]`. */
export async function assembleXlsx(hojas, stylesXml) {
  const zip = new JSZip()
  for (const [ruta, contenido] of Object.entries(workbookParts(hojas, stylesXml))) {
    zip.file(ruta, contenido)
  }
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
}
