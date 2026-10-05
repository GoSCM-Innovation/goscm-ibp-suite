// Lo que la paleta de tareas decide sin pintar nada: el ancho que admite, qué proyectos se ven y
// cuáles se recuerdan como fijados.
//
// Portado de `panel/TaskPalette.jsx` de v9. Va aparte del componente para poder probarlo sin montar
// nada, y porque el almacenamiento del navegador falla de formas que hay que cubrir (bloqueado, lleno,
// ausente) y que es mejor tener en un solo sitio.

/** Los topes de v9, en píxeles: arranca en 210 y se arrastra entre 160 y 520. */
export const ANCHO_INICIAL = 210
export const ANCHO_MINIMO = 160
export const ANCHO_MAXIMO = 520

/** El ancho que resulta de arrastrar el asa: el de partida más lo que se movió, dentro de los topes. */
export const anchoDePaleta = (anchoInicial, desplazamiento) => (
  Math.max(ANCHO_MINIMO, Math.min(ANCHO_MAXIMO, anchoInicial + desplazamiento))
)

/** Los proyectos fijados se recuerdan por DESTINO: los de un repositorio no son los de otro. */
export const claveDeFijados = (destinoId) => `ibp.cids.paleta-fijados.${destinoId}`

/**
 * El almacenamiento del navegador, o `null` si ni siquiera se puede tocar: en algunos navegadores
 * con el sitio bloqueado, mirar `localStorage` ya lanza.
 */
function almacenamiento() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** Los proyectos fijados de un destino, como conjunto de guids. Vacío ante cualquier problema. */
export function leerFijados(destinoId, almacen = almacenamiento()) {
  try {
    const guardado = JSON.parse(almacen?.getItem(claveDeFijados(destinoId)) || '[]')
    return new Set(Array.isArray(guardado) ? guardado : [])
  } catch {
    return new Set()
  }
}

/** Guarda los fijados. Si no se puede, valen para esta visita y no se recuerdan. */
export function guardarFijados(destinoId, fijados, almacen = almacenamiento()) {
  try {
    almacen?.setItem(claveDeFijados(destinoId), JSON.stringify([...fijados]))
  } catch {
    // Almacenamiento bloqueado o lleno: no es motivo para romper la paleta.
  }
}

/** Olvida todos los fijados de un destino. */
export function olvidarFijados(destinoId, almacen = almacenamiento()) {
  try {
    almacen?.removeItem(claveDeFijados(destinoId))
  } catch {
    // Igual que al guardar.
  }
}

const coincide = (texto, consulta) => String(texto ?? '').toLowerCase().includes(consulta)

/** Las tareas de un proyecto que cuadran con la búsqueda. Sin búsqueda, todas. */
export function tareasVisibles(tareas, busqueda) {
  const consulta = String(busqueda ?? '').trim().toLowerCase()
  if (!consulta) return tareas ?? []
  return (tareas ?? []).filter((tarea) => coincide(tarea.taskName, consulta))
}

/**
 * Los proyectos que se ven.
 *
 * El filtro de fijados solo se aplica si hay alguno: con la casilla activa y cero fijados se ve todo,
 * que es mejor que una lista vacía sin explicación. Y la búsqueda encuentra un proyecto por su nombre
 * o por una tarea suya, pero solo mira las tareas de los proyectos ya abiertos: pedirlas todas serían
 * decenas de consultas.
 */
export function proyectosVisibles({ proyectos, tareas, fijados, soloFijados, busqueda }) {
  let lista = proyectos ?? []
  if (soloFijados && fijados.size > 0) lista = lista.filter((proyecto) => fijados.has(proyecto.guid))

  const consulta = String(busqueda ?? '').trim().toLowerCase()
  if (consulta) {
    lista = lista.filter((proyecto) => (
      coincide(proyecto.name, consulta)
      || (tareas?.[proyecto.guid] ?? []).some((tarea) => coincide(tarea.taskName, consulta))
    ))
  }
  return lista
}

/** El texto que sale al pasar por una tarea: su nombre y, debajo, la descripción si la tiene. */
export function textoDeTarea(tarea) {
  const descripcion = String(tarea?.description ?? '').trim()
  return descripcion ? `${tarea.taskName}\n\n${descripcion}` : String(tarea?.taskName ?? '')
}
