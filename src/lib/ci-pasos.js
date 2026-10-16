// Las orquestaciones de CI Tools como las ve la pantalla: una LISTA de pasos, como en el orquestador de IBP.
//
//     1. Maestro de productos
//     2. Grupo paralelo  ->  Cifras de facturas, Cifras de producción   (corren a la vez)
//     3. Cifras de inventario
//
// Un paso ejecuta una integración; un grupo paralelo reúne varias que corren a la vez, y el grupo entero tiene que
// terminar antes de que empiece el paso siguiente.
//
// El motor guarda GRAFOS (nodos y conexiones). La pantalla trabaja con la lista y la traduce al guardar y al leer:
//
//   - los pasos de primer nivel son nodos encadenados, cada uno con una conexión al siguiente;
//   - un grupo es un nodo `group` y sus integraciones llevan `parentId`, sin conexiones entre ellas: así el motor
//     las lanza a la vez.
//
// Es la misma traducción que hace `ibp-orchestration.js` con los pasos de v8. Lo que cambia es qué lleva cada paso:
// aquí, una integración (`integrationId`) en vez de una plantilla de trabajo.
//
// Antes de este modelo, CI Tools dibujaba ETAPAS (una fila de etapas, con pasos en paralelo dentro de cada una) y se
// guardaban como un grafo SIN grupos. Esas orquestaciones se siguen leyendo: una etapa con una integración es un paso,
// y una con varias es un grupo paralelo.
//
// Los AJUSTES de un paso (otra versión, otras fechas…; ver `core/ci/ajustes.js`) viajan en el `data` de su nodo y en el paso de la
// pantalla se llaman igual: `paso.ajustes`. Un paso sin ajustes no lleva la clave.
//
// Pura, sin React ni red: solo traduce, y por eso se prueba entera.

import { sinAjustes } from '../../core/ci/ajustes.js'

const ALTO_DE_PASO = 140

let contador = 0

/** Un identificador de nodo nuevo. Con `crypto.randomUUID` donde exista, y con un contador donde no. */
export function nuevoIdDePaso() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `n-${crypto.randomUUID()}`
  contador += 1
  return `n-${Date.now().toString(36)}-${contador}`
}

const texto = (valor) => String(valor ?? '').trim()

/** Qué hacer cuando un paso falla. Los tres del motor. */
export const ESTRATEGIAS = Object.freeze(['stop', 'continue', 'retry'])

/** Las que tiene sentido ofrecer en un GRUPO: el motor no reintenta un grupo, solo sus integraciones. */
export const ESTRATEGIAS_DE_GRUPO = Object.freeze(['stop', 'continue'])

/** Los topes de los reintentos de CI Tools: los del servidor (`RETRY_LIMITS.ci`). */
export const REINTENTOS_MAXIMOS = 3
export const ESPERA_MINIMA_S = 10
export const ESPERA_MAXIMA_S = 3600
export const ESPERA_POR_OMISION_S = 60

/** ¿Es un grupo paralelo? */
export const esGrupo = (paso) => paso?.type === 'group'

/** Lo común de un paso y un grupo: qué hacer si falla. Una estrategia que no se conoce es «detener». */
function reintentosDe(origen = {}) {
  return {
    errorStrategy: ESTRATEGIAS.includes(origen.errorStrategy) ? origen.errorStrategy : 'stop',
    maxRetries: Number(origen.maxRetries) || 0,
    retryDelaySeconds: Number(origen.retryDelaySeconds) || ESPERA_POR_OMISION_S,
  }
}

/**
 * Un paso nuevo para una integración. Por omisión «detener si falla» y sin reintentos: lo que viene detrás de una
 * carga fallida no se ejecuta, y una carga no se repite sin que alguien lo decida.
 */
export function pasoDeIntegracion(integracion, id = nuevoIdDePaso()) {
  return {
    id,
    type: 'task',
    integrationId: integracion.id,
    label: integracion.name,
    errorStrategy: 'stop',
    maxRetries: 0,
    retryDelaySeconds: ESPERA_POR_OMISION_S,
  }
}

/** Un grupo paralelo vacío. */
export function grupoNuevo(id = nuevoIdDePaso()) {
  return { id, type: 'group', label: '', errorStrategy: 'stop', maxRetries: 0, retryDelaySeconds: ESPERA_POR_OMISION_S, children: [] }
}

// ─── Lista → grafo ──────────────────────────────────────────────────────────────────────────────

function nodoDeTarea(paso, posicion, parentId) {
  return {
    id: String(paso.id),
    type: 'task',
    position: posicion,
    ...(parentId ? { parentId } : {}),
    data: {
      label: texto(paso.label),
      integrationId: texto(paso.integrationId) || null,
      ...(sinAjustes(paso.ajustes) ? {} : { ajustes: paso.ajustes }),
      ...reintentosDe(paso),
    },
  }
}

/**
 * La lista como grafo, lista para guardar.
 *
 * Las posiciones solo sirven si alguien dibuja la orquestación en un lienzo: una columna, un paso debajo del otro,
 * que es como se lee la lista.
 */
export function grafoDePasos(pasos = []) {
  const nodes = []
  const primerNivel = []

  pasos.forEach((paso, i) => {
    const posicion = { x: 0, y: i * ALTO_DE_PASO }
    if (esGrupo(paso)) {
      nodes.push({
        id: String(paso.id),
        type: 'group',
        position: posicion,
        data: { label: texto(paso.label), ...reintentosDe(paso) },
      })
      ;(paso.children ?? []).forEach((hijo, j) => {
        nodes.push(nodoDeTarea(hijo, { x: 20 + j * 220, y: 50 }, String(paso.id)))
      })
    } else {
      nodes.push(nodoDeTarea(paso, posicion))
    }
    primerNivel.push(String(paso.id))
  })

  const edges = primerNivel.slice(0, -1).map((desde, i) => ({
    id: `e-${desde}-${primerNivel[i + 1]}`,
    source: desde,
    target: primerNivel[i + 1],
  }))

  return { nodes, edges }
}

// ─── Grafo → lista ──────────────────────────────────────────────────────────────────────────────

function tareaDeNodo(nodo) {
  const datos = nodo.data ?? {}
  return {
    id: String(nodo.id),
    type: 'task',
    integrationId: texto(datos.integrationId) || null,
    label: texto(datos.label),
    ...(sinAjustes(datos.ajustes) ? {} : { ajustes: datos.ajustes }),
    ...reintentosDe(datos),
  }
}

/**
 * Los nodos de primer nivel en el orden en que corren: orden topológico, y entre los que pueden correr a la vez, el
 * orden en que están guardados. Para una lista es la lista tal cual.
 */
function enOrdenDeEjecucion(nodos, edges) {
  const ids = new Set(nodos.map((nodo) => nodo.id))
  const entrantes = new Map(nodos.map((nodo) => [nodo.id, 0]))
  const salientes = new Map(nodos.map((nodo) => [nodo.id, []]))
  for (const arista of edges) {
    if (!ids.has(arista.source) || !ids.has(arista.target)) continue
    salientes.get(arista.source).push(arista.target)
    entrantes.set(arista.target, entrantes.get(arista.target) + 1)
  }

  const ordenados = []
  const pendientes = [...nodos]
  while (pendientes.length > 0) {
    const i = pendientes.findIndex((nodo) => entrantes.get(nodo.id) === 0)
    // Un ciclo no se puede guardar (`graph.js` lo rechaza); si llegara uno, lo que queda va al final.
    if (i < 0) { ordenados.push(...pendientes); break }
    const [listo] = pendientes.splice(i, 1)
    ordenados.push(listo)
    for (const destino of salientes.get(listo.id)) entrantes.set(destino, entrantes.get(destino) - 1)
  }
  return ordenados
}

/**
 * ¿Es este grafo exactamente lo que guarda la pantalla? Una sola cadena con todos los pasos de primer nivel, grupos
 * de un solo nivel y ninguna conexión dentro de un grupo.
 */
function tieneFormaDeLista(nodes, edges, orden) {
  const grupos = new Set(nodes.filter((nodo) => nodo.type === 'group' && !nodo.parentId).map((nodo) => nodo.id))
  if (nodes.some((nodo) => nodo.parentId && (!grupos.has(nodo.parentId) || nodo.type === 'group'))) return false

  const esperadas = new Set(orden.slice(0, -1).map((nodo, i) => `${nodo.id}>${orden[i + 1].id}`))
  const reales = new Set(edges.map((arista) => `${arista.source}>${arista.target}`))
  if (edges.length !== esperadas.size || reales.size !== esperadas.size) return false
  return [...esperadas].every((una) => reales.has(una))
}

/**
 * Las etapas de un grafo SIN grupos: la etapa de un paso es el camino más largo que llega hasta él. Devuelve
 * `{ etapas, exacto }`: `exacto` es `true` solo si volver a armar el grafo desde esas etapas (cada paso de una etapa
 * conectado con todos los de la siguiente) da EXACTAMENTE las mismas conexiones. Si no, hay dependencias que las etapas
 * no pueden expresar (un paso que espera a uno de dos etapas atrás, por ejemplo).
 */
export function etapasDeGrafo({ nodes = [], edges = [] } = {}) {
  const pasos = nodes.filter((nodo) => nodo.type !== 'group')
  const ids = new Set(pasos.map((paso) => paso.id))
  const aristas = edges.filter((arista) => ids.has(arista.source) && ids.has(arista.target))

  const entrantes = new Map(pasos.map((paso) => [paso.id, []]))
  for (const arista of aristas) entrantes.get(arista.target).push(arista.source)

  // Nivel = camino más largo desde un origen. Se calcula por orden topológico; un ciclo (que el servidor rechaza al
  // guardar) dejaría pasos sin nivel y se agrupan al final.
  const nivel = new Map()
  let pendientes = [...pasos]
  let avanzo = true
  while (pendientes.length > 0 && avanzo) {
    avanzo = false
    for (const paso of [...pendientes]) {
      const previos = entrantes.get(paso.id)
      if (previos.every((id) => nivel.has(id))) {
        nivel.set(paso.id, previos.length === 0 ? 0 : Math.max(...previos.map((id) => nivel.get(id))) + 1)
        pendientes = pendientes.filter((otro) => otro.id !== paso.id)
        avanzo = true
      }
    }
  }
  const ultimo = nivel.size === 0 ? 0 : Math.max(...nivel.values()) + 1
  for (const paso of pendientes) nivel.set(paso.id, ultimo)

  const niveles = [...new Set([...nivel.values()])].sort((a, b) => a - b)
  const etapas = niveles.map((n) => pasos.filter((paso) => nivel.get(paso.id) === n))

  const esperadas = new Set()
  etapas.forEach((etapa, i) => {
    if (i === 0) return
    for (const antes of etapas[i - 1]) for (const despues of etapa) esperadas.add(`${antes.id}->${despues.id}`)
  })
  const reales = new Set(aristas.map((arista) => `${arista.source}->${arista.target}`))
  const exacto = pendientes.length === 0
    && reales.size === esperadas.size
    && [...reales].every((una) => esperadas.has(una))

  return { etapas, exacto }
}

/**
 * Una etapa como paso: con una integración es un paso, con varias es un grupo paralelo.
 *
 * El grupo conserva el orden de las integraciones y se llama `g-<primera>`: el mismo cada vez que se lee, para que dos
 * lecturas de lo mismo no parezcan cosas distintas. Su estrategia es «continuar» solo si TODAS las de la etapa lo
 * eran; con una mezcla, la etapa bloqueaba o no según cuál fallara y un grupo decide por todas a la vez, así que se
 * queda del lado seguro: «detener».
 */
function pasoDeEtapa(etapa) {
  if (etapa.length === 1) return tareaDeNodo(etapa[0])
  return {
    id: `g-${etapa[0].id}`,
    type: 'group',
    label: '',
    errorStrategy: etapa.every((nodo) => nodo.data?.errorStrategy === 'continue') ? 'continue' : 'stop',
    maxRetries: 0,
    retryDelaySeconds: ESPERA_POR_OMISION_S,
    children: etapa.map(tareaDeNodo),
  }
}

/** Un grupo no reintenta: el motor lo trata como «detener». Se enseña así para que lo que se ve sea lo que hace. */
const sinReintentoDeGrupo = (paso) => (paso.errorStrategy === 'retry' ? { ...paso, errorStrategy: 'stop' } : paso)

/**
 * La lista de pasos de una orquestación guardada.
 *
 * Devuelve `{ pasos, exacto }`. `exacto` es `false` cuando el grafo tiene dependencias que una lista no puede
 * expresar (dos cadenas independientes, por ejemplo): entonces se enseña en el orden en que corren sus pasos, y la
 * pantalla lo avisa en vez de enseñar algo distinto de lo que se ejecuta.
 */
export function pasosDeGrafo({ nodes = [], edges = [] } = {}) {
  const hayGrupos = nodes.some((nodo) => nodo.type === 'group')

  if (!hayGrupos) {
    // Una orquestación hecha con el editor de etapas: un grafo sin grupos.
    const { etapas, exacto } = etapasDeGrafo({ nodes, edges })
    if (exacto) return { pasos: etapas.map(pasoDeEtapa), exacto: true }
    return { pasos: etapas.flat().map(tareaDeNodo), exacto: false }
  }

  const primerNivel = nodes.filter((nodo) => !nodo.parentId)
  const orden = enOrdenDeEjecucion(primerNivel, edges)
  const pasos = orden.map((nodo) => {
    if (nodo.type !== 'group') return tareaDeNodo(nodo)
    return sinReintentoDeGrupo({
      id: String(nodo.id),
      type: 'group',
      label: texto(nodo.data?.label),
      ...reintentosDe(nodo.data),
      children: nodes.filter((hijo) => hijo.parentId === nodo.id && hijo.type !== 'group').map(tareaDeNodo),
    })
  })
  return { pasos, exacto: tieneFormaDeLista(nodes, edges, orden) }
}

// ─── Cambios sobre la lista ─────────────────────────────────────────────────────────────────────
//
// Todas devuelven una lista nueva y no tocan la que reciben.

/** Agrega un paso al final. */
export const agregarPaso = (pasos, paso) => [...pasos, paso]

/** Agrega un grupo paralelo vacío al final. */
export const agregarGrupo = (pasos, grupo = grupoNuevo()) => [...pasos, grupo]

/** Agrega una integración a un grupo. Si el grupo no existe, no hace nada. */
export const agregarAGrupo = (pasos, idDeGrupo, paso) => pasos.map((una) => (
  una.id === idDeGrupo && esGrupo(una) ? { ...una, children: [...(una.children ?? []), paso] } : una
))

/** Quita un paso o un grupo entero. */
export const quitarPaso = (pasos, id) => pasos.filter((una) => una.id !== id)

/** Cambia los datos de un paso o un grupo. Lo que no se manda no se toca. */
export const cambiarPaso = (pasos, id, cambios) => pasos.map((una) => (una.id === id ? { ...una, ...cambios } : una))

/** Intercambia un elemento de la lista con el anterior (`-1`) o el siguiente (`1`). En los bordes no hace nada. */
function mover(lista, id, direccion) {
  const i = lista.findIndex((una) => una.id === id)
  const destino = i + direccion
  if (i < 0 || destino < 0 || destino >= lista.length) return lista
  const copia = [...lista]
  ;[copia[i], copia[destino]] = [copia[destino], copia[i]]
  return copia
}

/** Sube o baja un paso o un grupo. */
export const moverPaso = (pasos, id, direccion) => mover(pasos, id, direccion)

/** Aplica `hacer` a los hijos de UN grupo. */
const enGrupo = (pasos, idDeGrupo, hacer) => pasos.map((una) => (
  una.id === idDeGrupo && esGrupo(una) ? { ...una, children: hacer(una.children ?? []) } : una
))

/** Quita una integración de un grupo. */
export const quitarHijo = (pasos, idDeGrupo, idDeHijo) => enGrupo(pasos, idDeGrupo, (hijos) => hijos.filter((una) => una.id !== idDeHijo))

/** Cambia los datos de una integración de un grupo. */
export const cambiarHijo = (pasos, idDeGrupo, idDeHijo, cambios) => enGrupo(pasos, idDeGrupo, (hijos) => hijos.map((una) => (
  una.id === idDeHijo ? { ...una, ...cambios } : una
)))

/** Sube o baja una integración dentro de su grupo. */
export const moverHijo = (pasos, idDeGrupo, idDeHijo, direccion) => enGrupo(pasos, idDeGrupo, (hijos) => mover(hijos, idDeHijo, direccion))

/**
 * Arrastrar: pone el paso `desdeId` encima (`'top'`) o debajo (`'bottom'`) del paso `haciaId`. Si alguno no existe, o
 * es el mismo, no cambia nada.
 */
export function reordenar(pasos, desdeId, haciaId, posicion) {
  const de = pasos.findIndex((una) => una.id === desdeId)
  const hacia = pasos.findIndex((una) => una.id === haciaId)
  if (de < 0 || hacia < 0 || de === hacia) return pasos

  // El índice donde queda, contado después de sacarlo de donde estaba.
  const indice = posicion === 'top'
    ? (de < hacia ? hacia - 1 : hacia)
    : (de < hacia ? hacia : hacia + 1)

  const copia = [...pasos]
  const [movido] = copia.splice(de, 1)
  copia.splice(indice, 0, movido)
  return copia
}

/**
 * Las integraciones de la lista, una por una y en el orden en que se leen: las de los pasos y las de dentro de cada grupo. Cada una dice
 * en qué paso va (`numero`) y si va dentro de un grupo.
 */
export const tareasDeLosPasos = (pasos) => pasos.flatMap((una, i) => (
  esGrupo(una)
    ? (una.children ?? []).map((tarea) => ({ tarea, numero: i + 1, enGrupo: true }))
    : [{ tarea: una, numero: i + 1, enGrupo: false }]
))

/** Cuántas integraciones se ejecutan en total: las de los pasos y las de los grupos. */
export const totalDeIntegraciones = (pasos) => pasos.reduce(
  (suma, una) => suma + (esGrupo(una) ? (una.children ?? []).length : 1),
  0,
)

/** Los identificadores de una ejecución: los de su primer nivel y los de las integraciones dentro de cada grupo. */
export const idsDeEjecucion = (run) => new Set(Object.entries(run?.nodes ?? {}).flatMap(([id, paso]) => [id, ...Object.keys(paso?.children ?? {})]))

/**
 * ¿La ejecución es de ESTOS nodos? Retomar sigue una ejecución concreta: con otros pasos ya no tiene sentido.
 *
 * Se compara con los nodos GUARDADOS (`orquestacion.nodes`) y no con la lista que dibuja la pantalla: una orquestación del editor
 * de etapas se enseña con grupos que en el grafo guardado no existen, y su ejecución tampoco los tiene.
 */
export function esDeLaMismaVersion(nodes, run) {
  const de = new Set((nodes ?? []).map((nodo) => String(nodo.id)))
  const ejecucion = idsDeEjecucion(run)
  return de.size === ejecucion.size && [...ejecucion].every((id) => de.has(id))
}
