// El «📊 Resumen» global de IBP Tools: todas las conexiones de IBP a la vez.
//
// Portado TAL CUAL de `components/Resumen/GlobalResumen.jsx` de v8: la cabecera con el conmutador de
// zona y el rango, las seis tarjetas, la torta con los nombres fijos de v8, las barras por conexión,
// la tabla «Estado por conexión», los últimos fallidos de todas y la salud de cada conexión. Las
// cuentas, con las reglas de v8 —que no son las del resumen de una conexión—, están en
// `lib/ibp-summary.js`.
//
// Lo que cambia, y por qué:
//
//   - Los datos los trae el SERVIDOR, una consulta por conexión (`/api/ibp/job-runs`); el navegador
//     no ve credenciales. Por eso tampoco existe el estado «🔒 Iniciar sesión» de v8: no hay que
//     identificarse contra cada tenant desde el navegador.
//   - «⚙ Sin acuerdo» ya no lleva a ningún sitio al pulsarlo: en v8 abría la pantalla de
//     conexiones, que aquí vive en Administración y no dentro de IBP Tools. La marca y su texto de
//     ayuda se conservan.
//   - «Ver logs técnicos» no está: la suite tiene un solo panel de «Llamadas técnicas».
//   - Una respuesta VIEJA ya no pisa a una nueva, y con un campo de fecha vacío no se consulta.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
} from 'recharts'

import { aMarcaSap, fetchJobRuns } from '../../lib/ibp-jobs.js'
import { colorDeEstado, resumenGlobal, tieneAcuerdoDeJobs } from '../../lib/ibp-summary.js'
import {
  formatSapTsShort, toInputDate, inputDateToDate,
  getTzMode, setTzMode as saveTzMode, getTzLabel,
} from '../../lib/fechas-v8.js'
import { nombreConAmbiente } from '../../lib/nombre-de-conexion.js'
import { useIsMobile } from '../../lib/useIsMobile.js'
import { useVisibleInterval } from '../../lib/useVisibleInterval.js'
import ProgressBar from './ProgressBar.jsx'
import TruncText from './TruncText.jsx'

const REFRESH_MS = 5 * 60 * 1000
const DEFAULT_HOURS = 24

const CONN_COLORS = ['#3b82f6', '#34d399', '#f97316', '#8b5cf6', '#06b6d4', '#ff6b6b', '#fbbf24', '#a78bfa']

/** Un campo `datetime-local` como marca de SAP de catorce dígitos. «» si no se puede leer. */
const marcaDe = (value, mode) => aMarcaSap(inputDateToDate(value, mode))

export default function GlobalSummary({ connections }) {
  const isMobile = useIsMobile()
  const [connData, setConnData] = useState({})
  const [lastRefresh, setLastRefresh] = useState(null)
  const [tzMode, setTzModeState]      = useState(() => getTzMode())

  const [fromDate, setFromDate] = useState(() => toInputDate(new Date(Date.now() - DEFAULT_HOURS * 3600 * 1000), getTzMode()))
  const [toDate,   setToDate]   = useState(() => toInputDate(new Date(Date.now() + DEFAULT_HOURS * 3600 * 1000), getTzMode()))

  // Cada vuelta de consultas lleva su número; solo la última puede tocar la pantalla.
  const ultimaRef = useRef(0)

  function handleTzToggle(newMode) {
    const fromD = inputDateToDate(fromDate, tzMode)
    const toD   = inputDateToDate(toDate, tzMode)
    saveTzMode(newMode)
    setTzModeState(newMode)
    setFromDate(toInputDate(fromD, newMode))
    setToDate(toInputDate(toD, newMode))
  }

  const loadAll = useCallback(async () => {
    const desde = inputDateToDate(fromDate, tzMode)
    const hasta = inputDateToDate(toDate, tzMode)
    if (!aMarcaSap(desde) || !aMarcaSap(hasta)) return

    const turno = ++ultimaRef.current
    const results = {}
    await Promise.all(connections.map(async (conn) => {
      // Sin SAP_COM_0326 (Application Jobs) la consulta solo podría fallar: no se hace, y la
      // conexión sale como «Sin acuerdo» en vez de como un «Error» genérico.
      if (!tieneAcuerdoDeJobs(conn)) {
        results[conn.id] = { rows: [], error: '', loading: false, noAgreement: true }
        return
      }
      try {
        const r = await fetchJobRuns(conn.id, { desde, hasta })
        results[conn.id] = { rows: r.runs ?? [], error: '', loading: false }
      } catch (e) {
        results[conn.id] = { rows: [], error: e.message, loading: false }
      }
    }))
    if (turno !== ultimaRef.current) return
    setConnData(results)
    setLastRefresh(new Date())
  }, [connections, fromDate, toDate, tzMode])

  // Carga inicial y al cambiar el rango (con una pausa); el refresco periódico se detiene mientras
  // la pestaña del navegador no se ve, y no existe sin conexiones.
  useEffect(() => {
    if (connections.length === 0) return undefined
    const id = setTimeout(loadAll, 400)
    return () => clearTimeout(id)
  }, [loadAll, connections.length])

  useVisibleInterval(loadAll, connections.length ? REFRESH_MS : null)

  const {
    connSummaries, gTotal, gFinished, gFailed, gRunning, gScheduled, gSuccessRate,
    donutData, connBarData, recentFailures,
  } = resumenGlobal(connections, connData, { desde: marcaDe(fromDate, tzMode), hasta: marcaDe(toDate, tzMode) })

  const globalLoading = connections.some(c => connData[c.id]?.loading)
  const anyLoading = connections.length > 0 && Object.keys(connData).length === 0

  if (connections.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>No hay conexiones configuradas</div>
        <div style={{ fontSize: 12, color: 'var(--text2)' }}>Agrega conexiones SAP IBP para ver el resumen global</div>
      </div>
    )
  }

  const connCount = connections.length === 1
    ? `${connections.length} conexión · ${gTotal} jobs`
    : `${connections.length} conexiones · ${gTotal} jobs`

  return (
    <div style={{ padding: isMobile ? 14 : 28, overflowY: 'auto', height: '100%', boxSizing: 'border-box', position: 'relative' }}>
      <ProgressBar loading={anyLoading || globalLoading} />

      {/* Cabecera */}
      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'stretch' : 'center',
        justifyContent: 'space-between',
        marginBottom: 24, flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Resumen Global</div>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
            {connCount}
            {lastRefresh && (
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
          <button onClick={loadAll} disabled={anyLoading} style={{
            background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 6,
            color: 'var(--text2)', fontSize: 11, fontWeight: 600, padding: '6px 12px', cursor: 'pointer',
          }}>↺ Refresh</button>
          {!isMobile && (
            <span style={{
              fontSize: 10, color: 'var(--text3)', whiteSpace: 'nowrap',
              padding: '4px 8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6,
            }}>Auto-refresh cada 5 min</span>
          )}
        </div>
      </div>

      {/* Cifras globales */}
      <div className="v8-grid-kpi">
        <KpiCard label="Total jobs"    value={gTotal}     color="var(--text)" />
        <KpiCard label="En ejecución"  value={gRunning}   color="var(--cyan)" />
        <KpiCard label="Programados"   value={gScheduled} color="var(--purple)" />
        <KpiCard label="Finalizados"   value={gFinished}  color="var(--green)" />
        <KpiCard label="Fallidos"      value={gFailed}    color="var(--red)" />
        <KpiCard label="Tasa de éxito" value={`${gSuccessRate}%`} color={gSuccessRate >= 90 ? 'var(--green)' : gSuccessRate >= 70 ? 'var(--accent)' : 'var(--red)'} />
      </div>

      {/* Gráficos */}
      <div className="v8-grid-charts">
        <div style={cardStyle}>
          <div style={cardTitle}>Distribución global por estado</div>
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
          <div style={cardTitle}>Jobs por conexión</div>
          {connBarData.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={connBarData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--text2)' }} interval={0} angle={-15} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text2)' }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text2)' }} />
                <Bar dataKey="finished" name="Finalizados" stackId="a" fill="var(--green)" />
                <Bar dataKey="failed"   name="Fallidos"    stackId="a" fill="var(--red)" />
                <Bar dataKey="others"   name="Otros"       stackId="a" fill="var(--text3)" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Tabla de estado por conexión */}
      <div style={{ ...cardStyle, marginTop: 16 }}>
        <div style={cardTitle}>Estado por conexión</div>
        <div style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg3)' }}>
                <th style={thStyle}>#</th>
                <th style={{ ...thStyle, textAlign: 'left', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>Conexión</th>
                <th style={thStyle}>Estado</th>
                <th style={thStyle}>Total</th>
                <th style={thStyle}>Ejecutando</th>
                <th style={thStyle}>Programados</th>
                <th style={thStyle}>Finalizados</th>
                <th style={thStyle}>Fallidos</th>
                <th style={thStyle}>Tasa éxito</th>
              </tr>
            </thead>
            <tbody>
              {connSummaries.map((cs, i) => (
                <tr key={cs.conn.id} style={{ background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg2)' }}>
                  <td style={tdStyle}>
                    <span style={{
                      width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: 'var(--surface-glass)', border: '1px solid var(--border)',
                      fontSize: 10, fontWeight: 700, color: 'var(--text2)',
                    }}>{cs.idx + 1}</span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 600, color: 'var(--text)', maxWidth: 160 }}>
                    <TruncText text={nombreConAmbiente(cs.conn)} style={{ fontWeight: 600, color: 'var(--text)' }} />
                  </td>
                  <td style={tdStyle}>
                    {cs.noAgreement ? (
                      // En v8 era un botón que abría la pantalla de conexiones; aquí esa pantalla está
                      // en Administración, fuera de IBP Tools, así que queda la marca con su ayuda.
                      <span title="Esta conexión no tiene configurado el acuerdo de comunicación SAP_COM_0326 (Application Jobs). Se agrega en Administración → Conexiones." style={{
                        ...statusBadge,
                        background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)',
                        border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
                      }}>⚙ Sin acuerdo</span>
                    ) : cs.loading ? (
                      <span style={{ color: 'var(--text3)' }}>Cargando…</span>
                    ) : cs.error ? (
                      <span style={{ ...statusBadge, background: 'color-mix(in srgb, var(--red) 15%, transparent)', color: 'var(--red)', border: '1px solid color-mix(in srgb, var(--red) 35%, transparent)' }}>Error</span>
                    ) : cs.failed > 0 ? (
                      <span style={{ ...statusBadge, background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)' }}>Atención</span>
                    ) : (
                      <span style={{ ...statusBadge, background: 'color-mix(in srgb, var(--green) 15%, transparent)', color: 'var(--green)', border: '1px solid color-mix(in srgb, var(--green) 35%, transparent)' }}>Saludable</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{cs.total}</td>
                  <td style={{ ...tdStyle, color: cs.running > 0 ? 'var(--cyan)' : 'var(--text3)' }}>{cs.running}</td>
                  <td style={{ ...tdStyle, color: cs.scheduled > 0 ? 'var(--purple)' : 'var(--text3)' }}>{cs.scheduled}</td>
                  <td style={{ ...tdStyle, color: cs.finished > 0 ? 'var(--green)' : 'var(--text3)' }}>{cs.finished}</td>
                  <td style={{ ...tdStyle, color: cs.failed > 0 ? 'var(--red)' : 'var(--text3)', fontWeight: cs.failed > 0 ? 700 : 400 }}>{cs.failed}</td>
                  <td style={tdStyle}>
                    <span style={{
                      fontWeight: 700,
                      color: cs.successRate >= 90 ? 'var(--green)' : cs.successRate >= 70 ? 'var(--accent)' : cs.total === 0 ? 'var(--text3)' : 'var(--red)',
                    }}>{cs.total > 0 ? `${cs.successRate}%` : '—'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Últimos fallidos de todas las conexiones */}
      <div className="v8-grid-stats" style={{ marginTop: 16 }}>
        <div style={cardStyle}>
          <div style={cardTitle}>Últimos jobs fallidos (todas las conexiones)</div>
          {recentFailures.length === 0
            ? <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 8 }}>✓ Sin fallos en el período</div>
            : recentFailures.map((r, i) => (
              <div key={i} style={{ padding: '7px 0', borderBottom: i < recentFailures.length-1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--red)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                    {r.JobText || '—'}
                  </div>
                  <span style={{
                    fontSize: 9, padding: '1px 6px', borderRadius: 3, flexShrink: 0,
                    background: 'rgba(59,130,246,.1)', color: '#3b82f6', fontWeight: 600,
                  }}>{r._connName}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 2, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{r.JobCreatedByFormattedName || r.JobCreatedBy}</span>
                  <span>{formatSapTsShort(r.JobPlannedStartDateTime, tzMode)}</span>
                </div>
              </div>
            ))
          }
        </div>

        {/* Salud de cada conexión */}
        <div style={cardStyle}>
          <div style={cardTitle}>Salud de conexiones</div>
          {connSummaries.map((cs, i) => {
            const color = cs.noAgreement ? 'var(--text3)' : cs.error ? 'var(--red)' : cs.failed > 0 ? '#fbbf24' : 'var(--green)'
            const pct = gTotal > 0 ? (cs.total / gTotal) * 100 : 0
            return (
              <div key={cs.conn.id} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <div style={{ fontSize: 11, color: 'var(--text)', display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0,
                    }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombreConAmbiente(cs.conn)}</span>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color, flexShrink: 0, marginLeft: 8 }}>
                    {cs.noAgreement ? 'Sin acuerdo' : cs.error ? 'Error' : `${cs.successRate}%`}
                  </span>
                </div>
                <div style={{ height: 3, background: 'var(--border)', borderRadius: 2 }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: CONN_COLORS[i % CONN_COLORS.length], borderRadius: 2, transition: 'width .4s' }} />
                </div>
              </div>
            )
          })}
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

const inputStyle = {
  background: 'var(--bg2)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--text)', fontSize: 11,
  padding: '6px 10px', outline: 'none',
}

const thStyle = {
  padding: '8px 12px', textAlign: 'center', color: 'var(--text2)',
  fontWeight: 600, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', fontSize: 11,
}

const tdStyle = {
  padding: '8px 12px', borderBottom: '1px solid var(--border)',
  textAlign: 'center', whiteSpace: 'nowrap', color: 'var(--text)',
}

const statusBadge = {
  display: 'inline-block', padding: '2px 8px', borderRadius: 20,
  fontSize: 10, fontWeight: 700,
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
          color: mode === 'utc' ? '#fff' : 'var(--text3)',
        }}
      >UTC</button>
      <button
        onClick={() => onToggle('local')}
        title={`Convertir a hora local del navegador (${getTzLabel()})`}
        style={{
          padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: 'pointer', border: 'none',
          background: mode === 'local' ? 'var(--border2)' : 'transparent',
          color: mode === 'local' ? '#fff' : 'var(--text3)',
        }}
      >{getTzLabel()}</button>
    </div>
  )
}
