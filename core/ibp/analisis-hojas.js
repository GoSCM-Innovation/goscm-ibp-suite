// El modelo de datos de un informe de los analizadores de v7: hojas, filas con severidad y resumen.
//
// Portado de `makeSheet`, `track`, `statusLabel` y `cleanXml` de `prodAnalyzer.js` y `analyzer.js` de
// v7. En v7 esas piezas vivían DENTRO de cada analizador, entremezcladas con el armado del Excel y con
// la captura para la vista web; aquí son una sola cosa, sin DOM, que producen los analizadores y
// consumen DOS lectores: el Excel (`src/lib/xlsx-analisis.js`) y la vista web
// (`src/components/data/VistaWebAnalisis.jsx`).
//
// ES LA PIEZA COMPARTIDA con el Network Analyzer: el que lo migre produce un `Informe` con sus hojas
// (Resumen, Product, Location, Customer, Location Source, Customer Source, Estadísticas) y recibe sin
// tocar nada el Excel, la vista web y el modal de modo de salida.
//
// FORMA DE UN INFORME
//
//   {
//     titulo,          // «Production Analyzer — vista web»
//     archivo,         // «ProductionHierarchyAnalysis_2026-10-01.xlsx»
//     generadoEl,      // «2026-10-01»
//     hojas: [Hoja],   // en el orden del Excel
//     resumen: [{ nombre, clave, total, red, yel, ok, pct }],   // las tarjetas de la vista web
//     estadisticas: string[][],                                  // la hoja Estadísticas, para la web
//     nombreEstadisticas,                                        // «Estadísticas»
//   }
//
// y cada `Hoja` es de uno de dos tipos:
//
//   tipo 'tabla'   una fila de encabezados (con color de grupo y nota) y filas de datos que llevan
//                  severidad. Es la que la vista web pagina y filtra. `filas` es `[{ c, s }]` con `c` =
//                  las celdas ya limpias y `s` = 'red' | 'yel' | 'ok'. `extras` son filas libres que el
//                  Excel añade DESPUÉS de la tabla (los bloques de metadatos de la hoja Resumen).
//   tipo 'libre'   filas arbitrarias `{ celdas, relleno }`, la primera es el título. La hoja
//                  Estadísticas.
//
// Sin dependencias: lo usan los analizadores del servidor, la pantalla y las pruebas.

/** Los colores de v7, ARGB. Son los del Excel que el cliente reconoce; no se retocan. */
export const COLORES = Object.freeze({
  GOLD: 'FFF7A800',
  ORANGE: 'FFE8622A',
  NAVY: 'FF0B1120',
  /** Relleno de una fila con Alerta. */
  C_RED: 'FFFFCCCC',
  /** Relleno de una fila con Advertencia. */
  C_YEL: 'FFFFFFCC',
  /** Celda «no aplica». */
  NA_FILL: 'FFE5E7EB',
  NA_FONT: 'FF6B7280',
  /** Relleno de cabecera según el grupo de la columna. */
  GRUPO: Object.freeze({
    control: 'FFD1D5DB',
    ibp: 'FFBAE6FD',
    flag: 'FFFDE68A',
    metric: 'FFA7F3D0',
    detail: 'FF99F6E4',
  }),
})

/** El guion largo con el que v7 marca una celda «no aplica». */
export const NA_DASH = '—'

/** Las etiquetas de la columna Estado, literales de `xls.severity.*` de v7. */
export const ETIQUETA_DE_SEVERIDAD = Object.freeze({
  red: '⛔ Alerta',
  yel: '⚠ Advertencia',
  ok: '✅ OK',
})

/** Severidad de un relleno de fila. */
export const severidadDeRelleno = (relleno) =>
  (relleno === COLORES.C_RED ? 'red' : relleno === COLORES.C_YEL ? 'yel' : 'ok')

/** Relleno de una severidad. `ok` no lleva. */
export const rellenoDeSeveridad = (sev) =>
  (sev === 'red' ? COLORES.C_RED : sev === 'yel' ? COLORES.C_YEL : null)

/** «⛔ Alerta», «⚠ Advertencia» o «✅ OK» según el relleno de la fila (`statusLabel` de v7). */
export const etiquetaDeRelleno = (relleno) => ETIQUETA_DE_SEVERIDAD[severidadDeRelleno(relleno)]

/**
 * `cleanXml` de v7: quita los caracteres que XML 1.0 no admite y los espacios de los extremos.
 *
 * SAP IBP devuelve los campos CHAR con relleno de espacios, y una celda así rompe la tabla de cadenas
 * del Excel. Un texto que queda vacío pasa a `null` (celda vacía); lo que no es texto se deja tal cual.
 */
export function limpiarXml(v) {
  if (v === null || v === undefined) return v
  if (typeof v !== 'string') return v
  const s = v.replace(/[\uD800-\uDFFF]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x09\x0A\x0D\x20-퟿-�]/g, '')
    .trim()
  return s === '' ? null : s
}

/** Los códigos de un conjunto, ordenados y separados por coma (`codes` de v7). */
export function codigos(coleccion) {
  return Array.from(coleccion || []).sort().join(', ')
}

/**
 * Una hoja de tabla (`makeSheet` de v7).
 *
 * `grupos` colorea la cabecera de cada columna (`control`, `ibp`, `flag`, `metric`, `detail`) y
 * `notas` es el comentario que Excel enseña al pasar el ratón por el encabezado. `conEstado` dice si
 * la primera columna es el Estado: en la hoja «Tipos Excluidos» no lo es, y la vista web no debe
 * sobrescribir su primera columna con la severidad.
 */
export function crearHojaDeTabla({
  nombre, color, encabezados, notas = [], grupos = [], conEstado = true,
}) {
  const hoja = {
    tipo: 'tabla',
    nombre,
    color,
    encabezados: encabezados.slice(),
    notas: notas.slice(),
    grupos: grupos.slice(),
    conEstado,
    filas: [],
    extras: [],
    total: 0,
    red: 0,
    yel: 0,
    ok: 0,
  }

  /**
   * Añade una fila con el relleno que le toca (`C_RED`, `C_YEL` o nada).
   * Devuelve la severidad para que quien llama pueda contarla en el resumen.
   */
  hoja.agregar = (datos, relleno = null) => {
    const sev = severidadDeRelleno(relleno)
    hoja.filas.push({ c: datos.map(limpiarXml), s: sev })
    hoja.total += 1
    hoja[sev] += 1
    return sev
  }

  /** Añade una fila libre DESPUÉS de la tabla (los bloques de metadatos del Resumen). */
  hoja.agregarLibre = (celdas, relleno = null) => {
    hoja.extras.push({ celdas, relleno })
  }

  return hoja
}

/**
 * Una hoja libre (la hoja Estadísticas): filas arbitrarias, la primera es el título.
 *
 * `capturar` recibe cada fila tal como entra, en texto, para alimentar la vista web de Estadísticas.
 */
export function crearHojaLibre({ nombre, color, capturar = null }) {
  const hoja = { tipo: 'libre', nombre, color, filas: [] }

  hoja.agregar = (celdas, relleno = null) => {
    hoja.filas.push({ celdas, relleno })
    if (capturar) {
      capturar(Array.isArray(celdas) ? celdas.map((v) => (v === null || v === undefined ? '' : String(v))) : [])
    }
  }

  return hoja
}

/** El porcentaje de consistencia de la hoja Resumen: OK / Total × 100, o 100 si no hay filas. */
export const porcentajeOk = (total, ok) => (total > 0 ? Math.round((ok / total) * 100) : 100)
