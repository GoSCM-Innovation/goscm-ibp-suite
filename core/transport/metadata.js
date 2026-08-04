// Lectura del catálogo de campos de SAP (el `$metadata` del servicio).
//
// El del servicio de dato maestro pesa unos 4,8 MB, y una función de Vercel no puede devolver
// una respuesta tan grande. Recibirla sí puede: el truco, que viene de v8, es leerla aquí y
// devolver solo el par de kilobytes que hacen falta.
//
// Se extrae con expresiones sobre el texto y no con un analizador de XML a propósito: Node no
// trae uno de serie, y montarlo para leer dos atributos de cada etiqueta sería cargar con una
// dependencia grande para nada.

import { sapFetch } from './sap-fetch.js'

/**
 * SAP escribe los acentos como referencias numéricas (&#243; es ó). El orden importa: primero
 * las numéricas, y `&amp;` al final, para que un "&" ya descodificado no se vuelva a
 * interpretar y arrastre lo que venga detrás.
 */
export function decodeXmlEntities(value) {
  return String(value)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * Nombre técnico del campo → etiqueta legible.
 *
 * Gana la primera etiqueta de verdad: SAP repite el mismo campo en varias entidades y en
 * algunas la etiqueta es solo el nombre técnico repetido. Al descartar esas, una entidad
 * posterior puede aportar la etiqueta buena que la primera no traía.
 */
export function extractFieldLabels(xml) {
  const labels = {}
  for (const match of String(xml).matchAll(/<Property\b[^>]*>/g)) {
    const tag = match[0]
    const name = tag.match(/\bName="([^"]*)"/)?.[1]
    const label = tag.match(/\bsap:label="([^"]*)"/)?.[1]
    if (name && label && label !== name && labels[name] == null) {
      labels[name] = decodeXmlEntities(label)
    }
  }
  return labels
}

// Conjuntos que existen en el servicio pero no son tablas de dato maestro que se puedan mirar.
const SKIP_SETS = new Set(['ValueResultSet', 'VersionSpecificMasterDataTypes'])

/**
 * Catálogo de los tipos de dato maestro SIMPLES: los que no dependen de un área de
 * planificación. Hacen falta porque SAP no los lista en ninguna parte —su lista de tipos solo
 * incluye los que sí dependen del área—, así que sin esto no habría forma de saber que
 * existen. Al leerlos del catálogo de campos, se descubren incluso si la tabla está vacía.
 */
export function extractSimpleTypeCatalog(xml) {
  const text = String(xml)

  // Nombre del conjunto consultable → nombre de su tipo. Suelen coincidir, pero se lee el
  // atributo para no suponerlo.
  const setToType = {}
  for (const match of text.matchAll(/<EntitySet\b[^>]*>/g)) {
    const tag = match[0]
    const setName = tag.match(/\bName="([^"]*)"/)?.[1]
    const typeFull = tag.match(/\bEntityType="([^"]*)"/)?.[1]
    if (setName && typeFull) setToType[setName] = typeFull.split('.').pop()
  }

  // De cada tipo: sus campos clave y todos sus campos. El límite de palabra en `<Property\b`
  // es lo que evita capturar `<PropertyRef>` y `<NavigationProperty>`.
  const typeInfo = {}
  for (const match of text.matchAll(/<EntityType\b[^>]*>[\s\S]*?<\/EntityType>/g)) {
    const block = match[0]
    const name = block.match(/Name="([^"]*)"/)?.[1]
    if (!name) continue
    const keyBlock = block.match(/<Key>[\s\S]*?<\/Key>/)?.[0] ?? ''
    typeInfo[name] = {
      keys: [...keyBlock.matchAll(/<PropertyRef\b[^>]*?\bName="([^"]*)"/g)].map((m) => m[1]),
      fields: [...block.matchAll(/<Property\b[^>]*?\bName="([^"]*)"/g)].map((m) => m[1]),
    }
  }

  const catalog = {}
  for (const [setName, typeName] of Object.entries(setToType)) {
    if (SKIP_SETS.has(setName)) continue
    if (/(?:Trans|Message|_VI)$/.test(setName)) continue // conjuntos de escritura, de mensajes y de ayuda de valores
    const info = typeInfo[typeName]
    if (!info || info.keys.length === 0) continue
    if (info.keys.includes('PlanningAreaID')) continue   // depende del área: ya viene en la lista de SAP
    catalog[setName] = info
  }
  return catalog
}

async function readMetadataXml({ metadataUrl, credentials, timeoutMs }) {
  const { text } = await sapFetch({
    url: metadataUrl,
    credentials,
    kind: 'ibp',
    expect: 'xml',
    ...(timeoutMs ? { timeoutMs } : {}),
  })
  return text
}

export async function readFieldLabels(options) {
  return extractFieldLabels(await readMetadataXml(options))
}

export async function readSimpleTypeCatalog(options) {
  return extractSimpleTypeCatalog(await readMetadataXml(options))
}
