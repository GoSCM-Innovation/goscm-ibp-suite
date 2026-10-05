// La lógica del lienzo de orquestaciones que no necesita React: ciclos, olas, orden automático,
// modo de un grupo, estado de ejecución de cada nodo y cómo se guarda el dibujo.
//
// Portado de `canvasUtils.js` y de las funciones sueltas de `canvas/OrchestrationsCanvas.jsx` de v9.
// Está aparte del componente para poder probarlo sin dibujar nada, y porque las reglas que importan
// aquí —qué conexión es válida, qué se borra con un grupo, qué se manda a guardar— no deben depender
// de cómo las pinta la librería del lienzo.

// ─── Colores e iconos de estado ──────────────────────────────────────────────────────────────────

/**
 * Cada estado de un paso, en hex. Son los de v9 (`STATUS_COLORS`): están en hex y no en variables del
 * tema porque se les saca transparencia (`conAlfa`) y porque el mapa de la esquina los necesita
 * resueltos.
 */
export const STATUS_COLORS = Object.freeze({
  pending: '#64748b',
  running: '#22c55e',
  success: '#34d399',
  success_with_errors: '#fbbf24',
  error: '#ff6b6b',
  cancelled: '#94a3b8',
  skipped: '#475569',
})

export const STATUS_ICONS = Object.freeze({
  pending: '○',
  running: '◉',
  success: '✓',
  success_with_errors: '⚠',
  error: '✕',
  cancelled: '⊘',
  skipped: '–',
})

/** Nunca devuelve `undefined`: un estado desconocido se pinta como pendiente. */
export const nodeStatusColor = (status) => STATUS_COLORS[status] ?? STATUS_COLORS.pending
export const nodeStatusIcon = (status) => STATUS_ICONS[status] ?? STATUS_ICONS.pending

/** Qué se hace si el paso falla: color y etiqueta de v9. */
export const STRATEGY_COLOR = Object.freeze({ stop: '#64748b', continue: '#fbbf24', retry: '#3b82f6' })
export const STRATEGY_LABEL = Object.freeze({
  stop: 'error: detener',
  continue: 'error: continuar',
  retry: 'error: reintentar',
})

/**
 * El color de la franja izquierda de una tarea según su tipo. `TASK` es el valor por omisión, como
 * en v9: es lo que se pintaba ante un tipo ausente.
 */
export const TASK_TYPE_COLOR = Object.freeze({ PROCESS: '#8b5cf6', TASK: '#06b6d4' })
export const colorDeTipo = (tipo) => TASK_TYPE_COLOR[tipo] ?? TASK_TYPE_COLOR.TASK

/** Cómo corren los hijos de un grupo, según las conexiones entre ellos. */
export const GROUP_MODE_STYLES = Object.freeze({
  parallel: { color: '#29ABE2', label: '⊞ En paralelo' },
  serial: { color: '#F7A800', label: '→ En secuencia' },
  hybrid: { color: '#8b5cf6', label: '⟛ Híbrido' },
})

/** `#rrggbb` + transparencia → `rgba(...)`. Con algo que no es un hex de seis dígitos devuelve el color tal cual. */
export function conAlfa(hex, alfa) {
  const limpio = /^#([0-9a-f]{6})$/i.exec(String(hex ?? ''))
  if (!limpio) return hex
  const valor = parseInt(limpio[1], 16)
  return `rgba(${(valor >> 16) & 255}, ${(valor >> 8) & 255}, ${valor & 255}, ${alfa})`
}

// ─── Estado de ejecución de cada nodo ────────────────────────────────────────────────────────────

/**
 * El estado de ejecución de un nodo, sea de primer nivel o hijo de un grupo.
 *
 * Los hijos NO están en `run.nodes[hijo]`: cuelgan del estado de su grupo, en
 * `run.nodes[grupo].children[hijo]`. Buscarlos arriba devolvía siempre `undefined` y los pasos de
 * dentro de un grupo nunca se pintaban.
 */
export function nodeRunState(run, nodes, nodeId) {
  if (!run?.nodes) return null
  const nodo = nodes.find((otro) => otro.id === nodeId)
  if (!nodo) return null
  const estado = nodo.parentId
    ? run.nodes[nodo.parentId]?.children?.[nodeId]
    : run.nodes[nodeId]
  return estado ?? null
}

/** «N/M completadas» de un grupo, o `null` si no tiene hijos con estado. Completada es todo menos pendiente o corriendo. */
export function resumenDeHijos(estadoDelGrupo) {
  const hijos = Object.values(estadoDelGrupo?.children ?? {})
  if (hijos.length === 0) return null
  const hechos = hijos.filter((hijo) => !['pending', 'running'].includes(hijo.status)).length
  return `${hechos}/${hijos.length} completadas`
}

/** Una arista se anima cuando el paso de donde sale terminó bien y aquel al que llega está corriendo. */
export function aristaAnimada(run, nodes, arista) {
  const origen = nodeRunState(run, nodes, arista.source)
  const destino = nodeRunState(run, nodes, arista.target)
  return origen?.status === 'success' && destino?.status === 'running'
}

// ─── Modo de un grupo ────────────────────────────────────────────────────────────────────────────

/**
 * Cómo corren los hijos de un grupo: sin conexiones entre ellos, a la vez; con todos conectados,
 * en fila; con algunos sueltos, un híbrido.
 */
export function computeGroupMode(groupId, nodes, edges) {
  const hijos = nodes.filter((nodo) => nodo.parentId === groupId)
  if (hijos.length === 0) return 'parallel'
  const ids = new Set(hijos.map((hijo) => hijo.id))
  const internas = edges.filter((arista) => ids.has(arista.source) && ids.has(arista.target))
  if (internas.length === 0) return 'parallel'
  const conectados = new Set(internas.flatMap((arista) => [arista.source, arista.target]))
  return hijos.every((hijo) => conectados.has(hijo.id)) ? 'serial' : 'hybrid'
}

// ─── Ciclos, olas y orden automático ─────────────────────────────────────────────────────────────

/**
 * ¿Hay un ciclo entre los nodos de UN nivel: el primer nivel (`padre = null`) o los hijos de un
 * grupo? Es el recorrido de Kahn del motor: lo que sobra al terminar está en un ciclo o cuelga de uno.
 */
export function hasCycleInContext(nodes, edges, padre = null) {
  const nivel = nodes.filter((nodo) => (nodo.parentId ?? null) === padre)
  const entrantes = new Map(nivel.map((nodo) => [nodo.id, 0]))
  const salientes = new Map(nivel.map((nodo) => [nodo.id, []]))
  for (const arista of edges) {
    if (!salientes.has(arista.source) || !entrantes.has(arista.target)) continue
    salientes.get(arista.source).push(arista.target)
    entrantes.set(arista.target, entrantes.get(arista.target) + 1)
  }
  let listos = nivel.filter((nodo) => entrantes.get(nodo.id) === 0).map((nodo) => nodo.id)
  let visitados = 0
  while (listos.length > 0) {
    const siguientes = []
    for (const id of listos) {
      visitados += 1
      for (const destino of salientes.get(id)) {
        entrantes.set(destino, entrantes.get(destino) - 1)
        if (entrantes.get(destino) === 0) siguientes.push(destino)
      }
    }
    listos = siguientes
  }
  return visitados < nivel.length
}

/**
 * ¿Hay un ciclo en cualquier nivel? v9 solo miraba el primer nivel, que es lo único que valida el
 * servidor al guardar. Pero el motor ordena los hijos de un grupo con el mismo recorrido, y un ciclo
 * entre ellos los dejaría sin ejecutar en silencio; por eso aquí se miran todos.
 */
export function hasCycle(nodes, edges) {
  const niveles = new Set(nodes.map((nodo) => nodo.parentId ?? null))
  niveles.add(null)
  return [...niveles].some((nivel) => hasCycleInContext(nodes, edges, nivel))
}

/**
 * Las olas de un orden topológico entre los nodos de primer nivel: la columna de cada uno y los
 * nodos por columna. Los nodos de un ciclo no entran en ninguna.
 */
export function computeWaves(nodes, edges) {
  const primerNivel = nodes.filter((nodo) => !nodo.parentId)
  const entrantes = {}
  const salientes = {}
  for (const nodo of primerNivel) {
    entrantes[nodo.id] = 0
    salientes[nodo.id] = []
  }
  for (const arista of edges) {
    if (arista.source in salientes && arista.target in entrantes) {
      salientes[arista.source].push(arista.target)
      entrantes[arista.target] += 1
    }
  }

  const colOf = {}
  let listos = primerNivel.filter((nodo) => entrantes[nodo.id] === 0).map((nodo) => nodo.id)
  let columna = 0
  while (listos.length > 0) {
    listos.forEach((id) => { colOf[id] = columna })
    const siguientes = []
    for (const id of listos) {
      for (const destino of salientes[id]) {
        entrantes[destino] -= 1
        if (entrantes[destino] === 0) siguientes.push(destino)
      }
    }
    listos = siguientes
    columna += 1
  }

  const byCol = {}
  for (const [id, col] of Object.entries(colOf)) {
    byCol[col] = byCol[col] ?? []
    byCol[col].push(id)
  }
  return { colOf, byCol, cols: columna }
}

/** Lo que mide un nodo para ordenarlo: su caja si ya la tiene, y si no, la de una tarea (210 de ancho). */
const ANCHO_DE_TAREA = 210
const ALTO_DE_GRUPO = 180
const ANCHO_DE_GRUPO = 300

export function tamanoDeGrupo(grupo) {
  return {
    width: grupo.width ?? grupo.measured?.width ?? grupo.style?.width ?? ANCHO_DE_GRUPO,
    height: grupo.height ?? grupo.measured?.height ?? grupo.style?.height ?? ALTO_DE_GRUPO,
  }
}

/**
 * Ordena por columnas, de izquierda a derecha: cada ola en una columna y cada nodo de la ola en una
 * fila. Los hijos de un grupo no se tocan (su posición es relativa a su grupo).
 *
 * Con solo tareas da las mismas posiciones que v9 (columnas de 260, filas de 160, margen de 40 y 60).
 * Se desvía en una cosa: v9 ignoraba el tamaño de los grupos, así que uno de 300×180 se encimaba con
 * el siguiente de su columna y con la columna de al lado. Aquí una fila mide lo que mida su nodo más
 * 20, y una columna lo que mida el más ancho más 50; para tareas eso es exactamente 160 y 260.
 */
export function autoLayout(nodes, edges) {
  const { byCol } = computeWaves(nodes, edges)
  const COL_W = 260
  const ROW_H = 160
  const PAD_X = 40
  const PAD_Y = 60

  const porId = new Map(nodes.map((nodo) => [nodo.id, nodo]))
  const nuevas = new Map()

  const columnas = Object.keys(byCol).map(Number).sort((a, b) => a - b)
  let x = PAD_X
  for (const col of columnas) {
    const ids = byCol[col]
    let y = PAD_Y
    let masAncho = ANCHO_DE_TAREA
    for (const id of ids) {
      const nodo = porId.get(id)
      const caja = nodo.type === 'group'
        ? tamanoDeGrupo(nodo)
        : { width: ANCHO_DE_TAREA, height: 0 }
      nuevas.set(id, { x, y })
      y += Math.max(ROW_H, caja.height + 20)
      masAncho = Math.max(masAncho, caja.width)
    }
    x += Math.max(COL_W, masAncho + 50)
  }

  return nodes.map((nodo) => {
    if (nodo.parentId) return nodo
    const posicion = nuevas.get(nodo.id)
    return posicion ? { ...nodo, position: posicion } : nodo
  })
}

// ─── Conectar solo ───────────────────────────────────────────────────────────────────────────────

/**
 * La cola de la cadena de cada contexto (el primer nivel o un grupo): el task del que no sale
 * ninguna conexión hacia otro de su contexto. Si hay varias colas independientes es ambiguo, y se
 * deja que el usuario decida a mano: ese contexto no entra en el resultado.
 */
export function deepestTailPerContext(taskNodes, edges) {
  const resultado = new Map()
  const contextos = new Set(taskNodes.map((nodo) => nodo.parentId ?? null))
  for (const contexto of contextos) {
    const delContexto = taskNodes.filter((nodo) => (nodo.parentId ?? null) === contexto)
    if (delContexto.length === 0) continue
    const colas = delContexto.filter((nodo) => (
      !edges.some((arista) => arista.source === nodo.id && delContexto.some((otro) => otro.id === arista.target))
    ))
    if (colas.length !== 1) continue
    resultado.set(contexto, colas[0].id)
  }
  return resultado
}

/**
 * Tras borrar nodos: el «último agregado» de un contexto que ya no existe pasa a ser el último task
 * que quede en ese contexto, o se olvida si no queda ninguno. Devuelve un mapa nuevo.
 */
export function reasignarUltimos(ultimos, nodes) {
  const siguiente = new Map()
  for (const [contexto, id] of ultimos) {
    if (nodes.some((nodo) => nodo.id === id)) {
      siguiente.set(contexto, id)
      continue
    }
    const quedan = nodes.filter((nodo) => nodo.type === 'task' && (nodo.parentId ?? null) === contexto)
    if (quedan.length > 0) siguiente.set(contexto, quedan[quedan.length - 1].id)
  }
  return siguiente
}

// ─── Conexiones ──────────────────────────────────────────────────────────────────────────────────

/** Una conexión es válida si no va de un nodo a sí mismo y une dos nodos del mismo contexto (mismo padre). */
export function esConexionValida(conexion, nodes) {
  if (conexion.source === conexion.target) return false
  const origen = nodes.find((nodo) => nodo.id === conexion.source)
  const destino = nodes.find((nodo) => nodo.id === conexion.target)
  return (origen?.parentId ?? null) === (destino?.parentId ?? null)
}

// ─── Grupos y posiciones ─────────────────────────────────────────────────────────────────────────

/** Dónde está un nodo en el lienzo, sumando la posición de su grupo si está dentro de uno. */
export function posicionAbsoluta(nodo, nodes) {
  if (!nodo.parentId) return nodo.position
  const padre = nodes.find((otro) => otro.id === nodo.parentId)
  if (!padre) return nodo.position
  return { x: padre.position.x + nodo.position.x, y: padre.position.y + nodo.position.y }
}

/** ¿Cae este punto dentro de la caja de un grupo? */
export function dentroDe(punto, grupo) {
  const { width, height } = tamanoDeGrupo(grupo)
  return punto.x >= grupo.position.x
    && punto.x <= grupo.position.x + width
    && punto.y >= grupo.position.y
    && punto.y <= grupo.position.y + height
}

/** El grupo de primer nivel que contiene el punto, si hay alguno. Los grupos no se anidan. */
export function grupoEnPunto(nodes, punto) {
  return nodes.find((nodo) => nodo.type === 'group' && !nodo.parentId && dentroDe(punto, nodo)) ?? null
}

/**
 * Los padres antes que sus hijos. La librería del lienzo dibuja a un hijo respecto de su padre y
 * necesita encontrarlo ya; un hijo delante de su grupo se dibuja mal. Es estable: no mueve nada que
 * ya esté en orden.
 */
export function ordenarPadresPrimero(nodes) {
  const ids = new Set(nodes.map((nodo) => nodo.id))
  const sinPadre = nodes.filter((nodo) => !nodo.parentId || !ids.has(nodo.parentId))
  const hijos = nodes.filter((nodo) => nodo.parentId && ids.has(nodo.parentId))
  if (hijos.length === 0) return nodes
  const ordenados = [...sinPadre, ...hijos]
  return ordenados.every((nodo, indice) => nodo === nodes[indice]) ? nodes : ordenados
}

// ─── Borrar ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Quita nodos junto con todo lo que cuelga de ellos: los hijos de un grupo borrado y las conexiones
 * de todos. Dejar a los hijos huérfanos hacía que el guardado fallara con «dice estar dentro de un
 * grupo que no existe».
 */
export function borrarEnCascada(nodes, edges, ids) {
  const quitar = new Set(ids)
  let cambio = true
  while (cambio) {
    cambio = false
    for (const nodo of nodes) {
      if (nodo.parentId && quitar.has(nodo.parentId) && !quitar.has(nodo.id)) {
        quitar.add(nodo.id)
        cambio = true
      }
    }
  }
  return {
    nodes: nodes.filter((nodo) => !quitar.has(nodo.id)),
    edges: edges.filter((arista) => !quitar.has(arista.source) && !quitar.has(arista.target)),
    quitados: quitar,
  }
}

// ─── Nodos nuevos ────────────────────────────────────────────────────────────────────────────────

/** Un identificador que no se repite aunque se suelten dos tareas en el mismo milisegundo. */
export function nuevoId(prefijo) {
  const unico = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefijo}-${unico}`
}

/** Lo que lleva por omisión un paso nuevo. */
export const DATOS_DE_PASO_NUEVO = Object.freeze({
  agentName: null,
  profileName: null,
  errorStrategy: 'stop',
  maxRetries: 0,
  retryDelaySeconds: 30,
  globalVariables: [],
})

/** Lo que lleva un grupo nuevo. */
export const DATOS_DE_GRUPO_NUEVO = Object.freeze({
  label: 'Nuevo grupo',
  errorStrategy: 'stop',
  maxRetries: 0,
  retryDelaySeconds: 30,
  globalVariables: [],
})

export const TAMANIO_DE_GRUPO_NUEVO = Object.freeze({ width: 300, height: 180 })
export const TAMANIO_MINIMO_DE_GRUPO = Object.freeze({ width: 260, height: 140 })

/** El tipo MIME con el que la paleta arrastra una tarea al lienzo. Es el de v9. */
export const TIPO_DE_ARRASTRE = 'application/x-orch-task'

/**
 * Lo que se arrastró desde la paleta, ya como datos de un paso nuevo, o `null` si no sirve.
 *
 * v9 arrastraba `{ taskName, taskGuid, type }`; también se acepta `taskType` (el nombre que usa el
 * resto del modelo) y se ignora cualquier otro campo: lo que llega por un arrastre no es de fiar.
 * Solo se copian los que describen QUÉ lanzar.
 */
export function datosDeTareaSoltada(crudo) {
  let objeto
  try {
    objeto = typeof crudo === 'string' ? JSON.parse(crudo) : crudo
  } catch {
    return null
  }
  if (!objeto || typeof objeto !== 'object') return null

  const texto = (valor) => (typeof valor === 'string' && valor.trim() !== '' ? valor : null)
  const taskName = texto(objeto.taskName)
  const templateName = texto(objeto.templateName)
  if (!taskName && !templateName) return null

  return {
    ...DATOS_DE_PASO_NUEVO,
    globalVariables: [],
    taskName,
    taskGuid: texto(objeto.taskGuid),
    taskType: texto(objeto.taskType) ?? texto(objeto.type),
    label: texto(objeto.label) ?? taskName ?? templateName,
    ...(templateName ? { templateName } : {}),
    ...(texto(objeto.jobText) ? { jobText: objeto.jobText } : {}),
  }
}

// ─── Guardar ─────────────────────────────────────────────────────────────────────────────────────

/** Lo que el lienzo agrega a los datos de un nodo para dibujarlo y que NO es parte del dibujo guardado. */
const DATOS_SOLO_DE_PANTALLA = [
  'runStep', 'runStatus', 'sapRunId', 'childSummary', 'groupMode', 'onRunSingle', 'promoted', 'bloqueado',
]

/**
 * El grafo tal como se manda al servidor: solo lo que es dibujo, sin lo que pone la librería
 * (`measured`, `selected`, `dragging`…) ni lo que pone la ejecución. Mezclarlos escribiría en la base
 * cómo fue una corrida.
 *
 * El tamaño de un grupo se guarda en `style`: la librería lo deja en `width`/`height` del nodo al
 * redimensionarlo, y al recargar solo se lee de `style`.
 */
export function grafoParaGuardar(nodes, edges) {
  return {
    nodes: nodes.map((nodo) => {
      const datos = { ...(nodo.data ?? {}) }
      for (const campo of DATOS_SOLO_DE_PANTALLA) delete datos[campo]

      const esGrupo = nodo.type === 'group'
      const estilo = esGrupo
        ? {
          ...(nodo.style ?? {}),
          ...(nodo.width ? { width: nodo.width } : {}),
          ...(nodo.height ? { height: nodo.height } : {}),
        }
        : nodo.style

      return {
        id: nodo.id,
        type: nodo.type,
        position: nodo.position,
        ...(nodo.parentId ? { parentId: nodo.parentId, extent: nodo.extent ?? 'parent' } : {}),
        ...(estilo && Object.keys(estilo).length > 0 ? { style: estilo } : {}),
        data: datos,
      }
    }),
    edges: edges.map(({ id, source, target }) => ({ id, source, target })),
  }
}
