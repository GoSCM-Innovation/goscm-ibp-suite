// El tablero de un tenant: cómo viene el período de un vistazo.
//
// Portado de `src/components/Resumen/Resumen.jsx` de v9. Lo que cambia:
//
//   - Los colores y las etiquetas de estado salen de `core/cids/task-status.js`. En v9 este archivo
//     tenía SU PROPIA copia de las dos tablas, con las etiquetas en inglés: era la cuarta copia que
//     el levantamiento mandaba eliminar.
//   - Los grupos con los que se cuenta (en cola, avisos, falladas) también salen de la capa
//     transversal. En v9 estaban a mano y no coincidían ni consigo mismos: el indicador de
//     "Fallidas" contaba solo ERROR mientras el gráfico por día y la lista de últimas fallidas
//     contaban también la cancelación fallida. Ahora las tres cuentas dan lo mismo.
//   - El rango de fechas es el gancho compartido, con el tope de 90 días y el rango completo
//     obligatorio. v9 no tenía ninguna de las dos cosas aquí: se podía pedir un año, y un campo a
//     medio escribir mandaba una consulta sin rango.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { isFailed, isQueued, isWarning, statusMeta, successRate } from '../../../core/cids/task-status.js'
import { cidsCall } from '../../lib/cids.js'
import {
  colorDeTasa, latestFailed, latestWarnings, perDayBreakdown, statusBreakdown, topTasks,
} from '../../lib/cids-stats.js'
import { useDateRange } from '../../lib/useDateRange.js'
import DateRangeBar from '../ui/DateRangeBar.jsx'
import { PerDayBars, SinDatos, StatusDonut } from './StatusCharts.jsx'

/** Cada cuánto se recarga solo. De v9: cinco minutos, no treinta segundos como el monitor. */
const REFRESH_MS = 5 * 60 * 1000

/** El mismo tope de SAP CI-DS que el monitor. */
const MAX_DAYS = 90

/** El estado de un agente viene prefijado con "AGENT:". Se quita solo para mostrarlo, como en v9. */
const estadoAgente = (valor) => String(valor || '').replace(/^AGENT:/, '') || 'UNKNOWN'

const colorDeAgente = (estado) => {
  if (estado === 'CONNECTED') return 'var(--green)'
  if (estado === 'MAINTENANCE') return 'var(--accent)'
  return 'var(--text3)'
}

export default function Summary({ connectionId }) {
  const fechas = useDateRange({ maxDays: MAX_DAYS })
  const { zona, rangoIncompleto, rangoExcedido, rangoValido, startDateFrom, startDateTo } = fechas

  const [ejecuciones, setEjecuciones] = useState([])
  const [agentes, setAgentes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [ultimoRefresco, setUltimoRefresco] = useState(null)

  const cargar = useCallback(async () => {
    // Sin las dos puntas no se consulta: CI-DS sin rango devuelve el histórico entero del tenant.
    if (!startDateFrom || !startDateTo) return
    setCargando(true)
    setError('')
    try {
      // Las dos consultas son independientes, así que salen juntas. Como en v9.
      const [tareas, grupos] = await Promise.all([
        cidsCall(connectionId, 'getAllExecutedTasks2', { startDateFrom, startDateTo }),
        cidsCall(connectionId, 'getAgents', { activeOnly: false }),
      ])
      setEjecuciones(Array.isArray(tareas) ? tareas : [])
      setAgentes((Array.isArray(grupos) ? grupos : []).flatMap((grupo) => grupo.agents ?? []))
      setUltimoRefresco(new Date())
    } catch (fallo) {
      setError(fallo.message)
    } finally {
      setCargando(false)
    }
  }, [connectionId, startDateFrom, startDateTo])

  // Por temporizador y no llamando a `cargar` en el efecto: un efecto no debe cambiar el estado en
  // el acto. Mismo patrón que el monitor.
  useEffect(() => {
    const primera = setTimeout(cargar, 0)
    const reloj = setInterval(cargar, REFRESH_MS)
    return () => { clearTimeout(primera); clearInterval(reloj) }
  }, [cargar])

  const resumen = useMemo(() => calcular(ejecuciones, zona), [ejecuciones, zona])

  return (
    <div className="monitor">
      <div className={`progress-line${cargando ? ' on' : ''}`} />

      <div className="monitor-head">
        <div className="monitor-meta">
          {cargando && ejecuciones.length === 0
            ? 'Cargando…'
            : `${resumen.total} ejecuciones en el período`}
          {ultimoRefresco && !cargando && (
            <span><span className="sep">·</span>{ultimoRefresco.toLocaleTimeString()}</span>
          )}
        </div>

        <div className="monitor-bar">
          <DateRangeBar
            rango={fechas.rango}
            zona={zona}
            dias={fechas.dias}
            onZona={fechas.cambiarZona}
            onRango={fechas.cambiarRango}
          />
          <button type="button" className="btn btn-sm" onClick={cargar} disabled={cargando || !rangoValido}>
            ↺ Actualizar
          </button>
          <span className="tag tag-muted" title={`Se actualiza solo cada ${REFRESH_MS / 60000} minutos`}>
            Auto {REFRESH_MS / 60000} min
          </span>
        </div>
      </div>

      {rangoIncompleto && (
        <div className="notice notice-info">
          Elegí las dos fechas. Sin rango, CI-DS devuelve todas las ejecuciones que existan en el
          tenant.
        </div>
      )}
      {rangoExcedido && (
        <div className="notice notice-error">
          El rango no puede pasar de {MAX_DAYS} días: es el límite de SAP CI-DS. Acortá las fechas.
        </div>
      )}
      {error && <div className="notice notice-error">✕ {error}</div>}

      <div className="tablero">
        <div className="grid-kpi">
          <Kpi label="Total ejecuciones" valor={resumen.total} />
          <Kpi label="En ejecución" valor={resumen.enEjecucion} color="var(--cyan)" />
          <Kpi label="En cola" valor={resumen.enCola} color="var(--purple)" />
          <Kpi label="Correctas" valor={resumen.correctas} color="var(--green)" />
          <Kpi label="Falladas" valor={resumen.falladas} color="var(--red)" />
          <Kpi
            label="Tasa de éxito"
            valor={resumen.tasaExito === null ? '—' : `${resumen.tasaExito}%`}
            color={colorDeTasa(resumen.tasaExito)}
          />
        </div>

        <div className="grid-charts">
          <div className="card">
            <div className="card-label">Distribución por estado</div>
            <StatusDonut porEstado={resumen.porEstado} />
          </div>

          <div className="card">
            <div className="card-label">Ejecuciones por día</div>
            <PerDayBars porDia={resumen.porDia} />
          </div>
        </div>

        <div className="grid-stats">
          <div className="card">
            <div className="card-label">Tareas más ejecutadas</div>
            {resumen.masEjecutadas.length === 0 ? <SinDatos /> : resumen.masEjecutadas.map((tarea, i) => (
              <Ranking
                key={tarea.clave}
                puesto={i + 1}
                nombre={tarea.taskName}
                veces={tarea.veces}
                maximo={resumen.masEjecutadas[0].veces}
              />
            ))}
          </div>

          <div className="card">
            <div className="card-label">Últimas falladas</div>
            {resumen.ultimasFalladas.length === 0
              ? <div className="todo-bien">✓ Sin fallos en el período</div>
              : resumen.ultimasFalladas.map((fila) => (
                <div className="lista-fila" key={fila.runId}>
                  <div className="lista-nombre" style={{ color: 'var(--red)' }} title={fila.taskName || ''}>
                    {fila.taskName || '—'}
                  </div>
                  <div className="lista-detalle mono">RunID {fila.runId}</div>
                </div>
              ))}
          </div>

          <div className="card">
            <div className="card-label">Agentes</div>
            {agentes.length === 0 ? <SinDatos /> : agentes.slice(0, 8).map((agente, i) => {
              const estado = estadoAgente(agente.agentStatus)
              const color = colorDeAgente(estado)
              return (
                <div className="lista-fila agente" key={agente.guid ?? `${agente.name}-${i}`}>
                  <span className="punto" style={{ background: color }} />
                  <span className="lista-nombre">{agente.name}</span>
                  <span className="agente-estado" style={{ color }}>{estado}</span>
                </div>
              )
            })}
          </div>

          <div className="card">
            <div className="card-label">Correctas con errores</div>
            {resumen.conAvisos.length === 0
              ? <div className="todo-bien">✓ Sin avisos en el período</div>
              : resumen.conAvisos.map((fila) => (
                <div className="lista-fila" key={fila.runId}>
                  <div className="lista-nombre" style={{ color: 'var(--accent)' }} title={fila.taskName || ''}>
                    {fila.taskName || '—'}
                  </div>
                  <div className="lista-detalle">{statusMeta(fila.statusCode).label}</div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Todo lo que muestra el tablero, calculado de una sola pasada.
 *
 * Está fuera del componente para que se lea como lo que es: una transformación de la lista de
 * ejecuciones en números, sin nada de React en medio.
 */
function calcular(ejecuciones, zona) {
  return {
    total: ejecuciones.length,
    enEjecucion: ejecuciones.filter((fila) => fila.statusCode === 'RUNNING').length,
    enCola: ejecuciones.filter((fila) => isQueued(fila.statusCode)).length,
    correctas: ejecuciones.filter((fila) => fila.statusCode === 'SUCCESS').length,
    falladas: ejecuciones.filter((fila) => isFailed(fila.statusCode)).length,
    conAvisosTotal: ejecuciones.filter((fila) => isWarning(fila.statusCode)).length,
    tasaExito: successRate(ejecuciones.map((fila) => fila.statusCode)),
    porEstado: statusBreakdown(ejecuciones, statusMeta),
    porDia: perDayBreakdown(ejecuciones, zona),
    masEjecutadas: topTasks(ejecuciones),
    ultimasFalladas: latestFailed(ejecuciones),
    conAvisos: latestWarnings(ejecuciones),
  }
}

function Kpi({ label, valor, color = 'var(--text)' }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-valor" style={{ color }}>{valor}</div>
    </div>
  )
}

function Ranking({ puesto, nombre, veces, maximo }) {
  return (
    <div className="ranking">
      <div className="ranking-cabeza">
        <span className="ranking-nombre" title={nombre}>
          <span className="ranking-puesto">#{puesto}</span>
          {nombre}
        </span>
        <span className="ranking-veces">{veces}</span>
      </div>
      <div className="ranking-barra">
        <div style={{ width: `${maximo > 0 ? (veces / maximo) * 100 : 0}%` }} />
      </div>
    </div>
  )
}
