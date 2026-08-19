// Cruzar lo descargado para saber qué se sabe de cada producto, y analizarlo.
//
// Portado de la parte de datos de `prodAnalyzer.js` de v7. El juicio está en
// `core/ibp/production-analysis.js`; aquí solo se junta.
//
// Dos decisiones que importan:
//
//   - Se recorre TODO por cursor, tabla por tabla, y se van armando índices pequeños: conjuntos de
//     identificadores y contadores, no filas. Un tenant real son 27.000 componentes y 132.000 arcos;
//     tenerlos a la vez en memoria como objetos es lo que hacía que v7 se cayera con los clientes
//     grandes. Lo que queda en memoria son unos cuantos `Set` de códigos.
//   - Se reutilizan las tablas del árbol y de la red YA descargadas en vez de bajar otra vez las
//     mismas de SAP. v7 las bajaba por tercera vez para este análisis; bajar tres veces la misma
//     tabla es justo la duplicación que esta arquitectura vino a quitar.

import {
  analizarProducto,
  filaDelInforme,
  resumirAnalisis,
  texto,
} from '../../core/ibp/production-analysis.js'
import { configuracionInicial } from '../../core/ibp/production-rules.js'
import { guardar, porCursor, vaciar } from './explorer-db.js'

/** Cada cuántos productos se avisa del avance. Con 8.888, avisar de cada uno cuesta más que analizar. */
const AVISAR_CADA = 250

/** Cuenta cuántos productos hay de cada tipo de material, para poder clasificarlos. */
export async function tiposDeMaterial() {
  const cuenta = {}
  await porCursor('bom_prd', (fila) => {
    const tipo = texto(fila.MATTYPEID)
    if (tipo) cuenta[tipo] = (cuenta[tipo] ?? 0) + 1
  })
  return { cuenta, configuracion: configuracionInicial(cuenta) }
}

/**
 * Lee todo lo descargado y devuelve los índices con los que se juzga cada producto.
 *
 * Todo son conjuntos y contadores por producto. La tabla de arcos se recorre una sola vez y alimenta
 * tres cosas a la vez —quién está en la red, qué plantas reciben algo, y qué plazos hay— porque
 * recorrerla tres veces son tres minutos en un tenant grande.
 */
export async function juntarHechos({ onAvance } = {}) {
  const productos = new Map()
  const plantasDeReceta = new Map()
  const recetasPorProducto = new Map()
  const componentesPorReceta = new Map()
  const recursosPorReceta = new Map()

  const soloCoproducto = new Set()
  const conPrincipal = new Set()
  const plazoDeProduccion = new Map()
  const coeficienteDeSalida = new Map()

  onAvance?.({ paso: 'productos' })
  await porCursor('bom_prd', (fila) => {
    const id = texto(fila.PRDID)
    if (id) productos.set(id, fila)
  })

  onAvance?.({ paso: 'recetas' })
  await porCursor('bom_psh', (fila) => {
    const receta = texto(fila.SOURCEID)
    const prd = texto(fila.PRDID)
    const planta = texto(fila.LOCID)
    if (!receta || !prd) return

    if (planta) plantasDeReceta.set(receta, planta)

    if (!recetasPorProducto.has(prd)) recetasPorProducto.set(prd, new Set())
    recetasPorProducto.get(prd).add(receta)

    // El tipo distinto de 'C' es la cabecera principal. Un producto que SOLO aparece como coproducto
    // no tiene receta propia, y eso es un aviso, no un error.
    if (texto(fila.SOURCETYPE) === 'C') soloCoproducto.add(prd)
    else conPrincipal.add(prd)

    if (!plazoDeProduccion.has(prd) && texto(fila.PLEADTIME)) {
      plazoDeProduccion.set(prd, texto(fila.PLEADTIME))
    }
    if (!coeficienteDeSalida.has(prd) && texto(fila.OUTPUTCOEFFICIENT)) {
      coeficienteDeSalida.set(prd, texto(fila.OUTPUTCOEFFICIENT))
    }
  })

  onAvance?.({ paso: 'componentes' })
  const loConsumeAlguien = new Set()
  const plantasQueLoConsumen = new Map()
  await porCursor('bom_psi', (fila) => {
    const receta = texto(fila.SOURCEID)
    const componente = texto(fila.PRDID)
    if (!receta || !componente) return

    componentesPorReceta.set(receta, (componentesPorReceta.get(receta) ?? 0) + 1)
    loConsumeAlguien.add(componente)

    const planta = plantasDeReceta.get(receta)
    if (!planta) return
    if (!plantasQueLoConsumen.has(componente)) plantasQueLoConsumen.set(componente, new Set())
    plantasQueLoConsumen.get(componente).add(planta)
  })

  onAvance?.({ paso: 'recursos' })
  await porCursor('bom_psr', (fila) => {
    const receta = texto(fila.SOURCEID)
    const recurso = texto(fila.RESID)
    if (!receta || !recurso) return
    if (!recursosPorReceta.has(receta)) recursosPorReceta.set(receta, new Set())
    recursosPorReceta.get(receta).add(recurso)
  })

  // La red: una sola pasada para tres preguntas.
  onAvance?.({ paso: 'red' })
  const enRed = new Set()
  const plantasConArcoDeEntrada = new Map()
  const plazoDeTransporte = new Map()
  const esOrigen = new Map()
  await porCursor('sn_loc', (fila) => {
    const prd = texto(fila.PRDID)
    if (!prd) return
    enRed.add(prd)

    const hasta = texto(fila.LOCID)
    if (hasta) {
      if (!plantasConArcoDeEntrada.has(prd)) plantasConArcoDeEntrada.set(prd, new Set())
      plantasConArcoDeEntrada.get(prd).add(hasta)
    }

    const desde = texto(fila.LOCFR)
    if (desde) {
      if (!esOrigen.has(prd)) esOrigen.set(prd, new Set())
      esOrigen.get(prd).add(desde)
    }

    if (!plazoDeTransporte.has(prd) && texto(fila.TLEADTIME)) {
      plazoDeTransporte.set(prd, texto(fila.TLEADTIME))
    }
  })

  onAvance?.({ paso: 'cobertura' })
  const enLocProduct = new Set()
  await porCursor('sn_loc_prod', (fila) => {
    const prd = texto(fila.PRDID)
    if (prd) enLocProduct.add(prd)
  })

  return {
    productos,
    recetasPorProducto,
    plantasDeReceta,
    componentesPorReceta,
    recursosPorReceta,
    soloCoproducto,
    conPrincipal,
    plazoDeProduccion,
    coeficienteDeSalida,
    loConsumeAlguien,
    plantasQueLoConsumen,
    enRed,
    plantasConArcoDeEntrada,
    plazoDeTransporte,
    esOrigen,
    enLocProduct,
  }
}

/** Lo que se sabe de UN producto, listo para juzgarlo. */
export function hechosDe(prdid, indices) {
  const fila = indices.productos.get(prdid) ?? {}
  const recetas = [...(indices.recetasPorProducto.get(prdid) ?? [])]

  const plantas = [...new Set(recetas.map((una) => indices.plantasDeReceta.get(una)).filter(Boolean))]
  const componentes = recetas.reduce((suma, una) => suma + (indices.componentesPorReceta.get(una) ?? 0), 0)
  const recursos = [...new Set(recetas.flatMap((una) => [...(indices.recursosPorReceta.get(una) ?? [])]))]

  const consumidoEn = [...(indices.plantasQueLoConsumen.get(prdid) ?? [])]
  const recibenArco = [...(indices.plantasConArcoDeEntrada.get(prdid) ?? [])]
  const origenes = indices.esOrigen.get(prdid) ?? new Set()

  return {
    prdid,
    descripcion: texto(fila.PRDDESCR),
    mattype: texto(fila.MATTYPEID),
    enLocProduct: indices.enLocProduct.has(prdid),
    plantas,
    recetas,
    componentes,
    recursos,
    // Solo coproducto: aparece como salida de alguna receta pero nunca como el producto principal.
    soloCoproducto: indices.soloCoproducto.has(prdid) && !indices.conPrincipal.has(prdid),
    plazoDeProduccion: indices.plazoDeProduccion.get(prdid) ?? '',
    coeficienteDeSalida: indices.coeficienteDeSalida.get(prdid) ?? '',
    plantasQueLoConsumen: consumidoEn,
    plantasConArcoDeEntrada: recibenArco,
    esOrigenEnRed: plantas.some((una) => origenes.has(una)),
    tieneArcosEnRed: indices.enRed.has(prdid),
    plazoDeTransporte: indices.plazoDeTransporte.get(prdid) ?? '',
    loConsumeAlguien: indices.loConsumeAlguien.has(prdid),
    // Se transfiere si sale de alguna de sus plantas hacia otro sitio.
    seTransfiere: plantas.some((una) => origenes.has(una)),
  }
}

/**
 * Analiza todos los productos y guarda las filas del informe en la base local.
 *
 * Las filas se guardan y no se devuelven: un informe de nueve mil filas con dieciséis columnas cabe
 * en memoria, pero uno de cien mil no, y la pantalla lo lee por tramos igual que las demás. Es la
 * arquitectura que v7 ya usaba para el resto y que aquí se respeta.
 */
export async function analizar(configuracion, { onAvance } = {}) {
  const indices = await juntarHechos({ onAvance })

  onAvance?.({ paso: 'analizando', hechos: 0, total: indices.productos.size })

  const excluidos = new Set(Object.entries(configuracion ?? {})
    .filter(([, suya]) => suya?.excluido)
    .map(([tipo]) => tipo))

  const filas = []
  const resultados = []
  let vistos = 0

  for (const prdid of indices.productos.keys()) {
    vistos += 1
    if (vistos % AVISAR_CADA === 0) {
      onAvance?.({ paso: 'analizando', hechos: vistos, total: indices.productos.size })
    }

    const hechos = hechosDe(prdid, indices)
    if (excluidos.has(hechos.mattype)) continue

    const salida = analizarProducto(hechos, configuracion)
    resultados.push({ mattype: hechos.mattype, ...salida })
    filas.push(filaDelInforme(hechos, salida))
  }

  onAvance?.({ paso: 'guardando', hechos: filas.length, total: filas.length })
  await vaciar('pa_product_web')
  await guardar('pa_product_web', filas)

  return { resumen: resumirAnalisis(resultados), analizados: filas.length, excluidos: [...excluidos] }
}
