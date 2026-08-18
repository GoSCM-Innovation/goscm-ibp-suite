// Cargar el subárbol de UN producto desde lo que está guardado en el navegador.
//
// Portado de `loadBomSubtree` de `bom.js` de v7, y la razón de que exista es la de v7: un tenant real
// tiene cientos de miles de filas de recetas, y armar el árbol de TODAS para enseñar una es tirar la
// memoria del navegador por la ventana. Así que se recorre a lo ancho —nivel a nivel— desde el
// producto elegido, y solo se indexa lo que ese árbol toca.
//
// El recorrido por niveles no es un detalle de estilo: cada nivel pide sus tablas EN PARALELO, con lo
// que un árbol de ocho niveles son ocho rondas y no una petición por nodo. En v7 esa diferencia era de
// minutos.
//
// Nada de esto vive en `core/` porque es todo IndexedDB, que solo existe en el navegador. Lo que sí
// está en `core/ibp/bom-tree.js` es qué se hace con las filas una vez leídas.

import {
  indexarCabeceras,
  indexarComponentes,
  indexarMaestro,
  indexarPorReceta,
  indicesVacios,
  texto,
} from '../../core/ibp/bom-tree.js'
import { leerPorIndice, leerUno, porCursor } from './explorer-db.js'

/** Tope de vueltas del recorrido. Un árbol de materiales de más de 40 niveles es un dato roto. */
export const MAX_NIVELES = 40

/**
 * Lee el subárbol del producto `prdid` y devuelve los índices para armarlo.
 *
 * `onAvance({ nivel, productos })` se llama al empezar cada nivel, porque en un árbol grande la espera
 * se nota y quedarse mirando una pantalla quieta hace pensar que se colgó.
 */
export async function cargarSubarbol(prdid, { onAvance, conValidez = true } = {}) {
  const indices = indicesVacios()

  const productosVistos = new Set([texto(prdid)])
  const recetasVistas = new Set()
  let cola = [texto(prdid)]
  let nivel = 0

  while (cola.length > 0 && nivel < MAX_NIVELES) {
    nivel += 1
    onAvance?.({ nivel, productos: productosVistos.size })

    // Fase A: las cabeceras de todos los productos de este nivel, a la vez.
    const cabecerasPorProducto = await Promise.all(
      cola.map((uno) => leerPorIndice('bom_psh', 'by_prdid', uno)),
    )

    const recetasNuevas = []
    for (const cabeceras of cabecerasPorProducto) {
      for (const cabecera of cabeceras) {
        const sid = texto(cabecera.SOURCEID)
        if (sid && !recetasVistas.has(sid)) {
          recetasVistas.add(sid)
          recetasNuevas.push(sid)
        }
      }
    }

    if (recetasNuevas.length === 0) break

    // Fase B: por cada receta nueva, sus cuatro (o cinco) tablas a la vez.
    const porReceta = await Promise.all(recetasNuevas.map((sid) => Promise.all([
      leerPorIndice('bom_psh', 'by_sourceid', sid),
      leerPorIndice('bom_psi', 'by_sourceid', sid),
      leerPorIndice('bom_psr', 'by_sourceid', sid),
      leerPorIndice('bom_psisub', 'by_sourceid', sid),
      conValidez ? leerPorIndice('bom_psi_validity', 'by_sourceid', sid) : Promise.resolve([]),
    ])))

    // Fase C: indexar. Las cabeceras ANTES que los componentes, porque la marca de «es componente en
    // esta planta» sale de cruzar los dos y el componente no sabe su planta.
    const siguiente = []
    for (const [cabeceras, componentes, recursos, sustitutos, validez] of porReceta) {
      indexarCabeceras(indices, cabeceras)
      indexarComponentes(indices, componentes)
      indexarPorReceta(indices.recursosPorSid, recursos, 'RESID')
      indexarPorReceta(indices.subsPorSid, sustitutos)
      indexarPorReceta(indices.validezPorSid, validez)

      // Los productos de las cabeceras —principal y coproductos— son el nivel siguiente.
      for (const cabecera of cabeceras) {
        const prd = texto(cabecera.PRDID)
        if (prd && !productosVistos.has(prd)) {
          productosVistos.add(prd)
          siguiente.push(prd)
        }
      }
      // Y los componentes también: son lo que hay que bajar a buscar.
      for (const componente of componentes) {
        const prd = texto(componente.PRDID)
        if (prd && !productosVistos.has(prd)) {
          productosVistos.add(prd)
          siguiente.push(prd)
        }
      }
    }

    cola = siguiente
  }

  // El maestro de los productos que aparecen, y las plantas. Se lee al final y solo de los que
  // salieron: el maestro entero son decenas de miles de filas que nadie va a mirar.
  onAvance?.({ nivel: 'maestro', productos: productosVistos.size })
  await cargarMaestros(indices, productosVistos)

  return { indices, nivelesRecorridos: nivel, productos: productosVistos.size }
}

/**
 * Trae el maestro de productos y de plantas.
 *
 * El producto se pide por su CLAVE y no por un índice: `bom_prd` está guardada con `PRDID` como clave
 * primaria, así que no tiene —ni necesita— un índice por ese campo. Las plantas se recorren enteras por
 * cursor, porque son pocas y no hay por dónde pedirlas de a una.
 */
async function cargarMaestros(indices, productos) {
  const filas = await Promise.all([...productos]
    .map((prd) => leerUno('bom_prd', prd).catch(() => null)))
  indexarMaestro(indices.productos, filas.filter(Boolean), 'PRDID')

  const plantas = []
  await porCursor('bom_loc', (fila) => { plantas.push(fila) })
  indexarMaestro(indices.ubicaciones, plantas, 'LOCID')

  return indices
}

/**
 * Los productos que pueden encabezar un árbol, para el buscador.
 *
 * Se recorre `bom_psh` por cursor y se junta solo el identificador y la planta: la lista completa de
 * filas no cabe en memoria, y para elegir un producto no hace falta.
 */
export async function productosConReceta({ limite = 0 } = {}) {
  const porProducto = new Map()

  await porCursor('bom_psh', (fila) => {
    const prd = texto(fila.PRDID)
    if (!prd) return
    const suyo = porProducto.get(prd) ?? { prdid: prd, plantas: new Set(), recetas: 0 }
    suyo.recetas += 1
    const planta = texto(fila.LOCID)
    if (planta) suyo.plantas.add(planta)
    porProducto.set(prd, suyo)
  })

  const lista = [...porProducto.values()]
    .map((uno) => ({ prdid: uno.prdid, plantas: [...uno.plantas].sort(), recetas: uno.recetas }))
    .sort((a, b) => a.prdid.localeCompare(b.prdid))

  return limite > 0 ? lista.slice(0, limite) : lista
}

/** Las descripciones de una lista de productos, para enseñarlas en el buscador. */
export async function descripcionesDe(prdids) {
  const filas = await Promise.all((prdids ?? [])
    .map((prd) => leerUno('bom_prd', prd).catch(() => null)))

  const porId = {}
  indexarMaestro(porId, filas.filter(Boolean), 'PRDID')
  return Object.fromEntries(Object.entries(porId)
    .map(([id, fila]) => [id, texto(fila.PRDDESCR)]))
}
