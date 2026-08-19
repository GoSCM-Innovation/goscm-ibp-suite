// Cruzar lo descargado para saber qué hace cada UBICACIÓN, y analizarla.
//
// Portado de la hoja de ubicaciones de `prodAnalyzer.js` de v7. El juicio está en
// `core/ibp/location-analysis.js`; aquí solo se junta.
//
// No baja nada de SAP: usa las MISMAS tablas que ya bajó el informe de productos —recetas,
// componentes, recursos, arcos y cobertura—. Son los mismos datos mirados desde el otro lado, y
// volver a pedirlos a SAP sería pagar seis segundos por página para leer lo que ya está en el disco.
//
// La pasada es la de siempre: cursor por tabla, y en memoria solo conjuntos de códigos. Un tenant real
// tiene pocas ubicaciones —decenas o cientos— pero 27.000 componentes y 132.000 arcos, así que lo que
// no puede crecer es lo que se guarda POR ARCO, no lo que se guarda por ubicación.

import {
  analizarUbicacion,
  filaDeUbicacion,
  resumirUbicaciones,
} from '../../core/ibp/location-analysis.js'
import { texto } from '../../core/ibp/production-analysis.js'
import { guardar, porCursor, vaciar } from './explorer-db.js'

/** Cada cuántas ubicaciones se avisa del avance. */
const AVISAR_CADA = 50

/**
 * Cuántos códigos se guardan por ubicación en cada lista.
 *
 * El tope existe porque una tabla de arcos real son millones de filas —en un tenant medido, 4,3
 * millones— y guardar el conjunto completo por ubicación es lo que tira la pestaña.
 */
const TOPE_DE_LISTA = 400

/**
 * Añade a un `Map` de `Set`, con tope.
 *
 * Pasado el tope se DESCARTA y se anota que se descartó, en `mapa.topados`. Eso último no es un detalle:
 * si no se anotara, el informe escribiría «400 materiales» —el tope— como si fuera el total. Medido en
 * un tenant real, 155 ubicaciones decían exactamente 400, y ninguna tenía 400.
 */
function sumar(mapa, clave, valor) {
  if (!clave || !valor) return
  let suyo = mapa.get(clave)
  if (!suyo) { suyo = new Set(); mapa.set(clave, suyo) }
  if (suyo.size < TOPE_DE_LISTA) { suyo.add(valor); return }
  // Ya está lleno: solo cuenta si el valor es nuevo, porque si ya está dentro no se pierde nada.
  if (!suyo.has(valor)) {
    if (!mapa.topados) mapa.topados = new Set()
    mapa.topados.add(clave)
  }
}

/** Si la lista de esa ubicación se quedó corta por el tope. */
const seTopo = (mapa, clave) => Boolean(mapa?.topados?.has(clave))

/**
 * Lee todo lo descargado y arma los índices por ubicación.
 *
 * El orden importa: primero las recetas —que son las que dicen qué ubicación es planta y qué producto
 * se fabrica dónde—, después los componentes, y al final los arcos, que ya pueden preguntar «¿el
 * destino de este arco consume este producto?». Al revés habría que recorrer los arcos dos veces.
 */
export async function juntarHechos({ configuracion, onAvance } = {}) {
  const ubicaciones = new Map()

  onAvance?.({ paso: 'ubicaciones' })
  await porCursor('bom_loc', (fila) => {
    const id = texto(fila.LOCID)
    if (id) ubicaciones.set(id, fila)
  })

  // El tipo de material de cada producto, para poder decir si lo que se fabrica en una planta está
  // clasificado como comprado, y si lo que se transfiere es un componente o un terminado.
  onAvance?.({ paso: 'productos' })
  const tipoDeProducto = new Map()
  await porCursor('bom_prd', (fila) => {
    const id = texto(fila.PRDID)
    if (id) tipoDeProducto.set(id, texto(fila.MATTYPEID))
  })

  onAvance?.({ paso: 'recetas' })
  const plantaDeReceta = new Map()
  const recetasDeUbicacion = new Map()
  const productosDeUbicacion = new Map()
  const plazoDeReceta = new Map()
  await porCursor('bom_psh', (fila) => {
    const receta = texto(fila.SOURCEID)
    const planta = texto(fila.LOCID)
    const prd = texto(fila.PRDID)
    if (!receta || !planta) return

    plantaDeReceta.set(receta, planta)
    sumar(recetasDeUbicacion, planta, receta)
    sumar(productosDeUbicacion, planta, prd)
    // El plazo se guarda solo la primera vez: una receta es una fila, pero un tenant puede repetirla
    // por validez y la primera es la que manda.
    if (!plazoDeReceta.has(receta)) plazoDeReceta.set(receta, texto(fila.PLEADTIME))
  })

  onAvance?.({ paso: 'componentes' })
  const componentesDeReceta = new Map()
  // La pregunta central de esta hoja: ¿la ubicación X consume el producto P en alguna receta suya?
  const consumeEnPlanta = new Set()
  await porCursor('bom_psi', (fila) => {
    const receta = texto(fila.SOURCEID)
    const componente = texto(fila.PRDID)
    if (!receta || !componente) return

    sumar(componentesDeReceta, receta, componente)
    const planta = plantaDeReceta.get(receta)
    if (planta) consumeEnPlanta.add(`${planta}|${componente}`)
  })

  onAvance?.({ paso: 'recursos' })
  const recursosDeReceta = new Map()
  const recursosUsados = new Map()
  await porCursor('bom_psr', (fila) => {
    const receta = texto(fila.SOURCEID)
    const recurso = texto(fila.RESID)
    if (!receta || !recurso) return
    sumar(recursosDeReceta, receta, recurso)
    const planta = plantaDeReceta.get(receta)
    if (planta) sumar(recursosUsados, planta, recurso)
  })

  // Los recursos ASIGNADOS a una ubicación —los de Resource Location— frente a los que las recetas
  // usan de verdad. La diferencia es capacidad que nadie planifica, y solo se ve teniendo las dos
  // listas: `bom_psr` por definición trae únicamente los recursos que ya están en una receta.
  onAvance?.({ paso: 'asignaciones' })
  const recursosAsignados = new Map()
  await porCursor('bom_resloc', (fila) => {
    sumar(recursosAsignados, texto(fila.LOCID), texto(fila.RESID))
  })

  onAvance?.({ paso: 'cobertura' })
  // Qué productos tienen Location Product en cada ubicación. Sin esto, un arco que llega a un sitio
  // donde el producto no existe no se puede detectar.
  const cobertura = new Set()
  await porCursor('sn_loc_prod', (fila) => {
    const loc = texto(fila.LOCID)
    const prd = texto(fila.PRDID)
    if (loc && prd) cobertura.add(`${loc}|${prd}`)
  })

  onAvance?.({ paso: 'red' })
  const manda = new Map()
  const recibe = new Map()
  // Lo que sale de cada ubicación, separado en las dos clases que definen el rol.
  const mandaConsumido = new Map()
  const mandaNoConsumido = new Map()
  const recibeSinCobertura = new Map()
  const transfiereAPlanta = new Map()
  const transfiereANodo = new Map()
  const productosQueLlegan = new Map()

  await porCursor('sn_loc', (fila) => {
    const desde = texto(fila.LOCFR)
    const hasta = texto(fila.LOCID)
    const prd = texto(fila.PRDID)
    if (!desde || !hasta || !prd) return

    sumar(manda, desde, hasta)
    sumar(recibe, hasta, desde)
    sumar(productosQueLlegan, hasta, prd)

    const seConsumeAlla = consumeEnPlanta.has(`${hasta}|${prd}`)
    const destinoProduce = recetasDeUbicacion.has(hasta)

    if (seConsumeAlla) sumar(mandaConsumido, desde, prd)
    else {
      sumar(mandaNoConsumido, desde, prd)
      // Que el destino sea una planta y no use lo que le llega es peor que que sea una bodega: en la
      // bodega puede ser tránsito legítimo, en la planta falta el componente en el BOM.
      if (destinoProduce) sumar(transfiereAPlanta, desde, prd)
      else sumar(transfiereANodo, desde, prd)
    }

    if (!cobertura.has(`${hasta}|${prd}`)) sumar(recibeSinCobertura, hasta, prd)
  })

  // Las categorías las decide el consultor por tipo de material, igual que en el informe de productos:
  // aquí solo se lee esa decisión. Un tipo sin clasificar no dispara nada, que es lo correcto —marcar
  // en rojo lo que nadie clasificó sería inventar el criterio—.
  const categoriaDeTipo = new Map()
  for (const tipo of new Set(tipoDeProducto.values())) {
    categoriaDeTipo.set(tipo, configuracion?.[tipo]?.categorias ?? [])
  }

  return {
    ubicaciones,
    tipoDeProducto,
    categoriaDeTipo,
    plantaDeReceta,
    recetasDeUbicacion,
    productosDeUbicacion,
    plazoDeReceta,
    componentesDeReceta,
    consumeEnPlanta,
    recursosDeReceta,
    recursosUsados,
    recursosAsignados,
    cobertura,
    manda,
    recibe,
    mandaConsumido,
    mandaNoConsumido,
    recibeSinCobertura,
    transfiereAPlanta,
    transfiereANodo,
    productosQueLlegan,
  }
}

/** Si un producto es un componente —materia prima o semiterminado— según cómo se clasificó su tipo. */
function esComponente(prd, indices) {
  const cats = indices.categoriaDeTipo.get(indices.tipoDeProducto.get(prd)) ?? []
  return cats.includes('rawmat') || cats.includes('semi')
}

/** Si un producto está clasificado como comprado y por tanto no debería tener receta. */
function esComprado(prd, indices) {
  const cats = indices.categoriaDeTipo.get(indices.tipoDeProducto.get(prd)) ?? []
  return cats.includes('rawmat') || cats.includes('trading')
}

/** Lo que se sabe de UNA ubicación, listo para juzgarla. */
export function hechosDe(locid, indices) {
  const fila = indices.ubicaciones.get(locid) ?? {}
  const lista = (mapa) => [...(mapa.get(locid) ?? [])]

  const recetas = lista(indices.recetasDeUbicacion)
  const productos = lista(indices.productosDeUbicacion)

  const recetasSinComponentes = recetas.filter((una) => !indices.componentesDeReceta.has(una))
  const recetasSinRecurso = recetas.filter((una) => !indices.recursosDeReceta.has(una))
  // «0» y «» los dos cuentan: una receta sin plazo de producción hace que SAP planifique como si
  // fabricar fuera instantáneo.
  const recetasConPlazoCero = recetas.filter((una) => {
    const plazo = indices.plazoDeReceta.get(una)
    return plazo === '' || Number(plazo) === 0
  })

  // Los componentes que las recetas de esta planta consumen y para los que no hay ningún arco que los
  // traiga hasta acá. Es el error más caro de encontrar a mano.
  const componentesSinArco = []
  const llegan = indices.productosQueLlegan.get(locid) ?? new Set()
  const componentes = new Set()
  for (const receta of recetas) {
    for (const comp of indices.componentesDeReceta.get(receta) ?? []) componentes.add(comp)
  }
  for (const comp of componentes) {
    // Si se fabrica acá mismo, no necesita arco de entrada.
    if (productos.includes(comp)) continue
    if (!llegan.has(comp)) componentesSinArco.push(comp)
  }

  const usados = indices.recursosUsados.get(locid) ?? new Set()
  const asignados = indices.recursosAsignados.get(locid) ?? new Set()
  const recursos = [...new Set([...asignados, ...usados])]
  const recursosOciosos = [...asignados].filter((uno) => !usados.has(uno))

  const fabricaLoQueSeCompra = productos.filter((prd) => esComprado(prd, indices))

  const mandaConsumido = lista(indices.mandaConsumido)
  const mandaNoConsumido = lista(indices.mandaNoConsumido)

  // Un proveedor manda material; si en el destino ese material no existe como Location Product, el
  // arco no puede usarse. Se mira contra los destinos a los que manda.
  const destinos = indices.manda.get(locid) ?? new Set()
  const mandaSinCobertura = mandaConsumido.filter((prd) => (
    ![...destinos].some((hasta) => indices.cobertura.has(`${hasta}|${prd}`))
  ))

  const recibidos = [...llegan]
  const seProduceAca = recetas.length > 0

  // Qué listas se quedaron cortas por el tope, para que el informe diga «más de N» y no «N».
  //
  // `componentesSinArco` y `mandaSinCobertura` se derivan de listas que sí pueden venir topadas, así
  // que heredan la marca: si de los componentes que llegan solo se guardaron los primeros 400, decir
  // cuántos faltan exactamente es imposible.
  const topados = []
  if (seTopo(indices.recibeSinCobertura, locid)) topados.push('recibeSinCobertura')
  if (seTopo(indices.transfiereAPlanta, locid)) topados.push('transfiereAPlantaSinConsumo')
  if (seTopo(indices.transfiereANodo, locid)) topados.push('transfiereANodoSinProduccion')
  if (seTopo(indices.productosQueLlegan, locid)) {
    topados.push('componentesSinArco', 'recibeComponentesSinProducir')
  }
  if (seTopo(indices.mandaConsumido, locid)) topados.push('mandaSinCobertura')
  if (seTopo(indices.productosDeUbicacion, locid)) topados.push('fabricaLoQueSeCompra')
  if (seTopo(indices.recetasDeUbicacion, locid)) {
    topados.push('recetasSinComponentes', 'recetasSinRecurso', 'recetasConPlazoCero')
  }
  if (seTopo(indices.recursosAsignados, locid)) topados.push('recursosOciosos')

  return {
    topados,
    locid,
    descripcion: texto(fila.LOCDESCR),
    loctype: texto(fila.LOCTYPE),
    recetas,
    productos,
    recursos,
    manda: [...destinos],
    recibe: lista(indices.recibe),

    mandaLoQueSeConsume: mandaConsumido.length > 0,
    mandaLoQueNoSeConsume: mandaNoConsumido.length > 0,

    recetasSinComponentes,
    recetasSinRecurso,
    recetasConPlazoCero,
    componentesSinArco,
    recursosOciosos,
    fabricaLoQueSeCompra,

    mandaSinCobertura,
    transfiereAPlantaSinConsumo: lista(indices.transfiereAPlanta),
    transfiereANodoSinProduccion: lista(indices.transfiereANodo),

    recibeSinCobertura: lista(indices.recibeSinCobertura),
    recibeComponentesSinProducir: seProduceAca
      ? []
      : recibidos.filter((prd) => esComponente(prd, indices)),
  }
}

/**
 * Analiza todas las ubicaciones y guarda las filas del informe en la base local.
 *
 * Se guardan en vez de devolverse, como el resto de los informes: la pantalla las lee por tramos y
 * filtra por severidad usando el índice, sin traerlas todas a memoria.
 */
export async function analizar(configuracion, { onAvance } = {}) {
  const indices = await juntarHechos({ configuracion, onAvance })

  // Una ubicación puede aparecer en los arcos y no estar en el maestro. Se analiza igual: no estar en
  // el maestro y sí en los arcos es en sí mismo un dato que el consultor quiere ver.
  const todas = new Set(indices.ubicaciones.keys())
  for (const mapa of [indices.recetasDeUbicacion, indices.manda, indices.recibe]) {
    for (const locid of mapa.keys()) todas.add(locid)
  }

  onAvance?.({ paso: 'analizando', hechos: 0, total: todas.size })

  const filas = []
  const resultados = []
  let vistos = 0

  for (const locid of todas) {
    vistos += 1
    if (vistos % AVISAR_CADA === 0) {
      onAvance?.({ paso: 'analizando', hechos: vistos, total: todas.size })
    }

    const hechos = hechosDe(locid, indices)
    const salida = analizarUbicacion(hechos)
    resultados.push(salida)
    filas.push(filaDeUbicacion(hechos, salida))
  }

  onAvance?.({ paso: 'guardando', hechos: filas.length, total: filas.length })
  await vaciar('pa_location_web')
  await guardar('pa_location_web', filas)

  return { resumen: resumirUbicaciones(resultados), analizados: filas.length }
}
