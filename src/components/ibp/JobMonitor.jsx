// El monitor de Application Jobs: qué corrió en el rango, cómo acabó, y qué hacer con ello.
//
// Portado de `JobMonitor.jsx` de v8. Lo que cambia respecto de aquel:
//
//   - La tabla de estados sale de `core/ibp/job-status.js`, no de una copia local. En v8 estaba
//     escrita tres veces con colores distintos.
//   - El rango y la zona horaria salen de `useDateRange`, el mismo que usa CI-DS.
//   - Cancelar y reiniciar preguntan en un diálogo propio, no con `window.confirm`: v8 usaba el del
//     navegador, que no muestra bien un nombre largo y en algunos navegadores se puede silenciar.
//
// El refresco automático se pausa con la pestaña oculta, igual que en el monitor de CI-DS.

import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  JOB_RESTART_MODES,
  isJobCancelable,
  isJobRestartable,
  jobStatusMeta,
} from '../../../core/ibp/job-status.js'
import { formatSapTimestamp } from '../../lib/dates.js'
import { cancelRun, fetchJobRuns, fetchJobStatuses, nombreDeEjecucion, restartRun } from '../../lib/ibp-jobs.js'
import { useDateRange } from '../../lib/useDateRange.js'
import DateRangeBar from '../ui/DateRangeBar.jsx'
import Modal from '../ui/Modal.jsx'
import JobStepsPanel from './JobStepsPanel.jsx'

/** Cada cuánto se vuelve a preguntar. El de v8, que es un minuto. */
const REFRESCO_MS = 60_000

/** Hasta dónde puede llegar el rango. Más allá, la consulta empieza a doler en el tenant. */
const MAX_DIAS = 90

/** Una ejecución se identifica por su trabajo y su número de corrida. */
const claveDe = (run) => `${run.JobName}|${run.JobRunCount}`

function Estado({ codigo }) {
  const meta = jobStatusMeta(codigo)
  return (
    <span
      className="badge"
      style={{ background: `${meta.color}26`, borderColor: `${meta.color}4d`, color: meta.color }}
    >
      {meta.label}
    </span>
  )
}

export default function JobMonitor({ conexionId }) {
  const { zona, rango, dias, rangoValido, rangoIncompleto, rangoExcedido, startDateFrom, startDateTo, cambiarZona, cambiarRango } = useDateRange({ maxDays: MAX_DIAS })

  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(true)
  const [etiquetas, setEtiquetas] = useState({})

  const [estadoElegido, setEstadoElegido] = useState('TODOS')
  const [texto, setTexto] = useState('')
  const [elegida, setElegida] = useState(null)
  const [pasosDe, setPasosDe] = useState(null)

  const [accion, setAccion] = useState(null)
  const [trabajando, setTrabajando] = useState(false)
  const [aviso, setAviso] = useState(null)

  // Las etiquetas que escribe SAP para cada estado. Es un adorno: si no llega, se usan las nuestras.
  useEffect(() => {
    let abandonado = false
    fetchJobStatuses(conexionId)
      .then((estados) => {
        if (abandonado) return
        setEtiquetas(Object.fromEntries(estados.map((uno) => [uno.JobStatus, uno.JobStatusText || uno.Text])))
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

  // Primera carga y recarga al cambiar el rango. El `setTimeout` a cero saca el `setState` del
  // cuerpo del efecto, que es lo que pide la regla de React.
  useEffect(() => {
    const id = setTimeout(cargar, 0)
    return () => clearTimeout(id)
  }, [cargar])

  // Refresco automático, en pausa mientras la pestaña no se ve: si no, una pestaña olvidada
  // consulta al tenant cada minuto durante horas.
  useEffect(() => {
    const tic = () => { if (!document.hidden) cargar() }
    const id = setInterval(tic, REFRESCO_MS)
    return () => clearInterval(id)
  }, [cargar])

  const runs = useMemo(() => datos?.runs ?? [], [datos])

  const porEstado = useMemo(() => {
    const cuenta = new Map()
    for (const run of runs) cuenta.set(run.JobStatus, (cuenta.get(run.JobStatus) ?? 0) + 1)
    return [...cuenta].sort((a, b) => b[1] - a[1])
  }, [runs])

  const visibles = useMemo(() => {
    const buscado = texto.trim().toLowerCase()
    return runs.filter((run) => {
      if (estadoElegido !== 'TODOS' && run.JobStatus !== estadoElegido) return false
      if (!buscado) return true
      return `${nombreDeEjecucion(run)} ${run.JobTemplateName ?? ''} ${run.JobCreatedByFormattedName ?? ''}`
        .toLowerCase()
        .includes(buscado)
    })
  }, [runs, estadoElegido, texto])

  const seleccionada = runs.find((run) => claveDe(run) === elegida) ?? null

  async function ejecutarAccion(modo) {
    if (!seleccionada) return
    setTrabajando(true)
    setAviso(null)

    const datosDeLaAccion = { jobName: seleccionada.JobName, runCount: seleccionada.JobRunCount }
    try {
      if (accion === 'cancelar') await cancelRun(conexionId, datosDeLaAccion)
      else await restartRun(conexionId, { ...datosDeLaAccion, modo })

      setAviso({ ok: true, texto: accion === 'cancelar' ? 'SAP recibió la orden de detenerla.' : 'SAP la volvió a lanzar.' })
      setAccion(null)
      // SAP tarda un momento en reflejarlo; se recarga igual para no dejar la fila con el estado viejo.
      setTimeout(cargar, 1200)
    } catch (fallo) {
      setAviso({ ok: false, texto: fallo.message })
    } finally {
      setTrabajando(false)
    }
  }

  const etiquetaDe = (codigo) => etiquetas[codigo] || jobStatusMeta(codigo).label

  return (
    <div className="module-body">
      <div className="monitor-bar">
        <DateRangeBar rango={rango} zona={zona} dias={dias} onZona={cambiarZona} onRango={cambiarRango} />
        <input
          className="input input-sm exp-search"
          placeholder="🔍 Buscar por nombre, plantilla o quién la lanzó…"
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
        />
        <button type="button" className="btn btn-sm" onClick={cargar} disabled={!rangoValido}>↺ Refresh</button>
        <span className="auto-refresco">Auto-refresh cada 60s</span>
        <span className="page-hint">
          {cargando ? 'Consultando…' : `${visibles.length} de ${runs.length} ejecuciones`}
        </span>
      </div>

      {rangoIncompleto && <div className="notice notice-info">Elige las dos fechas del rango para consultar.</div>}
      {rangoExcedido && (
        <div className="notice notice-info">
          El rango es de {dias} días y el tope son {MAX_DIAS}. Acortalo para consultar.
        </div>
      )}
      {error && <div className="notice notice-error">✕ {error}</div>}

      {/* Traer 2.000 filas sin filtrar y traer las 40 del rango se parecen desde fuera. */}
      {datos?.aviso && <div className="notice notice-info">{datos.aviso}</div>}

      {porEstado.length > 0 && (
        <div className="chips">
          <button
            type="button"
            className={`chip${estadoElegido === 'TODOS' ? ' active' : ''}`}
            onClick={() => setEstadoElegido('TODOS')}
          >
            Todos <span className="chip-count">{runs.length}</span>
          </button>
          {porEstado.map(([codigo, cuantas]) => {
            const meta = jobStatusMeta(codigo)
            return (
              <button
                key={codigo}
                type="button"
                className={`chip${estadoElegido === codigo ? ' active' : ''}`}
                style={estadoElegido === codigo ? { borderColor: meta.color, color: meta.color } : undefined}
                onClick={() => setEstadoElegido(codigo)}
              >
                {etiquetaDe(codigo)} <span className="chip-count">{cuantas}</span>
              </button>
            )
          })}
        </div>
      )}

      {seleccionada && (
        <div className="action-bar">
          <div className="action-bar-what">
            <div className="action-bar-label">Job seleccionado</div>
            <div className="action-bar-name">
              {nombreDeEjecucion(seleccionada)}
              <span className="mono action-bar-run">{seleccionada.JobRunCount}</span>
            </div>
          </div>

          {aviso && (
            <span className={aviso.ok ? 'action-bar-ok' : 'action-bar-error'}>
              {aviso.ok ? '✓ ' : '✕ '}{aviso.texto}
            </span>
          )}

          <div className="action-bar-buttons">
            <button type="button" className="btn btn-sm" onClick={() => setPasosDe(seleccionada)}>
              📋 Ver pasos
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => { setAccion('reiniciar'); setAviso(null) }}
              disabled={!isJobRestartable(seleccionada.JobStatus)}
              title={isJobRestartable(seleccionada.JobStatus)
                ? 'Volver a lanzarla'
                : `Una ejecución en estado "${jobStatusMeta(seleccionada.JobStatus).label}" todavía no acabó`}
            >
              ↺ Reiniciar job
            </button>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => { setAccion('cancelar'); setAviso(null) }}
              disabled={!isJobCancelable(seleccionada.JobStatus)}
              title={isJobCancelable(seleccionada.JobStatus)
                ? 'Pedirle a SAP que la detenga'
                : `Una ejecución en estado "${jobStatusMeta(seleccionada.JobStatus).label}" ya no se puede cancelar`}
            >
              ✕ Cancelar job
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setElegida(null); setAviso(null) }}>
              Deseleccionar
            </button>
          </div>
        </div>
      )}

      <div className="table-scroll">
        <table className="table-dense">
          <thead>
            <tr>
              <th>Estado</th>
              <th>Descripción</th>
              <th>Template</th>
              <th>Inicio planificado</th>
              <th>Inicio real</th>
              <th>Fin</th>
              <th>Pasos</th>
              <th>Usuario</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((run) => (
              <tr
                key={claveDe(run)}
                className={elegida === claveDe(run) ? 'selected' : undefined}
                onClick={() => setElegida(claveDe(run))}
                tabIndex={0}
                aria-selected={elegida === claveDe(run)}
                onKeyDown={(evento) => {
                  if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); setElegida(claveDe(run)) }
                }}
              >
                <td><Estado codigo={run.JobStatus} /></td>
                <td>
                  {nombreDeEjecucion(run)}
                  {run.Periodic === true && <span className="tag tag-muted">periódica</span>}
                </td>
                <td className="exp-sub">{run.JobTemplateText || run.JobTemplateName || '—'}</td>
                <td>{formatSapTimestamp(run.JobPlannedStartDateTime, zona)}</td>
                <td>{formatSapTimestamp(run.JobStartDateTime, zona)}</td>
                <td>{formatSapTimestamp(run.JobEndDateTime, zona)}</td>
                <td>{run.JobStepCount ?? '—'}</td>
                <td className="exp-sub">{run.JobCreatedByFormattedName || run.JobCreatedBy || '—'}</td>
              </tr>
            ))}
            {visibles.length === 0 && !cargando && (
              <tr><td colSpan={8} className="table-empty">No hay ejecuciones que coincidan.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pasosDe && (
        <JobStepsPanel
          conexionId={conexionId}
          ejecucion={pasosDe}
          zona={zona}
          onClose={() => setPasosDe(null)}
        />
      )}

      {accion === 'cancelar' && seleccionada && (
        <Modal
          title="Detener la ejecución"
          subtitle={nombreDeEjecucion(seleccionada)}
          onClose={() => setAccion(null)}
          footer={
            <>
              <button type="button" className="btn btn-sm" onClick={() => setAccion(null)}>No</button>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => ejecutarAccion()} disabled={trabajando}>
                {trabajando ? 'Deteniendo…' : 'Sí, detenerla'}
              </button>
            </>
          }
        >
          <p>
            Se le pide a SAP que detenga esta ejecución. Lo que ya se haya cargado no se deshace: los
            pasos que terminaron dejan sus datos en IBP.
          </p>
        </Modal>
      )}

      {accion === 'reiniciar' && seleccionada && (
        <Modal
          title="Volver a lanzarla"
          subtitle={nombreDeEjecucion(seleccionada)}
          onClose={() => setAccion(null)}
          footer={<button type="button" className="btn btn-sm" onClick={() => setAccion(null)}>Cancelar</button>}
        >
          <p>Elige desde dónde:</p>
          <div className="job-modos">
            {JOB_RESTART_MODES.map((modo) => (
              <button
                key={modo.value}
                type="button"
                className="job-modo"
                onClick={() => ejecutarAccion(modo.value)}
                disabled={trabajando}
              >
                <span className="job-modo-label">{modo.label}</span>
                <span className="job-modo-desc">{modo.description}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  )
}
