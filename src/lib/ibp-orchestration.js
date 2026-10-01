// El orquestador de IBP de v8 visto desde lo que se guarda aquí.
//
// v8 guardaba cada orquestación como una LISTA de pasos (`steps`): tareas que corren una detrás de
// otra y grupos cuyos hijos corren a la vez. Aquí se guarda un GRAFO (`nodes`, `edges`), porque el
// motor es el mismo que el de CI-DS. La pantalla de IBP es la de v8, así que trabaja con la lista y
// la traduce al guardar y al leer:
//
//   - los pasos de primer nivel son nodos encadenados, cada uno con una conexión al siguiente;
//   - un grupo es un nodo `group` y sus hijos llevan `parentId`, sin conexiones entre ellos: así el
//     motor los lanza a la vez.
//
// Dentro de la pantalla los pasos tienen la forma de v8 (`jobTemplateName`, `jobTemplateText`,
// `retryDelaySec`), que es también la de sus archivos exportados. En el grafo se guardan con los
// nombres que lee el adaptador de IBP del motor (`templateName`, `jobText`, `retryDelaySeconds`).
//
// Sin React ni red: solo traduce, y por eso se prueba entero.

/** Los valores con que v8 creaba un paso o un grupo. */
export const RETRY_DEFAULTS = Object.freeze({ errorStrategy: 'stop', maxRetries: 3, retryDelaySec: 60 })

const nuevoId = () => globalThis.crypto.randomUUID()

const texto = (valor) => String(valor ?? '').trim()

const ESTRATEGIAS = new Set(['stop', 'continue', 'retry'])

/** Lo común de una tarea y un grupo: qué hacer si falla. */
function reintentosDe(origen = {}) {
  return {
    errorStrategy: ESTRATEGIAS.has(origen.errorStrategy) ? origen.errorStrategy : RETRY_DEFAULTS.errorStrategy,
    maxRetries: Number(origen.maxRetries) || RETRY_DEFAULTS.maxRetries,
    retryDelaySec: Number(origen.retryDelaySec ?? origen.retryDelaySeconds) || RETRY_DEFAULTS.retryDelaySec,
  }
}

/** Un paso de v8 a partir de una plantilla de `JobTemplateSet`. Es `buildStep` de `TemplatePalette`. */
export function stepFromTemplate(plantilla) {
  return {
    id: nuevoId(),
    type: 'task',
    jobTemplateName: plantilla.JobTemplateName,
    jobTemplateText: plantilla.JobTemplateText || plantilla.JobTemplateName,
    ...RETRY_DEFAULTS,
  }
}

/** Un grupo paralelo vacío. Es `addGroup` de `OrchBuilder`. */
export function newGroup() {
  return { id: nuevoId(), type: 'group', label: '', ...RETRY_DEFAULTS, children: [] }
}

// ─── Lista → grafo ──────────────────────────────────────────────────────────────────────────────

function nodoDeTarea(paso, posicion, parentId) {
  const nombre = texto(paso.jobTemplateName)
  const textoDelJob = texto(paso.jobTemplateText) || nombre
  const { errorStrategy, maxRetries, retryDelaySec } = reintentosDe(paso)
  return {
    id: String(paso.id),
    type: 'task',
    position: posicion,
    ...(parentId ? { parentId } : {}),
    data: {
      templateName: nombre,
      jobText: textoDelJob,
      label: textoDelJob,
      errorStrategy,
      maxRetries,
      retryDelaySeconds: retryDelaySec,
    },
  }
}

/**
 * La lista de v8 como grafo, lista para guardar.
 *
 * Las posiciones solo sirven si alguien abre la orquestación en el lienzo de CI-DS: una columna, un
 * paso debajo del otro, que es como se lee la lista.
 */
export function stepsToGraph(steps = []) {
  const nodes = []
  const primerNivel = []

  steps.forEach((paso, i) => {
    const posicion = { x: 0, y: i * 140 }
    if (paso.type === 'group') {
      const { errorStrategy, maxRetries, retryDelaySec } = reintentosDe(paso)
      nodes.push({
        id: String(paso.id),
        type: 'group',
        position: posicion,
        data: { label: texto(paso.label), errorStrategy, maxRetries, retryDelaySeconds: retryDelaySec },
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
  const nombre = texto(datos.templateName ?? datos.jobTemplateName ?? datos.taskName)
  return {
    id: String(nodo.id),
    type: 'task',
    jobTemplateName: nombre,
    jobTemplateText: texto(datos.jobText ?? datos.jobTemplateText) || texto(datos.label) || nombre,
    ...reintentosDe(datos),
  }
}

/**
 * Los nodos de primer nivel en el orden en que corren: orden topológico, y entre los que pueden
 * correr a la vez, el orden en que están guardados. Para una lista de v8 es la lista tal cual.
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
 * ¿Es este grafo exactamente lo que guarda la pantalla de v8?
 *
 * Una sola cadena con todos los pasos de primer nivel, grupos de un solo nivel y ninguna conexión
 * dentro de un grupo. Si no —porque se dibujó en el lienzo—, la lista que se enseña es su orden de
 * ejecución y no lo que el motor correría: la pantalla lo avisa y lo guarda como lista antes de
 * ejecutar.
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
 * La lista de v8 de una orquestación guardada.
 *
 * Devuelve también si el grafo tenía esa forma (`isList`). Si no la tenía no se rompe nada: se
 * linealiza en su orden de ejecución, los grupos conservan a sus hijos y esos hijos pasan a correr a
 * la vez, que es lo único que un grupo de v8 sabe hacer.
 */
export function graphToSteps(nodes = [], edges = []) {
  const primerNivel = nodes.filter((nodo) => !nodo.parentId)
  const orden = enOrdenDeEjecucion(primerNivel, edges)

  const steps = orden.map((nodo) => {
    if (nodo.type !== 'group') return tareaDeNodo(nodo)
    return {
      id: String(nodo.id),
      type: 'group',
      label: texto(nodo.data?.label),
      ...reintentosDe(nodo.data),
      children: nodes.filter((hijo) => hijo.parentId === nodo.id && hijo.type !== 'group').map(tareaDeNodo),
    }
  })

  return { steps, isList: tieneFormaDeLista(nodes, edges, orden) }
}

// ─── El archivo de v8 ───────────────────────────────────────────────────────────────────────────

/** Una tarea de un archivo de v8, completada como la dejaría la pantalla. */
function tareaDeArchivo(paso) {
  const nombre = texto(paso?.jobTemplateName ?? paso?.templateName)
  return {
    id: texto(paso?.id) || nuevoId(),
    type: 'task',
    jobTemplateName: nombre,
    jobTemplateText: texto(paso?.jobTemplateText ?? paso?.jobText) || nombre,
    ...reintentosDe(paso),
  }
}

/** Los pasos de un archivo de v8. Lo que no se entiende se descarta en vez de romper la importación. */
export function stepsFromV8File(steps) {
  return (Array.isArray(steps) ? steps : [])
    .filter((paso) => paso && typeof paso === 'object')
    .map((paso) => {
      if (paso.type !== 'group') return tareaDeArchivo(paso)
      return {
        id: texto(paso.id) || nuevoId(),
        type: 'group',
        label: texto(paso.label),
        ...reintentosDe(paso),
        children: (Array.isArray(paso.children) ? paso.children : []).filter(Boolean).map(tareaDeArchivo),
      }
    })
    .filter((paso) => paso.type === 'group' || paso.jobTemplateName)
}

/** ¿Son estos los pasos de un archivo de v8? Los de v9 traen `taskName` y ningún grupo. */
export const isV8Steps = (steps) => Array.isArray(steps)
  && steps.some((paso) => paso?.jobTemplateName || paso?.type === 'group')

/**
 * El contenido del archivo que exportaba v8 (`exportOrchs` de `useOrchStorage.js`), tal cual: así un
 * archivo sale de aquí y entra en v8, y al revés.
 */
export function toV8File(orquestaciones, connectionName, ahora = new Date()) {
  return {
    version: '1.0',
    exportedAt: ahora.toISOString(),
    sourceConnection: connectionName || '',
    orchestrations: orquestaciones.map((una) => ({ name: una.name, steps: una.steps || [] })),
  }
}

/** `ibp-orquestaciones-<conexión>-<fecha>.json`, el nombre de v8. */
export function v8FileName(connectionName, ahora = new Date()) {
  const fecha = ahora.toISOString().slice(0, 10)
  const seguro = (connectionName || 'conn').replace(/[^\w-]+/g, '_').slice(0, 30)
  return `ibp-orquestaciones-${seguro}-${fecha}.json`
}

/**
 * Las orquestaciones de un archivo, como listas de v8.
 *
 * Lee el formato de v8 y también el de esta plataforma (`nodes`, `edges`), que se linealiza. Una sin
 * nombre se descarta: no se podría distinguir de las demás.
 */
export function readOrchestrationFile(parsed) {
  return (parsed?.orchestrations ?? [])
    .filter((una) => una && typeof una === 'object' && texto(una.name))
    .map((una) => {
      if (Array.isArray(una.steps)) return { name: texto(una.name), steps: stepsFromV8File(una.steps) }
      if (Array.isArray(una.nodes)) {
        return { name: texto(una.name), steps: graphToSteps(una.nodes, una.edges ?? []).steps }
      }
      return { name: texto(una.name), steps: [] }
    })
}

/**
 * Qué hace la importación con cada orquestación del archivo, como `importOrchs` de v8: las que no
 * existen se crean, y las que ya existen con ese nombre (sin distinguir mayúsculas ni espacios) se
 * reemplazan o se omiten según la casilla.
 *
 * Como en v8, el archivo se recorre en orden y lo ya recorrido cuenta: si trae dos con el mismo
 * nombre, la segunda reemplaza a la primera (o se omite), no se crean dos.
 */
export function planImport(leidas, existentes, reemplazar) {
  const clave = (nombre) => texto(nombre).toLowerCase()
  const porNombre = new Map()
  for (const una of existentes ?? []) if (!porNombre.has(clave(una.name))) porNombre.set(clave(una.name), { id: una.id })

  const crear = []
  const reemplazos = []
  let reemplazadas = 0
  let omitidas = 0
  for (const una of leidas ?? []) {
    const existente = porNombre.get(clave(una.name))
    if (!existente) {
      porNombre.set(clave(una.name), { nueva: crear.length })
      crear.push(una)
    } else if (!reemplazar) {
      omitidas += 1
    } else {
      reemplazadas += 1
      if (existente.nueva !== undefined) crear[existente.nueva] = una
      else reemplazos.push({ id: existente.id, name: una.name, steps: una.steps })
    }
  }
  return { crear, reemplazos, reemplazadas, omitidas }
}
