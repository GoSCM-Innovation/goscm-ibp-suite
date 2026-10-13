// El modo «Solo filas distintas» (DISTINCT) del visor de dato maestro.
//
// `MASTER_DATA_API_SRV` deduplica en el servidor cuando el `$select` NO lleva todas las claves de la
// tabla. Comprobado contra un tenant real (STARBRANDS QAS, `SBSOURCEPRODUCTION`, 2.578 filas): con una,
// dos o tres columnas, sean claves, no claves o una mezcla, devuelve exactamente las combinaciones
// únicas. Y tres cosas que hay que sortear:
//
//   1. `$inlinecount` NO cuenta las filas distintas: devuelve siempre el total original (2.578 con 6
//      o 618 filas devueltas). Por eso el total se cuenta leyendo, ver `contarDistintas`.
//   2. `$orderby` por una columna que no está en el `$select` es un error 500 de SAP. Aquí se ordena
//      SOLO por las columnas que se piden, no por las claves como en la lectura normal.
//   3. Paginar con `$skip`/`$top` sobre el resultado distinto es correcto con un orden estable: 618
//      filas en cuatro páginas, sin huecos ni repetidas.

import { FILAS_POR_PETICION, TOPES } from './export-csv.js'

/**
 * El `$select` y el `$orderby` de una lectura distinta.
 *
 * Las claves NO se añaden: son justo lo que impide que SAP deduplique. El orden empieza por la columna
 * elegida (si la hay) y sigue con todas las demás, que es lo único que desempata siempre aquí.
 */
export function consultaDistinct(columnas, sort) {
  const select = [...new Set(columnas ?? [])]
  if (!sort || !select.includes(sort.field)) return { select, orderby: select }
  const primero = `${sort.field}${sort.dir === 'desc' ? ' desc' : ''}`
  return { select, orderby: [primero, ...select.filter((c) => c !== sort.field)] }
}

/**
 * ¿Pedir distinct no cambia nada? Pasa cuando se eligen TODAS las claves: cada fila ya es única.
 * Una tabla sin claves conocidas no puede afirmarlo.
 */
export function distinctSinEfecto(columnas, claves) {
  const vistas = new Set(columnas ?? [])
  return (claves ?? []).length > 0 && claves.every((clave) => vistas.has(clave))
}

/**
 * Cuántas filas distintas hay, leyéndolas.
 *
 * `leerPagina({ skip, top, signal })` es de quien llama y devuelve las filas de esa ventana. Se lee en
 * bloques grandes porque en SAP el costo es por petición y no por fila. Termina con la primera ventana
 * incompleta.
 *
 * `tope` corta aunque SAP siga dando filas: un distinct de cientos de miles de filas es casi la tabla
 * entera y no es lo que se pide con esta opción. Con corte, `truncado` es `true` y `total` es lo leído
 * hasta ahí, que NO es el total. Con `signal` abortado devuelve `null`.
 */
export async function contarDistintas({ leerPagina, tope = TOPES.maestro.maximo, signal }) {
  let total = 0
  for (let skip = 0; ; skip += FILAS_POR_PETICION) {
    if (signal?.aborted) return null
    const filas = await leerPagina({ skip, top: FILAS_POR_PETICION, signal })
    if (signal?.aborted) return null
    total += filas.length
    if (filas.length < FILAS_POR_PETICION) return { total, truncado: false }
    if (total >= tope) return { total, truncado: true }
  }
}
