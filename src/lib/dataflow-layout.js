// Dónde va cada caja del diagrama de un dataflow.
//
// El XMI trae las coordenadas con las que CI-DS lo dibuja, pero en su propia escala: en un proyecto
// los nodos están a 40 unidades y en otro a 4.000. v9 lo resolvía con un factor de escala adaptativo
// y un ajuste vertical a ojo; aquí se hace de otra forma, que da el mismo dibujo sin depender de la
// escala del origen.
//
// La idea: lo único que importa de una coordenada es el ORDEN y qué nodos están alineados entre sí.
// Se agrupan los valores parecidos en columnas y filas, y se reparten a distancia fija. El diagrama
// queda idéntico en su forma y siempre legible.

/** Cuánto separan dos columnas y dos filas. Una caja mide ~180×54. */
export const SEPARACION = { x: 240, y: 96 }

/**
 * Dos coordenadas más cercanas que esto son la misma columna o la misma fila.
 *
 * Es relativo al ancho total porque las escalas cambian por proyecto. El 6% es lo que separa un
 * desalineado de dibujo de un nivel distinto de verdad.
 */
const TOLERANCIA = 0.06

/**
 * Agrupa valores parecidos y devuelve `valor → número de grupo`.
 *
 * Con un solo valor distinto no hay nada que agrupar y todos van al grupo cero.
 */
export function agruparCoordenadas(valores) {
  const distintos = [...new Set(valores)].sort((a, b) => a - b)
  if (distintos.length === 0) return new Map()

  const rango = distintos[distintos.length - 1] - distintos[0]
  const minimo = rango * TOLERANCIA

  const grupos = new Map()
  let grupo = 0
  let referencia = distintos[0]

  for (const valor of distintos) {
    if (valor - referencia > minimo) { grupo += 1; referencia = valor }
    grupos.set(valor, grupo)
  }

  return grupos
}

/**
 * La posición de cada nodo del diagrama, en el orden en que vinieron.
 *
 * Los nodos sin coordenadas —que el XMI a veces no trae— se ponen en una columna al final, uno
 * debajo del otro: no se sabe dónde iban, pero tienen que verse.
 */
export function layoutDataflow(nodos) {
  const conPosicion = nodos.filter((uno) => uno.location)
  const columnas = agruparCoordenadas(conPosicion.map((uno) => uno.location.x))
  const filas = agruparCoordenadas(conPosicion.map((uno) => uno.location.y))

  const ultimaColumna = columnas.size > 0 ? Math.max(...columnas.values()) : -1
  let sueltos = 0

  return nodos.map((uno) => {
    if (!uno.location) {
      const y = sueltos * SEPARACION.y
      sueltos += 1
      return { x: (ultimaColumna + 1) * SEPARACION.x, y }
    }
    return {
      x: columnas.get(uno.location.x) * SEPARACION.x,
      y: filas.get(uno.location.y) * SEPARACION.y,
    }
  })
}
