// Armar el grafo de cada producto desde lo descargado y analizarlo.
//
// Portado de las fases 2 y 3 de `analyzer.js` de v7. El juicio está en `core/ibp/network-analysis.js`.
//
// La diferencia con el analizador de la jerarquía es el volumen: aquí hay que construir un GRAFO por
// producto, y son miles de productos sobre 52.000 arcos entre ubicaciones y 132.000 hacia clientes.
// v7 lo resolvía con un pre-índice global recorrido por cursor y un bucle en tandas, y esa es la parte
// que se conserva:
//
//   - Una sola pasada por cada tabla grande, agrupando por producto. Lo que queda en memoria son mapas
//     de código a lista de códigos, no filas.
//   - El grafo de cada producto se arma, se juzga y se tira. Nunca hay más de uno vivo.
//   - Se cede el hilo cada tanda para que el navegador siga respondiendo: un análisis de cinco mil
//     productos que congela la pestaña se lee como que la aplicación se colgó.

import { grafoVacio, analizarRed, filaDeRed, resumirRedes } from '../../core/ibp/network-analysis.js'
import { texto } from '../../core/ibp/production-analysis.js'
import { guardar, porCursor, vaciar } from './explorer-db.js'

/** Productos por tanda antes de ceder el hilo. */
export const POR_TANDA = 200

/**
 * Los índices globales, de una pasada por tabla.
 *
 * Todo por producto: sus plantas, sus arcos, sus clientes y sus plazos. Es lo que permite armar el
 * grafo de uno sin volver a tocar el disco.
 */
export async function indicesDeRed({ onAvance } = {}) {
  const plantasDe = new Map()
  const plazoDePlantaDe = new Map()
  const arcosDe = new Map()
  const clientesDe = new Map()
  const enLocProduct = new Set()
  const enCustProduct = new Set()
  const consumeEn = new Map()
  const recetaDePlanta = new Map()
  const enPSI = new Set()

  const anotarEn = (mapa, clave, valor) => {
    if (!mapa.has(clave)) mapa.set(clave, [])
    mapa.get(clave).push(valor)
  }

  onAvance?.({ paso: 'recetas' })
  await porCursor('sn_plant', (fila) => {
    const prd = texto(fila.PRDID)
    const loc = texto(fila.LOCID)
    const receta = texto(fila.SOURCEID)
    if (!prd || !loc) return

    anotarEn(plantasDe, prd, loc)
    if (receta) recetaDePlanta.set(receta, loc)

    const clave = `${prd}|${loc}`
    if (!plazoDePlantaDe.has(clave)) plazoDePlantaDe.set(clave, texto(fila.PLEADTIME))
  })

  // Qué producto consume cada receta, y en qué planta: es lo que distingue un semiterminado que se
  // consume donde se hace de uno que hay que transferir.
  onAvance?.({ paso: 'componentes' })
  await porCursor('sn_psi', (fila) => {
    const componente = texto(fila.PRDID)
    const planta = recetaDePlanta.get(texto(fila.SOURCEID))
    if (!componente) return
    enPSI.add(componente)
    if (planta) anotarEn(consumeEn, componente, planta)
  })

  onAvance?.({ paso: 'arcos' })
  await porCursor('sn_loc', (fila) => {
    const prd = texto(fila.PRDID)
    const desde = texto(fila.LOCFR)
    const hasta = texto(fila.LOCID)
    if (!prd || !desde || !hasta) return
    anotarEn(arcosDe, prd, { desde, hasta, plazo: texto(fila.TLEADTIME) })
  })

  onAvance?.({ paso: 'clientes' })
  await porCursor('sn_cust', (fila) => {
    const prd = texto(fila.PRDID)
    const desde = texto(fila.LOCID)
    const cliente = texto(fila.CUSTID)
    if (!prd || !desde || !cliente) return
    anotarEn(clientesDe, prd, { desde, cliente, plazo: texto(fila.CLEADTIME) })
  })

  onAvance?.({ paso: 'cobertura' })
  await porCursor('sn_loc_prod', (fila) => {
    const prd = texto(fila.PRDID)
    if (prd) enLocProduct.add(prd)
  })
  await porCursor('sn_cust_prod', (fila) => {
    const prd = texto(fila.PRDID)
    if (prd) enCustProduct.add(prd)
  })

  return {
    plantasDe, plazoDePlantaDe, arcosDe, clientesDe,
    enLocProduct, enCustProduct, consumeEn, enPSI,
  }
}

/** El grafo de UN producto. Se arma, se juzga y se tira. */
export function grafoDe(prdid, indices) {
  const grafo = grafoVacio()
  const plantas = indices.plantasDe.get(prdid) ?? []

  grafo.plantas = [...new Set(plantas)]
  for (const una of grafo.plantas) {
    grafo.plazoDePlanta[una] = indices.plazoDePlantaDe.get(`${prdid}|${una}`) ?? ''
  }

  const ubicaciones = new Set(grafo.plantas)

  for (const { desde, hasta, plazo } of indices.arcosDe.get(prdid) ?? []) {
    ubicaciones.add(desde)
    ubicaciones.add(hasta)
    grafo.arcos[desde] = grafo.arcos[desde] ?? []
    if (!grafo.arcos[desde].includes(hasta)) grafo.arcos[desde].push(hasta)
    grafo.plazoDeArco[`${desde}|${hasta}`] = plazo
  }

  for (const { desde, cliente, plazo } of indices.clientesDe.get(prdid) ?? []) {
    ubicaciones.add(desde)
    grafo.arcosACliente[desde] = grafo.arcosACliente[desde] ?? []
    if (!grafo.arcosACliente[desde].includes(cliente)) grafo.arcosACliente[desde].push(cliente)
    grafo.plazoDeCliente[`${desde}|${cliente}`] = plazo
  }

  grafo.ubicaciones = [...ubicaciones]
  return grafo
}

/** Lo que se sabe del producto, aparte de su grafo. */
export function hechosDeRed(prdid, indices, maestro) {
  const fila = maestro.get(prdid) ?? {}
  const plantas = indices.plantasDe.get(prdid) ?? []
  const consumidoEn = indices.consumeEn.get(prdid) ?? []

  const arcos = indices.arcosDe.get(prdid) ?? []
  const clientes = indices.clientesDe.get(prdid) ?? []

  return {
    prdid,
    descripcion: texto(fila.PRDDESCR),
    mattype: texto(fila.MATTYPEID),
    enPSH: plantas.length > 0,
    enPSI: indices.enPSI.has(prdid),
    enLS: arcos.length > 0,
    enCS: clientes.length > 0,
    enLocProduct: indices.enLocProduct.has(prdid),
    enCustProduct: indices.enCustProduct.has(prdid),
    // Llega a una planta: alguno de sus arcos termina donde algo se fabrica.
    llegaAPlanta: arcos.some((uno) => indices.plantasDe.has(uno.hasta)
      || [...indices.plantasDe.values()].some((suyas) => suyas.includes(uno.hasta))),
    // Consumo local: alguna de sus plantas es también donde una receta lo consume.
    consumeLocal: plantas.some((una) => consumidoEn.includes(una)),
    soloMaestro: plantas.length === 0 && arcos.length === 0 && clientes.length === 0
      && !indices.enPSI.has(prdid),
  }
}

/**
 * Analiza la red de todos los productos y guarda el informe.
 *
 * El universo son los productos del maestro más los que aparecen en la red aunque no estén en él: un
 * producto que se mueve y no existe en el maestro es de por sí un hallazgo, y dejarlo fuera lo taparía.
 */
export async function analizarRedes(configuracion, { onAvance } = {}) {
  const maestro = new Map()
  onAvance?.({ paso: 'productos' })
  await porCursor('bom_prd', (fila) => {
    const id = texto(fila.PRDID)
    if (id) maestro.set(id, fila)
  })

  const indices = await indicesDeRed({ onAvance })

  const universo = new Set(maestro.keys())
  for (const mapa of [indices.plantasDe, indices.arcosDe, indices.clientesDe]) {
    for (const id of mapa.keys()) universo.add(id)
  }

  const excluidos = new Set(Object.entries(configuracion ?? {})
    .filter(([, suya]) => suya?.excluido)
    .map(([tipo]) => tipo))

  const filas = []
  const resultados = []
  let vistos = 0

  onAvance?.({ paso: 'analizando', hechos: 0, total: universo.size })

  for (const prdid of universo) {
    vistos += 1
    if (vistos % POR_TANDA === 0) {
      onAvance?.({ paso: 'analizando', hechos: vistos, total: universo.size })
      // Ceder el hilo: una pestaña congelada se lee como una aplicación colgada.
      await new Promise((sigue) => { setTimeout(sigue, 0) })
    }

    const hechos = hechosDeRed(prdid, indices, maestro)
    if (excluidos.has(hechos.mattype)) continue

    const categorias = configuracion?.[hechos.mattype]?.categorias ?? []
    const salida = analizarRed(hechos, grafoDe(prdid, indices), categorias)

    resultados.push({ estado: salida.estado, severidad: salida.severidad, problemas: salida.problemas })
    filas.push(filaDeRed(hechos, salida))
  }

  onAvance?.({ paso: 'guardando', hechos: filas.length, total: filas.length })
  await vaciar('sn_product_web')
  await guardar('sn_product_web', filas)

  return { resumen: resumirRedes(resultados), analizados: filas.length, excluidos: [...excluidos] }
}
