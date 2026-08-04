// Construcción de filtros para SAP, con las reglas medidas contra tenants reales metidas
// como candados en el código.
//
// Estas reglas no son opiniones: son comportamientos comprobados de SAP que costaron horas de
// depuración en v8. Van aquí, y no en un comentario, porque un comentario se salta.

/** Las fechas de OData v2 llegan como "/Date(1753734272000+0000)/". */
const ODATA_DATE = /^\/Date\((\d+)([+-]\d{4})?\)\/$/

/** Escapa un texto para OData: la comilla simple se duplica. */
export function escapeText(value) {
  return String(value).replace(/'/g, "''")
}

/**
 * Valor tal como hay que escribirlo en un filtro.
 *
 * Una fecha NO se puede comparar como si fuera texto entre comillas — SAP responde "Invalid
 * parametertype used at function 'eq'". Necesita su propia forma, y el tenant devuelve el
 * valor con desplazamiento explícito, así que se emite con desplazamiento.
 */
export function literal(value) {
  const text = String(value)
  const date = text.match(ODATA_DATE)
  if (date) {
    const iso = new Date(Number.parseInt(date[1], 10)).toISOString().replace(/\.\d{3}Z$/, 'Z')
    return `datetimeoffset'${iso}'`
  }
  return `'${escapeText(text)}'`
}

export function splitValues(value) {
  return String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean)
}

/**
 * Filtro para leer solo las filas donde una cifra clave NO vale cero, positivas y negativas.
 *
 * **`KF ne 0` no sirve: SAP lo ignora en silencio y devuelve todo.** No da error, no avisa —
 * simplemente hace como si no estuviera. La forma que funciona es pedir mayor o menor que
 * cero; comprobado en vivo que el total de la unión coincide con la suma de las dos partes.
 */
export function nonZero(keyFigure) {
  if (!keyFigure) throw new Error('nonZero necesita el nombre de una cifra clave.')
  return `(${keyFigure} gt 0 or ${keyFigure} lt 0)`
}

/** Filtro para quedarse solo con las filas cuyo campo tiene algún valor. */
export function notBlank(field) {
  // `gt ''` aprovecha a propósito que cualquier comparación descarta los vacíos: ni nulo ni
  // cadena vacía superan la comparación. `ne ''` NO sirve — SAP lo ignora en silencio; y
  // `ne null` y `startswith(campo,'')` los rechaza con error.
  return `${field} gt ''`
}

/**
 * Revisa un filtro escrito a mano y revienta si contiene algo que SAP ignoraría en silencio.
 * Silencioso es lo peor que puede pasar: el número sale bien formado y está mal.
 */
export function assertNoSilentPredicate(filter) {
  const text = String(filter ?? '')
  if (/\bne\s+0(\b|$)/i.test(text)) {
    throw new Error(
      'SAP ignora "ne 0" en silencio y devuelve todas las filas. Usar nonZero(cifra), ' +
      'que pide "gt 0 or lt 0".',
    )
  }
  if (/\bne\s+''/.test(text)) {
    throw new Error('SAP ignora "ne \'\'" en silencio. Usar notBlank(campo), que pide "gt \'\'".')
  }
  if (/\bne\s+null\b/i.test(text)) {
    throw new Error('SAP rechaza "ne null" con error. Usar notBlank(campo).')
  }
  return filter
}

/**
 * Filtro a partir de condiciones de la interfaz:
 *   [{ field, op: 'in' | 'sw' | 'nb', value: 'A' | 'A,B,C' }]
 *
 * Solo hay operadores de INCLUSIÓN, y es deliberado. La exclusión con `ne` se quitó en v8 tras
 * comprobar en vivo que **cualquier condición sobre un campo descarta además las filas donde
 * ese campo está vacío**: "MARCA ne 'X'" devolvía 3.138 filas de 8.005, porque las ~4.900 con
 * marca en blanco desaparecían, y ninguna variante de sintaxis las recupera. Es decir,
 * "excluir X" perdía los blancos sin decirlo. Para excluir, hay que seleccionar
 * explícitamente todos los demás valores: sale más largo y no engaña.
 */
export function buildConditionFilter(conditions) {
  const parts = []
  for (const condition of conditions ?? []) {
    if (!condition?.field) continue

    if (condition.op === 'nb') {
      parts.push(notBlank(condition.field))
      continue
    }

    const values = splitValues(condition.value)
    if (values.length === 0) continue

    if (condition.op === 'sw') {
      // startswith es una función de texto: aquí no tiene sentido una fecha.
      parts.push(`startswith(${condition.field},'${escapeText(values[0])}')`)
    } else if (values.length === 1) {
      parts.push(`${condition.field} eq ${literal(values[0])}`)
    } else {
      parts.push(`(${values.map((v) => `${condition.field} eq ${literal(v)}`).join(' or ')})`)
    }
  }
  return parts.join(' and ')
}

/** Une trozos de filtro con `and`, descartando los vacíos y envolviendo los compuestos. */
export function andFilters(...fragments) {
  const clean = fragments.filter((f) => typeof f === 'string' && f.trim() !== '')
  if (clean.length === 0) return ''
  if (clean.length === 1) return clean[0]
  return clean.map((f) => (/ or /i.test(f) && !f.startsWith('(') ? `(${f})` : f)).join(' and ')
}
