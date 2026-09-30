// Las pestañas abiertas de un visor de datos (Ver Dato Maestro / Ver Dato Transaccional).
//
// Portado tal cual de `DataViewer/tabsHelpers.js` de v8.
//
// Cada visor puede tener varias pestañas abiertas a la vez. Se ordenan solas por Área → Versión →
// hoja (la tabla de dato maestro o el nivel de key figures) y cada área lleva un color propio, para
// que los grupos se lean de un vistazo. Lo que se guarda es la DEFINICIÓN de cada pestaña —la
// selección, nunca las filas—, por conexión: los datos se vuelven a pedir al pulsar «Mostrar datos»,
// nunca al restaurar, así que tener ocho pestañas no dispara ocho lecturas contra SAP.

/** Tope de pestañas abiertas por visor. Cada una guarda su página en memoria. */
export const TAB_LIMIT = 8

export const tabsStorageKey = (kind, connId) => `ibp:viewer:tabs:${kind}:${connId}`

// Una pestaña: { id, def, meta }
//   def  — lo que el visor de dentro necesita para rehacerse (área/versión/tabla o nivel). El
//          envoltorio no lo lee nunca.
//   meta — { areaId, versionId, leafLabel, dirty }: con esto se nombra, se ordena y se colorea.

export function loadTabs(kind, connId) {
  try {
    const raw = JSON.parse(localStorage.getItem(tabsStorageKey(kind, connId)))
    if (raw && Array.isArray(raw.tabs) && raw.tabs.length) return raw
  } catch { /* nada guardado o ilegible */ }
  return null
}

export function saveTabs(kind, connId, state) {
  try { localStorage.setItem(tabsStorageKey(kind, connId), JSON.stringify(state)) } catch { /* sin espacio */ }
}

/**
 * El color de acento de un área: estable y para cualquier número de áreas.
 *
 * FNV-1a para repartir bien y después un paso de ángulo áureo, para que dos identificadores casi
 * iguales (AREA1 / AREA2) caigan en tonos lejanos y no en casi el mismo color.
 */
export function areaColor(areaId) {
  if (!areaId) return 'var(--border2)'
  let h = 2166136261
  for (let i = 0; i < areaId.length; i++) { h ^= areaId.charCodeAt(i); h = Math.imul(h, 16777619) }
  const hue = Math.round(((h >>> 0) % 360) * 137.508) % 360
  return `hsl(${hue} 58% 55%)`
}

/**
 * Por área, luego versión, luego hoja.
 *
 * Las pestañas sin área todavía —nuevas, a medio configurar— van AL FINAL y en el orden en que se
 * abrieron, para que no salten de sitio mientras se eligen.
 */
export function sortTabs(tabs) {
  return tabs
    .map((tab, i) => [tab, i])
    .sort(([a, ai], [b, bi]) => {
      const am = a.meta || {}, bm = b.meta || {}
      if (!am.areaId && !bm.areaId) return ai - bi
      if (!am.areaId) return 1
      if (!bm.areaId) return -1
      return String(am.areaId).localeCompare(String(bm.areaId))
        || String(am.versionId || '').localeCompare(String(bm.versionId || ''))
        || String(am.leafLabel || '').localeCompare(String(bm.leafLabel || ''))
        || (ai - bi)
    })
    .map(([tab]) => tab)
}

/** El nombre completo «ÁREA · VERSIÓN · hoja», para el texto que aparece al pasar el ratón. */
export function tabLabel(meta) {
  if (!meta || !meta.areaId) return 'Nueva pestaña'
  return [meta.areaId, meta.versionId || 'base', meta.leafLabel]
    .filter(Boolean)
    .join(' · ')
}

/**
 * La etiqueta de dos líneas de la tira.
 *
 *   primary   — la hoja (tabla o «N KF»); el área mientras no se elige tabla, o «Nueva pestaña».
 *   secondary — la versión, o «base».
 *
 * El área no se escribe: ya la dicen el color, el separador de grupo y el texto completo al pasar
 * el ratón. Repetirla en cada pestaña solo le quita ancho.
 */
export function tabLabelParts(meta) {
  if (!meta || !meta.areaId) return { primary: 'Nueva pestaña', secondary: '' }
  return { primary: meta.leafLabel || meta.areaId, secondary: meta.versionId || 'base' }
}
