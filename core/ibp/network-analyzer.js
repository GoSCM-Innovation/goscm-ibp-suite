// Network Analyzer de v7: el análisis de la red de suministro, idéntico.
//
// Portado LITERAL de `analyzeAndStreamExcel` y de las funciones `sn*` de `analyzer.js` de v7 (fases 2 a
// 8 y el grafo por producto), de `statsSheet.js` (`buildSN`) y de `runSummary.js` (`buildResumenMeta`).
// Es el algoritmo de v7 sin cambiar un criterio: los estados de la red, las reglas por categoría de
// material, el Health Score y su desglose, las observaciones, los colores de cada fila y las columnas
// de cada hoja. Las variables conservan los nombres de v7 a propósito: quien compare con el original
// tiene que poder seguir cada línea.
//
// LO ÚNICO QUE CAMBIA es de dónde sale el dato y a dónde va el resultado:
//
//   - v7 leía IndexedDB dentro de la función (`idbCursorEach`, `idbGetByIndex`); aquí el algoritmo
//     recibe una `fuente` con esas dos operaciones y no toca el navegador. La base local sigue siendo
//     la del navegador (`src/lib/red-analizar.js`) y los arcos NO se cargan a memoria: se recorren por
//     cursor y se piden por producto, como en v7 (Location Source puede tener cientos de miles de filas).
//   - v7 escribía el Excel y capturaba la vista web con el DOM al lado; aquí se devuelve un `Informe`
//     (ver `analisis-hojas.js`) que leen el Excel y la vista web por separado. Las dos hojas de arcos,
//     que son las que no caben en memoria, se piden a `crearHojaGrande` para que quien llama las mande
//     al disco (Excel por partes y vista web paginada); sin esa función quedan en memoria, que es lo
//     que usan las pruebas.
//   - Los textos están en español, que era la rama de v7 sin traducir.
//
// REGLAS DE v7 QUE CONVIENE SABER ANTES DE LEER EL CÓDIGO:
//
//   - Un producto sin `MATTYPEID` no se analiza ni aparece en las hojas de arcos: sin tipo de material no
//     hay qué exigirle (`if (!pm(prdid)) continue`). Pero SÍ cuenta en el total `n` que divide el Health
//     Score promedio y el «Total productos analizados»: así lo calcula v7.
//   - Un tipo de material excluido no se analiza como producto ni genera filas en las hojas de arcos.
//   - Con varias categorías gana la más permisiva (`useSemiRules = semi && !finished`…).
//   - Los diccionarios son objetos corrientes a propósito: v7 lista sus claves con `Object.keys` y el
//     orden de un objeto —los identificadores numéricos primero, de menor a mayor— sale en las columnas
//     «Orígenes (códigos)», «Destinos (códigos)» y «Clientes (códigos)». Cambiarlos por `Map` cambiaría el
//     orden en que se leen esas celdas.
//
// Sin dependencias del navegador: lo usan la pantalla, las pruebas y quien lo necesite en el servidor.

import {
  COLORES,
  NA_DASH,
  crearHojaDeTabla,
  crearHojaLibre,
  etiquetaDeRelleno as stLabel,
  porcentajeOk,
} from './analisis-hojas.js'
import { primitivasDeEstadisticas } from './estadisticas-hoja.js'
import { HOJAS_DE_RED } from './network-analyzer-hojas.js'
import {
  categoriasDe as mattypeGetCategories,
  estaExcluido as mattypeIsExcluded,
} from './mattype-config.js'
import { bloquesDeResumen } from './production-analyzer.js'

const { C_RED, C_YEL } = COLORES

/** Un valor de SAP como texto limpio (`str` de `utils.js`). */
const str = (v) => (v === null || v === undefined ? '' : String(v).trim())

/** Un objeto sin prototipo: un identificador llamado «constructor» no tiene que pisar nada. */
const dict = () => Object.create(null)

const yn = (b) => (b ? 'Si' : 'No')

/** Los nombres de las hojas, literales de `xls.sheet.*` de v7. */
export const NOMBRES_DE_HOJA_RED = Object.freeze({
  summary: 'Resumen',
  product: 'Product',
  location: 'Location',
  customer: 'Customer',
  locationSource: 'Location Source',
  customerSource: 'Customer Source',
  stats: 'Estadísticas',
})

/** Las cinco entidades que admiten campos adicionales y dónde se insertan (`efInjectHeaders` de v7). */
export const ENTIDADES_CON_EXTRAS_RED = Object.freeze([
  { clave: 'product', etiqueta: 'Product', despuesDe: 4 },
  { clave: 'location', etiqueta: 'Location', despuesDe: 4 },
  { clave: 'customer', etiqueta: 'Customer', despuesDe: 3 },
  { clave: 'locationSource', etiqueta: 'Location Source', despuesDe: 9 },
  { clave: 'customerSource', etiqueta: 'Customer Source', despuesDe: 9 },
])

/** Campos obligatorios que se muestran en el Excel de cada entidad (`EF_MAND_VISIBLE.sn`). */
export const CAMPOS_OBLIGATORIOS_RED = Object.freeze({
  product: ['PRDID', 'PRDDESCR', 'MATTYPEID'],
  location: ['LOCID', 'LOCDESCR', 'LOCTYPE'],
  customer: ['CUSTID', 'CUSTDESCR'],
  locationSource: ['PRDID', 'LOCFR', 'LOCID', 'TLEADTIME'],
  customerSource: ['PRDID', 'LOCID', 'CUSTID', 'CLEADTIME'],
})

/** Campos técnicos de filtro: siempre en el `$select`, nunca en el informe (`EF_MAND_HIDDEN.sn`). */
export const CAMPOS_OCULTOS_RED = Object.freeze({
  product: [],
  location: ['LOCVALID'],
  customer: ['CUSTVALID'],
  locationSource: ['TINVALID'],
  customerSource: ['CINVALID'],
})

/** Cuántas filas de datos caben en una hoja antes de partirla (`ROW_LIMIT` de v7). */
export const FILAS_POR_HOJA = 900000

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Los índices pequeños (SN_IDX)
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Los índices que v7 armaba MIENTRAS bajaba (`SN_IDX`, en la fase 1 de `doAnalyzeAndExport`): qué
 * productos hay en la red, los tres maestros por identificador, y dónde se produce y se consume.
 *
 * Es incremental: se le van pasando las filas de cada tabla, en el orden de v7 (arcos, entregas,
 * productos, cabeceras, componentes, ubicaciones, clientes). Las filas ya vienen sin las inválidas
 * (`TINVALID`, `CINVALID`, `PINVALID`, `LOCVALID`, `CUSTVALID`) y los componentes atados a una
 * cabecera viva.
 *
 * El orden importa en un caso: `psiConsumingLocs` necesita saber la planta de cada receta, así que las
 * cabeceras se indexan antes que los componentes. Como en v7, si una receta aparece dos veces gana la
 * planta de la última.
 */
export function crearIndicesDeRed() {
  const idx = {
    allPrds: dict(), prdLookup: dict(), locLookup: dict(), custLookup: dict(),
    pshPrds: dict(), psiCompPrds: dict(), psiConsumingLocs: dict(),
  }
  const snSidToLoc = dict() // SOURCEID → LOCID, para unir PSI con PSH

  return {
    idx,
    /** Location Source y Customer Source: cada producto con arcos entra en la red. */
    arcos(filas) {
      filas.forEach((r) => { const p = str(r.PRDID); if (p) idx.allPrds[p] = true })
    },
    /** Product: el maestro de productos (el último gana). */
    productos(filas) {
      filas.forEach((r) => { const k = str(r.PRDID); if (k) idx.prdLookup[k] = r })
    },
    /** Production Source Header: los productos con receta y la planta de cada receta. */
    cabeceras(filas) {
      filas.forEach((r) => {
        const p = str(r.PRDID)
        if (p) { idx.allPrds[p] = true; idx.pshPrds[p] = true }
        const s = str(r.SOURCEID)
        if (s) { const l = str(r.LOCID || ''); if (l) snSidToLoc[s] = l }
      })
    },
    /** Production Source Item: los componentes y las plantas donde se consumen. */
    componentes(filas) {
      filas.forEach((r) => {
        const p = str(r.PRDID); if (!p) return
        idx.psiCompPrds[p] = true
        const loc = snSidToLoc[str(r.SOURCEID || '')]
        if (loc) {
          if (!idx.psiConsumingLocs[p]) idx.psiConsumingLocs[p] = dict()
          idx.psiConsumingLocs[p][loc] = true
        }
      })
    },
    /** Location (maestro de ubicaciones). */
    ubicaciones(filas) {
      filas.forEach((r) => { const k = str(r.LOCID); if (k) idx.locLookup[k] = r })
    },
    /** Customer (maestro de clientes). */
    clientes(filas) {
      filas.forEach((r) => { const k = str(r.CUSTID); if (k) idx.custLookup[k] = r })
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Campos adicionales (extraFields.js)
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Inserta cabecera, nota y grupo de los campos extra tras la columna `afterIdx` (`efInjectHeaders`). */
function efInjectHeaders(extras, entity, afterIdx, headers, notes, groups) {
  const extra = extras?.[entity] ?? []
  if (!extra.length) return
  const insertAt = afterIdx + 1
  extra.forEach((f, i) => {
    headers.splice(insertAt + i, 0, f)
    if (notes) notes.splice(insertAt + i, 0, `Campo adicional: ${f}`)
    if (groups) groups.splice(insertAt + i, 0, 'ibp')
  })
}

/** Inserta los valores de los campos extra del registro en la fila (`efInjectRow`). */
function efInjectRow(extras, entity, afterIdx, row, record) {
  const fields = extras?.[entity] ?? []
  if (!fields.length) return
  const vals = !record
    ? fields.map(() => '')
    : fields.map((f) => (record[f] != null ? String(record[f]) : ''))
  const insertAt = afterIdx + 1
  vals.forEach((v, i) => { row.splice(insertAt + i, 0, v) })
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// El grafo de un producto (snBuildProductGraph y compañía)
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** `snBuildProductGraph`: las filas de arcos y plantas del producto, ya leídas, hechas grafo. */
function armarGrafo(prdid, locRows, custRows, plantRows) {
  // Location edges
  const locEdges = dict(); const locLeadTimes = dict()
  locRows.forEach((r) => {
    const fr = str(r.LOCFR); const to = str(r.LOCID)
    if (!fr || !to) return
    if (!locEdges[fr]) locEdges[fr] = []
    if (locEdges[fr].indexOf(to) < 0) locEdges[fr].push(to)
    locLeadTimes[`${fr}||${to}`] = str(r.TLEADTIME || '')
  })

  // Customer edges
  const custEdges = dict(); const custLeadTimes = dict()
  custRows.forEach((r) => {
    const fr = str(r.LOCID); const to = str(r.CUSTID)
    if (!fr || !to) return
    if (!custEdges[fr]) custEdges[fr] = []
    if (custEdges[fr].indexOf(to) < 0) custEdges[fr].push(to)
    custLeadTimes[`${fr}||${to}`] = str(r.CLEADTIME || '')
  })

  // Plants
  const plantSet = dict(); const plants = []; const plantLeadTimes = dict()
  plantRows.forEach((r) => {
    const l = str(r.LOCID)
    if (l && !plantSet[l]) { plantSet[l] = true; plants.push(l) }
    if (l) plantLeadTimes[l] = str(r.PLEADTIME || '')
  })

  // Build allLocations / allCustomers
  const allLocs = dict(); const allCusts = dict()
  Object.keys(locEdges).forEach((fr) => {
    allLocs[fr] = true
    locEdges[fr].forEach((to) => { allLocs[to] = true })
  })
  Object.keys(custEdges).forEach((fr) => {
    allLocs[fr] = true
    custEdges[fr].forEach((cust) => { allCusts[cust] = true })
  })

  return {
    prdid, plants, plantSet,
    locEdges, custEdges,
    locLeadTimes, custLeadTimes, plantLeadTimes,
    allLocations: Object.keys(allLocs), allCustomers: Object.keys(allCusts),
  }
}

/**
 * `snFindAllPaths`: enumeración de rutas planta → cliente (DFS con guarda de ciclos).
 *
 * MAX_PATHS_PRD = 50.000 por producto como válvula de seguridad contra redes combinatoriamente
 * explosivas. Si se alcanza, `paths._truncated = true` y se indica en la columna Observación.
 */
function snFindAllPaths(graph) {
  const paths = []
  const MAX_DEPTH = 12; const MAX_PATHS_PRD = 50000

  graph.plants.forEach((plant) => {
    const stack = [[plant]]
    while (stack.length > 0 && paths.length < MAX_PATHS_PRD) {
      const cur = stack.pop()
      const last = cur[cur.length - 1]
      ;(graph.custEdges[last] || []).forEach((cust) => {
        if (paths.length < MAX_PATHS_PRD) paths.push({ plant, nodes: cur.slice(), customer: cust })
      })
      if (cur.length < MAX_DEPTH) {
        ;(graph.locEdges[last] || []).forEach((next) => {
          if (cur.indexOf(next) < 0) stack.push(cur.concat([next]))
        })
      }
    }
  })
  paths._truncated = paths.length >= MAX_PATHS_PRD
  return paths
}

/** `snComputeNetworkSets`: hacia adelante (alimentado desde plantas) y hacia atrás (llega a un cliente). */
function snComputeNetworkSets(graph) {
  // Forward: nodes reachable from any plant via locEdges
  const fedSet = dict()
  graph.plants.forEach((p) => { fedSet[p] = true })
  let changed = true
  while (changed) {
    changed = false
    Object.keys(graph.locEdges).forEach((fr) => {
      if (fedSet[fr]) {
        graph.locEdges[fr].forEach((to) => {
          if (!fedSet[to]) { fedSet[to] = true; changed = true }
        })
      }
    })
  }
  // Backward: nodes that can reach any customer
  const usefulSet = dict()
  Object.keys(graph.custEdges).forEach((loc) => {
    if (graph.custEdges[loc] && graph.custEdges[loc].length > 0) usefulSet[loc] = true
  })
  changed = true
  while (changed) {
    changed = false
    Object.keys(graph.locEdges).forEach((fr) => {
      if (!usefulSet[fr] && graph.locEdges[fr].some((to) => usefulSet[to])) {
        usefulSet[fr] = true; changed = true
      }
    })
  }
  return { fedSet, usefulSet }
}

/** `snFindGhostNodes`: alimentado desde una planta, con salidas, y sin forma de llegar a un cliente. */
function snFindGhostNodes(graph, sets) {
  const ghosts = []
  graph.allLocations.forEach((loc) => {
    if (graph.plantSet[loc]) return // plants handled separately
    if (!sets.fedSet[loc]) return // not fed from any plant
    if (sets.usefulSet[loc]) return // can reach a customer → not a ghost
    const hasOut = (graph.locEdges[loc] && graph.locEdges[loc].length > 0)
      || (graph.custEdges[loc] && graph.custEdges[loc].length > 0)
    if (hasOut) ghosts.push(loc)
  })
  return ghosts
}

/** `snFindDeadEnds`: reciben producto y no tienen ninguna salida. */
function snFindDeadEnds(graph) {
  const deadEnds = []
  graph.allLocations.forEach((loc) => {
    if (graph.plantSet[loc]) return
    const isReceiver = Object.keys(graph.locEdges).some((from) => graph.locEdges[from].indexOf(loc) >= 0)
    if (!isReceiver) return
    const hasOut = (graph.locEdges[loc] && graph.locEdges[loc].length > 0)
      || (graph.custEdges[loc] && graph.custEdges[loc].length > 0)
    if (!hasOut) deadEnds.push(loc)
  })
  return deadEnds
}

/** `snFindIsolatedPlants`: plantas que no llegan a ningún cliente. */
function snFindIsolatedPlants(graph, sets) {
  return graph.plants.filter((p) => !sets.usefulSet[p])
}

/** `snFindCycles`: ciclos por DFS, como mucho tres. */
function snFindCycles(graph) {
  const cycles = []; const visited = dict(); const inStack = dict(); const stackPath = []
  const allNodes = graph.plants.concat(graph.allLocations)
  function dfs(node) {
    if (cycles.length >= 3) return
    visited[node] = true; inStack[node] = true; stackPath.push(node)
    ;(graph.locEdges[node] || []).forEach((next) => {
      if (cycles.length >= 3) return
      if (!visited[next]) { dfs(next) } else if (inStack[next]) {
        const idx = stackPath.indexOf(next)
        if (idx >= 0) cycles.push(stackPath.slice(idx).concat([next]).join(' → '))
      }
    })
    stackPath.pop()
    inStack[node] = false
  }
  allNodes.forEach((loc) => { if (!visited[loc] && cycles.length < 3) dfs(loc) })
  return cycles
}

/** `snFindMissingLeadTimes`: los plazos vacíos o en cero de arcos, entregas y plantas. */
function snFindMissingLeadTimes(graph) {
  const issues = []
  Object.keys(graph.locLeadTimes || {}).forEach((key) => {
    const lt = graph.locLeadTimes[key]
    if (!lt || lt === '0') {
      const p = key.split('||'); issues.push({ type: 'loc', from: p[0], to: p[1] })
    }
  })
  Object.keys(graph.custLeadTimes || {}).forEach((key) => {
    const lt = graph.custLeadTimes[key]
    if (!lt || lt === '0') {
      const p = key.split('||'); issues.push({ type: 'cust', from: p[0], to: p[1] })
    }
  })
  Object.keys(graph.plantLeadTimes || {}).forEach((locid) => {
    const lt = graph.plantLeadTimes[locid]
    if (!lt || lt === '0') issues.push({ type: 'plant', loc: locid })
  })
  return issues
}

/** `snComputeMetrics`: plantas, centros, clientes, rutas, ruta más larga y nodos críticos. */
function snComputeMetrics(prdid, graph, paths, ghosts, deadEnds) {
  const dcSet = dict()
  graph.allLocations.forEach((l) => { if (!graph.plantSet[l]) dcSet[l] = true })

  let longestPath = 0
  paths.forEach((p) => { if (p.nodes.length > longestPath) longestPath = p.nodes.length })

  const nodeCount = dict()
  paths.forEach((p) => {
    p.nodes.forEach((n) => {
      if (!graph.plantSet[n]) nodeCount[n] = (nodeCount[n] || 0) + 1
    })
  })
  const threshold = paths.length > 0 ? paths.length * 0.5 : 1
  const critCount = Object.keys(nodeCount).filter((n) => nodeCount[n] >= threshold).length

  const status = paths.length > 0 ? 'Complete'
    : graph.plants.length > 0 ? 'Incomplete' : 'No Production'

  return {
    prdid, plants: graph.plants.length, dcs: Object.keys(dcSet).length,
    customers: graph.allCustomers.length, paths: paths.length,
    longestPath: longestPath + 1, ghosts: ghosts.length, deadEnds: deadEnds.length,
    criticalNodes: critCount, networkStatus: status,
  }
}

/** `snAnalyzeResilience`: por cliente, cuántas rutas lo alcanzan y qué nodos son únicos. */
function snAnalyzeResilience(prdid, graph, paths) {
  const custPaths = dict()
  paths.forEach((p) => {
    if (!custPaths[p.customer]) custPaths[p.customer] = []
    custPaths[p.customer].push(p)
  })
  const result = []
  Object.keys(custPaths).sort().forEach((custid) => {
    const cps = custPaths[custid]
    const criticalNodes = []
    if (cps.length > 0) {
      cps[0].nodes.filter((n) => !graph.plantSet[n]).forEach((node) => {
        if (cps.every((p) => p.nodes.indexOf(node) >= 0)) criticalNodes.push(node)
      })
    }
    const cat = cps.length === 1 ? 'Single Path'
      : criticalNodes.length > 0 ? 'Single Node Dependency' : 'Resilient'
    result.push({
      prdid, custid, pathCount: cps.length,
      criticalNodes, category: cat,
    })
  })
  return result
}

/**
 * `snComputeHealthScore`: puntaje 0-100 y su desglose paso a paso.
 *
 * Cuatro fórmulas según la categoría del material: semiterminado, materia prima, mercadería y
 * terminado (que también es la de «sin categoría»).
 */
export function snComputeHealthScore(metrics, paths, ghosts, deadEnds, ctx) {
  let score = 0
  const steps = ['Base: 0']
  const cmts = []
  ctx = ctx || {}

  if (ctx.useSemiRules) {
    // Semi: PSH existencia + consumo PSI + resiliencia multi-planta
    if (ctx.inPSH) { score += 30; steps.push('+30 produccion configurada') } else { steps.push('+0 sin produccion'); cmts.push('Sin PSH') }
    if (ctx.inPSI) { score += 40; steps.push('+40 consumo PSI configurado') } else { steps.push('+0 sin consumo PSI'); cmts.push('Sin consumo PSI') }
    if (metrics.plants > 1) { score += 20; steps.push(`+20 multiples plantas (${metrics.plants})`) }
    if (ctx.inLS) { score += 10; steps.push('+10 transferencia configurada') }
  } else if (ctx.useRawmatRules) {
    // Rawmat: arcos de suministro hacia plantas + cobertura de ubicaciones
    if (ctx.inLS) { score += 60; steps.push('+60 arcos de suministro configurados') } else { steps.push('+0 sin arcos de suministro'); cmts.push('Sin Location Source') }
    if (metrics.dcs > 0) { score += 20; steps.push(`+20 ubicaciones de consumo alcanzadas (${metrics.dcs})`) }
    if (ctx.inCS) { score += 20; steps.push('+20 entrega directa a cliente configurada') }
  } else if (ctx.useTradingRules) {
    // Trading: distribución + entrega a cliente + amplitud de clientes
    if (ctx.inLS) { score += 40; steps.push('+40 distribucion configurada') } else { steps.push('+0 sin distribucion'); cmts.push('Sin Location Source') }
    if (ctx.inCS) { score += 40; steps.push('+40 entrega a cliente configurada') } else { steps.push('+0 sin entrega a cliente'); cmts.push('Sin Customer Source') }
    if (metrics.customers > 1) { score += 20; steps.push(`+20 multiples clientes (${metrics.customers})`) }
  } else {
    // Finished (y uncategorized): max teórico = 50+15+15+20 = 100 → 'Healthy' alcanzable
    if (paths.length > 0) { score += 50; steps.push('+50 ruta completa planta-cliente') } else { steps.push('+0 sin rutas completas') }
    if (metrics.customers > 1) { score += 15; steps.push(`+15 multiples clientes (${metrics.customers})`) }
    if (metrics.paths > 1) { score += 15; steps.push(`+15 multiples rutas (${metrics.paths})`) }
    if (metrics.plants > 1) { score += 20; steps.push(`+20 multiples plantas (${metrics.plants})`) }
    if (ghosts.length > 0) { score -= 20; steps.push(`-20 ghost nodes (${ghosts.length})`) }
    if (deadEnds.length > 0) { score -= 15; steps.push(`-15 dead ends (${deadEnds.length})`) }
    const custPC = dict()
    paths.forEach((p) => { custPC[p.customer] = (custPC[p.customer] || 0) + 1 })
    const hasSinglePath = Object.keys(custPC).some((c) => custPC[c] === 1)
    if (hasSinglePath) { score -= 20; steps.push('-20 cliente(s) con unica ruta'); cmts.push('Single-path customers detected') }
    if (metrics.plants === 1) { score -= 15; steps.push('-15 fuente unica de produccion'); cmts.push('Single production source') }
    if (paths.length === 0) cmts.push('No valid plant-to-customer paths')
    if (ghosts.length > 0) cmts.push(`${ghosts.length} ghost DC(s)`)
    if (deadEnds.length > 0) cmts.push(`${deadEnds.length} dead-end location(s)`)
  }

  score = Math.max(0, Math.min(100, score))
  const cat = score >= 80 ? 'Healthy' : score >= 60 ? 'Acceptable' : score >= 40 ? 'Weak' : 'Critical'
  const detail = `${steps.join(' | ')} = ${score}`
  return { score, category: cat, comments: cmts.join('; '), detail }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Hoja Estadísticas (statsSheet.js · buildSN)
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * La hoja Estadísticas de la red. Lee las tablas de arcos por cursor, sin acumularlas
 * (`StatsSheet.buildSN`).
 */
async function construirEstadisticasRed(ws, ctx) {
  const idx = ctx.idx || {}
  const prdLookup = idx.prdLookup || {}; const locLookup = idx.locLookup || {}; const custLookup = idx.custLookup || {}
  const pshPrds = idx.pshPrds || {}; const psiCompPrds = idx.psiCompPrds || {}
  const { fuente, extras = {} } = ctx

  const {
    blank, title, row, banner, table, pctStr, nkeys, avg1, objVals, grayTotal, renderExtraFields,
  } = primitivasDeEstadisticas(ws, extras)

  // Una tabla ausente se ignora (`.catch(function () {})` de v7).
  const cur = (tabla, cb) => Promise.resolve(fuente.recorrer(tabla, cb)).catch(() => {})
  const bucketLT = (n, h) => { if (!(n > 0)) h.z++; else if (n <= 5) h.a++; else if (n <= 15) h.b++; else h.c++ }

  const prdInLocSrc = dict(); const prdInCustSrc = dict(); const prdInLocProd = dict(); const prdInCustProd = dict()
  const locInPSH = dict(); const locInLocSrc = dict(); const locInCustSrc = dict(); const locInLocProd = dict()
  const origins = dict(); const dests = dict(); const originsPerDest = dict(); const locOriginPrds = dict()
  let locSrcArcs = 0; let custArcs = 0; const custInCustSrc = dict(); const custPrds = dict()
  const tlt = { z: 0, a: 0, b: 0, c: 0 }; let tltSum = 0; let tltN = 0
  const clt = { z: 0, a: 0, b: 0, c: 0 }; let cltSum = 0; let cltN = 0

  await cur('sn_loc', (r) => {
    const p = str(r.PRDID); const fr = str(r.LOCFR); const to = str(r.LOCID)
    locSrcArcs++
    if (p) prdInLocSrc[p] = true
    if (fr) { locInLocSrc[fr] = true; origins[fr] = true; if (p) { (locOriginPrds[fr] || (locOriginPrds[fr] = dict()))[p] = true } }
    if (to) { locInLocSrc[to] = true; dests[to] = true }
    if (p && to) { const k = `${p}|${to}`; originsPerDest[k] = (originsPerDest[k] || 0) + 1 }
    const n = parseFloat(str(r.TLEADTIME || '')); bucketLT(n, tlt); if (n > 0) { tltSum += n; tltN++ }
  })
  await cur('sn_cust', (r) => {
    const p = str(r.PRDID); const c = str(r.CUSTID)
    custArcs++
    if (p) prdInCustSrc[p] = true
    if (c) custInCustSrc[c] = true
    if (c && p) { (custPrds[c] || (custPrds[c] = dict()))[p] = true }
    const n = parseFloat(str(r.CLEADTIME || '')); bucketLT(n, clt); if (n > 0) { cltSum += n; cltN++ }
  })
  await cur('sn_plant', (r) => { const l = str(r.LOCID); if (l) locInPSH[l] = true })
  await cur('sn_loc_prod', (r) => { const l = str(r.LOCID); const p = str(r.PRDID); if (p) prdInLocProd[p] = true; if (l) locInLocProd[l] = true })
  await cur('sn_cust_prod', (r) => { const p = str(r.PRDID); if (p) prdInCustProd[p] = true })

  const prdIds = Object.keys(prdLookup); const totalPrd = prdIds.length
  const locIds = Object.keys(locLookup); const totalLoc = locIds.length

  title('Estadísticas — Supply Network')
  blank()

  /* PRODUCT — cobertura en la red */
  let noActivity = 0
  prdIds.forEach((p) => {
    if (!pshPrds[p] && !psiCompPrds[p] && !prdInLocSrc[p] && !prdInCustSrc[p] && !prdInLocProd[p] && !prdInCustProd[p]) noActivity++
  })
  table({
    banner: 'PRODUCTO — Cobertura en la red',
    headers: ['Presencia', 'Productos', '% maestro'],
    rows: [
      ['Con producción propia (PSH)', nkeys(pshPrds), pctStr(nkeys(pshPrds), totalPrd)],
      ['Como componente (PSI)', nkeys(psiCompPrds), pctStr(nkeys(psiCompPrds), totalPrd)],
      ['En Location Source', nkeys(prdInLocSrc), pctStr(nkeys(prdInLocSrc), totalPrd)],
      ['En Customer Source', nkeys(prdInCustSrc), pctStr(nkeys(prdInCustSrc), totalPrd)],
      ['En Location Product', nkeys(prdInLocProd), pctStr(nkeys(prdInLocProd), totalPrd)],
      ['En Customer Product', nkeys(prdInCustProd), pctStr(nkeys(prdInCustProd), totalPrd)],
      ['Sin actividad en la red', noActivity, pctStr(noActivity, totalPrd)],
    ],
  })

  /* UBICACIONES — LOCTYPE */
  const byLt = {}
  locIds.forEach((l) => { const t = str(locLookup[l].LOCTYPE || '') || '(sin LOCTYPE)'; byLt[t] = (byLt[t] || 0) + 1 })
  const ltRows = Object.keys(byLt).sort().map((t) => [t, byLt[t], pctStr(byLt[t], totalLoc)])
  ltRows.push(grayTotal(['TOTAL', totalLoc, '100%']))
  table({
    banner: 'UBICACIONES — Composición por tipo (LOCTYPE)',
    headers: ['LOCTYPE', 'Ubicaciones', '% del total'],
    rows: ltRows,
  })

  /* UBICACIONES — presencia en la red */
  let locNoAct = 0
  locIds.forEach((l) => {
    if (!locInPSH[l] && !locInLocSrc[l] && !locInCustSrc[l] && !locInLocProd[l]) locNoAct++
  })
  table({
    banner: 'UBICACIONES — Presencia en la red',
    headers: ['Presencia', 'Ubicaciones', '% del total'],
    rows: [
      ['Con producción (PSH)', nkeys(locInPSH), pctStr(nkeys(locInPSH), totalLoc)],
      ['Con transferencias (Location Source)', nkeys(locInLocSrc), pctStr(nkeys(locInLocSrc), totalLoc)],
      ['Con entrega a cliente (Customer Source)', nkeys(locInCustSrc), pctStr(nkeys(locInCustSrc), totalLoc)],
      ['Habilitadas en Location Product', nkeys(locInLocProd), pctStr(nkeys(locInLocProd), totalLoc)],
      ['Sin actividad en la red', locNoAct, pctStr(locNoAct, totalLoc)],
    ],
  })

  /* UBICACIONES — conectividad (fan-out) */
  const oKeys = Object.keys(locOriginPrds); let sumFan = 0; let maxFan = 0
  oKeys.forEach((o) => { const c = nkeys(locOriginPrds[o]); sumFan += c; if (c > maxFan) maxFan = c })
  table({
    banner: 'UBICACIONES — Conectividad',
    headers: ['Métrica', 'Valor'],
    rows: [
      ['Ubicaciones origen (Location Source)', nkeys(origins)],
      ['Ubicaciones destino (Location Source)', nkeys(dests)],
      ['Promedio de productos por ubicación origen', avg1(sumFan, oKeys.length)],
      ['Máximo de productos en una ubicación origen', maxFan],
    ],
  })
  let fo15 = 0; let fo620 = 0; let fo2150 = 0; let fo51 = 0
  oKeys.forEach((o) => {
    const n = nkeys(locOriginPrds[o])
    if (n <= 5) fo15++; else if (n <= 20) fo620++; else if (n <= 50) fo2150++; else fo51++
  })
  table({
    banner: 'UBICACIONES — Distribución de productos por origen',
    headers: ['Productos por origen', 'Ubicaciones origen', '% del total'],
    rows: [
      ['1-5', fo15, pctStr(fo15, oKeys.length)],
      ['6-20', fo620, pctStr(fo620, oKeys.length)],
      ['21-50', fo2150, pctStr(fo2150, oKeys.length)],
      ['51+', fo51, pctStr(fo51, oKeys.length)],
    ],
  })

  /* ARCOS — Location Source */
  const multiSrc = Object.keys(originsPerDest).filter((k) => originsPerDest[k] >= 2).length
  table({
    banner: 'ARCOS — Transferencias (Location Source)',
    headers: ['Métrica', 'Valor'],
    rows: [
      ['Arcos de transferencia', locSrcArcs],
      ['Orígenes distintos (LOCFR)', nkeys(origins)],
      ['Destinos distintos (LOCID)', nkeys(dests)],
      ['Productos transferidos', nkeys(prdInLocSrc)],
      ['TLEADTIME promedio (días)', avg1(tltSum, tltN)],
      ['Destinos producto-planta con múltiples orígenes', multiSrc],
    ],
  })
  table({
    banner: 'ARCOS — Distribución de TLEADTIME',
    headers: ['TLEADTIME (días)', 'Arcos', '% del total'],
    rows: [
      ['0 / no definido', tlt.z, pctStr(tlt.z, locSrcArcs)],
      ['1-5', tlt.a, pctStr(tlt.a, locSrcArcs)],
      ['6-15', tlt.b, pctStr(tlt.b, locSrcArcs)],
      ['16+', tlt.c, pctStr(tlt.c, locSrcArcs)],
    ],
  })

  /* CLIENTES — Customer Source */
  table({
    banner: 'CLIENTES — Entrega (Customer Source)',
    headers: ['Métrica', 'Valor'],
    rows: [
      ['Clientes en el maestro', nkeys(custLookup)],
      ['Clientes con arco de entrega', nkeys(custInCustSrc)],
      ['Arcos de entrega', custArcs],
      ['Productos entregados a cliente', nkeys(prdInCustSrc)],
      ['CLEADTIME promedio (días)', avg1(cltSum, cltN)],
    ],
  })
  const cKeys = Object.keys(custPrds); let cn15 = 0; let cn620 = 0; let cn2150 = 0; let cn51 = 0
  cKeys.forEach((c) => {
    const n = nkeys(custPrds[c])
    if (n <= 5) cn15++; else if (n <= 20) cn620++; else if (n <= 50) cn2150++; else cn51++
  })
  table({
    banner: 'CLIENTES — Distribución por nº de productos',
    headers: ['Productos por cliente', 'Clientes', '% del total'],
    rows: [
      ['1-5', cn15, pctStr(cn15, cKeys.length)],
      ['6-20', cn620, pctStr(cn620, cKeys.length)],
      ['21-50', cn2150, pctStr(cn2150, cKeys.length)],
      ['51+', cn51, pctStr(cn51, cKeys.length)],
    ],
  })
  table({
    banner: 'CLIENTES — Distribución de CLEADTIME',
    headers: ['CLEADTIME (días)', 'Arcos', '% del total'],
    rows: [
      ['0 / no definido', clt.z, pctStr(clt.z, custArcs)],
      ['1-5', clt.a, pctStr(clt.a, custArcs)],
      ['6-15', clt.b, pctStr(clt.b, custArcs)],
      ['16+', clt.c, pctStr(clt.c, custArcs)],
    ],
  })

  /* CRUCES por campos adicionales */
  banner('CRUCES POR CAMPOS ADICIONALES')
  blank()
  let nX = 0
  nX += renderExtraFields('product', objVals(prdLookup),
    (r) => str(r.MATTYPEID || '') || '(sin tipo)', 'Tipo de material')
  nX += renderExtraFields('location', objVals(locLookup),
    (r) => str(r.LOCTYPE || '') || '(sin LOCTYPE)', 'LOCTYPE')
  nX += renderExtraFields('customer', objVals(custLookup))
  if (!nX) row(['No se seleccionaron campos adicionales. Agrégalos en el paso "Campos adicionales" para ver cruces aquí.'])
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// El análisis
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Cede el hilo para que la pantalla pueda dibujar entre lote y lote. */
const cederPorDefecto = () => Promise.resolve()

/** Una hoja de análisis en memoria: la de las pruebas y la de las hojas que no son de arcos. */
const hojaEnMemoria = (cfg) => crearHojaDeTabla(cfg)

/**
 * Corre el análisis de v7 sobre lo descargado y devuelve el informe.
 *
 * `entrada`:
 *
 *   idx         los índices pequeños que v7 armaba mientras bajaba (`SN_IDX`), todos `{ clave: valor }`:
 *               `allPrds` (productos con arcos o recetas), `prdLookup` / `locLookup` / `custLookup` (los
 *               maestros, `{ ID: registro }`), `pshPrds` (productos con receta), `psiCompPrds` (productos
 *               que son componente) y `psiConsumingLocs` (`{ PRDID: { LOCID: true } }`, dónde se consume).
 *   fuente      `{ recorrer(tabla, cb), filasDeProducto(tabla, prdid) }`: el cursor sobre una tabla
 *               (`sn_loc`, `sn_cust`, `sn_plant`, `sn_loc_prod`, `sn_cust_prod`; `cb` síncrona) y las
 *               filas de un producto (`idbGetByIndex(…, 'by_prdid', …)` de v7). Los arcos nunca se
 *               cargan enteros a memoria.
 *   tipos       la configuración de tipos de material de v7 (`mattype-config.js`).
 *   extras      los campos adicionales por entidad, `{ product: ['CAMPO'], … }`.
 *   conexion    `{ url, pa, pver }` para el bloque «CONEXION SAP IBP» del Resumen.
 *   ejecucion   `{ generadoEl: Date, filtro, entidades: [...] }` el bloque «ENTIDADES ODATA».
 *   hoy         `AAAA-MM-DD`, para el nombre del archivo.
 *   alProgreso(pct)  la barra (`onProgress` de v7); alEstado(texto)  la línea de estado (`onStatus`).
 *   registrar(clase, texto)  una línea del registro técnico.
 *   ceder()     devuelve una promesa que cede el hilo.
 *   crearHojaGrande(cfg)  hoja para Location Source / Customer Source (ver arriba); con `cerrar()`
 *               opcional, que se espera al terminar de llenarla.
 *
 * Devuelve el `Informe`, con `informe.totales` = lo que v7 devolvía del análisis.
 */
export async function analizarRed(entrada) {
  const {
    idx: SN_IDX = {},
    fuente,
    tipos: MATTYPE_CFG = {},
    extras = {},
    conexion = {},
    ejecucion = null,
    hoy = new Date().toISOString().slice(0, 10),
    alProgreso = () => {},
    alEstado = () => {},
    registrar = () => {},
    ceder = cederPorDefecto,
    crearHojaGrande = null,
  } = entrada
  const onProgress = alProgreso
  const onStatus = alEstado

  const prdLookup = SN_IDX.prdLookup || dict()
  const locLookup = SN_IDX.locLookup || dict()
  const custLookup = SN_IDX.custLookup || dict()
  const pshPrds = SN_IDX.pshPrds || dict()
  const psiCompPrds = SN_IDX.psiCompPrds || dict()
  const psiConsumingLocs = SN_IDX.psiConsumingLocs || dict()
  const allPrds = SN_IDX.allPrds || dict()

  /* ── micro-helpers ── */
  const pd = (id) => { const p = prdLookup[id] || {}; return str(p.PRDDESCR || '') }
  const pm = (id) => { const p = prdLookup[id] || {}; return str(p.MATTYPEID || '') }
  const ld = (id) => { const l = locLookup[id] || {}; return str(l.LOCDESCR || '') }
  const locType = (id) => { const l = locLookup[id] || {}; return str(l.LOCTYPE || '') }
  const cd = (id) => { const c = custLookup[id] || {}; return str(c.CUSTDESCR || '') }

  const mattypeIsExcl = (mt) => mattypeIsExcluded(MATTYPE_CFG, mt)
  const mattypeGetCats = (mt) => mattypeGetCategories(MATTYPE_CFG, mt)

  /* ── Workbook ── */
  const archivo = `SupplyNetworkAnalysis_${hoy}.xlsx`
  const informe = {
    titulo: 'Supply Network Analyzer — vista web',
    analizador: 'Supply Network Analyzer',
    archivo,
    generadoEl: hoy,
    hojas: [],
    resumen: [],
    estadisticas: [],
    nombreEstadisticas: NOMBRES_DE_HOJA_RED.stats,
    orden: [],
    hojasWeb: {},
    totales: null,
  }

  const hojaDeTabla = (cfg, creador = hojaEnMemoria) => {
    const h = creador(cfg)
    informe.hojas.push(h)
    return h
  }
  /** Las hojas de análisis (no el Resumen) son las que ve la vista web. */
  const hojaDeAnalisis = (cfg, creador) => {
    const h = hojaDeTabla(cfg, creador)
    informe.orden.push(h.nombre)
    // La vista web lee la MISMA hoja que el Excel: no se copia, para no tener las filas dos veces.
    informe.hojasWeb[h.nombre] = h
    return h
  }

  /* ── Hoja Resumen (se llena al final) ── */
  const S0 = hojaDeTabla({
    nombre: NOMBRES_DE_HOJA_RED.summary,
    color: 'FF34D399',
    encabezados: ['#', 'Hoja', 'Total registros', 'Alertas 🔴', 'Advertencias 🟡', 'OK ✅', '% Consistencia'],
  })

  /* ── Hoja Estadísticas (se crea aquí para quedar en posición 2; se llena al final) ── */
  const statsWs = crearHojaLibre({
    nombre: NOMBRES_DE_HOJA_RED.stats,
    color: 'FF29ABE2',
    capturar: (celdas) => { informe.estadisticas.push(celdas) },
  })
  informe.hojas.push(statsWs)

  /* ── Crear grupos de hojas ── */
  const definir = (clave, color, despuesDe, creador) => {
    const d = HOJAS_DE_RED[clave]
    const encabezados = d.encabezados.slice(); const notas = d.notas.slice(); const grupos = d.grupos.slice()
    efInjectHeaders(extras, clave, despuesDe, encabezados, notas, grupos)
    return hojaDeAnalisis({
      nombre: NOMBRES_DE_HOJA_RED[clave], color, encabezados, notas, grupos,
    }, creador)
  }
  // Las cinco hojas de análisis van por la fábrica de hojas en disco cuando hay una (v7 las guardaba las
  // cinco en IndexedDB para paginarlas): sin ella (las pruebas), en memoria.
  const grande = crearHojaGrande ?? hojaEnMemoria
  const gPrd = definir('product', 'FF29ABE2', 4, grande)
  const gLoc = definir('location', 'FF06B6D4', 4, grande)
  const gCust = definir('customer', 'FF10B981', 3, grande)
  const gLS = definir('locationSource', 'FFF7A800', 9, grande)
  const gCS = definir('customerSource', 'FFE8622A', 9, grande)

  const injR = (clave, despuesDe, row, record) => efInjectRow(extras, clave, despuesDe, row, record)

  /* ════════════════════════════════════════════════════════════════
     FASE 2 — Pre-índices globales (cursor, sin acumular arrays)
     ════════════════════════════════════════════════════════════════ */
  onStatus('Construyendo índices globales...')
  registrar('info', 'Fase 2: pre-índices...')

  const locProdSet = new Set() // "LOCID|PRDID"
  const custProdSet = new Set() // "CUSTID|PRDID"
  let lsArcSet = new Set() // "PRDID|LOCFR|LOCID" — para detección de arco inverso
  const prdInLocSrc = dict(); const prdInCustSrc = dict()
  const locInLocSrc = dict(); const locInCustSrc = dict(); const locInPSH = dict(); const locInLocProd = dict()
  const custInCustSrc = dict(); const custInCustProd = dict()
  const prdInLocProd = dict(); const prdInCustProd = dict()

  /* Índices para nuevas columnas */
  const locSrcPrdIdx = dict() // PRDID → { origins:{}, dests:{}, tltSum, tltCount }
  const custSrcPrdIdx = dict() // PRDID → { custs:{}, cltSum, cltCount }
  let originsPerDest = dict() // "PRDID|LOCID" → count of LOCFR (SPOF check)

  /* Contadores de arcos por ubicación (para hoja Location) */
  let locStatsSrc = dict()
  const ensureLS = (l) => {
    if (!locStatsSrc[l]) locStatsSrc[l] = { asOriginPrds: dict(), asDestPrds: dict(), custServed: dict() }
  }
  /* Contadores por cliente (para hoja Customer) */
  let custStatsSrc = dict()

  await fuente.recorrer('sn_loc', (r) => {
    const p = str(r.PRDID); const fr = str(r.LOCFR); const to = str(r.LOCID); const tlt = str(r.TLEADTIME || '')
    if (p) prdInLocSrc[p] = true
    if (fr) { locInLocSrc[fr] = true; ensureLS(fr); if (p) locStatsSrc[fr].asOriginPrds[p] = true }
    if (to) { locInLocSrc[to] = true; ensureLS(to); if (p) locStatsSrc[to].asDestPrds[p] = true }
    if (p && fr && to) lsArcSet.add(`${p}|${fr}|${to}`)
    if (p) {
      if (!locSrcPrdIdx[p]) locSrcPrdIdx[p] = { origins: dict(), dests: dict(), tltSum: 0, tltCount: 0 }
      if (fr) locSrcPrdIdx[p].origins[fr] = true
      if (to) {
        locSrcPrdIdx[p].dests[to] = true
        const od = `${p}|${to}`
        originsPerDest[od] = (originsPerDest[od] || 0) + 1
      }
      const tltNum = parseFloat(tlt)
      if (tltNum > 0) { locSrcPrdIdx[p].tltSum += tltNum; locSrcPrdIdx[p].tltCount++ }
    }
  })

  await fuente.recorrer('sn_cust', (r) => {
    const p = str(r.PRDID); const loc = str(r.LOCID); const c = str(r.CUSTID); const clt = str(r.CLEADTIME || '')
    if (p) prdInCustSrc[p] = true
    if (loc) { locInCustSrc[loc] = true; ensureLS(loc); if (c) locStatsSrc[loc].custServed[c] = true }
    if (c) {
      custInCustSrc[c] = true
      if (!custStatsSrc[c]) custStatsSrc[c] = { prds: dict(), locs: dict() }
      if (p) custStatsSrc[c].prds[p] = true
      if (loc) custStatsSrc[c].locs[loc] = true
    }
    if (p && c) {
      if (!custSrcPrdIdx[p]) custSrcPrdIdx[p] = { custs: dict(), cltSum: 0, cltCount: 0 }
      custSrcPrdIdx[p].custs[c] = true
      const cltNum = parseFloat(clt)
      if (cltNum > 0) { custSrcPrdIdx[p].cltSum += cltNum; custSrcPrdIdx[p].cltCount++ }
    }
  })

  await fuente.recorrer('sn_plant', (r) => {
    const loc = str(r.LOCID); if (loc) locInPSH[loc] = true
  })

  await fuente.recorrer('sn_loc_prod', (r) => {
    const loc = str(r.LOCID); const p = str(r.PRDID)
    if (loc && p) { locProdSet.add(`${loc}|${p}`); prdInLocProd[p] = true; locInLocProd[loc] = true }
  })

  await fuente.recorrer('sn_cust_prod', (r) => {
    const c = str(r.CUSTID); const p = str(r.PRDID)
    if (c && p) { custProdSet.add(`${c}|${p}`); prdInCustProd[p] = true; custInCustProd[c] = true }
  })

  onProgress(57)
  registrar('ok', `Pre-índices: LocProd=${locProdSet.size} CustProd=${custProdSet.size}`)

  /* ════════════════════════════════════════════════════════════════
     FASE 3 — Loop de productos (CHUNK=50, yield entre batches)
     ════════════════════════════════════════════════════════════════ */
  /* Universo: allPrds (LocSrc/CustSrc/PSH) + psiCompPrds + prdLookup */
  const allPrdObj = Object.assign(dict(), allPrds, psiCompPrds)
  Object.keys(prdLookup).forEach((p) => { allPrdObj[p] = true })
  const products = Object.keys(allPrdObj).sort()
  const n = products.length

  /* Acumuladores del loop */
  let locStats = dict() // locid → { isGhost, isDeadEnd, isIsolated, inCycle, cycleDescs, isCritical, ... }
  let custStats = dict() // custid → { pathCount, prdCount, single, dep, resilient }
  let critNodeMap = dict()
  let arcInCompletePath = dict() // "LS|FR|TO|PRD" o "CS|LOC|CUST|PRD"

  let completeCount = 0; let totalPaths = 0; let ghostCount = 0; let healthSum = 0
  const CHUNK = 50

  for (let i = 0; i < n; i += CHUNK) {
    const batch = products.slice(i, Math.min(i + CHUNK, n))

    for (let bi = 0; bi < batch.length; bi++) {
      const prdid = batch[bi]
      const inPSH = !!pshPrds[prdid]
      const inPSI = !!psiCompPrds[prdid]
      const inLS = !!prdInLocSrc[prdid]
      const inCS = !!prdInCustSrc[prdid]
      const inLP = !!prdInLocProd[prdid]
      const inCP = !!prdInCustProd[prdid]
      const onlyMaster = !inPSH && !inPSI && !inLS && !inCS && !inLP && !inCP

      if (!pm(prdid)) continue
      if (mattypeIsExcl(pm(prdid))) continue

      /* ── Categoría del producto ── */
      const snCats = mattypeGetCats(pm(prdid))
      const catIsSemi = snCats.indexOf('semi') >= 0
      const catIsFinished = snCats.indexOf('finished') >= 0
      const catIsRawmat = snCats.indexOf('rawmat') >= 0
      const catIsTrading = snCats.indexOf('trading') >= 0
      // Reglas por categoría (más permisivo cuando hay multi-categoría)
      const useSemiRules = catIsSemi && !catIsFinished
      const useRawmatRules = catIsRawmat && !catIsFinished && !catIsSemi
      const useTradingRules = catIsTrading && !catIsFinished && !catIsSemi
      const catIsUncategorized = !catIsSemi && !catIsFinished && !catIsRawmat && !catIsTrading

      // Lee de la base local lo del producto (arcos, entregas y plantas), como `snBuildProductGraph`.
      const locRows = await fuente.filasDeProducto('sn_loc', prdid)
      const custRows = await fuente.filasDeProducto('sn_cust', prdid)
      const plantRows = await fuente.filasDeProducto('sn_plant', prdid)
      const graph = armarGrafo(prdid, locRows, custRows, plantRows)
      const paths = snFindAllPaths(graph)
      const sets = snComputeNetworkSets(graph)
      const ghosts = snFindGhostNodes(graph, sets)
      const deadEnds = snFindDeadEnds(graph)
      const isoPlants = snFindIsolatedPlants(graph, sets)
      const cycles = snFindCycles(graph)
      const ltIssues = snFindMissingLeadTimes(graph)
      const metrics = snComputeMetrics(prdid, graph, paths, ghosts, deadEnds)
      const resData = snAnalyzeResilience(prdid, graph, paths)
      const health = snComputeHealthScore(metrics, paths, ghosts, deadEnds, {
        useSemiRules,
        useRawmatRules,
        useTradingRules,
        inPSH, inPSI, inLS, inCS,
      })

      /* ── Estado de la Red ── */
      let networkStatus
      if (onlyMaster) {
        networkStatus = 'Huérfano'
      } else if (useSemiRules) {
        if (!inPSH) {
          networkStatus = 'Sin Producción'
        } else if (!inPSI) {
          networkStatus = 'Sin Consumo PSI'
        } else if (!inLS) {
          const _psiLocsNoLS = psiConsumingLocs[prdid] || {}
          const _hasConsLocs = Object.keys(_psiLocsNoLS).length > 0
          const _localNoLS = !_hasConsLocs || graph.plants.some((l) => !!_psiLocsNoLS[l])
          networkStatus = _localNoLS ? 'Semiterminado Local' : 'Semiterminado sin Transferencia'
        } else {
          const _psiLocsNS = psiConsumingLocs[prdid] || {}
          const _semiLocalOk = graph.plants.some((l) => !!_psiLocsNS[l])
          networkStatus = _semiLocalOk ? 'Semiterminado Local con Transferencia' : 'Semiterminado con Transferencia'
        }
      } else if (inPSH) {
        // Terminado / multi-cat con finished: necesita ruta a cliente
        networkStatus = paths.length > 0 ? 'Red Completa'
          : inCS ? 'Distribución sin ruta completa'
            : inLS ? 'Sin Entrega a Cliente'
              : 'Sin Distribución'
      } else if (inPSI) {
        // Insumo / rawmat: necesita arco de abastecimiento
        if (!inLS) { networkStatus = 'Sin Abastecimiento' } else {
          const reachesPlant = graph.allLocations.some((l) => locInPSH[l])
          networkStatus = reachesPlant ? 'Abastecimiento Completo' : 'Abastecimiento Parcial'
        }
      } else if (catIsFinished) {
        // Terminado sin PSH ni PSI: falta fuente de producción
        networkStatus = (inLS || inCS) ? 'Sin Producción' : 'Sin arcos de red'
      } else if (useRawmatRules) {
        // Rawmat sin PSI: tiene arcos pero no aparece como componente en ningún BOM
        networkStatus = inLS ? 'Abastecimiento sin Consumo PSI' : 'Sin Abastecimiento'
      } else {
        // Trading / sin PSH ni PSI: evalúa solo arcos de distribución
        networkStatus = (inLS && inCS) ? 'Solo Distribución + Entrega'
          : inLS ? 'Solo Distribución'
            : inCS ? 'Solo Entrega'
              : 'Sin arcos de red'
      }

      /* ── Observaciones (filtradas por categoría) ── */
      const obs = []
      // Traduce networkStatus problemático a obs para que pObs refleje siempre el problema real
      const OK_STATUSES = useSemiRules ? { 'Semiterminado Local': 1, 'Semiterminado con Transferencia': 1, 'Semiterminado Local con Transferencia': 1 }
        : useTradingRules ? { 'Solo Distribución + Entrega': 1 }
          : useRawmatRules ? { 'Abastecimiento Completo': 1 }
            : { 'Red Completa': 1 }
      if (!OK_STATUSES[networkStatus]) obs.push(networkStatus)

      if (paths._truncated) obs.push('Paths truncados (>50.000, red muy compleja)')
      cycles.forEach((c) => { obs.push(`Ciclo: ${c}`) })
      // Ghost, dead-end, planta aislada solo aplican a terminados (necesitan ruta a cliente)
      if (!useSemiRules && !useRawmatRules) {
        ghosts.forEach((l) => { obs.push(`Ghost node: ${l}`) })
        deadEnds.forEach((l) => { obs.push(`Dead-end: ${l}`) })
        isoPlants.forEach((l) => { obs.push(`Planta aislada: ${l}`) })
      }
      ltIssues.forEach((lt) => {
        if (lt.type === 'plant') {
          // PLEADTIME: aplica a terminados y semiterminados, no a insumos ni mercadería
          if (!useRawmatRules && !useTradingRules) obs.push(`PLEADTIME faltante: ${lt.loc}`)
        } else if (lt.type === 'loc') {
          obs.push(`TLEADTIME faltante: ${lt.from}→${lt.to}`)
        } else if (!useSemiRules && !useRawmatRules) {
          // CLEADTIME: solo aplica si el producto llega a clientes (no semi ni insumo)
          obs.push(`CLEADTIME faltante: ${lt.from}→${lt.to}`)
        }
      })
      if (!inLP && (inPSH || inLS)) obs.push('Sin Location Product')
      if (!inCP && inCS) obs.push('Sin Customer Product')

      // Trading y sin-categoría: validar que arcos LS y CS compartan al menos una ubicación
      let tradingDisconnected = false
      if ((useTradingRules || catIsUncategorized) && inLS && inCS) {
        const _lsReachable = dict()
        Object.keys(graph.locEdges).forEach((fr) => {
          _lsReachable[fr] = true
          graph.locEdges[fr].forEach((to) => { _lsReachable[to] = true })
        })
        tradingDisconnected = !Object.keys(graph.custEdges).some((loc) => !!_lsReachable[loc])
        if (tradingDisconnected) obs.push('Red desconectada: arcos LS y CS no comparten ubicaciones')
      }

      // Semiterminado: validar consumo PSI en cada destino de transferencia
      let semiDestsNoPsi = []
      if (useSemiRules && inPSH && inPSI && inLS) {
        const _psiLocs = psiConsumingLocs[prdid] || {}
        const _lsDests = []
        Object.keys(graph.locEdges).forEach((fr) => {
          graph.locEdges[fr].forEach((to) => {
            if (_lsDests.indexOf(to) < 0) _lsDests.push(to)
          })
        })
        semiDestsNoPsi = _lsDests.filter((loc) => !_psiLocs[loc])
        if (semiDestsNoPsi.length > 0) {
          obs.push(`Destino(s) de transferencia sin consumo PSI: ${semiDestsNoPsi.join(', ')}`)
        }
      }

      /* ── Semáforo Product (por categoría) ── */
      const hasPleadtimeIssue = ltIssues.some((lt) => lt.type === 'plant')
      const hasTleadtimeIssue = ltIssues.some((lt) => lt.type === 'loc')
      const hasCleadtimeIssue = ltIssues.some((lt) => lt.type === 'cust')
      // Ghost/dead-end/plantas aisladas: solo terminados, sin cat y trading (no semi ni rawmat)
      const hasGhostDeadIso = !useSemiRules && !useRawmatRules && (ghosts.length > 0 || deadEnds.length > 0 || isoPlants.length > 0)

      let pFill
      if (useSemiRules) {
        const SEMI_RED = { 'Sin Producción': 1, 'Sin Consumo PSI': 1, Huérfano: 1, 'Semiterminado sin Transferencia': 1 }
        pFill = (SEMI_RED[networkStatus] || cycles.length > 0) ? C_RED
          : ((!inLP && inPSH) || semiDestsNoPsi.length > 0 || hasPleadtimeIssue || hasTleadtimeIssue || paths._truncated) ? C_YEL
            : null
      } else if (useTradingRules) {
        const TRADE_RED = { 'Solo Entrega': 1, Huérfano: 1 }
        const TRADE_YEL = { 'Solo Distribución': 1, 'Sin arcos de red': 1 }
        pFill = (cycles.length > 0 || TRADE_RED[networkStatus] || hasGhostDeadIso) ? C_RED
          : (TRADE_YEL[networkStatus] || tradingDisconnected || (!inLP && inLS) || (!inCP && inCS) || hasTleadtimeIssue || hasCleadtimeIssue || paths._truncated) ? C_YEL
            : null
      } else {
        // Terminado / insumo / sin categoría
        // 'Solo Entrega', 'Solo Distribución' y 'Solo Distribución + Entrega' son RED para terminados:
        // sin PSH no hay fuente de producción, independientemente de los arcos de distribución.
        const RED_ST = {
          Huérfano: 1,
          'Sin Distribución': 1,
          'Sin Abastecimiento': 1,
          'Sin Entrega a Cliente': 1,
          'Solo Entrega': 1,
          'Solo Distribución': 1,
          'Solo Distribución + Entrega': 1,
          'Sin arcos de red': 1,
          'Distribución sin ruta completa': 1,
          'Sin Producción': 1,
        }
        const YEL_ST = { 'Abastecimiento Parcial': 1, 'Abastecimiento sin Consumo PSI': 1 }
        pFill = (RED_ST[networkStatus] || cycles.length > 0 || hasGhostDeadIso || (hasPleadtimeIssue && !useRawmatRules)) ? C_RED
          : (YEL_ST[networkStatus] || tradingDisconnected || (!inLP && (inPSH || inLS)) || (!inCP && inCS) || hasTleadtimeIssue || (!useRawmatRules && hasCleadtimeIssue) || paths._truncated) ? C_YEL
            : null
      }

      let pObs
      if (!obs.length) {
        const okParts = []
        if (useSemiRules) {
          if (networkStatus === 'Semiterminado Local con Transferencia') {
            okParts.push('Semiterminado consumido en planta productora con transferencia configurada')
          } else if (networkStatus === 'Semiterminado con Transferencia') {
            okParts.push('Semiterminado consumido en destino de transferencia')
          } else {
            okParts.push('Semiterminado consumido en planta productora')
          }
          if (inLP) okParts.push('Habilitado en Location Product')
          if (ltIssues.length === 0) okParts.push('Lead times definidos')
        } else if (useTradingRules) {
          okParts.push('Mercadería con arcos de distribución y entrega')
          if (inLP) okParts.push('Habilitado en Location Product')
          if (inCP && inCS) okParts.push('Habilitado en Customer Product')
          if (ltIssues.length === 0) okParts.push('Lead times definidos')
        } else {
          okParts.push('Red completa sin anomalias')
          if (inLP) okParts.push('Habilitado en Location Product')
          if (inCP && inCS) okParts.push('Habilitado en Customer Product')
          if (ltIssues.length === 0) okParts.push('Lead times definidos')
          if (metrics.paths > 0) okParts.push(`${metrics.paths} ruta(s) a cliente`)
        }
        pObs = okParts.join(' | ')
      } else {
        pObs = obs.join(' | ')
      }

      const _lsPrd = locSrcPrdIdx[prdid] || { origins: {}, dests: {}, tltSum: 0, tltCount: 0 }
      const _csPrd = custSrcPrdIdx[prdid] || { custs: {}, cltSum: 0, cltCount: 0 }
      const _numOrigins = Object.keys(_lsPrd.origins).length
      const _origCodes = _numOrigins ? Object.keys(_lsPrd.origins).join(', ') : NA_DASH
      const _numDests = Object.keys(_lsPrd.dests).length
      const _destCodes = _numDests ? Object.keys(_lsPrd.dests).join(', ') : NA_DASH
      const _numCustCS = Object.keys(_csPrd.custs).length
      const _custCodes = _numCustCS ? Object.keys(_csPrd.custs).join(', ') : NA_DASH
      const _isMulti = Object.keys(_lsPrd.dests).some((to) => (originsPerDest[`${prdid}|${to}`] || 0) > 1)
      const _tltAvg = _lsPrd.tltCount > 0 ? parseFloat((_lsPrd.tltSum / _lsPrd.tltCount).toFixed(1)) : NA_DASH
      const _cltAvg = _csPrd.cltCount > 0 ? parseFloat((_csPrd.cltSum / _csPrd.cltCount).toFixed(1)) : NA_DASH
      const _nIsoPlants = isoPlants.length

      const _prdRow = [
        stLabel(pFill), pObs,
        prdid, pd(prdid), pm(prdid),
        yn(inPSH), yn(inPSI), yn(inLS), yn(inCS), yn(inLP), yn(inCP), yn(onlyMaster),
        networkStatus, metrics.plants, metrics.dcs, metrics.customers,
        metrics.paths, metrics.longestPath, metrics.ghosts, metrics.deadEnds,
        health.score, health.category, health.detail,
        _numOrigins || NA_DASH, _origCodes, _numDests || NA_DASH, _destCodes,
        _numCustCS || NA_DASH, _custCodes, yn(_isMulti), _tltAvg, _cltAvg,
        _nIsoPlants > 0 ? _nIsoPlants : NA_DASH,
      ]
      injR('product', 4, _prdRow, prdLookup[prdid])
      gPrd.agregar(_prdRow, pFill)

      if (paths.length > 0) completeCount++
      totalPaths += paths.length
      healthSum += health.score || 0
      ghostCount += ghosts.length

      /* ── Acumular locStats (topología) ── */
      // Mismo filtro que en obs: ghost/dead-end/planta aislada solo para terminados
      if (!useSemiRules && !useRawmatRules) {
        ghosts.forEach((l) => { if (!locStats[l]) locStats[l] = {}; locStats[l].isGhost = true })
        deadEnds.forEach((l) => { if (!locStats[l]) locStats[l] = {}; locStats[l].isDeadEnd = true })
        isoPlants.forEach((l) => { if (!locStats[l]) locStats[l] = {}; locStats[l].isIsolated = true })
      }
      cycles.forEach((cStr) => {
        cStr.split(' → ').forEach((loc) => {
          if (!loc) return
          if (!locStats[loc]) locStats[loc] = {}
          locStats[loc].inCycle = true
          if (!locStats[loc].cycleDescs) locStats[loc].cycleDescs = []
          if (locStats[loc].cycleDescs.length < 3 && locStats[loc].cycleDescs.indexOf(cStr) < 0) {
            locStats[loc].cycleDescs.push(cStr)
          }
        })
      })

      /* ── Acumular custStats + critNodeMap ── */
      resData.forEach((r) => {
        if (!custStats[r.custid]) custStats[r.custid] = { pathCount: 0, prdCount: 0, single: 0, dep: 0, resilient: 0 }
        custStats[r.custid].pathCount += r.pathCount
        custStats[r.custid].prdCount++
        if (r.category === 'Single Path') custStats[r.custid].single++
        else if (r.category === 'Single Node Dependency') custStats[r.custid].dep++
        else custStats[r.custid].resilient++
        r.criticalNodes.forEach((node) => {
          if (!critNodeMap[node]) critNodeMap[node] = { products: dict(), customers: dict() }
          critNodeMap[node].products[prdid] = true
          critNodeMap[node].customers[r.custid] = true
        })
      })

      /* ── Acumular arcInCompletePath ── */
      paths.forEach((p) => {
        if (!p.customer) return
        for (let k = 0; k < p.nodes.length - 1; k++) {
          arcInCompletePath[`LS|${p.nodes[k]}|${p.nodes[k + 1]}|${prdid}`] = true
        }
        arcInCompletePath[`CS|${p.nodes[p.nodes.length - 1]}|${p.customer}|${prdid}`] = true
      })
    }

    await ceder()
    const done = Math.min(i + CHUNK, n)
    onProgress(57 + Math.round((done / n) * 28))
    onStatus(`Analizando ${done}/${n} productos...`)
    if (i > 0 && i % 500 === 0) registrar('info', `Analizados ${done}/${n}...`)
  }

  const avgHealth = n > 0 ? Math.round(healthSum / n) : 0

  /* ════════════════════════════════════════════════════════════════
     FASE 4 — Hoja Location
     ════════════════════════════════════════════════════════════════ */
  onStatus(`Hoja ${NOMBRES_DE_HOJA_RED.location} lista...`)

  /* Integrar critNodeMap en locStats */
  Object.keys(critNodeMap).forEach((loc) => {
    if (!locStats[loc]) locStats[loc] = {}
    const d = critNodeMap[loc]
    locStats[loc].isCritical = true
    locStats[loc].productsImpacted = Object.keys(d.products).length
    locStats[loc].customersImpacted = Object.keys(d.customers).length
    locStats[loc].riskLevel = locStats[loc].productsImpacted > 3 ? 'Critical'
      : locStats[loc].productsImpacted > 1 ? 'High' : 'Medium'
  })
  critNodeMap = null

  const allLocObj = Object.assign(dict(), locLookup, locInLocSrc, locInCustSrc, locInPSH, locInLocProd)
  Object.keys(allLocObj).sort().forEach((locid) => {
    const inPSHL = !!locInPSH[locid]
    const inLSL = !!locInLocSrc[locid]
    const inCSL = !!locInCustSrc[locid]
    const inLPL = !!locInLocProd[locid]
    const onlyMstL = !inPSHL && !inLSL && !inCSL && !inLPL

    const lSt = locStats[locid] || {}
    const lSrc = locStatsSrc[locid] || { asOriginPrds: {}, asDestPrds: {}, custServed: {} }

    const numPrd = Object.keys(Object.assign(dict(), lSrc.asOriginPrds, lSrc.asDestPrds)).length
    const numOrigin = Object.keys(lSrc.asOriginPrds).length
    const numDest = Object.keys(lSrc.asDestPrds).length
    const numCust = Object.keys(lSrc.custServed).length

    const lobs = []
    if (lSt.isGhost) lobs.push('Ghost node (alimentado sin salida util)')
    if (lSt.isDeadEnd) lobs.push('Dead-end (recibe pero no reenvía)')
    if (lSt.isIsolated) lobs.push('Planta aislada (sin ruta a ningun cliente)')
    if (lSt.inCycle && lSt.cycleDescs) lobs.push(`Participa en ciclo: ${lSt.cycleDescs[0]}`)
    if (!inLPL && (inLSL || inPSHL)) lobs.push('Sin Location Product')
    if (lSt.isCritical) {
      lobs.push(
        'Nodo critico: {n} prod, {m} clientes'
          .replace('{n}', lSt.productsImpacted)
          .replace('{m}', lSt.customersImpacted),
      )
    }
    if (onlyMstL) lobs.push('Solo en maestro de ubicaciones, sin actividad en la red')

    const lFill = (lSt.isGhost || lSt.isDeadEnd || lSt.isIsolated || lSt.inCycle || (!inLPL && (inLSL || inPSHL))) ? C_RED
      : (onlyMstL || lSt.isCritical) ? C_YEL : null

    let lObsStr
    if (!lobs.length) {
      const lOkParts = ['Sin anomalias topologicas']
      if (inLPL) lOkParts.push('Habilitado en Location Product')
      if (numCust > 0) lOkParts.push(`${numCust} cliente(s) servido(s)`)
      if (numOrigin > 0) {
        lOkParts.push('Activo como origen para {n} producto(s)'.replace('{n}', numOrigin))
      }
      lObsStr = lOkParts.join(' | ')
    } else { lObsStr = lobs.join(' | ') }

    const _locRole = (inPSHL && inCSL) ? 'Planta con Entrega'
      : inPSHL ? 'Planta'
        : (inLSL && inCSL) ? 'DC con Entrega Directa'
          : inLSL ? 'DC'
            : inCSL ? 'Punto de Entrega'
              : 'Sin rol activo'

    const _locRow = [
      stLabel(lFill), lObsStr,
      locid, ld(locid), locType(locid), _locRole,
      yn(inPSHL), yn(inLSL), yn(inCSL), yn(inLPL), yn(onlyMstL),
      numPrd, numOrigin, numDest, numCust,
      yn(!!lSt.isCritical), lSt.productsImpacted || '', lSt.customersImpacted || '', lSt.riskLevel || '',
    ]
    injR('location', 4, _locRow, locLookup[locid])
    gLoc.agregar(_locRow, lFill)
  })
  locStats = null; locStatsSrc = null
  onProgress(88)
  await ceder()

  /* ════════════════════════════════════════════════════════════════
     FASE 5 — Hoja Customer
     ════════════════════════════════════════════════════════════════ */
  onStatus(`Hoja ${NOMBRES_DE_HOJA_RED.customer} lista...`)

  const allCustObj = Object.assign(dict(), custLookup, custInCustSrc, custInCustProd)
  Object.keys(allCustObj).sort().forEach((custid) => {
    const inCS2 = !!custInCustSrc[custid]
    const inCP2 = !!custInCustProd[custid]
    const onlyM2 = !inCS2 && !inCP2

    const cSrc = custStatsSrc[custid] || { prds: {}, locs: {} }
    const cSt = custStats[custid] || { pathCount: 0, prdCount: 0, single: 0, dep: 0, resilient: 0 }

    const numPrd2 = Object.keys(cSrc.prds).length
    const numLoc2 = Object.keys(cSrc.locs).length
    const domRes = cSt.single > 0 ? 'Single Path'
      : cSt.dep > 0 ? 'Single Node Dependency'
        : cSt.prdCount > 0 ? 'Resilient' : '-'

    const cobs = []
    if (onlyM2) cobs.push('Solo en maestro, sin uso en red')
    if (!inCP2 && inCS2) cobs.push('Sin Customer Product')
    if (cSt.single > 0) cobs.push(`${cSt.single} producto(s) con unica ruta`)
    if (cSt.dep > 0) cobs.push(`${cSt.dep} producto(s) con nodo critico unico`)
    if (!onlyM2 && numPrd2 === 0) cobs.push('Sin productos alcanzables desde produccion')

    const cFill = (onlyM2 || (!onlyM2 && numPrd2 === 0)) ? C_RED
      : ((!inCP2 && inCS2) || cSt.single > 0) ? C_YEL : null

    let cObsStr
    if (!cobs.length) {
      const cOkParts = ['Abastecido con rutas resilientes']
      if (inCP2) cOkParts.push('Habilitado en Customer Product')
      if (numPrd2 > 0) cOkParts.push(`${numPrd2} producto(s) alcanzables`)
      if (cSt.pathCount > 0) cOkParts.push(`${cSt.pathCount} ruta(s) configuradas`)
      cObsStr = cOkParts.join(' | ')
    } else { cObsStr = cobs.join(' | ') }

    const _custRow = [
      stLabel(cFill), cObsStr,
      custid, cd(custid),
      yn(inCS2), yn(inCP2), yn(onlyM2),
      numPrd2, numLoc2, cSt.pathCount, domRes,
    ]
    injR('customer', 3, _custRow, custLookup[custid])
    gCust.agregar(_custRow, cFill)
  })
  custStats = null; custStatsSrc = null
  // Las tres hojas acotadas ya tienen todas sus filas: se cierran para que la fábrica de hojas en disco
  // termine de escribir (v7: `finalizeWeb`). En memoria (pruebas) `cerrar` no existe y no pasa nada.
  await gPrd.cerrar?.()
  await gLoc.cerrar?.()
  await gCust.cerrar?.()
  onProgress(91)
  await ceder()

  /* ════════════════════════════════════════════════════════════════
     FASE 6 — Hoja Location Source (cursor, sin acumular array)
     ════════════════════════════════════════════════════════════════ */
  onStatus(`Hoja ${NOMBRES_DE_HOJA_RED.locationSource} lista...`)
  let lsSeenArcs = new Set() // para detectar duplicados en esta pasada

  await fuente.recorrer('sn_loc', (r) => {
    const p = str(r.PRDID); const fr = str(r.LOCFR); const to = str(r.LOCID); const tlt = str(r.TLEADTIME || '')
    if (!p || !fr || !to) return
    if (!pm(p)) return
    if (mattypeIsExcl(pm(p))) return

    const arcKey = `${p}|${fr}|${to}`
    const isDup = lsSeenArcs.has(arcKey)
    lsSeenArcs.add(arcKey)
    const isInv = lsArcSet.has(`${p}|${to}|${fr}`)
    const inLPFr = locProdSet.has(`${fr}|${p}`)
    const inLPTo = locProdSet.has(`${to}|${p}`)
    const pInPSH = !!pshPrds[p]
    const inPath = !!arcInCompletePath[`LS|${fr}|${to}|${p}`]
    const ltNum = parseFloat(tlt)
    const ltSt = !tlt ? 'Missing' : (ltNum === 0 ? 'Zero' : 'OK')

    const lsObs = []
    if (!inLPFr) lsObs.push(`Sin Location Product en origen (${fr})`)
    if (!inLPTo) lsObs.push(`Sin Location Product en destino (${to})`)
    if (isDup) lsObs.push('Arco duplicado en el dataset')
    if (isInv) lsObs.push(`Existe arco inverso (${to}→${fr})`)
    if (ltSt !== 'OK') lsObs.push(`TLEADTIME ${ltSt.toLowerCase()}`)

    const lsFill = (!inLPFr || !inLPTo || isDup) ? C_RED
      : (isInv || ltSt !== 'OK') ? C_YEL : null

    const lsObsStr = lsObs.length
      ? lsObs.join(' | ')
      : `Arco valido | Location Product en origen y destino | TLEADTIME definido${inPath ? ' | En ruta completa' : ''}`

    const isSpof = (originsPerDest[`${p}|${to}`] || 0) === 1
    const _lsRow = [
      stLabel(lsFill), lsObsStr,
      p, pd(p), pm(p), fr, ld(fr), to, ld(to), tlt,
      yn(inLPFr), yn(inLPTo), yn(pInPSH),
      yn(inPath), yn(isInv), ltSt, yn(isSpof),
    ]
    injR('locationSource', 9, _lsRow, r)
    gLS.agregar(_lsRow, lsFill)
  })
  await gLS.cerrar?.()
  lsSeenArcs = null; lsArcSet = null; originsPerDest = null
  onProgress(94)
  await ceder()

  /* ════════════════════════════════════════════════════════════════
     FASE 7 — Hoja Customer Source (cursor)
     ════════════════════════════════════════════════════════════════ */
  onStatus(`Hoja ${NOMBRES_DE_HOJA_RED.customerSource} lista...`)

  await fuente.recorrer('sn_cust', (r) => {
    const p = str(r.PRDID); const loc = str(r.LOCID); const c = str(r.CUSTID); const clt = str(r.CLEADTIME || '')
    if (!p || !loc || !c) return
    if (!pm(p)) return
    if (mattypeIsExcl(pm(p))) return

    const inLPLoc = locProdSet.has(`${loc}|${p}`)
    const inCPCust = custProdSet.has(`${c}|${p}`)
    const pInPSH2 = !!pshPrds[p]
    const inPath2 = !!arcInCompletePath[`CS|${loc}|${c}|${p}`]
    const ltNum2 = parseFloat(clt)
    const ltSt2 = !clt ? 'Missing' : (ltNum2 === 0 ? 'Zero' : 'OK')

    const csObs = []
    if (!inLPLoc) csObs.push(`Sin Location Product en ubicacion (${loc})`)
    if (!inCPCust) csObs.push(`Sin Customer Product para cliente (${c})`)
    if (!inPath2 && pInPSH2) csObs.push('Entrega no alcanzable desde produccion')
    if (ltSt2 !== 'OK') csObs.push(`CLEADTIME ${ltSt2.toLowerCase()}`)

    const csFill = (!inLPLoc || !inCPCust) ? C_RED
      : (ltSt2 !== 'OK' || (!inPath2 && pInPSH2)) ? C_YEL : null

    const csObsStr = csObs.length
      ? csObs.join(' | ')
      : 'Entrega alcanzable | Location Product y Customer Product configurados | CLEADTIME definido'

    const _csRow = [
      stLabel(csFill), csObsStr,
      p, pd(p), pm(p), loc, ld(loc), c, cd(c), clt,
      yn(inLPLoc), yn(inCPCust), yn(pInPSH2),
      yn(inPath2), ltSt2,
    ]
    injR('customerSource', 9, _csRow, r)
    gCS.agregar(_csRow, csFill)
  })
  await gCS.cerrar?.()
  arcInCompletePath = null
  onProgress(96)
  await ceder()

  /* ════════════════════════════════════════════════════════════════
     FASE 8 — Hoja Resumen + Estadísticas
     ════════════════════════════════════════════════════════════════ */
  onStatus('Generando Resumen...')

  const sheetDefs = [
    { key: 'Product', nombre: NOMBRES_DE_HOJA_RED.product, num: 1 },
    { key: 'Location', nombre: NOMBRES_DE_HOJA_RED.location, num: 2 },
    { key: 'Customer', nombre: NOMBRES_DE_HOJA_RED.customer, num: 3 },
    { key: 'Location Source', nombre: NOMBRES_DE_HOJA_RED.locationSource, num: 4 },
    { key: 'Customer Source', nombre: NOMBRES_DE_HOJA_RED.customerSource, num: 5 },
  ]
  /** Los conteos por hoja (`STATS` de v7). */
  const STATS = {}
  sheetDefs.forEach((d) => {
    const hoja = informe.hojasWeb[d.nombre]
    STATS[d.key] = { total: hoja.total, red: hoja.red, yel: hoja.yel, ok: hoja.ok }
  })

  sheetDefs.forEach((d) => {
    const s = STATS[d.key]; if (!s) return
    const pct = porcentajeOk(s.total, s.ok)
    const fill = s.red > 0 ? C_RED : s.yel > 0 ? C_YEL : null
    informe.resumen.push({ nombre: d.nombre, clave: d.key, total: s.total, red: s.red, yel: s.yel, ok: s.ok, pct })
    S0.agregar([d.num, d.nombre, s.total, s.red, s.yel, s.ok, `${pct}%`], fill)
  })

  if (ejecucion) {
    // Inyectar conteo "analizado" (filas emitidas tras exclusiones de tipo de material) por entidad
    ;(ejecucion.entidades || []).forEach((e) => {
      if (e.statKey && STATS[e.statKey]) e.analyzed = STATS[e.statKey].total
    })
    bloquesDeResumen(S0, {
      analyzer: informe.analizador,
      generatedAt: ejecucion.generadoEl,
      fileName: archivo,
      cfg: conexion,
      paFilter: ejecucion.filtro,
      entities: ejecucion.entidades,
      mattypeCfg: MATTYPE_CFG,
      kpis: [
        { label: 'Total productos analizados', value: n.toLocaleString('es-CL') },
        { label: 'Productos con red completa', value: completeCount.toLocaleString('es-CL') },
        { label: 'Total rutas planta → cliente', value: totalPaths.toLocaleString('es-CL') },
        { label: 'Ghost nodes detectados', value: ghostCount.toLocaleString('es-CL') },
        { label: 'Health Score promedio', value: `${n > 0 ? Math.round(healthSum / n) : 0} / 100` },
      ],
    })
  }

  /* ── Llenar hoja Estadísticas (lee las tablas por cursor) ── */
  try {
    await construirEstadisticasRed(statsWs, {
      idx: { prdLookup, locLookup, custLookup, pshPrds, psiCompPrds },
      fuente,
      extras,
    })
  } catch (e) {
    registrar('warn', `Hoja Estadísticas omitida: ${e && e.message}`)
  }

  onProgress(97)

  informe.totales = {
    totalProducts: n,
    completeProducts: completeCount,
    totalPaths,
    ghostNodes: ghostCount,
    avgHealthScore: avgHealth,
  }
  return informe
}
