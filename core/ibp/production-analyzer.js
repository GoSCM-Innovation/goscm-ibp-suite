// Production Analyzer de v7: el análisis de la jerarquía de producción, idéntico.
//
// Portado LITERAL de `paAnalyzeAndExport` de `prodAnalyzer.js` de v7 (hojas 1436-2654), de `statsSheet.js`
// (`buildPA`) y de `runSummary.js` (`buildResumenMeta`). Es el algoritmo de v7 sin cambiar un criterio:
// las reglas por categoría, los estados Alerta / Advertencia / OK, los textos de cada observación, el
// orden de las filas y las columnas de cada hoja. Las variables conservan los nombres de v7 a propósito:
// quien compare con el original tiene que poder seguir cada línea.
//
// LO ÚNICO QUE CAMBIA es de dónde sale el dato y a dónde va el resultado:
//
//   - v7 leía IndexedDB dentro de la función; aquí `analizarProduccion` recibe los registros ya leídos
//     (`src/lib/production-analizar.js` los lee de la base local) y no toca el navegador.
//   - v7 escribía el Excel y capturaba la vista web con el DOM al lado; aquí se devuelve un `Informe`
//     (ver `analisis-hojas.js`) que leen el Excel y la vista web por separado.
//   - Los textos se escriben en español, que era la rama de v7 sin traducir. Donde v7 decía «Verificá»
//     aquí dice «Verifica» (regla del proyecto: español neutro).
//
// REGLAS DE v7 QUE CONVIENE SABER ANTES DE LEER EL CÓDIGO:
//
//   - Un producto sin `MATTYPEID` no se analiza en la hoja Product: sin tipo de material no hay qué
//     exigirle (`if (!mattypeid) return`). Tampoco aparece como salida en PSH / PSI.
//   - Un tipo excluido no se analiza como producto, pero SÍ se valida como componente de los productos
//     incluidos, y la hoja «Tipos Excluidos» cuenta cuántas combinaciones componente-planta no tienen arco.
//   - La severidad de un producto es la MÁS GRAVE de sus hallazgos; las reglas que le tocan salen de
//     `mattype-config.js` y con varias categorías gana la más permisiva.
//   - Hay hallazgos `info` en la hoja Location (una ubicación sin actividad): salen como OK. v7 no
//     tiene un cuarto estado.
//
// Sin dependencias del navegador: lo usan la pantalla, las pruebas y quien lo necesite en el servidor.

import {
  COLORES,
  codigos as codes,
  crearHojaDeTabla,
  crearHojaLibre,
  etiquetaDeRelleno as statusLabel,
  porcentajeOk,
} from './analisis-hojas.js'
import {
  MATTYPE_CATS,
  TEXTOS_DE_CATEGORIA,
  categoriasDe as mattypeGetCategories,
  estaExcluido as mattypeIsExcluded,
  reglasDeCategorias as mattypeGetRules,
} from './mattype-config.js'

const { C_RED, C_YEL } = COLORES

/** Un valor de SAP como texto limpio (`str` de `utils.js`). */
const str = (v) => (v === null || v === undefined ? '' : String(v).trim())

/** Un objeto sin prototipo: un PRDID llamado «constructor» no tiene que pisar nada. */
const dict = () => Object.create(null)

const yn = (b) => (b ? 'Si' : 'No')

/** Los nombres de las hojas, literales de `xls.sheet.*` de v7. */
export const NOMBRES_DE_HOJA = Object.freeze({
  summary: 'Resumen',
  product: 'Product',
  location: 'Location',
  resource: 'Resource',
  resourceLocation: 'Resource Location',
  prodSrcHeader: 'Prod Source Header',
  prodSrcItem: 'Prod Source Item',
  prodSrcResource: 'Prod Source Resource',
  excludedTypes: 'Tipos Excluidos',
  stats: 'Estadísticas',
})

/** Las siete entidades que admiten campos adicionales y dónde se insertan (`efInjectHeaders` de v7). */
export const ENTIDADES_CON_EXTRAS = Object.freeze([
  { clave: 'product', etiqueta: 'Product', despuesDe: 4 },
  { clave: 'location', etiqueta: 'Location', despuesDe: 4 },
  { clave: 'resource', etiqueta: 'Resource', despuesDe: 3 },
  { clave: 'resourceLocation', etiqueta: 'Resource Location', despuesDe: 5 },
  { clave: 'psh', etiqueta: 'Prod Source Header', despuesDe: 11 },
  { clave: 'psi', etiqueta: 'Prod Source Item', despuesDe: 11 },
  { clave: 'psr', etiqueta: 'Prod Source Resource', despuesDe: 9 },
])

/** Campos obligatorios que se muestran en el Excel de cada entidad (`EF_MAND_VISIBLE.pa`). */
export const CAMPOS_OBLIGATORIOS = Object.freeze({
  product: ['PRDID', 'PRDDESCR', 'MATTYPEID'],
  location: ['LOCID', 'LOCDESCR', 'LOCTYPE'],
  resource: ['RESID', 'RESDESCR'],
  resourceLocation: ['RESID', 'LOCID'],
  psh: ['SOURCEID', 'PRDID', 'LOCID', 'SOURCETYPE', 'PLEADTIME', 'OUTPUTCOEFFICIENT', 'PRATIO'],
  psi: ['SOURCEID', 'PRDID', 'COMPONENTCOEFFICIENT', 'ISALTITEM'],
  psr: ['SOURCEID', 'RESID'],
})

/** Campos técnicos de filtro: siempre en el `$select`, nunca en el informe (`EF_MAND_HIDDEN.pa`). */
export const CAMPOS_OCULTOS = Object.freeze({
  product: [],
  location: ['LOCVALID'],
  resource: [],
  resourceLocation: [],
  psh: ['PINVALID'],
  psi: [],
  psr: [],
})

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
// Hoja Estadísticas (statsSheet.js · buildPA)
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const FILL_GRAY = COLORES.NA_FILL

function construirEstadisticas(ws, ctx) {
  const PRD = ctx.prd || {}; const LOC = ctx.loc || {}; const RES = ctx.res || {}
  const pshBySid = ctx.pshBySid || {}
  const pshByPrdLoc = ctx.pshByPrdLoc || {}
  const pshPrdSetP = ctx.pshPrdSetP || {}
  const psiPrdSet = ctx.psiPrdSet || new Set()
  const psiBySid = ctx.psiBySourceid || {}
  const psrBySid = ctx.psrBySourceid || {}
  const psrResidSet = ctx.psrResidSet || new Set()
  const allPsi = ctx.allPsi || []
  const extras = ctx.extras || {}
  const pm = (id) => { const p = PRD[id] || {}; return str(p.MATTYPEID || '') }
  const lct = (id) => { const l = LOC[id] || {}; return str(l.LOCTYPE || '') }

  // Primitivas de render
  const blank = () => ws.agregar([])
  const title = (text) => ws.agregar([text])
  const row = (cells, argb) => ws.agregar(cells, argb || null)
  const banner = (text) => ws.agregar([text], FILL_GRAY)
  const header = (cells) => ws.agregar(cells, FILL_GRAY)
  const table = (opts) => {
    if (opts.banner) banner(opts.banner)
    if (opts.headers) header(opts.headers)
    ;(opts.rows || []).forEach((rw) => { row(rw, rw && rw._fill) })
    blank()
  }
  const pctStr = (n, total) => `${total > 0 ? Math.round((n / total) * 100) : 0}%`
  const nkeys = (o) => (o ? Object.keys(o).length : 0)
  const avg1 = (sum, n) => (n > 0 ? Math.round((sum / n) * 10) / 10 : 0)
  const objVals = (o) => Object.keys(o || {}).map((k) => o[k])
  const grayTotal = (arr) => { arr._fill = FILL_GRAY; return arr }

  const valueCounts = (recs, field) => {
    const out = {}
    recs.forEach((r) => {
      let v = str(r && r[field] != null ? r[field] : '')
      if (v === '') v = '(vacío)'
      out[v] = (out[v] || 0) + 1
    })
    return out
  }

  const renderFrequency = (recs, field, maxRows) => {
    const counts = valueCounts(recs, field)
    const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a])
    const total = recs.length
    banner(`Distribución de ${field}`)
    header([field, 'Registros', '% del total'])
    keys.slice(0, maxRows).forEach((k) => { row([k, counts[k], pctStr(counts[k], total)]) })
    if (keys.length > maxRows) {
      let restN = 0
      keys.slice(maxRows).forEach((k) => { restN += counts[k] })
      row([`Otros (${keys.length - maxRows})`, restN, pctStr(restN, total)])
    }
    blank()
  }

  const renderCrosstab = (recs, dimFn, dimLabel, field, maxRows = 30, maxCols = 15) => {
    const fieldTot = {}; const dimTot = {}; const cell = {}
    recs.forEach((r) => {
      let fv = str(r && r[field] != null ? r[field] : ''); if (fv === '') fv = '(vacío)'
      const dv = dimFn(r)
      fieldTot[fv] = (fieldTot[fv] || 0) + 1
      dimTot[dv] = (dimTot[dv] || 0) + 1
      const k = `${fv}\u0001${dv}`
      cell[k] = (cell[k] || 0) + 1
    })

    const dimKeys = Object.keys(dimTot).sort((a, b) => dimTot[b] - dimTot[a])
    const dimShown = dimKeys.slice(0, maxCols); const dimRest = dimKeys.slice(maxCols)
    const hasDimRest = dimRest.length > 0
    const fieldKeys = Object.keys(fieldTot).sort((a, b) => fieldTot[b] - fieldTot[a])
    const fieldShown = fieldKeys.slice(0, maxRows); const fieldRest = fieldKeys.slice(maxRows)
    const hasFieldRest = fieldRest.length > 0

    const cnt = (fv, dv) => cell[`${fv}\u0001${dv}`] || 0

    banner(`${field} × ${dimLabel}`)
    const hdr = [field].concat(dimShown)
    if (hasDimRest) hdr.push('Otros')
    hdr.push('Total')
    header(hdr)

    const colTot = {}; let otrosCol = 0; let grand = 0
    dimShown.forEach((dv) => { colTot[dv] = 0 })

    const emitRow = (label, fvs) => {
      const arr = [label]; let rt = 0
      dimShown.forEach((dv) => {
        let c = 0; fvs.forEach((fv) => { c += cnt(fv, dv) })
        arr.push(c); colTot[dv] += c; rt += c
      })
      if (hasDimRest) {
        let co = 0; fvs.forEach((fv) => { dimRest.forEach((dv) => { co += cnt(fv, dv) }) })
        arr.push(co); otrosCol += co; rt += co
      }
      arr.push(rt); grand += rt
      row(arr)
    }

    fieldShown.forEach((fv) => { emitRow(fv, [fv]) })
    if (hasFieldRest) emitRow(`Otros (${fieldRest.length})`, fieldRest)

    const totArr = ['Total']
    dimShown.forEach((dv) => { totArr.push(colTot[dv]) })
    if (hasDimRest) totArr.push(otrosCol)
    totArr.push(grand)
    row(totArr, FILL_GRAY)
    blank()
  }

  const renderExtraFields = (entity, recs, dimFn, dimLabel) => {
    const extra = extras[entity] ?? []
    if (!extra.length) return 0
    extra.forEach((f) => {
      if (dimFn) renderCrosstab(recs, dimFn, dimLabel, f)
      else renderFrequency(recs, f, 25)
    })
    return extra.length
  }

  const prdIds = Object.keys(PRD); const totalPrd = prdIds.length
  const sidIds = Object.keys(pshBySid); const totalSid = sidIds.length

  title('Estadísticas — Production Hierarchy')
  blank()

  /* PRODUCT — composición por tipo de material */
  const byMt = {}
  prdIds.forEach((prd) => {
    const mt = pm(prd) || '(sin tipo)'
    if (!byMt[mt]) byMt[mt] = { n: 0, out: 0, comp: 0, both: 0, none: 0 }
    const isOut = !!pshPrdSetP[prd]
    const isComp = psiPrdSet.has ? psiPrdSet.has(prd) : false
    byMt[mt].n++
    if (isOut && isComp) byMt[mt].both++
    else if (isOut) byMt[mt].out++
    else if (isComp) byMt[mt].comp++
    else byMt[mt].none++
  })
  const tot = { n: 0, out: 0, comp: 0, both: 0, none: 0 }
  const mtRows = Object.keys(byMt).sort().map((mt) => {
    const d = byMt[mt]
    tot.n += d.n; tot.out += d.out; tot.comp += d.comp; tot.both += d.both; tot.none += d.none
    return [mt, d.n, d.out, d.comp, d.both, d.none, pctStr(d.n, totalPrd)]
  })
  mtRows.push(grayTotal(['TOTAL', tot.n, tot.out, tot.comp, tot.both, tot.none, pctStr(tot.n, totalPrd)]))
  table({
    banner: 'PRODUCTO — Composición del maestro por tipo de material',
    headers: ['Tipo de material', 'Productos', 'Solo output (PSH)',
      'Solo componente (PSI)', 'Output + componente', 'Sin uso en estructura', '% maestro'],
    rows: mtRows,
  })

  /* RECETAS — tamaño de BOM */
  let nEmpty = 0; let b15 = 0; let b610 = 0; let b1120 = 0; let b21 = 0
  let sumComp = 0; let maxComp = 0; let withBom = 0
  sidIds.forEach((sid) => {
    const n = (psiBySid[sid] || []).length
    sumComp += n; if (n > maxComp) maxComp = n
    if (n === 0) nEmpty++
    else {
      withBom++
      if (n <= 5) b15++; else if (n <= 10) b610++; else if (n <= 20) b1120++; else b21++
    }
  })
  table({
    banner: 'RECETAS — Tamaño de BOM (componentes por receta)',
    headers: ['Componentes por receta', 'Recetas', '% del total'],
    rows: [
      ['0 (BOM vacío)', nEmpty, pctStr(nEmpty, totalSid)],
      ['1-5', b15, pctStr(b15, totalSid)],
      ['6-10', b610, pctStr(b610, totalSid)],
      ['11-20', b1120, pctStr(b1120, totalSid)],
      ['21+', b21, pctStr(b21, totalSid)],
      grayTotal(['TOTAL', totalSid, '100%']),
    ],
  })
  table({
    headers: ['Métrica de BOM', 'Valor'],
    rows: [
      ['Promedio de componentes por receta', avg1(sumComp, totalSid)],
      ['Promedio en recetas con BOM', avg1(sumComp, withBom)],
      ['Máximo de componentes en una receta', maxComp],
    ],
  })

  /* RECETAS — PLEADTIME */
  let pl0 = 0; let pl15 = 0; let pl615 = 0; let pl16 = 0; let plSum = 0; let plN = 0
  sidIds.forEach((sid) => {
    const recs = pshBySid[sid] || []; let prim = null
    for (let i = 0; i < recs.length; i++) { if (recs[i].SOURCETYPE === 'P') { prim = recs[i]; break } }
    if (!prim) prim = recs[0] || {}
    const n = parseFloat(str(prim.PLEADTIME || ''))
    if (!(n > 0)) pl0++
    else {
      plSum += n; plN++
      if (n <= 5) pl15++; else if (n <= 15) pl615++; else pl16++
    }
  })
  table({
    banner: 'RECETAS — Lead time de producción (PLEADTIME)',
    headers: ['PLEADTIME (días)', 'SOURCEIDs', '% del total'],
    rows: [
      ['0 / no definido', pl0, pctStr(pl0, totalSid)],
      ['1-5', pl15, pctStr(pl15, totalSid)],
      ['6-15', pl615, pctStr(pl615, totalSid)],
      ['16+', pl16, pctStr(pl16, totalSid)],
      ['Promedio (definidos > 0)', avg1(plSum, plN), ''],
    ],
  })

  /* RECETAS — multi-fuente y sustitutos */
  const plKeys = Object.keys(pshByPrdLoc)
  const multi = plKeys.filter((k) => pshByPrdLoc[k].length > 1).length
  let subRecs = 0; const subSids = {}
  allPsi.forEach((r) => {
    if (str(r.ISALTITEM || '') === 'X') { subRecs++; subSids[str(r.SOURCEID)] = true }
  })
  table({
    banner: 'RECETAS — Multi-fuente y sustitutos',
    headers: ['Métrica', 'Valor'],
    rows: [
      ['Combinaciones producto-planta con múltiples recetas', multi],
      ['% de combinaciones multi-receta', pctStr(multi, plKeys.length)],
      ['Recetas con componentes sustitutos (ISALTITEM=X)', nkeys(subSids)],
      ['Componentes marcados como sustituto', subRecs],
    ],
  })

  /* UBICACIONES — LOCTYPE */
  const locIds = Object.keys(LOC); const totalLoc = locIds.length; const byLt = {}
  locIds.forEach((l) => { const t = lct(l) || '(sin LOCTYPE)'; byLt[t] = (byLt[t] || 0) + 1 })
  const ltRows = Object.keys(byLt).sort().map((t) => [t, byLt[t], pctStr(byLt[t], totalLoc)])
  ltRows.push(grayTotal(['TOTAL', totalLoc, '100%']))
  table({
    banner: 'UBICACIONES — Composición por tipo (LOCTYPE)',
    headers: ['LOCTYPE', 'Ubicaciones', '% del total'],
    rows: ltRows,
  })

  /* UBICACIONES — producción por planta */
  const recipesByPlant = {}; const productsByPlant = {}; const mfgProducts = {}
  sidIds.forEach((sid) => {
    const recs = pshBySid[sid] || []; let prim = null
    for (let i = 0; i < recs.length; i++) { if (recs[i].SOURCETYPE === 'P') { prim = recs[i]; break } }
    if (!prim) prim = recs[0] || {}
    const loc = str(prim.LOCID || ''); const prd = str(prim.PRDID || '')
    if (loc) {
      recipesByPlant[loc] = (recipesByPlant[loc] || 0) + 1
      if (prd) { (productsByPlant[loc] || (productsByPlant[loc] = {}))[prd] = true }
    }
    if (prd) mfgProducts[prd] = true
  })
  const plantKeys = Object.keys(recipesByPlant); const nPlants = plantKeys.length
  let maxRecipes = 0; let sumProdPerPlant = 0
  plantKeys.forEach((l) => {
    if (recipesByPlant[l] > maxRecipes) maxRecipes = recipesByPlant[l]
    sumProdPerPlant += nkeys(productsByPlant[l])
  })
  table({
    banner: 'UBICACIONES — Producción por planta',
    headers: ['Métrica', 'Valor'],
    rows: [
      ['Plantas que fabrican (con PSH)', nPlants],
      ['% sobre total de ubicaciones', pctStr(nPlants, totalLoc)],
      ['Productos distintos fabricados', nkeys(mfgProducts)],
      ['Recetas (SOURCEIDs) totales', totalSid],
      ['Promedio de recetas por planta', avg1(totalSid, nPlants)],
      ['Promedio de productos distintos por planta', avg1(sumProdPerPlant, nPlants)],
      ['Máximo de recetas en una planta', maxRecipes],
    ],
  })
  let rp15 = 0; let rp620 = 0; let rp2150 = 0; let rp51 = 0
  plantKeys.forEach((l) => {
    const n = recipesByPlant[l]
    if (n <= 5) rp15++; else if (n <= 20) rp620++; else if (n <= 50) rp2150++; else rp51++
  })
  table({
    banner: 'UBICACIONES — Distribución de recetas por planta',
    headers: ['Recetas por planta', 'Plantas', '% del total'],
    rows: [
      ['1-5', rp15, pctStr(rp15, nPlants)],
      ['6-20', rp620, pctStr(rp620, nPlants)],
      ['21-50', rp2150, pctStr(rp2150, nPlants)],
      ['51+', rp51, pctStr(rp51, nPlants)],
    ],
  })

  /* RECURSOS */
  const totalRes = Object.keys(RES).length
  const usedRes = psrResidSet.size || 0
  const psrSids = Object.keys(psrBySid); let sumResPerRecipe = 0
  psrSids.forEach((sid) => { sumResPerRecipe += psrBySid[sid].length })
  const sidsNoPsr = sidIds.filter((sid) => !psrBySid[sid]).length
  table({
    banner: 'RECURSOS — Uso en producción',
    headers: ['Métrica', 'Valor'],
    rows: [
      ['Recursos en el maestro', totalRes],
      ['Recursos usados en PSR', usedRes],
      ['Recursos sin uso en PSR (ociosos)', Math.max(0, totalRes - usedRes)],
      ['Promedio de recursos por receta', avg1(sumResPerRecipe, psrSids.length)],
      ['Recetas sin recurso asignado', sidsNoPsr],
    ],
  })

  /* CRUCES por campos adicionales */
  banner('CRUCES POR CAMPOS ADICIONALES')
  blank()
  let nX = 0
  nX += renderExtraFields('product', objVals(PRD),
    (r) => str(r.MATTYPEID || '') || '(sin tipo)', 'Tipo de material')
  nX += renderExtraFields('location', objVals(LOC),
    (r) => str(r.LOCTYPE || '') || '(sin LOCTYPE)', 'LOCTYPE')
  nX += renderExtraFields('resource', objVals(RES))
  if (!nX) row(['No se seleccionaron campos adicionales. Agrégalos en el paso "Campos adicionales" para ver cruces aquí.'])
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Bloques de metadatos bajo la hoja Resumen (runSummary.js · buildResumenMeta)
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Los bloques que v7 añade DEBAJO de la tabla de la hoja Resumen: ejecución, conexión, entidades,
 * tipos de material y métricas globales. Los textos son `xls.resumen.*` de v7, literales (sin
 * tildes: así están en el original y es lo que ven los clientes).
 */
export function bloquesDeResumen(hoja, opts) {
  const secRow = (label) => hoja.agregarLibre([label], COLORES.NA_FILL)
  const kvRow = (label, value) => hoja.agregarLibre([label, value != null ? String(value) : '—'])

  hoja.agregarLibre([])

  const _lang = 'es-CL'

  /* ── Bloque 1: Informacion de la ejecucion ── */
  secRow('INFORMACION DE LA EJECUCION')
  const dt = opts.generatedAt || new Date()
  kvRow('Generado el', dt.toLocaleString(_lang))
  kvRow('Analizador', opts.analyzer || '—')
  kvRow('Archivo Excel', opts.fileName || '—')

  /* ── Bloque 2: Conexion SAP IBP ── */
  hoja.agregarLibre([])
  secRow('CONEXION SAP IBP')
  const cfg = opts.cfg || {}
  kvRow('API Base URL', cfg.url || '—')
  kvRow('Planning Area ID', cfg.pa || '—')
  kvRow('Version', cfg.pver || '(Baseline)')
  kvRow('Filtro OData aplicado', opts.paFilter || '(sin filtro de PA/Version)')

  /* ── Bloque 3: Entidades OData utilizadas ── */
  hoja.agregarLibre([])
  const ents = opts.entities || []
  secRow(`ENTIDADES ODATA UTILIZADAS (${ents.length})`)
  if (ents.length === 0) {
    kvRow('(sin entidades registradas)', '')
  } else {
    ents.forEach((e) => {
      const label = e.entityName ? `${e.name} [${e.entityName}]` : e.name
      if (e.downloaded == null) { kvRow(label, 'n/a'); return }
      const steps = [`${e.downloaded.toLocaleString(_lang)} registros descargados`]
      let prev = e.downloaded
      if (e.retained != null && e.retained !== prev) {
        let ret = `${e.retained.toLocaleString(_lang)} retenidos tras filtros automaticos`
        if (e.note) ret += ` (${e.note})`
        steps.push(ret)
        prev = e.retained
      }
      if (e.analyzed != null && e.analyzed !== prev) {
        steps.push(`${e.analyzed.toLocaleString(_lang)} analizados`)
      }
      let detail = steps.join(' → ')
      if (e.note && !(e.retained != null && e.retained !== e.downloaded)) detail += ` — ${e.note}`
      kvRow(label, detail)
    })
  }

  /* ── Bloque 4: Tipos de material ── */
  const mc = opts.mattypeCfg || {}
  const mtKeys = Object.keys(mc).sort()
  if (mtKeys.length) {
    hoja.agregarLibre([])
    const incl = mtKeys.filter((k) => !mc[k].excluded)
    const excl = mtKeys.filter((k) => mc[k].excluded)
    const catted = incl.filter((k) => mc[k].categories && mc[k].categories.size > 0)
    secRow(`TIPOS DE MATERIAL — ${mtKeys.length} detectados | ${incl.length} incluidos | ${excl.length} excluidos | ${catted.length} categorizados`)

    if (incl.length) {
      hoja.agregarLibre(['Tipos incluidos en el analisis', 'Productos', 'Categorias asignadas'])
      incl.forEach((mt) => {
        const c = mc[mt]
        const cats = (c.categories && c.categories.size > 0)
          ? Array.from(c.categories).map((id) => {
            const found = MATTYPE_CATS.filter((x) => x.id === id)
            return found.length ? TEXTOS_DE_CATEGORIA[found[0].id].label : id
          }).join(', ')
          : 'Sin categoria — reglas permisivas (⚠)'
        hoja.agregarLibre([mt, `${c.count || 0} prods`, cats])
      })
    }

    if (excl.length) {
      hoja.agregarLibre([])
      hoja.agregarLibre(['Tipos excluidos del analisis principal', 'Productos omitidos', ''])
      excl.forEach((mt) => {
        hoja.agregarLibre([mt, `${mc[mt].count || 0} prods`, ''])
      })
    }
  }

  /* ── Bloque 5: Metricas globales ── */
  const kpis = opts.kpis || []
  if (kpis.length) {
    hoja.agregarLibre([])
    secRow('METRICAS GLOBALES DE LA EJECUCION')
    kpis.forEach((kpi) => { kvRow(kpi.label, kpi.value) })
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// El análisis
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Cede el hilo para que la pantalla pueda dibujar entre hoja y hoja. */
const cederPorDefecto = () => Promise.resolve()

/**
 * Corre el análisis de v7 sobre lo descargado y devuelve el informe.
 *
 * `entrada`:
 *
 *   ent         qué entidades están mapeadas: `{ prd, loc, res, resLoc, psh, psi, psiSub, psr, locPrd,
 *               locSrc }`, cada una verdadera si hay tabla. Como en v7, una hoja se omite si falta la
 *               suya (`if (ent.prd)`…).
 *   prd         `{ PRDID: registro }`        el maestro de productos (el último gana).
 *   loc         `{ LOCID: registro }`        el maestro de ubicaciones, sin las `LOCVALID = X`.
 *   res         `{ RESID: registro }`        el maestro de recursos.
 *   resLoc      `{ RESID: [{ LOCID, …extras }] }`
 *   pshBySid    `{ SOURCEID: [{ PRDID, LOCID, SOURCETYPE, PLEADTIME, OUTPUTCOEFFICIENT, PRATIO, …extras }] }`
 *               sin las `PINVALID = X`.
 *   pshPrdSet   `{ PRDID: true }`            los productos que aparecen en alguna cabecera.
 *   psi, psiSub, psr, locProd, locSrc   listas de registros (psi/psiSub/psr ya atadas a las cabeceras
 *               vivas; locSrc sin las `TINVALID = X`).
 *   tipos       la configuración de tipos de material de v7 (`mattype-config.js`).
 *   extras      los campos adicionales por entidad, `{ product: ['CAMPO'], … }`.
 *   conexion    `{ url, pa, pver }` para el bloque «CONEXION SAP IBP» del Resumen.
 *   ejecucion   `{ generadoEl: Date, filtro, entidades: [...] }` el bloque «ENTIDADES ODATA».
 *   hoy         `AAAA-MM-DD`, para el nombre del archivo.
 *   alAvanzar(texto, pct)  línea de estado y porcentaje, con los textos y los números de v7.
 *   registrar(clase, texto)  una línea del registro técnico.
 *   ceder()     devuelve una promesa que cede el hilo.
 */
export async function analizarProduccion(entrada) {
  const {
    ent = {}, prd: PA_PRD = dict(), loc: PA_LOC = dict(), res: PA_RES = dict(), resLoc: PA_RES_LOC = dict(),
    pshBySid = dict(), pshPrdSet = dict(),
    psi: allPsi = [], psiSub: allPsiSub = [], psr: allPsr = [],
    locProd: allLocProd = [], locSrc: allLocSrc = [],
    tipos: MATTYPE_CFG = {},
    extras = {},
    conexion = {},
    ejecucion = null,
    hoy = new Date().toISOString().slice(0, 10),
    alAvanzar = () => {},
    registrar = () => {},
    ceder = cederPorDefecto,
  } = entrada

  const setStatusPA = (msg, pct) => alAvanzar(msg, pct)

  /* ── Helpers de lookup ── */
  const pd = (id) => { const p = PA_PRD[id] || {}; return str(p.PRDDESCR || '') }
  const pm = (id) => { const p = PA_PRD[id] || {}; return str(p.MATTYPEID || '') }
  const ld = (id) => { const l = PA_LOC[id] || {}; return str(l.LOCDESCR || '') }
  const rd = (id) => { const r = PA_RES[id] || {}; return str(r.RESDESCR || '') }

  const getCategories = (mt) => mattypeGetCategories(MATTYPE_CFG, mt)
  const isExcluded = (mt) => mattypeIsExcluded(MATTYPE_CFG, mt)

  /* ── PHASE A: cargar a memoria ── */
  setStatusPA('Cargando datos desde IndexedDB...', 75)
  registrar('ok', `IDB cargado — LocProd:${allLocProd.length} LocSrc:${allLocSrc.length} PSI:${allPsi.length}`)

  /* ── PHASE B: construir índices ── */
  setStatusPA('Construyendo índices...', 77)

  /* PSH */
  const pshByPrdLoc = dict() // "PRDID|LOCID" → [SOURCEID] SOURCETYPE=P
  const pshSidLocid = dict() // SOURCEID → { LOCID, PRDID }
  const pshSidHasP = dict()
  const pshPrdSetP = dict()
  Object.keys(pshBySid).forEach((sid) => {
    const recs = pshBySid[sid]
    const primary = recs.find((r) => r.SOURCETYPE === 'P') || recs[0]
    pshSidLocid[sid] = { LOCID: primary.LOCID, PRDID: primary.PRDID }
    pshSidHasP[sid] = recs.some((r) => r.SOURCETYPE === 'P')
    recs.forEach((r) => {
      if (r.SOURCETYPE !== 'P' || !r.PRDID || !r.LOCID) return
      const k = `${r.PRDID}|${r.LOCID}`
      if (!pshByPrdLoc[k]) pshByPrdLoc[k] = []
      pshByPrdLoc[k].push(sid)
      pshPrdSetP[r.PRDID] = true
    })
  })

  /* PSI */
  const psiPrdSet = new Set()
  const psiBySourceid = dict()
  const psiCompByLocPrd = dict() // "LOCID|PRDID(comp)" → true — componente en esta planta
  allPsi.forEach((r) => {
    const sid = str(r.SOURCEID); const prd = str(r.PRDID || '')
    if (prd) psiPrdSet.add(prd)
    if (sid) { if (!psiBySourceid[sid]) psiBySourceid[sid] = []; psiBySourceid[sid].push(r) }
    const info = pshSidLocid[sid] || {}
    if (info.LOCID && prd) psiCompByLocPrd[`${info.LOCID}|${prd}`] = true
  })

  /* PSI Sub */
  const psiSubBySprdfr = dict()
  allPsiSub.forEach((r) => {
    const sprdfr = str(r.SPRDFR || ''); const prdfr = str(r.PRDFR || '')
    if (sprdfr && prdfr) {
      if (!psiSubBySprdfr[sprdfr]) psiSubBySprdfr[sprdfr] = []
      if (psiSubBySprdfr[sprdfr].indexOf(prdfr) < 0) psiSubBySprdfr[sprdfr].push(prdfr)
    }
  })

  /* PSR */
  const psrResidSet = new Set()
  const psrByResidLoc = new Set()
  const psrBySourceid = dict()
  allPsr.forEach((r) => {
    const sid = str(r.SOURCEID); const resid = str(r.RESID || '')
    if (resid) psrResidSet.add(resid)
    if (sid) {
      if (!psrBySourceid[sid]) psrBySourceid[sid] = []
      psrBySourceid[sid].push(r)
      if (pshSidLocid[sid] && pshSidLocid[sid].LOCID && resid) {
        psrByResidLoc.add(`${resid}|${pshSidLocid[sid].LOCID}`)
      }
    }
  })

  /* Location Product */
  const locPrdSet = new Set() // "LOCID|PRDID"
  const locPrdPrdSet = new Set()
  allLocProd.forEach((r) => {
    const loc = str(r.LOCID); const prd = str(r.PRDID)
    if (loc && prd) { locPrdSet.add(`${loc}|${prd}`); locPrdPrdSet.add(prd) }
  })

  /* Location Source */
  const locSrcByPrdLoc = dict() // "PRDID|LOCID(dest)" → [{LOCFR, TLEADTIME}]
  const locSrcByPrdLocfr = new Set() // "PRDID|LOCFR(orig)"
  const locSrcPrdSet = new Set()
  const locSrcByLocfr = dict() // LOCFR → [{PRDID, LOCID}]
  const locSrcByLocid = dict() // LOCID → [{PRDID, LOCFR}]
  const locSrcOrigByPrd = dict() // PRDID → Set<LOCFR> — orígenes en red
  allLocSrc.forEach((r) => {
    const prd = str(r.PRDID); const locfr = str(r.LOCFR || ''); const locid = str(r.LOCID || '')
    const tlt = str(r.TLEADTIME || '')
    if (prd) locSrcPrdSet.add(prd)
    if (prd && locfr) {
      if (!locSrcOrigByPrd[prd]) locSrcOrigByPrd[prd] = new Set()
      locSrcOrigByPrd[prd].add(locfr)
    }
    if (prd && locid) {
      const k = `${prd}|${locid}`
      if (!locSrcByPrdLoc[k]) locSrcByPrdLoc[k] = []
      locSrcByPrdLoc[k].push({ LOCFR: locfr, TLEADTIME: tlt })
    }
    if (prd && locfr) locSrcByPrdLocfr.add(`${prd}|${locfr}`)
    if (locfr) {
      if (!locSrcByLocfr[locfr]) locSrcByLocfr[locfr] = []
      locSrcByLocfr[locfr].push({ PRDID: prd, LOCID: locid })
    }
    if (locid) {
      if (!locSrcByLocid[locid]) locSrcByLocid[locid] = []
      locSrcByLocid[locid].push({ PRDID: prd, LOCFR: locfr })
    }
  })

  /* Índice LS por PRDID — para check de TLEADTIME */
  const locSrcRowsByPrd = dict()
  allLocSrc.forEach((r) => {
    const prd = str(r.PRDID)
    if (!prd) return
    if (!locSrcRowsByPrd[prd]) locSrcRowsByPrd[prd] = []
    locSrcRowsByPrd[prd].push(r)
  })

  /* Resource Location */
  const resLocSet = new Set()
  const resLocResidSet = new Set()
  Object.keys(PA_RES_LOC).forEach((resid) => {
    resLocResidSet.add(resid)
    PA_RES_LOC[resid].forEach((e) => { if (e.LOCID) resLocSet.add(`${resid}|${e.LOCID}`) })
  })

  /* ── Índices derivados para métricas ── */

  // PSH por producto: PRDID → [SOURCEID]
  const pshSidsByPrd = dict()
  // PSH por ubicación: LOCID → [SOURCEID]
  const pshSidsByLoc = dict()
  Object.keys(pshBySid).forEach((sid) => {
    const info = pshSidLocid[sid] || {}
    const prd = info.PRDID; const loc = info.LOCID
    if (prd) {
      if (!pshSidsByPrd[prd]) pshSidsByPrd[prd] = []
      if (pshSidsByPrd[prd].indexOf(sid) < 0) pshSidsByPrd[prd].push(sid)
    }
    if (loc) {
      if (!pshSidsByLoc[loc]) pshSidsByLoc[loc] = []
      if (pshSidsByLoc[loc].indexOf(sid) < 0) pshSidsByLoc[loc].push(sid)
    }
  })

  // Plantas por producto (distinct LOCIDs desde PSH SOURCETYPE=P)
  const plantsByPrd = dict()
  Object.keys(pshByPrdLoc).forEach((key) => {
    const prd = key.split('|')[0]; const loc = key.split('|')[1]
    if (!plantsByPrd[prd]) plantsByPrd[prd] = new Set()
    plantsByPrd[prd].add(loc)
  })

  // PSR recursos por producto (via SOURCEID → planta → PSH por planta → producto)
  const resByPrd = dict() // PRDID → Set of RESID
  const resByLoc = dict() // LOCID → Set of RESID (activos en PSR)
  allPsr.forEach((r) => {
    const sid = str(r.SOURCEID); const resid = str(r.RESID || '')
    if (!resid) return
    const info = pshSidLocid[sid] || {}
    if (info.PRDID) { if (!resByPrd[info.PRDID]) resByPrd[info.PRDID] = new Set(); resByPrd[info.PRDID].add(resid) }
    if (info.LOCID) { if (!resByLoc[info.LOCID]) resByLoc[info.LOCID] = new Set(); resByLoc[info.LOCID].add(resid) }
  })

  // Componentes por producto: PRDID(output) → count de PSI
  const psiCountByPrd = dict()
  allPsi.forEach((r) => {
    const sid = str(r.SOURCEID)
    const info = pshSidLocid[sid] || {}
    if (info.PRDID) psiCountByPrd[info.PRDID] = (psiCountByPrd[info.PRDID] || 0) + 1
  })

  // Productos que usan un PRDID como componente: comp → Set<output_prd>
  const usedByPrd = dict()
  allPsi.forEach((r) => {
    const comp = str(r.PRDID || '')
    const sid = str(r.SOURCEID)
    const info = pshSidLocid[sid] || {}
    if (comp && info.PRDID) {
      if (!usedByPrd[comp]) usedByPrd[comp] = new Set()
      usedByPrd[comp].add(info.PRDID)
    }
  })

  // Plantas que consumen un PRDID como componente PSI: comp → Set<LOCID>
  const consumedAtLoc = dict()
  allPsi.forEach((r) => {
    const comp = str(r.PRDID || '')
    const sid = str(r.SOURCEID)
    const info = pshSidLocid[sid] || {}
    if (comp && info.LOCID) {
      if (!consumedAtLoc[comp]) consumedAtLoc[comp] = new Set()
      consumedAtLoc[comp].add(info.LOCID)
    }
  })

  // Proveedores (LOCFR que abastecen un PRDID como componente PSI)
  const vendorsByComp = dict() // PRDID(comp) → Set<LOCFR>
  allLocSrc.forEach((r) => {
    const prd = str(r.PRDID); const locfr = str(r.LOCFR || ''); const locid = str(r.LOCID || '')
    if (!prd || !locfr || !locid) return
    if (psiCompByLocPrd[`${locid}|${prd}`]) {
      if (!vendorsByComp[prd]) vendorsByComp[prd] = new Set()
      vendorsByComp[prd].add(locfr)
    }
  })

  // Plantas consumidoras cubiertas por LocSrc para un componente
  function _coveredPlants(comp) {
    const consuming = consumedAtLoc[comp]
    if (!consuming) return { covered: new Set(), uncovered: new Set() }
    const covered = new Set(); const uncovered = new Set()
    consuming.forEach((loc) => {
      const k = `${comp}|${loc}`
      if (locSrcByPrdLoc[k] && locSrcByPrdLoc[k].length > 0) covered.add(loc)
      else uncovered.add(loc)
    })
    return { covered, uncovered }
  }

  // Orígenes en red para un PRDID (LOCFR en LocSrc), contra el índice precomputado.
  const _LS_NO_ORIGINS = new Set()
  const _originsInNet = (prd) => locSrcOrigByPrd[prd] || _LS_NO_ORIGINS

  /* ── Workbook setup ── */
  setStatusPA('Inicializando Excel...', 79)
  const archivo = `ProductionHierarchyAnalysis_${hoy}.xlsx`

  const informe = {
    titulo: 'Production Analyzer — vista web',
    analizador: 'Production Hierarchy Analyzer',
    archivo,
    generadoEl: hoy,
    hojas: [],
    resumen: [],
    estadisticas: [],
    nombreEstadisticas: NOMBRES_DE_HOJA.stats,
    orden: [],
    hojasWeb: {},
  }

  const hojaDeTabla = (cfg) => {
    const h = crearHojaDeTabla(cfg)
    informe.hojas.push(h)
    return h
  }
  /** Las hojas de análisis (no el Resumen) son las que ve la vista web. */
  const hojaDeAnalisis = (cfg) => {
    const h = hojaDeTabla(cfg)
    informe.orden.push(h.nombre)
    // La vista web lee la MISMA hoja que el Excel: no se copia, para no tener las filas dos veces.
    informe.hojasWeb[h.nombre] = h
    return h
  }

  /* ── Resumen (se llena al final) ── */
  const S0 = hojaDeTabla({
    nombre: NOMBRES_DE_HOJA.summary,
    color: 'FF34D399',
    encabezados: ['#', 'Hoja', 'Total registros', 'Alertas 🔴', 'Advertencias 🟡', 'OK ✅', '% Consistencia'],
    notas: [
      'Número de hoja en el libro.',
      'Nombre de la hoja analizada.',
      'Total de filas procesadas en esa hoja. Ej: 350 = se analizaron 350 productos.',
      'Registros con problema crítico que bloquea o distorsiona la planificación. Ej: producto sin PSH, BOM vacío, PLEADTIME = 0.',
      'Registros con dato incompleto o sospechoso que conviene revisar. Ej: recurso sin Resource Location, arco sin consumo PSI en destino.',
      'Registros sin hallazgos — todas las validaciones aplicables pasaron correctamente.',
      'Porcentaje de registros OK sobre el total. Fórmula: OK / Total × 100. Ej: 85 de 100 productos OK = 85%.',
    ],
    grupos: ['control', 'control', 'metric', 'metric', 'metric', 'metric', 'metric'],
  })

  /* ── HOJA: ESTADÍSTICAS ── */
  try {
    const statsWs = crearHojaLibre({
      nombre: NOMBRES_DE_HOJA.stats,
      color: 'FF29ABE2',
      capturar: (celdas) => { informe.estadisticas.push(celdas) },
    })
    informe.hojas.push(statsWs)
    construirEstadisticas(statsWs, {
      prd: PA_PRD,
      loc: PA_LOC,
      res: PA_RES,
      pshBySid,
      pshSidHasP,
      pshByPrdLoc,
      pshPrdSetP,
      psiPrdSet,
      psiBySourceid,
      psrBySourceid,
      psrResidSet,
      allPsi,
      extras,
    })
  } catch (e) {
    registrar('warn', `Hoja Estadísticas omitida: ${e && e.message}`)
  }

  const injH = (entity, after, h, n, g) => efInjectHeaders(extras, entity, after, h, n, g)
  const injR = (entity, after, row, rec) => efInjectRow(extras, entity, after, row, rec)

  /* ════════════════════════════════════════════════════════════════
     HOJA 1 — PRODUCT
     ════════════════════════════════════════════════════════════════ */
  if (ent.prd) {
    const _s1Hdrs = [
      'Estado', 'Observación',
      'PRDID', 'PRDDESCR', 'MATTYPEID',
      'En Location Product', 'En PSH (output)', 'En PSI (componente)', 'En Location Source',
      '# Opciones prod.', 'Opciones prod. (SOURCEIDs)',
      '# Plantas prod.', 'Plantas prod. (códigos)',
      '# Componentes BOM',
      '# Recursos prod.', 'Recursos prod. (códigos)',
      '# Proveedores', 'Proveedores (códigos)',
      '# Plantas cubiertas', 'Plantas cubiertas (códigos)',
      '# Plantas sin cobertura', 'Plantas sin cobertura (códigos)',
      '# Productos que lo usan', 'Productos que lo usan',
      '# Orígenes en red', 'Orígenes en red (códigos)',
      '# Plantas consumidoras', 'Plantas consumidoras (códigos)',
    ]
    const _s1Notes = [
      'Color de alerta: 🔴 Alerta = problema crítico que bloquea la planificación | 🟡 Advertencia = dato incompleto o sospechoso | ✅ OK = sin hallazgos.',
      'Detalle de cada validación. Si hay hallazgos, describe el problema concreto. Si el estado es OK, lista las validaciones que pasaron. Ej OK: "Habilitado en Location Product | Con PSH, PSI y PSR | Lead time definido en todos los SOURCEIDs".',
      'Código único del producto en SAP IBP (PRDID). Ej: PROD-001, MAT-A.',
      'Descripción del producto según el maestro de materiales. Ej: "Aceite refinado 1L".',
      'Tipo de material SAP asignado a este producto (MATTYPEID). Determina qué validaciones aplican. Ej: FERT = producto terminado, HALB = semielaborado, ROH = materia prima.',
      'Si / No — ¿El producto está registrado en al menos una ubicación en Location Product? Sin esto, IBP ignora el producto en la planificación. Ej: PROD-001 sin Location Product → no entra a ningún plan.',
      'Si / No — ¿El producto aparece como output principal (SOURCETYPE=P) en alguna fuente de producción (PSH)? Sin PSH no hay instrucciones de fabricación. Ej: PROD-001 con PSH en planta P001.',
      'Si / No — ¿Este producto es usado como ingrediente en el BOM de algún otro producto (PSI)? Ej: MAT-A = Sí porque es componente en el BOM de PROD-001.',
      'Si / No — ¿Este producto tiene al menos un arco de transferencia configurado en Location Source? Ej: MAT-A = Sí porque se transfiere de PROV-01 a P001.',
      'Cuántas recetas de producción distintas (SOURCEIDs) tienen a este producto como output principal. Ej: 2 = puede fabricarse de dos maneras diferentes.',
      'Códigos de las fuentes de producción (SOURCEIDs) donde este producto es el output. Ej: SRC-001, SRC-002.',
      'Número de plantas distintas donde se fabrica este producto. Ej: 3 = se produce en P001, P002 y P003.',
      'Códigos de las plantas de producción (LOCID) donde tiene PSH asociado. Ej: P001, P002.',
      'Total de componentes PSI definidos en todos sus BOMs. Ej: 5 = la suma de ingredientes en todas sus recetas de producción es 5.',
      'Número de recursos productivos (máquinas/líneas) asignados a sus recetas vía PSR. Ej: 2 = LINEA-01 y HORNO-A.',
      'Códigos de los recursos (RESID) asignados a sus fuentes de producción. Ej: LINEA-01, HORNO-A.',
      'Número de ubicaciones origen que abastecen este producto como insumo vía Location Source. Ej: 2 = llega desde PROV-01 y PROV-02.',
      'Códigos de las ubicaciones origen (LOCFR) que proveen este producto. Ej: PROV-01, PROV-02.',
      'Número de plantas consumidoras que tienen arco de abastecimiento configurado para este producto. Ej: 2 de 3 plantas cubiertas = OK.',
      'Códigos de las plantas que sí tienen arco de abastecimiento para este producto. Ej: P001, P002.',
      'Número de plantas consumidoras SIN arco de abastecimiento configurado para este producto. Si > 0: falta configurar Location Source. Ej: P003 consume MAT-A pero no tiene arco desde ningún proveedor → 🔴.',
      'Códigos de las plantas sin cobertura de abastecimiento. Ej: P003.',
      'Cuántos otros productos distintos requieren este material como componente en sus BOMs. Ej: 3 = MAT-A es ingrediente en PROD-001, PROD-002 y PROD-003.',
      'Códigos de los productos de salida (PRDID) que usan este material como componente PSI. Ej: PROD-001, PROD-002, PROD-003.',
      'Número de nodos origen distintos desde los que este producto puede ser recibido en la red. Ej: 2 = puede llegar desde PROV-01 o desde P002.',
      'Códigos de los nodos origen del producto en la red. Ej: PROV-01, P002.',
      'Número de plantas donde este producto es consumido como ingrediente en algún BOM. Ej: 2 = se usa como componente en P001 y P002.',
      'Códigos de las plantas donde este producto aparece como componente PSI. Ej: P001, P002.',
    ]
    const _s1Groups = [
      'control', 'control',
      'ibp', 'ibp', 'ibp',
      'flag', 'flag', 'flag', 'flag',
      'metric', 'detail',
      'metric', 'detail',
      'metric',
      'metric', 'detail',
      'metric', 'detail',
      'metric', 'detail',
      'metric', 'detail',
      'metric', 'detail',
      'metric', 'detail',
      'metric', 'detail',
    ]
    injH('product', 4, _s1Hdrs, _s1Notes, _s1Groups)
    const S1 = hojaDeAnalisis({
      nombre: NOMBRES_DE_HOJA.product, color: 'FF29ABE2', encabezados: _s1Hdrs, notas: _s1Notes, grupos: _s1Groups,
    })

    Object.keys(PA_PRD).sort().forEach((prdid) => {
      const mattypeid = pm(prdid)
      const cats = getCategories(mattypeid)
      const isExcl = isExcluded(mattypeid)
      if (isExcl) return // excluidos no se analizan aquí
      if (!mattypeid) return

      const rules = mattypeGetRules(cats)
      const isUncategorized = cats[0] === 'uncategorized'

      const inLP = locPrdPrdSet.has(prdid)
      const inPSH = !!pshPrdSetP[prdid]
      const inPSI = psiPrdSet.has(prdid)
      const inLS = locSrcPrdSet.has(prdid)

      /* Métricas producción */
      const sidsPrd = pshSidsByPrd[prdid] || []
      const plantsSet = plantsByPrd[prdid] || new Set()
      const resSet = resByPrd[prdid] || new Set()
      const compCount = psiCountByPrd[prdid] || 0

      /* Métricas abastecimiento */
      const vendorSet = vendorsByComp[prdid] || new Set()
      const covData = _coveredPlants(prdid)
      const usedBySet = usedByPrd[prdid] || new Set()
      const origins = _originsInNet(prdid)
      const consLocs = consumedAtLoc[prdid] || new Set()

      /* Validaciones según categoría */
      const obs = []
      const fills = []

      // Location Product — universal 🔴
      if (!inLP) { obs.push('Sin cobertura en Location Product'); fills.push('red') }

      // PSH + PSI + PSR como bloque
      const reqPSH = rules.requiresPSH
      if (reqPSH !== 'none') {
        if (!inPSH) {
          obs.push('Sin fuente de producción propia (PSH)')
          fills.push(reqPSH)
        } else {
          // Si tiene PSH, PSI y PSR son obligatorios al mismo nivel
          const hasPSI = inPSI || compCount > 0
          const hasPSR = resSet.size > 0
          if (!hasPSI) { obs.push('PSH sin componentes PSI'); fills.push(reqPSH) }
          if (!hasPSR) { obs.push('PSH sin recursos PSR asignados'); fills.push(reqPSH) }
        }
      }

      // LocSrc: planta PSH debe ser LOCFR
      if (rules.requiresPlantAsOrigin !== 'none' && inPSH) {
        const plantsArr = Array.from(plantsSet)
        const hasPlantAsOrigin = plantsArr.some((loc) => locSrcByPrdLocfr.has(`${prdid}|${loc}`))
        if (!hasPlantAsOrigin) {
          obs.push('Planta productora no es origen en Location Source')
          fills.push(rules.requiresPlantAsOrigin)
        }
      }

      // LocSrc: arco de compra llega a planta consumidora
      if (rules.requiresVendorArc !== 'none') {
        if (covData.uncovered.size > 0) {
          obs.push(`Sin arco de abastecimiento hacia: ${codes(covData.uncovered)}`)
          fills.push(rules.requiresVendorArc)
        } else if (!inLS) {
          obs.push('Sin arco de abastecimiento (no registrado en Location Source)')
          fills.push(rules.requiresVendorArc)
        }
      }

      // LocSrc: algún origen y destino (trading / finished)
      if (rules.requiresAnyOriginDest !== 'none') {
        if (!inLS) { obs.push('Sin arcos en Location Source'); fills.push(rules.requiresAnyOriginDest) }
      }

      // Semiterminado: validación específica de consumo y transferencia (7 casos)
      if (cats.indexOf('semi') >= 0 && inPSH) {
        const semiPlantsArr = Array.from(plantsSet)
        const semiHasLocalConsumption = semiPlantsArr.some((loc) => !!psiCompByLocPrd[`${loc}|${prdid}`])
        const semiHasTransferOut = semiPlantsArr.some((loc) => locSrcByPrdLocfr.has(`${prdid}|${loc}`))
        const semiLsFromPlant = (locSrcRowsByPrd[prdid] || []).filter((r) => plantsSet.has(str(r.LOCFR || '')))
        const semiDestsNoConsumption = new Set(
          semiLsFromPlant
            .map((r) => str(r.LOCID || ''))
            .filter((dest) => dest && !psiCompByLocPrd[`${dest}|${prdid}`]),
        )

        if (!semiHasLocalConsumption && !semiHasTransferOut) {
          // Caso 4: produce sin consumo PSI local ni transferencia
          obs.push('Semiterminado sin consumo PSI en planta productora ni transferencia configurada')
          fills.push('red')
        } else if (semiHasTransferOut && semiDestsNoConsumption.size > 0) {
          if (!semiHasLocalConsumption) {
            // Caso 5: transfiere sin consumo en destino y sin consumo local
            obs.push(`Transfiere a ${semiDestsNoConsumption.size} destino(s) sin consumo PSI en ningún punto: ${codes(semiDestsNoConsumption)}`)
            fills.push('red')
          } else {
            // Caso 6: consume localmente pero transfiere a destino sin consumo
            obs.push(`Transfiere a ${semiDestsNoConsumption.size} destino(s) sin consumo PSI (sí consume en planta origen): ${codes(semiDestsNoConsumption)}`)
            fills.push('yellow')
          }
        }
        // Caso 1: consume localmente, sin transferencia → OK (sin alerta)
        // Casos 2 y 3: transfiere y consume en destino → OK (sin alerta)
      }

      // PLEADTIME
      if (rules.pleadtimeZero !== 'none' && inPSH) {
        const sidsMissingPlt = sidsPrd.filter((sid) => {
          const recs = pshBySid[sid] || []
          return recs.some((r) => !r.PLEADTIME || r.PLEADTIME === '0')
        })
        if (sidsMissingPlt.length) {
          obs.push(`PLEADTIME ausente o cero en ${sidsMissingPlt.length} SOURCEID(s)`)
          fills.push(rules.pleadtimeZero)
        }
      }

      // OUTPUTCOEFFICIENT = 0 en PSH
      if (rules.outputCoeffZero !== 'none' && inPSH) {
        const sidsMissingCoeff = sidsPrd.filter((sid) => {
          const recs = pshBySid[sid] || []
          return recs.some((r) => !r.OUTPUTCOEFFICIENT || r.OUTPUTCOEFFICIENT === '0')
        })
        if (sidsMissingCoeff.length) {
          obs.push(`OUTPUTCOEFFICIENT ausente o cero en ${sidsMissingCoeff.length} SOURCEID(s)`)
          fills.push(rules.outputCoeffZero)
        }
      }

      // Solo co-producto: aparece en PSH pero nunca como SOURCETYPE=P
      if (rules.isCoproductOnly !== 'none') {
        if (pshPrdSet[prdid] && !inPSH) {
          obs.push('Configurado solo como co-producto (SOURCETYPE=C) — falta PSH primario')
          fills.push(rules.isCoproductOnly)
        }
      }

      // Tiene PSH cuando no debería (rawmat / trading)
      if (rules.hasPSHUnexpected !== 'none') {
        if (pshPrdSet[prdid]) {
          obs.push('Tiene BOM de fabricación (PSH) — verificar categorización')
          fills.push(rules.hasPSHUnexpected)
        }
      }

      // No consumido como componente en ningún BOM
      if (rules.notConsumedInBOM !== 'none') {
        if (consLocs.size === 0) {
          obs.push('No consumido como componente en ningún BOM')
          fills.push(rules.notConsumedInBOM)
        }
      }

      // TLEADTIME = 0 en todos los arcos de Location Source
      if (rules.tleadtimeZero !== 'none' && inLS) {
        const lsRows = locSrcRowsByPrd[prdid] || []
        if (lsRows.length > 0) {
          const allZeroTlt = lsRows.every((r) => !r.TLEADTIME || str(r.TLEADTIME) === '0')
          if (allZeroTlt) {
            obs.push('TLEADTIME = 0 en todos los arcos de Location Source')
            fills.push(rules.tleadtimeZero)
          }
        }
      }

      const uncatLabel = isUncategorized
        ? `Sin categoría [${mattypeid || 'sin MATTYPEID'}]`
        : null

      if (!obs.length) {
        if (isUncategorized) {
          obs.push(`${uncatLabel} — sin hallazgos en modo permisivo`)
        } else {
          const okParts = ['Habilitado en Location Product']
          if (reqPSH !== 'none' && inPSH) okParts.push('Con PSH, PSI y PSR')
          if (rules.requiresPlantAsOrigin !== 'none' && inPSH) okParts.push('Planta es origen en Location Source')
          if (rules.requiresVendorArc !== 'none') okParts.push('Arcos de abastecimiento completos')
          if (rules.requiresAnyOriginDest !== 'none') okParts.push('Con arcos en Location Source')
          if (cats.indexOf('semi') >= 0 && inPSH) {
            const _semiLocalOk = Array.from(plantsSet).some((loc) => !!psiCompByLocPrd[`${loc}|${prdid}`])
            okParts.push(_semiLocalOk ? 'Consume en planta productora' : 'Consumo en destino de transferencia verificado')
          }
          if (rules.pleadtimeZero !== 'none' && inPSH) okParts.push('PLEADTIME definido en todos los SOURCEIDs')
          if (rules.outputCoeffZero !== 'none' && inPSH) okParts.push('Coeficiente de salida definido')
          if (rules.isCoproductOnly !== 'none' && inPSH) okParts.push('PSH con SOURCETYPE=P presente')
          if (rules.hasPSHUnexpected !== 'none') okParts.push('Sin BOM de fabricación')
          if (rules.notConsumedInBOM !== 'none') okParts.push('Consumido como componente en BOM')
          if (rules.tleadtimeZero !== 'none' && inLS) okParts.push('TLEADTIME definido en Location Source')
          obs.push(okParts.join(' | '))
        }
      } else if (isUncategorized) {
        obs.unshift(uncatLabel)
      }

      // Severidad final — máximo entre todos los hallazgos (el más grave gana)
      let finalSev = 'none'
      if (fills.length) {
        const _sevOrder = ['none', 'info', 'yellow', 'red']
        fills.forEach((f) => {
          const s = f === 'red' ? 'red' : f === 'yellow' ? 'yellow' : 'none'
          if (_sevOrder.indexOf(s) > _sevOrder.indexOf(finalSev)) finalSev = s
        })
      }
      const fill = finalSev === 'red' ? C_RED : finalSev === 'yellow' ? C_YEL : null

      const _s1Row = [
        statusLabel(fill), obs.join(' | '),
        prdid, pd(prdid), mattypeid,
        yn(inLP), yn(inPSH), yn(inPSI), yn(inLS),
        sidsPrd.length, codes(sidsPrd),
        plantsSet.size, codes(plantsSet),
        compCount,
        resSet.size, codes(resSet),
        vendorSet.size, codes(vendorSet),
        covData.covered.size, codes(covData.covered),
        covData.uncovered.size, codes(covData.uncovered),
        usedBySet.size, codes(usedBySet),
        origins.size, codes(origins),
        consLocs.size, codes(consLocs),
      ]
      injR('product', 4, _s1Row, PA_PRD[prdid])
      S1.agregar(_s1Row, fill)
    })
    setStatusPA('Hoja Product lista...', 82)
    await ceder()
  }

  /* ════════════════════════════════════════════════════════════════
     HOJA 2 — LOCATION
     Roles inferidos por comportamiento en los datos
     ════════════════════════════════════════════════════════════════ */
  if (ent.loc) {
    const _s9Hdrs = [
      'Estado', 'Observación',
      'LOCID', 'LOCDESCR', 'LOCTYPE',
      'Rol(es) inferido(s)',
      /* Planta */
      '# Productos fabricados', 'Productos fabricados (códigos)',
      '# SOURCEIDs', 'SOURCEIDs (códigos)',
      '# Recursos asignados', 'Recursos asignados (códigos)',
      '# Recursos activos PSR', 'Recursos activos (códigos)',
      '# Recursos ociosos', 'Recursos ociosos (códigos)',
      '# BOMs sin PSI', 'SOURCEIDs sin PSI (códigos)',
      '# BOMs sin PSR', 'SOURCEIDs sin PSR (códigos)',
      '# Componentes externos', '# Componentes sin cobertura LocSrc', 'Componentes sin cobertura (códigos)',
      '# SOURCEIDs sin PLEADTIME', 'SOURCEIDs sin PLEADTIME (códigos)',
      /* Proveedor */
      '# Productos abastecidos (como proveedor)', 'Productos abastecidos (códigos)',
      '# Plantas abastecidas', 'Plantas abastecidas (códigos)',
      '# Arcos sin consumo PSI en destino', 'Productos sin consumo PSI (códigos)',
      '# Productos sin LocProd en destino', 'Productos sin LocProd (códigos)',
      /* Nodo transferencia */
      '# Productos transferidos', 'Productos transferidos (códigos)',
      '# Destinos transferencia', 'Destinos transferencia (códigos)',
      /* Nodo receptor */
      '# Productos recibidos', 'Productos recibidos (códigos)',
      '# Orígenes desde los que recibe', 'Orígenes (códigos)',
    ]
    const _s9Notes = [
      'Color de alerta: 🔴 Alerta = problema crítico que bloquea la planificación | 🟡 Advertencia = dato incompleto o sospechoso | ✅ OK = sin hallazgos.',
      'Detalle de cada validación. Ej 🔴: "2 SOURCEID(s) sin PSI | 1 componente sin arco de abastecimiento". Ej ✅: "BOMs con PSI, PSR y lead time | Sin componentes descubiertos".',
      'Código único de la ubicación en SAP IBP (LOCID). Ej: P001, DC-NORTE, PROV-05.',
      'Descripción de la ubicación del maestro de ubicaciones. Ej: "Planta Santiago", "Centro Distribución Norte".',
      'Tipo de ubicación según el campo LOCTYPE de SAP IBP. Ej: 1010 = planta, 1020 = centro distribución. Campo informativo, el rol real se infiere del comportamiento en los datos.',
      'Rol(es) inferidos del comportamiento real en los datos (independiente del LOCTYPE). Posibles: Planta de producción = tiene PSH | Proveedor = abastece componentes PSI en destino | Nodo de transferencia = envía productos sin consumo PSI en destino | Nodo receptor = solo recibe vía Location Source | Nodo de recursos = tiene Resource Location pero sin producción ni transferencias | Sin actividad = existe en el maestro pero no aparece en ningún otro dato.',
      /* Planta */
      'Número de productos distintos que se fabrican en esta planta (tienen PSH con este LOCID como planta). Ej: 5 = fabrica PROD-001, PROD-002, PROD-003, SEMI-A, SEMI-B.',
      'Códigos de los productos fabricados en esta planta. Ej: PROD-001, PROD-002.',
      'Número de fuentes de producción (SOURCEIDs) asociadas a esta planta. Ej: 3 = SRC-001, SRC-002, SRC-003.',
      'Códigos de los SOURCEIDs de producción de esta planta. Ej: SRC-001, SRC-002.',
      'Número de recursos (máquinas/líneas) con Resource Location configurado en esta planta. Ej: 4 = LINEA-01, LINEA-02, HORNO-A, HORNO-B.',
      'Códigos de los recursos asignados a esta planta en Resource Location. Ej: LINEA-01, HORNO-A.',
      'Número de recursos asignados que aparecen en al menos un PSR activo en esta planta. Ej: 3 de 4 asignados están activos.',
      'Códigos de los recursos activos en algún PSR de esta planta. Ej: LINEA-01, LINEA-02, HORNO-A.',
      'Recursos que están en Resource Location para esta planta pero no aparecen en ningún PSR. Posible configuración huérfana. Ej: HORNO-B asignado a P001 pero sin ninguna receta que lo use → 🟡.',
      'Códigos de los recursos ociosos (en Resource Location sin uso en PSR). Ej: HORNO-B.',
      'Número de SOURCEIDs de esta planta que no tienen ningún componente PSI definido (BOMs vacíos). Un BOM vacío impide planificar la compra de insumos. Ej: SRC-003 sin PSI → 🔴.',
      'Códigos de los SOURCEIDs con BOM vacío (sin PSI). Ej: SRC-003.',
      'Número de SOURCEIDs de esta planta que no tienen ningún recurso PSR asignado. Sin recurso, IBP no puede planificar capacidad. Ej: SRC-002 sin PSR → 🔴.',
      'Códigos de los SOURCEIDs sin recursos PSR asignados. Ej: SRC-002.',
      'Total de componentes de tipo insumo (no semielaborados) requeridos por los BOMs de esta planta. Ej: 8 = suma de ingredientes externos en todas las recetas de P001.',
      'Número de insumos externos de esta planta que no tienen arco de abastecimiento en Location Source. Ej: 2 = MAT-A y MAT-B se requieren en P001 pero no hay Location Source que los lleve ahí → 🔴.',
      'Códigos de los insumos externos sin cobertura de abastecimiento hacia esta planta. Ej: MAT-A, MAT-B.',
      'Número de SOURCEIDs de esta planta con PLEADTIME = 0 o no definido. Un lead time cero hace que IBP planifique como si la producción fuera instantánea. Ej: SRC-001 con PLEADTIME=0 → 🔴.',
      'Códigos de los SOURCEIDs con PLEADTIME faltante o cero en esta planta. Ej: SRC-001.',
      /* Proveedor */
      'Número de productos distintos que esta ubicación envía como origen en Location Source hacia plantas que los consumen como PSI. Ej: 3 = PROV-01 abastece MAT-A, MAT-B, MAT-C.',
      'Códigos de los productos abastecidos desde esta ubicación. Ej: MAT-A, MAT-B.',
      'Número de plantas destino a las que esta ubicación envía productos. Ej: 2 = abastece a P001 y P002.',
      'Códigos de las plantas destino abastecidas. Ej: P001, P002.',
      'Productos que se envían desde aquí pero no se consumen como componente PSI en la planta destino. Puede indicar arcos configurados de más o sin uso real. Ej: MAT-X se envía a P001 pero ningún BOM de P001 lo usa → 🟡.',
      'Códigos de los productos enviados sin consumo PSI en la planta destino. Ej: MAT-X.',
      'Productos que se envían a una planta destino donde no tienen Location Product habilitado. IBP no puede planificarlos en esa planta. Ej: MAT-Y llega a P002 pero no tiene Location Product en P002 → 🔴.',
      'Códigos de los productos sin Location Product en la planta destino. Ej: MAT-Y.',
      /* Nodo transferencia */
      'Número de productos que esta ubicación reenvía vía Location Source sin que sean consumidos como PSI en el destino. Ej: DC-NORTE transfiere PROD-001 a DC-SUR sin que DC-SUR lo use como insumo productivo.',
      'Códigos de los productos transferidos sin consumo productivo en destino. Ej: PROD-001.',
      'Número de ubicaciones destino hacia las que esta ubicación transfiere productos. Ej: 2 = reenvía a DC-SUR y DC-ESTE.',
      'Códigos de las ubicaciones destino de transferencia. Ej: DC-SUR, DC-ESTE.',
      /* Nodo receptor */
      'Número de productos que esta ubicación recibe como destino en Location Source. Ej: 4 = recibe PROD-001, PROD-002, MAT-A, MAT-B.',
      'Códigos de los productos recibidos en esta ubicación. Ej: PROD-001, MAT-A.',
      'Número de ubicaciones origen distintas desde las que recibe productos. Ej: 3 = recibe desde P001, P002 y PROV-01.',
      'Códigos de las ubicaciones origen que abastecen a esta ubicación. Ej: P001, PROV-01.',
    ]
    const _s9Groups = [
      'control', 'control',
      'ibp', 'ibp', 'ibp', 'ibp',
      /* Planta */
      'metric', 'detail', 'metric', 'detail',
      'metric', 'detail', 'metric', 'detail', 'metric', 'detail',
      'metric', 'detail', 'metric', 'detail',
      'metric', 'metric', 'detail',
      'metric', 'detail',
      /* Proveedor */
      'metric', 'detail', 'metric', 'detail', 'metric', 'detail', 'metric', 'detail',
      /* Transferencia */
      'metric', 'detail', 'metric', 'detail',
      /* Receptor */
      'metric', 'detail', 'metric', 'detail',
    ]
    injH('location', 4, _s9Hdrs, _s9Notes, _s9Groups)
    const S9 = hojaDeAnalisis({
      nombre: NOMBRES_DE_HOJA.location, color: 'FF10B981', encabezados: _s9Hdrs, notas: _s9Notes, grupos: _s9Groups,
    })

    // Unión de todos los locids conocidos
    const allLocIds = new Set()
    Object.keys(PA_LOC).forEach((l) => { allLocIds.add(l) })
    Object.keys(pshSidsByLoc).forEach((l) => { allLocIds.add(l) })
    Object.keys(locSrcByLocfr).forEach((l) => { allLocIds.add(l) })
    Object.keys(locSrcByLocid).forEach((l) => { allLocIds.add(l) })
    Object.keys(PA_RES_LOC).forEach((resid) => {
      PA_RES_LOC[resid].forEach((e) => { if (e.LOCID) allLocIds.add(e.LOCID) })
    })

    Array.from(allLocIds).sort().forEach((locid) => {
      const locRec = PA_LOC[locid] || {}
      const locdescr = str(locRec.LOCDESCR || '')
      const loctype = str(locRec.LOCTYPE || '')

      /* Inferir roles */
      const roles = []

      // Planta: tiene PSH
      const sidsAtLoc = pshSidsByLoc[locid] || []
      const isPlanta = sidsAtLoc.length > 0
      if (isPlanta) roles.push('Planta de producción')

      // Determinar si LOCFR en LocSrc provee componentes PSI en LOCID destino
      const locfrRows = locSrcByLocfr[locid] || []
      let isProveedor = false; let isTransferencia = false
      locfrRows.forEach((row) => {
        if (row.LOCID && row.PRDID) {
          if (psiCompByLocPrd[`${row.LOCID}|${row.PRDID}`]) isProveedor = true
          else isTransferencia = true
        }
      })
      if (isProveedor) roles.push('Proveedor')
      if (isTransferencia) roles.push('Nodo de transferencia')

      // Receptor: solo LOCID en LocSrc, sin PSH, sin ser LOCFR
      const locidRows = locSrcByLocid[locid] || []
      const isReceptor = locidRows.length > 0 && !isPlanta && locfrRows.length === 0
      if (isReceptor) roles.push('Nodo receptor')

      // Nodo de recursos: Resource Location sin PSH ni LocSrc
      const hasResLoc = resLocResidSet.size > 0 && Object.keys(PA_RES_LOC).some(
        (resid) => PA_RES_LOC[resid].some((e) => e.LOCID === locid),
      )
      if (hasResLoc && !isPlanta && !isProveedor && !isTransferencia && !isReceptor) {
        roles.push('Nodo de recursos')
      }

      if (!roles.length) roles.push('Sin actividad')

      const rolStr = roles.join(' | ')

      /* ── Métricas Planta ── */
      const plantaPrds = new Set()
      const plantaSids = new Set(sidsAtLoc)
      const resAsignados = new Set(Object.keys(PA_RES_LOC).filter(
        (resid) => PA_RES_LOC[resid].some((e) => e.LOCID === locid),
      ))
      const resActivos = resByLoc[locid] || new Set()
      const resOciosos = new Set(Array.from(resAsignados).filter((r) => !resActivos.has(r)))
      const bomssinPSI = new Set()
      const bomssinPSR = new Set()
      let compExternos = 0
      const compSinCov = new Set()
      const sidsSinPlt = new Set()

      sidsAtLoc.forEach((sid) => {
        const info = pshSidLocid[sid] || {}
        if (info.PRDID) plantaPrds.add(info.PRDID)
        if (!(psiBySourceid[sid] && psiBySourceid[sid].length)) bomssinPSI.add(sid)
        if (!(psrBySourceid[sid] && psrBySourceid[sid].length)) bomssinPSR.add(sid)
        const recs = pshBySid[sid] || []
        if (recs.some((r) => !r.PLEADTIME || r.PLEADTIME === '0')) sidsSinPlt.add(sid)
        // Componentes externos y sin cobertura
        ;(psiBySourceid[sid] || []).forEach((pr) => {
          const comp = str(pr.PRDID || '')
          if (!comp) return
          const isSemi = !!pshByPrdLoc[`${comp}|${locid}`]
          if (!isSemi) {
            compExternos++
            const lsRows = locSrcByPrdLoc[`${comp}|${locid}`] || []
            if (!lsRows.length) compSinCov.add(comp)
          }
        })
      })

      /* ── Métricas Proveedor ── */
      const prdAbastecidos = new Set()
      const plantasAbast = new Set()
      const sinConsumoPSI = new Set()
      const sinLocProd = new Set()
      locfrRows.forEach((row) => {
        if (!row.PRDID || !row.LOCID) return
        prdAbastecidos.add(row.PRDID)
        plantasAbast.add(row.LOCID)
        if (!psiCompByLocPrd[`${row.LOCID}|${row.PRDID}`]) sinConsumoPSI.add(row.PRDID)
        if (!locPrdSet.has(`${row.LOCID}|${row.PRDID}`)) sinLocProd.add(row.PRDID)
      })

      /* ── Métricas Transferencia ── */
      const prdTransferidos = new Set()
      const destTransf = new Set()
      locfrRows.forEach((row) => {
        if (!row.PRDID || !row.LOCID) return
        if (!psiCompByLocPrd[`${row.LOCID}|${row.PRDID}`]) {
          prdTransferidos.add(row.PRDID)
          destTransf.add(row.LOCID)
        }
      })

      /* ── Métricas Receptor ── */
      const prdRecibidos = new Set()
      const origenes = new Set()
      locidRows.forEach((row) => {
        if (row.PRDID) prdRecibidos.add(row.PRDID)
        if (row.LOCFR) origenes.add(row.LOCFR)
      })

      /* ── Métricas por categoría de producto ── */
      const hasSomeCategorized = Object.keys(MATTYPE_CFG).some((k) => MATTYPE_CFG[k].categories.size > 0)

      const transfCompPlanta = new Set()
      const transfCompNoPl = new Set()
      const transfDistrib = new Set()
      const transfUncatSet = new Set()
      if (isTransferencia) {
        locfrRows.forEach((row) => {
          if (!row.PRDID || !row.LOCID) return
          if (psiCompByLocPrd[`${row.LOCID}|${row.PRDID}`]) return
          const cats = getCategories(pm(row.PRDID))
          const isComp = cats.indexOf('rawmat') >= 0 || cats.indexOf('semi') >= 0
          const isDist = cats.indexOf('finished') >= 0 || cats.indexOf('trading') >= 0
          const isUncat = cats.indexOf('uncategorized') >= 0
          const destIsPlanta = (pshSidsByLoc[row.LOCID] || []).length > 0
          if (isComp) {
            if (destIsPlanta) transfCompPlanta.add(row.PRDID)
            else transfCompNoPl.add(row.PRDID)
          } else if (isDist) {
            transfDistrib.add(row.PRDID)
          } else if (isUncat) {
            transfUncatSet.add(row.PRDID)
          }
        })
      }

      const receptorSinLP = new Set()
      const receptorComp = new Set()
      if (isReceptor) {
        locidRows.forEach((row) => {
          if (!row.PRDID) return
          if (!locPrdSet.has(`${locid}|${row.PRDID}`)) receptorSinLP.add(row.PRDID)
          const cats = getCategories(pm(row.PRDID))
          if (cats.indexOf('rawmat') >= 0 || cats.indexOf('semi') >= 0) receptorComp.add(row.PRDID)
        })
      }

      const plantaPrdsWrongCat = new Set()
      if (isPlanta) {
        plantaPrds.forEach((prd) => {
          const cats = getCategories(pm(prd))
          if (cats.indexOf('rawmat') >= 0 || cats.indexOf('trading') >= 0) plantaPrdsWrongCat.add(prd)
        })
      }

      /* ── Validaciones ── */
      const obs = []
      const fills = []

      if (isPlanta) {
        if (bomssinPSI.size) { obs.push(`${bomssinPSI.size} SOURCEID(s) sin PSI`); fills.push('red') }
        if (bomssinPSR.size) { obs.push(`${bomssinPSR.size} SOURCEID(s) sin PSR`); fills.push('red') }
        if (compSinCov.size) { obs.push(`${compSinCov.size} componente(s) sin arco de abastecimiento`); fills.push('red') }
        if (sidsSinPlt.size) { obs.push(`${sidsSinPlt.size} SOURCEID(s) con PLEADTIME = 0`); fills.push('red') }
        if (resOciosos.size) { obs.push(`${resOciosos.size} recurso(s) asignados sin uso en PSR`); fills.push('yellow') }
        if (plantaPrdsWrongCat.size) {
          obs.push(`${plantaPrdsWrongCat.size} producto(s) Mat. Prima/Mercadería con BOM de fabricación en esta planta — verificar categorización`)
          fills.push('yellow')
        }
      }
      if (isProveedor) {
        if (sinConsumoPSI.size) { obs.push(`${sinConsumoPSI.size} producto(s) abastecidos sin consumo PSI en destino`); fills.push('yellow') }
        if (sinLocProd.size) { obs.push(`${sinLocProd.size} producto(s) sin Location Product en planta destino`); fills.push('red') }
      }
      if (isTransferencia) {
        if (transfCompPlanta.size) {
          obs.push(`${transfCompPlanta.size} componente(s) Mat. Prima/Semiterminado transferido(s) a planta sin consumo PSI — verificar BOM`)
          fills.push('red')
        }
        if (transfCompNoPl.size) {
          obs.push(`${transfCompNoPl.size} componente(s) Mat. Prima/Semiterminado transferido(s) a nodo sin producción`)
          fills.push('yellow')
        }
        if (transfUncatSet.size && hasSomeCategorized) {
          obs.push(`${transfUncatSet.size} producto(s) sin categoría transferidos sin consumo PSI en destino`)
          fills.push('yellow')
        }
      }
      if (isReceptor) {
        if (receptorSinLP.size) {
          obs.push(`${receptorSinLP.size} producto(s) recibidos sin cobertura en Location Product`)
          fills.push('red')
        }
        if (receptorComp.size) {
          obs.push(`${receptorComp.size} componente(s) Mat. Prima/Semiterminado recibidos en ubicación sin producción asociada`)
          fills.push('yellow')
        }
      }
      if (roles[0] === 'Sin actividad') { obs.push('Ubicación en maestro sin actividad en otros datos'); fills.push('info') }
      if (!obs.length) {
        const okParts = []
        if (isPlanta) okParts.push('BOMs con PSI, PSR y lead time | Sin componentes sin cobertura | Sin recursos ociosos')
        if (isProveedor) okParts.push('Abastecimiento con consumo PSI y cobertura LP en destino')
        if (isTransferencia) {
          okParts.push(transfDistrib.size > 0
            ? `Distribuye ${transfDistrib.size} producto(s) terminado(s)/mercadería sin hallazgos`
            : 'Nodo de transferencia sin hallazgos')
        }
        if (isReceptor) {
          okParts.push(prdRecibidos.size > 0
            ? `Recibe ${prdRecibidos.size} producto(s) | Location Product OK | Sin componentes sin producción`
            : 'Nodo receptor sin hallazgos')
        }
        if (!okParts.length) okParts.push('Ubicación activa sin hallazgos')
        obs.push(okParts.join(' | '))
      }

      const _sevOrderLoc = ['none', 'info', 'yellow', 'red']
      let _maxSevLoc = 'none'
      fills.forEach((f) => {
        const s = f === 'red' ? 'red' : f === 'yellow' ? 'yellow' : f === 'info' ? 'info' : 'none'
        if (_sevOrderLoc.indexOf(s) > _sevOrderLoc.indexOf(_maxSevLoc)) _maxSevLoc = s
      })
      const finalSev = fills.length ? _maxSevLoc : 'none'
      const fill = finalSev === 'red' ? C_RED : finalSev === 'yellow' ? C_YEL : null

      const _s9Row = [
        statusLabel(fill), obs.join(' | '),
        locid, locdescr, loctype, rolStr,
        plantaPrds.size, codes(plantaPrds),
        plantaSids.size, codes(plantaSids),
        resAsignados.size, codes(resAsignados),
        resActivos.size, codes(resActivos),
        resOciosos.size, codes(resOciosos),
        bomssinPSI.size, codes(bomssinPSI),
        bomssinPSR.size, codes(bomssinPSR),
        compExternos, compSinCov.size, codes(compSinCov),
        sidsSinPlt.size, codes(sidsSinPlt),
        prdAbastecidos.size, codes(prdAbastecidos),
        plantasAbast.size, codes(plantasAbast),
        sinConsumoPSI.size, codes(sinConsumoPSI),
        sinLocProd.size, codes(sinLocProd),
        prdTransferidos.size, codes(prdTransferidos),
        destTransf.size, codes(destTransf),
        prdRecibidos.size, codes(prdRecibidos),
        origenes.size, codes(origenes),
      ]
      injR('location', 4, _s9Row, PA_LOC[locid])
      S9.agregar(_s9Row, fill)
    })
    setStatusPA('Hoja Location lista...', 84)
    await ceder()
  }

  /* ════════════════════════════════════════════════════════════════
     HOJA 3 — RESOURCE
     ════════════════════════════════════════════════════════════════ */
  if (ent.res) {
    const _s2Hdrs = [
      'Estado', 'Observación',
      'RESID', 'RESDESCR',
      'En PSR', 'En Resource Location',
      '# Plantas asignadas', 'Plantas asignadas (códigos)',
      '# Fuentes prod.', 'Fuentes prod. (SOURCEIDs)',
      '# Productos que fabrica', 'Productos que fabrica (códigos)',
    ]
    const _s2Notes = [
      'Color de alerta: 🔴 Alerta = recurso completamente huérfano (sin PSR ni Resource Location) | 🟡 Advertencia = dato incompleto | ✅ OK = recurso activo y con planta asignada.',
      'Detalle de la validación. Ej 🔴: "Recurso huérfano: sin uso en producción ni planta asignada". Ej 🟡: "Sin uso en producción (no aparece en PSR)". Ej ✅: "En uso en PSR y con planta asignada en Resource Location".',
      'Código único del recurso productivo en SAP IBP (RESID). Ej: LINEA-01, HORNO-A, MAQUINA-03.',
      'Descripción del recurso del maestro de recursos. Ej: "Línea de envasado 1", "Horno túnel A".',
      'Si / No — ¿Este recurso está asignado a al menos una fuente de producción en PSR? Si No, IBP no lo usa para planificar capacidad. Ej: HORNO-B = No → nunca se considera en ninguna receta.',
      'Si / No — ¿Este recurso tiene al menos una planta configurada en Resource Location? Si No, IBP no sabe dónde opera físicamente. Ej: LINEA-01 = No → recurso sin ubicación conocida → 🟡.',
      'Número de plantas distintas donde este recurso tiene configuración en Resource Location. Ej: 2 = LINEA-01 opera en P001 y P002.',
      'Códigos de las plantas (LOCID) donde este recurso está configurado en Resource Location. Ej: P001, P002.',
      'Número de fuentes de producción (SOURCEIDs) a las que está asignado vía PSR. Ej: 3 = participa en SRC-001, SRC-002, SRC-003.',
      'Códigos de los SOURCEIDs a los que está asignado este recurso. Ej: SRC-001, SRC-002.',
      'Número de productos distintos que fabrica a través de sus SOURCEIDs. Ej: 2 = HORNO-A produce PROD-001 y PROD-002.',
      'Códigos de los productos fabricados por las fuentes donde participa este recurso. Ej: PROD-001, PROD-002.',
    ]
    const _s2Groups = [
      'control', 'control',
      'ibp', 'ibp',
      'flag', 'flag',
      'metric', 'detail',
      'metric', 'detail',
      'metric', 'detail',
    ]
    injH('resource', 3, _s2Hdrs, _s2Notes, _s2Groups)
    const S2 = hojaDeAnalisis({
      nombre: NOMBRES_DE_HOJA.resource, color: 'FFa78bfa', encabezados: _s2Hdrs, notas: _s2Notes, grupos: _s2Groups,
    })

    // Índice: RESID → Set<LOCID> (desde Resource Location)
    const resLocsByResid = dict()
    Object.keys(PA_RES_LOC).forEach((resid) => {
      resLocsByResid[resid] = new Set(PA_RES_LOC[resid].map((e) => e.LOCID))
    })

    // Índice: RESID → Set<SOURCEID>
    const resSidsByResid = dict()
    allPsr.forEach((r) => {
      const resid = str(r.RESID || ''); const sid = str(r.SOURCEID)
      if (!resid) return
      if (!resSidsByResid[resid]) resSidsByResid[resid] = new Set()
      resSidsByResid[resid].add(sid)
    })

    // Índice: RESID → Set<PRDID>
    const resPrdsByResid = dict()
    allPsr.forEach((r) => {
      const resid = str(r.RESID || ''); const sid = str(r.SOURCEID)
      if (!resid) return
      const info = pshSidLocid[sid] || {}
      if (info.PRDID) {
        if (!resPrdsByResid[resid]) resPrdsByResid[resid] = new Set()
        resPrdsByResid[resid].add(info.PRDID)
      }
    })

    Object.keys(PA_RES).sort().forEach((resid) => {
      const inPSR = psrResidSet.has(resid)
      const inRL = resLocResidSet.has(resid)
      const locsSet = resLocsByResid[resid] || new Set()
      const sidsSet = resSidsByResid[resid] || new Set()
      const prdsSet = resPrdsByResid[resid] || new Set()
      const obs = []
      if (!inPSR && !inRL) obs.push('Recurso huérfano: sin uso en producción ni planta asignada')
      else if (!inPSR) obs.push('Sin uso en producción (no aparece en PSR)')
      else if (!inRL) obs.push('Sin planta asignada en Resource Location')
      if (!obs.length) obs.push('En uso en PSR y con planta asignada en Resource Location')
      const fill = (!inPSR && !inRL) ? C_RED : (!inPSR || !inRL) ? C_YEL : null
      const _s2Row = [
        statusLabel(fill), obs.join(' | '),
        resid, rd(resid),
        yn(inPSR), yn(inRL),
        locsSet.size, codes(locsSet),
        sidsSet.size, codes(sidsSet),
        prdsSet.size, codes(prdsSet),
      ]
      injR('resource', 3, _s2Row, PA_RES[resid])
      S2.agregar(_s2Row, fill)
    })
    setStatusPA('Hoja Resource lista...', 84)
    await ceder()
  }

  /* ════════════════════════════════════════════════════════════════
     HOJA 3 — RESOURCE LOCATION
     ════════════════════════════════════════════════════════════════ */
  if (ent.resLoc) {
    const _s3Hdrs = [
      'Estado', 'Observación',
      'RESID', 'RESDESCR', 'LOCID', 'LOCDESCR',
      'RESID+LOCID usado en PSR',
    ]
    const _s3Notes = [
      'Color de alerta: 🟡 Advertencia = recurso asignado a planta pero sin uso en ninguna receta | ✅ OK = recurso activo en PSR para esta planta.',
      'Detalle de la validación. Ej ✅: "Recurso activo en PSR para esta planta". Ej 🟡: "Recurso asignado a planta pero sin uso en PSR para esta planta" — significa que está en el maestro pero IBP nunca lo considera en esa planta.',
      'Código del recurso productivo (RESID). Ej: LINEA-01.',
      'Descripción del recurso del maestro de recursos. Ej: "Línea de envasado 1".',
      'Código de la planta donde está configurado este recurso (LOCID). Ej: P001.',
      'Descripción de la planta del maestro de ubicaciones. Ej: "Planta Santiago".',
      'Si / No — ¿Esta combinación RESID+LOCID aparece en al menos un PSR? Si No, el recurso está en el maestro de esa planta pero no participa en ninguna receta. Ej: HORNO-B en P002 = No → 🟡 configuración sin uso productivo.',
    ]
    const _s3Groups = [
      'control', 'control',
      'ibp', 'ibp', 'ibp', 'ibp',
      'flag',
    ]
    injH('resourceLocation', 5, _s3Hdrs, _s3Notes, _s3Groups)
    const S3 = hojaDeAnalisis({
      nombre: NOMBRES_DE_HOJA.resourceLocation, color: 'FFFF9F43', encabezados: _s3Hdrs, notas: _s3Notes, grupos: _s3Groups,
    })
    Object.keys(PA_RES_LOC).sort().forEach((resid) => {
      PA_RES_LOC[resid].forEach((e) => {
        const locid = e.LOCID
        const used = psrByResidLoc.has(`${resid}|${locid}`)
        const obs = used ? 'Recurso activo en PSR para esta planta' : 'Recurso asignado a planta pero sin uso en PSR para esta planta'
        const fill = used ? null : C_YEL
        const _s3Row = [statusLabel(fill), obs, resid, rd(resid), locid, ld(locid), yn(used)]
        injR('resourceLocation', 5, _s3Row, e)
        S3.agregar(_s3Row, fill)
      })
    })
    setStatusPA('Hoja Resource Location lista...', 85)
    await ceder()
  }

  /* ════════════════════════════════════════════════════════════════
     HOJA 4 — PRODUCTION SOURCE HEADER
     ════════════════════════════════════════════════════════════════ */
  if (ent.psh) {
    const _s6Hdrs = [
      'Estado', 'Observación',
      'SOURCEID',
      'PRDID output', 'PRDDESCR output', 'MATTYPEID output',
      'LOCID planta', 'LOCDESCR planta',
      'SOURCETYPE', 'PLEADTIME', 'OUTPUTCOEFFICIENT', 'PRATIO',
      'PRDID+LOCID en Location Product',
      '# Componentes PSI', '# Recursos PSR', 'Recursos PSR (códigos)',
      '# Componentes con alternativa',
      'Tiene PSR',
    ]
    const _s6Notes = [
      'Color de alerta: 🔴 Alerta = BOM vacío, PLEADTIME=0, sin Location Product o sin PSR | 🟡 Advertencia = sin SOURCETYPE=P o múltiples fuentes sin cuota | ✅ OK = receta completa.',
      'Detalle de hallazgos. Ej 🔴: "BOM vacío: sin componentes PSI | PLEADTIME = 0 o no definido". Ej 🟡: "Múltiples SOURCEIDs para mismo PRDID+LOCID — verificar cuotas". Ej ✅: "BOM con PSI | Lead time definido | Habilitado en LP | SOURCETYPE=P presente | Recursos PSR asignados".',
      'Identificador único de la fuente de producción (SOURCEID) en SAP IBP. Ej: SRC-001.',
      'Código del producto terminado que produce esta receta (output). Ej: PROD-001.',
      'Descripción del producto output. Ej: "Aceite refinado 1L".',
      'Tipo de material del producto output. Ej: FERT = terminado, HALB = semielaborado.',
      'Código de la planta donde se ejecuta esta producción (LOCID). Ej: P001.',
      'Descripción de la planta de producción. Ej: "Planta Santiago".',
      'Tipo(s) de fuente en esta receta: P = producción primaria (el output principal) | C = co-producto (se obtiene en el mismo proceso). Ej: P/C = esta receta produce PROD-001 como primario y SEMI-X como co-producto.',
      'Lead time de producción en días. Indica cuánto tarda el proceso desde que se lanza la orden hasta tener el producto listo. PLEADTIME = 0 o vacío hace que IBP planifique como producción instantánea → 🔴. Ej: 5 = 5 días de fabricación.',
      'Unidades del producto terminado que se obtienen por corrida de producción. Afecta directamente el cálculo de cuántas corridas se necesitan. Ej: 100 = cada corrida produce 100 unidades.',
      'Proporción de producción asignada a esta fuente cuando existen múltiples SOURCEIDs para el mismo PRDID+LOCID. IBP usa PRATIO para distribuir la demanda planificada entre fuentes. Ej: 0.6 = esta fuente cubre el 60% de la demanda. Vacío = fuente única o sin cuota definida.',
      'Si / No — ¿La combinación PRDID+LOCID está habilitada en Location Product? Sin esto, IBP no planifica este producto en esta planta aunque exista la receta. Ej: PROD-001 en P001 = No → receta sin efecto.',
      'Número de componentes (PSI) definidos en el BOM de esta receta. 0 = BOM vacío → IBP no planifica compra de insumos. Ej: 4 = esta receta requiere 4 ingredientes.',
      'Número de recursos productivos (máquinas/líneas) asignados a esta receta vía PSR. 0 = sin capacidad modelada. Ej: 2 = LINEA-01 y HORNO-A.',
      'Códigos de los recursos (RESID) asignados a esta fuente de producción. Ej: LINEA-01, HORNO-A.',
      'Número de componentes PSI marcados como material de reemplazo alternativo (ISALTITEM=X). Ej: 1 = MAT-A-PREMIUM puede reemplazar a MAT-A en esta receta.',
      'Si / No — ¿Esta fuente tiene al menos un recurso asignado en Prod Source Resource? Si No, IBP no puede planificar la capacidad de esta receta. Ej: SRC-003 = No → sin restricción de capacidad modelada → 🔴.',
    ]
    const _s6Groups = [
      'control', 'control',
      'ibp',
      'ibp', 'ibp', 'ibp',
      'ibp', 'ibp',
      'ibp', 'ibp', 'ibp', 'ibp',
      'flag',
      'metric', 'metric', 'detail',
      'metric',
      'flag',
    ]
    injH('psh', 11, _s6Hdrs, _s6Notes, _s6Groups)
    const S6 = hojaDeAnalisis({
      nombre: NOMBRES_DE_HOJA.prodSrcHeader, color: 'FFF7A800', encabezados: _s6Hdrs, notas: _s6Notes, grupos: _s6Groups,
    })
    Object.keys(pshBySid).sort().forEach((sid) => {
      const recs = pshBySid[sid]
      // Métricas a nivel SOURCEID — compartidas por todas las filas de salida del source
      const psiRows = psiBySourceid[sid] || []
      const psrRows = psrBySourceid[sid] || []
      const hasPSI = psiRows.length > 0
      const hasPSR = psrRows.length > 0
      const hasP = pshSidHasP[sid]
      const residsSet = new Set(psrRows.map((r) => str(r.RESID || '')).filter(Boolean))
      const altCount = psiRows.filter((r) => str(r.ISALTITEM || '') === 'X').length

      // Una fila por cada registro de salida (producto principal + co-productos)
      recs.forEach((rec) => {
        const outPrd = rec.PRDID; const outLoc = rec.LOCID
        if (!pm(outPrd) || isExcluded(pm(outPrd))) return
        const plt = rec.PLEADTIME || ''; const coeff = rec.OUTPUTCOEFFICIENT || ''; const pratio = rec.PRATIO || ''
        const stype = rec.SOURCETYPE || ''
        const inLP = locPrdSet.has(`${outLoc}|${outPrd}`)
        const noLt = !plt || plt === '0'
        const multi = (pshByPrdLoc[`${outPrd}|${outLoc}`] || []).length > 1

        const obs = []
        if (!hasPSI) obs.push('BOM vacío: sin componentes PSI')
        if (noLt) obs.push('PLEADTIME = 0 o no definido')
        if (!inLP) obs.push('PRDID+LOCID sin cobertura en Location Product')
        if (!hasP) obs.push('Sin registro SOURCETYPE=P')
        if (!hasPSR) obs.push('Sin recursos PSR asignados')
        if (multi) obs.push('Múltiples SOURCEIDs para mismo PRDID+LOCID — verificar cuotas')
        if (!obs.length) obs.push('BOM con componentes PSI | Lead time definido | Habilitado en LP | SOURCETYPE=P presente | Recursos PSR asignados')
        const fill = (!hasPSI || noLt || !inLP || !hasPSR) ? C_RED : (!hasP || multi) ? C_YEL : null
        const _s6Row = [
          statusLabel(fill), obs.join(' | '),
          sid,
          outPrd, pd(outPrd), pm(outPrd),
          outLoc, ld(outLoc),
          stype, plt, coeff, pratio,
          yn(inLP),
          psiRows.length, residsSet.size, codes(residsSet),
          altCount,
          yn(hasPSR),
        ]
        injR('psh', 11, _s6Row, rec)
        S6.agregar(_s6Row, fill)
      })
    })
    setStatusPA('Hoja Prod Source Header lista...', 88)
    await ceder()
  }

  /* ════════════════════════════════════════════════════════════════
     HOJA 5 — PRODUCTION SOURCE ITEM
     ════════════════════════════════════════════════════════════════ */
  if (ent.psi) {
    const _s7Hdrs = [
      'Estado', 'Observación',
      'SOURCEID',
      'PRDID output', 'PRDDESCR output', 'MATTYPEID output',
      'LOCID planta', 'LOCDESCR planta',
      'PRDID componente', 'PRDDESCR comp', 'MATTYPEID comp',
      'COMPONENTCOEFFICIENT', 'Tipo componente',
      'PRDID comp+LOCID en Location Product',
      'En Location Source (insumo)',
      'LOCFR origen', 'LOCDESCR origen',
      '# Orígenes comp.', 'Orígenes comp. (códigos)',
      'Material de reemplazo (ISALTITEM)', 'Reemplaza a',
    ]
    const _s7Notes = [
      'Color de alerta: 🔴 Alerta = coeficiente cero, insumo sin arco de abastecimiento o componente sin Location Product | 🟡 Advertencia = SOURCEID no encontrado o sustituto sin registro Item Sub | ✅ OK = componente bien configurado.',
      'Detalle de hallazgos. Ej 🔴: "Coeficiente = 0 o no definido | Insumo sin arco de abastecimiento en Location Source". Ej ✅: "SOURCEID válido | Coeficiente definido | Con arco de abastecimiento | Habilitado en Location Product".',
      'Fuente de producción (SOURCEID) a la que pertenece este componente. Ej: SRC-001 = este componente es ingrediente de la receta SRC-001.',
      'Código del producto terminado que se fabrica en esta receta (output). Ej: PROD-001.',
      'Descripción del producto output. Ej: "Aceite refinado 1L".',
      'Tipo de material del producto output. Ej: FERT.',
      'Planta donde se fabrica el producto output (LOCID). Ej: P001.',
      'Descripción de la planta de fabricación. Ej: "Planta Santiago".',
      'Código del material que se consume como ingrediente en esta receta (PRDID componente). Ej: MAT-A.',
      'Descripción del componente del maestro de materiales. Ej: "Aceite crudo a granel".',
      'Tipo de material del componente. Ej: ROH = materia prima, HALB = semielaborado.',
      'Unidades del componente consumidas por cada unidad del producto terminado. Si = 0, IBP no planifica la compra de este insumo. Ej: 2.5 = se consumen 2.5 kg de MAT-A por cada unidad de PROD-001 fabricada.',
      'Semielaborado = el componente tiene PSH propio en esta planta y se fabrica antes de usarse (trazabilidad en PSH). Insumo = no se fabrica aquí, debe llegar desde un proveedor u otra planta vía Location Source. Ej: SEMI-B = Semielaborado | MAT-A = Insumo.',
      'Si / No — ¿El componente está habilitado en Location Product para esta planta? Si No, IBP no puede planificar su consumo en esa planta. Ej: MAT-A en P001 = No → componente desconocido para IBP en esa planta → 🔴.',
      'Si / No — ¿Hay al menos un arco en Location Source que traiga este insumo a esta planta? Muestra N/A para semielaborados (se producen localmente, no se transfieren). Ej: MAT-A en P001 = No → no hay ruta de abastecimiento configurada → 🔴.',
      'Código(s) de la(s) ubicación(es) desde donde se transfiere este componente hacia la planta (LOCFR). Ej: PROV-01, PROV-02 si llega desde dos orígenes distintos.',
      'Descripción(es) de la(s) ubicación(es) origen del componente. Ej: "Proveedor Nacional 01".',
      'Número de nodos origen distintos que abastecen este componente hacia esta planta. Ej: 2 = llega desde PROV-01 y PROV-02 (doble fuente, mayor resiliencia).',
      'Códigos de los nodos origen del componente hacia esta planta. Ej: PROV-01, PROV-02.',
      'X = este componente es un material de reemplazo alternativo (ISALTITEM=X). Vacío = componente principal. Ej: MAT-A-PREMIUM con X = puede sustituir a MAT-A cuando no hay stock.',
      'Código del componente principal al que reemplaza este sustituto. Solo aplica cuando ISALTITEM=X. Ej: MAT-A = este sustituto reemplaza a MAT-A.',
    ]
    const _s7Groups = [
      'control', 'control',
      'ibp',
      'ibp', 'ibp', 'ibp',
      'ibp', 'ibp',
      'ibp', 'ibp', 'ibp',
      'ibp', 'metric',
      'flag',
      'flag',
      'detail', 'detail',
      'metric', 'detail',
      'ibp', 'detail',
    ]
    injH('psi', 11, _s7Hdrs, _s7Notes, _s7Groups)
    const S7 = hojaDeAnalisis({
      nombre: NOMBRES_DE_HOJA.prodSrcItem, color: 'FF06B6D4', encabezados: _s7Hdrs, notas: _s7Notes, grupos: _s7Groups,
    })

    const PSI_CHUNK = 300
    for (let pii = 0; pii < allPsi.length; pii += PSI_CHUNK) {
      allPsi.slice(pii, pii + PSI_CHUNK).forEach((r) => {
        const sid = str(r.SOURCEID)
        const comp = str(r.PRDID || '')
        const coeff = str(r.COMPONENTCOEFFICIENT || '')
        const isAlt = str(r.ISALTITEM || '')
        const info = pshSidLocid[sid] || {}
        const locid = info.LOCID || ''
        const outPrd = info.PRDID || ''
        if (!pm(outPrd) || isExcluded(pm(outPrd))) return
        const compMt = pm(comp)

        const noSrc = !locid
        const hasLocalPsh = !!(locid && pshByPrdLoc[`${comp}|${locid}`])
        const compCatIsSemi = compMt ? getCategories(compMt).indexOf('semi') >= 0 : false
        const hasAnyPsh = !!(pshSidsByPrd[comp] && pshSidsByPrd[comp].length > 0)
        const isSemi = hasLocalPsh || compCatIsSemi
        const isSemiLocal = hasLocalPsh
        const isSemiRemote = !hasLocalPsh && compCatIsSemi && hasAnyPsh
        const isSemiNoRec = !hasLocalPsh && compCatIsSemi && !hasAnyPsh

        const tipo = noSrc ? 'No determinado'
          : isSemiLocal ? 'Semielaborado'
            : isSemiRemote ? 'Semielaborado (ext.)'
              : isSemiNoRec ? 'Semielaborado (sin receta)'
                : 'Insumo'
        const compInLP = locid ? locPrdSet.has(`${locid}|${comp}`) : false
        const noCoeff = !coeff || Number(coeff) === 0

        // Local: no necesita LS. Sin receta: LS no aplica. Externo e insumo: verificar arco.
        const checkLS = !isSemiLocal && !isSemiNoRec && locid && !noSrc
        const lsRows = checkLS ? (locSrcByPrdLoc[`${comp}|${locid}`] || []) : []
        const inLS = lsRows.length > 0
        const locfrVals = inLS ? [...new Set(lsRows.map((x) => x.LOCFR))] : []
        const locfrCodes = locfrVals.join(', ')
        const locfrDescr = locfrVals.map((lf) => ld(lf) || '?').join(', ')

        // Orígenes del componente: LOCFR de LS + plantas productoras para semis
        const originsComp = new Set(lsRows.map((x) => x.LOCFR).filter(Boolean))
        if (isSemi) {
          ;(pshSidsByPrd[comp] || []).forEach((sid2) => {
            const l = (pshSidLocid[sid2] || {}).LOCID
            if (l) originsComp.add(l)
          })
        }

        let replacedBy = ''
        if (isAlt === 'X') {
          const replaced = psiSubBySprdfr[comp] || []
          replacedBy = replaced.join(', ')
        }

        const obs = []
        const exclNote = (compMt && isExcluded(compMt)) ? ' [componente de tipo excluido]' : ''
        if (noSrc) obs.push('SOURCEID no encontrado en PSH')
        if (noCoeff) obs.push('Coeficiente = 0 o no definido')
        if (isSemiLocal) {
          obs.push('Semielaborado: trazabilidad en PSH')
        } else if (isSemiRemote) {
          if (!noSrc) {
            obs.push(inLS
              ? 'Semiterminado producido en otra planta: transferencia configurada'
              : 'Semiterminado sin arco de transferencia hacia esta planta')
          }
        } else if (isSemiNoRec) {
          obs.push('Semiterminado sin receta de produccion (PSH) en ninguna planta')
        } else if (!noSrc) {
          if (!inLS) obs.push('Insumo sin arco de abastecimiento en Location Source')
        }
        if (!compInLP && locid) obs.push('Componente no habilitado en Location Product para esta planta')
        if (isAlt === 'X' && !replacedBy && ent.psiSub) obs.push('Material de reemplazo sin registro en Item Sub')
        if (exclNote) obs.push(`Componente de tipo excluido (${compMt}) — validado en contexto`)
        if (!obs.length) obs.push('SOURCEID valido en PSH | Coeficiente definido | Con arco de abastecimiento en Location Source | Habilitado en Location Product')

        const fill = (noCoeff
          || (isSemiRemote && !inLS && !noSrc)
          || (!isSemi && !inLS && !noSrc)
          || (!compInLP && locid)) ? C_RED
          : (noSrc || isSemiNoRec || (isAlt === 'X' && !replacedBy && ent.psiSub)) ? C_YEL
            : null

        const _s7Row = [
          statusLabel(fill), obs.join(' | '),
          sid,
          outPrd, pd(outPrd), pm(outPrd),
          locid, ld(locid),
          comp, pd(comp), compMt,
          coeff, tipo,
          yn(compInLP),
          (isSemiLocal || isSemiNoRec || noSrc) ? 'N/A' : yn(inLS),
          locfrCodes, locfrDescr,
          originsComp.size, codes(originsComp),
          isAlt || '', replacedBy,
        ]
        injR('psi', 11, _s7Row, r)
        S7.agregar(_s7Row, fill)
      })
      await ceder()
      setStatusPA(
        `Hoja Prod Source Item: ${Math.min(pii + PSI_CHUNK, allPsi.length)}/${allPsi.length}...`,
        88 + Math.round((Math.min(pii + PSI_CHUNK, allPsi.length) / Math.max(allPsi.length, 1)) * 3),
      )
    }
    setStatusPA('Hoja Prod Source Item lista...', 91)
    await ceder()
  }

  /* ════════════════════════════════════════════════════════════════
     HOJA 6 — PRODUCTION SOURCE RESOURCE
     ════════════════════════════════════════════════════════════════ */
  if (ent.psr) {
    const _s8Hdrs = [
      'Estado', 'Observación',
      'SOURCEID',
      'PRDID output', 'PRDDESCR output', 'MATTYPEID output',
      'LOCID planta', 'LOCDESCR planta',
      'RESID', 'RESDESCR',
      'RESID+LOCID en Resource Location',
      '# Plantas con este recurso asignado', 'Plantas recurso (códigos)',
    ]
    const _s8Notes = [
      'Color de alerta: 🟡 Advertencia = recurso asignado a una receta pero sin Resource Location en esa planta | ✅ OK = asignación válida y consistente.',
      'Detalle de la validación. Ej ✅: "Recurso LINEA-01 asignado en Resource Location para planta P001 | Asociado a SOURCEID SRC-001". Ej 🟡: "Recurso en producción sin asignación en Resource Location para planta P001" — el recurso opera en una receta de P001 pero no figura en el maestro de esa planta.',
      'Fuente de producción (SOURCEID) a la que está asignado este recurso. Ej: SRC-001.',
      'Código del producto que fabrica esta fuente. Ej: PROD-001.',
      'Descripción del producto output. Ej: "Aceite refinado 1L".',
      'Tipo de material del producto output. Ej: FERT.',
      'Planta donde opera esta fuente de producción (LOCID). Ej: P001.',
      'Descripción de la planta. Ej: "Planta Santiago".',
      'Código del recurso asignado a esta fuente de producción (RESID). Ej: LINEA-01.',
      'Descripción del recurso del maestro de recursos. Ej: "Línea de envasado 1".',
      'Si / No — ¿La combinación RESID+LOCID aparece en Resource Location? Si No, el recurso está en la receta pero IBP no lo reconoce como ubicado en esa planta. Ej: LINEA-01 en P001 = No → 🟡 inconsistencia entre PSR y Resource Location.',
      'Número de plantas donde este recurso tiene configuración en Resource Location. Ej: 2 = LINEA-01 tiene Resource Location en P001 y P002.',
      'Códigos de las plantas donde este recurso tiene Resource Location configurado. Ej: P001, P002.',
    ]
    const _s8Groups = [
      'control', 'control',
      'ibp',
      'ibp', 'ibp', 'ibp',
      'ibp', 'ibp',
      'ibp', 'ibp',
      'flag',
      'metric', 'detail',
    ]
    injH('psr', 9, _s8Hdrs, _s8Notes, _s8Groups)
    const S8 = hojaDeAnalisis({
      nombre: NOMBRES_DE_HOJA.prodSrcResource, color: 'FF6C63FF', encabezados: _s8Hdrs, notas: _s8Notes, grupos: _s8Groups,
    })

    // RESID → plantas asignadas (Resource Location)
    const resLocMapByResid = dict()
    Object.keys(PA_RES_LOC).forEach((resid) => {
      resLocMapByResid[resid] = new Set(PA_RES_LOC[resid].map((e) => e.LOCID))
    })

    allPsr.forEach((r) => {
      const sid = str(r.SOURCEID)
      const resid = str(r.RESID || '')
      const info = pshSidLocid[sid] || {}
      const locid = info.LOCID || ''
      const outPrd = info.PRDID || ''
      if (isExcluded(pm(outPrd))) return
      const inRL = !!(locid && resid && resLocSet.has(`${resid}|${locid}`))
      const noSrc = !locid
      const resPlants = resLocMapByResid[resid] || new Set()
      const obs = noSrc ? 'SOURCEID no encontrado en PSH'
        : inRL ? `Recurso ${resid} asignado en Resource Location para planta ${locid} | Asociado a SOURCEID ${sid}`
          : `Recurso en producción sin asignación en Resource Location para planta ${locid}`
      const fill = noSrc ? C_YEL : inRL ? null : C_YEL
      const _s8Row = [
        statusLabel(fill), obs,
        sid,
        outPrd, pd(outPrd), pm(outPrd),
        locid, ld(locid),
        resid, rd(resid),
        yn(inRL),
        resPlants.size, codes(resPlants),
      ]
      injR('psr', 9, _s8Row, r)
      S8.agregar(_s8Row, fill)
    })
    setStatusPA('Hoja Prod Source Resource lista...', 93)
    await ceder()
  }

  /* ════════════════════════════════════════════════════════════════
     HOJA 8 — TIPOS EXCLUIDOS
     ════════════════════════════════════════════════════════════════ */
  const excluidos = Object.keys(MATTYPE_CFG).filter((k) => MATTYPE_CFG[k].excluded)
  if (excluidos.length) {
    const SX = hojaDeAnalisis({
      nombre: NOMBRES_DE_HOJA.excludedTypes,
      color: 'FFFF6B6B',
      encabezados: [
        'MATTYPEID', '# Productos', 'Aparece como componente PSI en # SOURCEIDs',
        'SOURCEIDs donde es componente (códigos)',
        'Componentes con cobertura LocSrc', 'Componentes sin cobertura LocSrc',
        'Observacion',
      ],
      notas: [
        'Código del tipo de material excluido del análisis principal por configuración del usuario. Ej: VERP = embalajes, NLAG = no planificados.',
        'Número de productos del maestro que tienen este tipo de material. Ej: 45 = hay 45 productos de tipo VERP.',
        'Número de fuentes de producción (SOURCEIDs) que usan productos de este tipo como componente PSI. Aunque estén excluidos del análisis principal, se valida su presencia como insumo. Ej: 12 = 12 recetas distintas usan un VERP como ingrediente.',
        'Códigos de los SOURCEIDs donde productos de este tipo excluido aparecen como componente en un BOM. Ej: SRC-001, SRC-005.',
        'Número de combinaciones componente-planta (de este tipo excluido) con arco de abastecimiento configurado en Location Source. Ej: 8 = 8 pares producto-planta tienen ruta de abastecimiento.',
        'Número de combinaciones componente-planta SIN arco de abastecimiento. Si > 0, hay insumos de tipo excluido sin ruta de llegada a la planta que los consume. Ej: 3 = 3 pares sin cobertura → 🟡 aunque el tipo esté excluido del análisis principal.',
        'Detalle: indica si el tipo aparece como componente en BOMs activos y si hay gaps de abastecimiento detectados. Ej: "Excluido del análisis principal. Validado como componente en 12 fuente(s). ⚠️ 3 combinación(es) componente-planta sin arco de abastecimiento".',
      ],
      grupos: ['ibp', 'metric', 'metric', 'detail', 'metric', 'metric', 'control'],
      // Esta hoja no tiene columna Estado: la vista web no debe pisar su primera columna.
      conEstado: false,
    })

    // Para cada tipo excluido, listar sus productos y dónde aparecen como componente
    excluidos.sort().forEach((mt) => {
      const cfg = MATTYPE_CFG[mt] || {}

      // Productos de este tipo
      const prdsOfType = Object.keys(PA_PRD).filter((p) => pm(p) === mt)

      // SOURCEIDs donde estos productos aparecen como componente PSI
      const sidsAsComp = new Set()
      prdsOfType.forEach((prd) => {
        allPsi.forEach((r) => {
          if (str(r.PRDID || '') === prd) sidsAsComp.add(str(r.SOURCEID))
        })
      })

      // Cobertura LocSrc para cada producto excluido como componente
      let covCount = 0; let noCovCount = 0
      prdsOfType.forEach((prd) => {
        const consPlants = consumedAtLoc[prd] || new Set()
        consPlants.forEach((loc) => {
          const k = `${prd}|${loc}`
          if (locSrcByPrdLoc[k] && locSrcByPrdLoc[k].length > 0) covCount++
          else noCovCount++
        })
      })

      let obs = sidsAsComp.size
        ? `Excluido del análisis principal. Validado como componente en ${sidsAsComp.size} fuente(s) de producción.`
        : 'Excluido del análisis principal. No aparece como componente en ninguna fuente de producción.'
      if (noCovCount > 0) obs += ` ⚠️ ${noCovCount} combinación(es) componente-planta sin arco de abastecimiento.`

      SX.agregar([
        mt, cfg.count || 0,
        sidsAsComp.size, codes(sidsAsComp),
        covCount, noCovCount,
        obs,
      ], noCovCount > 0 ? C_YEL : null)
    })
    setStatusPA('Hoja Tipos Excluidos lista...', 97)
    await ceder()
  }

  /* ── HOJA 0: RESUMEN ── */
  setStatusPA('Generando Resumen...', 98)
  const sheetDefs = [
    { key: 'Product', nombre: NOMBRES_DE_HOJA.product, num: 1 },
    { key: 'Location', nombre: NOMBRES_DE_HOJA.location, num: 2 },
    { key: 'Resource', nombre: NOMBRES_DE_HOJA.resource, num: 3 },
    { key: 'Resource Location', nombre: NOMBRES_DE_HOJA.resourceLocation, num: 4 },
    { key: 'Prod Source Header', nombre: NOMBRES_DE_HOJA.prodSrcHeader, num: 5 },
    { key: 'Prod Source Item', nombre: NOMBRES_DE_HOJA.prodSrcItem, num: 6 },
    { key: 'Prod Source Resource', nombre: NOMBRES_DE_HOJA.prodSrcResource, num: 7 },
    { key: 'Tipos Excluidos', nombre: NOMBRES_DE_HOJA.excludedTypes, num: 8 },
  ]
  /** Los conteos por hoja (`STATS` de v7). Las hojas que no se generaron no están. */
  const STATS = {}
  sheetDefs.forEach((d) => {
    const hoja = informe.hojasWeb[d.nombre]
    if (hoja) STATS[d.key] = { total: hoja.total, red: hoja.red, yel: hoja.yel, ok: hoja.ok }
  })

  sheetDefs.forEach((d) => {
    const s = STATS[d.key]; if (!s) return
    const pct = porcentajeOk(s.total, s.ok)
    const fill = s.red > 0 ? C_RED : s.yel > 0 ? C_YEL : null
    informe.resumen.push({ nombre: d.nombre, clave: d.key, total: s.total, red: s.red, yel: s.yel, ok: s.ok, pct })
    S0.agregar([d.num, d.nombre, s.total, s.red, s.yel, s.ok, `${pct}%`], fill)
  })

  if (ejecucion) {
    const prdStat = STATS.Product || {}
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
        { label: 'Total productos en maestro', value: Object.keys(PA_PRD).length.toLocaleString('es-CL') },
        { label: 'Productos analizados (incluidos)', value: (prdStat.total || 0).toLocaleString('es-CL') },
        { label: 'Productos sin hallazgos (OK)', value: (prdStat.ok || 0).toLocaleString('es-CL') },
        { label: 'SOURCEIDs activos (PSH)', value: Object.keys(pshBySid).length.toLocaleString('es-CL') },
      ],
    })
  }

  return informe
}

