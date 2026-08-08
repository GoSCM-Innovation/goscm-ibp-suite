// Las cuentas del tablero de IBP Tools.
//
// Portado de `Resumen.jsx` de v8, con las cuentas sacadas del componente para poder probarlas: en v8
// vivían dentro del render y por eso estaban repetidas —con diferencias— entre el resumen del tenant
// y el global.
//
// Aquí solo hay aritmética sobre las ejecuciones que ya se trajeron. No consulta nada.

import { isJobFailed, isJobFinished, isJobQueued, isJobRunning, jobStatusMeta, jobSuccessRate } from '../../core/ibp/job-status.js'
import { dayLabelEpochMs, parseSapTimestamp } from './dates.js'
import { nombreDeEjecucion } from './ibp-jobs.js'

/** Cuántas hay de cada cosa. `tasa` es `null` cuando todavía no acabó ninguna. */
export function contarEjecuciones(runs) {
  const estados = runs.map((uno) => uno.JobStatus)
  return {
    total: runs.length,
    corriendo: estados.filter(isJobRunning).length,
    enCola: estados.filter(isJobQueued).length,
    correctas: estados.filter(isJobFinished).length,
    falladas: estados.filter(isJobFailed).length,
    tasa: jobSuccessRate(estados),
  }
}

/** La torta: una porción por estado, de mayor a menor, con el color y la etiqueta de cada uno. */
export function porEstado(runs, etiquetas = {}) {
  const cuenta = new Map()
  for (const run of runs) cuenta.set(run.JobStatus, (cuenta.get(run.JobStatus) ?? 0) + 1)

  return [...cuenta]
    .map(([code, value]) => ({
      code,
      value,
      name: etiquetas[code] || jobStatusMeta(code).label,
      color: jobStatusMeta(code).color,
    }))
    .sort((a, b) => b.value - a.value)
}

/**
 * Las barras por día, en orden cronológico.
 *
 * Se agrupa por la fecha PLANIFICADA y no por la de inicio: una ejecución programada que todavía no
 * arrancó no tiene inicio, y dejarla fuera haría que el día de hoy pareciera vacío por la mañana.
 */
export function porDia(runs, zona) {
  const dias = new Map()

  for (const run of runs) {
    const fecha = parseSapTimestamp(run.JobPlannedStartDateTime)
    if (!fecha) continue

    const dia = dayLabelEpochMs(fecha.getTime(), zona)
    if (!dias.has(dia)) dias.set(dia, { dia, orden: fecha.getTime(), Correctas: 0, Falladas: 0, Otras: 0 })

    const fila = dias.get(dia)
    if (isJobFinished(run.JobStatus)) fila.Correctas += 1
    else if (isJobFailed(run.JobStatus)) fila.Falladas += 1
    else fila.Otras += 1
  }

  return [...dias.values()].sort((a, b) => a.orden - b.orden)
}

/** Cuántas veces corrió cada trabajo, de más a menos. */
export function masEjecutados(runs, tope = 8) {
  const cuenta = new Map()

  for (const run of runs) {
    const nombre = nombreDeEjecucion(run)
    if (!cuenta.has(nombre)) cuenta.set(nombre, { nombre, veces: 0, falladas: 0 })

    const fila = cuenta.get(nombre)
    fila.veces += 1
    if (isJobFailed(run.JobStatus)) fila.falladas += 1
  }

  return [...cuenta.values()].sort((a, b) => b.veces - a.veces).slice(0, tope)
}

/**
 * Las últimas que fallaron, de la más reciente a la más antigua.
 *
 * Se ordena por la fecha planificada porque es la única que tienen todas: una que falló al arrancar
 * puede no tener fecha de inicio.
 */
export function ultimasFalladas(runs, tope = 8) {
  return runs
    .filter((uno) => isJobFailed(uno.JobStatus))
    .sort((a, b) => String(b.JobPlannedStartDateTime ?? '').localeCompare(String(a.JobPlannedStartDateTime ?? '')))
    .slice(0, tope)
}
