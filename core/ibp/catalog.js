// El catálogo de campos de IBP: cómo se llama cada uno, de qué tipo es y en qué entidad vive.
//
// Portado de `fetchIbpMeta` y `formatEdmType` de `docs.js` de v9. Lo usa el documentador para
// completar dos columnas del Excel que el export de CI-DS no puede saber: la etiqueta legible de
// cada campo y su tipo de dato en IBP.
//
// Se lee con expresiones sobre el texto y no con un analizador de XML, por el mismo motivo que
// `core/transport/metadata.js`: el `$metadata` de dato maestro pesa unos 4,8 MB y Node no trae
// analizador de serie. Montar uno para leer cuatro atributos por etiqueta sería cargar con una
// dependencia grande para nada.

import { sapFetch } from '../transport/sap-fetch.js'

/** Los dos servicios de los que sale el catálogo, en orden de preferencia. */
export const SERVICIOS = Object.freeze(['MASTER_DATA_API_SRV', 'PLANNING_DATA_API_SRV'])

/** La raíz de un servicio de IBP. */
export const serviceRoot = (baseUrl, service) => `${String(baseUrl).replace(/\/+$/, '')}/sap/opu/odata/IBP/${service}`

/**
 * El tipo OData de un campo, traducido al tipo de HANA que se le muestra al cliente.
 *
 * `Edm.String` con `MaxLength=36` es `NVARCHAR(36)`; `Edm.Decimal` con precisión y escala es
 * `DECIMAL(18,6)`. Es el vocabulario con el que se habla en un proyecto de IBP.
 */
export function formatEdmType(type, maxLength, precision, scale) {
  if (!type) return ''
  const nombre = String(type).replace(/^Edm\./, '')

  switch (nombre) {
    case 'String': return maxLength ? `NVARCHAR(${maxLength})` : 'NVARCHAR'
    case 'Binary': return maxLength ? `VARBINARY(${maxLength})` : 'VARBINARY'
    case 'Decimal':
      if (precision && scale !== null && scale !== undefined) return `DECIMAL(${precision},${scale})`
      return precision ? `DECIMAL(${precision})` : 'DECIMAL'
    case 'Byte':
    case 'SByte': return 'TINYINT'
    case 'Int16': return 'SMALLINT'
    case 'Int32': return 'INTEGER'
    case 'Int64': return 'BIGINT'
    case 'Single': return 'REAL'
    case 'Double': return 'DOUBLE'
    case 'Boolean': return 'BOOLEAN'
    case 'DateTime':
    case 'DateTimeOffset': return 'TIMESTAMP'
    case 'Time': return 'TIME'
    case 'Guid': return 'NVARCHAR(36)'
    default: return nombre.toUpperCase()
  }
}

/** Un atributo de una etiqueta XML. */
const attr = (tag, nombre) => tag.match(new RegExp(`\\b${nombre}="([^"]*)"`))?.[1]

/**
 * Lee un `$metadata` a `{ descs, types, entitySets, entityProps }`.
 *
 * `entityProps` se llena SIEMPRE para datos de planificación: ahí el `$select` es obligatorio y tiene
 * que nombrar propiedades que existan de verdad. Los campos de la tabla de staging de CI-DS
 * —`KEYFIGUREDATE` y compañía— no existen en la entidad, y pedirlos devuelve un error.
 *
 * Para dato maestro se llena solo si se pide con `conCampos`. No es gratis —son unas seiscientas
 * entidades con decenas de campos cada una— y quien documenta mapeos no los necesita. El explorador
 * sí: sin ellos no puede saber qué tabla de ESTE tenant es el maestro de productos y qué tabla es
 * producto-por-cliente, porque las dos se llaman parecido y solo los campos las distinguen.
 */
export function parseCatalog(xml, service, { conCampos = false } = {}) {
  const texto = String(xml ?? '')

  const descs = {}
  const types = {}

  for (const match of texto.matchAll(/<Property\b[^>]*>/g)) {
    const tag = match[0]
    const name = attr(tag, 'Name')
    if (!name) continue

    const label = attr(tag, 'sap:label')
    if (label && !descs[name]) descs[name] = label

    const nombre = name.toUpperCase()
    const type = attr(tag, 'Type')
    if (type && !(nombre in types)) {
      types[nombre] = formatEdmType(type, attr(tag, 'MaxLength'), attr(tag, 'Precision'), attr(tag, 'Scale'))
    }
  }

  const entitySets = []
  for (const match of texto.matchAll(/<EntitySet\b[^>]*>/g)) {
    const name = attr(match[0], 'Name')
    if (name) entitySets.push({ name, nameUC: name.toUpperCase(), service })
  }

  const entityProps = {}
  if (service === 'PLANNING_DATA_API_SRV' || conCampos) {
    const porTipo = {}
    for (const match of texto.matchAll(/<EntityType\b[^>]*>[\s\S]*?<\/EntityType>/g)) {
      const bloque = match[0]
      const nombre = attr(bloque.match(/<EntityType\b[^>]*>/)[0], 'Name')
      if (!nombre) continue
      porTipo[nombre] = new Set(
        [...bloque.matchAll(/<Property\b[^>]*>/g)]
          .map((una) => attr(una[0], 'Name'))
          .filter(Boolean)
          .map((una) => una.toUpperCase()),
      )
    }

    for (const match of texto.matchAll(/<EntitySet\b[^>]*>/g)) {
      const tag = match[0]
      const name = attr(tag, 'Name')
      const tipo = (attr(tag, 'EntityType') || '').split('.').pop()
      if (name && porTipo[tipo]) entityProps[name.toUpperCase()] = porTipo[tipo]
    }
  }

  return { descs, types, entitySets, entityProps }
}

/**
 * Junta los catálogos de varios servicios en uno.
 *
 * Gana el primero que definió cada campo, y por eso el orden de `SERVICIOS` importa: la etiqueta y
 * el tipo de dato maestro son los buenos, y los de planificación no deben pisarlos.
 */
export function mergeCatalogs(catalogos) {
  const junto = { descs: {}, types: {}, entitySets: [], entityProps: {} }

  for (const uno of catalogos) {
    for (const [campo, valor] of Object.entries(uno.descs)) if (!(campo in junto.descs)) junto.descs[campo] = valor
    for (const [campo, valor] of Object.entries(uno.types)) if (!(campo in junto.types)) junto.types[campo] = valor
    junto.entitySets.push(...uno.entitySets)
    Object.assign(junto.entityProps, uno.entityProps)
  }

  return junto
}

/**
 * Las áreas de planificación del tenant.
 *
 * SAP no las lista en ningún lado, pero cada una expone los conjuntos `<AREA>` y `<AREA>Trans`. Se
 * buscan los que terminan en `Trans` cuyo conjunto base también existe, y eso descarta los
 * especiales que no son áreas.
 */
export function planningAreasFrom(entitySets) {
  const nombres = new Set(entitySets.filter((uno) => uno.service === 'PLANNING_DATA_API_SRV').map((uno) => uno.name))

  const areas = []
  for (const nombre of nombres) {
    if (!nombre.endsWith('Trans')) continue
    const base = nombre.slice(0, -'Trans'.length)
    if (base && nombres.has(base)) areas.push(base)
  }

  return areas.sort((a, b) => a.localeCompare(b))
}

/**
 * Trae el catálogo del tenant.
 *
 * Los dos servicios se piden a la vez y con `allSettled`: un tenant puede tener habilitado uno y no
 * el otro, y con el que conteste ya se puede documentar. Solo se falla si no contesta ninguno —ahí
 * el problema es la conexión, y decir "sin etiquetas" escondería el motivo real.
 */
export async function readCatalog({ baseUrl, credentials, services = SERVICIOS, conCampos = false }) {
  const respuestas = await Promise.allSettled(services.map(async (service) => {
    const { text } = await sapFetch({
      url: `${serviceRoot(baseUrl, service)}/$metadata`,
      credentials,
      kind: 'ibp',
      expect: 'xml',
    })
    return parseCatalog(text, service, { conCampos })
  }))

  const buenas = respuestas.filter((una) => una.status === 'fulfilled').map((una) => una.value)
  if (buenas.length === 0) {
    const motivo = respuestas[0]?.reason
    throw new Error(motivo?.message || 'Ningún servicio de IBP contestó al pedir su catálogo.')
  }

  const catalogo = mergeCatalogs(buenas)
  const fallados = services.filter((_, i) => respuestas[i].status === 'rejected')

  return { ...catalogo, planAreas: planningAreasFrom(catalogo.entitySets), fallados }
}
