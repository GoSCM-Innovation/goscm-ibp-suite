// Telemetría: quién usa el tenant, con qué herramientas y cómo le va a Excel. Portado tal cual de
// `components/Metering/Metering.jsx` de v8: la barra de período, el selector de contexto, las tres
// pestañas, los perfiles de usuario y de área, con sus textos (`metering.*` de `es.json`), sus
// estilos y sus cuentas.
//
// Lo que cambia, y por qué:
//
//   - DÓNDE SE LEE. v8 llamaba a SAP desde el navegador a través de un proxy; aquí lo hace
//     `handlers/ibp/metering.js`, porque las credenciales viven cifradas en el servidor y nunca
//     llegan al navegador. El servidor manda las filas compactadas y `fetchMetering` las devuelve como
//     las veía v8; las cuentas son las de v8, aparte para poder probarlas
//     (`core/ibp/metering-summary.js`).
//   - CUÁNTO SE LEE. v8 se quedaba con las primeras 500 a 2.000 filas de cada conjunto sin decirlo;
//     aquí se pagina hasta 20.000, y si un conjunto las supera se avisa en una franja bajo las
//     pestañas, con el estilo de los avisos de v8. Es la única pieza de interfaz que v8 no tenía.
//   - EL 401. v8 decía «Credenciales incorrectas. Cierra sesión y vuelve a ingresar.» cuando SAP
//     rechazaba sus credenciales, que eran del navegador. Aquí las de SAP son de la conexión y el
//     servidor explica qué acuerdo revisar; el texto de v8 queda para cuando la sesión de la suite
//     caduca, que es lo que ese consejo arregla.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ComposedChart, Line,
} from 'recharts'

import {
  appsView, buildComponentMap, buildUserMap, excelView, filterByContext, filterInactiveUsers,
  formatDuration, generalView, listPlanningAreas, paProfileView, presetDates, templateName, toSecs,
  userProfileView,
} from '../../../core/ibp/metering-summary.js'
import { getTzMode, inputDateToDate, toInputDate } from '../../lib/fechas-v8.js'
import { fetchMetering } from '../../lib/ibp-resources.js'

const COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6',
  '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#8b5cf6',
]

// ─── Piezas de la interfaz ───────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color, warning }) {
  return (
    <div style={{
      background: 'var(--bg)', borderRadius: 10, padding: '14px 18px', flex: '1 1 130px',
      border: `1px solid ${warning ? 'rgba(239,68,68,.4)' : 'var(--border)'}`,
    }}>
      <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: color || 'var(--text)' }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 6 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: warning ? 'var(--red)' : 'var(--text3)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function ChartCard({ title, children, style }) {
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 12px 8px', ...style }}>
      {title && (
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 12 }}>
          {title}
        </div>
      )}
      {children}
    </div>
  )
}

function BlockTitle({ text, count }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10 }}>
      {text}{count !== undefined ? ` (${Number(count).toLocaleString()})` : ''}
    </div>
  )
}

function Note({ text }) {
  return (
    <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10, fontStyle: 'italic' }}>
      {text}
    </div>
  )
}

function EmptyState({ msg }) {
  return (
    <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
      {msg ?? 'Sin datos para el período seleccionado'}
    </div>
  )
}

function DataTable({ columns, rows, maxRows }) {
  const shown = maxRows ? rows.slice(0, maxRows) : rows
  if (!shown.length) return null
  return (
    <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--border)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
            {columns.map(c => (
              <th key={c.key} style={{
                padding: '8px 12px', textAlign: c.align || 'left', whiteSpace: 'nowrap',
                color: 'var(--text3)', fontSize: 10, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '.06em',
              }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            <tr key={i} style={{
              borderBottom: i < shown.length - 1 ? '1px solid var(--border)' : 'none',
              background: i % 2 ? 'var(--surface-glass-soft)' : 'transparent',
            }}>
              {columns.map(c => (
                <td key={c.key} style={{
                  padding: '8px 12px',
                  color: c.color?.(row) || 'var(--text)',
                  fontFamily: c.mono ? 'var(--mono)' : undefined,
                  fontSize: c.mono ? 11 : 12,
                  whiteSpace: c.nowrap ? 'nowrap' : undefined,
                  textAlign: c.align || 'left',
                }}>
                  {c.render ? c.render(row) : (row[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DtField({ label, value, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.07em' }}>
        {label}
      </label>
      <input type="datetime-local" value={value} onChange={e => onChange(e.target.value)} style={{
        background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
        color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, padding: '6px 10px', outline: 'none',
      }}
        onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
        onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
      />
    </div>
  )
}

// ─── Barra de período ────────────────────────────────────────────────────────────

const PRESETS = [
  { id: 'today', label: 'Hoy' },
  { id: '7d',    label: '7 días' },
  { id: '30d',   label: '30 días' },
  { id: '90d',   label: '90 días' },
]

function FilterBar({ preset, onPreset, from, onFrom, to, onTo, loading, hasData }) {
  return (
    <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '14px 24px', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.07em', marginRight: 6 }}>
          Período
        </span>
        {PRESETS.map(p => {
          const active = preset === p.id
          return (
            <button key={p.id} type="button" onClick={() => onPreset(p.id)} style={{
              padding: '5px 16px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
              background: active ? 'rgba(247,168,0,.10)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--text2)',
              cursor: 'pointer', transition: 'all .15s',
            }}>
              {active && '✓ '}{p.label}
            </button>
          )
        })}
        {preset === 'custom' && (
          <span style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic', marginLeft: 4 }}>Personalizado</span>
        )}
        {loading && hasData && (
          <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid var(--border2)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
            Actualizando…
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <DtField label="Desde" value={from} onChange={onFrom} />
        <DtField label="Hasta" value={to} onChange={onTo} />
      </div>
    </div>
  )
}

// ─── Selector de contexto ────────────────────────────────────────────────────────

function ContextSelector({ mode, value, onModeChange, onValueChange, users, planningAreas, userMap }) {
  const [open,   setOpen]   = useState(null) // null | 'user' | 'pa'
  const [search, setSearch] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(null) }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  const userList = useMemo(() => {
    const q = search.toLowerCase()
    return users
      .filter(u => !q || (u.UserID || '').toLowerCase().includes(q) || (userMap[u.UserID] || '').toLowerCase().includes(q))
      .slice(0, 60)
  }, [users, search, userMap])

  const paList = useMemo(() =>
    planningAreas.filter(pa => !search || pa.toLowerCase().includes(search.toLowerCase())).slice(0, 60),
  [planningAreas, search])

  function selectUser(uid) { onModeChange('user'); onValueChange(uid); setOpen(null); setSearch('') }
  function selectPA(pa)    { onModeChange('pa');   onValueChange(pa);  setOpen(null); setSearch('') }
  function openDropdown(type) { setSearch(''); setOpen(open === type ? null : type) }

  const btnBase = { padding: '4px 14px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all .15s' }

  return (
    <div ref={ref} style={{
      background: 'var(--bg2)', borderBottom: '1px solid var(--border)',
      padding: '8px 24px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, position: 'relative',
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.07em', marginRight: 4 }}>
        Contexto
      </span>

      <button type="button" onClick={() => { onModeChange('all'); onValueChange(''); setOpen(null) }} style={{
        ...btnBase,
        border: `1.5px solid ${mode === 'all' ? 'var(--accent)' : 'var(--border)'}`,
        background: mode === 'all' ? 'rgba(247,168,0,.10)' : 'transparent',
        color: mode === 'all' ? 'var(--accent)' : 'var(--text2)',
      }}>Todos</button>

      <button type="button" onClick={() => openDropdown('user')} style={{
        ...btnBase,
        border: `1.5px solid ${mode === 'user' ? 'var(--cyan)' : open === 'user' ? 'var(--border2)' : 'var(--border)'}`,
        background: mode === 'user' ? 'rgba(41,171,226,.10)' : 'transparent',
        color: mode === 'user' ? 'var(--cyan)' : 'var(--text2)',
        maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {mode === 'user' && value ? `Usuario · ${userMap[value] || value}` : 'Usuario ▾'}
      </button>

      <button type="button" onClick={() => openDropdown('pa')} style={{
        ...btnBase,
        border: `1.5px solid ${mode === 'pa' ? 'var(--purple)' : open === 'pa' ? 'var(--border2)' : 'var(--border)'}`,
        background: mode === 'pa' ? 'rgba(167,139,250,.10)' : 'transparent',
        color: mode === 'pa' ? 'var(--purple)' : 'var(--text2)',
        maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {mode === 'pa' && value ? `Planning Area · ${value}` : 'Planning Area ▾'}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 24, zIndex: 200,
          background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 10,
          boxShadow: 'var(--shadow-lg)', minWidth: 280, maxHeight: 360,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <input
              autoFocus value={search} onChange={e => setSearch(e.target.value)}
              placeholder={open === 'user' ? 'Buscar usuario…' : 'Buscar planning area…'}
              style={{
                width: '100%', background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: 6, color: 'var(--text)', fontSize: 12, padding: '6px 10px', outline: 'none',
              }}
              onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
              onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {open === 'user' && userList.map(u => {
              const name = userMap[u.UserID] || u.UserID
              const active = value === u.UserID
              return (
                <button key={u.UserID} type="button" onClick={() => selectUser(u.UserID)} style={{
                  width: '100%', background: active ? 'rgba(41,171,226,.10)' : 'none',
                  border: 'none', borderBottom: '1px solid var(--border)', padding: '8px 12px',
                  textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 1,
                }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: active ? 'var(--cyan)' : 'var(--text)' }}>{name}</span>
                  {name !== u.UserID && (
                    <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{u.UserID}</span>
                  )}
                </button>
              )
            })}
            {open === 'pa' && paList.map(pa => {
              const active = value === pa
              return (
                <button key={pa} type="button" onClick={() => selectPA(pa)} style={{
                  width: '100%', background: active ? 'rgba(167,139,250,.10)' : 'none',
                  border: 'none', borderBottom: '1px solid var(--border)', padding: '8px 12px',
                  textAlign: 'left', cursor: 'pointer', fontSize: 11,
                  fontFamily: 'var(--mono)', color: active ? 'var(--purple)' : 'var(--text)',
                }}>{pa}</button>
              )
            })}
            {open === 'user' && !userList.length && (
              <div style={{ padding: 12, fontSize: 11, color: 'var(--text3)', textAlign: 'center' }}>Sin usuarios</div>
            )}
            {open === 'pa' && !paList.length && (
              <div style={{ padding: 12, fontSize: 11, color: 'var(--text3)', textAlign: 'center' }}>Sin planning areas</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Perfil de un usuario (dentro de Visión General) ─────────────────────────────

const colorDeExito = rate => (rate >= 90 ? '#10b981' : rate >= 70 ? '#f59e0b' : '#ef4444')

function UserProfile({ uid, overview, planningViews, logons, fiori, dashboards, stories, alerts, userMap }) {
  const v = useMemo(
    () => userProfileView({ uid, overview, planningViews, logons, fiori, dashboards, stories, alerts, userMap }),
    [uid, overview, planningViews, logons, fiori, dashboards, stories, alerts, userMap],
  )
  const { name, actByDay, uniquePAs, toolsUsed, firstSeen, lastSeen, unit, excelRate, avgDur } = v

  return (
    <div style={{ padding: '24px 24px 32px' }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 12,
        padding: '20px 24px', marginBottom: 24, display: 'flex', alignItems: 'flex-start', gap: 20,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          background: 'rgba(41,171,226,.15)', border: '2px solid rgba(41,171,226,.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, fontWeight: 700, color: 'var(--cyan)', flexShrink: 0,
        }}>
          {(name[0] || uid[0] || '?').toUpperCase()}
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{name !== uid ? name : '—'}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 2 }}>{uid}</div>
          {firstSeen !== '—' && (
            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 6 }}>
              Primera actividad: {firstSeen} · Última: {lastSeen}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <KpiCard label="Ventanas abiertas" value={overview.length} color="var(--accent)" />
        <KpiCard label="Planning Areas"    value={uniquePAs.length} />
        {excelRate !== null && <>
          <KpiCard label="Ops Excel" value={planningViews.length} />
          <KpiCard label="Éxito Excel" value={`${excelRate}%`}
            color={colorDeExito(excelRate)}
            warning={excelRate < 70}
          />
          <KpiCard label="Duración prom." value={formatDuration(avgDur, unit)} />
        </>}
      </div>

      {actByDay.length > 1 && (
        <ChartCard title="Actividad diaria (ventanas)" style={{ marginBottom: 24 }}>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={actByDay} margin={{ left: 0, right: 8, top: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="day" tick={{ fill: 'var(--text2)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'var(--text2)', fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="windows" name="Ventanas" fill="var(--cyan)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {uniquePAs.length > 0 && (
          <div>
            <BlockTitle text={`Planning Areas (${uniquePAs.length})`} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {uniquePAs.map(pa => (
                <span key={pa} style={{
                  padding: '3px 10px', borderRadius: 20, fontSize: 11,
                  background: 'rgba(167,139,250,.10)', border: '1px solid rgba(167,139,250,.25)',
                  color: 'var(--purple)', fontFamily: 'var(--mono)',
                }}>{pa}</span>
              ))}
            </div>
          </div>
        )}
        {toolsUsed.length > 0 && (
          <div>
            <BlockTitle text="Herramientas utilizadas" />
            <DataTable
              columns={[
                { key: 'name',  label: 'Herramienta' },
                { key: 'count', label: 'Acciones', align: 'right', mono: true },
              ]}
              rows={toolsUsed}
            />
          </div>
        )}
      </div>

      {overview.length === 0 && <EmptyState msg="Este usuario no tuvo actividad en el período seleccionado" />}
    </div>
  )
}

// ─── Perfil de un área (dentro de Visión General) ────────────────────────────────

function PAProfile({ pa, overview, planningViews, fiori, dashboards, userMap }) {
  const v = useMemo(
    () => paProfileView({ overview, planningViews, fiori, dashboards, userMap }),
    [overview, planningViews, fiori, dashboards, userMap],
  )
  const { activeUsers, topUsers, excelByDay, unit, excelRate, avgDur } = v

  return (
    <div style={{ padding: '24px 24px 32px' }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 12,
        padding: '20px 24px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 20,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 10,
          background: 'rgba(167,139,250,.15)', border: '2px solid rgba(167,139,250,.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700, color: 'var(--purple)', fontFamily: 'var(--mono)', flexShrink: 0,
        }}>PA</div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--mono)' }}>{pa}</div>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>Planning Area</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <KpiCard label="Usuarios activos" value={activeUsers.length} color="var(--accent)" />
        {excelRate !== null && <>
          <KpiCard label="Ops Excel" value={planningViews.length} />
          <KpiCard label="Éxito Excel" value={`${excelRate}%`}
            color={colorDeExito(excelRate)}
            warning={excelRate < 70}
          />
          <KpiCard label="Duración prom." value={formatDuration(avgDur, unit)} />
        </>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {topUsers.length > 0 && (
          <div>
            <BlockTitle text="Usuarios activos en esta PA" />
            <DataTable
              columns={[
                { key: 'name', label: 'Usuario' },
                { key: 'uid',  label: 'ID', mono: true, color: () => 'var(--text3)' },
                { key: 'acts', label: 'Acciones', align: 'right', mono: true },
              ]}
              rows={topUsers} maxRows={10}
            />
          </div>
        )}
        {excelByDay.length > 1 && (
          <div>
            <BlockTitle text="Excel — tendencia diaria" />
            <ChartCard>
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={excelByDay} margin={{ left: 0, right: 32, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="day" tick={{ fill: 'var(--text2)', fontSize: 10 }} />
                  <YAxis yAxisId="ops" tick={{ fill: 'var(--text2)', fontSize: 10 }} allowDecimals={false} />
                  <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tickFormatter={val => `${val}%`} tick={{ fill: 'var(--text2)', fontSize: 10 }} />
                  <Tooltip formatter={(val, n, p) => (p.dataKey === 'successPct' ? `${val}%` : val)} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 10 }} />
                  <Bar  yAxisId="ops" dataKey="ops"        name="Operaciones" fill={COLORS[0]} radius={[3, 3, 0, 0]} />
                  <Line yAxisId="pct" dataKey="successPct" name="Éxito %"     stroke={COLORS[1]} strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        )}
      </div>

      {activeUsers.length === 0 && <EmptyState msg="Sin actividad en esta Planning Area para el período seleccionado" />}
    </div>
  )
}

// ─── Pestaña 1: Visión General ───────────────────────────────────────────────────

function TabGeneral({ overview, planningViews, logons, fiori, dashboards, stories, alerts, users, userMap, componentMap, contextMode, contextValue }) {
  const [search, setSearch] = useState('')

  const v = useMemo(
    () => generalView({ overview, planningViews, fiori, dashboards, stories, alerts, users, userMap, componentMap }),
    [overview, planningViews, fiori, dashboards, stories, alerts, users, userMap, componentMap],
  )
  const inactiveUsers = useMemo(() => filterInactiveUsers(v.inactiveUsers, search), [v, search])

  const {
    dauData, componentChartData, componentNames, featureRows, topActiveUsers, attention,
    totalLicensed, totalActive, adoptionRate, uniquePAs, inactiveCount,
  } = v
  const rateColor = adoptionRate >= 70 ? '#10b981' : adoptionRate >= 40 ? '#f59e0b' : '#ef4444'

  if (contextMode === 'user' && contextValue) {
    return (
      <UserProfile
        uid={contextValue} overview={overview} planningViews={planningViews}
        logons={logons} fiori={fiori} dashboards={dashboards}
        stories={stories} alerts={alerts} userMap={userMap}
      />
    )
  }

  if (contextMode === 'pa' && contextValue) {
    return (
      <PAProfile
        pa={contextValue} overview={overview} planningViews={planningViews}
        fiori={fiori} dashboards={dashboards} userMap={userMap}
      />
    )
  }

  const attentionMsg = a => (a.type === 'error'
    ? `PA ${a.pa}: ${a.rate}% de errores en Excel (${a.count} ops)`
    : a.n > 1
      ? `${a.n} usuarios licenciados sin actividad en el período`
      : `${a.n} usuario licenciado sin actividad en el período`)

  return (
    <div style={{ padding: '24px 24px 32px' }}>
      {attention.length > 0 && (
        <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {attention.map((a, i) => (
            <div key={i} style={{
              padding: '8px 14px', borderRadius: 8, fontSize: 12,
              background: a.type === 'error' ? 'rgba(239,68,68,.08)' : 'rgba(247,168,0,.08)',
              border: `1px solid ${a.type === 'error' ? 'rgba(239,68,68,.25)' : 'rgba(247,168,0,.25)'}`,
              color: a.type === 'error' ? 'var(--red)' : 'var(--accent)',
            }}>
              {a.type === 'error' ? '⚠ ' : '○ '}{attentionMsg(a)}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <KpiCard label="Tasa de adopción" value={`${adoptionRate}%`}
          sub={`${totalActive} activos de ${totalLicensed} licenciados`}
          color={rateColor} warning={adoptionRate < 40} />
        <KpiCard label="Usuarios activos"   value={totalActive}   color="var(--accent)" />
        <KpiCard label="Total licenciados" value={totalLicensed} />
        <KpiCard label="Sin actividad"    value={inactiveCount}
          sub={inactiveCount > 0 ? 'Licencias sin uso en el período' : undefined}
          color={inactiveCount > 0 ? '#ef4444' : 'var(--text)'} warning={inactiveCount > 0} />
        <KpiCard label="Planning Areas activas" value={uniquePAs} />
      </div>

      {dauData.length > 1 && (
        <ChartCard title="Usuarios únicos por día" style={{ marginBottom: 24 }}>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={dauData} margin={{ left: 0, right: 8, top: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="day" tick={{ fill: 'var(--text2)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'var(--text2)', fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="users" name="Usuarios" fill={COLORS[0]} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {componentNames.length > 0 && componentChartData.length > 1 && (
        <ChartCard title="Actividad por componente (acciones por día)" style={{ marginBottom: 24 }}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={componentChartData} margin={{ left: 0, right: 8, top: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="day" tick={{ fill: 'var(--text2)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'var(--text2)', fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 10 }} />
              {componentNames.map((name, i) => (
                <Bar key={name} dataKey={name} stackId="a" fill={COLORS[i % COLORS.length]}
                  radius={i === componentNames.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {featureRows.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <BlockTitle text="Adopción por herramienta" />
          <DataTable
            columns={[
              { key: 'name',     label: 'Herramienta' },
              { key: 'users',    label: 'Usuarios únicos', align: 'right', mono: true,
                render: r => r.users.toLocaleString() },
              { key: 'pct',      label: '% usuarios activos', align: 'right',
                render: r => (totalActive > 0 ? `${Math.round(r.users / totalActive * 100)}%` : '—'),
                color: r => {
                  if (!totalActive) return 'var(--text2)'
                  const p = Math.round(r.users / totalActive * 100)
                  return p >= 50 ? '#10b981' : p >= 20 ? '#f59e0b' : 'var(--text2)'
                },
              },
              { key: 'sessions', label: 'Sesiones / Acciones', align: 'right', mono: true,
                render: r => r.sessions.toLocaleString() },
            ]}
            rows={featureRows}
          />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {topActiveUsers.length > 0 && (
          <div>
            <BlockTitle text="Usuarios más activos" />
            <DataTable
              columns={[
                { key: 'name', label: 'Usuario' },
                { key: 'acts', label: 'Ventanas',      align: 'right', mono: true },
                { key: 'last', label: 'Último',        mono: true, nowrap: true },
                { key: 'pas',  label: 'Planning Areas', color: () => 'var(--text2)' },
              ]}
              rows={topActiveUsers} maxRows={10}
            />
          </div>
        )}
        <div>
          <BlockTitle text="Sin actividad en el período" count={inactiveCount} />
          {inactiveCount === 0 ? (
            <div style={{ padding: '14px 0', fontSize: 12, color: '#10b981' }}>
              ✓ Todos los usuarios licenciados tuvieron actividad
            </div>
          ) : (
            <>
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar usuario…"
                style={{
                  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
                  color: 'var(--text)', fontSize: 12, padding: '6px 10px', outline: 'none',
                  width: '100%', marginBottom: 8, boxSizing: 'border-box',
                }}
                onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
              />
              <DataTable
                columns={[
                  { key: 'uid',  label: 'ID',     mono: true },
                  { key: 'name', label: 'Nombre', color: () => 'var(--text2)' },
                ]}
                rows={inactiveUsers} maxRows={20}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Pestaña 2: Excel Add-In ─────────────────────────────────────────────────────

function TabExcel({ planningViews, logons, chgKeyFig, userMap }) {
  const [subtab, setSubtab] = useState('slow')

  const v = useMemo(() => excelView({ planningViews, logons, chgKeyFig }), [planningViews, logons, chgKeyFig])
  const {
    total, failed, rate, unit, avgDur, cells, logonUnit, avgLogonDur,
    actTypeData, trendData, paPerf, topChgKF, slowRows, failRows,
  } = v
  const rateColor = rate >= 90 ? '#10b981' : rate >= 70 ? '#f59e0b' : '#ef4444'
  const durColor  = toSecs(avgDur, unit) > 120 ? '#ef4444' : toSecs(avgDur, unit) > 60 ? '#f59e0b' : '#10b981'

  const pvCols = [
    { key: 'user',      label: 'Usuario',      render: r => userMap[r.UserID] || r.UserID || '—' },
    { key: 'pa',        label: 'PA',           render: r => r.PlanningAreaID || '—', mono: true },
    { key: 'template',  label: 'Template',     render: templateName, color: () => 'var(--text2)' },
    { key: 'dur',       label: 'Tiempo total', nowrap: true, mono: true,
      render: r => formatDuration(r.TotalDuration, r.DurationUnit),
      color: r => { const s = toSecs(r.TotalDuration, r.DurationUnit); return s > 120 ? '#ef4444' : s > 60 ? '#f59e0b' : '#10b981' } },
    { key: 'sap',       label: 'Tiempo SAP',   nowrap: true, mono: true,
      render: r => formatDuration(r.DurationWithoutUserInteraction, r.DurationUnit),
      color: () => 'var(--text3)' },
    { key: 'usr',       label: 'Tiempo usuario', nowrap: true, mono: true,
      render: r => {
        const tot = Number(r.TotalDuration) || 0
        const sap = Number(r.DurationWithoutUserInteraction) || 0
        return formatDuration(Math.max(0, tot - sap), r.DurationUnit)
      },
      color: () => 'var(--text2)' },
    { key: 'cells',     label: 'Celdas',       align: 'right', mono: true,
      render: r => Number(r.PlanningViewCells).toLocaleString() },
  ]

  return (
    <div style={{ padding: '24px 24px 32px' }}>
      {total === 0 ? <EmptyState /> : (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
            <KpiCard label="Operaciones"       value={total.toLocaleString()} />
            <KpiCard label="Tasa de éxito"     value={`${rate}%`}            color={rateColor} warning={rate < 70} />
            <KpiCard label="Errores"           value={failed}                color={failed > 0 ? '#ef4444' : 'var(--text)'} warning={failed > 0} />
            <KpiCard label="Duración promedio" value={formatDuration(avgDur, unit)} color={durColor} />
            <KpiCard label="Celdas procesadas" value={cells.toLocaleString()} />
            {logons.length > 0 && (
              <KpiCard label="Logons Excel" value={logons.length} sub={`Prom: ${formatDuration(avgLogonDur, logonUnit)}`} />
            )}
          </div>

          <Note text="Tiempo total = duración completa de la operación. Tiempo SAP = procesamiento puro del servidor. Tiempo usuario = interacción / espera del usuario." />

          {actTypeData.length > 1 && (
            <div style={{ marginBottom: 24 }}>
              <BlockTitle text="Distribución por tipo de operación" />
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {actTypeData.map((item, i) => (
                  <div key={item.tipo} style={{
                    background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
                    padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 140,
                  }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: COLORS[i % COLORS.length], fontVariantNumeric: 'tabular-nums' }}>
                      {item.pct}%
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text2)' }}>{item.tipo}</div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
                      {item.count.toLocaleString()} ops
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {trendData.length > 1 && (
            <ChartCard title="Tendencia diaria — éxito y duración" style={{ marginBottom: 24 }}>
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={trendData} margin={{ left: 0, right: 32, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="day" tick={{ fill: 'var(--text2)', fontSize: 10 }} />
                  <YAxis yAxisId="pct" domain={[0, 100]} tickFormatter={val => `${val}%`} tick={{ fill: 'var(--text2)', fontSize: 10 }} />
                  <YAxis yAxisId="dur" orientation="right" tickFormatter={val => `${val}s`} tick={{ fill: 'var(--text2)', fontSize: 10 }} />
                  <Tooltip formatter={(val, n, p) => (p.dataKey === 'successPct' ? `${val}%` : `${val}s`)} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 10 }} />
                  <Bar  yAxisId="dur" dataKey="durationS"  name="Duración (s)" fill={COLORS[2]} opacity={0.65} radius={[3, 3, 0, 0]} />
                  <Line yAxisId="pct" dataKey="successPct" name="Éxito %"      stroke={COLORS[1]} strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          {paPerf.length > 0 && (
            <ChartCard title="Rendimiento por Planning Area (top 10)" style={{ marginBottom: 24 }}>
              <ResponsiveContainer width="100%" height={Math.max(160, paPerf.length * 30)}>
                <BarChart data={paPerf} layout="vertical" margin={{ left: 4, right: 56, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: 'var(--text2)', fontSize: 10 }} />
                  <YAxis type="category" dataKey="pa" width={90} tick={{ fill: 'var(--text2)', fontSize: 10 }} />
                  <Tooltip formatter={(val, n, p) => (p.dataKey === 'rate' ? `${val}%` : p.dataKey === 'avgDur' ? `${val}s` : val)} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="total"  fill={COLORS[0]} name="Operaciones"  radius={[0, 3, 3, 0]} />
                  <Bar dataKey="avgDur" fill={COLORS[2]} name="Duración (s)" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          {topChgKF.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <BlockTitle text="Key figures más modificados" count={topChgKF.length} />
              <DataTable
                columns={[
                  { key: 'kf',       label: 'Key Figure',      mono: true },
                  { key: 'cambios',  label: 'Cambios totales', align: 'right', mono: true, render: r => r.cambios.toLocaleString() },
                  { key: 'usuarios', label: 'Usuario',         align: 'right', mono: true },
                ]}
                rows={topChgKF}
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: 0, marginBottom: 12 }}>
            {[['slow', `Más lentas (${slowRows.length})`], ['errors', `Errores (${failRows.length})`]].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setSubtab(id)} style={{
                padding: '6px 16px', fontSize: 11, background: 'none', border: 'none',
                borderBottom: subtab === id ? '2px solid var(--accent)' : '2px solid transparent',
                color: subtab === id ? 'var(--text)' : 'var(--text2)',
                fontWeight: subtab === id ? 600 : 400, cursor: 'pointer', transition: 'all .15s',
              }}>{label}</button>
            ))}
          </div>

          {subtab === 'slow' && <DataTable columns={pvCols} rows={slowRows} />}
          {subtab === 'errors' && (
            failRows.length === 0
              ? <div style={{ padding: '14px 0', fontSize: 12, color: '#10b981' }}>✓ Sin errores en el período</div>
              : <DataTable columns={pvCols} rows={failRows} />
          )}
        </>
      )}
    </div>
  )
}

// ─── Pestaña 3: Herramientas ─────────────────────────────────────────────────────

function TabApps({ fiori, dashboards, stories, alerts, userMap }) {
  const v = useMemo(
    () => appsView({ fiori, dashboards, stories, alerts, userMap }),
    [fiori, dashboards, stories, alerts, userMap],
  )
  const { fioriApps, dashPorUsuario, alertPorUsuario, storyRows, noData } = v

  return (
    <div style={{ padding: '24px 24px 32px' }}>
      {noData ? <EmptyState /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

          {fioriApps.length > 0 && (
            <div>
              <BlockTitle text="Apps Fiori" />
              <DataTable
                columns={[
                  { key: 'name',     label: 'Aplicación' },
                  { key: 'usuarios', label: 'Usuarios únicos', align: 'right', mono: true },
                  { key: 'usos',     label: 'Usos',            align: 'right', mono: true, render: r => r.usos.toLocaleString() },
                ]}
                rows={fioriApps}
              />
            </div>
          )}

          {dashPorUsuario.length > 0 && (
            <div>
              <BlockTitle text={`Sesiones de Dashboard (${dashboards.length} total)`} />
              <Note text="La API no incluye el nombre del dashboard en los registros de actividad." />
              <DataTable
                columns={[
                  { key: 'usuario',  label: 'Usuario' },
                  { key: 'pa',       label: 'Planning Area(s)', color: () => 'var(--text2)' },
                  { key: 'sesiones', label: 'Sesiones / Acciones', align: 'right', mono: true },
                ]}
                rows={dashPorUsuario}
              />
            </div>
          )}

          {alertPorUsuario.length > 0 && (
            <div>
              <BlockTitle text="Alert Monitor — aperturas de la app" />
              <Note text="La API registra apertura de la app (ALTMON_APP_LOAD). Las acciones dentro de alertas no tienen datos en este tenant." />
              <DataTable
                columns={[
                  { key: 'usuario',   label: 'Usuario' },
                  { key: 'aperturas', label: 'Aperturas', align: 'right', mono: true },
                  { key: 'ultima',    label: 'Última',    mono: true, nowrap: true },
                ]}
                rows={alertPorUsuario}
              />
            </div>
          )}

          {storyRows.length > 0 && (
            <div>
              <BlockTitle text="Analytics Stories" />
              <DataTable
                columns={[
                  { key: 'name',     label: 'Story' },
                  { key: 'usuarios', label: 'Usuarios únicos', align: 'right', mono: true },
                  { key: 'vistas',   label: 'Vistas',          align: 'right', mono: true },
                ]}
                rows={storyRows}
              />
            </div>
          )}

        </div>
      )}
    </div>
  )
}

// ─── La pantalla ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'general', label: 'Visión General' },
  { id: 'excel',   label: 'Excel Add-In' },
  { id: 'apps',    label: 'Herramientas' },
]

/** Los dos campos de fecha para un botón de período, en la zona elegida. */
function presetInputs(id) {
  const [s, e] = presetDates(id)
  const tz = getTzMode()
  return [toInputDate(s, tz), toInputDate(e, tz)]
}

export default function Metering({ connection }) {
  const connectionId = connection?.id

  // Los dos campos del período con el que abre la pantalla: los 7 días, como en v8.
  const [initial] = useState(() => presetInputs('7d'))
  const [preset,       setPreset]       = useState('7d')
  const [from,         setFrom]         = useState(initial[0])
  const [to,           setTo]           = useState(initial[1])
  const [data,         setData]         = useState(null)
  const [avisos,       setAvisos]       = useState([])
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState('')
  const [activeTab,    setActiveTab]    = useState('general')
  const [contextMode,  setContextMode]  = useState('all')
  const [contextValue, setContextValue] = useState('')

  const debounceRef = useRef(null)
  // Solo cuenta la respuesta de la última lectura: una anterior que llegue tarde no pisa el período
  // que se eligió después.
  const lastRequest = useRef(0)

  const loadData = useCallback(async (fromValue, toValue) => {
    const request = ++lastRequest.current
    setLoading(true)
    setError('')
    try {
      const tz       = getTzMode()
      const fromDate = inputDateToDate(fromValue, tz)
      const toDate   = inputDateToDate(toValue,   tz)
      const res = await fetchMetering(connectionId, { desde: fromDate.toISOString(), hasta: toDate.toISOString() })
      if (request !== lastRequest.current) return
      setData(res.data)
      setAvisos(res.avisos)
    } catch (e) {
      if (request !== lastRequest.current) return
      setError(e.status === 401
        ? 'Credenciales incorrectas. Cierra sesión y vuelve a ingresar.'
        : `Error al cargar datos: ${e.message}`)
    }
    setLoading(false)
  }, [connectionId])

  // Al abrir se carga el período inicial.
  useEffect(() => {
    const id = setTimeout(() => loadData(initial[0], initial[1]), 0)
    return () => clearTimeout(id)
  }, [loadData, initial])

  useEffect(() => () => clearTimeout(debounceRef.current), [])

  // Un campo de fecha editado a mano: el período pasa a «Personalizado» y se carga 900 ms después
  // de la última tecla, como en v8.
  function handleCustom(nextFrom, nextTo) {
    setFrom(nextFrom)
    setTo(nextTo)
    setPreset('custom')
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => loadData(nextFrom, nextTo), 900)
  }

  function handlePreset(id) {
    setPreset(id)
    const [nf, nt] = presetInputs(id)
    setFrom(nf)
    setTo(nt)
    clearTimeout(debounceRef.current)
    loadData(nf, nt)
  }

  const userMap = useMemo(() => (data ? buildUserMap(data.users) : {}), [data])
  const componentMap = useMemo(() => (data ? buildComponentMap(data.components) : {}), [data])
  const planningAreas = useMemo(() => listPlanningAreas(data), [data])
  const filteredData = useMemo(() => filterByContext(data, contextMode, contextValue), [data, contextMode, contextValue])

  const fd = filteredData || {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <FilterBar
        preset={preset} onPreset={handlePreset}
        from={from}     onFrom={v => handleCustom(v, to)}
        to={to}         onTo={v => handleCustom(from, v)}
        loading={loading} hasData={!!data}
      />

      {data && (
        <ContextSelector
          mode={contextMode}       value={contextValue}
          onModeChange={setContextMode} onValueChange={setContextValue}
          users={data.users}       planningAreas={planningAreas}
          userMap={userMap}
        />
      )}

      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', background: 'var(--bg2)', padding: '0 24px', flexShrink: 0 }}>
        {TABS.map(tab => (
          <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} style={{
            padding: '8px 18px', fontSize: 11, background: 'none', border: 'none',
            borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
            color: activeTab === tab.id ? 'var(--text)' : 'var(--text2)',
            fontWeight: activeTab === tab.id ? 600 : 400, cursor: 'pointer', transition: 'all .15s',
          }}>{tab.label}</button>
        ))}
      </div>

      {error && (
        <div style={{ padding: '10px 24px', background: 'rgba(239,68,68,.08)', borderBottom: '1px solid rgba(239,68,68,.25)', fontSize: 12, color: 'var(--red)', flexShrink: 0 }}>
          ✕ {error}
        </div>
      )}

      {/* v8 no avisaba: se quedaba con las primeras filas de cada conjunto sin decirlo. Aquí el tope
          es de 20.000 y, si un conjunto lo pasa, se dice (ver la cabecera). */}
      {data && avisos.length > 0 && (
        <div style={{ padding: '10px 24px', background: 'rgba(247,168,0,.08)', borderBottom: '1px solid rgba(247,168,0,.25)', fontSize: 12, color: 'var(--accent)', flexShrink: 0 }}>
          {avisos.map(aviso => <div key={aviso}>○ {aviso}</div>)}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', opacity: loading && data ? 0.55 : 1, transition: 'opacity .2s' }}>
        {!data && loading && (
          <div style={{ padding: 56, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
            Cargando datos de telemetría…
          </div>
        )}
        {!data && !loading && !error && (
          <div style={{ padding: 56, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
            Selecciona un período para comenzar
          </div>
        )}
        {data && (
          <>
            {activeTab === 'general' && (
              <TabGeneral
                overview={fd.overview}         planningViews={fd.planningViews}
                logons={fd.logons}             fiori={fd.fiori}
                dashboards={fd.dashboards}     stories={fd.stories}
                alerts={fd.alerts}             users={data.users}
                userMap={userMap}              componentMap={componentMap}
                contextMode={contextMode}      contextValue={contextValue}
              />
            )}
            {activeTab === 'excel' && (
              <TabExcel
                planningViews={fd.planningViews} logons={fd.logons}
                chgKeyFig={fd.chgKeyFig}         userMap={userMap}
              />
            )}
            {activeTab === 'apps' && (
              <TabApps
                fiori={fd.fiori}       dashboards={fd.dashboards}
                stories={fd.stories}   alerts={fd.alerts}
                userMap={userMap}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
