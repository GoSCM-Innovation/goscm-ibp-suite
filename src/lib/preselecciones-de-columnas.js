// Las preselecciones de columnas guardadas: «las tres que siempre miro en esta tabla».
//
// Portado de la parte de preajustes de `DataViewer/ColumnPicker.jsx` de v8.
//
// Por qué existe: una tabla de dato maestro de SAP tiene sesenta columnas y a cada consultor le
// importan seis, casi siempre las mismas. v8 dejaba guardarlas con un nombre y volver a ellas de un
// clic. Sin eso hay que volver a marcar seis casillas entre sesenta, cada vez que se abre la tabla.
//
// Por tabla, no por tenant: las columnas de `Product` no significan nada en `Location`. Y en
// `localStorage`, como en v8: es una preferencia de trabajo de quien mira, no un dato del cliente.

/** Dónde se guardan las de una tabla. */
export const claveDePreselecciones = (tabla) => `columnas_${tabla || 'sin-tabla'}`

/** Las preselecciones guardadas de una tabla, o una lista vacía. */
export function leerPreselecciones(tabla) {
  try {
    const crudo = localStorage.getItem(claveDePreselecciones(tabla))
    const leidas = crudo ? JSON.parse(crudo) : []
    return Array.isArray(leidas) ? leidas.filter((una) => una?.nombre && Array.isArray(una.columnas)) : []
  } catch {
    return []
  }
}

/** Guarda la lista entera. */
function escribir(tabla, lista) {
  try {
    localStorage.setItem(claveDePreselecciones(tabla), JSON.stringify(lista))
  } catch {
    // Sin espacio o en modo privado: se pierde la preselección, no el trabajo.
  }
}

/**
 * Guarda una preselección con nombre. Un nombre repetido REEMPLAZA al anterior.
 *
 * Reemplazar y no añadir: quien vuelve a guardar con el mismo nombre está corrigiendo la de antes, y
 * dos entradas iguales en la lista no se pueden distinguir.
 */
export function guardarPreseleccion(tabla, nombre, columnas) {
  const limpio = String(nombre ?? '').trim()
  if (!limpio) return leerPreselecciones(tabla)

  const otras = leerPreselecciones(tabla).filter((una) => una.nombre !== limpio)
  const lista = [...otras, { nombre: limpio, columnas: [...(columnas ?? [])] }]
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
  escribir(tabla, lista)
  return lista
}

/** Borra una preselección por su nombre. */
export function borrarPreseleccion(tabla, nombre) {
  const lista = leerPreselecciones(tabla).filter((una) => una.nombre !== nombre)
  escribir(tabla, lista)
  return lista
}
