// Armar un documento de Word (.docx) sin librerías de terceros.
//
// Es el gemelo de `xlsx.js`: un `.docx` es un ZIP con XML dentro —WordprocessingML— y JSZip ya está en
// el proyecto. Traer una librería de documentos para escribir párrafos y tablas sería añadir megabytes
// al paquete para algo que son unas pocas líneas de XML.
//
// Portado de las secciones 3 («HELPERS OOXML»), 6 («IMAGEN») y 7 («ENSAMBLADO .docx») de `paDoc.js` de
// v7 y con el MISMO XML: mismos estilos, mismos anchos en porcentaje, mismos colores de encabezado
// (naranja `E8622A` y azul `1F3864`), mismos tamaños. El documento que sale es el que los clientes ya
// conocen. Las únicas diferencias son guardas de integridad, y cada una dice por qué.
//
// Las unidades de Word, para que los números de abajo no parezcan arbitrarios:
//   - los tamaños de letra de `parrafo` y `tabla` se piden en PUNTOS y se escriben en medios puntos.
//   - los anchos de tabla van en cincuentavos de porcentaje (`pct`): 5.000 es el 100 %.
//   - las imágenes en EMU: 9.525 por píxel.

import JSZip from 'jszip'

/** Unidades de imagen por píxel. */
export const EMU_POR_PIXEL = 9525

/** Veinteavos de punto por pulgada: los márgenes de la página. */
export const POR_PULGADA = 1440

/** El naranja de GoSCM, con el que v7 pinta los encabezados de tabla y el nombre del cliente. */
export const NARANJA = 'E8622A'

/** El azul oscuro de los títulos y de las tablas de resumen. */
export const AZUL = '1F3864'

/**
 * Escapa el texto para XML.
 *
 * Además de lo de v7 quita los caracteres que XML 1.0 no admite (los de control, salvo tabulador y
 * saltos): un solo `\u0000` en una definición de cálculo bastaría para que Word diga «el documento está
 * dañado» sin decir dónde. Guarda de integridad que v7 no tenía; no cambia ningún texto válido.
 */
export function xesc(valor) {
  return String(valor === null || valor === undefined ? '' : valor)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Los trozos de texto de un párrafo: un salto de línea en el texto es un salto de línea en Word. */
export function ejecuciones(texto, propiedades) {
  const rpr = propiedades ? `<w:rPr>${propiedades}</w:rPr>` : ''
  return String(texto === null || texto === undefined ? '' : texto)
    .split(/\r?\n/)
    .map((parte, i) => `<w:r>${rpr}${i > 0 ? '<w:br/>' : ''}<w:t xml:space="preserve">${xesc(parte)}</w:t></w:r>`)
    .join('')
}

/**
 * Un párrafo. `tamano` en puntos.
 *
 * Opciones: `estilo`, `despues` (espacio posterior), `alineado` (`center`…), `negrita`, `cursiva`,
 * `color`, `tamano`.
 */
export function parrafo(texto, opciones = {}) {
  const { estilo, despues, alineado, negrita, cursiva, color, tamano } = opciones

  const propiedadesDeParrafo = []
  if (estilo) propiedadesDeParrafo.push(`<w:pStyle w:val="${estilo}"/>`)
  if (despues !== undefined && despues !== null) propiedadesDeParrafo.push(`<w:spacing w:after="${despues}"/>`)
  if (alineado) propiedadesDeParrafo.push(`<w:jc w:val="${alineado}"/>`)
  const ppr = propiedadesDeParrafo.length > 0 ? `<w:pPr>${propiedadesDeParrafo.join('')}</w:pPr>` : ''

  let rpr = ''
  if (negrita) rpr += '<w:b/>'
  if (cursiva) rpr += '<w:i/>'
  if (color) rpr += `<w:color w:val="${color}"/>`
  if (tamano) rpr += `<w:sz w:val="${tamano * 2}"/>`

  return `<w:p>${ppr}${ejecuciones(texto, rpr || null)}</w:p>`
}

/** Un párrafo explicativo estándar: la prosa de cada sección. */
export const prosa = (texto) => parrafo(texto, { despues: 120 })

/** Un título. El nivel entra en el esquema del documento, que es lo que alimenta el índice. */
export const titulo = (texto, nivel) => `<w:p><w:pPr><w:pStyle w:val="Heading${nivel}"/></w:pPr>${ejecuciones(texto)}</w:p>`

/** Un salto de página. */
export const saltoDePagina = () => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'

/** Un párrafo vacío. */
export const parrafoVacio = () => '<w:p/>'

/**
 * El campo del índice.
 *
 * Word no calcula el índice al abrir: guarda una instrucción y el resultado. Se manda la instrucción
 * con el texto de ayuda como resultado provisional y, en los ajustes, `updateFields`: Word lo rellena
 * al abrir el documento.
 */
export const indice = (ayuda) => '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>'
  + '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>'
  + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
  + `<w:r><w:t xml:space="preserve">${xesc(ayuda)}</w:t></w:r>`
  + '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'

/**
 * Una tabla con encabezado repetido en cada página.
 *
 * `tamano` en puntos (9 por omisión) y `relleno` el color del encabezado (naranja por omisión). Las
 * columnas se reparten el ancho por igual. Una tabla sin columnas no se dibuja: v7 dividía entre cero y
 * escribía «Infinity» en el XML.
 */
export function tabla(encabezado, filas, { tamano = 9, relleno = NARANJA } = {}) {
  const columnas = (encabezado ?? []).length
  if (columnas === 0) return ''

  const anchoDeCelda = Math.floor(5000 / columnas)
  const cuadricula = `<w:tblGrid>${encabezado.map(() => `<w:gridCol w:w="${Math.floor(9350 / columnas)}"/>`).join('')}</w:tblGrid>`

  const celda = (contenido, esEncabezado) => {
    const sombra = esEncabezado ? `<w:shd w:val="clear" w:color="auto" w:fill="${relleno}"/>` : ''
    const propiedades = `<w:tcPr><w:tcW w:w="${anchoDeCelda}" w:type="pct"/>${sombra}</w:tcPr>`
    const rpr = `${esEncabezado ? '<w:b/><w:color w:val="FFFFFF"/>' : ''}<w:sz w:val="${tamano * 2}"/>`
    return `<w:tc>${propiedades}<w:p><w:pPr><w:spacing w:after="20"/></w:pPr>${ejecuciones(contenido, rpr)}</w:p></w:tc>`
  }

  const cabecera = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${encabezado.map((una) => celda(una, true)).join('')}</w:tr>`
  const cuerpo = (filas ?? [])
    .map((fila) => `<w:tr>${encabezado.map((nada, i) => celda(fila[i] !== undefined ? fila[i] : '', false)).join('')}</w:tr>`)
    .join('')

  const bordes = `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((lado) => `<w:${lado} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`).join('')}</w:tblBorders>`

  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/>${bordes}`
    + '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>'
    + `${cuadricula}${cabecera}${cuerpo}</w:tbl>${parrafoVacio()}`
}

/**
 * Una tabla de dos columnas «Campo / Valor» con el encabezado azul. `encabezado` son los dos títulos.
 */
export const tablaCampoValor = (encabezado, pares, opciones = {}) => tabla(
  encabezado,
  pares.map((par) => [par[0], par[1]]),
  { relleno: AZUL, ...opciones },
)

/** Una imagen centrada, escalada para no pasarse del ancho pedido. `img` es `{ ancho, alto }` en píxeles. */
export function imagen(id, img, maximoEnPixeles) {
  if (!img) return ''
  const escala = Math.min(1, maximoEnPixeles / img.ancho)
  const cx = Math.round(img.ancho * escala * EMU_POR_PIXEL)
  const cy = Math.round(img.alto * escala * EMU_POR_PIXEL)
  const numero = id === 'rIdGoscm' ? 2 : 1

  return '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="160"/></w:pPr><w:r><w:drawing>'
    + `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>`
    + `<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${numero}" name="${id}"/>`
    + '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>'
    + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${numero}" name="${id}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
    + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
}

/**
 * El tipo de contenido de una imagen, por su extensión.
 *
 * v7 escribía `image/<extensión>` sin más, y eso es inválido para `jpg` (el tipo es `image/jpeg`) y para
 * `svg` (`image/svg+xml`). Una extensión que no se conoce se declara como binario genérico en vez de
 * inventar un tipo que no existe.
 */
export function tipoDeImagen(extension) {
  switch (String(extension ?? '').toLowerCase()) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'bmp': return 'image/bmp'
    case 'webp': return 'image/webp'
    case 'svg': return 'image/svg+xml'
    default: return 'application/octet-stream'
  }
}

function estiloDeTitulo(nivel, nombre, tamano, color) {
  const antes = nivel === 1 ? 240 : nivel === 2 ? 200 : 160
  return `<w:style w:type="paragraph" w:styleId="Heading${nivel}"><w:name w:val="${nombre}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>`
    + `<w:pPr><w:keepNext/><w:spacing w:before="${antes}" w:after="80"/><w:outlineLvl w:val="${nivel - 1}"/></w:pPr>`
    + `<w:rPr><w:b/><w:color w:val="${color}"/><w:sz w:val="${tamano}"/></w:rPr></w:style>`
}

const ESTILOS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:rPrDefault>'
  + '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
  + estiloDeTitulo(1, 'heading 1', 32, AZUL) + estiloDeTitulo(2, 'heading 2', 26, '2E74B5') + estiloDeTitulo(3, 'heading 3', 22, '2E74B5')
  + '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
  + '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders>'
  + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((lado) => `<w:${lado} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`).join('')
  + '</w:tblBorders></w:tblPr></w:style></w:styles>'

// `updateFields` es lo que hace que Word rellene el índice al abrir el documento.
const AJUSTES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:updateFields w:val="true"/></w:settings>'

/** El documento: los bloques dentro del cuerpo, más el tamaño de página. */
export function documentoXml(bloques) {
  const pagina = `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="${POR_PULGADA}" w:right="${POR_PULGADA}" w:bottom="${POR_PULGADA}" w:left="${POR_PULGADA}" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="720"/></w:sectPr>`

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document '
    + 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    + 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    + `xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${(bloques ?? []).join('')}${pagina}</w:body></w:document>`
}

/** Las piezas del ZIP. `imagenes` son `{ id, nombre, datos }` con los datos en base64. */
export function partesDelDocumento(bloques, imagenes = []) {
  const extensiones = [...new Set(imagenes.map((una) => una.nombre.split('.').pop().toLowerCase()))]
  const tiposDeImagen = extensiones
    .map((extension) => `<Default Extension="${extension}" ContentType="${tipoDeImagen(extension)}"/>`)
    .join('')

  const relacionesDeImagen = imagenes.map((una) => `<Relationship Id="${una.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${una.nombre}"/>`).join('')

  return {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + tiposDeImagen
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      + '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',

    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',

    'word/document.xml': documentoXml(bloques),
    'word/styles.xml': ESTILOS,
    'word/settings.xml': AJUSTES,

    'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>'
      + `${relacionesDeImagen}</Relationships>`,
  }
}

/** Arma el `.docx` y lo devuelve como buffer. */
export async function armarDocx(bloques, imagenes = []) {
  const zip = new JSZip()

  for (const [ruta, contenido] of Object.entries(partesDelDocumento(bloques, imagenes))) {
    zip.file(ruta, contenido)
  }
  for (const una of imagenes) zip.file(`word/media/${una.nombre}`, una.datos, { base64: true })

  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
}
