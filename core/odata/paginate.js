// Lectura por páginas y conteo.
//
// SAP no entrega tablas grandes de una vez, y tampoco conviene pedírselas: cada petición
// cuesta unos 6 segundos fijos, así que el objetivo es pocas páginas grandes.
//
// Hay dos formas de avanzar y se soportan las dos, porque los tenants no se comportan igual:
//   • Que SAP diga dónde sigue (un enlace al final de la página). Si viene, se sigue — es lo
//     más fiable, porque el que decide dónde cortar es el servidor.
//   • Pedir ventanas por posición. Es lo que hace falta cuando no viene ese enlace, y es
//     donde importa el orden estable.

import { DEFAULT_PAGE_SIZE, PARALLEL_READS } from './page-size.js'
import { SERVICES, buildReadUrl } from './query.js'

/** Las filas de una respuesta, venga en el formato viejo de SAP o en el nuevo. */
export function extractRows(json) {
  if (!json) return []
  if (Array.isArray(json.value)) return json.value            // OData v4
  const d = json.d
  if (Array.isArray(d?.results)) return d.results             // OData v2, colección
  if (Array.isArray(d)) return d
  if (d && typeof d === 'object') return [d]                  // OData v2, una sola entidad
  return []
}

/** El enlace a la página siguiente, si SAP lo manda. */
export function extractNextLink(json) {
  return json?.d?.__next ?? json?.['@odata.nextLink'] ?? null
}

/** El total que SAP informa cuando se le pide con `$inlinecount`. */
export function extractInlineCount(json) {
  const raw = json?.d?.__count ?? json?.['odata.count'] ?? json?.['@odata.count']
  if (raw == null) return null
  const total = Number.parseInt(String(raw), 10)
  return Number.isFinite(total) ? total : null
}

/** Para contar en datos de planificación: `$top` pequeño, nunca cero. */
export const PLANNING_COUNT_TOP = 2

/**
 * Cuántas filas hay. En dato maestro se cuenta con `$top=0`, que ahí es seguro; en datos de
 * planificación con un `$top` pequeño, porque el cero tumba el servicio.
 */
export async function countRows({ read, serviceRoot, entity, service, select, filter }) {
  const top = service === SERVICES.PLANNING ? PLANNING_COUNT_TOP : 0
  const url = buildReadUrl({ serviceRoot, entity, service, select, filter, top, inlinecount: true })
  const total = extractInlineCount(await read(url))
  if (total == null) throw new Error(`SAP no informó el total de filas para ${entity}.`)
  return total
}

/**
 * Recorre las páginas una tras otra. Devuelve cada página como array de filas.
 *
 * Se para cuando SAP deja de mandar enlace de continuación, cuando una página viene más corta
 * de lo pedido, o al alcanzar `maxRows`.
 */
export async function* readPages({
  read,
  serviceRoot,
  entity,
  service,
  select,
  filter,
  orderby,
  pageSize = DEFAULT_PAGE_SIZE,
  maxRows = Infinity,
}) {
  let url = buildReadUrl({ serviceRoot, entity, service, select, filter, orderby, top: pageSize })
  let delivered = 0
  let skip = 0

  for (;;) {
    const json = await read(url)
    const rows = extractRows(json)
    if (rows.length === 0) return

    yield rows
    delivered += rows.length
    if (delivered >= maxRows) return

    const next = extractNextLink(json)
    if (next) {
      // SAP manda la continuación como URL completa o relativa a la raíz del servicio.
      url = next.startsWith('http') ? next : `${serviceRoot.replace(/\/+$/, '')}/${next.replace(/^\/+/, '')}`
      continue
    }

    // Página incompleta: no hay más.
    if (rows.length < pageSize) return

    skip += rows.length
    url = buildReadUrl({ serviceRoot, entity, service, select, filter, orderby, top: pageSize, skip })
  }
}

/** Todas las filas en memoria. Con datasets grandes usar `readPages` y procesar por página. */
export async function readAllRows(options) {
  const rows = []
  for await (const page of readPages(options)) rows.push(...page)
  return rows
}

/**
 * Lectura en paralelo por ventanas de posición, para tablas grandes cuando ya se sabe el total.
 *
 * **Exige orden estable.** Sin él, dos lecturas simultáneas pueden ver las filas en distinto
 * orden y las ventanas se solapan o dejan huecos: faltan filas y sobran otras, sin ningún
 * error que lo delate. Preferimos negarnos a leer antes que devolver un dataset mentiroso.
 *
 * La concurrencia es moderada a propósito: el límite no es nuestro, es el tenant.
 */
export async function readAllRowsConcurrently({
  read,
  serviceRoot,
  entity,
  service,
  select,
  filter,
  orderby,
  total,
  pageSize = DEFAULT_PAGE_SIZE,
  parallel = PARALLEL_READS,
}) {
  const orderList = Array.isArray(orderby) ? orderby.filter(Boolean) : (orderby ? [orderby] : [])
  if (orderList.length === 0) {
    throw new Error(
      'La lectura en paralelo necesita un $orderby estable: sin él las ventanas se solapan y ' +
      'se pierden filas. Si no hay claves con las que ordenar, leer en serie con readPages.',
    )
  }
  if (!Number.isFinite(total) || total < 0) {
    throw new Error('La lectura en paralelo necesita saber el total de filas (usar countRows).')
  }

  const windows = []
  for (let skip = 0; skip < total; skip += pageSize) windows.push(skip)

  const pages = new Array(windows.length)
  let cursor = 0

  const worker = async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= windows.length) return
      const url = buildReadUrl({
        serviceRoot, entity, service, select, filter,
        orderby: orderList, top: pageSize, skip: windows[index],
      })
      pages[index] = extractRows(await read(url))
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, windows.length)) }, worker))

  // Se devuelven en el orden de las ventanas, no en el de llegada.
  return pages.flat()
}
