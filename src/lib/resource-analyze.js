// Cruzar lo descargado para saber qué recursos están de verdad en el plan, y analizarlos.
//
// Portado de la hoja de recursos de `prodAnalyzer.js` de v7. El juicio está en
// `core/ibp/resource-analysis.js`; aquí solo se junta.
//
// El universo de recursos NO es el maestro: es la unión de tres sitios —el maestro, los recursos que
// usan las recetas y las asignaciones a plantas—. Recorrer solo el maestro perdería justo el caso que
// más importa: un recurso que una receta usa y que no está en el maestro, que es el que hace que SAP
// planifique contra una máquina que no existe.

import {
  analizarRecurso,
  filaDeRecurso,
  resumirRecursos,
} from '../../core/ibp/resource-analysis.js'
import { texto } from '../../core/ibp/production-analysis.js'
import { guardar, porCursor, vaciar } from './explorer-db.js'

/** Cada cuántos recursos se avisa del avance. */
const AVISAR_CADA = 100

/** Añade a un `Map` de `Set`. */
function sumar(mapa, clave, valor) {
  if (!clave || !valor) return
  let suyo = mapa.get(clave)
  if (!suyo) { suyo = new Set(); mapa.set(clave, suyo) }
  suyo.add(valor)
}

/** Lee lo descargado y arma los índices por recurso. */
export async function juntarHechos({ onAvance } = {}) {
  const recursos = new Map()

  onAvance?.({ paso: 'recursos' })
  await porCursor('bom_res', (fila) => {
    const id = texto(fila.RESID)
    if (id) recursos.set(id, fila)
  })

  // Qué producto sale de cada receta y en qué planta, para poder decir de un recurso qué fabrica.
  onAvance?.({ paso: 'recetas' })
  const productoDeReceta = new Map()
  await porCursor('bom_psh', (fila) => {
    const receta = texto(fila.SOURCEID)
    const prd = texto(fila.PRDID)
    if (receta && prd && !productoDeReceta.has(receta)) productoDeReceta.set(receta, prd)
  })

  onAvance?.({ paso: 'uso' })
  const recetasDeRecurso = new Map()
  await porCursor('bom_psr', (fila) => {
    sumar(recetasDeRecurso, texto(fila.RESID), texto(fila.SOURCEID))
  })

  onAvance?.({ paso: 'asignaciones' })
  const plantasDeRecurso = new Map()
  // El tipo de recurso vive aquí y no en el maestro, porque en IBP el mismo recurso puede ser de un
  // tipo distinto en cada planta. Se guarda el primero que aparezca: enseñar los cinco tipos de un
  // recurso asignado a cinco plantas no cabe en una columna y no cambia ninguna comprobación.
  const tipoDeRecurso = new Map()
  await porCursor('bom_resloc', (fila) => {
    const resid = texto(fila.RESID)
    sumar(plantasDeRecurso, resid, texto(fila.LOCID))
    if (resid && !tipoDeRecurso.has(resid) && texto(fila.RESOURCETYPE)) {
      tipoDeRecurso.set(resid, texto(fila.RESOURCETYPE))
    }
  })

  return { recursos, productoDeReceta, recetasDeRecurso, plantasDeRecurso, tipoDeRecurso }
}

/** Lo que se sabe de UN recurso, listo para juzgarlo. */
export function hechosDe(resid, indices) {
  const fila = indices.recursos.get(resid) ?? {}
  const recetas = [...(indices.recetasDeRecurso.get(resid) ?? [])]

  return {
    resid,
    descripcion: texto(fila.RESDESCR),
    tipo: indices.tipoDeRecurso.get(resid) ?? '',
    plantas: [...(indices.plantasDeRecurso.get(resid) ?? [])],
    recetas,
    productos: [...new Set(recetas.map((una) => indices.productoDeReceta.get(una)).filter(Boolean))],
  }
}

/** Analiza todos los recursos y guarda las filas del informe en la base local. */
export async function analizar({ onAvance } = {}) {
  const indices = await juntarHechos({ onAvance })

  const todos = new Set(indices.recursos.keys())
  for (const mapa of [indices.recetasDeRecurso, indices.plantasDeRecurso]) {
    for (const resid of mapa.keys()) todos.add(resid)
  }

  onAvance?.({ paso: 'analizando', hechos: 0, total: todos.size })

  const filas = []
  const resultados = []
  let vistos = 0

  for (const resid of todos) {
    vistos += 1
    if (vistos % AVISAR_CADA === 0) {
      onAvance?.({ paso: 'analizando', hechos: vistos, total: todos.size })
    }

    const hechos = hechosDe(resid, indices)
    const salida = analizarRecurso(hechos)
    resultados.push(salida)
    filas.push(filaDeRecurso(hechos, salida))
  }

  onAvance?.({ paso: 'guardando', hechos: filas.length, total: filas.length })
  await vaciar('pa_resource_web')
  await guardar('pa_resource_web', filas)

  return { resumen: resumirRecursos(resultados), analizados: filas.length }
}
