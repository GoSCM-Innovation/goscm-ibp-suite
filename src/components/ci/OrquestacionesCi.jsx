// Las orquestaciones de una conexión de CI Tools: la lista plegable a la izquierda y, a la derecha, el editor o la ejecución.
// Es la pantalla del orquestador de IBP Tools (v8) con las integraciones de CI Tools en lugar de los Application Jobs:
// «+ Nueva orquestación», la lista con «N pasos · fecha» y ⧉ / ✕ en cada fila, las ventanas de crear y eliminar, y el
// cambio entre lista y editor en el teléfono.
//
// La ejecución vive AQUÍ y no en el editor: con una orquestación en marcha no se puede abrir otra ni crear o borrar (como en
// IBP), y la pantalla que la empuja tiene que seguir montada aunque se mire otra cosa. La lista de integraciones (lo que se
// puede agregar a un paso) se vuelve a pedir cada vez que se entra a esta pestaña: las integraciones se crean en otra, y la
// lista que se leyó al abrir quedaría vieja.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { listIntegraciones } from '../../lib/ci.js'
import { esDeLaMismaVersion, pasosDeGrafo } from '../../lib/ci-pasos.js'
import { useGuardaDeSalida } from '../../lib/guarda-de-salida.js'
import {
  createOrchestration,
  deleteOrchestration,
  duplicateOrchestration,
  listOrchestrations,
} from '../../lib/orchestrations.js'
import { useIsMobile } from '../../lib/useIsMobile.js'
import BotonActualizar from '../ui/BotonActualizar.jsx'
import Modal from '../ui/Modal.jsx'
import ConstructorDeOrquestacion from './ConstructorDeOrquestacion.jsx'
import { useCiRun } from './useCiRun.js'
import VistaDeEjecucion from './VistaDeEjecucion.jsx'

const MENSAJE_AL_SALIR = 'Hay una orquestación en marcha. Si sales, deja de avanzar hasta que vuelvas y pulses «Retomar»: '
  + 'lo que ya se cargó no se repite, pero una carga que esté esperando a CPI queda sin confirmar.'

/** La fecha de una fila de la lista, como en IBP: día, mes abreviado y año de dos cifras. */
function fechaDeFila(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: '2-digit' })
}

export default function OrquestacionesCi({ connection, visible = true }) {
  // Una orquestación apunta a UN destino: la conexión y, en CI, su marca de productiva. Los dos ambientes de una
  // conexión de IBP son direcciones distintas; en CI cada ambiente es una conexión, así que la marca es la de ella.
  const destino = { connectionId: connection.id, production: Boolean(connection.isProduction) }
  const movil = useIsMobile()

  const [orquestaciones, setOrquestaciones] = useState(null)
  const [integraciones, setIntegraciones] = useState([])
  const [elegida, setElegida] = useState(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const [plegada, setPlegada] = useState(false)
  const [pantallaCompleta, setPantallaCompleta] = useState(false)
  // Si se ve la ejecución en lugar del editor: al lanzarla, con «Última ejecución» o cuando hay una en marcha, y se quita
  // con «← Volver al editor».
  const [verEjecucion, setVerEjecucion] = useState(false)
  const [vistaMovil, setVistaMovil] = useState('lista')
  const [creando, setCreando] = useState(false)
  const [nombreNuevo, setNombreNuevo] = useState('')
  const [aBorrar, setABorrar] = useState(null)

  // Cada vez que se muestra la pestaña (o se pide actualizar) se vuelve a leer todo. El efecto solo lanza la
  // petición: el estado se toca al volver la respuesta, que es lo que pide la regla de efectos de React.
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!visible) return undefined
    let vivo = true
    Promise.all([
      listOrchestrations({ connectionId: connection.id, production: Boolean(connection.isProduction) }),
      listIntegraciones(connection.id),
    ])
      .then(([lista, integ]) => {
        if (!vivo) return
        setOrquestaciones(lista)
        setIntegraciones(integ)
        setError('')
      })
      .catch((fallo) => { if (vivo) { setError(fallo.message); setOrquestaciones((previas) => previas ?? []) } })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [visible, version, connection.id, connection.isProduction])

  function cargar() {
    setCargando(true)
    setVersion((v) => v + 1)
  }

  const abierta = (orquestaciones ?? []).find((una) => una.id === elegida) ?? null
  const ejecucion = useCiRun(abierta?.id ?? null, abierta?.name ?? '')
  const { run } = ejecucion
  const bloqueada = ejecucion.enMarcha
  useGuardaDeSalida(ejecucion.enMarcha, MENSAJE_AL_SALIR)
  // Una ejecución en marcha se ve siempre, y al terminar su resultado se queda a la vista hasta que se pida volver al editor:
  // sin esto, una que se abrió ya en marcha (lanzada antes, o desde otra pestaña) desaparecería al acabar.
  if (ejecucion.enMarcha && !verEjecucion) setVerEjecucion(true)

  const porId = useMemo(() => new Map(integraciones.map((una) => [una.id, una])), [integraciones])
  const pasosDeAbierta = useMemo(() => (abierta ? pasosDeGrafo(abierta).pasos : []), [abierta])

  const mostrarEjecucion = Boolean(abierta) && Boolean(run) && (ejecucion.enMarcha || verEjecucion)
  const enPantallaCompleta = pantallaCompleta && Boolean(abierta) && !mostrarEjecucion
  // Retomar sigue una ejecución concreta: solo tiene sentido si la orquestación tiene los MISMOS pasos que cuando se lanzó.
  const mismaVersion = esDeLaMismaVersion(abierta?.nodes, run)
  const puedeRetomar = Boolean(run) && !ejecucion.enMarcha && mismaVersion && (run.status === 'error' || run.status === 'cancelled')

  function seleccionar(id) {
    if (bloqueada) return
    setElegida(id)
    setVerEjecucion(false)
    setVistaMovil(id ? 'editor' : 'lista')
    if (!id) setPantallaCompleta(false)
  }

  function abrir(una) {
    if (una.id === elegida) { setVistaMovil('editor'); return }
    seleccionar(una.id)
  }

  function empezarACrear() {
    if (bloqueada) return
    setNombreNuevo('')
    setCreando(true)
  }

  async function confirmarCreacion() {
    const nombre = nombreNuevo.trim()
    if (!nombre) return
    setCreando(false)
    try {
      const nueva = await createOrchestration(destino, nombre)
      setOrquestaciones((previas) => [...(previas ?? []), nueva])
      seleccionar(nueva.id)
    } catch (fallo) {
      setError(fallo.message)
    }
  }

  async function duplicar(id) {
    try {
      const copia = await duplicateOrchestration(id)
      setOrquestaciones((previas) => [...(previas ?? []), copia])
      seleccionar(copia.id)
    } catch (fallo) {
      setError(fallo.message)
    }
  }

  async function confirmarBorrado() {
    const una = aBorrar
    setABorrar(null)
    try {
      await deleteOrchestration(una.id)
      setOrquestaciones((previas) => (previas ?? []).filter((otra) => otra.id !== una.id))
      if (elegida === una.id) seleccionar(null)
    } catch (fallo) {
      // Lo más probable: tiene una ejecución en marcha (409). El mensaje lo dice.
      setError(fallo.message)
    }
  }

  /** Una orquestación se guardó sola: se actualiza su copia en la lista. */
  const alGuardar = useCallback((guardada) => {
    setOrquestaciones((previas) => (previas ?? []).map((una) => (una.id === guardada.id ? guardada : una)))
  }, [])

  /** Lanza la orquestación con los valores confirmados. Lanza si el servidor no deja: el diálogo enseña el motivo. */
  async function arrancar(variables) {
    const resultado = await ejecucion.arrancar(variables)
    setVerEjecucion(true)
    return resultado
  }

  function retomar() {
    const enDuda = Object.values(run?.nodes ?? {}).some((paso) => (
      paso.detalle?.sinConfirmar || Object.values(paso.children ?? {}).some((hijo) => hijo.detalle?.sinConfirmar)
    ))
    const pregunta = enDuda
      ? 'Hay pasos SIN CONFIRMAR: se enviaron y no se sabe si la carga entró. Retomar los enviará otra vez. '
        + '¿Ya lo revisaste en Cloud Integration y quieres retomar?'
      : 'Se retoma desde donde falló. Lo que ya salió bien no se repite. ¿Continuar?'
    if (window.confirm(pregunta)) ejecucion.retomar().catch(() => {})
  }

  function cancelar() {
    if (window.confirm('Se cancela la orquestación. Lo que ya se envió a CPI sigue su curso: cancelar detiene lo que falta, no deshace lo cargado. ¿Cancelar?')) {
      ejecucion.cortar().catch(() => {})
    }
  }

  if (orquestaciones === null) return <div className="page-hint ci-cargando">Cargando orquestaciones…</div>

  const verLista = !movil || vistaMovil === 'lista'
  const verPanel = !movil || vistaMovil === 'editor'
  const listaPlegada = plegada && !movil

  return (
    <div className="ci-orq">
      {/* ── La lista de la izquierda ── */}
      {verLista && (
        <aside className={`ci-orq-lista${listaPlegada ? ' plegada' : ''}`} aria-label="Orquestaciones">
          <div className="ci-orq-lista-cabeza">
            {!listaPlegada && <div className="ci-orq-titulo">Orquestaciones</div>}
            <div className="ci-orq-lista-botones">
              {!listaPlegada && (
                <BotonActualizar className="ci-orq-mini" etiqueta="" title="Actualizar" onClick={cargar} cargando={cargando} />
              )}
              {!movil && (
                <button
                  type="button"
                  className="ci-orq-mini"
                  onClick={() => setPlegada((valor) => !valor)}
                  title={plegada ? 'Expandir panel' : 'Colapsar panel'}
                  aria-label={plegada ? 'Expandir el panel de orquestaciones' : 'Colapsar el panel de orquestaciones'}
                >
                  {plegada ? '▶' : '◀'}
                </button>
              )}
            </div>
          </div>

          {!listaPlegada && (
            <>
              <div className="ci-orq-lista-accion">
                <button type="button" className="ci-orq-nueva" disabled={bloqueada} onClick={empezarACrear}>+ Nueva orquestación</button>
              </div>

              <div className="ci-orq-lista-cuerpo">
                {orquestaciones.length === 0 && <div className="ci-orq-lista-vacia">Sin orquestaciones. Crea la primera.</div>}
                {orquestaciones.map((una) => {
                  const activa = una.id === elegida
                  const cantidad = pasosDeGrafo(una).pasos.length
                  return (
                    <div key={una.id} className={`ci-orq-item${activa ? ' activa' : ''}`}>
                      <button type="button" className="ci-orq-item-principal" onClick={() => abrir(una)} aria-current={activa ? 'true' : undefined}>
                        <span className="ci-orq-item-nombre">
                          {bloqueada && activa && <span className="ci-orq-punto" aria-label="En ejecución">●</span>}
                          <span className="ci-orq-item-texto" title={una.name}>{una.name}</span>
                        </span>
                        <span className="ci-orq-item-meta">{cantidad === 1 ? '1 paso' : `${cantidad} pasos`} · {fechaDeFila(una.createdAt)}</span>
                      </button>
                      {!bloqueada && (
                        <>
                          <button type="button" className="ci-orq-item-boton" onClick={() => duplicar(una.id)} title="Duplicar" aria-label={`Duplicar ${una.name}`}>⧉</button>
                          <button type="button" className="ci-orq-item-boton peligro" onClick={() => setABorrar(una)} title="Eliminar" aria-label={`Eliminar ${una.name}`}>✕</button>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Plegada: solo las iniciales */}
          {listaPlegada && (
            <div className="ci-orq-lista-iniciales">
              <button type="button" className="ci-orq-inicial nueva" disabled={bloqueada} onClick={empezarACrear} title="+ Nueva orquestación" aria-label="Nueva orquestación">+</button>
              {orquestaciones.map((una) => (
                <button
                  key={una.id}
                  type="button"
                  className={`ci-orq-inicial${una.id === elegida ? ' activa' : ''}`}
                  onClick={() => abrir(una)}
                  title={una.name}
                  aria-label={una.name}
                >
                  {una.name.slice(0, 1).toUpperCase()}
                  {bloqueada && una.id === elegida && <span className="ci-orq-inicial-punto" />}
                </button>
              ))}
            </div>
          )}
        </aside>
      )}

      {/* ── El panel de la derecha ── */}
      {verPanel && (
        <section className={`ci-orq-panel${enPantallaCompleta ? ' completa' : ''}`}>
          {/* Barra para volver, en el teléfono */}
          {movil && (
            <div className="ci-orq-movil-barra">
              <button type="button" className="ci-orq-boton" onClick={() => setVistaMovil('lista')}>← Volver</button>
              {abierta && <span className="ci-orq-movil-nombre">{abierta.name}</span>}
            </div>
          )}

          {error && <div className="notice notice-error" role="alert">✕ {error}</div>}

          {!abierta && (
            <div className="ci-orq-vacio">
              <div className="ci-orq-vacio-icono">⊞</div>
              <div className="ci-orq-vacio-titulo">Orquestador de integraciones</div>
              <div className="ci-orq-vacio-texto">
                Crea una orquestación para encadenar integraciones en secuencia, definir qué hacer si una falla y agrupar integraciones en paralelo.
              </div>
              <button type="button" className="ci-orq-nueva ci-orq-nueva-ancha" onClick={empezarACrear}>+ Nueva orquestación</button>
            </div>
          )}

          {abierta && mostrarEjecucion && (
            <VistaDeEjecucion
              run={run}
              pasos={pasosDeAbierta}
              porId={porId}
              nombre={abierta.name}
              enMarcha={ejecucion.enMarcha}
              ocupado={ejecucion.ocupado}
              error={ejecucion.error}
              puedeRetomar={puedeRetomar}
              mismaVersion={mismaVersion}
              onCancelar={cancelar}
              onRetomar={retomar}
              onVolver={() => setVerEjecucion(false)}
            />
          )}

          {abierta && !mostrarEjecucion && (
            <ConstructorDeOrquestacion
              key={abierta.id}
              connection={connection}
              orquestacion={abierta}
              integraciones={integraciones}
              hayEjecucion={Boolean(run)}
              onVerEjecucion={() => setVerEjecucion(true)}
              onArrancar={arrancar}
              onGuardada={alGuardar}
              pantallaCompleta={enPantallaCompleta}
              onAlternarPantallaCompleta={() => setPantallaCompleta((valor) => !valor)}
            />
          )}
        </section>
      )}

      {/* ── Crear ── */}
      {creando && (
        <Modal
          title="Nueva orquestación"
          onClose={() => setCreando(false)}
          footer={(
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setCreando(false)}>Cancelar</button>
              <button type="button" className="btn btn-primary" disabled={!nombreNuevo.trim()} onClick={confirmarCreacion}>Crear</button>
            </>
          )}
        >
          <input
            autoFocus
            className="input"
            value={nombreNuevo}
            placeholder="Nombre de la orquestación…"
            aria-label="Nombre de la orquestación nueva"
            onChange={(evento) => setNombreNuevo(evento.target.value)}
            onKeyDown={(evento) => { if (evento.key === 'Enter') confirmarCreacion() }}
          />
        </Modal>
      )}

      {/* ── Eliminar ── */}
      {aBorrar && (
        <Modal
          title="Eliminar orquestación"
          onClose={() => setABorrar(null)}
          footer={(
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setABorrar(null)}>Cancelar</button>
              <button type="button" className="btn btn-danger" onClick={confirmarBorrado}>Eliminar</button>
            </>
          )}
        >
          <p>¿Eliminar «{aBorrar.name}»? Esta acción no se puede deshacer.</p>
        </Modal>
      )}
    </div>
  )
}
