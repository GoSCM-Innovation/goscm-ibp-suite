// Llevarse las orquestaciones a un archivo y traerlas de vuelta.
//
// Para qué sirve de verdad: copiar lo que armaste en pruebas al repositorio productivo, o de un
// cliente a otro. No hay forma de hacerlo desde la interfaz sin esto, y rehacer a mano un grafo de
// quince pasos con sus variables es donde se cometen los errores.
//
// El archivo NO lleva el destino ni los identificadores: al importar, cada orquestación nace en el
// repositorio donde estás parado y con identificadores nuevos. Traerse el destino haría que importar
// en producción algo exportado de pruebas apuntara en silencio al repositorio equivocado.

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
 * Lee un archivo exportado y devuelve las orquestaciones que trae.
 *
 * Acepta también el formato viejo de v9, donde una orquestación podía guardarse como una lista plana
 * de pasos (`steps`) en vez de un grafo. Se convierte aquí, al entrar: el motor de v9 lo hacía al
 * vuelo en cada ejecución, y hacerlo una vez al importar deja un solo formato guardado.
 */
export function fromFile(contenido) {
  const crudas = Array.isArray(contenido)
    ? contenido
    : contenido?.orchestrations ?? contenido?.orchs

  if (!Array.isArray(crudas)) {
    throw new Error('El archivo no parece una exportación de orquestaciones.')
  }

  const leidas = crudas
    .filter((una) => una && typeof una === 'object')
    .map((una) => {
      const nombre = String(una.name ?? '').trim()
      if (!nombre) return null

      const tieneGrafo = Array.isArray(una.nodes) && una.nodes.length > 0
      const { nodes, edges } = tieneGrafo
        ? { nodes: una.nodes, edges: Array.isArray(una.edges) ? una.edges : [] }
        : dePasosPlanos(una.steps)

      return { name: nombre, nodes, edges }
    })
    .filter(Boolean)

  if (leidas.length === 0) throw new Error('El archivo no trae ninguna orquestación con nombre.')
  return leidas
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
 * Reparte lo que trae el archivo entre lo nuevo y lo que ya existe con ese nombre.
 *
 * Se enseña ANTES de importar, que es lo que hacía v9. Sin esto, un archivo de veinte orquestaciones
 * entra de golpe: no se sabe cuántas venían, ni que doce ya estaban, hasta que la lista aparece con
 * doce «(2)» detrás.
 *
 * Se comparan los nombres sin espacios sobrantes y sin distinguir mayúsculas, porque «Carga diaria» y
 * «carga diaria » son la misma para quien las mira.
 */
export function clasificarImportacion(leidas, existentes) {
  const puestos = new Set((existentes ?? []).map((una) => String(una?.name ?? '').trim().toLowerCase()))

  const nuevas = []
  const repetidas = []

  for (const una of leidas ?? []) {
    const lista = puestos.has(String(una?.name ?? '').trim().toLowerCase()) ? repetidas : nuevas
    lista.push({
      ...una,
      pasos: una?.nodes?.length ?? 0,
      uniones: una?.edges?.length ?? 0,
    })
  }

  return { nuevas, repetidas }
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
