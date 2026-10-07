// El «Resumen» de una conexión de IBP Tools.
//
// Portado TAL CUAL de `components/Resumen/Resumen.jsx` de v8: la misma cabecera, las mismas seis
// tarjetas con sus colores, los dos gráficos, las cuatro tarjetas de abajo, los textos de v8 y sus
// estilos en línea. Las cuentas están en `lib/ibp-summary.js`, con las reglas de v8 y sus pruebas.
//
// Lo que cambia, y por qué:
//
//   - Los datos los trae el SERVIDOR (`/api/ibp/job-runs`): en v8 el navegador llamaba a SAP a
//     través de un proxy con las credenciales en la mano. Aquí nunca las ve. El filtro de fechas que
//     se le pide a SAP va con catorce dígitos y no con los veintidós de v8, que SAP rechazaba siempre
//     (ver `core/ibp/job-runs.js`); el reintento sin filtro se conserva.
//   - «Ver logs técnicos» (el `TechLogs` de cada pantalla de v8) no está: la suite tiene un solo
//     panel de «Llamadas técnicas» que anota todas las llamadas.
//   - Una respuesta VIEJA ya no pisa a una nueva: en v8, si una consulta lenta de un rango anterior
//     llegaba después de la del rango nuevo, la pantalla enseñaba el rango equivocado.
//   - Con un campo de fecha vacío no se le pide nada a SAP: v8 mandaba un filtro «NaN…», SAP lo
//     rechazaba y la pantalla traía el tope entero sin filtro para acabar enseñando cero.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
} from 'recharts'

import { aMarcaSap, fetchJobRuns, fetchJobStatuses } from '../../lib/ibp-jobs.js'
import { colorDeEstado, filtrarPorPlanificada, fmtDuration, resumenDeConexion } from '../../lib/ibp-summary.js'
import {
  formatSapTsShort, toInputDate, inputDateToDate,
  getTzMode, setTzMode as saveTzMode, getTzLabel,
} from '../../lib/fechas-v8.js'
import { nombreConAmbiente } from '../../lib/nombre-de-conexion.js'
import { useIsMobile } from '../../lib/useIsMobile.js'
import { useVisibleInterval } from '../../lib/useVisibleInterval.js'
import BotonActualizar from '../ui/BotonActualizar.jsx'
import ProgressBar from './ProgressBar.jsx'

const DEFAULT_HOURS = 24
const REFRESH_MS = 5 * 60 * 1000

/** Un campo `datetime-local` como marca de SAP de catorce dígitos. «» si no se puede leer. */
const marcaDe = (value, mode) => aMarcaSap(inputDateToDate(value, mode))

export default function Resumen({ connection }) {
  const isMobile = useIsMobile()
  const [rows, setRows]           = useState([])
  const [statuses, setStatuses]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [lastRefresh, setLastRefresh] = useState(null)
  const [tzMode, setTzModeState]      = useState(() => getTzMode())

  const [fromDate, setFromDate] = useState(() => toInputDate(new Date(Date.now() - DEFAULT_HOURS * 3600 * 1000), getTzMode()))
  const [toDate,   setToDate]   = useState(() => toInputDate(new Date(Date.now() + DEFAULT_HOURS * 3600 * 1000), getTzMode()))

  // Cada consulta lleva su número; solo la última puede tocar la pantalla.
  const ultimaRef = useRef(0)

  function handleTzToggle(newMode) {
    const fromD = inputDateToDate(fromDate, tzMode)
    const toD   = inputDateToDate(toDate, tzMode)
    saveTzMode(newMode)
    setTzModeState(newMode)
    setFromDate(toInputDate(fromD, newMode))
    setToDate(toInputDate(toD, newMode))
  }

  useEffect(() => {
    let abandonado = false
    fetchJobStatuses(connection.id)
      .then(estados => { if (!abandonado) setStatuses(estados ?? []) })
      .catch(() => {})
    return () => { abandonado = true }
  }, [connection.id])

  const loadData = useCallback(async () => {
    const desde = inputDateToDate(fromDate, tzMode)
    const hasta = inputDateToDate(toDate, tzMode)
    if (!aMarcaSap(desde) || !aMarcaSap(hasta)) return

    const turno = ++ultimaRef.current
    setLoading(true); setError('')
    try {
      const r = await fetchJobRuns(connection.id, { desde, hasta })
      if (turno !== ultimaRef.current) return
      setRows(r.runs ?? [])
      setLastRefresh(new Date())
    } catch (e) {
      if (turno !== ultimaRef.current) return
      setError(e.message)
    } finally {
      if (turno === ultimaRef.current) setLoading(false)
    }
  }, [connection.id, fromDate, toDate, tzMode])

  // Carga inicial y al cambiar el rango (con una pausa, para no consultar a cada tecla); el
  // refresco periódico se detiene mientras la pestaña del navegador no se ve.
  useEffect(() => {
    const id = setTimeout(loadData, 400)
    return () => clearTimeout(id)
  }, [loadData])

  useVisibleInterval(loadData, REFRESH_MS)

  function statusLabel(code) {
    return statuses.find(s => s.JobStatus === code)?.JobStatusText || code
  }

  const filtered = filtrarPorPlanificada(rows, marcaDe(fromDate, tzMode), marcaDe(toDate, tzMode))
  const {
    total, running, scheduled, finished, failed, successRate,
    donutData, barData, topTemplates, topUsers, topDuration, recentFailed,
  } = resumenDeConexion(filtered, { tzMode, statusLabel })

  if (error) return (
    <div style={{ padding: isMobile ? 16 : 32 }}>
      <div style={{ background: 'color-mix(in srgb, var(--red) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--red) 35%, transparent)', borderRadius: 8, padding: '12px 16px', color: 'var(--red)', fontSize: 12 }}>✕ {error}</div>
    </div>
  )

  if (loading && rows.length === 0) return (
    <div style={{ padding: isMobile ? 16 : 32, color: 'var(--text2)', fontSize: 13, position: 'relative' }}>
      <ProgressBar loading />
      Cargando resumen de {nombreConAmbiente(connection)}…
    </div>
  )

  return (
    <div style={{ padding: isMobile ? 14 : 28, overflowY: 'auto', height: '100%', boxSizing: 'border-box', position: 'relative' }}>
      <ProgressBar loading={loading} />

      {/* Cabecera */}
      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'stretch' : 'center',
        justifyContent: 'space-between',
        marginBottom: 24, flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          {/* Sin título: repetiría el nombre de la pestaña (pedido el 2026-10-06). */}
          <div style={{ fontSize: 11, color: 'var(--text2)' }}>
            {total} jobs en el período
            {lastRefresh && !loading && (
              <span style={{ marginLeft: 8, opacity: .6 }}>· {lastRefresh.toLocaleTimeString()}</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <TzToggle mode={tzMode} onToggle={handleTzToggle} />
          <input type="datetime-local" value={fromDate} onChange={e => setFromDate(e.target.value)}
            style={{ ...inputStyle, ...(isMobile && { flexBasis: '100%', width: '100%' }) }} />
          {!isMobile && <span style={{ color: 'var(--text2)', fontSize: 11 }}>→</span>}
          <input type="datetime-local" value={toDate} onChange={e => setToDate(e.target.value)}
            style={{ ...inputStyle, ...(isMobile && { flexBasis: '100%', width: '100%' }) }} />
          <BotonActualizar
            etiqueta="Refresh"
            onClick={loadData}
            cargando={loading}
            mensaje="Consultando jobs en SAP…"
            style={{
              background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 6,
              color: 'var(--text2)', fontSize: 11, fontWeight: 600, padding: '6px 12px', cursor: 'pointer',
            }}
          />
          {!isMobile && (
            <span style={{
              fontSize: 10, color: 'var(--text3)', whiteSpace: 'nowrap',
              padding: '4px 8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6,
            }}>Auto-refresh cada 5 min</span>
          )}
        </div>
      </div>

      {/* Tarjetas de cifras */}
      <div className="v8-grid-kpi">
        <KpiCard label="Total jobs"    value={total}        color="var(--text)" />
        <KpiCard label="En ejecución"  value={running}      color="var(--cyan)" />
        <KpiCard label="Programados"   value={scheduled}    color="var(--purple)" />
        <KpiCard label="Finalizados"   value={finished}     color="var(--green)" />
        <KpiCard label="Fallidos"      value={failed}       color="var(--red)" />
        <KpiCard label="Tasa de éxito" value={`${successRate}%`} color={successRate >= 90 ? 'var(--green)' : successRate >= 70 ? 'var(--accent)' : 'var(--red)'} />
      </div>

      {/* Gráficos */}
      <div className="v8-grid-charts">
        <div style={cardStyle}>
          <div style={cardTitle}>Distribución por estado</div>
          {donutData.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={donutData} cx="50%" cy="50%" innerRadius={55} outerRadius={85}
                  paddingAngle={2} dataKey="value">
                  {donutData.map((entry, i) => (
                    <Cell key={i} fill={colorDeEstado(entry.code)} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }}
                  formatter={(v, n) => [v, n]}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 8 }}>
            {donutData.map((d, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text2)' }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: colorDeEstado(d.code), flexShrink: 0 }} />
                {d.name} ({d.value})
              </div>
            ))}
          </div>
        </div>

        <div style={cardStyle}>
          <div style={cardTitle}>Jobs por día</div>
          {barData.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={barData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--text2)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text2)' }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text2)' }} />
                <Bar dataKey="finished" name="Finalizados" stackId="a" fill="var(--green)" radius={[0,0,0,0]} />
                <Bar dataKey="failed"   name="Fallidos"    stackId="a" fill="var(--red)"   radius={[0,0,0,0]} />
                <Bar dataKey="others"   name="Otros"       stackId="a" fill="var(--text3)" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Tarjetas de abajo */}
      <div className="v8-grid-stats">
        <div style={cardStyle}>
          <div style={cardTitle}>Top jobs ejecutados</div>
          {topTemplates.length === 0 ? <Empty /> : topTemplates.map(([name, count], i) => (
            <RankRow key={i} rank={i+1} label={name} count={count} max={topTemplates[0][1]} color="var(--cyan)" />
          ))}
        </div>

        <div style={cardStyle}>
          <div style={cardTitle}>Usuarios más activos</div>
          {topUsers.length === 0 ? <Empty /> : topUsers.map(([name, count], i) => (
            <RankRow key={i} rank={i+1} label={name} count={count} max={topUsers[0][1]} color="var(--purple)" />
          ))}
        </div>

        <div style={cardStyle}>
          <div style={cardTitle}>Top jobs más lentos (prom.)</div>
          {topDuration.length === 0
            ? <Empty />
            : topDuration.map((d, i) => (
              <RankRow
                key={i} rank={i+1} label={d.name}
                count={fmtDuration(d.avg)} max={topDuration[0].avg}
                rawValue={d.avg} color="var(--accent)"
              />
            ))
          }
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 10 }}>
            Solo jobs Finalizados con inicio y fin registrados
          </div>
        </div>

        <div style={cardStyle}>
          <div style={cardTitle}>Últimos jobs fallidos</div>
          {recentFailed.length === 0
            ? <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 8 }}>✓ Sin fallos en el período</div>
            : recentFailed.map((r, i) => (
              <div key={i} style={{ padding: '7px 0', borderBottom: i < recentFailed.length-1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--red)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.JobText || '—'}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 2, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{r.JobCreatedByFormattedName || r.JobCreatedBy}</span>
                  <span>{formatSapTsShort(r.JobPlannedStartDateTime, tzMode)}</span>
                </div>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  )
}

function KpiCard({ label, value, color }) {
  return (
    <div style={{
      background: 'var(--bg2)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '14px 16px',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text2)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

function RankRow({ rank, label, count, max, color, suffix = '', rawValue }) {
  const numeric = rawValue !== undefined ? rawValue : count
  const pct = max > 0 ? (numeric / max) * 100 : 0
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <div style={{ fontSize: 11, color: 'var(--text)', display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
          <span style={{ color: 'var(--text3)', fontWeight: 700, flexShrink: 0 }}>#{rank}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color, flexShrink: 0, marginLeft: 8 }}>{count}{suffix}</span>
      </div>
      <div style={{ height: 3, background: 'var(--border)', borderRadius: 2 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width .4s' }} />
      </div>
    </div>
  )
}

function Empty() {
  return <div style={{ fontSize: 12, color: 'var(--text3)', padding: '16px 0' }}>Sin datos en el período</div>
}

const cardStyle = {
  background: 'var(--bg2)', border: '1px solid var(--border)',
  borderRadius: 10, padding: '16px 18px',
}

const cardTitle = {
  fontSize: 11, fontWeight: 700, color: 'var(--text2)',
  textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12,
}

function TzToggle({ mode, onToggle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: 2 }}>
      <button
        onClick={() => onToggle('utc')}
        title="Mostrar horas en UTC (zona horaria de SAP IBP)"
        style={{
          padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: 'pointer', border: 'none',
          background: mode === 'utc' ? 'var(--border2)' : 'transparent',
          color: mode === 'utc' ? 'var(--text)' : 'var(--text3)',
        }}
      >UTC</button>
      <button
        onClick={() => onToggle('local')}
        title={`Convertir a hora local del navegador (${getTzLabel()})`}
        style={{
          padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: 'pointer', border: 'none',
          background: mode === 'local' ? 'var(--border2)' : 'transparent',
          color: mode === 'local' ? 'var(--text)' : 'var(--text3)',
        }}
      >{getTzLabel()}</button>
    </div>
  )
}

const inputStyle = {
  background: 'var(--bg2)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--text)', fontSize: 11,
  padding: '6px 10px', outline: 'none',
}
