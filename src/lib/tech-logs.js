// Las últimas llamadas que hizo la aplicación, para poder diagnosticar sin abrir las herramientas
// del navegador.
//
// Portado de `TechLogs.jsx`, que existía DOS veces —una en v8 y otra en v9, con la misma idea y
// distinto tamaño de tope—. Aquí es una sola, y con un cambio de fondo: en las dos originales cada
// pantalla tenía que llamar a `addLog(...)` después de cada petición. Eso significa que el panel solo
// veía lo que alguien se acordó de registrar, y que una pantalla nueva empezaba muda.
//
// Aquí lo anota `api.js`, por donde pasa TODO el tráfico. El panel no registra nada: lee. Ninguna
// pantalla tiene que acordarse de nada, y lo que se ve es lo que de verdad pasó.
//
// Vive en memoria y se pierde al recargar, a propósito: es para mirar lo que acaba de fallar, no un
// historial. Guardarlo sería acumular rutas y estados de un usuario sin que nadie los haya pedido.

/** Cuántas llamadas se recuerdan. Cien: lo que usaba v8, y alcanza para reconstruir una pantalla. */
export const TOPE = 100

/** El agrupado de v9: las llamadas repetidas seguidas se colapsan con un contador. */
export function agrupar(llamadas) {
  const grupos = []

  for (const llamada of llamadas ?? []) {
    const clave = `${llamada.metodo}|${llamada.ruta}|${llamada.estado}`
    const ultimo = grupos[grupos.length - 1]

    if (ultimo?.clave === clave) {
      ultimo.veces += 1
      // Se conserva la MÁS RECIENTE: con un refresco cada treinta segundos, la primera de la tanda
      // es la vieja y la interesante es la última.
      ultimo.llamada = llamada
    } else {
      grupos.push({ clave, llamada, veces: 1 })
    }
  }

  return grupos
}

/** Las llamadas, de la más reciente a la más antigua. */
let registro = []

/** Quién quiere enterarse de que hay una nueva. */
const oyentes = new Set()

/** Lo anota `api.js`. `ms` es cuánto tardó; `detalle` es el mensaje de error, si hubo. */
export function anotarLlamada({ metodo, ruta, estado, ms, detalle = '' }) {
  registro = [{
    metodo,
    ruta,
    estado,
    ms,
    detalle,
    cuando: new Date().toISOString(),
  }, ...registro].slice(0, TOPE)

  for (const avisar of oyentes) avisar()
}

/** Todo lo anotado. */
export const llamadas = () => registro

/** Olvida lo anotado. Para el botón de limpiar y para los tests. */
export function limpiarLlamadas() {
  registro = []
  for (const avisar of oyentes) avisar()
}

/** Avisa cuando hay una llamada nueva. Devuelve cómo dejar de escuchar. */
export function suscribir(avisar) {
  oyentes.add(avisar)
  return () => oyentes.delete(avisar)
}
