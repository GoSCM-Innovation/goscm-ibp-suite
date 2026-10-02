// Tipos de material: qué se excluye, cómo se categoriza y qué se le exige a cada categoría.
//
// Portado LITERAL de `mattype-config.js` de v7 (la parte que no toca el DOM). Es el criterio de negocio
// del Production Analyzer: la matriz de `reglasDeCategorias` es el juicio de un consultor puesto en una
// tabla, y por eso se porta idéntica y no «mejorada».
//
// Convive con `production-rules.js`, que es otra lectura de la misma idea (cuatro categorías con
// ids iguales, pero otros textos y una comprobación extra) y que sigue en pie porque todavía la usa el
// Network Analyzer. Cuando el Network Analyzer se migre a v7 con los mismos algoritmos, este módulo
// la reemplaza: ver `docs/PARIDAD-DATA-TOOLS.md`, «Infraestructura reutilizable».
//
// La configuración tiene la forma de v7: `{ MATTYPEID: { excluded, categories: Set, count } }`. La
// pantalla guarda otra (`{ tipo: { excluido, categorias } }`, en `clasificacion-de-tipos.js`, que es
// la que comparten los dos analizadores); `desdeClasificacion` convierte de una a otra.
//
// Sin dependencias: lo usan las pruebas, la pantalla y quien arme el análisis.

/** Las cuatro categorías de v7, en su orden, con el color que les daba la matriz de interruptores. */
export const MATTYPE_CATS = Object.freeze([
  { id: 'finished', color: 'var(--accent)', ruleCount: 5 },
  { id: 'semi', color: 'var(--cyan)', ruleCount: 7 },
  { id: 'rawmat', color: 'var(--green)', ruleCount: 4 },
  { id: 'trading', color: 'var(--purple)', ruleCount: 4 },
])

/**
 * Los textos de cada categoría: son `mattype.cat.*` de `es.json` de v7, literales.
 *
 * Alimentan el tooltip «?» de la cabecera de la matriz (descripción, reglas, «Ej: …»), la hoja
 * Resumen del Excel y el resumen de categorías.
 */
export const TEXTOS_DE_CATEGORIA = Object.freeze({
  finished: {
    label: 'Producto Terminado',
    desc: 'Producto fabricado internamente mediante un proceso de producción.',
    rules: [
      'Requiere BOM completo (PSH + componentes PSI)',
      'Requiere recurso productivo (PSR)',
      'Debe tener ruta desde planta de origen',
      'Lead time de producción (PLEADTIME) obligatorio — si es 0 se marca 🔴',
      'Falta de Location Source = 🔴 crítico',
    ],
    example: 'FG_BOTELLA_500ML, PT_SHAMPOO_1L',
  },
  semi: {
    label: 'Semiterminado',
    desc: 'Componente fabricado internamente que alimenta otro proceso productivo; no se entrega directamente al cliente.',
    rules: [
      'Requiere BOM (PSH + PSI) y recurso (PSR)',
      'Produce y consume en misma planta = ✅ OK (sin transferencia requerida)',
      'Produce en planta A, transfiere y consume en planta B = ✅ OK',
      'Produce sin consumo local ni transferencia = 🔴 problema',
      'Transfiere a destino sin consumo PSI = 🔴 problema',
      'Consume localmente pero transfiere a destino sin consumo = 🟡 advertencia',
      'PLEADTIME = 0 se marca 🟡',
    ],
    example: 'SF_TAPA_ROSCA, WIP_MEZCLA_BASE',
  },
  rawmat: {
    label: 'Mat. Prima / Insumo',
    desc: 'Ítem adquirido externamente; no se fabrica ni transforma internamente.',
    rules: [
      'No requiere BOM (PSH/PSI) ni recurso (PSR)',
      'Debe existir arco de proveedor/origen en la red — si falta = 🔴',
      'No se evalúa PLEADTIME ni ruta a cliente',
      'No necesita estar asociado a una planta como origen',
    ],
    example: 'RM_RESINA_PET, INS_COLORANTE_AZUL',
  },
  trading: {
    label: 'Mercadería',
    desc: 'Producto comprado y revendido sin transformación (trading / reventa).',
    rules: [
      'No requiere BOM (PSH/PSI) ni recurso (PSR)',
      'Debe tener Location Source definida — si falta = 🔴',
      'Debe existir ruta de abastecimiento completa (origen → destino) — si falta = 🔴',
      'PLEADTIME no se evalúa',
    ],
    example: 'TR_ACCESORIO_VALVULA, MER_FILTRO_REPUESTO',
  },
})

/** Los ids válidos de categoría. */
export const IDS_DE_CATEGORIA_V7 = Object.freeze(MATTYPE_CATS.map((una) => una.id))

const str = (v) => (v === null || v === undefined ? '' : String(v).trim())

/**
 * La configuración inicial a partir del maestro de productos (`mattyeInit`).
 *
 * Cuenta cuántos productos hay de cada `MATTYPEID` (los que no lo tienen no cuentan). Todo arranca
 * incluido y sin categoría. `productos` puede ser un objeto `{ PRDID: registro }`, un `Map` o una
 * lista de registros.
 */
export function iniciarTipos(productos) {
  const filas = productos instanceof Map
    ? [...productos.values()]
    : Array.isArray(productos) ? productos : Object.values(productos ?? {})

  const counts = {}
  for (const fila of filas) {
    const mt = str(fila?.MATTYPEID)
    if (!mt) continue
    counts[mt] = (counts[mt] || 0) + 1
  }

  const cfg = {}
  for (const mt of Object.keys(counts)) {
    cfg[mt] = { excluded: false, categories: new Set(), count: counts[mt] }
  }
  return cfg
}

/**
 * Convierte la clasificación que guarda la pantalla a la configuración de v7.
 *
 * `clasificacion` es `{ tipo: { excluido, categorias, productos } }`. Las categorías que v7 no
 * conoce se descartan: no tienen regla y se tratarían como «ninguna regla pide nada».
 */
export function desdeClasificacion(clasificacion, cuenta = {}) {
  const cfg = {}
  for (const [mt, suya] of Object.entries(clasificacion ?? {})) {
    cfg[mt] = {
      excluded: Boolean(suya?.excluido),
      categories: new Set((suya?.categorias ?? []).filter((una) => IDS_DE_CATEGORIA_V7.includes(una))),
      count: cuenta[mt] ?? suya?.productos ?? 0,
    }
  }
  return cfg
}

/**
 * Las categorías efectivas de un tipo (`mattypeGetCategories`).
 *
 *   sin configuración o sin categoría → `['uncategorized']`
 *   excluido                          → `['excluded']`
 *   con categorías                    → esas, en el orden en que se marcaron
 */
export function categoriasDe(cfg, mattypeid) {
  const suya = cfg?.[mattypeid]
  if (!suya) return ['uncategorized']
  if (suya.excluded) return ['excluded']
  if (suya.categories.size === 0) return ['uncategorized']
  return Array.from(suya.categories)
}

/** Si el tipo está excluido del análisis (`mattypeIsExcluded`). */
export function estaExcluido(cfg, mattypeid) {
  const suya = cfg?.[mattypeid]
  return suya ? suya.excluded : false
}

/** Orden de severidad de más permisiva a menos: la que gana cuando un tipo tiene varias categorías. */
const ORDEN_PERMISIVO = ['red', 'yellow', 'info', 'none']

function laMasPermisivaV7(vals) {
  let best = 'red'
  for (const v of vals) {
    if (ORDEN_PERMISIVO.indexOf(v) > ORDEN_PERMISIVO.indexOf(best)) best = v
  }
  return best
}

/**
 * Qué se le exige a un tipo según sus categorías (`mattypeGetRules`).
 *
 * Cada regla vale `red`, `yellow`, `info` o `none`. Con varias categorías gana la MÁS permisiva
 * —marcar en rojo algo que en una de sus lecturas es correcto llena el informe de ruido—. Sin
 * categoría, todo lo que alguna categoría pediría pasa a `yellow`, y lo que ninguna pide queda en
 * `none`.
 */
export function reglasDeCategorias(cats) {
  const isAll = cats.indexOf('all') >= 0
  const isUncategorized = cats.indexOf('uncategorized') >= 0

  function rule(finishedVal, semiVal, rawmatVal, tradingVal) {
    if (isUncategorized) {
      const anyNonNone = [finishedVal, semiVal, rawmatVal, tradingVal].some((v) => v !== 'none')
      return anyNonNone ? 'yellow' : 'none'
    }
    if (isAll) return laMasPermisivaV7([finishedVal, semiVal, rawmatVal, tradingVal])
    const vals = cats.map((c) => {
      if (c === 'finished') return finishedVal
      if (c === 'semi') return semiVal
      if (c === 'rawmat') return rawmatVal
      if (c === 'trading') return tradingVal
      return 'none'
    })
    return laMasPermisivaV7(vals)
  }

  return {
    requiresPSH: rule('red', 'red', 'none', 'none'),
    requiresPSI: rule('red', 'red', 'none', 'none'),
    requiresPSR: rule('red', 'red', 'none', 'none'),
    requiresLocPrd: 'red',
    requiresPlantAsOrigin: rule('red', 'none', 'none', 'none'),
    requiresVendorArc: rule('none', 'none', 'red', 'none'),
    requiresAnyOriginDest: rule('none', 'none', 'none', 'red'),
    pleadtimeZero: rule('red', 'yellow', 'none', 'none'),
    outputCoeffZero: rule('red', 'yellow', 'none', 'none'),
    isCoproductOnly: rule('yellow', 'yellow', 'none', 'none'),
    hasPSHUnexpected: rule('none', 'none', 'yellow', 'yellow'),
    notConsumedInBOM: rule('none', 'yellow', 'yellow', 'none'),
    tleadtimeZero: rule('yellow', 'yellow', 'yellow', 'yellow'),
  }
}

/**
 * El resumen de una línea del paso ② (`_mattyeUpdateExcludeSummary`).
 * Los textos son `mattype.status.allIncluded` y `mattype.summary.excluded` de v7.
 */
export function resumenDeExclusionV7(cfg) {
  const excl = Object.keys(cfg ?? {}).filter((k) => cfg[k].excluded)
  const nProds = excl.reduce((s, k) => s + (cfg[k].count || 0), 0)
  if (!excl.length) return 'Todos los tipos incluidos — sin configurar'
  return `${excl.length} tipo(s) excluido(s) · ${nProds} producto(s) omitidos del análisis principal`
}

/**
 * El resumen de una línea del paso ③ (`_mattyeUpdateCatSummary`).
 * Los textos son `mattype.status.noCat`, `mattype.summary.categorized` y `.uncategorized` de v7.
 */
export function resumenDeCategoriasV7(cfg) {
  const types = Object.keys(cfg ?? {}).filter((k) => !cfg[k].excluded)
  const catted = types.filter((k) => cfg[k].categories.size > 0)
  const uncatted = types.length - catted.length
  if (!catted.length) return 'Sin categorización — análisis estándar para todos los tipos'
  return `${catted.length} tipo(s) categorizado(s)` + (uncatted > 0 ? ` · ${uncatted} sin categoría (reglas 🟡)` : '')
}

/**
 * El resumen del paso ⑤ (`_paUpdateRunSummary`).
 * `run.paDefault` de v7 cuando no hay nada configurado.
 */
export function resumenDeEjecucionV7(cfg) {
  const keys = Object.keys(cfg ?? {})
  const excl = keys.filter((k) => cfg[k].excluded)
  const catted = keys.filter((k) => !cfg[k].excluded && cfg[k].categories.size > 0)
  const inclPrds = keys.filter((k) => !cfg[k].excluded).reduce((s, k) => s + (cfg[k].count || 0), 0)
  const exclPrds = excl.reduce((s, k) => s + (cfg[k].count || 0), 0)

  if (!excl.length && !catted.length) return 'Configuración por defecto — análisis estándar'

  const parts = []
  parts.push(`${inclPrds} productos incluidos en ${keys.length - excl.length} tipo(s)`)
  if (excl.length) parts.push(`${exclPrds} productos excluidos (${excl.join(', ')})`)
  if (catted.length) parts.push(`${catted.length} tipo(s) categorizados`)
  return parts.join(' · ')
}
