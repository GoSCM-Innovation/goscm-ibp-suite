// El tablero de todos los repositorios a la vez.
//
// Portado de `src/components/Resumen/GlobalResumen.jsx` de v9. Es la pantalla del consultor que
// atiende varios clientes: los indicadores sumados, el estado de cada conexión, y los gráficos que
// se pueden ver en global o de una conexión a la vez.
//
// Lo que desaparece respecto de v9: allí cada conexión podía estar en "sin sesión" o "sesión
// expirada", y había un botón de "Iniciar sesión" por fila, porque el usuario se identificaba a mano
// contra cada tenant. Aquí la sesión la abre el servidor cuando hace falta, así que una conexión solo
// puede estar cargando, bien, o con un error que hay que leer.
//
// Cada destino se pide por separado y en paralelo, como en v9: uno lento o caído no debe impedir ver
// los demás, y así se van llenando las filas a medida que contestan.
//
// "Destino" es una conexión y uno de sus dos repositorios, así que cada conexión aporta DOS filas:
// pruebas y productivo. Es el doble de consultas que si fuera una sola, y es el precio de que el
// tablero diga la verdad — los dos repositorios existen y tienen ejecuciones distintas. El filtro de
// arriba está justamente para acotar cuando no quieres verlos todos.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { isFailed, isQueued, isWarning, statusMeta, successRate } from '../../../core/cids/task-status.js'
import { cidsCall } from '../../lib/cids.js'
import {
  colorDeTasa, latestFailed, perDayBreakdown, statusBreakdown, topTasks,
} from '../../lib/cids-stats.js'
import { useDateRange } from '../../lib/useDateRange.js'
import ConnectionAvatar from '../ui/ConnectionAvatar.jsx'
import DateRangeBar from '../ui/DateRangeBar.jsx'
import EnvBadge from './EnvBadge.jsx'
import { PerDayBars, SinDatos, StatusDonut } from '../ui/StatusCharts.jsx'

/** Cada cuánto se recarga solo. De v9. */
const REFRESH_MS = 5 * 60 * 1000

/** El mismo tope de SAP CI-DS que el resto del módulo. */
const MAX_DAYS = 90

export default function GlobalSummary({ destinos }) {
  const fechas = useDateRange({ maxDays: MAX_DAYS })
  const { zona, rangoIncompleto, rangoExcedido, rangoValido, startDateFrom, startDateTo } = fechas

  // Por destino: { estado: 'cargando' | 'ok' | 'error', ejecuciones, agentes, error }
  const [porDestino, setPorDestino] = useState({})
  const [cargando, setCargando] = useState(true)
  const [ultimoRefresco, setUltimoRefresco] = useState(null)

  // Conjunto vacío = sin filtro, se ve todo. Con algo dentro = solo esos. Es el criterio de v9.
  const [filtrados, setFiltrados] = useState(() => new Set())
  const [laminaActiva, setLaminaActiva] = useState(0)

  // Clave estable: cambia solo si cambia el conjunto de destinos, no si se reordenan.
  const claveDestinos = useMemo(() => destinos.map((uno) => uno.id).sort().join('|'), [destinos])

  const cargar = useCallback(async () => {
    if (!startDateFrom || !startDateTo) return
    setCargando(true)

    const pedirUno = async (destino) => {
      setPorDestino((previo) => ({
        ...previo,
        // Se conserva lo que ya había mientras se recarga: si no, la tabla parpadearía en vacío.
        [destino.id]: { ...(previo[destino.id] ?? { ejecuciones: [], agentes: [] }), estado: 'cargando', error: null },
      }))
      try {
        const [tareas, grupos] = await Promise.all([
          cidsCall(destino, 'getAllExecutedTasks2', { startDateFrom, startDateTo }),
          cidsCall(destino, 'getAgents', { activeOnly: false }),
        ])
        setPorDestino((previo) => ({
          ...previo,
          [destino.id]: {
            estado: 'ok',
            ejecuciones: Array.isArray(tareas) ? tareas : [],
            agentes: (Array.isArray(grupos) ? grupos : []).flatMap((grupo) => grupo.agents ?? []),
            error: null,
          },
        }))
      } catch (fallo) {
        setPorDestino((previo) => ({
          ...previo,
          [destino.id]: { estado: 'error', ejecuciones: [], agentes: [], error: fallo.message },
        }))
      }
    }

    // allSettled y no all: un destino que falla no debe cortar los demás.
    await Promise.allSettled(destinos.map(pedirUno))
    setCargando(false)
    setUltimoRefresco(new Date())
    // `destinos` entra por su clave estable: reordenarlos no tiene que disparar una recarga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveDestinos, startDateFrom, startDateTo])

  useEffect(() => {
    const primera = setTimeout(cargar, 0)
    const reloj = setInterval(cargar, REFRESH_MS)
    return () => { clearTimeout(primera); clearInterval(reloj) }
  }, [cargar])

  const hayFiltro = filtrados.size > 0
  const visibles = destinos.filter((uno) => !hayFiltro || filtrados.has(uno.id))
  const conDatos = visibles.filter((uno) => porDestino[uno.id]?.estado === 'ok')

  function alternarFiltro(id) {
    setFiltrados((previos) => {
      const siguientes = new Set(previos)
      if (siguientes.has(id)) siguientes.delete(id)
      else siguientes.add(id)
      return siguientes
    })
    setLaminaActiva(0)
  }

  const global = useMemo(() => {
    // Cada ejecución se queda con el destino del que vino: hace falta para separar la misma tarea de
    // dos repositorios y para decir de dónde salió una fallida.
    const todas = conDatos.flatMap((destino) => (
      porDestino[destino.id].ejecuciones.map((fila) => ({ ...fila, destino }))
    ))

    return {
      todas,
      total: todas.length,
      enEjecucion: todas.filter((fila) => fila.statusCode === 'RUNNING').length,
      enCola: todas.filter((fila) => isQueued(fila.statusCode)).length,
      correctas: todas.filter((fila) => fila.statusCode === 'SUCCESS').length,
      falladas: todas.filter((fila) => isFailed(fila.statusCode)).length,
      conAvisosTotal: todas.filter((fila) => isWarning(fila.statusCode)).length,
      tasaExito: successRate(todas.map((fila) => fila.statusCode)),
      masEjecutadas: topTasks(todas, { claveExtra: (fila) => fila.destino.id }),
      ultimasFalladas: latestFailed(todas),
    }
  }, [conDatos, porDestino])

  // Lámina 0 = todo junto; 1..N = una conexión.
  const lamina = Math.min(laminaActiva, conDatos.length)
  const deLaLamina = lamina === 0
    ? global.todas
    : porDestino[conDatos[lamina - 1]?.id]?.ejecuciones ?? []

  const conError = visibles.filter((uno) => porDestino[uno.id]?.estado === 'error').length

  return (
    <div className="monitor">
      <div className={`progress-line${cargando ? ' on' : ''}`} />

      <div className="monitor-head">
        <div className="monitor-meta">
          {hayFiltro
            ? `${filtrados.size} de ${destinos.length} repositorios · filtro activo · ${global.total} ejecuciones`
            : `${destinos.length} repositorios · ${global.total} ejecuciones`}
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
          <span className="tag tag-muted">Auto {REFRESH_MS / 60000} min</span>
        </div>
      </div>

      {destinos.length > 1 && (
        <div className="filtro-conexiones">
          <span className="filtro-titulo">Filtrar</span>
          <div className="chips">
            {destinos.map((uno) => {
              const activo = !hayFiltro || filtrados.has(uno.id)
              return (
                <button
                  key={uno.id}
                  type="button"
                  className={`chip chip-conexion${activo ? ' active' : ''}`}
                  onClick={() => alternarFiltro(uno.id)}
                  aria-pressed={activo}
                >
                  <ConnectionAvatar name={uno.name} size={16} />
                  {uno.name}
                  <EnvBadge isProduction={uno.production} />
                </button>
              )
            })}
          </div>
          {hayFiltro && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setFiltrados(new Set()); setLaminaActiva(0) }}>
              Limpiar ({filtrados.size})
            </button>
          )}
        </div>
      )}

      {rangoIncompleto && (
        <div className="notice notice-info">
          Elige las dos fechas. Sin rango, CI-DS devuelve todas las ejecuciones que existan en cada
          repositorio.
        </div>
      )}
      {rangoExcedido && (
        <div className="notice notice-error">
          El rango no puede pasar de {MAX_DAYS} días: es el límite de SAP CI-DS. Acortá las fechas.
        </div>
      )}
      {conError > 0 && !cargando && (
        <div className="notice notice-error">
          {conError === 1 ? 'Un repositorio no contestó' : `${conError} repositorios no contestaron`}.
          El detalle está en la tabla de abajo; los números de arriba solo cuentan las que sí.
        </div>
      )}

      <div className="tablero">
        <div className="grid-kpi">
          <Kpi label="Total ejecuciones" valor={global.total} />
          <Kpi label="En ejecución" valor={global.enEjecucion} color="var(--cyan)" />
          <Kpi label="En cola" valor={global.enCola} color="var(--purple)" />
          <Kpi label="Correctas" valor={global.correctas} color="var(--green)" />
          <Kpi label="Falladas" valor={global.falladas} color="var(--red)" />
          <Kpi
            label="Tasa de éxito"
            valor={global.tasaExito === null ? '—' : `${global.tasaExito}%`}
            color={colorDeTasa(global.tasaExito)}
            nota={global.conAvisosTotal > 0 ? 'cuenta también las que terminaron con avisos' : ''}
          />
        </div>

        <div className="card">
          <div className="card-label">
            Estado por repositorio{hayFiltro ? ' · filtrado' : ''}
          </div>
          {visibles.length === 0 ? (
            <div className="sin-datos">Ningún repositorio en el filtro.</div>
          ) : visibles.map((uno) => (
            <FilaDestino
              key={uno.id}
              destino={uno}
              estado={porDestino[uno.id] ?? { estado: 'cargando', ejecuciones: [] }}
            />
          ))}
        </div>

        {global.todas.length > 0 && (
          <>
            <div className="laminas">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setLaminaActiva((n) => Math.max(0, n - 1))}
                disabled={lamina === 0}
                aria-label="Lámina anterior"
              >
                ‹
              </button>
              <div className="laminas-pills">
                <button
                  type="button"
                  className={`chip${lamina === 0 ? ' active' : ''}`}
                  onClick={() => setLaminaActiva(0)}
                  aria-pressed={lamina === 0}
                >
                  Global
                  <span className="chip-count">{global.todas.length}</span>
                </button>
                {conDatos.map((uno, i) => (
                  <button
                    key={uno.id}
                    type="button"
                    className={`chip chip-conexion${lamina === i + 1 ? ' active' : ''}`}
                    onClick={() => setLaminaActiva(i + 1)}
                    aria-pressed={lamina === i + 1}
                  >
                    <ConnectionAvatar name={uno.name} size={16} />
                    {uno.name}
                    <EnvBadge isProduction={uno.production} />
                    <span className="chip-count">{porDestino[uno.id].ejecuciones.length}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setLaminaActiva((n) => Math.min(conDatos.length, n + 1))}
                disabled={lamina === conDatos.length}
                aria-label="Lámina siguiente"
              >
                ›
              </button>
            </div>

            {/* La clave hace que recharts vuelva a animar al cambiar de lámina. Detalle de v9. */}
            <div className="grid-charts" key={lamina}>
              <div className="card">
                <div className="card-label">
                  Distribución por estado · {lamina === 0 ? 'todos' : conDatos[lamina - 1].label}
                </div>
                <StatusDonut porEstado={statusBreakdown(deLaLamina, statusMeta)} />
              </div>
              <div className="card">
                <div className="card-label">Ejecuciones por día</div>
                <PerDayBars porDia={perDayBreakdown(deLaLamina, zona)} />
              </div>
            </div>

            <div className="grid-stats">
              <div className="card">
                <div className="card-label">Tareas más ejecutadas</div>
                {global.masEjecutadas.length === 0 ? <SinDatos /> : global.masEjecutadas.map((tarea, i) => (
                  <div className="ranking" key={tarea.clave}>
                    <div className="ranking-cabeza">
                      <span className="ranking-nombre" title={tarea.taskName}>
                        <span className="ranking-puesto">#{i + 1}</span>
                        {tarea.taskName}
                      </span>
                      <span className="ranking-veces">{tarea.veces}</span>
                    </div>
                    <div className="ranking-donde">
                      <ConnectionAvatar name={tarea.fila.destino.name} size={12} />
                      <span>{tarea.fila.destino.name}</span>
                      <EnvBadge isProduction={tarea.fila.destino.production} />
                    </div>
                    <div className="ranking-barra">
                      <div style={{ width: `${(tarea.veces / global.masEjecutadas[0].veces) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="card">
                <div className="card-label">Últimas falladas</div>
                {global.ultimasFalladas.length === 0
                  ? <div className="todo-bien">✓ Sin fallos en el período</div>
                  : global.ultimasFalladas.map((fila) => (
                    <div className="lista-fila" key={`${fila.destino.id}-${fila.runId}`}>
                      <div className="lista-nombre" style={{ color: 'var(--red)' }} title={fila.taskName || ''}>
                        {fila.taskName || '—'}
                      </div>
                      <div className="ranking-donde">
                        <span>{fila.destino.name}</span>
                        <EnvBadge isProduction={fila.destino.production} />
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function FilaDestino({ destino, estado }) {
  const suyas = estado.ejecuciones ?? []
  const tasa = estado.estado === 'ok' ? successRate(suyas.map((fila) => fila.statusCode)) : null
  const enEjecucion = suyas.filter((fila) => fila.statusCode === 'RUNNING').length
  const falladas = suyas.filter((fila) => isFailed(fila.statusCode)).length
  const avisos = suyas.filter((fila) => isWarning(fila.statusCode)).length

  return (
    <div className="lista-fila fila-conexion">
      <ConnectionAvatar name={destino.name} size={28} />
      <div className="fila-conexion-que">
        <div className="lista-nombre">{destino.name}</div>
        <div className="fila-conexion-tipo">
          {destino.production ? 'Repositorio productivo' : 'Repositorio de pruebas'}
          <EnvBadge isProduction={destino.production} />
        </div>
      </div>

      <EstadoConexion estado={estado} />

      {estado.estado === 'ok' && (
        <div className="mini-stats">
          <span className="mini-total">{suyas.length}</span>
          {enEjecucion > 0 && <span style={{ color: 'var(--cyan)' }}>{enEjecucion} corriendo</span>}
          {avisos > 0 && <span style={{ color: 'var(--accent)' }}>{avisos} con avisos</span>}
          {falladas > 0 && <span style={{ color: 'var(--red)' }}>{falladas} falladas</span>}
          {tasa !== null && <span style={{ color: colorDeTasa(tasa), fontWeight: 700 }}>{tasa}%</span>}
        </div>
      )}
    </div>
  )
}

function EstadoConexion({ estado }) {
  if (estado.estado === 'ok') {
    return (
      <span className="estado-conexion" style={{ color: 'var(--green)' }}>
        <span className="punto" style={{ background: 'var(--green)' }} />
        Bien
      </span>
    )
  }
  if (estado.estado === 'error') {
    return (
      <span className="estado-conexion" style={{ color: 'var(--red)' }} title={estado.error ?? ''}>
        <span className="punto" style={{ background: 'var(--red)' }} />
        {estado.error ?? 'Error'}
      </span>
    )
  }
  return (
    <span className="estado-conexion" style={{ color: 'var(--accent)' }}>
      <span className="punto" style={{ background: 'var(--accent)' }} />
      Cargando…
    </span>
  )
}

function Kpi({ label, valor, color = 'var(--text)', nota = '' }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-valor" style={{ color }}>{valor}</div>
      {/* La nota existe por la tasa de éxito: cuenta más cosas que la tarjeta de «Correctas», y sin
          decirlo los dos números no cuadran a la vista. */}
      {nota && <div className="kpi-nota">{nota}</div>}
    </div>
  )
}
