// Cuántas filas pedir por página.
//
// El techo real no son las filas, son los BYTES: el relevo entre SAP y la aplicación corta
// alrededor de los 4,5 MB. Así que el tamaño de página se calcula desde un presupuesto de
// bytes y el ancho estimado de cada fila, no se fija a ojo.
//
// Los presupuestos de lectura y de escritura son distintos a propósito. La lectura tiene el
// más pequeño porque las respuestas grandes llegaban CORTADAS bajo carga bastante antes del
// límite duro; quedarse por debajo del zona de corte sale más barato que reintentar.
//
// Y una regla que viene del rendimiento medido: el cuello de botella NO es pedir páginas
// lejanas, es un costo fijo de unos 6 segundos por petición. Conviene pedir pocas páginas
// grandes con concurrencia moderada, no muchas páginas pequeñas.

export const DEFAULT_PAGE_SIZE = 2000
export const DEFAULT_CHUNK_SIZE = 500

export const READ_BYTE_BUDGET = 900_000
export const WRITE_BYTE_BUDGET = 3_500_000

export const PARALLEL_READS = 6
export const PARALLEL_WRITES = 3

const MIN_PAGE = 250
const MAX_PAGE = 5000
const MIN_CHUNK = 500

const clamp = (value, min, max) => Math.max(min, Math.min(max, Math.floor(value)))

/** Bytes que ocupa aproximadamente una fila leída, según cuántos campos trae. */
export function readBytesPerRow(fieldCount) {
  return 40 + fieldCount * 45
}

/** Bytes que ocupa aproximadamente una fila escrita (el cuerpo del envío es más verboso). */
export function writeBytesPerRow(fieldCount) {
  return 60 + fieldCount * 60
}

export function pageSizeFor(fieldCount) {
  if (!fieldCount || fieldCount < 1) return DEFAULT_PAGE_SIZE
  return clamp(READ_BYTE_BUDGET / readBytesPerRow(fieldCount), MIN_PAGE, MAX_PAGE)
}

export function pageSizeForBytes(bytesPerRow) {
  if (!bytesPerRow || bytesPerRow < 1) return DEFAULT_PAGE_SIZE
  return clamp(READ_BYTE_BUDGET / bytesPerRow, MIN_PAGE, MAX_PAGE)
}

export function chunkSizeFor(fieldCount) {
  if (!fieldCount || fieldCount < 1) return DEFAULT_CHUNK_SIZE
  // SAP además recomienda no pasar de 5.000 filas por importación.
  return clamp(WRITE_BYTE_BUDGET / writeBytesPerRow(fieldCount), MIN_CHUNK, MAX_PAGE)
}

export function chunkSizeForBytes(bytesPerRow) {
  if (!bytesPerRow || bytesPerRow < 1) return DEFAULT_CHUNK_SIZE
  return clamp(WRITE_BYTE_BUDGET / bytesPerRow, MIN_PAGE, MAX_PAGE)
}
