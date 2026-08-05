// El monitor de ejecuciones de CI-DS.
//
// Portado de `src/components/Tasks/TaskMonitor.jsx` de v9. Lo que cambia respecto de allí:
//
//   - La tabla de estados con sus colores se importa de la capa transversal en vez de estar
//     copiada aquí. Era la razón de ser de `core/cids/task-status.js`.
//   - El fin y la duración los junta el servidor por tandas, no el navegador fila por fila.
//   - El rango de fechas se exige completo y se aplica cuando dejás de escribir. En v9 un campo
//     de fecha a medio escribir salía como consulta sin rango, y CI-DS sin rango devuelve el
//     histórico completo del tenant.
//   - Los estilos son clases del sistema de la aplicación, no estilos incrustados.
//
// Lo que NO cambia: qué se le pide a SAP, cuántas consultas van a la vez, qué se guarda y qué se
// vuelve a preguntar en cada refresco.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
// Se importa el archivo suelto y no `core/cids/index.js` a propósito: el índice arrastra la
// sesión, y con ella Redis y el cifrado, que no tienen nada que hacer en el navegador. Esto es
// una tabla de datos sin dependencias.
import { formatDuration, isCancelable, isTerminal, statusMeta } from '../../../core/cids/task-status.js'
import { cidsCall, fetchTaskDetails } from '../../lib/cids.js'
import { copyText } from '../../lib/clipboard.js'
import { toTsv } from '../../lib/tsv.js'
import Modal from '../ui/Modal.jsx'
import TaskLogsModal from './TaskLogsModal.jsx'
import {
  TZ_OPTIONS,
  daysBetween,
  formatEpochMs,
  formatSapTimestamp,
  fromInputValue,
  readStoredTzMode,
  storeTzMode,
  toInputValue,
} from '../../lib/dates.js'

/** Cada cuánto se vuelve a pedir la lista. De v9. */
const REFRESH_MS = 30_000

/** Cuánto se espera sin tocar las fechas antes de consultar con el rango nuevo. */
const APLICAR_MS = 500

/** Filas por página. De v9: es también cuántas ejecuciones se enriquecen de una vez. */
const PAGE_SIZE = 50

/**
 * Tope del rango de fechas, en días. Límite de SAP CI-DS, codificado en v9.
 * Pedir más devuelve un error del servicio, así que se impide antes de salir.
 */
const MAX_DAYS = 90

/** Zonas que se ofrecen. La del equipo queda fuera del selector, igual que en v9. */
const ZONAS = TZ_OPTIONS.filter((opcion) => opcion.value !== 'local')

const DIA_MS = 86_400_000

/** Rango de arranque: la última semana, que es con lo que abría v9. */
const rangoInicial = (zona) => ({
  desde: toInputValue(new Date(Date.now() - 7 * DIA_MS), zona),
  hasta: toInputValue(new Date(), zona),
})

/**
 * La búsqueda llega de arriba (`busqueda` / `onBuscar`) en vez de vivir aquí. Es lo que permite que
 * al lanzar una tarea se salte al monitor ya filtrado por ella sin que este componente sepa que el
 * lanzador existe, y sin un efecto que copie una prop al estado.
 */
export default function TaskMonitor({ connectionId, busqueda, onBuscar }) {
  const [zona, setZona] = useState(readStoredTzMode)
  // Lo que se escribe en los campos.
  const [rango, setRango] = useState(() => rangoInicial(readStoredTzMode()))
  // Lo que se está consultando. No es lo mismo: ver más abajo por qué.
  const [rangoActivo, setRangoActivo] = useState(rango)

  const [ejecuciones, setEjecuciones] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [ultimoRefresco, setUltimoRefresco] = useState(null)

  const [estadoActivo, setEstadoActivo] = useState('TODOS')
  const [pagina, setPagina] = useState(1)

  const [detalles, setDetalles] = useState({})
  const [cargandoDetalles, setCargandoDetalles] = useState(false)

  // De la fila elegida se guarda el identificador, no la fila: al refrescar llegan objetos nuevos,
  // y si una ejecución desaparece del rango la selección se suelta sola en vez de quedar apuntando
  // a algo que ya no está en la tabla.
  const [runElegido, setRunElegido] = useState(null)
  // El visor de registros se queda con una copia de la ejecución, no con la fila viva: leer un
  // registro de error largo lleva su tiempo y el diálogo no debe cerrarse solo porque la lista se
  // refrescó por detrás.
  const [registrosDe, setRegistrosDe] = useState(null)
  const [confirmarCancelar, setConfirmarCancelar] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const [avisoCancelar, setAvisoCancelar] = useState(null)
  const [copiado, setCopiado] = useState(null)

  // Lo ya consultado se lee DENTRO del efecto que consulta, no al pintar, así que va por
  // referencia y no como dependencia. Si fuera dependencia, cada respuesta volvería a disparar
  // el efecto y las ejecuciones vivas —que sí hay que volver a preguntar— entrarían en bucle.
  const detallesRef = useRef(detalles)
  useEffect(() => { detallesRef.current = detalles }, [detalles])

  const dias = daysBetween(rango.desde, rango.hasta, zona)
  const rangoIncompleto = dias === null
  const rangoExcedido = dias !== null && dias > MAX_DAYS
  const rangoValido = !rangoIncompleto && !rangoExcedido

  // Al cambiar de zona, los campos tienen que seguir apuntando al mismo instante: lo que se
  // mueve es cómo se escribe, no qué se pidió. Por eso cambiar de zona no vuelve a consultar.
  function cambiarZona(nueva) {
    const desde = fromInputValue(rango.desde, zona)
    const hasta = fromInputValue(rango.hasta, zona)
    const escrito = {
      desde: desde ? toInputValue(desde, nueva) : rango.desde,
      hasta: hasta ? toInputValue(hasta, nueva) : rango.hasta,
    }
    setRango(escrito)
    setRangoActivo(escrito)
    setZona(nueva)
    storeTzMode(nueva)
  }

  // Al mover una punta más allá del tope, se arrastra la otra en vez de dejar un rango inválido
  // y un mensaje de error. Es lo que hacía v9.
  function cambiarRango(punta, valor) {
    setPagina(1)
    setRango((actual) => {
      const escrito = { ...actual, [punta]: valor }
      const nuevoDias = daysBetween(escrito.desde, escrito.hasta, zona)
      if (nuevoDias === null || nuevoDias <= MAX_DAYS) return escrito

      // La punta que se acaba de mover manda; la otra se acerca hasta el tope.
      const movida = fromInputValue(valor, zona)
      return punta === 'desde'
        ? { desde: valor, hasta: toInputValue(new Date(movida.getTime() + MAX_DAYS * DIA_MS), zona) }
        : { desde: toInputValue(new Date(movida.getTime() - MAX_DAYS * DIA_MS), zona), hasta: valor }
    })
  }

  // El rango se aplica cuando pasa un momento sin tocarlo.
  //
  // Un campo de fecha va emitiendo lo que se escribe, incluido el instante en que queda vacío.
  // Consultar en cada uno de esos pasos serían tres o cuatro consultas de varios segundos, y la
  // del campo vacío sería la peor de todas: sin rango, CI-DS devuelve el histórico completo.
  //
  // En el montaje el valor es el mismo objeto, así que React no repinta y la primera carga sale
  // en el acto: el retardo es solo para los cambios.
  useEffect(() => {
    if (!rangoValido) return undefined
    const espera = setTimeout(() => setRangoActivo(rango), APLICAR_MS)
    return () => clearTimeout(espera)
  }, [rango, rangoValido])

  // Las dos puntas ya en UTC, que es lo que entiende SAP. Se sacan aparte para que la carga
  // dependa de los textos que se le mandan y no del objeto: así cambiar de zona, que no cambia
  // el instante, no vuelve a consultar.
  const { startDateFrom, startDateTo } = useMemo(() => {
    const desde = fromInputValue(rangoActivo.desde, zona)
    const hasta = fromInputValue(rangoActivo.hasta, zona)
    if (!desde || !hasta) return {}
    // El extremo se estira al final del minuto elegido: si no, una ejecución que arrancó a las
    // 12:30:40 queda fuera de un rango que termina a las 12:30.
    hasta.setSeconds(59, 999)
    return { startDateFrom: desde.toISOString(), startDateTo: hasta.toISOString() }
  }, [rangoActivo, zona])

  const cargar = useCallback(async () => {
    // Sin las dos puntas no se consulta. No es una validación de formulario: CI-DS sin rango
    // devuelve todas las ejecuciones que existan en el tenant.
    if (!startDateFrom || !startDateTo) return
    setCargando(true)
    setError('')
    try {
      const filas = await cidsCall(connectionId, 'getAllExecutedTasks2', { startDateFrom, startDateTo })
      setEjecuciones(Array.isArray(filas) ? filas : [])
      setUltimoRefresco(new Date())
    } catch (fallo) {
      setError(fallo.message)
    } finally {
      setCargando(false)
    }
  }, [connectionId, startDateFrom, startDateTo])

  // La lista la trae un reloj: la primera vuelta sale enseguida y después cada REFRESH_MS. Va por
  // temporizador y no llamando a `cargar` aquí mismo porque el efecto no debe cambiar el estado
  // en el acto — encadena repintados. Con el temporizador, quien lo cambia es el reloj.
  useEffect(() => {
    const primera = setTimeout(cargar, 0)
    const reloj = setInterval(cargar, REFRESH_MS)
    return () => { clearTimeout(primera); clearInterval(reloj) }
  }, [cargar])

  const ordenadas = useMemo(
    () => [...ejecuciones].sort((a, b) => (Number.parseInt(b.startDate, 10) || 0) - (Number.parseInt(a.startDate, 10) || 0)),
    [ejecuciones],
  )

  // El buscador mira también la etiqueta en español, no solo el código de SAP: es lo que la
  // persona tiene delante en la pantalla.
  const buscadas = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()
    if (!texto) return ordenadas
    return ordenadas.filter((fila) => (
      (fila.taskName || '').toLowerCase().includes(texto)
      || (fila.statusCode || '').toLowerCase().includes(texto)
      || statusMeta(fila.statusCode).label.toLowerCase().includes(texto)
      || String(fila.runId || '').includes(texto)
      || String(fila.jobId || '').includes(texto)
    ))
  }, [ordenadas, busqueda])

  const porEstado = useMemo(() => {
    const cuenta = new Map()
    for (const fila of buscadas) {
      if (fila.statusCode) cuenta.set(fila.statusCode, (cuenta.get(fila.statusCode) ?? 0) + 1)
    }
    return [...cuenta.entries()]
  }, [buscadas])

  const filtradas = useMemo(
    () => (estadoActivo === 'TODOS' ? buscadas : buscadas.filter((fila) => fila.statusCode === estadoActivo)),
    [buscadas, estadoActivo],
  )

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / PAGE_SIZE))

  // La página se acota al pintar, no corrigiendo el estado: al refrescar puede haber menos
  // ejecuciones y la página donde estabas dejar de existir. Así se muestra la última que sí
  // existe, sin un repintado de más ni un salto raro.
  const paginaVisible = Math.min(pagina, totalPaginas)
  const enPagina = useMemo(
    () => filtradas.slice((paginaVisible - 1) * PAGE_SIZE, paginaVisible * PAGE_SIZE),
    [filtradas, paginaVisible],
  )

  // Fin y duración: solo de las filas que se están viendo, y solo de las que hace falta.
  //
  // Un estado terminal ya no cambia, así que una vez consultado se guarda y no se vuelve a
  // preguntar. Los que siguen vivos se consultan en cada refresco, porque su duración crece.
  const clavePagina = enPagina.map((fila) => fila.runId).join(',')
  useEffect(() => {
    const pendientes = enPagina
      .filter((fila) => fila.runId && (!detallesRef.current[fila.runId] || !isTerminal(fila.statusCode)))
      .map((fila) => fila.runId)
    if (pendientes.length === 0) return undefined

    let abandonado = false
    setCargandoDetalles(true)
    fetchTaskDetails(connectionId, pendientes, { shouldStop: () => abandonado })
      .then((nuevos) => { if (!abandonado) setDetalles((previos) => ({ ...previos, ...nuevos })) })
      .catch(() => {
        // No se pinta como error de pantalla: la lista está bien y solo faltan dos columnas. Si
        // el problema es de la conexión, el propio refresco de la lista lo va a contar.
      })
      .finally(() => { if (!abandonado) setCargandoDetalles(false) })

    return () => { abandonado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clavePagina, connectionId, ultimoRefresco])

  const elegida = runElegido ? ejecuciones.find((fila) => fila.runId === runElegido) ?? null : null
  const sePuedeCancelar = elegida !== null && isCancelable(elegida.statusCode)

  function elegir(fila) {
    setRunElegido((actual) => (actual === fila.runId ? null : fila.runId))
    setAvisoCancelar(null)
  }

  async function cancelar() {
    setConfirmarCancelar(false)
    setCancelando(true)
    setAvisoCancelar(null)
    try {
      const respuesta = await cidsCall(connectionId, 'cancelTask', { runId: elegida.runId })
      // Se muestra lo que contestó SAP si contestó algo: es más útil que un mensaje nuestro, y no
      // afirma nada sobre cuándo se detiene de verdad, que eso lo decide el tenant.
      setAvisoCancelar({ ok: true, texto: respuesta?.message || 'Cancelación enviada.' })
      await cargar()
    } catch (fallo) {
      setAvisoCancelar({ ok: false, texto: fallo.message })
    } finally {
      setCancelando(false)
    }
  }

  async function copiarPagina() {
    const filas = [
      ['Estado', 'Tarea', 'Inicio', 'Fin', 'Duración', 'RunID', 'JobID'],
      ...enPagina.map((fila) => {
        const detalle = detalles[fila.runId]
        return [
          statusMeta(fila.statusCode).label,
          fila.taskName,
          formatEpochMs(fila.startDate, zona),
          textoFin(detalle, zona),
          detalle ? formatDuration(detalle.durationSeconds) : '',
          fila.runId,
          fila.jobId,
        ]
      }),
    ]
    const pudo = await copyText(toTsv(filas))
    setCopiado(pudo ? 'ok' : 'error')
    setTimeout(() => setCopiado(null), 1500)
  }

  return (
    <div className="monitor">
      <div className={`progress-line${cargando || cargandoDetalles ? ' on' : ''}`} />

      <div className="monitor-head">
        <div className="monitor-meta">
          {cargando && ejecuciones.length === 0
            ? 'Cargando…'
            : `${filtradas.length} de ${ejecuciones.length} ejecuciones · página ${paginaVisible} de ${totalPaginas}`}
          {cargandoDetalles && <span className="live"><span className="sep">·</span>cargando fin y duración…</span>}
          {ultimoRefresco && !cargando && !cargandoDetalles && (
            <span><span className="sep">·</span>{ultimoRefresco.toLocaleTimeString()}</span>
          )}
        </div>

        <div className="monitor-bar">
          <div className="seg" role="group" aria-label="Zona horaria">
            {ZONAS.map((opcion) => (
              <button
                key={opcion.value}
                type="button"
                className={`seg-btn${zona === opcion.value ? ' active' : ''}`}
                onClick={() => cambiarZona(opcion.value)}
                aria-pressed={zona === opcion.value}
              >
                {opcion.label}
              </button>
            ))}
          </div>

          <input
            type="datetime-local"
            className="input input-sm"
            value={rango.desde}
            onChange={(evento) => cambiarRango('desde', evento.target.value)}
            aria-label="Desde"
          />
          <span className="arrow" aria-hidden="true">→</span>
          <input
            type="datetime-local"
            className="input input-sm"
            value={rango.hasta}
            onChange={(evento) => cambiarRango('hasta', evento.target.value)}
            aria-label="Hasta"
          />
          {dias !== null && <span className="tag tag-muted">{dias} d</span>}

          <input
            type="search"
            className="input input-sm"
            style={{ width: 170 }}
            placeholder="Buscar…"
            value={busqueda}
            onChange={(evento) => { onBuscar(evento.target.value); setPagina(1) }}
            aria-label="Buscar"
          />
          {/* Copiar con las columnas a medio cargar daría una tabla con huecos que parecen datos
              vacíos, así que se espera a que terminen. Es lo que hacía v9. */}
          <button
            type="button"
            className="btn btn-sm"
            onClick={copiarPagina}
            disabled={enPagina.length === 0 || cargandoDetalles}
            title={cargandoDetalles ? 'Esperá a que terminen de cargar el fin y la duración' : 'Copiar esta página para pegarla en Excel'}
          >
            {copiado === 'ok' ? '✓ Copiado' : copiado === 'error' ? '✕ No se pudo' : '⧉ Copiar'}
          </button>
          <button type="button" className="btn btn-sm" onClick={cargar} disabled={cargando || !rangoValido}>
            ↺ Actualizar
          </button>
          <span className="tag tag-muted" title={`Se actualiza sola cada ${REFRESH_MS / 1000} segundos`}>
            Auto {REFRESH_MS / 1000}s
          </span>
        </div>
      </div>

      <div className="chips">
        <Chip
          activo={estadoActivo === 'TODOS'}
          onClick={() => { setEstadoActivo('TODOS'); setPagina(1) }}
          etiqueta="Todos"
          cuenta={buscadas.length}
        />
        {porEstado.map(([codigo, cuenta]) => (
          <Chip
            key={codigo}
            activo={estadoActivo === codigo}
            onClick={() => { setEstadoActivo(codigo); setPagina(1) }}
            etiqueta={statusMeta(codigo).label}
            color={statusMeta(codigo).color}
            cuenta={cuenta}
          />
        ))}
      </div>

      {rangoIncompleto && (
        <div className="notice notice-info">
          Elegí las dos fechas. Sin rango, CI-DS devuelve todas las ejecuciones que existan en el
          tenant, y eso ni se puede mostrar ni conviene pedirlo.
        </div>
      )}
      {rangoExcedido && (
        <div className="notice notice-error">
          El rango no puede pasar de {MAX_DAYS} días: es el límite de SAP CI-DS. Acortá las fechas.
        </div>
      )}
      {error && <div className="notice notice-error">✕ {error}</div>}

      <div className="table-scroll">
        <table className="table-dense">
          <colgroup>
            <col style={{ width: 190 }} />
            <col style={{ width: 280 }} />
            <col style={{ width: 170 }} />
            <col style={{ width: 170 }} />
            <col style={{ width: 105 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 150 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Estado</th>
              <th>Tarea</th>
              <th>Inicio</th>
              <th>Fin</th>
              <th>Duración</th>
              <th>RunID</th>
              <th>JobID</th>
            </tr>
          </thead>
          <tbody>
            {cargando && ejecuciones.length === 0 ? (
              <tr><td className="table-empty" colSpan={7}>Cargando…</td></tr>
            ) : enPagina.length === 0 ? (
              <tr><td className="table-empty" colSpan={7}>Ninguna ejecución en este rango.</td></tr>
            ) : enPagina.map((fila, indice) => (
              <Fila
                key={fila.runId || indice}
                fila={fila}
                detalle={detalles[fila.runId]}
                zona={zona}
                elegida={fila.runId === runElegido}
                onElegir={() => elegir(fila)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {totalPaginas > 1 && (
        <div className="pager">
          <button type="button" className="btn btn-sm" disabled={paginaVisible === 1} onClick={() => setPagina(1)}>« Primera</button>
          <button type="button" className="btn btn-sm" disabled={paginaVisible === 1} onClick={() => setPagina(paginaVisible - 1)}>‹ Anterior</button>
          <span className="pager-info">Página <b>{paginaVisible}</b> de {totalPaginas}</span>
          <button type="button" className="btn btn-sm" disabled={paginaVisible === totalPaginas} onClick={() => setPagina(paginaVisible + 1)}>Siguiente ›</button>
          <button type="button" className="btn btn-sm" disabled={paginaVisible === totalPaginas} onClick={() => setPagina(totalPaginas)}>Última »</button>
        </div>
      )}

      {elegida && (
        <div className="action-bar">
          <div className="action-bar-what">
            <div className="action-bar-label">Ejecución elegida</div>
            <div className="action-bar-name">
              {elegida.taskName ?? '—'}
              <span className="mono action-bar-run">RunID {elegida.runId}</span>
            </div>
          </div>

          {avisoCancelar && (
            <span className={avisoCancelar.ok ? 'action-bar-ok' : 'action-bar-error'}>
              {avisoCancelar.ok ? '✓ ' : '✕ '}{avisoCancelar.texto}
            </span>
          )}

          <div className="action-bar-buttons">
            <button type="button" className="btn btn-sm" onClick={() => setRegistrosDe(elegida)}>
              📋 Ver registros
            </button>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => setConfirmarCancelar(true)}
              disabled={!sePuedeCancelar || cancelando}
              title={sePuedeCancelar
                ? 'Pedirle a CI-DS que detenga esta ejecución'
                : `Una ejecución en estado "${statusMeta(elegida.statusCode).label}" ya no se puede cancelar`}
            >
              {cancelando ? 'Cancelando…' : '✕ Cancelar'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRunElegido(null); setAvisoCancelar(null) }}>
              Deseleccionar
            </button>
          </div>
        </div>
      )}

      {registrosDe && (
        <TaskLogsModal connectionId={connectionId} run={registrosDe} onClose={() => setRegistrosDe(null)} />
      )}

      {confirmarCancelar && elegida && (
        <Modal
          title="Cancelar la ejecución"
          subtitle={`RunID ${elegida.runId}`}
          onClose={() => setConfirmarCancelar(false)}
          footer={
            <>
              <div className="modal-foot-info" />
              <button type="button" className="btn btn-sm" onClick={() => setConfirmarCancelar(false)}>No, dejarla</button>
              <button type="button" className="btn btn-sm btn-primary" onClick={cancelar}>Sí, cancelar</button>
            </>
          }
        >
          <p>
            Se le va a pedir a CI-DS que detenga <b>{elegida.taskName ?? 'esta tarea'}</b>, que ahora
            está en estado <b>{statusMeta(elegida.statusCode).label}</b>.
          </p>
          <p className="page-hint" style={{ marginTop: 10 }}>
            Lo que ya haya cargado en el sistema de destino no se deshace: cancelar detiene la
            ejecución, no revierte lo hecho.
          </p>
        </Modal>
      )}
    </div>
  )
}

/**
 * El mismo texto que muestra la columna "Fin", sin marcado, para pegar en una hoja de cálculo.
 * Allí no se distingue "todavía no se preguntó" de "la consulta falló" —las dos quedan en blanco—
 * porque una celda vacía en Excel ya se lee como "sin dato".
 */
function textoFin(detalle, zona) {
  if (!detalle || detalle.failed) return ''
  if (!detalle.endTime) return 'En curso'
  return formatSapTimestamp(detalle.endTime, zona)
}

function Fila({ fila, detalle, zona, elegida, onElegir }) {
  return (
    <tr
      className={elegida ? 'selected' : undefined}
      onClick={onElegir}
      // Con el teclado la fila se elige igual: es lo que habilita ver registros y cancelar.
      tabIndex={0}
      onKeyDown={(evento) => {
        if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); onElegir() }
      }}
      aria-selected={elegida}
    >
      <td><StatusBadge codigo={fila.statusCode} /></td>
      <td title={fila.taskName || ''}>{fila.taskName || '—'}</td>
      <td>{formatEpochMs(fila.startDate, zona)}</td>
      <td><Fin detalle={detalle} zona={zona} /></td>
      <td>{detalle ? formatDuration(detalle.durationSeconds) : <span className="muted">…</span>}</td>
      <td className="mono">{fila.runId || '—'}</td>
      <td className="mono">{fila.jobId || '—'}</td>
    </tr>
  )
}

/**
 * Tres situaciones distintas que v9 mezclaba en dos: todavía no se preguntó, la ejecución sigue
 * en curso, y la consulta del fin falló. La última salía como "En curso", que era engañoso.
 */
function Fin({ detalle, zona }) {
  if (!detalle) return <span className="muted">…</span>
  if (detalle.failed) return <span className="muted" title="No se pudo consultar el fin de esta ejecución">—</span>
  if (!detalle.endTime) return <span className="running">En curso</span>
  return formatSapTimestamp(detalle.endTime, zona)
}

function StatusBadge({ codigo }) {
  const { label, color } = statusMeta(codigo)
  return (
    <span
      className="status-badge"
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
      }}
    >
      {label}
    </span>
  )
}

function Chip({ activo, onClick, etiqueta, cuenta, color }) {
  const pintado = activo && color
    ? { color, borderColor: `color-mix(in srgb, ${color} 40%, transparent)`, background: `color-mix(in srgb, ${color} 14%, transparent)` }
    : undefined
  return (
    <button type="button" className={`chip${activo ? ' active' : ''}`} onClick={onClick} style={pintado} aria-pressed={activo}>
      {etiqueta}
      <span className="chip-count">{cuenta}</span>
    </button>
  )
}
