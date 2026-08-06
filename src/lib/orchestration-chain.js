// Una orquestación vista como una cadena: ¿se puede?, y en qué orden corren sus pasos.
//
// Va aparte del editor del teléfono porque son decisiones, no pintado — y porque así se prueban sin
// montar un componente.

/**
 * ¿Es este grafo una cadena simple que se puede mostrar como lista?
 *
 * Lo es cuando no hay grupos y cada paso tiene como mucho uno antes y uno después. En cuanto se abre
 * en dos, el orden deja de ser una lista y mostrarlo como tal mentiría.
 */
export function esCadenaSimple(nodes, edges) {
  if (nodes.some((nodo) => nodo.type === 'group' || nodo.parentId)) return false

  const salientes = new Map()
  const entrantes = new Map()
  for (const arista of edges) {
    salientes.set(arista.source, (salientes.get(arista.source) ?? 0) + 1)
    entrantes.set(arista.target, (entrantes.get(arista.target) ?? 0) + 1)
  }
  return nodes.every((nodo) => (salientes.get(nodo.id) ?? 0) <= 1 && (entrantes.get(nodo.id) ?? 0) <= 1)
}

/** Los pasos en el orden en que corren, siguiendo la cadena desde el que no tiene nada antes. */
export function enOrden(nodes, edges) {
  const siguiente = new Map(edges.map((arista) => [arista.source, arista.target]))
  const tieneAntes = new Set(edges.map((arista) => arista.target))
  const porId = new Map(nodes.map((nodo) => [nodo.id, nodo]))

  const ordenados = []
  const vistos = new Set()

  // Se arranca por los que no tienen nada antes; los sueltos entran también, cada uno como su cadena.
  for (const nodo of nodes.filter((uno) => !tieneAntes.has(uno.id))) {
    let actual = nodo
    while (actual && !vistos.has(actual.id)) {
      vistos.add(actual.id)
      ordenados.push(actual)
      actual = porId.get(siguiente.get(actual.id))
    }
  }
  // Red de seguridad: si algo quedó fuera, se agrega al final en vez de desaparecer de la pantalla.
  return [...ordenados, ...nodes.filter((nodo) => !vistos.has(nodo.id))]
}
