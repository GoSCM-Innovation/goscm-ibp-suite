// Editar y ejecutar una orquestación desde el teléfono.
//
// Portado del editor móvil de v9 (`mobile/`). Existe porque un lienzo con nodos que se arrastran es
// inservible con el dedo: los nodos son más pequeños que la yema, el zoom pelea con el desplazamiento
// de la página, y no hay dónde poner tres columnas.
//
// La idea es la misma que en v9: en el teléfono una orquestación se edita como una LISTA en orden,
// no como un dibujo. Y una lista solo puede representar una cadena —un paso detrás de otro—, así que
// esta pantalla se declara incapaz ante un grafo que se abre en dos ramas o que tiene grupos, en vez
// de aplanarlo y romperlo en silencio. Eso se edita en la computadora; ejecutarlo y ver qué pasó sí
// se puede desde aquí, que es lo que hace falta con el teléfono en la mano.
//
// Diferencia con v9: allí era un asistente por pasos con cursor, grupos y ramas en paralelo.

import { Suspense, useState } from 'react'
import {
  ERROR_STRATEGIES,
  MAX_RETRIES_LIMIT,
  MAX_RETRY_DELAY_SECONDS,
} from '../../../../core/orchestrations/graph.js'
import { enOrden, esCadenaSimple } from '../../../lib/orchestration-chain.js'
import { runProgress } from '../../../lib/orchestrations.js'
import Modal from '../../ui/Modal.jsx'
import RunBar from './RunBar.jsx'
import RunDetail from './RunDetail.jsx'
import { useOrchestrationRun } from './useOrchestrationRun.js'
import './lista.css'

const QUE_SI_FALLA = {
  stop: 'Para la orquestación',
  continue: 'Sigue igual',
  retry: 'Reintenta',
}

export default function MobileEditor({
  destino,
  orquestacion,
  onGuardar,
  guardando,
  error,
  Paleta,
  transportadas = null,
  onRenombrar,
  onSinGuardar,
  leerRegistro,
}) {
  const [nodos, setNodos] = useState(orquestacion.nodes ?? [])
  const [aristas, setAristas] = useState(orquestacion.edges ?? [])
  const [abierto, setAbierto] = useState(null)
  const [sucio, setSucio] = useState(false)
  const [eligiendoTarea, setEligiendoTarea] = useState(false)
  const [errorAlRenombrar, setErrorAlRenombrar] = useState('')
  // Los hooks van antes de cualquier `return`: una orquestación con ramas también se ejecuta desde aquí.
  const ejecucion = useOrchestrationRun(orquestacion.id, orquestacion.name)

  /** Marca si hay cambios sin guardar, y se lo dice a quien tiene que preguntar antes de descartarlos. */
  function marcar(valor) {
    setSucio(valor)
    onSinGuardar?.(valor)
  }

  async function renombrar() {
    // `prompt` como en v9: en el teléfono lo abre el sistema, con su propio teclado.
    const siguiente = window.prompt('Nuevo nombre de la orquestación:', orquestacion.name)?.trim()
    if (!siguiente || siguiente === orquestacion.name) return
    setErrorAlRenombrar('')
    try {
      await onRenombrar(siguiente)
    } catch (fallo) {
      setErrorAlRenombrar(fallo.message)
    }
  }

  const { hechos, total } = runProgress(ejecucion.run)
  // Mientras corre no se edita: cambiar un paso a mitad dejaría la lista y la ejecución hablando de
  // cosas distintas.
  const editable = !ejecucion.enMarcha
  const esCadena = esCadenaSimple(nodos, aristas)
  const ordenados = esCadena ? enOrden(nodos, aristas) : []

  /** Rehace la cadena a partir del orden de la lista: cada paso apunta al siguiente. */
  function reencadenar(lista) {
    setNodos(lista)
    setAristas(lista.slice(0, -1).map((nodo, i) => ({
      id: `e-${nodo.id}-${lista[i + 1].id}`,
      source: nodo.id,
      target: lista[i + 1].id,
    })))
    marcar(true)
  }

  function mover(indice, hacia) {
    const destinoIndice = indice + hacia
    if (destinoIndice < 0 || destinoIndice >= ordenados.length) return
    const lista = [...ordenados]
    ;[lista[indice], lista[destinoIndice]] = [lista[destinoIndice], lista[indice]]
    reencadenar(lista)
  }

  function quitar(id) {
    reencadenar(ordenados.filter((nodo) => nodo.id !== id))
    setAbierto(null)
  }

  function cambiar(id, campo, valor) {
    setNodos((previos) => previos.map((nodo) => (
      nodo.id === id ? { ...nodo, data: { ...nodo.data, [campo]: valor } } : nodo
    )))
    marcar(true)
  }

  function cambiarVariable(id, variables, indice, campo, valor) {
    const siguientes = [...variables]
    siguientes[indice] = { ...siguientes[indice], [campo]: valor }
    cambiar(id, 'globalVariables', siguientes)
  }

  /** Agrega el paso que se eligió en la paleta al final de la cadena. Queda sin guardar, como todo. */
  function agregarPaso(datos) {
    setEligiendoTarea(false)
    const id = `n-${globalThis.crypto.randomUUID()}`
    reencadenar([...ordenados, {
      id,
      type: 'task',
      position: { x: 80, y: 60 + nodos.length * 120 },
      data: { ...datos, errorStrategy: 'stop', maxRetries: 0, retryDelaySeconds: 30 },
    }])
    setAbierto(id)
  }

  return (
    <div className="movil">
      <div className="movil-barra">
        <button
          type="button"
          className="movil-nombre"
          onClick={renombrar}
          disabled={!editable}
          title={editable ? 'Cambiar el nombre' : orquestacion.name}
        >
          {orquestacion.name}
        </button>
        {/* El avance mientras corre: cuántos pasos ya salieron de la cola sobre el total. */}
        {ejecucion.enMarcha && total > 0 && <span className="movil-cuenta">{hechos}/{total}</span>}
        {sucio && <span className="lienzo-sucio">sin guardar</span>}
        {esCadena && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => onGuardar({ nodes: nodos, edges: aristas }).then(() => marcar(false))}
            disabled={guardando || !sucio || !editable}
            title={editable ? '' : 'No se puede guardar mientras la orquestación está corriendo'}
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        )}
      </div>

      <RunBar
        run={ejecucion.run}
        error={ejecucion.error}
        ocupado={ejecucion.ocupado}
        enMarcha={ejecucion.enMarcha}
        sinGuardar={sucio}
        grafo={{ nodes: nodos, edges: aristas }}
        destino={destino}
        onArrancar={ejecucion.arrancar}
        onCortar={ejecucion.cortar}
        onRetomar={ejecucion.retomar}
      />

      {/* Plegado debajo de la barra, como en el lienzo: la barra dice cuántos pasos van, esto dice qué
          pasó en cada uno. */}
      <RunDetail orquestacion={{ nodes: nodos }} run={ejecucion.run} leerRegistro={leerRegistro} />

      {(error || errorAlRenombrar) && (
        <div className="notice notice-error lienzo-error">✕ {error || errorAlRenombrar}</div>
      )}

      {!esCadena ? (
        <div className="orq-vacio">
          <div className="orq-vacio-titulo">Esta orquestación no se puede editar desde el teléfono</div>
          <p className="page-hint">
            Tiene ramas que se abren o pasos agrupados, y eso no entra en una lista. Se puede ejecutar
            y ver el resultado desde aquí, pero para cambiarla hace falta el lienzo de la computadora.
          </p>
        </div>
      ) : (
        <>
          <div className="movil-lista">
            {ordenados.length === 0 && (
              <div className="page-hint" style={{ padding: 20, textAlign: 'center' }}>
                Todavía no hay pasos. Agrega el primero con el botón de abajo.
              </div>
            )}

            {ordenados.map((nodo, indice) => {
              const datos = nodo.data ?? {}
              const variables = datos.globalVariables ?? []
              return (
                <div className="movil-paso" key={nodo.id}>
                  <button
                    type="button"
                    className="movil-paso-cabeza"
                    onClick={() => setAbierto(abierto === nodo.id ? null : nodo.id)}
                    aria-expanded={abierto === nodo.id}
                  >
                    <span className="movil-numero">{indice + 1}</span>
                    <span className="movil-paso-que">
                      <span className="movil-paso-nombre">{datos.label || datos.taskName || datos.templateName || 'Sin tarea'}</span>
                      <span className="movil-paso-detalle">
                        Si falla: {QUE_SI_FALLA[datos.errorStrategy ?? 'stop']}
                      </span>
                    </span>
                    <span className="tree-caret">{abierto === nodo.id ? '▾' : '▸'}</span>
                  </button>

                  {abierto === nodo.id && (
                    <div className="movil-paso-cuerpo">
                      <div className="field">
                        <label htmlFor={`m-falla-${nodo.id}`}>Si este paso falla</label>
                        <select
                          id={`m-falla-${nodo.id}`}
                          className="select"
                          value={datos.errorStrategy ?? 'stop'}
                          disabled={!editable}
                          onChange={(evento) => cambiar(nodo.id, 'errorStrategy', evento.target.value)}
                        >
                          {ERROR_STRATEGIES.map((estrategia) => (
                            <option key={estrategia} value={estrategia}>{QUE_SI_FALLA[estrategia]}</option>
                          ))}
                        </select>
                      </div>

                      {datos.errorStrategy === 'retry' && (
                        <>
                          <div className="field">
                            <label htmlFor={`m-intentos-${nodo.id}`}>Intentos</label>
                            <input
                              id={`m-intentos-${nodo.id}`}
                              className="input"
                              type="number"
                              min="0"
                              max={MAX_RETRIES_LIMIT}
                              value={datos.maxRetries ?? 0}
                              disabled={!editable}
                              onChange={(evento) => cambiar(nodo.id, 'maxRetries', Number(evento.target.value))}
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`m-espera-${nodo.id}`}>Espera (segundos)</label>
                            <input
                              id={`m-espera-${nodo.id}`}
                              className="input"
                              type="number"
                              min="0"
                              max={MAX_RETRY_DELAY_SECONDS}
                              value={datos.retryDelaySeconds ?? 30}
                              disabled={!editable}
                              onChange={(evento) => cambiar(nodo.id, 'retryDelaySeconds', Number(evento.target.value))}
                            />
                          </div>
                        </>
                      )}

                      {/* Las variables globales son de CI-DS: un paso de IBP corre con los parámetros
                          que tiene configurados allá. Es el mismo criterio del panel del lienzo. */}
                      {!datos.templateName && (
                        <div className="field">
                          <label>Variables globales</label>
                          <div className="form-stack">
                            {variables.map((variable, i) => (
                              <div className="movil-variable" key={i}>
                                <input
                                  className="input mono"
                                  placeholder="NOMBRE"
                                  value={variable.name ?? ''}
                                  disabled={!editable}
                                  onChange={(evento) => cambiarVariable(nodo.id, variables, i, 'name', evento.target.value)}
                                  aria-label="Nombre de la variable"
                                />
                                <input
                                  className="input mono"
                                  placeholder="valor"
                                  value={variable.value ?? ''}
                                  disabled={!editable}
                                  onChange={(evento) => cambiarVariable(nodo.id, variables, i, 'value', evento.target.value)}
                                  aria-label="Valor de la variable"
                                />
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm btn-danger"
                                  disabled={!editable}
                                  onClick={() => cambiar(nodo.id, 'globalVariables', variables.filter((_, otra) => otra !== i))}
                                  title="Quitar la variable"
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              className="btn btn-sm"
                              disabled={!editable}
                              onClick={() => cambiar(nodo.id, 'globalVariables', [...variables, { name: '', value: '' }])}
                            >
                              + Agregar variable
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="movil-acciones">
                        <button type="button" className="btn btn-sm" onClick={() => mover(indice, -1)} disabled={!editable || indice === 0}>
                          ↑ Subir
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => mover(indice, 1)}
                          disabled={!editable || indice === ordenados.length - 1}
                        >
                          ↓ Bajar
                        </button>
                        <div style={{ flex: 1 }} />
                        <button type="button" className="btn btn-sm btn-danger" onClick={() => quitar(nodo.id)} disabled={!editable}>
                          Quitar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="movil-pie">
            <button type="button" className="btn btn-primary" onClick={() => setEligiendoTarea(true)} disabled={!editable}>
              + Agregar paso
            </button>
          </div>
        </>
      )}

      {eligiendoTarea && (
        <Modal title="Agregar un paso" onClose={() => setEligiendoTarea(false)}>
          <Suspense fallback={<div className="page-hint">Cargando tareas…</div>}>
            <div className="movil-paleta">
              <Paleta destino={destino} onAgregar={agregarPaso} transportadas={transportadas} movil />
            </div>
          </Suspense>
        </Modal>
      )}
    </div>
  )
}
