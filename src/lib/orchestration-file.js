// Llevarse las orquestaciones a un archivo y traerlas de vuelta.
//
// Para qué sirve de verdad: copiar lo que armaste en pruebas al repositorio productivo, o de un
// cliente a otro. No hay forma de hacerlo desde la interfaz sin esto, y rehacer a mano un grafo de
// quince pasos con sus variables es donde se cometen los errores.
//
// El archivo NO lleva el destino ni los identificadores: al importar, cada orquestación nace en el
// repositorio donde estás parado y con identificadores nuevos. Traerse el destino haría que importar
// en producción algo exportado de pruebas apuntara en silencio al repositorio equivocado.

import { isV8Steps, stepsFromV8File, stepsToGraph } from './ibp-orchestration.js'

/** Marca del formato. Si algún día cambia la forma del archivo, esto es lo que lo distingue. */
export const FILE_FORMAT = 'goscm.cids.orchestrations.v1'

export function toFile(orquestaciones) {
  return {
    format: FILE_FORMAT,
    exportedAt: new Date().toISOString(),
    orchestrations: orquestaciones.map((una) => ({
      name: una.name,
      nodes: una.nodes ?? [],
      edges: una.edges ?? [],
    })),
  }
}

/**
 * Lee el texto de un archivo de importación.
 *
 * Los tres errores de archivo son los de v9, tal cual. Se captura el `SyntaxError` de `JSON.parse`
 * para decir qué pasa en vez de enseñar «Unexpected token» a quien subió el archivo equivocado.
 */
export function parseOrchImportText(texto) {
  let crudo
  try {
    crudo = JSON.parse(texto)
  } catch {
    throw new Error('El archivo no es un JSON válido')
  }
  return fromFile(crudo)
}

/**
 * Lee un archivo exportado y devuelve lo que trae: las orquestaciones aprovechables y, aparte, las
 * entradas que no lo son con el motivo de cada una (`{ index, reason }`, con los textos de v9).
 *
 * Una entrada sin `nodes` como lista NO se importa: antes entraba como una orquestación vacía, que
 * es como se pierde sin avisar un archivo mal armado. Lo que sí se acepta, además del formato actual,
 * es el viejo de v9 con la lista plana de pasos (`steps`), que se convierte aquí al entrar: el motor
 * de v9 lo hacía al vuelo en cada ejecución y hacerlo una vez deja un solo formato guardado. Y el del
 * orquestador de IBP de v8, que también guardaba `steps` pero con plantillas de trabajo
 * (`jobTemplateName`) y grupos (`children`): se reconoce por esos campos y se arma como lo guarda la
 * pantalla de IBP, con los pasos en cadena y los hijos de cada grupo en paralelo. v9 no leía ninguno
 * de los dos; son un añadido de esta plataforma.
 *
 * El archivo no lleva el destino (ver arriba), así que `sourceConnection` solo sirve para decir de
 * dónde dice venir uno que escribió v9.
 */
export function fromFile(contenido) {
  const crudas = Array.isArray(contenido)
    ? contenido
    : contenido?.orchestrations ?? contenido?.orchs

  if (!Array.isArray(crudas)) {
    throw new Error('El archivo no contiene un array de orquestaciones')
  }

  const orchestrations = []
  const invalid = []

  crudas.forEach((una, index) => {
    const rechazar = (reason) => invalid.push({ index, reason })

    if (!una || typeof una !== 'object') return rechazar('no es un objeto')

    const name = typeof una.name === 'string' ? una.name.trim() : ''
    if (!name) return rechazar('falta el campo name')

    // El grafo manda: si trae `nodes` con algo, los pasos planos se ignoran. Con `nodes` vacío o
    // ausente se mira si trae pasos de un formato viejo.
    const conGrafo = Array.isArray(una.nodes) && una.nodes.length > 0
    const conPasos = !conGrafo && Array.isArray(una.steps)

    if (!conGrafo && !conPasos && !Array.isArray(una.nodes)) return rechazar('nodes no es un array')

    if (conPasos) {
      const { nodes, edges } = isV8Steps(una.steps)
        ? stepsToGraph(stepsFromV8File(una.steps))
        : dePasosPlanos(una.steps)
      orchestrations.push({ name, nodes, edges })
      return undefined
    }

    if (una.edges !== undefined && !Array.isArray(una.edges)) return rechazar('edges debe ser un array')

    orchestrations.push({ name, nodes: una.nodes, edges: Array.isArray(una.edges) ? una.edges : [] })
    return undefined
  })

  if (orchestrations.length === 0 && invalid.length === 0) {
    throw new Error('El archivo no contiene orquestaciones')
  }

  return {
    orchestrations,
    invalid,
    sourceConnection: (!Array.isArray(contenido) && contenido?.sourceConnection) || null,
  }
}

/**
 * Convierte la lista plana de pasos de v9 en un grafo: una cadena, cada paso detrás del anterior.
 *
 * Es lo mismo que hacía el motor de v9 al ejecutar una de esas, así que el orden se conserva.
 */
function dePasosPlanos(steps) {
  const pasos = Array.isArray(steps) ? steps.filter((paso) => paso?.taskName) : []

  const nodes = pasos.map((paso, i) => ({
    id: paso.id || `n-importado-${i}`,
    type: 'task',
    position: { x: 80, y: 60 + i * 120 },
    data: {
      taskName: paso.taskName,
      label: paso.taskName,
      agentName: paso.agentName ?? null,
      profileName: paso.profileName ?? null,
      globalVariables: Array.isArray(paso.globalVariables) ? paso.globalVariables : [],
      errorStrategy: paso.errorStrategy ?? 'stop',
      maxRetries: paso.maxRetries ?? 0,
      retryDelaySeconds: paso.retryDelaySec ?? paso.retryDelaySeconds ?? 30,
    },
  }))

  const edges = nodes.slice(0, -1).map((nodo, i) => ({
    id: `e-${nodo.id}-${nodes[i + 1].id}`,
    source: nodo.id,
    target: nodes[i + 1].id,
  }))

  return { nodes, edges }
}

/**
 * La forma en que se comparan los nombres en TODO el flujo de importación: sin espacios sobrantes y
 * sin distinguir mayúsculas, porque «Carga diaria» y «carga diaria » son la misma para quien las mira.
 * Clasificar y crear usan esta misma, o una pasaba por nueva lo que la otra renombraba.
 */
export const claveDeNombre = (nombre) => String(nombre ?? '').trim().toLowerCase()

/** Las claves de los nombres que ya están puestos. */
export const clavesDeNombres = (lista) => new Set((lista ?? []).map((una) => claveDeNombre(una?.name)))

/**
 * Reparte lo que trae el archivo entre lo nuevo y lo que ya existe con ese nombre.
 *
 * Se enseña ANTES de importar, que es lo que hacía v9. Sin esto, un archivo de veinte orquestaciones
 * entra de golpe: no se sabe cuántas venían, ni que doce ya estaban, hasta que la lista aparece con
 * doce «(2)» detrás.
 */
export function clasificarImportacion(leidas, existentes) {
  const puestos = clavesDeNombres(existentes)

  const nuevas = []
  const repetidas = []

  for (const una of leidas ?? []) {
    const lista = puestos.has(claveDeNombre(una?.name)) ? repetidas : nuevas
    lista.push({
      ...una,
      pasos: una?.nodes?.length ?? 0,
      uniones: una?.edges?.length ?? 0,
    })
  }

  return { nuevas, repetidas }
}

/**
 * Un nombre que no choque con ninguno de los usados, con un número detrás si hace falta.
 *
 * Nada se pisa nunca: una orquestación se configura una vez y sobrescribirla por un nombre igual es
 * una pérdida que no se deshace. Anota el elegido en `usados` (un conjunto de claves, ver
 * `clavesDeNombres`) para que dos del mismo archivo con el mismo nombre no se lleven el mismo.
 */
export function nombreLibre(nombre, usados) {
  let candidato = nombre
  for (let numero = 2; usados.has(claveDeNombre(candidato)); numero += 1) candidato = `${nombre} (${numero})`
  usados.add(claveDeNombre(candidato))
  return candidato
}

/** El aviso con que termina una importación: «2 agregadas, 1 omitida» o «Sin cambios». */
export function resumirImportacion({ agregadas = 0, omitidas = 0, fallidas = 0 }) {
  const partes = []
  if (agregadas) partes.push(`${agregadas} agregada${agregadas === 1 ? '' : 's'}`)
  if (omitidas) partes.push(`${omitidas} omitida${omitidas === 1 ? '' : 's'}`)
  if (fallidas) partes.push(`${fallidas} con error`)
  return partes.length > 0 ? partes.join(', ') : 'Sin cambios'
}

/** El aviso de una exportación: «1 orquestación exportada», «3 orquestaciones exportadas». */
export const resumirExportacion = (cuantas) => (
  `${cuantas} orquestaci${cuantas === 1 ? 'ón' : 'ones'} exportada${cuantas === 1 ? '' : 's'}`
)

/** El nombre del archivo exportado, como el de v9: `ibp-orquestaciones-<conexión>-<fecha>.json`. */
export function nombreDeArchivoExportado(conexion, fecha) {
  const nombre = String(conexion || 'connection').replace(/[^\w-]+/g, '_').slice(0, 40)
  return `ibp-orquestaciones-${nombre}-${fecha}.json`
}

/** Descarga el archivo. Nombre con la fecha, que es lo que se busca cuando hay varios. */
export function downloadFile(contenido, nombre) {
  const texto = JSON.stringify(contenido, null, 2)
  const enlace = document.createElement('a')
  const url = URL.createObjectURL(new Blob([texto], { type: 'application/json' }))
  enlace.href = url
  enlace.download = nombre
  document.body.appendChild(enlace)
  enlace.click()
  document.body.removeChild(enlace)
  // Sin esto el navegador se queda con el archivo en memoria hasta recargar la página.
  URL.revokeObjectURL(url)
}
