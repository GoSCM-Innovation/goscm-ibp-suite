// «Job Monitor»: qué corrió en el rango, cómo acabó, y qué hacer con ello.
//
// Portado TAL CUAL de `Jobs/JobMonitor.jsx` de v8: la cabecera con el recuento y la hora del último
// refresco, el conmutador UTC / hora del navegador, el rango con dos campos de fecha y hora, el
// buscador, «↺ Refresh» y el aviso del refresco automático; debajo, un filtro por CADA estado que
// declara SAP —en su orden y aunque tenga cero—, la tabla, y al elegir una fila la barra de acciones
// con «Ver pasos», cancelar y reiniciar. Cancelar pregunta con el diálogo del navegador, como v8;
// reiniciar abre el diálogo de modos de v8.
//
// Lo que cambia es solo por dónde pasan las llamadas: v8 le pedía a SAP desde el navegador a través
// de su proxy, y aquí todo va por `/api/ibp/job-runs`, porque las credenciales no salen del
// servidor. La consulta a SAP es la misma: las trece columnas, el tope de 2.000 y el filtro de fecha
// —con catorce dígitos, que es lo que el campo admite; ver `core/ibp/job-runs.js`— y su reintento
// sin filtro. Tampoco está el «Ver logs técnicos» de la pantalla: las llamadas se ven en el panel
// global «Llamadas técnicas».

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  CANCELABLE_JOB_STATUSES,
  FAILED_JOB_STATUSES,
  FINISHED_JOB_STATUSES,
  JOB_STATUS,
  JOB_STATUS_FALLBACK,
  RESTARTABLE_JOB_STATUSES,
} from '../../../core/ibp/job-status.js'
import {
  formatSapTs, getTzLabel, getTzMode, inputDateToDate, setTzMode as saveTzMode, toInputDate,
} from '../../lib/fechas-v8.js'
import { cancelRun, fetchJobRuns, fetchJobStatuses, restartRun } from '../../lib/ibp-jobs.js'
import { useIsMobile } from '../../lib/useIsMobile.js'
import { useVisibleInterval } from '../../lib/useVisibleInterval.js'
import JobStepsPanel from './JobStepsPanel.jsx'
import ProgressBar from './ProgressBar.jsx'
import TruncText from './TruncText.jsx'

const REFRESH_MS = 60000
const DEFAULT_HOURS = 24

// Los colores de v8: tinte al 15 % (`26`) y borde al 30 % (`4d`) del color del estado. Los colores
// son los de la tabla común de `core/ibp/job-status.js`, que son los del monitor de v8.
const mk = (hex) => ({ color: hex, bg: `${hex}26`, border: `${hex}4d` })
const colorDeEstado = (code) => mk(JOB_STATUS[code]?.color ?? JOB_STATUS_FALLBACK.color)
const FALLBACK_COLOR = mk(JOB_STATUS_FALLBACK.color)

const MOBILE_COL_KEYS = ['JobStatus', 'JobText', 'JobPlannedStartDateTime']

/**
 * Una fecha como la escribe SAP en `JobPlannedStartDateTime`, para el filtro de rango EN PANTALLA.
 *
 * Es el `toSapTs` de `dateUtils.js` de v8, con su fracción de segundo: aquí solo se compara contra
 * lo que ya llegó, así que se conserva tal cual. El filtro que va a SAP lo arma el servidor, con
 * catorce dígitos (`aMarcaSap`).
 */
function toSapTs(date) {
  const p = n => String(n).padStart(2, '0')
  return (
    `${date.getUTCFullYear()}` +
    `${p(date.getUTCMonth() + 1)}` +
    `${p(date.getUTCDate())}` +
    `${p(date.getUTCHours())}` +
    `${p(date.getUTCMinutes())}` +
    `${p(date.getUTCSeconds())}` +
    '.0000000'
  )
}

const RESTART_MODES = [
  {
    value: 'E',
    label: 'Desde el paso fallido',
    desc: 'Reinicia desde el paso que falló. Los pasos anteriores se omitirán.',
  },
  {
    value: 'A',
    label: 'Después del paso fallido',
    desc: 'Reinicia omitiendo el paso fallido y todos los anteriores.',
  },
]

function StatusBadge({ code, statuses }) {
  const s = statuses.find(x => x.JobStatus === code)
  const c = s?.color ?? FALLBACK_COLOR
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 10,
      fontWeight: 700, background: c.bg, color: c.color, border: `1px solid ${c.border}`,
      whiteSpace: 'nowrap',
    }}>
      {s?.JobStatusText || code || '—'}
    </span>
  )
}

export default function JobMonitor({ connection }) {
  const isMobile = useIsMobile()
  const connectionId = connection.id
  const [statuses, setStatuses] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeStatus, setActiveStatus] = useState('ALL')
  const [search, setSearch] = useState('')
  const [lastRefresh, setLastRefresh] = useState(null)
  const [colWidths, setColWidths] = useState({})
  const [selectedRow, setSelectedRow] = useState(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelMsg, setCancelMsg] = useState('')
  const [restarting, setRestarting] = useState(false)
  const [restartMsg, setRestartMsg] = useState('')
  const [restartModal, setRestartModal] = useState(false)
  const [stepsJob, setStepsJob] = useState(null)
  const [tzMode, setTzModeState] = useState(() => getTzMode())
  const resizing = useRef(null)

  const [fromDate, setFromDate] = useState(() => toInputDate(new Date(Date.now() - DEFAULT_HOURS * 3600 * 1000), getTzMode()))
  const [toDate, setToDate] = useState(() => toInputDate(new Date(Date.now() + DEFAULT_HOURS * 3600 * 1000), getTzMode()))

  function handleTzToggle(newMode) {
    const fromD = inputDateToDate(fromDate, tzMode)
    const toD = inputDateToDate(toDate, tzMode)
    saveTzMode(newMode)
    setTzModeState(newMode)
    setFromDate(toInputDate(fromD, newMode))
    setToDate(toInputDate(toD, newMode))
  }

  // Los estados, una vez: sus nombres y su orden los da SAP.
  useEffect(() => {
    let abandonado = false
    fetchJobStatuses(connectionId)
      .then((results) => {
        if (abandonado) return
        setStatuses((results ?? []).map(s => ({ ...s, color: colorDeEstado(s.JobStatus) })))
      })
      .catch(() => {})
    return () => { abandonado = true }
  }, [connectionId])

  // Las ejecuciones del rango visible: SAP filtra por fecha y devuelve solo las columnas que se usan.
  const loadJobs = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await fetchJobRuns(connectionId, {
        desde: inputDateToDate(fromDate, tzMode),
        hasta: inputDateToDate(toDate, tzMode),
      })
      setRows(r?.runs ?? [])
      setLastRefresh(new Date())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [connectionId, fromDate, toDate, tzMode])

  // Primera carga, y de nuevo al cambiar el rango. Con espera, para que escribir en los campos de
  // fecha no dispare una ráfaga de consultas.
  useEffect(() => {
    const id = setTimeout(loadJobs, 400)
    return () => clearTimeout(id)
  }, [loadJobs])

  // Refresco periódico, en pausa mientras la pestaña del navegador no se ve.
  useVisibleInterval(loadJobs, REFRESH_MS)

  // Cancelar
  async function handleCancel() {
    if (!selectedRow) return
    const label = selectedRow.JobText || selectedRow.JobName
    if (!window.confirm(`¿Cancelar el job "${label}"?\n\nEsta acción detendrá el job en SAP IBP.`)) return
    setCancelling(true); setCancelMsg('')
    try {
      await cancelRun(connectionId, { jobName: selectedRow.JobName, runCount: selectedRow.JobRunCount })
      setCancelMsg('ok')
      await loadJobs()
      setTimeout(() => {
        setSelectedRow(null)
        setCancelMsg('')
      }, 2500)
    } catch (e) {
      setCancelMsg(e.message)
    } finally {
      setCancelling(false)
    }
  }

  // Reiniciar
  async function handleRestart(mode) {
    if (!selectedRow) return
    setRestartModal(false)
    setRestarting(true); setRestartMsg('')
    try {
      await restartRun(connectionId, { jobName: selectedRow.JobName, runCount: selectedRow.JobRunCount, modo: mode })
      setRestartMsg('ok')
      await loadJobs()
      setTimeout(() => {
        setSelectedRow(null)
        setRestartMsg('')
      }, 2500)
    } catch (e) {
      setRestartMsg(e.message)
    } finally {
      setRestarting(false)
    }
  }

  // Filtros — siempre en UTC para coincidir con SAP
  const fromTs = toSapTs(inputDateToDate(fromDate, tzMode))
  const toTs = toSapTs(inputDateToDate(toDate, tzMode))

  const sorted = [...rows].sort((a, b) => {
    const av = a.JobPlannedStartDateTime || '', bv = b.JobPlannedStartDateTime || ''
    return bv.localeCompare(av)
  })

  const filteredBase = sorted.filter(r => {
    const ts = r.JobPlannedStartDateTime || ''
    if (ts && (ts < fromTs || ts > toTs)) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      return Object.values(r).some(v => String(v ?? '').toLowerCase().includes(q))
    }
    return true
  })

  const countByStatus = {}
  filteredBase.forEach(r => { countByStatus[r.JobStatus] = (countByStatus[r.JobStatus] || 0) + 1 })

  const filtered = filteredBase.filter(r =>
    activeStatus === 'ALL' || r.JobStatus === activeStatus,
  )

  const tzSuffix = tzMode === 'utc' ? ' (UTC)' : ` (${getTzLabel()})`
  const BASE_COLS = [
    { key: 'JobStatus', label: 'Estado', w: 130, render: (v) => <StatusBadge code={v} statuses={statuses} /> },
    { key: 'JobTemplateText', label: 'Template', w: 220, truncate: true },
    { key: 'JobText', label: 'Descripción', w: 220, truncate: true },
    { key: 'JobCreatedByFormattedName', label: 'Usuario', w: 180, truncate: true },
    { key: 'JobStepCount', label: 'Pasos', w: 70 },
    { key: 'JobPlannedStartDateTime', label: `Inicio planificado${tzSuffix}`, w: 190, render: v => formatSapTs(v, tzMode) },
    { key: 'JobStartDateTime', label: `Inicio real${tzSuffix}`, w: 175, render: v => formatSapTs(v, tzMode) },
    { key: 'JobEndDateTime', label: `Fin${tzSuffix}`, w: 175, render: v => formatSapTs(v, tzMode) },
    { key: 'Periodic', label: 'Periódico', w: 90, render: v => v ? '✓' : '—' },
  ]

  const ALL_COLS = BASE_COLS.map(c => ({ ...c, w: colWidths[c.key] ?? c.w }))
  const COLS = isMobile ? ALL_COLS.filter(c => MOBILE_COL_KEYS.includes(c.key)) : ALL_COLS

  function onResizeStart(col, e) {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX, startW = colWidths[col] ?? BASE_COLS.find(c => c.key === col)?.w ?? 140
    resizing.current = { col, startX, startW }
    function onMove(ev) {
      if (!resizing.current) return
      const { col: c, startX: x0, startW: w0 } = resizing.current
      setColWidths(w => ({ ...w, [c]: Math.max(60, w0 + ev.clientX - x0) }))
    }
    function onUp() {
      resizing.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const isCancelable = selectedRow && CANCELABLE_JOB_STATUSES.includes(selectedRow.JobStatus)
  const isRestartable = selectedRow && RESTARTABLE_JOB_STATUSES.includes(selectedRow.JobStatus)

  function deselect() {
    setSelectedRow(null); setCancelMsg(''); setRestartMsg('')
  }

  return (
    <div style={{ padding: isMobile ? 14 : 28, display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box', position: 'relative' }}>
      <ProgressBar loading={loading || cancelling || restarting} />

      {/* Cabecera */}
      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'stretch' : 'center',
        justifyContent: 'space-between',
        marginBottom: 16, flexShrink: 0, gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          {/* Sin título: repetiría el nombre de la pestaña (pedido el 2026-10-06). */}
          <div style={{ fontSize: 11, color: 'var(--text2)' }}>
            {loading ? 'Cargando…' : `${filtered.length} de ${rows.length} registros`}
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
          <input type="text" placeholder="Buscar…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, width: isMobile ? '100%' : 180, ...(isMobile && { flexBasis: '100%' }) }} />
          <button type="button" onClick={loadJobs} disabled={loading} style={{
            background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 6,
            color: 'var(--text2)', fontSize: 11, fontWeight: 600, padding: '6px 12px', cursor: 'pointer',
          }}>↺ Refresh</button>
          {!isMobile && (
            <span style={{
              fontSize: 10, color: 'var(--text3)', whiteSpace: 'nowrap',
              padding: '4px 8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6,
            }}>Auto-refresh cada {REFRESH_MS / 1000}s</span>
          )}
        </div>
      </div>

      {/* Filtro por estado */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexShrink: 0, flexWrap: 'wrap' }}>
        <FilterBtn active={activeStatus === 'ALL'} onClick={() => setActiveStatus('ALL')}
          label="Todos" count={filteredBase.length} color={mk('#3b82f6')} />
        {statuses.map(s => (
          <FilterBtn key={s.JobStatus} active={activeStatus === s.JobStatus}
            onClick={() => setActiveStatus(s.JobStatus)}
            label={s.JobStatusText || s.JobStatus}
            count={countByStatus[s.JobStatus] || 0}
            color={s.color} />
        ))}
      </div>

      {/* Error */}
      {error && (
        <div style={{
          background: 'color-mix(in srgb, var(--red) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--red) 35%, transparent)',
          borderRadius: 8, padding: '12px 16px', color: 'var(--red)', fontSize: 12, marginBottom: 14,
        }}>✕ {error}</div>
      )}

      {/* Tabla */}
      {!error && (
        <div style={{
          overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, flex: 1,
          ...(isMobile && selectedRow && { paddingBottom: 120 }),
        }}>
          <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: '100%', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg2)', position: 'sticky', top: 0, zIndex: 1 }}>
                {COLS.map(col => (
                  <th key={col.key} style={{
                    width: col.w, minWidth: col.w, padding: '9px 12px', textAlign: 'left',
                    color: 'var(--text2)', fontWeight: 600, whiteSpace: 'nowrap',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                    borderBottom: '1px solid var(--border)', position: 'relative', userSelect: 'none',
                  }} title={col.label}>
                    {col.label}
                    <span
                      style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, cursor: 'col-resize', background: 'transparent' }}
                      onClick={e => e.stopPropagation()}
                      onMouseDown={e => onResizeStart(col.key, e)}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr><td colSpan={COLS.length} style={{ padding: '32px 12px', textAlign: 'center', color: 'var(--text2)' }}>
                  Cargando jobs…
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={COLS.length} style={{ padding: '32px 12px', textAlign: 'center', color: 'var(--text2)' }}>
                  Sin resultados para el período y filtros seleccionados
                </td></tr>
              ) : filtered.map((row, i) => {
                const isSelected = selectedRow?.JobName === row.JobName && selectedRow?.JobRunCount === row.JobRunCount
                return (
                  <tr
                    key={i}
                    onClick={() => setSelectedRow(isSelected ? null : row)}
                    style={{
                      background: isSelected ? 'var(--accent-bg-soft)' : i % 2 === 0 ? 'var(--bg)' : 'var(--bg2)',
                      outline: isSelected ? '1px solid var(--accent-border-soft)' : 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {COLS.map(col => (
                      <td key={col.key} style={{
                        padding: '7px 12px', color: isSelected ? '#fff' : 'var(--text)',
                        borderBottom: '1px solid var(--border)',
                        whiteSpace: 'nowrap', overflow: 'hidden',
                        width: col.w, maxWidth: col.w,
                      }}>
                        {col.truncate
                          ? <TruncText text={String(row[col.key] ?? '')} />
                          : col.render ? col.render(row[col.key], row) : String(row[col.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Barra de acciones: aparece al elegir una fila */}
      {selectedRow && (
        <div style={isMobile ? {
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
          padding: '12px 14px',
          background: 'var(--bg2)', borderTop: '1px solid var(--border2)',
          borderRadius: '12px 12px 0 0',
          boxShadow: 'var(--shadow)',
        } : {
          marginTop: 12, padding: '12px 16px', flexShrink: 0,
          background: 'var(--bg2)', border: '1px solid var(--border2)',
          borderRadius: 8, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        }}>

          {isMobile ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 10, color: 'var(--text2)', marginBottom: 1 }}>Job seleccionado</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {selectedRow.JobText || selectedRow.JobName}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={deselect}
                  style={{ flexShrink: 0, marginLeft: 10, background: 'none', border: 'none', color: 'var(--text3)', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '2px 6px' }}
                >✕</button>
              </div>
              {(cancelMsg === 'ok' || restartMsg === 'ok') && (
                <div style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600, marginBottom: 8 }}>
                  ✓ {cancelMsg === 'ok' ? 'Job cancelado' : 'Job reiniciado'}
                </div>
              )}
              {cancelMsg && cancelMsg !== 'ok' && <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 8 }}>✕ {cancelMsg}</div>}
              {restartMsg && restartMsg !== 'ok' && <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 8 }}>✕ {restartMsg}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setStepsJob(selectedRow)}
                  style={{ padding: '8px 4px', borderRadius: 6, fontSize: 11, fontWeight: 700, border: '1px solid color-mix(in srgb, var(--purple) 45%, transparent)', background: 'color-mix(in srgb, var(--purple) 15%, transparent)', color: 'var(--purple)', cursor: 'pointer' }}
                >▤ Ver pasos</button>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={!isCancelable || cancelling}
                  style={{ padding: '8px 4px', borderRadius: 6, fontSize: 11, fontWeight: 700, border: '1px solid color-mix(in srgb, var(--red) 45%, transparent)', background: isCancelable ? 'color-mix(in srgb, var(--red) 15%, transparent)' : 'transparent', color: isCancelable ? 'var(--red)' : 'var(--text3)', cursor: isCancelable ? 'pointer' : 'not-allowed', opacity: cancelling ? .6 : 1 }}
                >{cancelling ? '…' : '✕ Cancelar job'}</button>
                <button
                  type="button"
                  onClick={() => setRestartModal(true)}
                  disabled={!isRestartable || restarting}
                  style={{ padding: '8px 4px', borderRadius: 6, fontSize: 11, fontWeight: 700, border: '1px solid rgba(6,182,212,.4)', background: isRestartable ? 'rgba(6,182,212,.12)' : 'transparent', color: isRestartable ? 'var(--cyan)' : 'var(--text3)', cursor: isRestartable ? 'pointer' : 'not-allowed', opacity: restarting ? .6 : 1 }}
                >{restarting ? '…' : '↺ Reiniciar job'}</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 2 }}>Job seleccionado</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {selectedRow.JobText || selectedRow.JobName}
                  <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
                    {selectedRow.JobName} · {selectedRow.JobRunCount}
                  </span>
                </div>
              </div>
              {cancelMsg === 'ok' && <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>✓ Job cancelado</span>}
              {cancelMsg && cancelMsg !== 'ok' && <span style={{ fontSize: 11, color: 'var(--red)', maxWidth: 280 }}>✕ {cancelMsg}</span>}
              {restartMsg === 'ok' && <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>✓ Job reiniciado</span>}
              {restartMsg && restartMsg !== 'ok' && <span style={{ fontSize: 11, color: 'var(--red)', maxWidth: 280 }}>✕ {restartMsg}</span>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setStepsJob(selectedRow)} style={{ padding: '6px 16px', borderRadius: 6, fontSize: 11, fontWeight: 700, border: '1px solid color-mix(in srgb, var(--purple) 45%, transparent)', background: 'color-mix(in srgb, var(--purple) 15%, transparent)', color: 'var(--purple)', cursor: 'pointer' }}>
                  {selectedRow?.JobStepCount > 0 ? `▤ Ver pasos (${selectedRow.JobStepCount})` : '▤ Ver pasos'}
                </button>
                <button type="button" onClick={handleCancel} disabled={!isCancelable || cancelling} style={{ padding: '6px 16px', borderRadius: 6, fontSize: 11, fontWeight: 700, border: '1px solid color-mix(in srgb, var(--red) 45%, transparent)', background: isCancelable ? 'color-mix(in srgb, var(--red) 15%, transparent)' : 'transparent', color: isCancelable ? 'var(--red)' : 'var(--text3)', cursor: isCancelable ? 'pointer' : 'not-allowed', opacity: cancelling ? .6 : 1 }}>
                  {cancelling ? 'Cancelando…' : '✕ Cancelar job'}
                </button>
                <button type="button" onClick={() => setRestartModal(true)} disabled={!isRestartable || restarting} style={{ padding: '6px 16px', borderRadius: 6, fontSize: 11, fontWeight: 700, border: '1px solid rgba(6,182,212,.4)', background: isRestartable ? 'rgba(6,182,212,.12)' : 'transparent', color: isRestartable ? 'var(--cyan)' : 'var(--text3)', cursor: isRestartable ? 'pointer' : 'not-allowed', opacity: restarting ? .6 : 1 }}>
                  {restarting ? 'Reiniciando…' : '↺ Reiniciar job'}
                </button>
                <button type="button" onClick={deselect} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600, border: '1px solid var(--border)', background: 'none', color: 'var(--text2)', cursor: 'pointer' }}>
                  Deseleccionar
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {stepsJob && (
        <JobStepsPanel
          key={`${stepsJob.JobName}|${stepsJob.JobRunCount}`}
          job={stepsJob}
          connection={connection}
          statuses={statuses}
          tzMode={tzMode}
          onClose={() => setStepsJob(null)}
        />
      )}

      {/* Diálogo de reinicio */}
      {restartModal && selectedRow && (() => {
        const isError = FAILED_JOB_STATUSES.includes(selectedRow.JobStatus)
        const isFinished = FINISHED_JOB_STATUSES.includes(selectedRow.JobStatus)
        const jobLabel = selectedRow.JobText || selectedRow.JobName
        return (
          <div style={{
            position: 'fixed', inset: 0, background: 'var(--overlay)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500,
          }}>
            <div style={{
              background: 'var(--bg2)', border: '1px solid var(--border2)',
              borderRadius: 12, padding: 28, width: 'min(440px, 92vw)', boxShadow: 'var(--shadow-lg)',
            }}>

              {/* ── Job fallido o cancelado: elegir desde dónde ── */}
              {isError && (
                <>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
                    ↺ Reiniciar job con error
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 20 }}>
                    Selecciona desde qué punto reanudar {jobLabel}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                    {RESTART_MODES.map(m => (
                      <button
                        type="button"
                        key={m.value}
                        onClick={() => handleRestart(m.value)}
                        style={{
                          textAlign: 'left', padding: '12px 16px', borderRadius: 8,
                          border: '1px solid var(--border2)', background: 'var(--bg3)',
                          color: 'var(--text)', cursor: 'pointer', transition: 'all .15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--cyan)'; e.currentTarget.style.background = 'rgba(6,182,212,.08)' }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border2)'; e.currentTarget.style.background = 'var(--bg3)' }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--cyan)', marginBottom: 4 }}>
                          Modo {m.value} — {m.label}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.5 }}>{m.desc}</div>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* ── Job terminado: volver a ejecutarlo entero ── */}
              {isFinished && (
                <>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
                    ↺ Volver a ejecutar
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6 }}>
                    <strong style={{ color: 'var(--text)' }}>{jobLabel}</strong>
                  </div>
                  <div style={{
                    background: 'color-mix(in srgb, var(--green) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--green) 30%, transparent)',
                    borderRadius: 8, padding: '10px 14px', marginBottom: 20,
                  }}>
                    <div style={{ fontSize: 11, color: 'var(--green)', lineHeight: 1.6 }}>
                      {selectedRow.JobStatus === 'W'
                        ? 'Este job finalizó correctamente (con advertencias). No hay pasos fallidos — se ejecutará nuevamente desde el inicio.'
                        : 'Este job finalizó correctamente. No hay pasos fallidos — se ejecutará nuevamente desde el inicio.'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRestart('A')}
                    style={{
                      width: '100%', padding: '10px', borderRadius: 8, marginBottom: 10,
                      border: '1px solid rgba(6,182,212,.4)', background: 'rgba(6,182,212,.1)',
                      color: 'var(--cyan)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      transition: 'all .15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(6,182,212,.18)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(6,182,212,.1)' }}
                  >
                    ↺ Ejecutar nuevamente
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => setRestartModal(false)}
                style={{
                  width: '100%', padding: '8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                  border: '1px solid var(--border)', background: 'none', color: 'var(--text2)', cursor: 'pointer',
                }}
              >Cancelar</button>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function FilterBtn({ active, onClick, label, count, color }) {
  return (
    <button type="button" onClick={onClick} style={{
      padding: '4px 12px', borderRadius: 20, border: `1px solid ${active ? color.border : 'var(--border)'}`,
      background: active ? color.bg : 'transparent',
      color: active ? color.color : 'var(--text2)',
      fontSize: 11, fontWeight: active ? 700 : 400, cursor: 'pointer',
      display: 'flex', alignItems: 'center', gap: 6, transition: 'all .15s',
    }}>
      {label}
      <span style={{
        background: active ? color.border : 'var(--border)', color: active ? color.color : 'var(--text2)',
        borderRadius: 10, padding: '0 5px', fontSize: 10, fontWeight: 700,
      }}>{count}</span>
    </button>
  )
}

function TzToggle({ mode, onToggle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: 2 }}>
      <button
        type="button"
        onClick={() => onToggle('utc')}
        title="Mostrar horas en UTC (zona horaria de SAP IBP)"
        style={{
          padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: 'pointer', border: 'none',
          background: mode === 'utc' ? 'var(--border2)' : 'transparent',
          color: mode === 'utc' ? '#fff' : 'var(--text3)',
        }}
      >UTC</button>
      <button
        type="button"
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

const inputStyle = {
  background: 'var(--bg2)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--text)', fontSize: 11,
  padding: '6px 10px', outline: 'none',
}
