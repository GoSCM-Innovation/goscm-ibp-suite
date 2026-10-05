// El lienzo: dibujar los pasos, conectarlos y configurarlos.
//
// Portado de `canvas/OrchestrationsCanvas.jsx` de v9 (y de la barra del editor de su
// `Orchestrations.jsx`), sobre la misma librería (`@xyflow/react`).
//
// Lo que guarda es exactamente lo que valida `core/orchestrations/graph.js`, incluidas sus dos
// guardas: una conexión que apunte a un nodo inexistente y un ciclo se rechazan. Aquí se evitan antes
// de llegar al servidor: no deja crear una conexión que cierre un ciclo y no autoguarda un grafo que
// ya lo tiene.
//
// Se guarda solo, como en v9: 600 ms después del último cambio. El debounce es lo que evita una
// escritura por cada píxel arrastrado. Si un guardado falla, el error sale en la franja de arriba y no
// se reintenta hasta que haya otro cambio: reintentar solo repetiría el mismo error cada 600 ms.
//
// Desvíos de v9 que se conservan:
//   - Los nodos que ya existían se dibujan donde estaban; solo las entradas/salidas cambian de lado.
//   - Un paso se puede agregar también con un clic en la paleta, no solo arrastrando: arrastrar no
//     funciona con el dedo. Con «Auto» activo, el clic conecta igual que el arrastre.
//   - Al soltar un paso arrastrado dentro de un grupo, el paso entra en él (y sale al soltarlo fuera).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { isTaskPromoted } from '../../../lib/cids.js'
import {
  DATOS_DE_GRUPO_NUEVO,
  DATOS_DE_PASO_NUEVO,
  TAMANIO_DE_GRUPO_NUEVO,
  TIPO_DE_ARRASTRE,
  aristaAnimada,
  autoLayout,
  borrarEnCascada,
  computeGroupMode,
  datosDeTareaSoltada,
  deepestTailPerContext,
  dentroDe,
  esConexionValida,
  grafoParaGuardar,
  grupoEnPunto,
  hasCycle,
  nodeRunState,
  nodeStatusColor,
  nuevoId,
  ordenarPadresPrimero,
  posicionAbsoluta,
  reasignarUltimos,
  resumenDeHijos,
} from '../../../lib/orchestration-canvas.js'
import { usePantallaCompleta } from '../../../lib/usePantallaCompleta.js'
import BotonPantallaCompleta from '../../ui/BotonPantallaCompleta.jsx'
import GroupNode from './GroupNode.jsx'
import NodeConfigPanel from './NodeConfigPanel.jsx'
import RunBar from './RunBar.jsx'
import RunDetail from './RunDetail.jsx'
import RunSingleModal from './RunSingleModal.jsx'
import TaskNode from './TaskNode.jsx'
import TaskPalette from './TaskPalette.jsx'
import { useOrchestrationRun } from './useOrchestrationRun.js'
import './lienzo.css'

/** Dónde cae un paso agregado con un clic. En cascada, para que no se apilen uno encima de otro. */
const POSICION_INICIAL = { x: 80, y: 60 }
const DESPLAZAMIENTO = 40

/** Cuánto se espera tras el último cambio antes de guardar. */
const ESPERA_DE_GUARDADO_MS = 600
/** Cuánto se enseña el aviso de ciclo. */
const AVISO_DE_CICLO_MS = 2500

const nodeTypes = { task: TaskNode, group: GroupNode }

/** Las conexiones se dibujan como en v9: en escalón, y en acento mientras el paso de destino corre. */
const EDGE_DEFAULTS = {
  type: 'smoothstep',
  style: { stroke: 'var(--border2)', strokeWidth: 1.5 },
  animated: false,
}

/** ¿Este cambio de nodo es un cambio del DIBUJO? Seleccionar o medir un nodo no lo es. */
function cambiaElDibujo(cambio) {
  if (cambio.type === 'select') return false
  // Medir un nodo al dibujarlo no es un cambio; redimensionarlo con las esquinas sí.
  if (cambio.type === 'dimensions') return Boolean(cambio.setAttributes) || typeof cambio.resizing === 'boolean'
  return true
}

export default function OrchestrationCanvas(props) {
  // La librería necesita su proveedor para `screenToFlowPosition` y `fitView`.
  return (
    <ReactFlowProvider>
      <Lienzo {...props} />
    </ReactFlowProvider>
  )
}

function Lienzo({
  leerRegistro,
  Paleta = TaskPalette,
  destino,
  orquestacion,
  onGuardar,
  guardando,
  error,
  transportadas = null,
  onRenombrar,
  onSinGuardar,
}) {
  // El grafo es UN estado, no dos: borrar un grupo toca nodos y aristas a la vez, y con dos estados
  // habría un instante con unos hijos sin padre.
  //
  // No hay efecto que copie la orquestación al estado: quien monta este componente le pone una clave
  // con su identificador, así que cambiar de orquestación lo remonta y el estado nace del grafo
  // correcto. Copiarlo con un efecto además pisaría lo que estés dibujando cada vez que se guarde.
  const [grafo, setGrafo] = useState(() => ({
    nodes: ordenarPadresPrimero(orquestacion.nodes ?? []),
    edges: orquestacion.edges ?? [],
  }))
  const [elegido, setElegido] = useState(null)
  const [sucio, setSucio] = useState(false)
  const [guardandoAqui, setGuardandoAqui] = useState(false)
  const [avisoDeCiclo, setAvisoDeCiclo] = useState(false)
  const [autoConectar, setAutoConectar] = useState(false)
  const [pasoSuelto, setPasoSuelto] = useState(null)
  const [editandoNombre, setEditandoNombre] = useState(false)
  const [textoDelNombre, setTextoDelNombre] = useState('')
  const [nombreNuevo, setNombreNuevo] = useState(null)

  const ejecucion = useOrchestrationRun(orquestacion.id, orquestacion.name)
  const lienzoRef = useRef(null)
  const dibujoRef = useRef(null)
  const pantalla = usePantallaCompleta(lienzoRef)
  const flujo = useReactFlow()

  // Mientras corre no se edita: mover o borrar un paso a mitad de camino dejaría el dibujo y la
  // ejecución hablando de cosas distintas.
  const editable = !ejecucion.enMarcha

  // ── Qué cambió desde el último guardado ──────────────────────────────────────────────────────
  //
  // `cambios` cuenta los cambios del dibujo; el guardado recuerda el número que tenía al arrancar, y
  // solo da el dibujo por guardado si no hubo más mientras tanto.
  const cambios = useRef(0)
  const falloEn = useRef(null)
  const marcarCambio = useCallback(() => {
    cambios.current += 1
    setSucio(true)
  }, [])

  const alGuardarRef = useRef(onGuardar)
  const alSinGuardarRef = useRef(onSinGuardar)
  useEffect(() => {
    alGuardarRef.current = onGuardar
    alSinGuardarRef.current = onSinGuardar
  })

  // ── Conectar solo ────────────────────────────────────────────────────────────────────────────
  // El último paso agregado de cada contexto (el primer nivel, o un grupo).
  const ultimos = useRef(new Map())
  const temporizadores = useRef({})
  useEffect(() => {
    const guardados = temporizadores.current
    return () => Object.values(guardados).forEach(clearTimeout)
  }, [])

  // El servidor rechaza un ciclo en cualquier nivel (el primero o dentro de un grupo), así que el
  // autoguardado tampoco lo intenta.
  const cicloGuardado = useMemo(
    () => hasCycle(grafo.nodes, grafo.edges),
    [grafo.nodes, grafo.edges],
  )

  // ── Autoguardado ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sucio || !editable || guardandoAqui || cicloGuardado) return undefined
    // Ya falló con este mismo dibujo: volver a intentarlo daría el mismo error. Espera a otro cambio.
    if (falloEn.current === cambios.current) return undefined

    const espera = setTimeout(() => {
      const version = cambios.current
      setGuardandoAqui(true)
      Promise.resolve()
        .then(() => alGuardarRef.current(grafoParaGuardar(grafo.nodes, grafo.edges)))
        .then(() => { if (cambios.current === version) setSucio(false) })
        .catch(() => { falloEn.current = version })
        .finally(() => setGuardandoAqui(false))
    }, ESPERA_DE_GUARDADO_MS)

    return () => clearTimeout(espera)
  }, [grafo, sucio, editable, guardandoAqui, cicloGuardado])

  // Lo que ve quien está arriba: hay cambios que todavía no están en la base. Incluye el guardado en
  // vuelo y el que falló, que sigue sin guardar.
  const pendiente = sucio || guardandoAqui || Boolean(guardando)
  useEffect(() => { alSinGuardarRef.current?.(pendiente) }, [pendiente])
  useEffect(() => () => alSinGuardarRef.current?.(false), [])

  // ── Cambios que mandan la librería y el panel ────────────────────────────────────────────────

  const onNodesChange = useCallback((recibidos) => {
    // Con una ejecución en marcha solo se deja seleccionar y medir.
    const cambiosDeNodos = editable
      ? recibidos
      : recibidos.filter((cambio) => cambio.type === 'select' || (cambio.type === 'dimensions' && !cambiaElDibujo(cambio)))
    if (cambiosDeNodos.length === 0) return

    setGrafo((previo) => {
      const quitados = cambiosDeNodos.filter((cambio) => cambio.type === 'remove').map((cambio) => cambio.id)
      const nodes = applyNodeChanges(cambiosDeNodos, previo.nodes)
      if (quitados.length === 0) return { ...previo, nodes }
      // Borrar un grupo con la tecla también se lleva a sus hijos y a las conexiones de todos.
      const resto = borrarEnCascada(nodes, previo.edges, quitados)
      return { nodes: resto.nodes, edges: resto.edges }
    })
    if (cambiosDeNodos.some(cambiaElDibujo)) marcarCambio()
  }, [editable, marcarCambio])

  const onEdgesChange = useCallback((recibidos) => {
    const cambiosDeAristas = editable ? recibidos : recibidos.filter((cambio) => cambio.type === 'select')
    if (cambiosDeAristas.length === 0) return
    setGrafo((previo) => ({ ...previo, edges: applyEdgeChanges(cambiosDeAristas, previo.edges) }))
    if (cambiosDeAristas.some((cambio) => cambio.type !== 'select')) marcarCambio()
  }, [editable, marcarCambio])

  const isValidConnection = useCallback(
    (conexion) => esConexionValida(conexion, grafo.nodes),
    [grafo.nodes],
  )

  const onConnect = useCallback((conexion) => {
    if (!editable) return
    const id = `e-${conexion.source}-${conexion.target}`
    if (grafo.edges.some((arista) => arista.id === id)) return
    const nuevas = [...grafo.edges, { id, source: conexion.source, target: conexion.target }]

    if (hasCycle(grafo.nodes, nuevas)) {
      // Se rechaza al instante y no se crea la arista: guardar un ciclo dejaría pasos que no corren.
      setAvisoDeCiclo(true)
      clearTimeout(temporizadores.current.ciclo)
      temporizadores.current.ciclo = setTimeout(() => setAvisoDeCiclo(false), AVISO_DE_CICLO_MS)
      return
    }
    setGrafo({ ...grafo, edges: nuevas })
    marcarCambio()
  }, [editable, grafo, marcarCambio])

  // ── Agregar pasos y grupos ───────────────────────────────────────────────────────────────────

  /**
   * Mete un paso nuevo y, si «Auto» está activo, lo conecta al último agregado de su mismo contexto.
   * El «último» se recuerda siempre y se olvida al apagar «Auto», como en v9.
   */
  function insertarPaso(nuevo) {
    const nodes = [...grafo.nodes, nuevo]
    let edges = grafo.edges

    ultimos.current = reasignarUltimos(ultimos.current, grafo.nodes)
    const contexto = nuevo.parentId ?? null
    const anterior = ultimos.current.get(contexto)
    if (autoConectar && anterior) {
      edges = [...edges, { id: `e-${anterior}-${nuevo.id}`, source: anterior, target: nuevo.id }]
    }
    ultimos.current.set(contexto, nuevo.id)

    setGrafo({ nodes: ordenarPadresPrimero(nodes), edges })
    setElegido(nuevo.id)
    marcarCambio()
  }

  // `datos` viene de la paleta y es lo único que cambia entre CI-DS e IBP: el resto del paso —qué
  // hacer si falla, cuántas veces reintentar— lo pone el lienzo igual para los dos.
  function agregarTarea(datos) {
    if (!editable) return
    const cuantos = grafo.nodes.length
    insertarPaso({
      id: nuevoId('n'),
      type: 'task',
      position: {
        x: POSICION_INICIAL.x + cuantos * DESPLAZAMIENTO,
        y: POSICION_INICIAL.y + cuantos * DESPLAZAMIENTO,
      },
      data: { ...DATOS_DE_PASO_NUEVO, globalVariables: [], ...datos, errorStrategy: 'stop', maxRetries: 0, retryDelaySeconds: 30 },
    })
  }

  function agregarGrupo() {
    if (!editable) return
    // Nace al centro de lo que se está viendo del lienzo, no en una esquina que quizá ni se ve.
    const caja = dibujoRef.current?.getBoundingClientRect()
    const centro = caja && caja.width > 0
      ? { x: caja.left + caja.width / 2, y: caja.top + caja.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    const punto = flujo.screenToFlowPosition(centro)

    const nuevo = {
      id: nuevoId('g'),
      type: 'group',
      position: {
        x: punto.x - TAMANIO_DE_GRUPO_NUEVO.width / 2,
        y: punto.y - TAMANIO_DE_GRUPO_NUEVO.height / 2,
      },
      style: { ...TAMANIO_DE_GRUPO_NUEVO },
      data: { ...DATOS_DE_GRUPO_NUEVO, globalVariables: [] },
    }
    setGrafo({ nodes: [...grafo.nodes, nuevo], edges: grafo.edges })
    setElegido(nuevo.id)
    marcarCambio()
  }

  /** Soltar una tarea arrastrada desde la paleta. Si cae dentro de un grupo, nace como hijo suyo. */
  function alSoltar(evento) {
    evento.preventDefault()
    if (!editable) return
    const datos = datosDeTareaSoltada(evento.dataTransfer?.getData(TIPO_DE_ARRASTRE))
    if (!datos) return

    const punto = flujo.screenToFlowPosition({ x: evento.clientX, y: evento.clientY })
    const grupo = grupoEnPunto(grafo.nodes, punto)
    insertarPaso({
      id: nuevoId('n'),
      type: 'task',
      position: grupo ? { x: punto.x - grupo.position.x, y: punto.y - grupo.position.y } : punto,
      ...(grupo ? { parentId: grupo.id, extent: 'parent' } : {}),
      data: datos,
    })
  }

  function alArrastrarSobre(evento) {
    if (!Array.from(evento.dataTransfer?.types ?? []).includes(TIPO_DE_ARRASTRE)) return
    evento.preventDefault()
    evento.dataTransfer.dropEffect = editable ? 'copy' : 'none'
  }

  /** ⚡ Auto: al encenderlo se retoma la cola de cada cadena, para seguir donde se había quedado. */
  function alternarAutoConectar() {
    const encender = !autoConectar
    setAutoConectar(encender)
    ultimos.current = new Map()
    if (!encender) return
    const tareas = grafo.nodes.filter((nodo) => nodo.type === 'task')
    for (const [contexto, id] of deepestTailPerContext(tareas, grafo.edges)) {
      ultimos.current.set(contexto, id)
    }
  }

  /** ⊞ Auto Layout: ordena por columnas y vuelve a encuadrar. */
  function ordenarAutomaticamente() {
    if (!editable) return
    setGrafo({ nodes: autoLayout(grafo.nodes, grafo.edges), edges: grafo.edges })
    marcarCambio()
    clearTimeout(temporizadores.current.encuadre)
    temporizadores.current.encuadre = setTimeout(() => flujo.fitView({ padding: 0.15 }), 50)
  }

  /**
   * Al soltar un paso encima de un grupo, entra en él; al soltarlo fuera, sale.
   *
   * La posición se recalcula relativa al grupo porque la librería del lienzo dibuja a los hijos
   * respecto de su padre: sin convertirla, el paso saltaría lejos al entrar o al salir.
   */
  function alSoltarNodo(_evento, movido) {
    if (!editable || movido.type === 'group') return

    const absoluta = posicionAbsoluta(movido, grafo.nodes)
    const contenedor = grafo.nodes.find((nodo) => nodo.type === 'group' && dentroDe(absoluta, nodo))

    const padreNuevo = contenedor?.id ?? null
    if ((movido.parentId ?? null) === padreNuevo) return

    const nodes = grafo.nodes.map((nodo) => {
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
    })
    // Una conexión entre un paso de dentro y uno de fuera no significa nada para el motor: los hijos
    // se ordenan entre ellos. Se quitan al entrar o salir, en vez de dejar una línea que no hace nada.
    const edges = grafo.edges.filter((arista) => arista.source !== movido.id && arista.target !== movido.id)
    setGrafo({ nodes: ordenarPadresPrimero(nodes), edges })
    marcarCambio()
  }

  // ── Panel del nodo ───────────────────────────────────────────────────────────────────────────

  function cambiarDatos(datos) {
    setGrafo((previo) => ({
      ...previo,
      nodes: previo.nodes.map((nodo) => (nodo.id === elegido ? { ...nodo, data: datos } : nodo)),
    }))
    marcarCambio()
  }

  function quitarElegido() {
    // Un grupo se lleva a sus hijos y las conexiones de todos: dejarlos haría un grafo que el
    // servidor rechaza («dice estar dentro de un grupo que no existe»).
    const resto = borrarEnCascada(grafo.nodes, grafo.edges, [elegido])
    setGrafo({ nodes: resto.nodes, edges: resto.edges })
    setElegido(null)
    marcarCambio()
  }

  /** Cerrar el panel también suelta la selección: si no, volver a pulsar el mismo nodo no lo reabriría. */
  function cerrarPanel() {
    setGrafo((previo) => ({ ...previo, nodes: previo.nodes.map((nodo) => (nodo.selected ? { ...nodo, selected: false } : nodo)) }))
    setElegido(null)
  }

  const alCambiarSeleccion = useCallback(
    ({ nodes: elegidos }) => setElegido(elegidos?.[0]?.id ?? null),
    [],
  )

  // ── El nombre de la orquestación ─────────────────────────────────────────────────────────────
  // Mientras se guarda se muestra el nombre nuevo; si el guardado falla, vuelve el anterior. El nombre
  // nuevo recuerda sobre qué nombre se escribió: cuando quien está arriba actualiza el suyo, deja de
  // hacer falta y manda el de arriba.
  const nombreMostrado = nombreNuevo && nombreNuevo.base === orquestacion.name
    ? nombreNuevo.valor
    : orquestacion.name

  function empezarAEditarNombre() {
    if (!editable) return
    setTextoDelNombre(nombreMostrado)
    setEditandoNombre(true)
  }

  const editandoRef = useRef(false)
  useEffect(() => { editandoRef.current = editandoNombre })

  function terminarEdicion(guardar) {
    // Enter y el desenfoque que le sigue llegan los dos: solo el primero cuenta.
    if (!editandoRef.current) return
    editandoRef.current = false
    setEditandoNombre(false)
    const siguiente = textoDelNombre.trim()
    if (!guardar || !siguiente || siguiente === nombreMostrado || !onRenombrar) return

    const base = orquestacion.name
    setNombreNuevo({ base, valor: siguiente })
    Promise.resolve(onRenombrar(siguiente)).catch(() => setNombreNuevo(null))
  }

  // ── Lo que se dibuja ─────────────────────────────────────────────────────────────────────────

  const abrirEjecucionSuelta = useCallback((id) => {
    const nodo = grafo.nodes.find((otro) => otro.id === id)
    if (nodo) setPasoSuelto(nodo)
  }, [grafo.nodes])

  /**
   * Los nodos que se dibujan llevan pegado su estado de ejecución, si hay una.
   *
   * Va aquí y no guardado en el nodo a propósito: el estado de una ejecución es efímero y no forma
   * parte del dibujo. Mezclarlos haría que al guardar se escribiera en la base cómo fue una corrida.
   * El estado de un paso dentro de un grupo cuelga del de su grupo (`nodeRunState`).
   */
  const nodosDibujados = useMemo(() => grafo.nodes.map((nodo) => {
    const paso = nodeRunState(ejecucion.run, grafo.nodes, nodo.id)
    const esGrupo = nodo.type === 'group'
    return {
      ...nodo,
      data: {
        ...nodo.data,
        runStep: paso ?? undefined,
        runStatus: paso?.status ?? 'pending',
        sapRunId: paso?.sapRunId ?? null,
        bloqueado: !editable,
        ...(esGrupo
          ? {
            childSummary: resumenDeHijos(paso),
            groupMode: computeGroupMode(nodo.id, grafo.nodes, grafo.edges),
          }
          : {
            promoted: isTaskPromoted(transportadas, nodo.data?.taskName),
            onRunSingle: nodo.data?.taskName ? abrirEjecucionSuelta : undefined,
          }),
      },
    }
  }), [grafo.nodes, grafo.edges, ejecucion.run, editable, transportadas, abrirEjecucionSuelta])

  const aristasDibujadas = useMemo(() => grafo.edges.map((arista) => {
    const animada = aristaAnimada(ejecucion.run, grafo.nodes, arista)
    return {
      ...arista,
      ...EDGE_DEFAULTS,
      style: { stroke: animada ? 'var(--accent)' : 'var(--border2)', strokeWidth: 1.5 },
      animated: animada,
    }
  }), [grafo.edges, grafo.nodes, ejecucion.run])

  const nodoElegido = useMemo(() => grafo.nodes.find((nodo) => nodo.id === elegido) ?? null, [grafo.nodes, elegido])
  const detalleDeEjecucion = useMemo(() => ({ nodes: grafo.nodes }), [grafo.nodes])
  const colorEnElMapa = useCallback((nodo) => nodeStatusColor(nodo.data?.runStatus), [])

  const cuenta = grafo.nodes.length

  return (
    <div className="lienzo a-pantalla-completa" ref={lienzoRef}>
      <div className="lienzo-barra">
        {editandoNombre ? (
          <input
            className="lienzo-nombre-input"
            value={textoDelNombre}
            autoFocus
            onChange={(evento) => setTextoDelNombre(evento.target.value)}
            onBlur={() => terminarEdicion(true)}
            onKeyDown={(evento) => {
              if (evento.key === 'Enter') terminarEdicion(true)
              if (evento.key === 'Escape') terminarEdicion(false)
            }}
            aria-label="Nombre de la orquestación"
          />
        ) : (
          <span
            className={`lienzo-nombre${editable ? ' lienzo-nombre-editable' : ''}`}
            onClick={empezarAEditarNombre}
            title={editable ? 'Click para editar' : undefined}
          >
            {nombreMostrado}
          </span>
        )}
        <span className="lienzo-cuenta">{cuenta} {cuenta === 1 ? 'paso' : 'pasos'}</span>
        <div style={{ flex: 1 }} />
        {(guardandoAqui || guardando) && <span className="lienzo-guardando">Guardando…</span>}
        <button
          type="button"
          className={`btn btn-sm${autoConectar ? ' auto-activo' : ''}`}
          onClick={alternarAutoConectar}
          aria-pressed={autoConectar}
          title="Conectar automáticamente cada task al anterior al soltarlo en el canvas"
        >
          ⚡{autoConectar ? ' Auto ON' : ' Auto'}
        </button>
        <BotonPantallaCompleta {...pantalla} que="el lienzo" />
      </div>

      <RunBar
        run={ejecucion.run}
        error={ejecucion.error}
        ocupado={ejecucion.ocupado}
        enMarcha={ejecucion.enMarcha}
        sinGuardar={pendiente}
        onArrancar={ejecucion.arrancar}
        onCortar={ejecucion.cortar}
        onRetomar={ejecucion.retomar}
        grafo={grafo}
        destino={destino}
      />

      {/* Debajo de la barra y plegado: la barra dice cuántos pasos van, esto dice qué pasó en cada
          uno. Quien solo quiere ver el avance no lo abre. */}
      <RunDetail orquestacion={detalleDeEjecucion} run={ejecucion.run} leerRegistro={leerRegistro} />

      {error && <div className="notice notice-error lienzo-error">✕ {error}</div>}

      <div className="lienzo-cuerpo">
        {/* La paleta sigue a la vista mientras corre: lo que no se puede es soltar nada en el lienzo. */}
        <Paleta
          destino={destino}
          onAgregar={agregarTarea}
          onAgregarGrupo={agregarGrupo}
          transportadas={transportadas}
        />

        <div
          className="lienzo-dibujo"
          ref={dibujoRef}
          onDragOver={alArrastrarSobre}
          onDrop={alSoltar}
        >
          <ReactFlow
            nodes={nodosDibujados}
            edges={aristasDibujadas}
            nodeTypes={nodeTypes}
            defaultEdgeOptions={EDGE_DEFAULTS}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onNodeDragStop={alSoltarNodo}
            nodesDraggable={editable}
            nodesConnectable={editable}
            elementsSelectable
            // La tecla es Supr/Delete, como en v9; por omisión la librería usa Retroceso, que en un
            // campo de texto del panel es borrar una letra y no un nodo.
            deleteKeyCode={editable ? 'Delete' : null}
            onSelectionChange={alCambiarSeleccion}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: false }}
          >
            <Background gap={20} size={1} />
            <Controls />
            <MiniMap nodeColor={colorEnElMapa} maskColor="rgba(11,17,32,0.7)" />

            <Panel position="top-left" className="lienzo-panel">
              <button
                type="button"
                className="lienzo-boton-orden"
                onClick={ordenarAutomaticamente}
                disabled={!editable}
              >
                ⊞ Auto Layout
              </button>
            </Panel>

            {(!editable || avisoDeCiclo || cicloGuardado) && (
              <Panel position="top-center" className="lienzo-panel">
                {!editable && (
                  <div className="lienzo-aviso bloqueado">
                    <span style={{ fontSize: 14 }}>⬡</span> Canvas bloqueado — orquestacion en ejecucion
                  </div>
                )}
                {avisoDeCiclo && (
                  <div className="lienzo-aviso ciclo" role="alert">⚠ Ciclo detectado — esa conexión crearía un bucle</div>
                )}
                {cicloGuardado && !avisoDeCiclo && (
                  <div className="lienzo-aviso ciclo" role="alert">
                    ⚠ Hay un ciclo en las conexiones: no se guarda hasta que lo quites
                  </div>
                )}
              </Panel>
            )}
          </ReactFlow>

          {cuenta === 0 && (
            <div className="lienzo-vacio">
              <div className="lienzo-vacio-icono">⬡</div>
              <div className="lienzo-vacio-titulo">Arrastra tasks desde el panel izquierdo</div>
              <div className="lienzo-vacio-sub">Conecta los nodos para definir el orden de ejecución</div>
            </div>
          )}
        </div>

        {nodoElegido && editable && (
          <NodeConfigPanel
            key={nodoElegido.id}
            destino={destino}
            nodo={nodoElegido}
            onCambiar={cambiarDatos}
            onBorrar={quitarElegido}
            onCerrar={cerrarPanel}
          />
        )}
      </div>

      {pasoSuelto && (
        <RunSingleModal
          destino={destino}
          nodo={{
            id: pasoSuelto.id,
            taskName: pasoSuelto.data?.taskName,
            taskGuid: pasoSuelto.data?.taskGuid,
            agentName: pasoSuelto.data?.agentName,
            profileName: pasoSuelto.data?.profileName,
            globalVariables: pasoSuelto.data?.globalVariables ?? [],
          }}
          onClose={() => setPasoSuelto(null)}
        />
      )}
    </div>
  )
}
