// Armado de la consulta que se le manda a SAP.
//
// Dos reglas duras van cosidas aquí, y las dos vienen de comprobaciones en tenants reales:
//
//  1. **En datos de planificación, `$select` define el nivel de agregación.** Pedir menos
//     atributos no devuelve las mismas filas con menos columnas: hace que SAP SUME por su
//     cuenta a un nivel más alto. El total sigue siendo correcto, pero ya no es el mismo dato.
//     Por eso `$select` es obligatorio para datos de planificación.
//
//  2. **Al paginar hace falta un orden estable.** Sin él, dos lecturas seguidas pueden
//     devolver las filas en distinto orden, y entonces las ventanas se solapan y se pierden
//     filas por el medio. Con lecturas en paralelo es seguro que ocurre.

import { assertNoSilentPredicate } from './filter.js'

export const SERVICES = Object.freeze({ MASTER: 'master', PLANNING: 'planning' })

const encode = (value) => encodeURIComponent(value)

/**
 * Construye la parte de la consulta (lo que va después del `?`).
 *
 * `service` es 'master' o 'planning'. Se exige porque las dos reglas de arriba solo aplican a
 * datos de planificación, y adivinarlo por la URL sería frágil.
 */
export function buildQuery({
  service,
  select,
  filter,
  top,
  skip,
  orderby,
  inlinecount = false,
} = {}) {
  if (service !== SERVICES.MASTER && service !== SERVICES.PLANNING) {
    throw new Error(`Servicio desconocido: "${service}". Debe ser 'master' o 'planning'.`)
  }

  const selectList = Array.isArray(select) ? select.join(',') : select

  if (service === SERVICES.PLANNING && !selectList) {
    throw new Error(
      'En datos de planificación $select es obligatorio: sin él SAP agrega a un nivel más ' +
      'alto y devuelve un dato distinto del pedido.',
    )
  }

  // Nunca `$top=0` en datos de planificación: revienta el servidor de SAP con un fallo de
  // memoria (TSV_TNEW_PAGE_ALLOC_FAILED) en los niveles detallados, porque intenta
  // materializar el conjunto completo. En dato maestro sí es seguro y se usa para contar.
  if (service === SERVICES.PLANNING && top === 0) {
    throw new Error(
      'En datos de planificación $top=0 tumba el servicio. Para contar hay que usar un $top ' +
      'pequeño junto con $inlinecount (ver countRows).',
    )
  }

  if (filter) assertNoSilentPredicate(filter)

  const parts = ['$format=json']
  if (selectList) parts.push(`$select=${encode(selectList)}`)
  if (filter) parts.push(`$filter=${encode(filter)}`)
  if (orderby) {
    const orderList = Array.isArray(orderby) ? orderby.join(',') : orderby
    if (orderList) parts.push(`$orderby=${encode(orderList)}`)
  }
  if (Number.isFinite(top)) parts.push(`$top=${top}`)
  if (Number.isFinite(skip) && skip > 0) parts.push(`$skip=${skip}`)
  if (inlinecount) parts.push('$inlinecount=allpages')

  return parts.join('&')
}

/** URL completa de una lectura: raíz del servicio + entidad + consulta. */
export function buildReadUrl({ serviceRoot, entity, ...query }) {
  if (!serviceRoot) throw new Error('buildReadUrl necesita la raíz del servicio.')
  if (!entity) throw new Error('buildReadUrl necesita el nombre de la entidad.')
  const root = serviceRoot.replace(/\/+$/, '')
  return `${root}/${entity}?${buildQuery(query)}`
}
