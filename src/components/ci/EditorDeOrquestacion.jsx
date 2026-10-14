// Armar y ejecutar una orquestación de CI Tools: etapas en fila y, dentro de cada una, integraciones en paralelo.
//
//   Etapa 1   [Maestro de productos]
//   Etapa 2   [Cifras de facturas]  [Cifras de producción]    ← a la vez
//   Etapa 3   [Cifras de inventario]
//
// Cada paso es UNA llamada a CPI con su propio resultado. Así, si el de la etapa 2 falla, se sabe cuál, lo de
// detrás no corre, y «Retomar» sigue desde ahí sin repetir lo que ya cargó. (Un body con varios bloques haría
// una sola llamada y no se podría saber cuál falló ni retomar desde él.)
//
// Se guarda SOLO, 800 ms después del último cambio, como las orquestaciones de CI-DS. Mientras corre, no se
// puede editar: el motor lee la orquestación en cada vuelta y cambiarla a mitad de una ejecución la dejaría
// apuntando a pasos que ya no están.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { duracionMs, escribirDuracion } from '../../../core/orchestrations/run-detail.js'
import { ESTADOS_DE_PASO, etiquetaDeIntegracion, fechaLegible, infoDeOrquestacion } from '../../lib/ci.js'
import {
  agregarPaso,
  cambiarPaso,
  etapasDeGrafo,
  grafoDeEtapas,
  moverEtapa,
  moverPaso,
  nuevoPaso,
  quitarPaso,
  totalDePasos,
} from '../../lib/ci-etapas.js'
import { copyText } from '../../lib/clipboard.js'
import { useGuardaDeSalida } from '../../lib/guarda-de-salida.js'
import { runProgress, saveOrchestration } from '../../lib/orchestrations.js'
import BotonCopiar from '../ui/BotonCopiar.jsx'
import SelectorDeLista from '../ui/SelectorDeLista.jsx'
import DialogoDeEjecucion from './DialogoDeEjecucion.jsx'
import { useCiRun } from './useCiRun.js'

const ESPERA_DE_GUARDADO_MS = 800

const SI_FALLA = [
  { value: 'stop', label: 'Detener la orquestación' },
  { value: 'continue', label: 'Continuar con lo siguiente' },
  { value: 'retry', label: 'Reintentar' },
]

const MENSAJE_AL_SALIR = 'Hay una orquestación en marcha. Si sales, deja de avanzar hasta que vuelvas y pulses «Retomar»: '
  + 'lo que ya se cargó no se repite, pero una carga que esté esperando a CPI queda sin confirmar.'

/** Lo que dice un paso de una ejecución: su estado, lo que contestó CPI y cuánto tardó. */
function ResultadoDelPaso({ estado }) {
  if (!estado) return null
  const meta = ESTADOS_DE_PASO[estado.status] ?? { texto: estado.status, clase: 'espera' }
  const detalle = estado.detalle ?? {}
  const ms = duracionMs(estado)

  return (
    <div className="ci-paso-resultado">
      <span className={`ci-estado ci-estado-${meta.clase}`}>{meta.texto}</span>
      {detalle.httpStatus && <span className="mono">HTTP {detalle.httpStatus}</span>}
      {ms !== null && estado.status !== 'pending' && <span className="card-hint">{escribirDuracion(ms)}</span>}
      {estado.retryCount > 0 && <span className="card-hint">intento {estado.retryCount + 1}</span>}
      {detalle.mplId && (
        <span className="ci-resultado-mpl">
          <code className="mono" title="MPL ID">{detalle.mplId}</code>
          <BotonCopiar titulo="Copiar el MPL ID" onCopiar={() => copyText(detalle.mplId)} />
        </span>
      )}
      {estado.error && <div className="ci-paso-error">{estado.error}</div>}
      {detalle.sinConfirmar && (
        <div className="notice notice-error" role="alert">
          Sin confirmar: la carga pudo haber entrado. Revísala en Cloud Integration antes de retomar.
        </div>
      )}
    </div>
  )
}

export default function EditorDeOrquestacion({ connection, orquestacion, integraciones, onRenombrar, onGuardada }) {
  const inicial = useMemo(() => etapasDeGrafo(orquestacion), [orquestacion])
  const [etapas, setEtapas] = useState(inicial.etapas)
  const [exacto, setExacto] = useState(inicial.exacto)
  const [estadoDeGuardado, setEstadoDeGuardado] = useState('guardado')
  const [errorAlGuardar, setErrorAlGuardar] = useState('')
  const [nombre, setNombre] = useState(orquestacion.name)
  const [aEjecutar, setAEjecutar] = useState(null)
  const [errorAlPedir, setErrorAlPedir] = useState('')

  const ejecucion = useCiRun(orquestacion.id, nombre)
  const { run } = ejecucion
  const bloqueada = ejecucion.enMarcha
  useGuardaDeSalida(ejecucion.enMarcha, MENSAJE_AL_SALIR)

  const porId = useMemo(() => new Map(integraciones.map((una) => [una.id, una])), [integraciones])
  const opciones = useMemo(() => [
    { value: '', label: '+ Agregar integración…' },
    ...integraciones.map((una) => ({ value: una.id, label: etiquetaDeIntegracion(una) })),
  ], [integraciones])

  // ── Guardado automático ──────────────────────────────────────────────────────────────────────────
  const temporizador = useRef(null)
  const pendiente = useRef(null)
  const etapasActuales = useRef(inicial.etapas)

  const guardar = useCallback(async (aGuardar) => {
    setEstadoDeGuardado('guardando')
    setErrorAlGuardar('')
    try {
      const guardada = await saveOrchestration(orquestacion.id, grafoDeEtapas(aGuardar))
      // La lista de arriba guarda su propia copia del grafo: si no se entera, al volver a esta orquestación
      // abriría la de antes de los cambios.
      onGuardada?.(guardada)
      pendiente.current = null
      setEstadoDeGuardado('guardado')
    } catch (fallo) {
      setErrorAlGuardar(fallo.message)
      setEstadoDeGuardado('error')
      throw fallo
    }
  }, [orquestacion.id, onGuardada])

  /**
   * Aplica un cambio a las etapas y programa el guardado.
   *
   * Parte de `etapasActuales` (una ref) y no del estado: dos cambios seguidos en el mismo instante —quitar un
   * paso y mover otro— tienen que sumarse, y el estado de React todavía no habría visto el primero.
   */
  function cambiar(hacer) {
    const siguientes = hacer(etapasActuales.current)
    etapasActuales.current = siguientes
    setEtapas(siguientes)
    pendiente.current = siguientes
    clearTimeout(temporizador.current)
    temporizador.current = setTimeout(() => { guardar(siguientes).catch(() => {}) }, ESPERA_DE_GUARDADO_MS)
    setEstadoDeGuardado('pendiente')
  }

  /** Guarda ya lo que esté esperando, para que lo que se ejecuta sea lo que se ve. */
  async function guardarAhora() {
    clearTimeout(temporizador.current)
    if (pendiente.current) await guardar(pendiente.current)
  }

  // Al desmontar se guarda lo pendiente: cambiar de pestaña a medio debounce no debe perder el último cambio.
  useEffect(() => () => {
    clearTimeout(temporizador.current)
    if (pendiente.current) {
      saveOrchestration(orquestacion.id, grafoDeEtapas(pendiente.current)).then((guardada) => onGuardada?.(guardada)).catch(() => {})
    }
  }, [orquestacion.id, onGuardada])

  // ── Lo que se ve ────────────────────────────────────────────────────────────────────────────────
  const total = totalDePasos(etapas)
  const progreso = runProgress(run)
  const opcionesDeEtapa = [
    ...etapas.map((_etapa, i) => ({ value: String(i), label: `Etapa ${i + 1}` })),
    { value: 'nueva', label: 'Etapa nueva al final' },
  ]

  /** Alinea las dependencias con la forma de etapas, cuando el grafo guardado no tenía esa forma. */
  function ponerEnEtapas() {
    if (!window.confirm('Las dependencias de esta orquestación no tienen forma de etapas. Se reordenarán en etapas, y '
      + 'algunas esperas entre pasos pueden cambiar. ¿Continuar?')) return
    setExacto(true)
    cambiar((previas) => previas)
  }

  async function pedirEjecucion() {
    setErrorAlPedir('')
    try {
      await guardarAhora()
      const info = await infoDeOrquestacion(orquestacion.id)
      if (info.pasos.length === 0) throw new Error('La orquestación no tiene ninguna integración.')
      if (info.rotos.length > 0) {
        const nombres = info.pasos.filter((paso) => info.rotos.includes(paso.nodeId)).map((paso) => `«${paso.label}»`)
        throw new Error(`${nombres.join(', ')} apunta a una integración que ya no existe en esta conexión. Quítalo o cámbialo.`)
      }
      setAEjecutar({
        variables: info.variables,
        iniciales: info.ultimas,
        // En el orden en que se ejecutarán, con la etapa de cada una: lo que se va a lanzar es lo que se ve.
        integraciones: info.pasos
          .map((paso) => ({
            nombre: paso.integracion ? etiquetaDeIntegracion(paso.integracion) : paso.label,
            comando: paso.integracion?.resumen?.comando ?? '',
            etapa: etapas.findIndex((una) => una.some((otro) => otro.id === paso.nodeId)) + 1,
          }))
          .sort((a, b) => a.etapa - b.etapa),
      })
    } catch (fallo) {
      setErrorAlPedir(fallo.message)
    }
  }

  function retomar() {
    const enDuda = Object.values(run?.nodes ?? {}).some((paso) => paso.detalle?.sinConfirmar)
    const pregunta = enDuda
      ? 'Hay pasos SIN CONFIRMAR: se enviaron y no se sabe si la carga entró. Retomar los enviará otra vez. '
        + '¿Ya lo revisaste en Cloud Integration y quieres retomar?'
      : 'Se retoma desde donde falló. Lo que ya salió bien no se repite. ¿Continuar?'
    if (window.confirm(pregunta)) ejecucion.retomar().catch(() => {})
  }

  function cortar() {
    if (window.confirm('Se corta la orquestación. Lo que ya se envió a CPI sigue su curso: cortar detiene lo que falta, no deshace lo cargado. ¿Cortar?')) {
      ejecucion.cortar().catch(() => {})
    }
  }

  const terminada = Boolean(run) && !ejecucion.enMarcha
  // Retomar sigue una ejecución concreta: solo tiene sentido si la orquestación tiene los MISMOS pasos que cuando
  // se lanzó. Si se editó después, hay que ejecutarla de nuevo.
  const idsDeAhora = new Set(etapas.flat().map((paso) => paso.id))
  const idsDeLaEjecucion = Object.keys(run?.nodes ?? {})
  const mismaVersion = idsDeLaEjecucion.length === idsDeAhora.size && idsDeLaEjecucion.every((id) => idsDeAhora.has(id))
  const puedeRetomar = terminada && mismaVersion && (run.status === 'error' || run.status === 'cancelled')

  const guardadoTexto = {
    guardado: '✓ Guardado',
    pendiente: 'Cambios sin guardar…',
    guardando: 'Guardando…',
    error: '✕ No se pudo guardar',
  }[estadoDeGuardado]

  return (
    <div className="ci-orq-editor">
      <div className="ci-orq-cabeza">
        <input
          className="input ci-orq-nombre"
          value={nombre}
          disabled={bloqueada}
          aria-label="Nombre de la orquestación"
          onChange={(evento) => setNombre(evento.target.value)}
          onBlur={() => {
            const limpio = nombre.trim()
            if (limpio === '' || limpio === orquestacion.name) { setNombre(orquestacion.name); return }
            onRenombrar(limpio).catch((fallo) => { setErrorAlGuardar(fallo.message); setNombre(orquestacion.name) })
          }}
        />
        <span className={`ci-guardado ci-guardado-${estadoDeGuardado}`} role="status">{guardadoTexto}</span>
        <div className="ci-editor-acciones">
          {puedeRetomar && (
            <button type="button" className="btn" onClick={retomar} disabled={ejecucion.ocupado}>↺ Retomar</button>
          )}
          {ejecucion.enMarcha && (
            <button type="button" className="btn btn-danger" onClick={cortar} disabled={ejecucion.ocupado}>■ Cortar</button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={pedirEjecucion}
            disabled={ejecucion.enMarcha || ejecucion.ocupado || total === 0 || !exacto || estadoDeGuardado === 'guardando'}
            title={total === 0 ? 'Agrega al menos una integración' : undefined}
          >
            ▶ Ejecutar
          </button>
        </div>
      </div>

      {(errorAlGuardar || errorAlPedir || ejecucion.error) && (
        <div className="notice notice-error" role="alert">✕ {errorAlGuardar || errorAlPedir || ejecucion.error}</div>
      )}

      {run && (
        <div className={`ci-run-barra ci-run-${run.status}`}>
          <span className={`ci-estado ci-estado-${{ running: 'en-curso', success: 'bien', error: 'mal', cancelled: 'duda' }[run.status] ?? 'espera'}`}>
            {{ running: 'En ejecución', success: 'Completada', error: 'Terminó con error', cancelled: 'Cortada' }[run.status] ?? run.status}
          </span>
          <span>{progreso.hechos}/{progreso.total} pasos</span>
          <span className="card-hint">Empezó {fechaLegible(run.startedAt)}</span>
          {run.finishedAt && <span className="card-hint">· duró {escribirDuracion(duracionMs(run))}</span>}
          {ejecucion.enMarcha && (
            <span className="card-hint">
              Avanza mientras esta pantalla esté abierta: no la cierres hasta que termine.
            </span>
          )}
          {run.defaults?.startedBy?.email && <span className="card-hint">· lanzada por {run.defaults.startedBy.email}</span>}
        </div>
      )}

      {terminada && !mismaVersion && (
        <p className="card-hint">
          La orquestación cambió después de la última ejecución: para ver otra vez sus pasos, ejecútala de nuevo.
        </p>
      )}

      {!exacto && (
        <div className="notice notice-error" role="alert">
          Las dependencias de esta orquestación no se pueden mostrar como etapas (no se armó en este editor).
          Se ejecutaría con las dependencias guardadas, pero aquí no se puede editar con seguridad.
          <div><button type="button" className="btn btn-sm" onClick={ponerEnEtapas} disabled={bloqueada}>Reordenar en etapas</button></div>
        </div>
      )}

      <div className="ci-etapas">
        {etapas.length === 0 && (
          <div className="ci-vacio">
            Esta orquestación está vacía. Agrega la primera integración: se ejecutará primero.
          </div>
        )}

        {etapas.map((etapa, i) => (
          <div key={i} className="ci-etapa">
            <div className="ci-etapa-cabeza">
              <span className="ci-etapa-titulo">
                Etapa {i + 1}
                {etapa.length > 1 && <span className="card-hint"> · {etapa.length} a la vez</span>}
              </span>
              {!bloqueada && (
                <span className="ci-etapa-mover">
                  <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => cambiar((previas) => moverEtapa(previas, i, -1))} title="Subir la etapa" aria-label={`Subir la etapa ${i + 1}`}>↑</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={i === etapas.length - 1} onClick={() => cambiar((previas) => moverEtapa(previas, i, 1))} title="Bajar la etapa" aria-label={`Bajar la etapa ${i + 1}`}>↓</button>
                </span>
              )}
            </div>

            {etapa.map((paso) => {
              const integracion = porId.get(paso.data.integrationId)
              const estado = run?.nodes?.[paso.id]
              const estrategia = paso.data.errorStrategy ?? 'stop'
              return (
                <div key={paso.id} className={`ci-paso${estado ? ` ci-paso-${estado.status}` : ''}`}>
                  <div className="ci-paso-fila">
                    <div className="ci-paso-nombre">
                      <strong>{integracion ? integracion.name : paso.data.label}</strong>
                      {integracion ? (
                        <span className="card-hint">
                          {integracion.folder && `${integracion.folder} · `}
                          {integracion.resumen?.valido ? `${integracion.resumen.tipo} · ${integracion.resumen.comando}` : 'body inválido'}
                        </span>
                      ) : (
                        <span className="ci-aviso-fila">La integración ya no existe en esta conexión.</span>
                      )}
                    </div>

                    <div className="ci-paso-controles">
                      <label className="ci-paso-control">
                        <span className="card-hint">Si falla</span>
                        {/* select-fijo: lista cerrada y corta, no crece con los datos */}
                        <select
                          className="select"
                          value={estrategia}
                          disabled={bloqueada}
                          onChange={(evento) => cambiar((previas) => cambiarPaso(previas, paso.id, {
                            errorStrategy: evento.target.value,
                            ...(evento.target.value === 'retry' && Number(paso.data.maxRetries ?? 0) < 1 ? { maxRetries: 1 } : {}),
                          }))}
                        >
                          {SI_FALLA.map((una) => <option key={una.value} value={una.value}>{una.label}</option>)}
                        </select>
                      </label>

                      {estrategia === 'retry' && (
                        <>
                          <label className="ci-paso-control">
                            <span className="card-hint">Reintentos</span>
                            <input
                              className="input input-sm"
                              type="number"
                              min={1}
                              max={3}
                              value={paso.data.maxRetries ?? 1}
                              disabled={bloqueada}
                              onChange={(evento) => cambiar((previas) => cambiarPaso(previas, paso.id, { maxRetries: Number(evento.target.value) }))}
                            />
                          </label>
                          <label className="ci-paso-control">
                            <span className="card-hint">Espera (s)</span>
                            <input
                              className="input input-sm"
                              type="number"
                              min={10}
                              max={3600}
                              value={paso.data.retryDelaySeconds ?? 60}
                              disabled={bloqueada}
                              onChange={(evento) => cambiar((previas) => cambiarPaso(previas, paso.id, { retryDelaySeconds: Number(evento.target.value) }))}
                            />
                          </label>
                        </>
                      )}

                      <label className="ci-paso-control">
                        <span className="card-hint">Mover a</span>
                        <SelectorDeLista
                          value={String(i)}
                          options={opcionesDeEtapa}
                          disabled={bloqueada}
                          ariaLabel="Mover a otra etapa"
                          titulo="Mover a otra etapa"
                          onChange={(valor) => cambiar((previas) => moverPaso(previas, paso.id, valor === 'nueva' ? null : Number(valor)))}
                        />
                      </label>

                      {!bloqueada && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm ci-quitar"
                          onClick={() => cambiar((previas) => quitarPaso(previas, paso.id))}
                          title="Quitar este paso"
                          aria-label={`Quitar ${integracion ? integracion.name : paso.data.label}`}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>

                  {estrategia === 'retry' && (
                    <p className="card-hint ci-paso-nota">
                      Reintentar repite la carga completa. Una carga que quede sin confirmar nunca se reintenta sola.
                    </p>
                  )}
                  <ResultadoDelPaso estado={estado} />
                </div>
              )
            })}

            {!bloqueada && (
              <div className="ci-etapa-agregar">
                <SelectorDeLista
                  value=""
                  options={opciones}
                  ariaLabel={`Agregar una integración en paralelo en la etapa ${i + 1}`}
                  titulo={`Agregar a la etapa ${i + 1} (en paralelo)`}
                  placeholder="+ Agregar en paralelo…"
                  onChange={(id) => {
                    const elegida = porId.get(id)
                    if (elegida) cambiar((previas) => agregarPaso(previas, nuevoPaso(elegida), i))
                  }}
                />
              </div>
            )}
          </div>
        ))}

        {!bloqueada && exacto && (
          <div className="ci-etapa ci-etapa-nueva">
            <div className="ci-etapa-cabeza">
              <span className="ci-etapa-titulo">{etapas.length === 0 ? 'Etapa 1' : `Etapa ${etapas.length + 1} (nueva)`}</span>
            </div>
            <div className="ci-etapa-agregar">
              <SelectorDeLista
                value=""
                options={opciones}
                ariaLabel="Agregar una integración en una etapa nueva"
                titulo="Agregar en una etapa nueva (después de las anteriores)"
                placeholder="+ Agregar integración…"
                onChange={(id) => {
                  const elegida = porId.get(id)
                  if (elegida) cambiar((previas) => agregarPaso(previas, nuevoPaso(elegida), null))
                }}
              />
            </div>
          </div>
        )}
      </div>

      {integraciones.length === 0 && (
        <p className="card-hint">Todavía no hay integraciones en esta conexión: créalas en la pestaña «Integraciones».</p>
      )}

      {aEjecutar && (
        <DialogoDeEjecucion
          titulo={`Ejecutar «${orquestacion.name}»`}
          conexion={connection}
          integraciones={aEjecutar.integraciones}
          variables={aEjecutar.variables}
          iniciales={aEjecutar.iniciales}
          esOrquestacion
          onEjecutar={(variables) => ejecucion.arrancar(variables)}
          onCerrar={() => setAEjecutar(null)}
        />
      )}
    </div>
  )
}
