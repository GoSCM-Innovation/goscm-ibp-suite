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
import GroupNode from './GroupNode.jsx'
import NodeConfigPanel from './NodeConfigPanel.jsx'
import RunBar from './RunBar.jsx'
import RunDetail from './RunDetail.jsx'
import TaskNode from './TaskNode.jsx'
import TaskPalette from './TaskPalette.jsx'

import { useOrchestrationRun } from './useOrchestrationRun.js'

/** Dónde cae un paso nuevo. En cascada, para que no se apilen uno encima de otro. */
const POSICION_INICIAL = { x: 80, y: 60 }
const DESPLAZAMIENTO = 40

const nodeTypes = { task: TaskNode, group: GroupNode }

/** Tamaño con el que nace un grupo. Se agranda arrastrando su borde. */
const TAMANIO_DEL_GRUPO = { width: 320, height: 220 }

export default function OrchestrationCanvas({ leerRegistro, Paleta = TaskPalette, destino, orquestacion, onGuardar, guardando, error }) {
  const [nodos, setNodos] = useState(orquestacion.nodes ?? [])
  const [aristas, setAristas] = useState(orquestacion.edges ?? [])
  const [elegido, setElegido] = useState(null)
  const [sucio, setSucio] = useState(false)
  const ejecucion = useOrchestrationRun(orquestacion.id)

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

  // `datos` viene de la paleta y es lo único que cambia entre CI-DS e IBP: el resto del paso —qué
  // hacer si falla, cuántas veces reintentar— lo pone el lienzo igual para los dos.
  function agregarTarea(datos) {
    const id = `n-${Date.now()}-${nodos.length}`
    setNodos((previos) => [...previos, {
      id,
      type: 'task',
      position: {
        x: POSICION_INICIAL.x + previos.length * DESPLAZAMIENTO,
        y: POSICION_INICIAL.y + previos.length * DESPLAZAMIENTO,
      },
      data: {
        ...datos,
        errorStrategy: 'stop',
        maxRetries: 0,
        retryDelaySeconds: 30,
      },
    }])
    setElegido(id)
    marcarSucio()
  }

  function agregarGrupo() {
    const id = `g-${Date.now()}`
    setNodos((previos) => [...previos, {
      id,
      type: 'group',
      position: {
        x: POSICION_INICIAL.x + previos.length * DESPLAZAMIENTO,
        y: POSICION_INICIAL.y + previos.length * DESPLAZAMIENTO,
      },
      style: TAMANIO_DEL_GRUPO,
      data: { label: 'Grupo', errorStrategy: 'stop', maxRetries: 0, retryDelaySeconds: 30, globalVariables: [] },
    }])
    setElegido(id)
    marcarSucio()
  }

  /**
   * Al soltar un paso encima de un grupo, entra en él; al soltarlo fuera, sale.
   *
   * La posición se recalcula relativa al grupo porque la librería del lienzo dibuja a los hijos
   * respecto de su padre: sin convertirla, el paso saltaría lejos al entrar o al salir.
   */
  function alSoltarNodo(_evento, movido) {
    if (movido.type === 'group') return

    const grupos = nodos.filter((nodo) => nodo.type === 'group')
    const absoluta = posicionAbsoluta(movido, nodos)
    const contenedor = grupos.find((grupo) => dentroDe(absoluta, grupo))

    const padreNuevo = contenedor?.id ?? null
    if ((movido.parentId ?? null) === padreNuevo) return

    setNodos((previos) => previos.map((nodo) => {
      if (nodo.id !== movido.id) return nodo
      if (!padreNuevo) {
        // Salir de un grupo es quitarle el padre y el límite que lo ataba a su caja.
        const sinPadre = { ...nodo, position: absoluta }
        delete sinPadre.parentId
        delete sinPadre.extent
        return sinPadre
      }
      return {
        ...nodo,
        parentId: padreNuevo,
        extent: 'parent',
        position: { x: absoluta.x - contenedor.position.x, y: absoluta.y - contenedor.position.y },
      }
    }))
    // Una conexión entre un paso de dentro y uno de fuera no significa nada para el motor: los hijos
    // se ordenan entre ellos. Se quitan al entrar o salir, en vez de dejar una línea que no hace nada.
    setAristas((previas) => previas.filter((arista) => arista.source !== movido.id && arista.target !== movido.id))
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

  /**
   * Los nodos que se dibujan llevan pegado su estado de ejecución, si hay una.
   *
   * Va aquí y no guardado en el nodo a propósito: el estado de una ejecución es efímero y no forma
   * parte del dibujo. Mezclarlos haría que al guardar se escribiera en la base cómo fue una corrida.
   */
  const nodosDibujados = useMemo(() => {
    if (!ejecucion.run) return nodos
    return nodos.map((nodo) => {
      const paso = ejecucion.run.nodes?.[nodo.id]
      return paso ? { ...nodo, data: { ...nodo.data, runStep: paso } } : nodo
    })
  }, [nodos, ejecucion.run])

  // Mientras corre no se edita: mover o borrar un paso a mitad de camino dejaría el dibujo y la
  // ejecución hablando de cosas distintas.
  const editable = !ejecucion.enMarcha

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
          disabled={guardando || !sucio || !editable}
          title={editable ? '' : 'No se puede guardar mientras la orquestación está corriendo'}
        >
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>

      <RunBar
        run={ejecucion.run}
        error={ejecucion.error}
        ocupado={ejecucion.ocupado}
        enMarcha={ejecucion.enMarcha}
        sinGuardar={sucio}
        onArrancar={ejecucion.arrancar}
        onCortar={ejecucion.cortar}
        onRetomar={ejecucion.retomar}
      />

      {/* Debajo de la barra y plegado: la barra dice cuántos pasos van, esto dice qué pasó en cada
          uno. Quien solo quiere ver el avance no lo abre. */}
      <RunDetail orquestacion={{ nodes: nodos }} run={ejecucion.run} leerRegistro={leerRegistro} />

      {error && <div className="notice notice-error lienzo-error">✕ {error}</div>}

      <div className="lienzo-cuerpo">
        {editable && <Paleta destino={destino} onAgregar={agregarTarea} onAgregarGrupo={agregarGrupo} />}

        <div className="lienzo-dibujo">
          <ReactFlow
            nodes={nodosDibujados}
            edges={aristas}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={alSoltarNodo}
            nodesDraggable={editable}
            nodesConnectable={editable}
            elementsSelectable
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

        {nodoElegido && editable && (
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

/** Dónde está un nodo en el lienzo, sumando la posición de su grupo si está dentro de uno. */
function posicionAbsoluta(nodo, nodos) {
  if (!nodo.parentId) return nodo.position
  const padre = nodos.find((otro) => otro.id === nodo.parentId)
  if (!padre) return nodo.position
  return { x: padre.position.x + nodo.position.x, y: padre.position.y + nodo.position.y }
}

/** ¿Cae este punto dentro de la caja de un grupo? */
function dentroDe(punto, grupo) {
  const ancho = grupo.style?.width ?? TAMANIO_DEL_GRUPO.width
  const alto = grupo.style?.height ?? TAMANIO_DEL_GRUPO.height
  return punto.x >= grupo.position.x
    && punto.x <= grupo.position.x + ancho
    && punto.y >= grupo.position.y
    && punto.y <= grupo.position.y + alto
}
