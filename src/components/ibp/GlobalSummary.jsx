// Todos los tenants de IBP a la vez.
//
// Portado de `GlobalResumen.jsx` de v8. Contesta una pregunta que el tablero de un tenant no puede:
// "¿hay algo roto en ALGUNO de mis sistemas?" — sin tener que entrar en cada uno.
//
// Las cuentas son las mismas de `lib/ibp-summary.js` que usa el tablero del tenant. En v8 estaban
// duplicadas entre las dos pantallas y por eso no siempre coincidían.

import { useCallback, useEffect, useMemo, useState } from 'react'

import { formatSapTimestamp } from '../../lib/dates.js'
import { listIbpConnections } from '../../lib/ibp.js'
import { fetchJobRuns, fetchJobStatuses } from '../../lib/ibp-jobs.js'
import { contarEjecuciones, porDia, porEstado, ultimasFalladas } from '../../lib/ibp-summary.js'
import { useDateRange } from '../../lib/useDateRange.js'
import DateRangeBar from '../ui/DateRangeBar.jsx'
import { PerDayBars, StatusDonut } from '../ui/StatusCharts.jsx'

const REFRESCO_MS = 5 * 60_000
const MAX_DIAS = 90

/** Junta las barras por día de varios tenants sumando cada columna. */
function juntarPorDia(porTenant) {
  const dias = new Map()

  for (const filas of porTenant) {
    for (const fila of filas) {
      if (!dias.has(fila.dia)) dias.set(fila.dia, { ...fila })
      else {
        const acumulada = dias.get(fila.dia)
        acumulada.Correctas += fila.Correctas
        acumulada.Falladas += fila.Falladas
        acumulada.Otras += fila.Otras
      }
    }
  }

  return [...dias.values()].sort((a, b) => a.orden - b.orden)
}

export default function GlobalSummary() {
  const { zona, rango, dias, rangoValido, rangoIncompleto, rangoExcedido, startDateFrom, startDateTo, cambiarZona, cambiarRango } = useDateRange({ maxDays: MAX_DIAS })

  const [tenants, setTenants] = useState(null)
  const [porTenant, setPorTenant] = useState({})
  const [etiquetas, setEtiquetas] = useState({})
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let abandonado = false
    listIbpConnections()
      .then((lista) => {
        if (abandonado) return
        setTenants(lista)
        // Las etiquetas de estado son de SAP y valen para todos: basta pedirlas a uno.
        if (lista[0]) {
          fetchJobStatuses(lista[0].id)
            .then((estados) => {
              if (!abandonado) setEtiquetas(Object.fromEntries(estados.map((uno) => [uno.JobStatus, uno.JobStatusText || uno.Text])))
            })
            .catch(() => {})
        }
      })
      .catch(() => { if (!abandonado) setTenants([]) })
    return () => { abandonado = true }
  }, [])

  const cargar = useCallback(() => {
    if (!rangoValido || !tenants?.length) return undefined
    let abandonado = false

    // En paralelo: son tenants distintos y no compiten entre sí. Que uno falle no tapa a los demás.
    Promise.all(tenants.map((uno) => fetchJobRuns(uno.id, { desde: startDateFrom, hasta: startDateTo })
      .then((respuesta) => [uno.id, { runs: respuesta.runs ?? [] }])
      .catch((fallo) => [uno.id, { runs: [], error: fallo.message }])))
      .then((pares) => {
        if (abandonado) return
        setPorTenant(Object.fromEntries(pares))
        setCargando(false)
      })

    return () => { abandonado = true }
  }, [tenants, startDateFrom, startDateTo, rangoValido])

  useEffect(() => {
    const id = setTimeout(cargar, 0)
    return () => clearTimeout(id)
  }, [cargar])

  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) cargar() }, REFRESCO_MS)
    return () => clearInterval(id)
  }, [cargar])

  const todas = useMemo(() => Object.values(porTenant).flatMap((uno) => uno.runs), [porTenant])
  const totales = useMemo(() => contarEjecuciones(todas), [todas])
  const torta = useMemo(() => porEstado(todas, etiquetas), [todas, etiquetas])
  const barras = useMemo(
    () => juntarPorDia(Object.values(porTenant).map((uno) => porDia(uno.runs, zona))),
    [porTenant, zona],
  )

  if (tenants === null) return <div className="page-hint">Cargando tenants…</div>
  if (tenants.length === 0) return <div className="notice notice-info">No hay ninguna conexión a SAP IBP configurada.</div>

  return (
    <div className="module-body">
      <div className="monitor-bar">
        <DateRangeBar rango={rango} zona={zona} dias={dias} onZona={cambiarZona} onRango={cambiarRango} />
        <button type="button" className="btn btn-sm" onClick={cargar} disabled={!rangoValido}>↺ Actualizar</button>
        <span className="page-hint">
          {cargando
            ? `Consultando ${tenants.length} ${tenants.length === 1 ? 'tenant' : 'tenants'}…`
            : `${tenants.length} ${tenants.length === 1 ? 'tenant' : 'tenants'} · ${totales.total} ejecuciones`}
        </span>
      </div>

      {rangoIncompleto && <div className="notice notice-info">Elegí las dos fechas del rango para consultar.</div>}
      {rangoExcedido && <div className="notice notice-info">El rango es de {dias} días y el tope son {MAX_DIAS}.</div>}

      <div className="tablero">
        <div className="grid-kpi">
          <Kpi etiqueta="Total ejecuciones" valor={totales.total} />
          <Kpi etiqueta="En ejecución" valor={totales.corriendo} color={totales.corriendo > 0 ? 'var(--cyan)' : undefined} />
          <Kpi etiqueta="Correctas" valor={totales.correctas} color="var(--green)" />
          <Kpi etiqueta="Falladas" valor={totales.falladas} color={totales.falladas > 0 ? 'var(--red)' : undefined} />
          <Kpi etiqueta="Tasa de éxito" valor={totales.tasa === null ? '—' : `${totales.tasa}%`} />
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
            <div className="card-label">Por tenant</div>
            {tenants.map((tenant) => {
              const suyo = porTenant[tenant.id]
              const cuentas = contarEjecuciones(suyo?.runs ?? [])
              return (
                <div className="lista-fila agente" key={tenant.id}>
                  <span className="lista-nombre" title={tenant.name}>
                    <div className="lista-titulo">{tenant.name}</div>
                    <div className="lista-detalle">
                      {suyo?.error
                        ? `No contestó: ${suyo.error}`
                        : `${cuentas.total} ejecuciones · ${cuentas.falladas} falladas`}
                    </div>
                  </span>
                  <span className="agente-estado" style={{ color: suyo?.error ? 'var(--red)' : undefined }}>
                    {suyo?.error ? '✕' : (cuentas.tasa === null ? '—' : `${cuentas.tasa}%`)}
                  </span>
                </div>
              )
            })}
          </div>

          <div className="card">
            <div className="card-label">Últimas falladas, de todos</div>
            {ultimasFalladas(todas).length === 0
              ? <p className="todo-bien">✓ Sin fallos en el período</p>
              : <ListaFalladas runs={ultimasFalladas(todas)} porTenant={porTenant} tenants={tenants} zona={zona} />}
          </div>
        </div>
      </div>
    </div>
  )
}

function Kpi({ etiqueta, valor, color }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{etiqueta}</div>
      <div className="kpi-valor" style={color ? { color } : undefined}>{valor}</div>
    </div>
  )
}

/** Las falladas de todos los tenants, diciendo de cuál es cada una. */
function ListaFalladas({ runs, porTenant, tenants, zona }) {
  const deQuien = (run) => {
    const encontrado = tenants.find((uno) => (porTenant[uno.id]?.runs ?? []).includes(run))
    return encontrado?.name ?? ''
  }

  return runs.map((run) => (
    <div className="lista-fila agente" key={`${run.JobName}|${run.JobRunCount}`}>
      <span className="lista-nombre">
        <div className="lista-titulo">{run.JobText || run.JobTemplateText || run.JobTemplateName}</div>
        <div className="lista-detalle">{deQuien(run)} · {formatSapTimestamp(run.JobPlannedStartDateTime, zona)}</div>
      </span>
    </div>
  ))
}
