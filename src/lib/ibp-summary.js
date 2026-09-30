// Las cuentas de los dos resúmenes de IBP Tools: el de una conexión y el global.
//
// Portado de `Resumen/Resumen.jsx` y `Resumen/GlobalResumen.jsx` de v8, con sus reglas TAL CUAL,
// incluidas las que difieren entre las dos pantallas. Parecen descuidos y no se unifican, porque son
// las cifras que los clientes llevan años leyendo:
//
//   - «Fallidos» en la tarjeta del resumen de una conexión cuenta solo `A`; en el global, `A` y `U`.
//   - La tasa de éxito de una conexión es (F+W) / (F+W+A+U): solo lo que ya acabó. La del global es
//     (F+W) / todas las filas del período, incluidas las que siguen en cola.
//   - «Programados» es S, P e Y; «En ejecución», solo R.
//
// En v8 esto vivía dentro del render de cada pantalla; aquí se saca para poder probarlo. No consulta
// nada: solo aritmética sobre las filas de `JobHeaderSet` que ya se trajeron.

import { dayLabel, parseSapTs } from './fechas-v8.js'
import { nombreConAmbiente } from './nombre-de-conexion.js'

/** Los colores de estado de los resúmenes de v8. Son otros que los del monitor, como en v8. */
export const STATUS_COLORS = Object.freeze({
  F: '#34d399', W: '#fbbf24', A: '#ff6b6b', U: '#f97316',
  R: '#3b82f6', S: '#8b5cf6', P: '#06b6d4', Y: '#a78bfa',
  C: '#9ca3af', c: '#9ca3af', D: '#4b5563', K: '#6b7280',
  X: '#374151', k: '#6b7280',
})

/** Con qué se pinta un código que la tabla no conoce. */
export const STATUS_FALLBACK_COLOR = '#6b7280'

export const colorDeEstado = code => STATUS_COLORS[code] || STATUS_FALLBACK_COLOR

/**
 * Los nombres fijos de estado del resumen global (`global.jobStatus*` de v8).
 *
 * El resumen de una conexión usa los textos que manda SAP en `JobStatusInfoSet`; el global, que
 * junta tenants, usaba estos. Un código que no está aquí se muestra tal cual.
 */
export const GLOBAL_STATUS_LABELS = Object.freeze({
  F: 'Finalizado', W: 'Con advertencias', A: 'Fallido',
  U: 'Error de usuario', R: 'En ejecución', S: 'Programado',
  P: 'Liberado', Y: 'Listo', C: 'Cancelado',
  D: 'Eliminado', K: 'Omitido', X: 'Desconocido',
})

/** El acuerdo que necesitan los resúmenes: Application Jobs. */
export const ACUERDO_DE_JOBS = 'SAP_COM_0326'

/** ¿La conexión tiene dado de alta el acuerdo de Application Jobs? Sin él, v8 ni consultaba. */
export const tieneAcuerdoDeJobs = conn => (conn?.agreements ?? []).includes(ACUERDO_DE_JOBS)

/**
 * Las filas cuyo inicio PLANIFICADO cae en el período. Las que no tienen fecha planificada se
 * quedan siempre, como en v8.
 *
 * Se filtra aquí además de en SAP porque el tenant puede haber rechazado el filtro —entonces llega
 * todo— y porque los dos tableros tienen que contar lo mismo que se pidió.
 *
 * `desde` y `hasta` son las marcas de catorce dígitos de SAP (`AAAAMMDDHHMMSS`). La fila se compara
 * por sus catorce primeros caracteres: SAP la escribe con fracción («…120000.0000000») y v8 le
 * añadía la misma fracción al límite, así que el resultado es idéntico. Si un límite no se pudo leer
 * (el campo de fecha quedó vacío) no hay período, y solo quedan las filas sin fecha.
 */
export function filtrarPorPlanificada(rows, desde, hasta) {
  return (rows ?? []).filter(r => {
    const ts = String(r?.JobPlannedStartDateTime || '')
    if (!ts) return true
    if (!desde || !hasta) return false
    const corto = ts.slice(0, 14)
    return corto >= desde && corto <= hasta
  })
}

/** Cuenta por clave y devuelve `[clave, veces]` de más a menos, hasta `tope`. */
function ranking(rows, claveDe, tope = 5) {
  const cuenta = {}
  rows.forEach(r => {
    const k = claveDe(r)
    cuenta[k] = (cuenta[k] || 0) + 1
  })
  return Object.entries(cuenta).sort((a, b) => b[1] - a[1]).slice(0, tope)
}

/** Más reciente primero, por el inicio planificado (es la única fecha que tienen todas). */
const porPlanificadaDesc = (a, b) => (b.JobPlannedStartDateTime || '').localeCompare(a.JobPlannedStartDateTime || '')

/**
 * Todo lo que enseña el resumen de UNA conexión, a partir de las filas ya filtradas por período.
 *
 * `statusLabel` pone nombre a cada código (en v8, el texto de `JobStatusInfoSet` o el código).
 */
export function resumenDeConexion(filtered, { tzMode = 'utc', statusLabel = code => code } = {}) {
  const rows = filtered ?? []
  const total     = rows.length
  const running   = rows.filter(r => r.JobStatus === 'R').length
  const scheduled = rows.filter(r => ['S', 'P', 'Y'].includes(r.JobStatus)).length
  const finished  = rows.filter(r => r.JobStatus === 'F').length
  const failed    = rows.filter(r => r.JobStatus === 'A').length
  const warned    = rows.filter(r => r.JobStatus === 'W').length
  const errored   = rows.filter(r => ['A', 'U'].includes(r.JobStatus)).length
  const executed  = finished + warned + errored
  const successRate = executed > 0 ? Math.round(((finished + warned) / executed) * 100) : 0

  const statusCount = {}
  rows.forEach(r => { statusCount[r.JobStatus] = (statusCount[r.JobStatus] || 0) + 1 })
  const donutData = Object.entries(statusCount)
    .map(([code, count]) => ({ name: statusLabel(code), value: count, code }))
    .sort((a, b) => b.value - a.value)

  // Los días se agrupan y se ordenan por su etiqueta «DD/MM» como texto, igual que v8. Ojo: al
  // cruzar de mes eso pone el 01/10 antes que el 29/09, y los «últimos 14» se toman de ese orden.
  // Se conserva a propósito para que la comparación lado a lado con v8 dé lo mismo; cambiarlo es una
  // decisión pendiente, no un descuido.
  const dayMap = {}
  rows.forEach(r => {
    const d = dayLabel(r.JobPlannedStartDateTime, tzMode)
    if (!dayMap[d]) dayMap[d] = { day: d, finished: 0, failed: 0, others: 0 }
    if (r.JobStatus === 'F' || r.JobStatus === 'W') dayMap[d].finished++
    else if (r.JobStatus === 'A' || r.JobStatus === 'U') dayMap[d].failed++
    else dayMap[d].others++
  })
  const barData = Object.values(dayMap).sort((a, b) => a.day.localeCompare(b.day)).slice(-14)

  const topTemplates = ranking(rows, r => r.JobText || '—')
  const topUsers = ranking(rows, r => r.JobCreatedByFormattedName || r.JobCreatedBy || '—')

  const durationMap = {}
  rows.forEach(r => {
    if (!['F', 'W'].includes(r.JobStatus)) return
    const start = parseSapTs(r.JobStartDateTime)
    const end   = parseSapTs(r.JobEndDateTime)
    if (!start || !end || end <= start) return
    const mins = (end - start) / 60000
    const k = r.JobText || '—'
    if (!durationMap[k]) durationMap[k] = { total: 0, count: 0 }
    durationMap[k].total += mins
    durationMap[k].count += 1
  })
  const topDuration = Object.entries(durationMap)
    .map(([name, { total: tot, count }]) => ({ name, avg: tot / count }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5)

  const recentFailed = rows
    .filter(r => ['A', 'U'].includes(r.JobStatus))
    .sort(porPlanificadaDesc)
    .slice(0, 5)

  return {
    total, running, scheduled, finished, failed, warned, errored, successRate,
    donutData, barData, topTemplates, topUsers, topDuration, recentFailed,
  }
}

/** Una duración en minutos como la escribía v8: «45s», «12 min», «1h 5m», «2h». */
export function fmtDuration(mins) {
  if (mins < 1)   return `${Math.round(mins * 60)}s`
  if (mins < 60)  return `${Math.round(mins)} min`
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

/** Las cifras de una conexión en el resumen global. La tasa, sobre TODAS las filas (regla de v8). */
export function resumirParaGlobal(rows) {
  const total = rows.length
  const finished = rows.filter(r => r.JobStatus === 'F').length
  const warned = rows.filter(r => r.JobStatus === 'W').length
  const failed = rows.filter(r => ['A', 'U'].includes(r.JobStatus)).length
  const running = rows.filter(r => r.JobStatus === 'R').length
  const scheduled = rows.filter(r => ['S', 'P', 'Y'].includes(r.JobStatus)).length
  const successRate = total > 0 ? Math.round(((finished + warned) / total) * 100) : 0
  return { total, finished, failed, running, scheduled, successRate, warned }
}

/** El nombre de una conexión en el eje del gráfico: más de 20 caracteres se corta a 18 y «…». */
export function nombreParaEje(conn) {
  const n = nombreConAmbiente(conn)
  return n.length > 20 ? n.slice(0, 18) + '…' : n
}

/**
 * Todo lo que enseña el resumen global.
 *
 * `connData` es lo último que contestó cada conexión, por id: `{ rows, error, loading,
 * noAgreement }`. Una conexión sin entrada todavía está cargando.
 */
export function resumenGlobal(connections, connData, { desde, hasta } = {}) {
  const filterRows = rows => filtrarPorPlanificada(rows, desde, hasta)
  const cero = { total: 0, finished: 0, failed: 0, running: 0, scheduled: 0, successRate: 0, warned: 0 }

  const connSummaries = connections.map((conn, idx) => {
    const d = connData[conn.id]
    if (!tieneAcuerdoDeJobs(conn)) return { conn, idx, loading: false, ...cero, error: '', noAgreement: true }
    if (!d || d.loading) return { conn, idx, loading: true, ...cero, error: '' }
    if (d.error) return { conn, idx, loading: false, ...cero, error: d.error }
    return { conn, idx, loading: false, ...resumirParaGlobal(filterRows(d.rows)), error: '' }
  })

  const suma = campo => connSummaries.reduce((s, c) => s + (c[campo] || 0), 0)
  const gTotal = suma('total')
  const gFinished = suma('finished')
  const gFailed = suma('failed')
  const gRunning = suma('running')
  const gScheduled = suma('scheduled')
  const gWarned = suma('warned')
  const gSuccessRate = gTotal > 0 ? Math.round(((gFinished + gWarned) / gTotal) * 100) : 0

  const globalStatusCount = {}
  connections.forEach(conn => {
    const d = connData[conn.id]
    if (!d || d.error) return
    filterRows(d.rows).forEach(r => {
      globalStatusCount[r.JobStatus] = (globalStatusCount[r.JobStatus] || 0) + 1
    })
  })
  const donutData = Object.entries(globalStatusCount)
    .map(([code, count]) => ({ name: GLOBAL_STATUS_LABELS[code] || code, value: count, code }))
    .sort((a, b) => b.value - a.value)

  const connBarData = connSummaries
    .filter(c => !c.error && !c.noAgreement)
    .map(c => ({
      name: nombreParaEje(c.conn),
      finished: c.finished + (c.warned || 0),
      failed: c.failed,
      others: c.total - c.finished - (c.warned || 0) - c.failed,
    }))

  const allFailures = []
  connections.forEach(conn => {
    const d = connData[conn.id]
    if (!d || d.error) return
    filterRows(d.rows)
      .filter(r => ['A', 'U'].includes(r.JobStatus))
      .forEach(r => allFailures.push({ ...r, _connName: nombreConAmbiente(conn) }))
  })
  allFailures.sort(porPlanificadaDesc)
  const recentFailures = allFailures.slice(0, 8)

  return {
    connSummaries, gTotal, gFinished, gFailed, gRunning, gScheduled, gWarned, gSuccessRate,
    donutData, connBarData, recentFailures,
  }
}
