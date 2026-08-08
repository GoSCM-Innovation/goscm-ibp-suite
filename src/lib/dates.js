// Fechas y horas: SAP habla en UTC, la pantalla habla en la zona que elija el usuario.
//
// Portado de `src/utils/dateUtils.js` de v9. La regla de oro es la de allí, confirmada contra
// tenants reales:
//
//   - SAP devuelve las marcas de tiempo en UTC.
//   - Por dentro siempre se trabaja en UTC.
//   - Lo que se muestra puede ser UTC, UTC-4 o la hora del equipo, según preferencia.
//   - Los campos de fecha se interpretan en la zona elegida y se convierten a UTC antes de
//     mandárselos a SAP.
//
// No es un detalle cosmético: leer la hora de arranque de una tarea en la zona equivocada es una
// llamada de soporte. Por eso la zona se elige explícitamente y se recuerda.

export const TZ_OPTIONS = Object.freeze([
  { value: 'utc', label: 'UTC', offsetH: 0 },
  { value: 'utc-4', label: 'UTC-4', offsetH: -4 },
  // El desplazamiento del equipo se resuelve en el momento, así que no lleva número fijo.
  { value: 'local', label: 'Local', offsetH: null },
])

const STORAGE_KEY = 'ibp.tz'

export function readStoredTzMode() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (TZ_OPTIONS.some((option) => option.value === stored)) return stored
  } catch {
    // Navegador con el almacenamiento bloqueado: se sigue con UTC.
  }
  return 'utc'
}

export function storeTzMode(mode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // Si no se puede recordar, la zona igual se aplica en esta visita.
  }
}

/** Desplazamiento en horas de una zona. Para la del equipo se pregunta al navegador. */
export function tzOffsetHours(mode) {
  if (mode === 'local') return -new Date().getTimezoneOffset() / 60
  return TZ_OPTIONS.find((option) => option.value === mode)?.offsetH ?? 0
}

/** Las partes de una fecha ya vistas desde la zona elegida. */
function partes(date, mode) {
  if (mode === 'local') {
    return {
      dia: date.getDate(),
      mes: date.getMonth() + 1,
      anio: date.getFullYear(),
      hh: date.getHours(),
      mm: date.getMinutes(),
      ss: date.getSeconds(),
    }
  }
  // Para una zona de desplazamiento fijo se corre la fecha y se lee en UTC. Así el resultado no
  // depende de la zona del equipo donde corre el navegador.
  const corrida = new Date(date.getTime() + tzOffsetHours(mode) * 3600000)
  return {
    dia: corrida.getUTCDate(),
    mes: corrida.getUTCMonth() + 1,
    anio: corrida.getUTCFullYear(),
    hh: corrida.getUTCHours(),
    mm: corrida.getUTCMinutes(),
    ss: corrida.getUTCSeconds(),
  }
}

const dosDigitos = (numero) => String(numero).padStart(2, '0')

const escribir = ({ dia, mes, anio, hh, mm, ss }) =>
  `${dosDigitos(dia)}/${dosDigitos(mes)}/${anio} ${dosDigitos(hh)}:${dosDigitos(mm)}:${dosDigitos(ss)}`

/**
 * Marca de tiempo de SAP ("20260804123000...") a fecha, interpretada en UTC.
 * Los dígitos que sobran a partir del catorce son fracciones de segundo y se ignoran.
 */
export function parseSapTimestamp(timestamp) {
  const digitos = String(timestamp ?? '')
  if (digitos.length < 8) return null
  const numero = (desde, hasta) => Number.parseInt(digitos.slice(desde, hasta), 10) || 0
  const fecha = new Date(Date.UTC(
    numero(0, 4),
    numero(4, 6) - 1,
    numero(6, 8),
    numero(8, 10),
    numero(10, 12),
    numero(12, 14),
  ))
  return Number.isNaN(fecha.getTime()) ? null : fecha
}

/** Marca de tiempo de SAP lista para mostrar. Devuelve un guion cuando no hay dato. */
export function formatSapTimestamp(timestamp, mode) {
  if (String(timestamp ?? '').length < 14) return '—'
  const fecha = parseSapTimestamp(timestamp)
  return fecha ? escribir(partes(fecha, mode)) : '—'
}

/** Lo mismo para los milisegundos desde 1970, que es como llega el inicio de una ejecución. */
export function formatEpochMs(epochMs, mode) {
  if (!epochMs) return '—'
  const fecha = new Date(Number.parseInt(epochMs, 10))
  return Number.isNaN(fecha.getTime()) ? '—' : escribir(partes(fecha, mode))
}

/**
 * "DD/MM" a partir de los milisegundos desde 1970, para el eje de un gráfico por día.
 *
 * Se ordena bien alfabéticamente dentro de un mismo mes, que es lo que hace el tablero, pero NO
 * cruza el cambio de año: "01/01" queda antes de "31/12". Con el tope de 90 días del rango eso solo
 * aparece en un rango que cruce diciembre, y es lo mismo que hacía v9.
 */
export function dayLabelEpochMs(epochMs, mode) {
  if (!epochMs) return '?'
  const fecha = new Date(Number.parseInt(epochMs, 10))
  if (Number.isNaN(fecha.getTime())) return '?'
  const { dia, mes } = partes(fecha, mode)
  return `${dosDigitos(dia)}/${dosDigitos(mes)}`
}

/** Fecha a texto para un campo `datetime-local`, con la hora de la zona elegida. */
export function toInputValue(date, mode) {
  const corrida = new Date(date.getTime() + tzOffsetHours(mode) * 3600000)
  return corrida.toISOString().slice(0, 16)
}

/**
 * Al revés: lo que el usuario escribió en un campo se lee como hora de la zona elegida y se
 * devuelve la fecha real en UTC, que es la que entiende SAP.
 */
export function fromInputValue(value, mode) {
  if (!value) return null
  const comoUtc = new Date(`${value}:00.000Z`)
  if (Number.isNaN(comoUtc.getTime())) return null
  return new Date(comoUtc.getTime() - tzOffsetHours(mode) * 3600000)
}

/** Días enteros entre dos textos de campo. Se usa para el tope del rango. */
export function daysBetween(fromValue, toValue, mode) {
  const desde = fromInputValue(fromValue, mode)
  const hasta = fromInputValue(toValue, mode)
  if (!desde || !hasta) return null
  return Math.round((hasta.getTime() - desde.getTime()) / 86400000)
}

/**
 * Fecha de OData V2 (`/Date(1657818112000)/`) lista para mostrar.
 *
 * SAP mezcla los dos formatos en el mismo servicio: las ejecuciones traen la cadena de catorce
 * digitos y las plantillas, esto. Pasarle una a la funcion de la otra da el 20/12/1899, que parece
 * un dato y no lo es.
 */
export function formatODataDate(value, mode) {
  const ms = String(value ?? '').match(/^\/Date\((-?\d+)/)
  return ms ? formatEpochMs(ms[1], mode) : '—'
}
