// Una fila real de IBP, para mostrar en la documentación cómo se ve el dato de verdad.
//
// Portado de `fetchIbpSampleRow` de `docs.js` de v9. Es la columna que convierte una especificación
// en algo que se puede revisar de un vistazo: no dice solo que un campo existe, muestra qué hay
// dentro.
//
// A qué entidad preguntarle lo decide `target-entity.js`, que es puro y lo comparte el navegador.

import { sapFetch } from '../transport/sap-fetch.js'
import { serviceRoot } from './catalog.js'

/** Un valor de SAP, listo para una celda. Las fechas de OData V2 vienen como `/Date(…)/`. */
export function formatIbpExample(valor) {
  if (valor === null || valor === undefined) return ''
  // Una propiedad de navegación viene como objeto y no es un dato que mostrar.
  if (typeof valor === 'object') return ''

  if (typeof valor === 'string') {
    const fecha = valor.match(/^\/Date\((-?\d+)(?:[+-]\d+)?\)\/$/)
    return fecha ? new Date(Number(fecha[1])).toISOString().slice(0, 10) : valor
  }

  return String(valor)
}

/**
 * Trae UNA fila de la entidad. Nunca lanza: devuelve por qué no pudo.
 *
 * `PLANNINGAREA` es un parámetro obligatorio de los dos servicios. Los nombres de campo se
 * devuelven en mayúsculas porque así se comparan con los del export de CI-DS.
 */
export async function readSampleRow({ baseUrl, credentials, service, entitySet, planArea, selectFields = [] }) {
  const partes = ['$top=1', '$format=json']
  if (selectFields.length > 0) partes.push(`$select=${selectFields.join(',')}`)
  partes.push(`PLANNINGAREA=${encodeURIComponent(planArea)}`)

  const url = `${serviceRoot(baseUrl, service)}/${entitySet}?${partes.join('&')}`

  try {
    const { json } = await sapFetch({ url, credentials, kind: 'ibp' })
    const filas = json?.d?.results ?? json?.value ?? []
    if (filas.length === 0) return { row: null, detail: 'la entidad no devolvió ninguna fila' }

    const fila = {}
    for (const [campo, valor] of Object.entries(filas[0])) {
      // `__metadata` es la envoltura de OData, no un dato. Nunca coincide con un campo destino, así
      // que solo ocuparía lugar.
      if (campo.startsWith('__')) continue
      fila[campo.toUpperCase()] = valor
    }
    return { row: fila, detail: '' }
  } catch (error) {
    // `detail` trae el mensaje de SAP, que dice qué falta; `message` solo dice "SAP devolvió 400".
    // Es la diferencia entre un aviso accionable y uno inútil.
    return { row: null, detail: error?.detail || error?.message || 'error al consultar' }
  }
}
