// El documento de integraciones: una hoja índice y una hoja por dataflow.
//
// Portado de `public/legacy/js/docs.js` de v9. Los colores y los anchos de columna salen de la
// plantilla que se usa con los clientes (`plantilla_documentador.xlsx`), así que se dejan tal cual:
// el entregable tiene que verse igual que el que ya reciben hoy.

import { SheetBuilder, assembleXlsx } from './xlsx.js'

/** Cómo se llama la hoja índice. Los enlaces de "volver" la nombran, así que es una sola constante. */
export const HOJA_INDICE = 'Parámetros'

/**
 * Los estilos, por su número en `styles.xml`.
 *
 * Excel referencia los estilos por índice, no por nombre. Estos números tienen que coincidir
 * exactamente con el orden de `cellXfs` de abajo o el documento sale con los colores cambiados.
 */
export const XF = {
  DEFAULT: 0,
  PRM_HDR: 1,
  PRM_ABC: 2,
  PRM_DEF: 3,
  PRM_LINK: 4,
  BACK_BTN: 5,
  T1_HDR: 6,
  T1_NUM: 7,
  T1_CAMPO: 8,
  T1_DATA: 9,
  T234_HDR: 10,
  T2_DATA: 11,
  T34_DATA: 12,
}

/**
 * La hoja de estilos, con los colores exactos de la plantilla.
 *
 * Los rellenos, en orden: 2 celeste 00B0F0 (cabecera de la tabla de mapeos), 3 verde claro A9CE91
 * (sus datos), 4 gris EDEDED, 5 naranja ED7D31 (cabecera del índice), 7 azul claro DEEBF7,
 * 9 azul marino 223962 (el botón de volver). El 6 y el 8 vienen de la plantilla y no se usan; se
 * conservan porque los índices siguientes dependen de su posición.
 */
export const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="0"/>
<fonts count="8">
  <font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
  <font><sz val="10"/><name val="Arial"/><family val="2"/></font>
  <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/><family val="2"/></font>
  <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
  <font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
  <font><b/><sz val="11"/><color rgb="FF002060"/><name val="Calibri"/><family val="2"/></font>
  <font><sz val="11"/><color rgb="FF0563C1"/><u val="single"/><name val="Calibri"/><family val="2"/></font>
  <font><b/><sz val="10"/><name val="Arial"/><family val="2"/></font>
</fonts>
<fills count="10">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF00B0F0"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFA9CE91"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFEDEDED"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFED7D31"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFBE5D6"/><bgColor indexed="65"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFDEEBF7"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFE2EFDA"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF223962"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="3">
  <border><left/><right/><top/><bottom/><diagonal/></border>
  <border>
    <left style="thin"><color indexed="64"/></left>
    <right style="thin"><color indexed="64"/></right>
    <top style="thin"><color indexed="64"/></top>
    <bottom style="thin"><color indexed="64"/></bottom>
    <diagonal/>
  </border>
  <border>
    <left style="thin"><color indexed="64"/></left>
    <right style="thin"><color indexed="64"/></right>
    <top/>
    <bottom style="thin"><color indexed="64"/></bottom>
    <diagonal/>
  </border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="13">
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  <xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
  <xf numFmtId="0" fontId="0" fillId="7" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="6" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  <xf numFmtId="0" fontId="4" fillId="9" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="7" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="7" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
  <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
  <xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`.replace(/\n\s*/g, '')

/** Una celda con estilo. */
const celda = (v, s) => ({ v: v ?? '', s })

/** Las columnas de la hoja índice cambian según de dónde salió el documento. */
const COLUMNAS_DEL_INDICE = {
  jobs: ['Job de IBP', 'Paso', 'Tipo de paso', 'Grupo'],
  zip: ['Proceso', 'Grupo'],
}

const ANCHOS_DEL_INDICE = {
  jobs: [33.4, 20, 40, 35, 40, 25, 64.6, 35.9, 71.1, 71.1, 79.2],
  zip: [33.4, 20, 30, 22, 64.6, 35.9, 71.1, 71.1, 79.2],
}

/**
 * La hoja índice: una fila por dataflow, con enlace a su hoja de detalle.
 *
 * En modo Jobs se agregan las columnas del job de IBP que ejecuta cada tarea. Un paso que no es de
 * CI-DS (`isNonDI`) no tiene hoja propia y por eso va sin enlace: existe para que el orden del job
 * se lea completo, no para documentar un dataflow.
 */
export function buildParamSheet(filas, modoJobs) {
  const hoja = new SheetBuilder()
  const columnas = modoJobs ? COLUMNAS_DEL_INDICE.jobs : COLUMNAS_DEL_INDICE.zip

  hoja.addRow([
    celda('Dato', XF.PRM_HDR),
    celda('Tipo de integración', XF.PRM_HDR),
    ...columnas.map((una) => celda(una, XF.PRM_HDR)),
    celda('Tarea CI-DS', XF.PRM_HDR),
    celda('Descripción de la tarea', XF.PRM_HDR),
    celda('Dataflow CI-DS', XF.PRM_HDR),
    celda('Sistema origen', XF.PRM_HDR),
    celda('Sistema destino', XF.PRM_HDR),
  ], 18)

  filas.forEach((fila, i) => {
    const numeroDeFila = hoja.rows.length

    const propias = modoJobs
      ? [fila.ibpJobName, fila.ibpStepName, fila.ibpStepType, fila.atlGroup]
      : [fila.atlSession, fila.atlGroup]

    hoja.addRow([
      celda(i + 1, fila.isNonDI ? XF.PRM_ABC : XF.PRM_LINK),
      celda(fila.tipoIntegracion, XF.PRM_ABC),
      ...propias.map((una) => celda(una, XF.PRM_DEF)),
      celda(fila.jobName, XF.PRM_ABC),
      celda(fila.jobDesc, XF.PRM_DEF),
      celda(fila.dataflowName, XF.PRM_DEF),
      celda(fila.srcDS, XF.PRM_DEF),
      celda(fila.dstDS, XF.PRM_DEF),
    ], 20)

    if (!fila.isNonDI) hoja.addHyperlink(numeroDeFila, 0, `#'${fila.sheetName}'!A1`)
  })

  hoja.setColWidths(modoJobs ? ANCHOS_DEL_INDICE.jobs : ANCHOS_DEL_INDICE.zip)
  return hoja
}

/** Cuántas columnas ocupa una hoja de detalle: A a I. */
const COLUMNAS_DEL_DETALLE = 9

/**
 * La hoja de un dataflow: los mapeos arriba y tres tablas debajo.
 *
 * La columna A queda angosta y vacía a propósito: es el margen de la plantilla, y en su primera
 * celda va el botón que vuelve al índice.
 */
export function buildIntegrationSheet(integracion) {
  const hoja = new SheetBuilder()
  const vacia = () => hoja.addRow(Array(COLUMNAS_DEL_DETALLE).fill(celda('', XF.DEFAULT)), 6)

  hoja.addHyperlink(0, 0, `#'${HOJA_INDICE}'!A1`)
  hoja.addRow([
    celda('<--', XF.BACK_BTN),
    celda(' #', XF.T1_HDR),
    celda('Campo destino', XF.T1_HDR),
    celda('Descripción', XF.T1_HDR),
    celda('Tabla origen', XF.T1_HDR),
    celda('Campo origen', XF.T1_HDR),
    celda('Mapeo', XF.T1_HDR),
    celda('Tipo de dato IBP', XF.T1_HDR),
    celda('Ejemplo IBP', XF.T1_HDR),
  ], 22)

  if (integracion.mappings.length === 0) {
    hoja.addRow([
      celda('', XF.DEFAULT),
      celda('Sin mapeos', XF.T1_DATA),
      ...Array(7).fill(celda('', XF.T1_DATA)),
    ], 18)
  } else {
    // Cuando el destino es un archivo, el campo se nombra con el archivo delante: sin eso, dos
    // integraciones que escriben el mismo formato a archivos distintos se leen igual.
    const prefijo = integracion.fileLoaderFileName ? `"${integracion.fileLoaderFileName}".` : ''

    integracion.mappings.forEach((mapeo, i) => {
      hoja.addRow([
        celda('', XF.DEFAULT),
        celda(i + 1, XF.T1_NUM),
        celda(prefijo + [mapeo.dstTable, mapeo.dstField].filter(Boolean).join('.'), XF.T1_CAMPO),
        celda(mapeo.dstDesc, XF.T1_DATA),
        celda(mapeo.srcTable, XF.T1_DATA),
        celda(mapeo.srcField, XF.T1_DATA),
        celda(mapeo.ops, XF.T1_DATA),
        celda(mapeo.ibpType, XF.T1_DATA),
        celda(mapeo.ibpExample, XF.T1_DATA),
      ], 18)
    })
  }

  /** Las tres tablas de abajo tienen la misma forma: cabecera, y filas de dos o tres columnas. */
  const tabla = (cabeceras, estiloDeDatos, textoSiVacia, filas) => {
    vacia()
    const relleno = Array(COLUMNAS_DEL_DETALLE - 1 - cabeceras.length).fill(celda('', XF.DEFAULT))

    hoja.addRow([
      celda('', XF.DEFAULT),
      ...cabeceras.map((una) => celda(una, XF.T234_HDR)),
      ...relleno,
    ], 18)

    const cuerpo = filas.length > 0
      ? filas
      : [[textoSiVacia, ...Array(cabeceras.length - 1).fill('')]]

    for (const fila of cuerpo) {
      hoja.addRow([
        celda('', XF.DEFAULT),
        ...fila.map((valor) => celda(valor, estiloDeDatos)),
        ...relleno,
      ], 18)
    }
  }

  tabla(
    ['Tabla', 'Filtro', 'Descripción'],
    XF.T2_DATA,
    'Sin filtros',
    integracion.filters.map((uno) => [
      [uno.sourceTable, uno.sourceField].filter(Boolean).join('.'),
      uno.expression || '',
      uno.description || '',
    ]),
  )

  tabla(
    ['Parámetro global', 'Valor'],
    XF.T34_DATA,
    'Sin parámetros globales',
    (integracion.variables ?? []).map((uno) => [uno.name || '', uno.value || '']),
  )

  tabla(
    ['Función de lookup', 'Transformación'],
    XF.T34_DATA,
    'Sin lookups',
    integracion.lookups.map((uno) => [uno.func || '', uno.transform || '']),
  )

  hoja.setColWidths([4.6, 22.4, 29.1, 62.3, 41.7, 41.7, 40.4, 18, 30])
  return hoja
}

/**
 * El documento completo: la hoja índice y una hoja por integración elegida.
 *
 * Cada integración tiene que traer ya su `sheetName`, que se calcula al escanear los ZIP: el enlace
 * del índice lo nombra y tiene que ser el mismo que el de la hoja.
 */
export async function buildWorkbook(seleccionadas, { modoJobs = false } = {}) {
  const hojas = [
    { name: HOJA_INDICE, sb: buildParamSheet(seleccionadas.map((una) => una.paramRow), modoJobs) },
    ...seleccionadas.map((una) => ({
      name: una.paramRow.sheetName,
      sb: buildIntegrationSheet(una.parsed),
    })),
  ]

  return assembleXlsx(hojas, STYLES_XML)
}
