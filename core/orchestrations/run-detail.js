// El detalle de una ejecución: qué pasó en cada paso, en qué orden y cuánto tardó.
//
// Portado de `RunLogModal.jsx` de v9, que armaba el árbol y calculaba las duraciones dentro del
// render. Aquí está aparte y es puro, así que se puede comprobar sin montar nada.
//
// Para qué sirve, que es lo que faltaba: la barra de ejecución dice CUÁNTOS pasos van bien y el lienzo
// colorea los nodos, pero ninguna de las dos contesta "el paso 3 tardó cuatro minutos y esto dijo".
// Eso es justamente lo que se necesita cuando una cadena de doce pasos falló anoche.

/** Los estados de un paso, con su nombre visible. Los colores los pone quien dibuja. */
export const ESTADO_DE_PASO = Object.freeze({
  pending: 'Pendiente',
  running: 'Ejecutando',
  success: 'Terminado',
  success_with_errors: 'Terminado con avisos',
  error: 'Con fallo',
  cancelled: 'Cancelado',
  skipped: 'Omitido',
})

export const nombreDeEstado = (estado) => ESTADO_DE_PASO[estado] ?? estado ?? '—'

/**
 * Cuánto duró un paso, en milisegundos. `null` si todavía no empezó.
 *
 * Un paso que empezó y no terminó se mide contra `ahora`: enseñar «—» en el que está corriendo es
 * justo esconder el dato que se está mirando.
 */
export function duracionMs(paso, ahora = Date.now()) {
  if (!paso?.startedAt) return null
  const desde = Date.parse(paso.startedAt)
  if (Number.isNaN(desde)) return null

  const hasta = paso.finishedAt ? Date.parse(paso.finishedAt) : ahora
  return Math.max(0, (Number.isNaN(hasta) ? ahora : hasta) - desde)
}

/** Una duración como se lee: segundos hasta el minuto, después minutos y segundos. */
export function escribirDuracion(ms) {
  if (ms === null || ms === undefined) return '—'

  const segundos = Math.floor(ms / 1000)
  if (segundos < 60) return `${segundos} s`

  const minutos = Math.floor(segundos / 60)
  const resto = segundos % 60
  return resto === 0 ? `${minutos} min` : `${minutos} min ${resto} s`
}

/**
 * El árbol de pasos de una ejecución, en el orden del grafo y con los hijos dentro de su grupo.
 *
 * El orden sale de `nodes` de la orquestación y no de las claves del estado: el estado es un objeto y
 * su orden de claves no es el del dibujo, así que ordenar por él mostraría los pasos en un orden que
 * no se corresponde con nada de lo que se ve en el lienzo.
 */
export function arbolDeEjecucion(orquestacion, run, ahora = Date.now()) {
  const nodos = orquestacion?.nodes ?? []
  const estados = run?.nodes ?? {}

  const deNodo = (nodo, estado, nivel) => ({
    id: nodo.id,
    nombre: nodo.data?.label || nodo.data?.taskName || nodo.data?.templateName || nodo.id,
    esGrupo: nodo.type === 'group',
    nivel,
    status: estado?.status ?? 'pending',
    startedAt: estado?.startedAt ?? null,
    finishedAt: estado?.finishedAt ?? null,
    sapRunId: estado?.sapRunId ?? null,
    error: estado?.error ?? null,
    reintentos: Number(estado?.retryCount ?? 0),
    ms: duracionMs(estado, ahora),
  })

  const filas = []
  for (const nodo of nodos.filter((uno) => !uno.parentId)) {
    const estado = estados[nodo.id]
    filas.push(deNodo(nodo, estado, 0))

    if (nodo.type === 'group') {
      for (const hijo of nodos.filter((uno) => uno.parentId === nodo.id)) {
        filas.push(deNodo(hijo, estado?.children?.[hijo.id], 1))
      }
    }
  }

  return filas
}

/** Cuántos pasos hay en cada estado, contando también los hijos de los grupos. */
export function contarPasos(filas) {
  const cuenta = {}
  // Un grupo no se cuenta: su estado es el resumen de sus hijos, y contarlo lo sumaría dos veces.
  for (const fila of (filas ?? []).filter((una) => !una.esGrupo)) {
    cuenta[fila.status] = (cuenta[fila.status] ?? 0) + 1
  }
  return cuenta
}

/**
 * Los pasos que hay que mirar: los que fallaron y los que se cancelaron.
 *
 * Es lo primero que se busca al abrir una ejecución que salió mal, y con doce pasos en pantalla
 * encontrarlos a ojo es justo el trabajo que la herramienta debería ahorrar.
 */
export const pasosConProblema = (filas) =>
  (filas ?? []).filter((una) => !una.esGrupo && (una.status === 'error' || una.status === 'cancelled'))
