// Texto separado por tabuladores: lo que Excel entiende cuando se pega.
//
// Portado del patrón que v9 usaba en el monitor y en el explorador de integraciones. Vale la pena
// tenerlo aparte porque lo va a querer cada tabla de la aplicación, y porque la parte delicada
// —qué hacer con un tabulador dentro de un dato— se resuelve una vez.

/**
 * Convierte filas de valores en texto pegable en una hoja de cálculo.
 *
 * Un tabulador o un salto de línea dentro de un dato correría la columna y partiría la fila, así
 * que se reemplazan por un espacio. Se pierde ese carácter a propósito: es preferible a que la
 * tabla pegada salga desalineada sin que nadie lo note.
 */
export function toTsv(rows) {
  const limpiar = (valor) => String(valor ?? '').replace(/[\t\r\n]+/g, ' ').trim()
  return rows.map((fila) => fila.map(limpiar).join('\t')).join('\n')
}
