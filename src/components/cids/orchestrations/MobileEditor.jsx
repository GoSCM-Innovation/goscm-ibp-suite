// Editar una orquestación desde el teléfono.
//
// Portado del editor móvil de v9 (`mobile/`). Existe porque un lienzo con nodos que se arrastran es
// inservible con el dedo: los nodos son más pequeños que la yema, el zoom pelea con el desplazamiento
// de la página, y no hay dónde poner tres columnas.
//
// La idea es la misma que en v9: en el teléfono una orquestación se edita como una LISTA en orden,
// no como un dibujo. Y una lista solo puede representar una cadena —un paso detrás de otro—, así que
// esta pantalla se declara incapaz ante un grafo que se abre en dos ramas o que tiene grupos, en vez
// de aplanarlo y romperlo en silencio. Eso se edita en la computadora.

import { useState } from 'react'
import { ERROR_STRATEGIES, MAX_RETRIES_LIMIT } from '../../../../core/orchestrations/graph.js'
import { enOrden, esCadenaSimple } from '../../../lib/orchestration-chain.js'

const QUE_SI_FALLA = {
  stop: 'Para la orquestación',
  continue: 'Sigue igual',
  retry: 'Reintenta',
}

export default function MobileEditor({ orquestacion, onGuardar, guardando, error, onAgregarPaso }) {
  const [nodos, setNodos] = useState(orquestacion.nodes ?? [])
  const [aristas, setAristas] = useState(orquestacion.edges ?? [])
  const [abierto, setAbierto] = useState(null)
  const [sucio, setSucio] = useState(false)

  if (!esCadenaSimple(nodos, aristas)) {
    return (
      <div className="orq-vacio">
        <div className="orq-vacio-titulo">Esta orquestación no se puede editar desde el teléfono</div>
        <p className="page-hint">
          Tiene ramas que se abren o pasos agrupados, y eso no entra en una lista. Se puede ver y
          ejecutar desde aquí, pero para cambiarla hace falta el lienzo de la computadora.
        </p>
      </div>
    )
  }

  const ordenados = enOrden(nodos, aristas)

  /** Rehace la cadena a partir del orden de la lista: cada paso apunta al siguiente. */
  function reencadenar(lista) {
    setNodos(lista)
    setAristas(lista.slice(0, -1).map((nodo, i) => ({
      id: `e-${nodo.id}-${lista[i + 1].id}`,
      source: nodo.id,
      target: lista[i + 1].id,
    })))
    setSucio(true)
  }

  function mover(indice, hacia) {
    const destino = indice + hacia
    if (destino < 0 || destino >= ordenados.length) return
    const lista = [...ordenados]
    ;[lista[indice], lista[destino]] = [lista[destino], lista[indice]]
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
    setSucio(true)
  }

  return (
    <div className="movil">
      <div className="movil-barra">
        <span className="lienzo-nombre">{orquestacion.name}</span>
        {sucio && <span className="lienzo-sucio">sin guardar</span>}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => onGuardar({ nodes: nodos, edges: aristas }).then(() => setSucio(false))}
          disabled={guardando || !sucio}
        >
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>

      {error && <div className="notice notice-error lienzo-error">✕ {error}</div>}

      <div className="movil-lista">
        {ordenados.length === 0 && (
          <div className="page-hint" style={{ padding: 20, textAlign: 'center' }}>
            Todavía no hay pasos. Agrega el primero con el botón de abajo.
          </div>
        )}

        {ordenados.map((nodo, indice) => (
          <div className="movil-paso" key={nodo.id}>
            <button
              type="button"
              className="movil-paso-cabeza"
              onClick={() => setAbierto(abierto === nodo.id ? null : nodo.id)}
              aria-expanded={abierto === nodo.id}
            >
              <span className="movil-numero">{indice + 1}</span>
              <span className="movil-paso-que">
                <span className="movil-paso-nombre">{nodo.data?.label || nodo.data?.taskName || 'Sin tarea'}</span>
                <span className="movil-paso-detalle">
                  Si falla: {QUE_SI_FALLA[nodo.data?.errorStrategy ?? 'stop']}
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
                    value={nodo.data?.errorStrategy ?? 'stop'}
                    onChange={(evento) => cambiar(nodo.id, 'errorStrategy', evento.target.value)}
                  >
                    {ERROR_STRATEGIES.map((estrategia) => (
                      <option key={estrategia} value={estrategia}>{QUE_SI_FALLA[estrategia]}</option>
                    ))}
                  </select>
                </div>

                {nodo.data?.errorStrategy === 'retry' && (
                  <div className="field">
                    <label htmlFor={`m-intentos-${nodo.id}`}>Intentos</label>
                    <input
                      id={`m-intentos-${nodo.id}`}
                      className="input"
                      type="number"
                      min="0"
                      max={MAX_RETRIES_LIMIT}
                      value={nodo.data?.maxRetries ?? 0}
                      onChange={(evento) => cambiar(nodo.id, 'maxRetries', Number(evento.target.value))}
                    />
                  </div>
                )}

                <div className="movil-acciones">
                  <button type="button" className="btn btn-sm" onClick={() => mover(indice, -1)} disabled={indice === 0}>
                    ↑ Subir
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => mover(indice, 1)}
                    disabled={indice === ordenados.length - 1}
                  >
                    ↓ Bajar
                  </button>
                  <div style={{ flex: 1 }} />
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => quitar(nodo.id)}>
                    Quitar
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="movil-pie">
        <button type="button" className="btn btn-primary" onClick={onAgregarPaso}>
          + Agregar paso
        </button>
      </div>
    </div>
  )
}
