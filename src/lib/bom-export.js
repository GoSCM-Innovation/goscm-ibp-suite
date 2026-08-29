// El árbol de materiales a Excel: una hoja por producto, o una sola hoja para una lista entera.
//
// Portado de `bomExportExcel` y `bomBatchRun` de `public/js/bom.js` de v7. Las dos existían y ninguna
// se había portado: el inventario de archivos no las vio porque `bom.js` figuraba como portado
// —el árbol sí lo estaba— y estas dos son funciones dentro de ese mismo archivo.
//
// LO QUE HACE LA EXPORTACIÓN POR LOTES, que es lo que más se usa: se pega una lista de materiales y
// sale UN Excel con todas sus jerarquías en una hoja y un índice delante. Un consultor que revisa
// treinta productos no abre treinta pestañas: pega los treinta y se lleva un archivo a la reunión.
//
// Las columnas, su orden y los colores son los de v7. Es lo que el cliente reconoce, y una columna
// movida convierte su plantilla de Excel en basura.

import { SheetBuilder, assembleXlsx } from './xlsx.js'

/** Los estilos, por su número en `styles.xml`. El orden tiene que coincidir con `cellXfs`. */
export const XF = {
  DEFAULT: 0,
  /** Encabezado: fondo dorado, texto azul marino, línea naranja debajo. */
  HDR: 1,
  /** Fila de raíz: dorado muy claro. */
  RAIZ: 2,
  /** Fila de co-producto: morado muy claro. */
  COPROD: 3,
}

export const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="0"/>
<fonts count="2">
  <font><sz val="10"/><name val="Calibri"/><family val="2"/></font>
  <font><b/><sz val="10"/><color rgb="FF0B1120"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="4">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFF7A800"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFDE8C8"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
  <border><left/><right/><top/><bottom/><diagonal/></border>
  <border><left/><right/><top/><bottom style="medium"><color rgb="FFE8622A"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>
  <xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`.replace(/\n\s*/g, '')

/** Las columnas de la hoja de jerarquía, en el orden de v7. */
export const COLUMNAS = Object.freeze([
  'Material Padre Nivel 1',
  'Material Padre del Nivel',
  'Nivel',
  'Planta',
  'ID de producción',
  'Material',
  'Descripción',
  'Reemplazante',
  'Coef. entrada',
  'Coef. salida',
  'UOM',
  'Tipo de Material',
  'Tipo',
  'Puestos de trabajo',
])

/** Los anchos de v7, en el mismo orden. */
const ANCHOS = [18, 18, 7, 18, 16, 30, 32, 12, 14, 14, 8, 16, 7, 32]

const texto = (valor) => (valor === null || valor === undefined ? '' : String(valor))

/**
 * Aplana un bosque a las filas del Excel, en el mismo orden en que se lee el árbol.
 *
 * Los co-productos van justo debajo de su receta y comparten su nivel: la receta produce las dos
 * cosas a la vez, así que ponerlos un nivel más abajo diría que uno sale del otro.
 *
 * Se espera el árbol YA construido entero —`abrirTodo`—: aquí no se arma nada, porque los hijos de un
 * nodo se construyen al abrirlo y esta función no tiene los índices.
 */
export function aplanarArbol(raices) {
  const filas = []

  const recorrer = (nodo, raiz, padre) => {
    filas.push({
      raiz,
      padre,
      nivel: nodo.nivel,
      planta: texto(nodo.planta),
      receta: texto(nodo.receta),
      prdid: texto(nodo.prdid),
      descripcion: texto(nodo.descripcion),
      reemplazante: nodo.esAlternativo ? 'X' : '',
      coefEntrada: texto(nodo.coeficienteDeEntrada),
      coefSalida: texto(nodo.coeficienteDeSalida),
      unidad: texto(nodo.unidad),
      tipoDeMaterial: texto(nodo.tipoDeMaterial),
      tipo: texto(nodo.tipoDeReceta),
      recursos: (nodo.recursos ?? []).join(', '),
      esRaiz: nodo.nivel === 1,
      esCoproducto: false,
    })

    // Los co-productos de la receta, menos el propio producto de la fila: ya está escrito arriba.
    for (const co of nodo.coproductos ?? []) {
      if (texto(co.prdid) === texto(nodo.prdid)) continue
      filas.push({
        raiz,
        padre: texto(nodo.prdid),
        nivel: nodo.nivel,
        planta: texto(nodo.planta),
        receta: '',
        prdid: texto(co.prdid),
        descripcion: texto(co.descripcion),
        reemplazante: '',
        coefEntrada: '',
        coefSalida: texto(co.coeficiente),
        unidad: texto(co.unidad),
        tipoDeMaterial: texto(co.tipoDeMaterial),
        tipo: texto(co.tipo),
        recursos: '',
        esRaiz: false,
        esCoproducto: true,
      })
    }

    for (const hijo of nodo.hijos ?? []) recorrer(hijo, raiz, texto(nodo.prdid))
  }

  for (const raiz of raices ?? []) recorrer(raiz, texto(raiz.prdid), '')
  return filas
}

const celda = (v, s = XF.DEFAULT) => ({ v: v ?? '', s })

/** La hoja de jerarquía: el encabezado dorado y una fila por nodo. */
export function hojaDeJerarquia(filas) {
  const hoja = new SheetBuilder()
  hoja.addRow(COLUMNAS.map((una) => celda(una, XF.HDR)), 22)

  for (const fila of filas) {
    const estilo = fila.esCoproducto ? XF.COPROD : (fila.esRaiz ? XF.RAIZ : XF.DEFAULT)
    hoja.addRow([
      celda(fila.raiz, estilo),
      celda(fila.padre, estilo),
      celda(fila.nivel, estilo),
      celda(fila.planta, estilo),
      celda(fila.receta, estilo),
      celda(fila.prdid, estilo),
      celda(fila.descripcion, estilo),
      celda(fila.reemplazante, estilo),
      celda(fila.coefEntrada, estilo),
      celda(fila.coefSalida, estilo),
      celda(fila.unidad, estilo),
      celda(fila.tipoDeMaterial, estilo),
      celda(fila.tipo, estilo),
      celda(fila.recursos, estilo),
    ])
  }

  hoja.setColWidths(ANCHOS)
  return hoja
}

/** El índice de la exportación por lotes: qué se pidió y qué salió de cada material. */
export function hojaDeIndice(resultados) {
  const hoja = new SheetBuilder()
  hoja.addRow(
    ['Nº', 'Material', 'Estado', 'Filas', 'Plantas'].map((una) => celda(una, XF.HDR)),
    20,
  )

  resultados.forEach((uno, indice) => {
    hoja.addRow([
      celda(indice + 1),
      celda(uno.prdid),
      celda(uno.estado),
      celda(uno.filas ?? 0),
      celda((uno.plantas ?? []).join(', ')),
    ])
  })

  hoja.setColWidths([6, 24, 30, 10, 40])
  return hoja
}

/** El nombre del archivo lleva la fecha: se generan varios y hay que poder distinguirlos. */
export const nombreDeArchivo = (prdid, hoy) => {
  const limpio = String(prdid ?? '').replace(/[^\w.-]+/g, '_')
  return `Jerarquia_${limpio}_${hoy}.xlsx`
}

/** Un solo producto: una hoja con su jerarquía. */
export function armarLibroDeUnProducto(filas) {
  return assembleXlsx([{ name: 'Jerarquía', sb: hojaDeJerarquia(filas) }], STYLES_XML)
}

/** Una lista: el índice delante y todas las jerarquías en una sola hoja. */
export function armarLibroDeLote(resultados, filas) {
  return assembleXlsx([
    { name: 'Índice', sb: hojaDeIndice(resultados) },
    { name: 'Jerarquía', sb: hojaDeJerarquia(filas) },
  ], STYLES_XML)
}

/**
 * Los códigos de una lista pegada: uno por línea, o separados por coma, punto y coma o espacios.
 *
 * Sin repetidos y en el orden en que se pegaron: quien pega una lista de un Excel espera el mismo
 * orden de vuelta para poder comparar las dos columnas.
 */
export function leerLista(texto_) {
  const vistos = new Set()
  const salida = []
  for (const crudo of String(texto_ ?? '').split(/[\s,;]+/)) {
    const uno = crudo.trim().toUpperCase()
    if (!uno || vistos.has(uno)) continue
    vistos.add(uno)
    salida.push(uno)
  }
  return salida
}

/** Dispara la descarga de un libro ya armado. */
export function descargarLibro(buffer, nombre) {
  const url = URL.createObjectURL(new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombre
  document.body.appendChild(enlace)
  enlace.click()
  document.body.removeChild(enlace)
  URL.revokeObjectURL(url)
}
