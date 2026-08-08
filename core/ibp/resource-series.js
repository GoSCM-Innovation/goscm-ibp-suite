// La serie de consumo de CPU y memoria de un tenant: cómo se lee, cómo se agrupa y cómo se resume.
//
// Portado de `ResourceStats.jsx` de v8, que hacía las tres cosas dentro del componente.
//
// Sin dependencias a propósito: lo usan el servidor —para no devolver 8.640 puntos que el navegador
// va a promediar igual— y la pantalla —para las etiquetas de los rangos—. Importarlo del módulo de
// al lado arrastraría `sapFetch` y con él `node:dns` al paquete del navegador. Es el mismo reparto
// que ya se hizo con `job-params.js`.

/** Los rangos que ofrece la pantalla. `horas` es lo que se le pide a SAP. */
export const RANGOS_DE_RECURSOS = Object.freeze([
  { horas: 1, label: '1 h' },
  { horas: 4, label: '4 h' },
  { horas: 24, label: '24 h' },
  { horas: 168, label: '7 d' },
  { horas: 720, label: '30 d' },
])

/**
 * Los milisegundos de una fecha de OData v2 (`/Date(1786227900000+0000)/`).
 *
 * Devuelve `NaN` si no tiene esa forma, y quien llama descarta la fila: una marca ilegible dibujaría
 * un punto en 1970 y arruinaría la escala del gráfico entero.
 */
export function parseOdataDate(valor) {
  const marca = /\/Date\((-?\d+)/.exec(String(valor ?? ''))
  return marca ? Number(marca[1]) : Number.NaN
}

/**
 * Cada cuánto agrupar los puntos, en milisegundos, según el rango pedido. `0` es «no agrupar».
 *
 * SAP muestrea cada diez minutos. En treinta días son 4.320 puntos y el gráfico se vuelve una mancha
 * —además de pesar—, así que a partir de una semana se promedian. Por debajo se dibujan todos: en
 * cuatro horas son 24 puntos y agrupar escondería justamente el pico que se está buscando.
 */
export function intervaloDeAgrupacion(horas) {
  if (horas >= 720) return 60 * 60_000
  if (horas >= 168) return 10 * 60_000
  return 0
}

/**
 * Promedia los puntos en tramos de `intervaloMs`.
 *
 * El promedio y no el máximo porque la serie es de ocupación sostenida: quedarse con el pico de cada
 * hora pintaría una línea que nunca baja y haría creer que el tenant vive saturado.
 */
export function agrupar(filas, intervaloMs) {
  if (!intervaloMs || filas.length === 0) return filas

  const tramos = new Map()
  for (const fila of filas) {
    const tramo = Math.floor(fila.ts / intervaloMs) * intervaloMs
    const acumulado = tramos.get(tramo) ?? { ts: tramo, cpu: 0, mem: 0, n: 0 }
    acumulado.cpu += fila.cpu
    acumulado.mem += fila.mem
    acumulado.n += 1
    tramos.set(tramo, acumulado)
  }

  return [...tramos.values()]
    .sort((a, b) => a.ts - b.ts)
    .map(({ ts, cpu, mem, n }) => ({
      ts,
      cpu: Math.round((cpu / n) * 10) / 10,
      mem: Math.round((mem / n) * 10) / 10,
    }))
}

/** Convierte las filas de SAP en la serie, en orden cronológico y sin las que no se entienden. */
export function serieDesdeFilas(filas) {
  return (filas ?? [])
    .map((fila) => ({
      ts: parseOdataDate(fila.Timestamp),
      cpu: Number.parseFloat(fila.CpuUsage),
      mem: Number.parseFloat(fila.MemoryUsage),
    }))
    .filter((punto) => Number.isFinite(punto.ts) && Number.isFinite(punto.cpu) && Number.isFinite(punto.mem))
    .sort((a, b) => a.ts - b.ts)
}

/** El último valor, el pico y la media de la serie. `null` en todo si no hay puntos. */
export function resumenDeRecursos(serie) {
  if (!serie || serie.length === 0) {
    return { muestras: 0, cpu: null, mem: null, cpuMax: null, memMax: null, cpuMedia: null, memMedia: null, desde: null, hasta: null }
  }

  // A un decimal en los tres: en los rangos cortos no se agrupa, así que el último valor llega tal
  // como lo escribe SAP —"35.61"— y quedaría con más precisión que el pico y la media de al lado.
  const decimal = (valor) => Math.round(valor * 10) / 10
  const media = (clave) => decimal(serie.reduce((suma, uno) => suma + uno[clave], 0) / serie.length)
  const pico = (clave) => decimal(Math.max(...serie.map((uno) => uno[clave])))
  const ultimo = serie[serie.length - 1]

  return {
    muestras: serie.length,
    cpu: decimal(ultimo.cpu),
    mem: decimal(ultimo.mem),
    cpuMax: pico('cpu'),
    memMax: pico('mem'),
    cpuMedia: media('cpu'),
    memMedia: media('mem'),
    desde: serie[0].ts,
    hasta: ultimo.ts,
  }
}
