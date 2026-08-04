// Lectura del XML que devuelve SAP CI-DS.
//
// Portado de `api/soap.js` de v9, que es la implementación viva y la mejor hecha de las tres.
// Se lee con expresiones sobre el texto, no con un analizador de XML: las respuestas de CI-DS
// mezclan prefijos de espacio de nombres de forma inconsistente entre tenants, y buscar la
// etiqueta ignorando el prefijo resulta más robusto que exigir el espacio de nombres correcto.

/** Los nombres de etiqueta salen de constantes nuestras; se valida para no armar una expresión rara. */
function safeTag(tag) {
  if (!/^\w+$/.test(String(tag))) throw new Error(`Nombre de etiqueta no válido: "${tag}"`)
  return tag
}

/** Escapa lo que va dentro de un elemento XML. */
export function escapeXml(value) {
  if (value == null) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Contenido de la primera etiqueta que coincida, sin importar el prefijo. */
export function xmlValue(xml, tag) {
  const t = safeTag(tag)
  const match = String(xml).match(
    new RegExp(`<(?:[\\w]+:)?${t}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w]+:)?${t}>`, 'i'),
  )
  return match ? match[1].trim() : null
}

/** Todas las apariciones de una etiqueta, como trozos de XML en bruto. */
export function xmlAll(xml, tag) {
  const t = safeTag(tag)
  const re = new RegExp(`<(?:[\\w]+:)?${t}(?:\\s[^>]*)?>[\\s\\S]*?<\\/(?:[\\w]+:)?${t}>`, 'gi')
  return [...String(xml).matchAll(re)].map((m) => m[0])
}

/** Valor de un atributo en la apertura de una etiqueta. */
export function xmlAttribute(xml, tag, attribute) {
  const t = safeTag(tag)
  const a = safeTag(attribute)
  const match = String(xml).match(new RegExp(`<(?:[\\w]+:)?${t}[^>]*\\s${a}="([^"]*)"`, 'i'))
  return match ? match[1] : null
}

/** Texto plano de un trozo de XML, quitando etiquetas y secciones CDATA. */
export function xmlText(xml) {
  return String(xml).replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim()
}

/**
 * El error que devuelve SAP cuando algo falla, o `null` si la respuesta es buena.
 * El detalle viene en distintos sitios según la operación, de ahí la cadena de alternativas.
 */
export function parseFault(xml) {
  const code = xmlValue(xml, 'faultcode') || xmlValue(xml, 'faultCode')
  const text = xmlValue(xml, 'faultstring') || xmlValue(xml, 'faultString')
  if (!code && !text) return null
  const detail = xmlValue(xml, 'message') || xmlValue(xml, 'detail') || xmlValue(xml, 'WebFaultException')
  return { faultCode: code, faultString: detail ? `${text} — ${detail}` : text }
}

/**
 * Tapa el identificador de sesión antes de que un XML acabe en un registro o en una pantalla
 * de depuración. Ese identificador vale tanto como una contraseña mientras dura.
 */
export function redactSessionId(xml = '') {
  return String(xml).replace(
    /<(?:[\w]+:)?SessionId>([\s\S]*?)<\/(?:[\w]+:)?SessionId>/gi,
    '<SessionId>[oculto]</SessionId>',
  )
}
