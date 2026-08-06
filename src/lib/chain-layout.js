// Dónde va cada integración en el grafo de cadenas.
//
// Se ordena por niveles de izquierda a derecha: en la primera columna lo que no depende de nadie, y
// cada integración una columna a la derecha de la última que la alimenta. Así se lee el orden en que
// hay que ejecutarlas, que es para lo que se mira este grafo.
//
// v9 delegaba esto en el modo jerárquico de vis-network. Acá se calcula, porque `@xyflow/react`
// —que ya está en el proyecto— no trae layout propio y no hace falta traer otra librería para esto.

/** Cuánto separan dos columnas y dos filas. Una caja mide ~190×48. */
export const SEPARACION = { x: 280, y: 78 }

/**
 * El nivel de cada nodo: uno más que el mayor de los que lo alimentan.
 *
 * Los nodos que están dentro de un ciclo nunca se resuelven —cada uno espera al otro— y se dejan en
 * el nivel cero. En este grafo un ciclo no es un error: dos integraciones pueden alimentarse
 * mutuamente por vías distintas, y esconderlas sería peor que dibujarlas juntas al principio.
 */
export function nivelesPorDependencia(ids, aristas) {
  const nivel = new Map(ids.map((id) => [id, 0]))
  const entrantes = new Map(ids.map((id) => [id, []]))
  for (const arista of aristas) {
    if (entrantes.has(arista.to) && nivel.has(arista.from)) entrantes.get(arista.to).push(arista.from)
  }

  // Se repite hasta que nada cambie. Con un ciclo, el tope de vueltas lo corta: cada vuelta resuelve
  // al menos un nodo más, así que más vueltas que nodos significa que lo que queda es circular.
  for (let vuelta = 0; vuelta < ids.length; vuelta += 1) {
    let cambio = false
    for (const id of ids) {
      const propuesto = entrantes.get(id).reduce((mayor, desde) => Math.max(mayor, nivel.get(desde) + 1), 0)
      if (propuesto > nivel.get(id)) { nivel.set(id, propuesto); cambio = true }
    }
    if (!cambio) break
  }

  return nivel
}

/**
 * La posición de cada nodo, por su identificador.
 *
 * Dentro de una columna se respeta el orden en que vinieron: es el del proyecto, y mantenerlo hace
 * que dos análisis del mismo export se dibujen igual.
 */
export function layoutChainGraph(ids, aristas) {
  const nivel = nivelesPorDependencia(ids, aristas)
  const ocupados = new Map()
  const posiciones = new Map()

  for (const id of ids) {
    const columna = nivel.get(id)
    const fila = ocupados.get(columna) ?? 0
    ocupados.set(columna, fila + 1)
    posiciones.set(id, { x: columna * SEPARACION.x, y: fila * SEPARACION.y })
  }

  return posiciones
}
