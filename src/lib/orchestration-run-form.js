// Lo que no es dibujo en la barra de ejecución de una orquestación y en sus diálogos.
//
// Portado de `RunModal.jsx`, `RunSingleModal.jsx`, `RunLogModal.jsx` y de `checkBeforeRun` /
// `doneSteps` de `Orchestrations.jsx` de v9, donde todo esto vivía mezclado con el JSX. Aquí es puro,
// así que se comprueba sin montar nada.

// ─── Estado de la corrida ───────────────────────────────────────────────────────────────────────

/** Cómo se llama cada estado de la CORRIDA entera (la insignia de v9). Los pasos tienen los suyos. */
export const ETIQUETA_DE_CORRIDA = Object.freeze({
  running: 'Ejecutando',
  success: 'Completado',
  error: 'Error',
  cancelled: 'Cancelado',
})

export const etiquetaDeCorrida = (estado) => ETIQUETA_DE_CORRIDA[estado] ?? estado ?? '—'

/**
 * Cuántos pasos de PRIMER NIVEL terminaron de los que hay, que es el «hechos/total» de v9.
 *
 * Los hijos de un grupo no cuentan: el grupo ya es uno solo, y contarlo a él y a sus hijos lo
 * sumaría dos veces. «Hecho» es cualquier estado que no sea pendiente ni en marcha.
 */
export function avanceDeCorrida(run) {
  const pasos = Object.values(run?.nodes ?? {})
  return {
    hechos: pasos.filter((paso) => !['pending', 'running'].includes(paso.status)).length,
    total: pasos.length,
  }
}

// ─── Guarda previa: tasks fuera de un grupo ─────────────────────────────────────────────────────

/** Los nodos de primer nivel: los que no están dentro de un grupo. */
const primerNivel = (grafo) => (grafo?.nodes ?? []).filter((nodo) => !nodo.parentId)

/** Si hay algo que arrancar. Con un dibujo vacío, «Iniciar» no tiene sentido. */
export const hayNodosDePrimerNivel = (grafo) => primerNivel(grafo).length > 0

/**
 * `checkBeforeRun` de v9: si la orquestación usa grupos, toda tarea de primer nivel tiene que estar
 * dentro de uno. Devuelve los nombres de las que sobran (vacío = se puede iniciar).
 *
 * Sin ningún grupo no hay nada que comprobar: una orquestación de tareas sueltas es válida.
 */
export function tareasFueraDeGrupo(grafo) {
  const nivel = primerNivel(grafo)
  if (!nivel.some((nodo) => nodo.type === 'group')) return []
  return nivel
    .filter((nodo) => nodo.type === 'task')
    .map((nodo) => nodo.data?.label || nodo.data?.taskName || 'Task')
}

// ─── Qué variables se pueden pisar ──────────────────────────────────────────────────────────────

/** Las tareas distintas del dibujo, por su identificador de CI-DS. Es lo que se le pregunta a SAP. */
export function guidsDelGrafo(grafo) {
  const guids = (grafo?.nodes ?? [])
    .filter((nodo) => (nodo.type === 'task' || nodo.type === 'orchTask') && nodo.data?.taskGuid)
    .map((nodo) => nodo.data.taskGuid)
  return [...new Set(guids)]
}

/**
 * Junta las variables globales de varias tareas en una lista sin repetir. Gana la primera que
 * aparece: dos tareas que declaran la misma variable la comparten, y es una sola fila para pisarla.
 *
 * Recibe el resultado de `Promise.allSettled`: una tarea cuya consulta falló no tumba a las demás.
 */
export function variablesDeTareas(resultados) {
  const vistas = new Map()
  for (const resultado of resultados ?? []) {
    if (resultado?.status !== 'fulfilled') continue
    for (const variable of resultado.value?.globalVariables ?? []) {
      if (variable?.name && !vistas.has(variable.name)) vistas.set(variable.name, variable)
    }
  }
  return [...vistas.values()]
}

/**
 * Las filas con las que nace la lista: todos los NOMBRES, con el valor vacío.
 *
 * Vacío quiere decir «no pisar»: cada nodo conserva el suyo y, si tampoco tiene, SAP usa el del
 * sistema. Escribir un valor lo aplica a todos los nodos que declaren esa variable.
 */
export const filasDeVariables = (disponibles) =>
  (disponibles ?? []).map((variable) => ({ name: variable.name, value: '' }))

/** Solo viajan las que tienen nombre Y valor: una fila vacía es «no pisar», no «pisar con nada». */
export const variablesAEnviar = (filas) =>
  (filas ?? [])
    .filter((fila) => String(fila.name ?? '').trim() && fila.value !== '' && fila.value != null)
    .map((fila) => ({ name: fila.name, value: fila.value }))

/**
 * Los valores generales de una corrida, en la forma que espera el motor (`defaults`).
 *
 * El agente y la configuración vacíos se omiten: así el paso que traiga los suyos los conserva y el
 * que no, deja que decida el sistema.
 */
export function armarValoresGenerales({ agentName, profileName, globalVariables } = {}) {
  const agente = String(agentName ?? '').trim()
  const configuracion = String(profileName ?? '').trim()
  return {
    ...(agente ? { agentName: agente } : {}),
    ...(configuracion ? { profileName: configuracion } : {}),
    globalVariables: variablesAEnviar(globalVariables),
  }
}

/** Cuenta cómo se lee en «Repetir con <agente> / <perfil>». */
export const textoDeRepetir = (valores) =>
  `Repetir con ${valores?.agentName || 'default'} / ${valores?.profileName || 'default'}`

// ─── Agentes y configuraciones ──────────────────────────────────────────────────────────────────

/** Los agentes vienen agrupados y el desplegable los quiere sueltos. */
export const aplanarAgentes = (grupos) =>
  (Array.isArray(grupos) ? grupos : []).flatMap((grupo) => (Array.isArray(grupo.agents) ? grupo.agents : []))

/** SAP prefija el estado de un agente con «AGENT:». Se quita solo para mostrarlo. */
export const estadoDeAgente = (agente) => String(agente?.agentStatus ?? '').replace(/^AGENT:/, '')

/**
 * Si el estado dice «conectado». No basta con que el texto CONTENGA la palabra: «DISCONNECTED» la
 * contiene, y v9 lo daba por conectado y no lo marcaba.
 */
const estaConectado = (estado) => /(^|[^A-Z])CONNECTED/i.test(estado)

/** « (estado)» cuando el agente no está conectado; nada cuando lo está o no se sabe. */
export function sufijoDeAgente(agente) {
  const estado = estadoDeAgente(agente)
  return estado && !estaConectado(estado) ? ` (${estado})` : ''
}

// ─── Presets de «Ejecución rápida» ──────────────────────────────────────────────────────────────

/** Uno por DESTINO: el mismo nombre de agente puede existir en el sandbox y no en producción. */
export const claveDePresets = (destinoId) => `ibp.cids.presets.${destinoId}`

/**
 * Los presets guardados de un destino. Cualquier fallo —sin almacenamiento, JSON roto, otra forma—
 * devuelve la lista vacía: un preset es una comodidad y nunca puede impedir abrir el diálogo.
 */
export function leerPresets(destinoId, almacen) {
  if (!destinoId) return []
  try {
    const guardado = (almacen ?? globalThis.localStorage).getItem(claveDePresets(destinoId))
    const lista = JSON.parse(guardado || '[]')
    return Array.isArray(lista)
      ? lista.filter((preset) => preset && typeof preset === 'object' && preset.id && preset.label)
      : []
  } catch {
    return []
  }
}

/** Guarda la lista. Devuelve si pudo: el almacenamiento puede estar lleno o bloqueado. */
export function guardarPresets(destinoId, presets, almacen) {
  if (!destinoId) return false
  try {
    (almacen ?? globalThis.localStorage).setItem(claveDePresets(destinoId), JSON.stringify(presets))
    return true
  } catch {
    return false
  }
}

let contador = 0

/** Un preset nuevo. El identificador es solo para poder borrarlo, no se compara con nada de SAP. */
export function crearPreset({ label, agentName, profileName, globalVariables }) {
  contador += 1
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `preset-${Date.now()}-${contador}`,
    label,
    agentName: agentName || null,
    profileName: profileName || null,
    globalVariables: variablesAEnviar(globalVariables),
  }
}

/** Lo que un preset manda al iniciar: es la misma forma que el diálogo. */
export const valoresDePreset = (preset) => armarValoresGenerales({
  agentName: preset?.agentName,
  profileName: preset?.profileName,
  globalVariables: preset?.globalVariables,
})

// ─── Consultas en tandas ────────────────────────────────────────────────────────────────────────

/**
 * Como `Promise.allSettled` pero de a `tamanio` a la vez, en el orden de entrada.
 *
 * v9 consultaba a SAP por todas las tareas de golpe. Una orquestación de cuarenta pasos eran
 * cuarenta consultas simultáneas contra el tenant; en tandas el costo es el mismo y la concurrencia
 * no se dispara.
 */
export async function consultarEnTandas(elementos, consultar, tamanio = 5) {
  const resultados = []
  for (let desde = 0; desde < elementos.length; desde += tamanio) {
    const tanda = elementos.slice(desde, desde + tamanio)
    resultados.push(...await Promise.allSettled(tanda.map(consultar)))
  }
  return resultados
}

// ─── Hora y duración como en v9 ─────────────────────────────────────────────────────────────────

/** La hora de un instante, con el formato `es-CL` de v9. «—» si no hay. */
export function horaDeCorrida(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** «Xm Ys» o «Ns». Sin fin se mide contra `ahora`; sin inicio, «—». */
export function duracionDeCorrida(inicio, fin, ahora = Date.now()) {
  if (!inicio) return '—'
  const ms = (fin ? new Date(fin).getTime() : ahora) - new Date(inicio).getTime()
  const segundos = Math.max(0, Math.floor(ms / 1000))
  const minutos = Math.floor(segundos / 60)
  return minutos > 0 ? `${minutos}m ${segundos % 60}s` : `${segundos}s`
}

/** «#» y los últimos seis dígitos del identificador de SAP, que es como lo muestra v9. */
export const sufijoDeIdSap = (sapRunId) => (sapRunId ? `#${String(sapRunId).slice(-6)}` : '')
