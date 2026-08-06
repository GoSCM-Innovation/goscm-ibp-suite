// El lienzo: dibujar los pasos, conectarlos y configurarlos.
//
// Portado de `canvas/OrchestrationsCanvas.jsx` de v9, sobre la misma librería (`@xyflow/react`).
//
// Lo que guarda es exactamente lo que valida `core/orchestrations/graph.js`, incluidas sus dos
// guardas: una conexión que apunte a un nodo inexistente y un ciclo se rechazan. Si el servidor dice
// que no, el mensaje aparece arriba tal cual — nombra los pasos del ciclo, así que se puede arreglar.
//
// No hay guardado automático a propósito. Un lienzo se toca mucho mientras se piensa, y guardar en
// cada movimiento sería una escritura por cada píxel arrastrado. El botón dice si hay cambios sin
// guardar, que es lo que hace falta saber.

import { useCallback, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import NodeConfigPanel from './NodeConfigPanel.jsx'
import TaskNode from './TaskNode.jsx'
import TaskPalette from './TaskPalette.jsx'

/** Dónde cae un paso nuevo. En cascada, para que no se apilen uno encima de otro. */
const POSICION_INICIAL = { x: 80, y: 60 }
const DESPLAZAMIENTO = 40

const nodeTypes = { task: TaskNode }

export default function OrchestrationCanvas({ destino, orquestacion, onGuardar, guardando, error }) {
  const [nodos, setNodos] = useState(orquestacion.nodes ?? [])
  const [aristas, setAristas] = useState(orquestacion.edges ?? [])
  const [elegido, setElegido] = useState(null)
  const [sucio, setSucio] = useState(false)

  // No hay efecto que copie la orquestación al estado: quien monta este componente le pone una clave
  // con su identificador, así que cambiar de orquestación lo remonta y el estado nace del grafo
  // correcto. Copiarlo con un efecto además pisaría lo que estés dibujando cada vez que se guarde.

  const marcarSucio = useCallback(() => setSucio(true), [])

  const onNodesChange = useCallback((cambios) => {
    setNodos((previos) => applyNodeChanges(cambios, previos))
    // Mover, seleccionar o medir no cuenta como cambio que haya que guardar... salvo mover, que sí:
    // la posición es parte del dibujo. Seleccionar no.
    if (cambios.some((cambio) => cambio.type !== 'select' && cambio.type !== 'dimensions')) marcarSucio()
  }, [marcarSucio])

  const onEdgesChange = useCallback((cambios) => {
    setAristas((previas) => applyEdgeChanges(cambios, previas))
    if (cambios.some((cambio) => cambio.type !== 'select')) marcarSucio()
  }, [marcarSucio])

  const onConnect = useCallback((conexion) => {
    setAristas((previas) => addEdge({ ...conexion, id: `e-${conexion.source}-${conexion.target}` }, previas))
    marcarSucio()
  }, [marcarSucio])

  function agregarTarea(tarea) {
    const id = `n-${Date.now()}-${nodos.length}`
    setNodos((previos) => [...previos, {
      id,
      type: 'task',
      position: {
        x: POSICION_INICIAL.x + previos.length * DESPLAZAMIENTO,
        y: POSICION_INICIAL.y + previos.length * DESPLAZAMIENTO,
      },
      data: {
        taskName: tarea.taskName,
        taskGuid: tarea.taskGuid ?? null,
        taskType: tarea.type ?? null,
        label: tarea.taskName,
        agentName: null,
        profileName: null,
        globalVariables: [],
        errorStrategy: 'stop',
        maxRetries: 0,
        retryDelaySeconds: 30,
      },
    }])
    setElegido(id)
    marcarSucio()
  }

  function cambiarDatos(datos) {
    setNodos((previos) => previos.map((nodo) => (nodo.id === elegido ? { ...nodo, data: datos } : nodo)))
    marcarSucio()
  }

  function quitarElegido() {
    setNodos((previos) => previos.filter((nodo) => nodo.id !== elegido))
    // Las conexiones que tocaban ese paso se van con él: dejarlas haría un grafo que el servidor
    // rechaza, y el error aparecería al guardar en vez de al borrar.
    setAristas((previas) => previas.filter((arista) => arista.source !== elegido && arista.target !== elegido))
    setElegido(null)
    marcarSucio()
  }

  const nodoElegido = useMemo(() => nodos.find((nodo) => nodo.id === elegido) ?? null, [nodos, elegido])

  return (
    <div className="lienzo">
      <div className="lienzo-barra">
        <span className="lienzo-nombre">{orquestacion.name}</span>
        <span className="lienzo-cuenta">
          {nodos.length} {nodos.length === 1 ? 'paso' : 'pasos'}
          {sucio && <span className="lienzo-sucio"> · sin guardar</span>}
        </span>
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

      <div className="lienzo-cuerpo">
        <TaskPalette destino={destino} onAgregar={agregarTarea} />

        <div className="lienzo-dibujo">
          <ReactFlow
            nodes={nodos}
            edges={aristas}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={({ nodes: elegidos }) => setElegido(elegidos?.[0]?.id ?? null)}
            fitView
            proOptions={{ hideAttribution: false }}
          >
            <Background />
            <Controls />
          </ReactFlow>

          {nodos.length === 0 && (
            <div className="lienzo-vacio">
              <div className="orq-vacio-titulo">Todavía no hay pasos</div>
              <p className="page-hint">
                Elegí una tarea de la lista de la izquierda para agregar el primero. Después se
                conectan arrastrando de un paso al siguiente.
              </p>
            </div>
          )}
        </div>

        {nodoElegido && (
          <NodeConfigPanel
            destino={destino}
            nodo={nodoElegido}
            onCambiar={cambiarDatos}
            onBorrar={quitarElegido}
          />
        )}
      </div>
    </div>
  )
}
