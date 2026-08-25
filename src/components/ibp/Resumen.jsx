// El tablero del tenant: cómo viene la cosa antes de que nadie busque una ejecución concreta.
//
// Portado de `Resumen.jsx` de v8. Las cuentas están en `lib/ibp-summary.js` para poder probarlas;
// en v8 vivían dentro del render y por eso el resumen del tenant y el global no coincidían.
//
// Comparte los gráficos con el tablero de CI-DS —una torta es una torta— pero no los datos: son
// cosas distintas y cada módulo mantiene el suyo.

import { useCallback, useEffect, useMemo, useState } from 'react'

import { jobStatusMeta } from '../../../core/ibp/job-status.js'
import { formatSapTimestamp } from '../../lib/dates.js'
import { fetchJobRuns, fetchJobStatuses, nombreDeEjecucion } from '../../lib/ibp-jobs.js'
import { contarEjecuciones, masEjecutados, porDia, porEstado, ultimasFalladas } from '../../lib/ibp-summary.js'
import { useDateRange } from '../../lib/useDateRange.js'
import DateRangeBar from '../ui/DateRangeBar.jsx'
import { PerDayBars, SinDatos, StatusDonut } from '../ui/StatusCharts.jsx'

/** Cada cuánto se refresca. Cinco minutos, el de v8: un tablero no se mira segundo a segundo. */
const REFRESCO_MS = 5 * 60_000

const MAX_DIAS = 90

function Kpi({ etiqueta, valor, color }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{etiqueta}</div>
      <div className="kpi-valor" style={color ? { color } : undefined}>{valor}</div>
    </div>
  )
}

/** El color de la tasa: verde si va bien, ámbar si preocupa, rojo si es un problema. */
const colorDeTasa = (tasa) => {
  if (tasa === null) return undefined
  if (tasa >= 90) return 'var(--green)'
  return tasa >= 70 ? 'var(--accent)' : 'var(--red)'
}

export default function Resumen({ conexionId }) {
  const { zona, rango, dias, rangoValido, rangoIncompleto, rangoExcedido, startDateFrom, startDateTo, cambiarZona, cambiarRango } = useDateRange({ maxDays: MAX_DIAS })

  const [datos, setDatos] = useState(null)
  const [etiquetas, setEtiquetas] = useState({})
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let abandonado = false
    fetchJobStatuses(conexionId)
      .then((estados) => {
        if (!abandonado) setEtiquetas(Object.fromEntries(estados.map((uno) => [uno.JobStatus, uno.JobStatusText || uno.Text])))
      })
      .catch(() => {})
    return () => { abandonado = true }
  }, [conexionId])

  const cargar = useCallback(() => {
    if (!rangoValido) return undefined
    let abandonado = false

    fetchJobRuns(conexionId, { desde: startDateFrom, hasta: startDateTo })
      .then((respuesta) => {
        if (abandonado) return
        setDatos(respuesta)
        setError('')
        setCargando(false)
      })
      .catch((fallo) => {
        if (abandonado) return
        setError(fallo.message)
        setCargando(false)
      })

    return () => { abandonado = true }
  }, [conexionId, startDateFrom, startDateTo, rangoValido])

  useEffect(() => {
    const id = setTimeout(cargar, 0)
    return () => clearTimeout(id)
  }, [cargar])

  // En pausa mientras la pestaña no se ve.
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) cargar() }, REFRESCO_MS)
    return () => clearInterval(id)
  }, [cargar])

  const runs = useMemo(() => datos?.runs ?? [], [datos])
  const cuentas = useMemo(() => contarEjecuciones(runs), [runs])
  const torta = useMemo(() => porEstado(runs, etiquetas), [runs, etiquetas])
  const barras = useMemo(() => porDia(runs, zona), [runs, zona])
  const top = useMemo(() => masEjecutados(runs), [runs])
  const falladas = useMemo(() => ultimasFalladas(runs), [runs])

  return (
    <div className="module-body">
      <div className="monitor-bar">
        <DateRangeBar rango={rango} zona={zona} dias={dias} onZona={cambiarZona} onRango={cambiarRango} />
        <button type="button" className="btn btn-sm" onClick={cargar} disabled={!rangoValido}>↺ Actualizar</button>
        <span className="page-hint">
          {cargando ? 'Consultando…' : `${cuentas.total} ejecuciones en el período`}
        </span>
      </div>

      {rangoIncompleto && <div className="notice notice-info">Elige las dos fechas del rango para consultar.</div>}
      {rangoExcedido && (
        <div className="notice notice-info">El rango es de {dias} días y el tope son {MAX_DIAS}.</div>
      )}
      {error && <div className="notice notice-error">✕ {error}</div>}
      {datos?.aviso && <div className="notice notice-info">{datos.aviso}</div>}

      <div className="tablero">
        <div className="grid-kpi">
        <Kpi etiqueta="Total ejecuciones" valor={cuentas.total} />
        <Kpi etiqueta="En ejecución" valor={cuentas.corriendo} color={cuentas.corriendo > 0 ? 'var(--cyan)' : undefined} />
        <Kpi etiqueta="En cola" valor={cuentas.enCola} />
        <Kpi etiqueta="Correctas" valor={cuentas.correctas} color="var(--green)" />
        <Kpi etiqueta="Falladas" valor={cuentas.falladas} color={cuentas.falladas > 0 ? 'var(--red)' : undefined} />
          <Kpi etiqueta="Tasa de éxito" valor={cuentas.tasa === null ? '—' : `${cuentas.tasa}%`} color={colorDeTasa(cuentas.tasa)} />
        </div>

        <div className="grid-charts">
          <div className="card">
            <div className="card-label">Distribución por estado</div>
            <StatusDonut porEstado={torta} />
          </div>

          <div className="card">
            <div className="card-label">Ejecuciones por día</div>
            <PerDayBars porDia={barras} />
          </div>
        </div>

        <div className="grid-stats">
          <div className="card">
            <div className="card-label">Trabajos más ejecutados</div>
            {top.length === 0 ? <SinDatos /> : top.map((uno) => (
              <div className="lista-fila agente" key={uno.nombre}>
                <span className="lista-nombre" title={uno.nombre}>{uno.nombre}</span>
                <span className="agente-estado">
                  {uno.veces}
                  {uno.falladas > 0 && <span style={{ color: 'var(--red)' }}> · {uno.falladas} con fallo</span>}
                </span>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-label">Últimas falladas</div>
            {falladas.length === 0
              ? <p className="todo-bien">✓ Sin fallos en el período</p>
              : falladas.map((run) => {
                const meta = jobStatusMeta(run.JobStatus)
                return (
                  <div className="lista-fila agente" key={`${run.JobName}|${run.JobRunCount}`}>
                    {/* El nombre y la fecha en dos líneas: en una sola se pegan y no se lee dónde
                        acaba el trabajo y empieza la hora. */}
                    <span className="lista-nombre" title={nombreDeEjecucion(run)}>
                      <div className="lista-titulo">{nombreDeEjecucion(run)}</div>
                      <div className="lista-detalle">{formatSapTimestamp(run.JobPlannedStartDateTime, zona)}</div>
                    </span>
                    <span
                      className="badge"
                      style={{ background: `${meta.color}26`, borderColor: `${meta.color}4d`, color: meta.color }}
                    >
                      {etiquetas[run.JobStatus] || meta.label}
                    </span>
                  </div>
                )
              })}
          </div>
        </div>
      </div>
    </div>
  )
}
