// Lo que el panel «Rutas» del Network Visualizer dice y exporta, con las palabras de v7.
//
// Portado de `vizRenderRutas`, `vizRutasRenderTable`, `vizRutasHighlight` y `vizRutasCsv` de
// `visualizer.js`. Está aparte del componente para poder comprobarlo sin montar nada: el resumen, el
// filtro, el rótulo de cada fila y el CSV son texto que el cliente lleva años leyendo, y un cambio de
// una coma no se ve en pantalla pero rompe la hoja de quien lo abre.

import { FINALES, resumirRutas } from '../../core/ibp/supply-network.js'

/** Cuántas filas se dibujan (`_RUTAS_CAP` de v7). El CSV exporta todas. */
export const TOPE_DE_FILAS = 500

/**
 * La línea de resumen: «N con llegada a cliente · M sin llegada a cliente (a dead-ends, b ciclos) …».
 *
 * Las palabras van en singular o plural como en v7 («1 dead-end», «2 dead-ends», «1 planta huérfana»).
 */
export function resumenDeRutas({ rutas, truncado = false, plantasHuerfanas = [] }) {
  const { conCliente, sinCliente, sinSalida, ciclos } = resumirRutas(rutas)

  let sinLlegada = ''
  if (sinCliente > 0) {
    const detalles = []
    if (sinSalida) detalles.push(sinSalida === 1 ? '1 dead-end' : `${sinSalida} dead-ends`)
    if (ciclos) detalles.push(ciclos === 1 ? '1 ciclo' : `${ciclos} ciclos`)
    sinLlegada = ` · ${sinCliente} sin llegada a cliente (${detalles.join(', ')})`
  }

  let huerfanas = ''
  if (plantasHuerfanas.length > 0) {
    huerfanas = plantasHuerfanas.length === 1
      ? ` · ⚠ 1 planta huérfana: ${plantasHuerfanas.join(', ')}`
      : ` · ⚠ ${plantasHuerfanas.length} plantas huérfanas: ${plantasHuerfanas.join(', ')}`
  }

  return `${conCliente} con llegada a cliente${sinLlegada}${huerfanas}${truncado ? ' (truncadas a 50.000)' : ''}`
}

/**
 * Las rutas que pasan el filtro, cada una con su posición en la lista completa.
 *
 * La posición importa: al hacer clic en una fila se resalta la ruta, y la tabla enseña la lista
 * filtrada pero la ruta se busca en la entera.
 *
 * `tipo`: `todas` | `cliente` | `sinCliente`. `final` solo cuenta dentro de `sinCliente`. `q` busca en
 * la planta, los nodos, el cliente y el último nodo, sin distinguir mayúsculas.
 */
export function filtrarRutas(rutas, { tipo = 'todas', final = 'todos', q = '' } = {}) {
  const buscado = String(q).trim().toLowerCase()
  const salida = []

  ;(rutas ?? []).forEach((ruta, indice) => {
    if (tipo === 'cliente' && !ruta.llegaACliente) return
    if (tipo === 'sinCliente' && ruta.llegaACliente) return
    if (tipo === 'sinCliente' && final !== 'todos' && ruta.final !== final) return
    if (buscado) {
      const pajar = `${ruta.planta} ${ruta.nodos.join(' ')} ${ruta.cliente || ''} ${ruta.ultimo || ''}`.toLowerCase()
      if (!pajar.includes(buscado)) return
    }
    salida.push({ ruta, indice })
  })

  return salida
}

/** La ruta como se lee en la tabla: los nodos, y el cliente al final si lo hay. */
export const rutaComoTexto = (ruta, separador = ' → ') =>
  ruta.nodos.join(separador) + (ruta.cliente ? `${separador}${ruta.cliente}` : '')

/** Cuántos saltos tiene: un arco menos que nodos, y uno más si entrega a un cliente. */
export const saltosDe = (ruta) => ruta.nodos.length - 1 + (ruta.cliente ? 1 : 0)

/** Dónde termina: el cliente, o el último nodo si no llegó a ninguno. */
export const terminaEn = (ruta) => (ruta.llegaACliente ? (ruta.cliente || '') : (ruta.ultimo || ''))

/** El rótulo de la columna «Tipo» y su color, como en v7. */
export function rotuloDeRuta(ruta) {
  if (ruta.llegaACliente) return { texto: '✓ Con llegada a cliente', color: 'var(--green)' }
  if (ruta.final === FINALES.ciclo) return { texto: '↻ Sin llegada · Ciclo', color: '#a78bfa' }
  return { texto: '⚠ Sin llegada · Dead-end', color: '#F59E0B' }
}

/** La nota que sale cuando hay más filas que el tope. Vacía si caben todas. */
export const notaDeTope = (total) => (total > TOPE_DE_FILAS
  ? `Mostrando ${TOPE_DE_FILAS} de ${total} rutas — exporta el CSV para verlas todas.`
  : '')

/**
 * Los nodos y los pares de nodos que hay que seleccionar en el grafo para resaltar una ruta.
 *
 * Los pares son los arcos de la ruta, en el orden en que se recorre, incluido el último a cliente.
 */
export function trazaDeRuta(ruta) {
  const nodos = ruta.nodos.concat(ruta.cliente ? [ruta.cliente] : [])
  const pares = []
  for (let i = 0; i < ruta.nodos.length - 1; i += 1) pares.push([ruta.nodos[i], ruta.nodos[i + 1]])
  if (ruta.cliente) pares.push([ruta.nodos[ruta.nodos.length - 1], ruta.cliente])
  return { nodos, pares }
}

/**
 * El CSV de TODAS las rutas, sin filtrar, tal como lo armaba v7.
 *
 * Coma como separador, saltos de línea `\n` y SIN marca de codificación: es el formato de v7 y quien
 * ya tiene hojas hechas sobre él las seguirá abriendo igual. La columna «Ruta» va entre comillas y
 * con `->`, no con flechas.
 */
export function csvDeRutas(rutas) {
  const lineas = ['"#","Tipo","Causa","Planta","Ruta","Termina en","Cliente","# Saltos"']
  ;(rutas ?? []).forEach((ruta, i) => {
    const tipo = ruta.llegaACliente ? 'Con llegada a cliente' : 'Sin llegada a cliente'
    const causa = ruta.llegaACliente ? '' : (ruta.final === FINALES.ciclo ? 'Ciclo' : 'Dead-end')
    lineas.push([
      i + 1, tipo, causa, ruta.planta, `"${rutaComoTexto(ruta, ' -> ')}"`,
      terminaEn(ruta), ruta.cliente || '', saltosDe(ruta),
    ].join(','))
  })
  return lineas.join('\n')
}

/** El nombre del archivo: `Rutas_{producto}.csv`. */
export const nombreDelCsv = (producto) => `Rutas_${producto || 'producto'}.csv`
