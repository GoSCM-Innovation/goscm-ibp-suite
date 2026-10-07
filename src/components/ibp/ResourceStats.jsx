// Resource Stats: cuánta CPU y memoria está consumiendo el tenant. Portado tal cual de
// `components/ResourceStats/ResourceStats.jsx` de v8: la misma cabecera, el mismo conmutador de zona,
// los mismos cinco rangos, las dos tarjetas y el gráfico, con sus textos y sus estilos.
//
// Lo único que cambia es DÓNDE se lee: v8 llamaba a SAP desde el navegador a través de un proxy; aquí
// lo hace `handlers/ibp/resource-stats.js`, porque las credenciales viven cifradas en el servidor y
// nunca llegan al navegador. El servidor además promedia los tramos de 7 y 30 días con la misma
// cuenta que hacía v8 en el componente (`core/ibp/resource-series.js`), así que al navegador llega
// la serie que v8 dibujaba, no las 4.320 filas.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

import { getTzLabel, getTzMode, setTzMode as saveTzMode } from '../../lib/fechas-v8.js'
import { fetchResourceStats } from '../../lib/ibp-resources.js'
import { useVisibleInterval } from '../../lib/useVisibleInterval.js'
import BotonActualizar from '../ui/BotonActualizar.jsx'
import ProgressBar from './ProgressBar.jsx'

// Los rangos de v8, con sus textos (`stats.range*` de `es.json`).
const RANGES = [
  { label: 'Última hora', hours: 1 },
  { label: 'Últimas 4h', hours: 4 },
  { label: 'Últimas 24h', hours: 24 },
  { label: 'Últimos 7 días', hours: 168 },
  { label: 'Últimos 30 días', hours: 720 },
]

export default function ResourceStats({ connection }) {
  const connectionId = connection?.id

  const [range, setRange] = useState(() => RANGES[2])
  const [data, setData] = useState([])
  const [current, setCurrent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastRefresh, setLastRefresh] = useState(null)
  const [tzMode, setTzModeState] = useState(() => getTzMode())
  // Solo cuenta la respuesta de la última petición: al cambiar de rango, la del rango anterior puede
  // llegar después y pintaría una serie que ya no es la elegida.
  const lastRequest = useRef(0)

  function handleTzToggle(newMode) {
    saveTzMode(newMode)
    setTzModeState(newMode)
  }

  const load = useCallback(async () => {
    const request = ++lastRequest.current
    try {
      const res = await fetchResourceStats(connectionId, range.hours)
      if (request !== lastRequest.current) return
      // En los rangos de menos de 7 días la serie llega sin agrupar, con los valores tal como los
      // escribe SAP; en 7 y 30 días, promediada a un decimal. Igual que en v8.
      const processed = res?.serie ?? []
      setData(processed)
      if (processed.length > 0) setCurrent(processed[processed.length - 1])
      setLastRefresh(new Date())
      setError('')
    } catch (e) {
      if (request !== lastRequest.current) return
      setError(e.message)
    } finally {
      if (request === lastRequest.current) setLoading(false)
    }
  }, [connectionId, range])

  // Al cambiar de rango se vacía el gráfico y se vuelve a cargar, como en v8.
  useEffect(() => {
    const id = setTimeout(() => {
      setLoading(true)
      setData([])
      load()
    }, 0)
    return () => clearTimeout(id)
  }, [load])

  // v8 refrescaba cada minuto. Aquí además se pausa con la pestaña oculta (`useVisibleInterval`).
  useVisibleInterval(load, 60_000)

  function formatTick(ts) {
    const d = new Date(ts)
    const tz = tzMode === 'utc' ? 'UTC' : undefined
    if (range.hours <= 24) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: tz })
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: tz })
  }

  function formatTooltipLabel(ts) {
    const d = new Date(ts)
    const tz = tzMode === 'utc' ? 'UTC' : undefined
    const label = d.toLocaleString([], { timeZone: tz })
    return `${label} ${tzMode === 'utc' ? 'UTC' : getTzLabel()}`
  }

  function handleRefresh() { setLoading(true); load() }

  return (
    <div style={{ padding: 28, position: 'relative' }}>
      <ProgressBar loading={loading} />

      {/* Cabecera */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div>
          {/* Sin título: repetiría el nombre de la pestaña (pedido el 2026-10-06). */}
          <div style={{ fontSize: 11, color: 'var(--text2)' }}>
            {lastRefresh ? `Actualizado ${lastRefresh.toLocaleTimeString()}` : 'Cargando...'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <TzToggle mode={tzMode} onToggle={handleTzToggle} />
          {RANGES.map(r => (
            <button key={r.hours} type="button" onClick={() => setRange(r)} style={{
              padding: '5px 11px', fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
              background: range.hours === r.hours ? 'var(--accent)' : 'transparent',
              color:      range.hours === r.hours ? '#000' : 'var(--text2)',
              border:     `1px solid ${range.hours === r.hours ? 'var(--accent)' : 'var(--border)'}`,
              transition: 'all .15s',
            }}>{r.label}</button>
          ))}
          <BotonActualizar
            etiqueta=""
            onClick={handleRefresh}
            cargando={loading}
            mensaje="Leyendo uso de recursos…"
            title="Actualizar"
            style={{
              padding: '5px 11px', fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: 'pointer',
              background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)',
              marginLeft: 4, transition: 'all .15s',
            }}
          />
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
        <KpiCard label="CPU actual" value={current?.cpu ?? null} color="#06b6d4" />
        <KpiCard label="Memoria actual" value={current?.mem ?? null} color="#a78bfa" />
      </div>

      {/* Error */}
      {error && (
        <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 16 }}>✕ {error}</div>
      )}

      {/* Gráfico */}
      {!error && (
        <div style={{
          background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '20px 8px 12px',
        }}>
          {loading ? (
            <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', fontSize: 12 }}>
              Cargando datos...
            </div>
          ) : data.length === 0 ? (
            <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', fontSize: 12 }}>
              Sin datos para el rango seleccionado.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="ts"
                  tickFormatter={formatTick}
                  tick={{ fontSize: 10, fill: 'var(--text2)' }}
                  minTickGap={50}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 10, fill: 'var(--text2)' }}
                  tickFormatter={v => `${v}%`}
                  width={38}
                />
                <Tooltip
                  contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }}
                  labelFormatter={formatTooltipLabel}
                  formatter={(v, name) => [`${v}%`, name === 'cpu' ? 'CPU' : 'Memoria']}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                  formatter={v => (v === 'cpu' ? 'CPU' : 'Memoria')}
                />
                <Line type="monotone" dataKey="cpu" stroke="var(--cyan)" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                <Line type="monotone" dataKey="mem" stroke="var(--purple)" dot={false} strokeWidth={1.5} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </div>
  )
}

/** El conmutador «UTC / hora del navegador» de v8. */
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

function KpiCard({ label, value, color }) {
  return (
    <div style={{
      background: 'var(--bg)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '16px 24px', minWidth: 150,
    }}>
      <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 30, fontWeight: 700, color, fontFamily: 'var(--mono)' }}>
        {value !== null ? `${value}%` : '—'}
      </div>
    </div>
  )
}
