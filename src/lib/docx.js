// Armar un documento de Word (.docx) sin librerías de terceros.
//
// Es el gemelo de `xlsx.js`: un `.docx` es un ZIP con XML dentro —WordprocessingML— y JSZip ya está en
// el proyecto para leer los exports de CI-DS. Traer una librería de documentos para escribir párrafos y
// tablas sería añadir megabytes al paquete para algo que son doscientas líneas de XML.
//
// Portado de la parte de ensamblado de `paDoc.js` de v7, que lo hacía igual y por la misma razón.
//
// Las unidades de Word, para que los números de abajo no parezcan arbitrarios:
//   - los tamaños de letra van en MEDIOS puntos: `sz=20` son 10 pt.
//   - los anchos y los márgenes en veinteavos de punto (`dxa`): 1.440 son una pulgada.
//   - las imágenes en EMU: 9.525 por píxel.

import JSZip from 'jszip'

import { escapeXml } from './xlsx.js'

/** Veinteavos de punto por pulgada. */
export const POR_PULGADA = 1440

/** Unidades de imagen por píxel. */
export const EMU_POR_PIXEL = 9525

/** El ancho útil de una página carta con márgenes de una pulgada. */
export const ANCHO_UTIL = 12240 - 2 * POR_PULGADA

/** Un párrafo. */
export function parrafo(texto, { negrita = false, tamano = 20, color = '', centrado = false, despues = 120 } = {}) {
  const formato = [
    negrita ? '<w:b/>' : '',
    color ? `<w:color w:val="${color}"/>` : '',
    `<w:sz w:val="${tamano}"/>`,
  ].join('')

  return '<w:p>'
    + `<w:pPr>${centrado ? '<w:jc w:val="center"/>' : ''}<w:spacing w:after="${despues}"/></w:pPr>`
    + `<w:r><w:rPr>${formato}</w:rPr><w:t xml:space="preserve">${escapeXml(texto)}</w:t></w:r>`
    + '</w:p>'
}

/** Un título. El nivel entra en el esquema del documento, que es lo que alimenta el índice. */
export function titulo(texto, nivel = 1) {
  return `<w:p><w:pPr><w:pStyle w:val="Heading${nivel}"/></w:pPr>`
    + `<w:r><w:t xml:space="preserve">${escapeXml(texto)}</w:t></w:r></w:p>`
}

/** Un salto de página. */
export const saltoDePagina = () => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'

/**
 * El campo del índice.
 *
 * Word no calcula el índice al abrir: guarda una instrucción y el resultado. Aquí se manda la
 * instrucción con `updateFields` puesto en los ajustes, así que Word lo rellena al abrir el documento y
 * el consultor no tiene que hacer nada.
 */
export const indice = () => '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>'
  + '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>'
  + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
  + '<w:r><w:t>Actualiza este campo en Word para ver el índice.</w:t></w:r>'
  + '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'

/** Una celda de tabla. */
function celda(texto, { ancho, negrita = false, tamano = 16, fondo = '' } = {}) {
  return '<w:tc>'
    + `<w:tcPr><w:tcW w:w="${ancho}" w:type="dxa"/>`
    + (fondo ? `<w:shd w:val="clear" w:color="auto" w:fill="${fondo}"/>` : '')
    + '</w:tcPr>'
    + '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>'
    + `<w:r><w:rPr>${negrita ? '<w:b/>' : ''}<w:sz w:val="${tamano}"/></w:rPr>`
    + `<w:t xml:space="preserve">${escapeXml(texto)}</w:t></w:r></w:p>`
    + '</w:tc>'
}

/**
 * Una tabla con encabezado.
 *
 * Las columnas se reparten el ancho útil por igual, y el encabezado se repite en cada página: una tabla
 * de cifras clave son cuarenta filas y sin eso la segunda página es una lista de valores sin nombre.
 */
export function tabla(encabezado, filas, { tamano = 16 } = {}) {
  const columnas = (encabezado ?? []).length
  if (columnas === 0) return ''

  const ancho = Math.floor(ANCHO_UTIL / columnas)

  const cabecera = '<w:tr><w:trPr><w:tblHeader/></w:trPr>'
    + encabezado.map((una) => celda(una, { ancho, negrita: true, tamano, fondo: 'DEEAF6' })).join('')
    + '</w:tr>'

  const cuerpo = (filas ?? []).map((fila) => '<w:tr>'
    + Array.from({ length: columnas }, (nada, indice) => celda(String(fila?.[indice] ?? ''), { ancho, tamano })).join('')
    + '</w:tr>').join('')

  return '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/>'
    + `<w:tblW w:w="${ANCHO_UTIL}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>`
    + `${cabecera}${cuerpo}</w:tbl>`
    + parrafo('', { despues: 120 })
}

/** Una imagen centrada, escalada para no pasarse del ancho pedido. */
export function imagen(id, { ancho, alto }, maximoEnPixeles) {
  const escala = Math.min(1, maximoEnPixeles / (ancho || 1))
  const cx = Math.round((ancho || 1) * escala * EMU_POR_PIXEL)
  const cy = Math.round((alto || 1) * escala * EMU_POR_PIXEL)
  const numero = id === 'rIdLogo' ? 1 : 2

  return '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="160"/></w:pPr><w:r><w:drawing>'
    + `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>`
    + `<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${numero}" name="${id}"/>`
    + '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>'
    + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
    + '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<pic:nvPicPr><pic:cNvPr id="${numero}" name="${id}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
    + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
}

/** El estilo de un título, por nivel. */
function estiloDeTitulo(nivel, tamano, color) {
  const antes = nivel === 1 ? 240 : nivel === 2 ? 200 : 160
  return `<w:style w:type="paragraph" w:styleId="Heading${nivel}">`
    + `<w:name w:val="heading ${nivel}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>`
    + `<w:pPr><w:keepNext/><w:spacing w:before="${antes}" w:after="80"/><w:outlineLvl w:val="${nivel - 1}"/></w:pPr>`
    + `<w:rPr><w:b/><w:color w:val="${color}"/><w:sz w:val="${tamano}"/></w:rPr></w:style>`
}

const ESTILOS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  + '<w:docDefaults><w:rPrDefault><w:rPr>'
  + '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="20"/><w:szCs w:val="20"/>'
  + '</w:rPr></w:rPrDefault>'
  + '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault>'
  + '</w:docDefaults>'
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
  + estiloDeTitulo(1, 32, '1F3864') + estiloDeTitulo(2, 26, '2E74B5') + estiloDeTitulo(3, 22, '2E74B5')
  + '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/>'
  + '<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar>'
  + '<w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/>'
  + '<w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/>'
  + '</w:tblCellMar></w:tblPr></w:style>'
  + '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/>'
  + '<w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders>'
  + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((lado) => `<w:${lado} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`).join('')
  + '</w:tblBorders></w:tblPr></w:style></w:styles>'

// `updateFields` es lo que hace que Word rellene el índice al abrir el documento.
const AJUSTES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  + '<w:updateFields w:val="true"/></w:settings>'

/** El documento: los bloques dentro del cuerpo, más el tamaño de página. */
export function documentoXml(bloques) {
  const pagina = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>'
    + `<w:pgMar w:top="${POR_PULGADA}" w:right="${POR_PULGADA}" w:bottom="${POR_PULGADA}" `
    + `w:left="${POR_PULGADA}" w:header="720" w:footer="720" w:gutter="0"/>`
    + '<w:cols w:space="720"/></w:sectPr>'

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    + ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"'
    + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
    + ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<w:body>${(bloques ?? []).join('')}${pagina}</w:body></w:document>`
}

/** Las piezas del ZIP. `imagenes` son `{ id, nombre, datos }`. */
export function partesDelDocumento(bloques, imagenes = []) {
  const relacionesDeImagen = imagenes.map((una) => `<Relationship Id="${una.id}"`
    + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"'
    + ` Target="media/${una.nombre}"/>`).join('')

  const tiposDeImagen = [...new Set(imagenes.map((una) => una.nombre.split('.').pop().toLowerCase()))]
    .map((extension) => `<Default Extension="${extension}" ContentType="image/${extension === 'jpg' ? 'jpeg' : extension}"/>`)
    .join('')

  return {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + tiposDeImagen
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      + '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
      + '</Types>',

    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1"'
      + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"'
      + ' Target="word/document.xml"/></Relationships>',

    'word/document.xml': documentoXml(bloques),
    'word/styles.xml': ESTILOS,
    'word/settings.xml': AJUSTES,

    'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rIdStyles"'
      + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"'
      + ' Target="styles.xml"/>'
      + '<Relationship Id="rIdSettings"'
      + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings"'
      + ' Target="settings.xml"/>'
      + relacionesDeImagen
      + '</Relationships>',
  }
}

/** Arma el `.docx` y lo devuelve como buffer. */
export async function armarDocx(bloques, imagenes = []) {
  const zip = new JSZip()

  for (const [ruta, contenido] of Object.entries(partesDelDocumento(bloques, imagenes))) {
    zip.file(ruta, contenido)
  }
  for (const una of imagenes) {
    zip.file(`word/media/${una.nombre}`, una.datos, { base64: typeof una.datos === 'string' })
  }

  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
}
