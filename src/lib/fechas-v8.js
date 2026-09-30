// Las fechas y la zona horaria de las pantallas de v8. Portado de `utils/dateUtils.js` de v8.
//
// La regla de v8: SAP IBP devuelve las horas en UTC, por dentro todo es UTC, y lo que se MUESTRA
// puede ser UTC o la hora del navegador según el conmutador «UTC / UTC-3» de cada pantalla. Los
// campos de fecha se leen en la zona elegida y se pasan a UTC antes de pedirle nada a SAP.
//
// Es aparte de `dates.js` a propósito: aquel es el de v9, con su «UTC / UTC-4» fijo, y lo usan las
// pantallas de CI-DS. Las de IBP Tools son de v8 y ofrecen UTC y la hora del navegador, como allí.
// La preferencia se guarda con la MISMA clave que en v8.

const TZ_KEY = 'ibp_tz_mode' // 'utc' | 'local'

export function getTzMode() {
  try { return localStorage.getItem(TZ_KEY) === 'local' ? 'local' : 'utc' } catch { return 'utc' }
}

export function setTzMode(mode) {
  try { localStorage.setItem(TZ_KEY, mode) } catch { /* sin espacio */ }
}

/** El desfase del navegador, como lo escribía v8: «UTC-3», «UTC+5:30». */
export function getTzLabel(date = new Date()) {
  const off = -date.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return m === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${String(m).padStart(2, '0')}`
}

/** «YYYYMMDDHHMMSS…» de SAP, leído como UTC. `null` si no se puede leer. */
export function parseSapTs(ts) {
  if (!ts || String(ts).length < 8) return null
  const s = String(ts)
  const d = new Date(Date.UTC(
    parseInt(s.slice(0, 4), 10),
    parseInt(s.slice(4, 6), 10) - 1,
    parseInt(s.slice(6, 8), 10),
    parseInt(s.slice(8, 10) || '0', 10),
    parseInt(s.slice(10, 12) || '0', 10),
    parseInt(s.slice(12, 14) || '0', 10),
  ))
  return Number.isNaN(d.getTime()) ? null : d
}

const p2 = n => String(n).padStart(2, '0')

function partes(d, mode) {
  return mode === 'local'
    ? [d.getDate(), d.getMonth() + 1, d.getFullYear(), d.getHours(), d.getMinutes(), d.getSeconds()]
    : [d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCFullYear(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
}

/** «DD/MM/YYYY HH:MM:SS» en la zona elegida. «—» si no hay hora. */
export function formatSapTs(ts, mode) {
  if (!ts || String(ts).length < 14) return '—'
  const d = parseSapTs(ts)
  if (!d) return '—'
  const [day, month, year, hh, mm, ss] = partes(d, mode ?? getTzMode())
  return `${p2(day)}/${p2(month)}/${year} ${p2(hh)}:${p2(mm)}:${p2(ss)}`
}

/** La versión corta, sin segundos, para tableros. */
export function formatSapTsShort(ts, mode) {
  if (!ts || String(ts).length < 12) return '—'
  const d = parseSapTs(ts)
  if (!d) return '—'
  const [day, month, year, hh, mm] = partes(d, mode ?? getTzMode())
  return `${p2(day)}/${p2(month)}/${year} ${p2(hh)}:${p2(mm)}`
}

/** «DD/MM» para los ejes de los gráficos. */
export function dayLabel(ts, mode) {
  const d = parseSapTs(ts)
  if (!d) return '?'
  const [day, month] = partes(d, mode ?? getTzMode())
  return `${p2(day)}/${p2(month)}`
}

/** Un `Date` como lo espera `<input type="datetime-local">`, en la zona elegida. */
export function toInputDate(date, mode) {
  if ((mode ?? getTzMode()) === 'local') {
    return `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())}`
      + `T${p2(date.getHours())}:${p2(date.getMinutes())}`
  }
  return date.toISOString().slice(0, 16)
}

/** Lo escrito en un `datetime-local`, leído en la zona elegida, como `Date`. */
export function inputDateToDate(value, mode) {
  if ((mode ?? getTzMode()) === 'local') return new Date(value)
  return new Date(`${value}:00.000Z`)
}
