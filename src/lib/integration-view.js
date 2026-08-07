// Lo que el explorador muestra: filtros, agrupaciones y dimensiones.
//
// Separado de `integration-index.js` porque son dos cosas distintas: allá se analiza el proyecto una
// vez, acá se decide qué se ve en pantalla, que cambia con cada tecla que se escribe. Está aparte de
// los componentes para poder probarlo sin montar nada.

/** Las dimensiones por las que se puede explorar un proyecto, en el orden de v9. */
export const DIMENSIONES = [
  { id: 'integracion', label: 'Integración', icono: '🔗' },
  { id: 'dst-table', label: 'Tabla destino', icono: '📤', indice: 'byDstTable', fila: 'mIdx' },
  { id: 'src-table', label: 'Tabla origen', icono: '📥', indice: 'bySrcTable', fila: 'mIdx' },
  { id: 'dst-field', label: 'Campo destino', icono: '📋', indice: 'byDstField', fila: 'mIdx' },
  { id: 'src-field', label: 'Campo origen', icono: '📋', indice: 'bySrcField', fila: 'mIdx' },
  { id: 'filter-table', label: 'Tabla de filtro', icono: '🔍', indice: 'byFilterTable', fila: 'fIdx' },
  { id: 'filter-field', label: 'Campo de filtro', icono: '🎯', indice: 'byFilterField', fila: 'fIdx' },
  // Solo aparece cuando hay ATL cargados: sin ellos no se sabe ningún proceso.
  { id: 'atl-proceso', label: 'Proceso de CI-DS', icono: '🧩', soloConAtl: true },
]

export const dimensionPorId = (id) => DIMENSIONES.find((una) => una.id === id) ?? DIMENSIONES[0]

/** Cómo se lee una clave de dimensión: `ERP::MARA` es una tabla, `MATNR` un campo. */
export function etiquetaDeClave(clave) {
  if (!clave.includes('::')) return clave
  const [datastore, tabla] = clave.split('::')
  return datastore ? `${datastore} · ${tabla}` : tabla
}

/** Los valores distintos de un campo, ordenados, para armar un filtro. */
const valoresDistintos = (integraciones, leer) => [...new Set(
  integraciones.map(leer).filter(Boolean),
)].sort((a, b) => a.localeCompare(b))

/** Las áreas de planificación que aparecen en el proyecto. */
export const planAreaOptions = (integraciones) => valoresDistintos(integraciones, (una) => una.planArea)

/** Los datastores de origen y de destino que aparecen en el proyecto. */
export const datastoreOptions = (integraciones) => ({
  origen: valoresDistintos(integraciones, (una) => una.srcDSName),
  destino: valoresDistintos(integraciones, (una) => una.dstDSName),
})

/**
 * Las integraciones que pasan los filtros de arriba, sin contar la búsqueda de texto.
 *
 * Es la base que comparten la lista, el grafo y las dimensiones: si el grafo no la usara, mostraría
 * nodos que la lista ya escondió.
 *
 * Un conjunto vacío significa "todas", no "ninguna": es lo que espera quien no tocó el filtro.
 */
export function baseFiltrada(integraciones, filtros = {}) {
  const { planAreas, srcDS, dstDS, soloTransportadas, transportadas } = filtros

  return integraciones.filter((una) => {
    if (planAreas?.size > 0 && !planAreas.has(una.planArea)) return false
    if (srcDS?.size > 0 && !srcDS.has(una.srcDSName)) return false
    if (dstDS?.size > 0 && !dstDS.has(una.dstDSName)) return false
    if (soloTransportadas && !transportadas?.has((una.jobName || '').toUpperCase())) return false
    return true
  })
}

/**
 * Aplica además la búsqueda de texto, que mira el índice y no las integraciones.
 *
 * El índice trae el texto de cada integración ya aplanado —campos, filtros, lookups, variables—, así
 * que una búsqueda recorre una cadena por integración en vez de todo su contenido.
 */
export function filtrarIntegraciones(integraciones, indices, texto, filtros = {}) {
  const base = baseFiltrada(integraciones, filtros)
  const buscado = (texto || '').trim().toLowerCase()
  if (!buscado) return base

  const coinciden = new Set(
    (indices?.searchTokens ?? []).filter((uno) => uno.tokens.includes(buscado)).map((uno) => uno.idx),
  )
  return base.filter((una) => coinciden.has(una._idx))
}

/**
 * La lista de la izquierda, agrupada como en CI-DS: por proyecto, y dentro por tarea.
 *
 * Una tarea con un solo dataflow se muestra como una fila y no como un grupo de uno: agrupar algo
 * que no tiene hermanos solo agrega un clic.
 */
export function agruparParaLista(lista) {
  const proyectos = []
  const porZip = new Map()

  for (const integracion of lista) {
    const zip = integracion._zipName || ''
    if (!porZip.has(zip)) {
      const grupo = { zip, nombre: zip.replace(/\.zip$/i, ''), tareas: [], porTarea: new Map(), total: 0 }
      porZip.set(zip, grupo)
      proyectos.push(grupo)
    }

    const proyecto = porZip.get(zip)
    const tarea = integracion.jobName || ''
    if (!proyecto.porTarea.has(tarea)) {
      const grupo = { jobName: tarea, dataflows: [] }
      proyecto.porTarea.set(tarea, grupo)
      proyecto.tareas.push(grupo)
    }
    proyecto.porTarea.get(tarea).dataflows.push(integracion)
    proyecto.total += 1
  }

  // `porTarea` era solo para armar los grupos; devolverlo obligaría a quien pinte a ignorarlo.
  for (const proyecto of proyectos) delete proyecto.porTarea
  return proyectos
}

/**
 * Las claves de una dimensión, con las filas de cada una, ordenadas de más usada a menos.
 *
 * Se recorta a lo que dejan pasar los filtros de arriba: una tabla que solo usan integraciones
 * escondidas no tiene por qué aparecer en la lista.
 */
export function entradasDeDimension(indices, dim, texto, visibles) {
  const definicion = dimensionPorId(dim)
  if (!definicion.indice) return []

  const mapa = indices?.[definicion.indice] ?? {}
  const buscado = (texto || '').trim().toLowerCase()

  const entradas = []
  for (const [clave, filas] of Object.entries(mapa)) {
    const propias = visibles ? filas.filter((una) => visibles.has(una.intIdx)) : filas
    if (propias.length === 0) continue
    if (buscado && !clave.toLowerCase().includes(buscado)) continue
    entradas.push({ clave, etiqueta: etiquetaDeClave(clave), filas: propias })
  }

  // Lo más usado primero: es lo que se está buscando cuando se abre una dimensión.
  entradas.sort((a, b) => b.filas.length - a.filas.length || a.clave.localeCompare(b.clave))
  return entradas
}

/**
 * Las filas de una dimensión repartidas por integración, sin repetir.
 *
 * Una misma expresión de filtro puede coincidir por varios campos a la vez y aparecería tantas veces
 * como campos tenga.
 */
export function filasPorIntegracion(filas, campo) {
  const porIntegracion = new Map()
  for (const fila of filas) {
    if (!porIntegracion.has(fila.intIdx)) porIntegracion.set(fila.intIdx, new Set())
    porIntegracion.get(fila.intIdx).add(fila[campo])
  }
  return [...porIntegracion].map(([intIdx, indices]) => ({ intIdx, indices: [...indices] }))
}

/** Quién alimenta a esta integración y a quién alimenta ella. */
export function vecinos(cadenas, idx) {
  return {
    entrantes: cadenas.filter((una) => una.to === idx),
    salientes: cadenas.filter((una) => una.from === idx),
  }
}

/** El color de cada vía de encadenamiento. El mismo en la lista, el detalle y el grafo. */
export const COLOR_DE_VIA = { table: '#34d399', file: '#e8622a', lookup: '#a78bfa' }

/** El icono de cada vía, para cuando no hay lugar para la palabra. */
export const ICONO_DE_VIA = { table: '⬌', file: '📄', lookup: '🔍' }

/** Cómo se llama cada vía en castellano. */
export const NOMBRE_DE_VIA = { table: 'tabla', file: 'archivo', lookup: 'lookup' }

/** El color de cada tipo de integración. De la paleta de v9. */
export const COLOR_DE_TIPO = { MD: '#f7a800', KF: '#29abe2', FILE: '#e8622a' }
