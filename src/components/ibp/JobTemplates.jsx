// «Job Templates»: las plantillas de Application Job del tenant, para lanzarlas.
//
// Portado TAL CUAL de `Jobs/Jobs.jsx` de v8: la misma cabecera con su recuento y su buscador, las
// mismas columnas —Nombre, Descripción, Acción—, ordenables y con ancho ajustable, el mismo botón
// «▶ Ejecutar» y la marca «✓ Enviado» cuando SAP aceptó el lanzamiento. Se listan TODAS las
// plantillas, las estándar de SAP incluidas, como en v8.
//
// Lo que cambia es solo por dónde pasa la llamada: v8 le pedía `/JobTemplateSet` a SAP desde el
// navegador a través de su proxy, con las credenciales en el cliente; aquí la hace el servidor
// (`/api/ibp/job-schedule`), porque las credenciales no salen de él. Tampoco está el «Ver logs
// técnicos» de la pantalla: las llamadas se ven en el panel global «Llamadas técnicas».

import { useEffect, useRef, useState } from 'react'

import { fetchJobTemplateSet } from '../../lib/ibp-jobs.js'
import { nombreConAmbiente } from '../../lib/nombre-de-conexion.js'
import { useIsMobile } from '../../lib/useIsMobile.js'
import ProgressBar from './ProgressBar.jsx'
import ScheduleModal from './ScheduleModal.jsx'
import TruncText from './TruncText.jsx'

const VISIBLE_COLS = ['JobTemplateName', 'JobTemplateText']
const MOBILE_COLS = ['JobTemplateName']
const DEFAULT_COL_WIDTHS = { JobTemplateName: 240, JobTemplateText: 480 }
const COL_LABELS = { JobTemplateName: 'Nombre', JobTemplateText: 'Descripción' }

const TD = { padding: '6px 12px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }

export default function JobTemplates({ connection }) {
  const isMobile = useIsMobile()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)
  const [colWidths, setColWidths] = useState({})
  const [search, setSearch] = useState('')
  const resizing = useRef(null)
  const [scheduleRow, setScheduleRow] = useState(null)
  const [scheduledRows, setScheduledRows] = useState({})

  const connectionId = connection.id

  // Cada conexión monta su propia vista (IBP Tools la monta con la conexión como clave), así que
  // el estado inicial ya es el de «cargando» y aquí solo se pide.
  useEffect(() => {
    let abandonado = false
    fetchJobTemplateSet(connectionId)
      .then((lista) => { if (!abandonado) setRows(lista ?? []) })
      .catch((e) => { if (!abandonado) setError(e.message) })
      .finally(() => { if (!abandonado) setLoading(false) })
    return () => { abandonado = true }
  }, [connectionId])

  const filtered = search.trim()
    ? rows.filter(row => Object.values(row).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase())))
    : rows

  const sorted = [...filtered].sort((a, b) => {
    if (!sortCol) return 0
    const av = String(a[sortCol] ?? ''), bv = String(b[sortCol] ?? '')
    return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
  })

  const activeCols = isMobile ? MOBILE_COLS : VISIBLE_COLS

  function handleSort(col) {
    if (sortCol === col) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(true) }
  }

  function onResizeStart(col, e) {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX, startW = colWidths[col] || DEFAULT_COL_WIDTHS[col] || 240
    resizing.current = { col, startX, startW }
    function onMove(ev) {
      if (!resizing.current) return
      const { col: c, startX: x0, startW: w0 } = resizing.current
      setColWidths(w => ({ ...w, [c]: Math.max(80, w0 + ev.clientX - x0) }))
    }
    function onUp() {
      resizing.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  if (loading) return (
    <div style={{ padding: isMobile ? 14 : 28, color: 'var(--text2)', fontSize: 13, position: 'relative' }}>
      <ProgressBar loading />
      Cargando job templates de {nombreConAmbiente(connection)}…
    </div>
  )

  if (error) return (
    <div style={{ padding: isMobile ? 14 : 28 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Job Templates</div>
      <div style={{
        background: 'color-mix(in srgb, var(--red) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--red) 35%, transparent)',
        borderRadius: 8, padding: '12px 16px', color: 'var(--red)', fontSize: 12,
      }}>✕ {error}</div>
    </div>
  )

  return (
    <div style={{ padding: isMobile ? 14 : 28, display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', boxSizing: 'border-box' }}>
      {/* Cabecera */}
      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'stretch' : 'center',
        justifyContent: 'space-between',
        marginBottom: 16, flexShrink: 0, gap: isMobile ? 8 : 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Job Templates</div>
          <div style={{ fontSize: 11, color: 'var(--text2)' }}>
            {search
              ? `${sorted.length} de ${rows.length} registros`
              : `${sorted.length} registros`}
          </div>
        </div>
        <input
          type="text"
          placeholder="Buscar en todas las columnas…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            background: 'var(--bg2)', border: '1px solid var(--border)',
            borderRadius: 6, color: 'var(--text)', fontSize: 12,
            padding: '6px 12px', width: isMobile ? '100%' : 240, outline: 'none',
          }}
        />
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text2)' }}>Sin resultados</div>
      ) : (
        <div style={{ overflowX: 'auto', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, flex: 1 }}>
          <table style={{
            borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 12,
            width: activeCols.reduce((s, c) => s + (colWidths[c] || DEFAULT_COL_WIDTHS[c] || 240), 110),
            minWidth: '100%',
          }}>
            <thead>
              <tr style={{ background: 'var(--bg2)', position: 'sticky', top: 0, zIndex: 1 }}>
                {activeCols.map(col => {
                  const w = colWidths[col] || DEFAULT_COL_WIDTHS[col] || 240
                  return (
                    <th
                      key={col}
                      style={{
                        width: w, minWidth: w, padding: '9px 12px', textAlign: 'left',
                        color: sortCol === col ? 'var(--accent)' : 'var(--text2)',
                        fontWeight: 600, whiteSpace: 'nowrap', position: 'relative',
                        borderBottom: '1px solid var(--border)', cursor: 'pointer',
                        userSelect: 'none', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}
                      title={COL_LABELS[col] ?? col}
                      onClick={() => handleSort(col)}
                    >
                      {COL_LABELS[col] ?? col}
                      {sortCol === col && <span style={{ marginLeft: 4, fontSize: 10 }}>{sortAsc ? '↑' : '↓'}</span>}
                      <span
                        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, cursor: 'col-resize', background: 'transparent' }}
                        onClick={e => e.stopPropagation()}
                        onMouseDown={e => onResizeStart(col, e)}
                      />
                    </th>
                  )
                })}
                <th style={{
                  width: 110, minWidth: 110, padding: '9px 12px', textAlign: 'left',
                  color: 'var(--text2)', fontWeight: 600,
                  borderBottom: '1px solid var(--border)', userSelect: 'none',
                }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={activeCols.length + 1} style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text2)', fontSize: 12 }}>
                    Sin resultados para &quot;{search}&quot;
                  </td>
                </tr>
              ) : sorted.map((row, i) => (
                <tr
                  key={i}
                  style={{ background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg2)' }}
                >
                  {activeCols.map(col => (
                    <td
                      key={col}
                      style={{
                        padding: '7px 12px', color: 'var(--text)',
                        borderBottom: '1px solid var(--border)',
                        maxWidth: colWidths[col] || DEFAULT_COL_WIDTHS[col] || 240,
                      }}
                    >
                      <TruncText text={String(row[col] ?? '')} />
                    </td>
                  ))}
                  <td style={TD} onClick={e => e.stopPropagation()}>
                    {scheduledRows[row.JobTemplateName] === 'ok' ? (
                      <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>✓ Enviado</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setScheduleRow(row)}
                        style={{
                          padding: '4px 12px', borderRadius: 5, border: '1px solid color-mix(in srgb, var(--green) 40%, transparent)',
                          background: 'color-mix(in srgb, var(--green) 12%, transparent)', color: 'var(--green)',
                          fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                        }}
                      >▶ Ejecutar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {scheduleRow && (
        <ScheduleModal
          row={scheduleRow}
          connection={connection}
          onClose={() => setScheduleRow(null)}
          onSuccess={() => setScheduledRows(prev => ({ ...prev, [scheduleRow.JobTemplateName]: 'ok' }))}
        />
      )}
    </div>
  )
}
