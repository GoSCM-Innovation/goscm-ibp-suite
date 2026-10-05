// Network Analyzer: leer lo descargado, juzgarlo con el algoritmo de v7 y devolver el informe.
//
// Es la fase 1 de `doAnalyzeAndExport` de v7 (los índices pequeños que armaba mientras bajaba) más la
// llamada a `analyzeAndStreamExcel`. El juicio está en `core/ibp/network-analyzer.js`; aquí solo se leen
// las tablas de la base local y se arman las entradas con la MISMA forma y las MISMAS reglas de descarte
// que v7 (las filas inválidas y los componentes sin cabecera ya vienen descartados de la descarga).
//
// A diferencia del Production Analyzer, NO se lee todo a memoria: los arcos de Location Source y Customer
// Source son cientos de miles de filas. El algoritmo los recorre por cursor y pide a la base solo las del
// producto que está mirando (`fuenteDeLaRed`), como v7 con `idbCursorEach` e `idbGetByIndex`. En memoria
// quedan los índices pequeños y los tres maestros.

import { crearIndicesDeRed, analizarRed } from '../../core/ibp/network-analyzer.js'
import { desdeClasificacion } from '../../core/ibp/mattype-config.js'
import { leerPorIndice, porCursor, vaciar } from './explorer-db.js'
import { crearFabricaDeHojasGrandes } from './hoja-en-disco.js'
import { entidadesDeLaEjecucion } from './registro-sn.js'
import { TABLAS_DE_VISTA } from './explorer-schema.js'
import { filtroDeV7 } from './produccion-analizar.js'

/** Las tablas que se bajaron de verdad en esta corrida (las omitidas o con error no cuentan: pueden tener restos). */
function tablasBajadas(hechos) {
  return new Set((hechos ?? []).filter((h) => !h.omitido && !h.error && !h.cancelado).map((h) => h.tabla))
}

/**
 * Lo que el algoritmo lee de la base local: el cursor sobre una tabla y las filas de un producto.
 *
 * Una tabla que no se bajó en esta corrida se lee VACÍA aunque la base guarde algo de una corrida
 * anterior: v7 no tenía esos datos (la entidad no estaba configurada) y no hay que inventarlos.
 */
export function fuenteDeLaRed(hechos) {
  const hay = tablasBajadas(hechos)
  return {
    async recorrer(tabla, cb) {
      if (!hay.has(tabla)) return 0
      // El `false` de un callback cortaría el cursor; el algoritmo nunca lo pide, y así queda a salvo.
      return porCursor(tabla, (fila) => { cb(fila) })
    },
    async filasDeProducto(tabla, prdid) {
      if (!hay.has(tabla)) return []
      return leerPorIndice(tabla, 'by_prdid', prdid)
    },
  }
}

/**
 * Los índices pequeños (`SN_IDX`): los armaba v7 mientras bajaba; aquí, recorriendo lo bajado en el mismo
 * orden (las cabeceras antes que los componentes).
 */
export async function indexarLaRed(hechos) {
  const hay = tablasBajadas(hechos)
  const ci = crearIndicesDeRed()
  const alimentar = async (tabla, metodo) => {
    if (hay.has(tabla)) await porCursor(tabla, (fila) => { ci[metodo]([fila]) })
  }
  await alimentar('sn_loc', 'arcos')
  await alimentar('sn_cust', 'arcos')
  await alimentar('bom_prd', 'productos')
  await alimentar('sn_plant', 'cabeceras')
  await alimentar('sn_psi', 'componentes')
  await alimentar('bom_loc', 'ubicaciones')
  await alimentar('sn_cust_master', 'clientes')
  return ci.idx
}

/**
 * Corre el análisis completo sobre lo que acaba de bajar la descarga.
 *
 * `clasificacion` es la que guarda la pantalla (`{ tipo: { excluido, categorias, productos } }`); aquí se
 * convierte a la forma de v7. A diferencia del Production Analyzer, el de la red NO la pone al día con el
 * maestro que acaba de bajar: v7 solo llamaba a `mattyeInit` al confirmar el mapeo, no al analizar.
 *
 * `web` dice si se pidió la vista web: sin ella las dos hojas de arcos solo se escriben al Excel.
 */
export async function analizarRedDescargada({
  hechos, destino, conexion = {}, clasificacion, extras = {}, hoy, web = false,
  alEstado, alProgreso, registrar = () => {}, ceder,
}) {
  // v7 vaciaba las tablas de la vista web al empezar, y si no podía seguía con la vista en memoria.
  try {
    for (const tabla of TABLAS_DE_VISTA) await vaciar(tabla)
  } catch (fallo) {
    registrar('warn', `No se pudieron limpiar los stores de vista web (se usara vista en memoria si aplica): ${fallo && fallo.message}`)
  }

  const idx = await indexarLaRed(hechos)
  const totalPrds = Object.keys(idx.allPrds).length
  registrar('ok', `Índices listos. ${totalPrds} productos en la red. Iniciando análisis...`)
  alEstado?.(`Analizando red (${totalPrds} productos)...`)

  return analizarRed({
    idx,
    fuente: fuenteDeLaRed(hechos),
    tipos: desdeClasificacion(clasificacion ?? {}),
    extras,
    conexion,
    ejecucion: {
      generadoEl: new Date(),
      filtro: filtroDeV7(destino),
      entidades: entidadesDeLaEjecucion(hechos),
    },
    hoy,
    alEstado,
    alProgreso,
    registrar,
    ceder,
    crearHojaGrande: crearFabricaDeHojasGrandes({ web, registrar }),
  })
}
