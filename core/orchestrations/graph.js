// La forma de una orquestación: nodos, aristas, y qué grafo se puede ejecutar.
//
// Portado de las validaciones de `api/orchestrations.js` de v9, con los mismos topes y los mismos
// valores permitidos. Lo que se agrega son dos guardas que allí no había, y las dos tapan fallos
// silenciosos del motor —no gustos:
//
//   - Una arista que apunta a un nodo que no existe: el motor la ignoraba sin decir nada, así que el
//     grafo guardado y el que se ejecuta eran distintos.
//   - Un ciclo: el motor arma el orden con el algoritmo de Kahn, y los nodos de un ciclo nunca entran
//     en ninguna ola. Esas tareas NO SE EJECUTAN y nadie se entera. Es el peor fallo posible en algo
//     que existe para lanzar cargas: parece que corrió y no corrió.
//
// Guardar algo que no se puede ejecutar no sirve de nada, así que se rechaza al guardar, con el
// usuario delante y pudiendo arreglarlo.

/** Qué hacer cuando un paso falla. Los tres de v9. */
export const ERROR_STRATEGIES = Object.freeze(['stop', 'continue', 'retry'])

/** Cómo corren los hijos de un grupo. */
export const EXECUTION_MODES = Object.freeze(['parallel', 'serial'])

/** Tipos de nodo. Un `group` agrupa a otros; un `task` es una tarea de CI-DS. */
export const NODE_TYPES = Object.freeze(['task', 'group'])

/** Topes de los reintentos, de v9. */
export const MAX_RETRIES_LIMIT = 5
export const MAX_RETRY_DELAY_SECONDS = 3600

/**
 * La librería del lienzo nombra sus tipos distinto de como se guardan. Se traduce en la frontera para
 * que la base no dependa de qué librería dibuja.
 */
const TIPOS_DEL_LIENZO = Object.freeze({ orchTask: 'task', orchGroup: 'group' })

const aEntero = (valor, { min, max, porOmision }) => {
  const numero = Number(valor ?? porOmision)
  if (!Number.isFinite(numero)) return porOmision
  return Math.min(max, Math.max(min, Math.trunc(numero)))
}

const aNumero = (valor) => {
  const numero = Number(valor ?? 0)
  return Number.isFinite(numero) ? numero : 0
}

const aTextoOnulo = (valor) => {
  const texto = String(valor ?? '').trim()
  return texto === '' ? null : texto
}

/** Lo que configura un nodo: qué tarea corre, con qué, y qué hacer si falla. */
function normalizarDatos(datos = {}) {
  return {
    taskName: aTextoOnulo(datos.taskName),
    taskGuid: aTextoOnulo(datos.taskGuid),
    taskType: aTextoOnulo(datos.taskType),
    label: aTextoOnulo(datos.label) ?? aTextoOnulo(datos.taskName) ?? 'Sin nombre',
    agentName: aTextoOnulo(datos.agentName),
    profileName: aTextoOnulo(datos.profileName),
    globalVariables: (Array.isArray(datos.globalVariables) ? datos.globalVariables : [])
      .map((variable) => ({ name: String(variable?.name ?? ''), value: String(variable?.value ?? '') }))
      .filter((variable) => variable.name !== ''),
    errorStrategy: ERROR_STRATEGIES.includes(datos.errorStrategy) ? datos.errorStrategy : 'stop',
    maxRetries: aEntero(datos.maxRetries, { min: 0, max: MAX_RETRIES_LIMIT, porOmision: 0 }),
    retryDelaySeconds: aEntero(datos.retryDelaySeconds ?? datos.retryDelaySec, {
      min: 0, max: MAX_RETRY_DELAY_SECONDS, porOmision: 30,
    }),
    executionMode: datos.executionMode === 'serial' ? 'serial' : 'parallel',
  }
}

function normalizarNodo(nodo, indice) {
  if (!nodo?.id) throw new Error(`El nodo en la posición ${indice} no tiene identificador.`)

  const tipo = TIPOS_DEL_LIENZO[nodo.type] ?? nodo.type
  if (!NODE_TYPES.includes(tipo)) {
    throw new Error(`Tipo de nodo desconocido: "${nodo.type}". Debe ser 'task' o 'group'.`)
  }

  const nodoNormalizado = {
    id: String(nodo.id),
    type: tipo,
    position: { x: aNumero(nodo.position?.x), y: aNumero(nodo.position?.y) },
    data: normalizarDatos(nodo.data),
  }

  // `parentId` es lo que mete un nodo dentro de un grupo. `extent: 'parent'` es de la librería del
  // lienzo y significa que no se puede arrastrar fuera de su grupo; va junto porque lo uno implica
  // lo otro y separarlos dejaría nodos escapándose de su caja.
  const padre = aTextoOnulo(nodo.parentId)
  if (padre) {
    nodoNormalizado.parentId = padre
    nodoNormalizado.extent = 'parent'
  }
  // El tamaño del dibujo de un grupo lo pone el usuario arrastrando; se guarda tal cual.
  if (nodo.style && typeof nodo.style === 'object') nodoNormalizado.style = nodo.style

  return nodoNormalizado
}

function normalizarArista(arista, indice) {
  if (!arista?.id) throw new Error(`La conexión en la posición ${indice} no tiene identificador.`)
  if (!arista.source || !arista.target) {
    throw new Error(`La conexión "${arista.id}" tiene que decir de qué nodo sale y a cuál llega.`)
  }
  return { id: String(arista.id), source: String(arista.source), target: String(arista.target) }
}

/**
 * ¿Hay un ciclo entre los nodos de primer nivel?
 *
 * Se mira solo el primer nivel porque es lo que el motor ordena: los hijos de un grupo corren dentro
 * de él, en serie o en paralelo según el grupo, sin aristas entre ellos.
 *
 * Es el mismo recorrido que hace el motor. Al terminar, los que siguen esperando a alguien están en
 * un ciclo o cuelgan de uno — y el motor los descartaría en silencio a todos.
 */
function nodosQueNuncaCorrerian(nodos, aristas) {
  const desdeAqui = new Map(nodos.map((nodo) => [nodo.id, []]))
  const entrantes = new Map(nodos.map((nodo) => [nodo.id, 0]))

  for (const arista of aristas) {
    // Solo cuentan las aristas entre nodos de primer nivel, como en el motor.
    if (!desdeAqui.has(arista.source) || !entrantes.has(arista.target)) continue
    desdeAqui.get(arista.source).push(arista.target)
    entrantes.set(arista.target, entrantes.get(arista.target) + 1)
  }

  let listos = nodos.filter((nodo) => entrantes.get(nodo.id) === 0).map((nodo) => nodo.id)

  while (listos.length > 0) {
    const siguientes = []
    for (const id of listos) {
      for (const destino of desdeAqui.get(id)) {
        entrantes.set(destino, entrantes.get(destino) - 1)
        if (entrantes.get(destino) === 0) siguientes.push(destino)
      }
    }
    listos = siguientes
  }

  return nodos.filter((nodo) => entrantes.get(nodo.id) > 0).map((nodo) => nodo.data.label)
}

/**
 * Normaliza y valida el grafo completo. Devuelve `{ nodes, edges }` listos para guardar.
 *
 * Lanza con un mensaje que se pueda mostrar: quien guarda es una persona que acaba de dibujar algo y
 * tiene que poder arreglarlo.
 */
export function normalizeGraph({ nodes = [], edges = [] } = {}) {
  if (!Array.isArray(nodes)) throw new Error('Los nodos tienen que venir en una lista.')
  if (!Array.isArray(edges)) throw new Error('Las conexiones tienen que venir en una lista.')

  const nodosNormalizados = nodes.map(normalizarNodo)
  const aristasNormalizadas = edges.map(normalizarArista)

  const identificadores = new Set()
  for (const nodo of nodosNormalizados) {
    if (identificadores.has(nodo.id)) throw new Error(`Hay dos nodos con el mismo identificador: "${nodo.id}".`)
    identificadores.add(nodo.id)
  }

  // Un nodo dentro de un grupo que no existe quedaría suelto en el lienzo y fuera de toda ola.
  for (const nodo of nodosNormalizados) {
    if (nodo.parentId && !identificadores.has(nodo.parentId)) {
      throw new Error(`El nodo "${nodo.data.label}" dice estar dentro de un grupo que no existe.`)
    }
  }

  // v9 ignoraba estas aristas en silencio, así que el grafo guardado y el ejecutado diferían.
  for (const arista of aristasNormalizadas) {
    if (!identificadores.has(arista.source) || !identificadores.has(arista.target)) {
      throw new Error(`La conexión "${arista.id}" apunta a un nodo que no existe.`)
    }
  }

  const primerNivel = nodosNormalizados.filter((nodo) => !nodo.parentId)
  const atascados = nodosQueNuncaCorrerian(primerNivel, aristasNormalizadas)
  if (atascados.length > 0) {
    throw new Error(
      `Hay un ciclo en las conexiones y por eso estos pasos no se ejecutarían nunca: ${atascados.join(', ')}. `
      + 'Quitá alguna conexión para que el orden quede claro.',
    )
  }

  return { nodes: nodosNormalizados, edges: aristasNormalizadas }
}
