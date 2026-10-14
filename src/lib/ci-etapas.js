// Las orquestaciones de CI Tools como ETAPAS: una fila de etapas, y dentro de cada etapa, pasos en paralelo.
//
//     Etapa 1:  [Dato maestro de productos]
//     Etapa 2:  [Cifras clave de facturas]  [Cifras clave de producción]     <- estas dos corren a la vez
//     Etapa 3:  [Cifras clave de inventario]
//
// El motor guarda grafos (nodos y conexiones). Para quien arma una carga, un grafo libre es más de lo que hace
// falta: casi todas son «esto, después esto, y estas dos a la vez». Las etapas son esa forma, y se traducen a
// un grafo EXACTO: cada paso de una etapa se conecta con todos los de la siguiente. Así el motor no necesita
// saber nada de etapas, y lo que se guarda es un grafo normal.
//
// Al revés, `etapasDeGrafo` reconstruye las etapas de un grafo guardado. Si un grafo no tiene la forma de
// etapas (alguien lo armó de otra manera), dice `exacto: false` en vez de adivinar: mostrar etapas que no son
// el grafo real sería enseñar algo distinto de lo que se ejecuta.
//
// Pura, sin dependencias.

const ANCHO_DE_ETAPA = 280
const ALTO_DE_PASO = 120

let contador = 0

/** Un identificador de nodo nuevo. Con `crypto.randomUUID` donde exista, y con un contador donde no. */
export function nuevoIdDePaso() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `n-${crypto.randomUUID()}`
  contador += 1
  return `n-${Date.now().toString(36)}-${contador}`
}

/** Los pasos que ejecutan algo: los grupos no tienen sitio en este editor. */
const esPaso = (nodo) => nodo.type !== 'group'

/**
 * Un paso nuevo para una integración. Por omisión «detener si falla» y sin reintentos: lo que viene detrás de
 * una carga fallida no se ejecuta, y una carga no se repite sin que alguien lo decida.
 */
export function nuevoPaso(integracion, id = nuevoIdDePaso()) {
  return {
    id,
    type: 'task',
    position: { x: 0, y: 0 },
    data: {
      label: integracion.name,
      integrationId: integracion.id,
      errorStrategy: 'stop',
      maxRetries: 0,
      retryDelaySeconds: 60,
    },
  }
}

/**
 * Reconstruye las etapas de un grafo.
 *
 * La etapa de un paso es el camino más largo que llega hasta él. Devuelve `{ etapas, exacto }`: `exacto` es
 * `true` solo si volver a armar el grafo desde esas etapas da EXACTAMENTE las mismas conexiones. Si no, hay
 * dependencias que las etapas no pueden expresar (un paso que espera a uno de dos etapas atrás, por ejemplo).
 */
export function etapasDeGrafo({ nodes = [], edges = [] } = {}) {
  const pasos = nodes.filter(esPaso)
  const ids = new Set(pasos.map((paso) => paso.id))
  const aristas = edges.filter((arista) => ids.has(arista.source) && ids.has(arista.target))

  const entrantes = new Map(pasos.map((paso) => [paso.id, []]))
  for (const arista of aristas) entrantes.get(arista.target).push(arista.source)

  // Nivel = camino más largo desde un origen. Se calcula por orden topológico; un ciclo (que el servidor
  // rechaza al guardar) dejaría pasos sin nivel y se agrupan al final.
  const nivel = new Map()
  let pendientes = [...pasos]
  let avanzo = true
  while (pendientes.length > 0 && avanzo) {
    avanzo = false
    for (const paso of [...pendientes]) {
      const previos = entrantes.get(paso.id)
      if (previos.every((id) => nivel.has(id))) {
        nivel.set(paso.id, previos.length === 0 ? 0 : Math.max(...previos.map((id) => nivel.get(id))) + 1)
        pendientes = pendientes.filter((otro) => otro.id !== paso.id)
        avanzo = true
      }
    }
  }
  const ultimo = nivel.size === 0 ? 0 : Math.max(...nivel.values()) + 1
  for (const paso of pendientes) nivel.set(paso.id, ultimo)

  const niveles = [...new Set([...nivel.values()])].sort((a, b) => a - b)
  const etapas = niveles.map((n) => pasos.filter((paso) => nivel.get(paso.id) === n))

  const rearmado = grafoDeEtapas(etapas)
  const clave = (arista) => `${arista.source}->${arista.target}`
  const reales = new Set(aristas.map(clave))
  const esperadas = new Set(rearmado.edges.map(clave))
  const exacto = pendientes.length === 0
    && reales.size === esperadas.size
    && [...reales].every((una) => esperadas.has(una))

  return { etapas, exacto }
}

/**
 * Arma el grafo de unas etapas: cada paso de una etapa se conecta con todos los de la siguiente. Les pone
 * posiciones ordenadas (una columna por etapa), por si algún día se dibuja en un lienzo.
 */
export function grafoDeEtapas(etapas) {
  const nodes = []
  const edges = []

  etapas.forEach((etapa, i) => {
    etapa.forEach((paso, fila) => {
      nodes.push({ ...paso, position: { x: i * ANCHO_DE_ETAPA, y: fila * ALTO_DE_PASO } })
    })
    if (i === 0) return
    for (const antes of etapas[i - 1]) {
      for (const despues of etapa) {
        edges.push({ id: `e-${antes.id}-${despues.id}`, source: antes.id, target: despues.id })
      }
    }
  })

  return { nodes, edges }
}

/** Las etapas sin las vacías: una etapa sin pasos no es una etapa. */
const sinVacias = (etapas) => etapas.filter((etapa) => etapa.length > 0)

/**
 * Agrega un paso. Con `indiceDeEtapa` entra en esa etapa (en paralelo con lo que ya haya); sin él, o con un
 * índice fuera de rango, abre una etapa nueva AL FINAL.
 */
export function agregarPaso(etapas, paso, indiceDeEtapa = null) {
  if (indiceDeEtapa === null || indiceDeEtapa < 0 || indiceDeEtapa >= etapas.length) return [...etapas, [paso]]
  return etapas.map((etapa, i) => (i === indiceDeEtapa ? [...etapa, paso] : etapa))
}

/** Quita un paso. Si su etapa queda vacía, la etapa desaparece y las siguientes suben. */
export function quitarPaso(etapas, idDePaso) {
  return sinVacias(etapas.map((etapa) => etapa.filter((paso) => paso.id !== idDePaso)))
}

/** Cambia los datos de un paso (etiqueta, estrategia de error, reintentos…). Lo que no se manda no se toca. */
export function cambiarPaso(etapas, idDePaso, cambios) {
  return etapas.map((etapa) => etapa.map((paso) => (
    paso.id === idDePaso ? { ...paso, data: { ...paso.data, ...cambios } } : paso
  )))
}

/**
 * Mueve un paso a otra etapa. `indiceDeDestino` es el de la etapa a la que entra (en paralelo con lo que haya);
 * con `null` abre una etapa nueva al final. Si su etapa de origen queda vacía, desaparece, y el índice de
 * destino se refiere a las etapas ANTES de moverlo.
 */
export function moverPaso(etapas, idDePaso, indiceDeDestino) {
  const paso = etapas.flat().find((uno) => uno.id === idDePaso)
  if (!paso) return etapas

  // Un índice fuera de rango es «una etapa nueva», igual que `agregarPaso`.
  const destino = indiceDeDestino === null || indiceDeDestino < 0 || indiceDeDestino >= etapas.length
    ? null
    : indiceDeDestino

  const origen = etapas.findIndex((etapa) => etapa.some((uno) => uno.id === idDePaso))
  if (destino === origen) return etapas

  const conPaso = agregarPaso(etapas, paso, destino)
  // Se quita de su etapa de origen: la copia nueva está en la de destino, o en la etapa que se abrió al final.
  return sinVacias(conPaso.map((etapa, i) => {
    const esElDestino = destino !== null && i === destino
    const esLaNueva = destino === null && i === conPaso.length - 1
    return etapa.filter((uno) => uno.id !== idDePaso || esElDestino || esLaNueva)
  }))
}

/** Intercambia una etapa con la anterior (`-1`) o la siguiente (`+1`). Fuera de rango no hace nada. */
export function moverEtapa(etapas, indice, direccion) {
  const destino = indice + direccion
  if (indice < 0 || indice >= etapas.length || destino < 0 || destino >= etapas.length) return etapas
  const copia = [...etapas]
  ;[copia[indice], copia[destino]] = [copia[destino], copia[indice]]
  return copia
}

/** Cuántos pasos hay en total. */
export const totalDePasos = (etapas) => etapas.reduce((suma, etapa) => suma + etapa.length, 0)
