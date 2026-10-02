// El Excel de un informe de los analizadores, con el aspecto del que entregaba v7.
//
// Portado de `StreamingXlsx` de `analyzer.js` de v7 (el escritor que usaban los DOS analizadores; no
// usaban ExcelJS aunque el comentario de `makeSheet` lo diga). Lo escribe a mano sobre JSZip, que ya
// es dependencia, y respeta lo que el cliente reconoce del archivo:
//
//   - fuente DM Sans 10, encabezado en negrita sobre fondo del color del GRUPO de la columna
//     (control, ibp, flag, metric, detail) con una línea naranja debajo,
//   - fila 1 congelada, color de pestaña por hoja,
//   - filas con Alerta en rojo claro, Advertencia en amarillo claro, y el gris itálico de «no aplica»,
//   - el comentario («nota») de cada encabezado, que es la documentación de la columna,
//   - ancho de columna = el texto más largo + 2, entre 10 y 60,
//   - los números como números y los textos como cadenas en línea.
//
// RECIBE un `Informe` de `core/ibp/analisis-hojas.js` (el que produce `analizarProduccion` y producirá
// el Network Analyzer). No sabe nada de producción: sirve para cualquier informe con esa forma.

import JSZip from 'jszip'

import { COLORES, NA_DASH, rellenoDeSeveridad } from '../../core/ibp/analisis-hojas.js'
import { cellRef } from './xlsx.js'

// Los índices de `cellXfs` de `_styles()`. El orden tiene que coincidir con `ESTILOS_XML`.
const XF_NORMAL = 0
const XF_ENCABEZADO = 1
const XF_ROJO = 2
const XF_AMARILLO = 3
const XF_NA = 4

/** Estilo de una celda de encabezado según el color del grupo de su columna. */
const XF_DE_ENCABEZADO = Object.freeze({
  FFF7A800: 1,
  FFD1D5DB: 5,
  FFBAE6FD: 6,
  FFFDE68A: 7,
  FFA7F3D0: 8,
  FF99F6E4: 9,
})

/** Estilo de una celda de datos según su relleno. */
const XF_DE_DATOS = Object.freeze({
  FFFFCCCC: XF_ROJO,
  FFFFFFCC: XF_AMARILLO,
  FFE5E7EB: XF_NA,
})

/** El `styles.xml` de v7, tal cual: diez estilos, fuente DM Sans. */
const ESTILOS_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="3">'
  + '<font><sz val="10"/><name val="DM Sans"/></font>'
  + '<font><b/><sz val="10"/><name val="DM Sans"/><color rgb="FF0B1120"/></font>'
  + '<font><i/><sz val="10"/><name val="DM Sans"/><color rgb="FF6B7280"/></font>'
  + '</fonts>'
  + '<fills count="12">'
  + '<fill><patternFill patternType="none"/></fill>'
  + '<fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFF7A800"/></patternFill></fill>'
  + '<fill><patternFill patternType="none"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFFFCCCC"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFFCC"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFD1D5DB"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFBAE6FD"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFFDE68A"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFA7F3D0"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FF99F6E4"/></patternFill></fill>'
  + '</fills>'
  + '<borders count="2">'
  + '<border><left/><right/><top/><bottom/><diagonal/></border>'
  + '<border><left/><right/><top/><bottom style="medium"><color rgb="FFE8622A"/></bottom><diagonal/></border>'
  + '</borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="10">'
  + '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0"><alignment horizontal="center" vertical="middle" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="2" fillId="6" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="7" borderId="1" xfId="0"><alignment horizontal="center" vertical="middle" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="1" fillId="8" borderId="1" xfId="0"><alignment horizontal="center" vertical="middle" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="1" fillId="9" borderId="1" xfId="0"><alignment horizontal="center" vertical="middle" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="1" fillId="10" borderId="1" xfId="0"><alignment horizontal="center" vertical="middle" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="1" fillId="11" borderId="1" xfId="0"><alignment horizontal="center" vertical="middle" wrapText="1"/></xf>'
  + '</cellXfs>'
  + '</styleSheet>'

/** Escapa y quita lo que XML 1.0 no admite (`_xe` de v7). */
function xe(v) {
  if (v === null || v === undefined) return ''
  return String(v)
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x09\x0A\x0D\x20-퟿-�]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** Una celda: número como número, texto como cadena en línea, vacío como celda con estilo. */
function celdaXml(v, referencia, xf) {
  const s = xf ? ` s="${xf}"` : ''
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${referencia}" t="n"${s}><v>${v}</v></c>`

  let crudo = v !== null && v !== undefined ? String(v) : ''
  // Excel no admite más de 32.767 caracteres en una celda.
  if (crudo.length > 32767) crudo = `${crudo.slice(0, 32750)}…`
  const txt = xe(crudo)
  return txt
    ? `<c r="${referencia}" t="inlineStr"${s}><is><t>${txt}</t></is></c>`
    : `<c r="${referencia}"${s}/>`
}

/** Las filas de una hoja en la forma que escribe el XML: `{ celdas, xfs, xfFila, alto, notas }`. */
function filasDeLaHoja(hoja) {
  const filas = []

  if (hoja.tipo === 'tabla') {
    // Encabezado: un estilo por columna según su grupo; la nota de cada columna va como comentario.
    const xfs = hoja.encabezados.map((_, i) => {
      const grupo = hoja.grupos?.[i]
      const argb = grupo ? (COLORES.GRUPO[grupo] || COLORES.GOLD) : COLORES.GOLD
      return XF_DE_ENCABEZADO[argb] ?? XF_ENCABEZADO
    })
    const notas = {}
    hoja.encabezados.forEach((_, i) => {
      const nota = hoja.notas?.[i]
      if (nota) notas[i] = nota
    })
    filas.push({
      celdas: hoja.encabezados,
      xfs,
      xfFila: XF_ENCABEZADO,
      alto: 22,
      notas,
    })

    for (const fila of hoja.filas) {
      const relleno = rellenoDeSeveridad(fila.s)
      // Una celda «no aplica» se pinta de gris itálico aunque la fila esté en rojo o amarillo.
      const xfs = fila.c.map((v) => (v === NA_DASH ? XF_NA : (relleno ? XF_DE_DATOS[relleno] : XF_NORMAL)))
      filas.push({ celdas: fila.c, xfs, xfFila: XF_NORMAL, alto: 0, notas: null })
    }

    // Las filas libres que van debajo de la tabla (los bloques de metadatos de la hoja Resumen).
    for (const libre of hoja.extras ?? []) {
      filas.push({
        celdas: libre.celdas,
        xfs: null,
        xfFila: libre.relleno ? (XF_DE_DATOS[libre.relleno] ?? XF_NORMAL) : XF_NORMAL,
        alto: 0,
        notas: null,
      })
    }
    return filas
  }

  // Hoja libre: la primera fila es el título y sale con el estilo de encabezado.
  hoja.filas.forEach((fila, i) => {
    filas.push({
      celdas: fila.celdas,
      xfs: null,
      xfFila: i === 0 ? XF_ENCABEZADO : (fila.relleno ? (XF_DE_DATOS[fila.relleno] ?? XF_NORMAL) : XF_NORMAL),
      alto: i === 0 ? 20 : 0,
      notas: null,
    })
  })
  return filas
}

/** El XML de una hoja y, si sus encabezados llevan nota, el de los comentarios y el dibujo VML. */
export function xmlDeHoja(hoja) {
  const filas = filasDeLaHoja(hoja)

  // Ancho de columna: el texto más largo + 2, entre 10 y 60 (`_toXml` de v7).
  const largos = []
  let columnas = 0
  for (const fila of filas) {
    fila.celdas.forEach((v, ci) => {
      const l = v !== null && v !== undefined ? String(v).length : 0
      if (ci >= columnas) columnas = ci + 1
      if (l > (largos[ci] || 0)) largos[ci] = l
    })
  }

  const partes = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
  ]
  if (hoja.color) partes.push(`<sheetPr><tabColor rgb="${hoja.color}"/></sheetPr>`)
  if (filas.length > 0 && columnas > 0) partes.push(`<dimension ref="A1:${cellRef(filas.length - 1, columnas - 1)}"/>`)
  partes.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>')
  partes.push('<sheetFormatPr defaultRowHeight="15"/>')
  if (columnas > 0) {
    partes.push('<cols>')
    for (let ci = 0; ci < columnas; ci++) {
      const w = Math.min(Math.max((largos[ci] || 10) + 2, 10), 60)
      partes.push(`<col min="${ci + 1}" max="${ci + 1}" width="${w}" customWidth="1"/>`)
    }
    partes.push('</cols>')
  }

  partes.push('<sheetData>')
  const notas = []
  filas.forEach((fila, f) => {
    const rn = f + 1
    partes.push(`<row r="${rn}"${fila.alto ? ` ht="${fila.alto}" customHeight="1"` : ''}>`)
    fila.celdas.forEach((v, ci) => {
      const xf = fila.xfs && fila.xfs[ci] != null ? fila.xfs[ci] : fila.xfFila
      partes.push(celdaXml(v, cellRef(f, ci), xf))
    })
    partes.push('</row>')
    if (fila.notas) {
      for (const [ci, texto] of Object.entries(fila.notas)) notas.push({ fila: f, columna: Number(ci), texto })
    }
  })
  partes.push('</sheetData>')
  if (notas.length > 0) partes.push('<legacyDrawing r:id="rId2"/>')
  partes.push('</worksheet>')

  return { xml: partes.join(''), notas }
}

/** `xl/commentsN.xml`: el texto de cada nota. */
function comentariosXml(notas) {
  const partes = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<authors><author>GoSCM</author></authors><commentList>',
  ]
  for (const nota of notas) {
    partes.push(`<comment ref="${cellRef(nota.fila, nota.columna)}" authorId="0"><text><r><t>${xe(nota.texto)}</t></r></text></comment>`)
  }
  partes.push('</commentList></comments>')
  return partes.join('')
}

/** `xl/drawings/vmlDrawingN.vml`: el globo de cada nota, oculto hasta pasar el ratón. */
function vmlXml(notas) {
  const partes = [
    '<xml xmlns:v="urn:schemas-microsoft-com:vml"',
    ' xmlns:o="urn:schemas-microsoft-com:office:office"',
    ' xmlns:x="urn:schemas-microsoft-com:office:excel">',
    '<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>',
    '<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202"',
    ' path="m,l,21600r21600,l21600,xe">',
    '<v:stroke joinstyle="miter"/>',
    '<v:path gradientshapeok="t" o:connecttype="rect"/>',
    '</v:shapetype>',
  ]
  let sid = 1025
  for (const nota of notas) {
    const lc = nota.columna + 1
    const rc = nota.columna + 6
    const anchor = `${lc}, 15, ${nota.fila}, 2, ${rc}, 15, ${nota.fila + 5}, 16`
    partes.push(
      `<v:shape id="_x0000_s${sid++}" type="#_x0000_t202"`,
      ' style="position:absolute;margin-left:59.25pt;margin-top:1.5pt;width:108pt;height:59.25pt;z-index:1;visibility:hidden"',
      ' fillcolor="#ffffe1" o:insetmode="auto">',
      '<v:fill color2="#ffffe1"/><v:shadow color="black" obscured="t"/>',
      '<v:path o:connecttype="none"/>',
      '<v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox>',
      '<x:ClientData ObjectType="Note">',
      '<x:MoveWithCells/><x:SizeWithCells/>',
      `<x:Anchor>${anchor}</x:Anchor>`,
      '<x:AutoFill>False</x:AutoFill>',
      `<x:Row>${nota.fila}</x:Row>`,
      `<x:Column>${nota.columna}</x:Column>`,
      '</x:ClientData></v:shape>',
    )
  }
  partes.push('</xml>')
  return partes.join('')
}

/**
 * Los archivos del paquete, sin comprimir. Separado de `armarLibroDeAnalisis` para poder probarlo.
 *
 * `ceder` se llama entre hoja y hoja: con cien mil filas, armar el XML de una hoja es lo bastante largo
 * como para que la pantalla se congele si no se le devuelve el hilo (v7 hacía lo mismo).
 */
export async function partesDelLibro(informe, { ceder = () => Promise.resolve() } = {}) {
  const hojas = informe.hojas
  const n = hojas.length
  const partes = {}

  const conNotas = new Array(n).fill(false)
  for (let i = 0; i < n; i++) {
    const { xml, notas } = xmlDeHoja(hojas[i])
    partes[`xl/worksheets/sheet${i + 1}.xml`] = xml
    if (notas.length > 0) {
      conNotas[i] = true
      partes[`xl/worksheets/_rels/sheet${i + 1}.xml.rels`] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments"'
        + ` Target="../comments${i + 1}.xml"/>`
        + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing"'
        + ` Target="../drawings/vmlDrawing${i + 1}.vml"/>`
        + '</Relationships>'
      partes[`xl/comments${i + 1}.xml`] = comentariosXml(notas)
      partes[`xl/drawings/vmlDrawing${i + 1}.vml`] = vmlXml(notas)
    }
    await ceder()
  }

  const ct = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
  ]
  if (conNotas.some(Boolean)) {
    ct.push('<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>')
  }
  ct.push(
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
  )
  for (let i = 0; i < n; i++) {
    ct.push(`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    if (conNotas[i]) {
      ct.push(`<Override PartName="/xl/comments${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>`)
    }
  }
  ct.push('</Types>')
  partes['[Content_Types].xml'] = ct.join('')

  partes['_rels/.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"'
    + ' Target="xl/workbook.xml"/></Relationships>'

  partes['xl/workbook.xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
    + hojas.map((h, i) => `<sheet name="${xe(h.nombre)}" sheetId="${i + 1}" r:id="rId${i + 2}"/>`).join('')
    + '</sheets></workbook>'

  partes['xl/_rels/workbook.xml.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + hojas.map((_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + '</Relationships>'

  partes['xl/styles.xml'] = ESTILOS_XML
  return partes
}

/** Arma el `.xlsx` de un informe y devuelve su contenido (`ArrayBuffer`). */
export async function armarLibroDeAnalisis(informe, opciones = {}) {
  const zip = new JSZip()
  for (const [ruta, contenido] of Object.entries(await partesDelLibro(informe, opciones))) {
    zip.file(ruta, contenido)
  }
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}
