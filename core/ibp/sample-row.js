// Una fila real de IBP, para mostrar en la documentación cómo se ve el dato de verdad.
//
// Portado de `fetchIbpSampleRow` de `docs.js` de v9. Es la columna que convierte una especificación
// en algo que se puede revisar de un vistazo: no dice solo que un campo existe, muestra qué hay
// dentro.
//
// A qué entidad preguntarle lo decide `target-entity.js`, que es puro y lo comparte el navegador.

import { sapFetch } from '../transport/sap-fetch.js'
import { SERVICIOS, serviceRoot } from './catalog.js'
import { esNombreSeguro } from './nombre-seguro.js'

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

/** Cuántas filas se piden como máximo. v9 usa 50 y, si faltan campos, 200: más no aporta. */
export const TOPE_DE_MUESTRA = 200
export const MUESTRA_POR_OMISION = 50

/**
 * Trae una MUESTRA de la entidad y la junta en una sola fila. Nunca lanza: devuelve por qué no pudo.
 *
 * Se piden varias filas (`top`, 50 por omisión) y, por cada campo, se toma el PRIMER valor no vacío
 * de todas ellas. Así el ejemplo no queda en blanco cuando la primera fila no tiene valor para ese
 * campo, que haría parecer la documentación incompleta (`fetchIbpSampleRow` de v9). La fila devuelta
 * es, entonces, un compuesto de valores reales, no una fila única.
 *
 * `PLANNINGAREA` es un parámetro obligatorio de los dos servicios. Los nombres de campo se
 * devuelven en mayúsculas porque así se comparan con los del export de CI-DS. El `$top` es siempre
 * mayor que cero: contar con `$top=0` revienta `PLANNING_DATA_API_SRV`.
 */
export async function readSampleRow({
  baseUrl, credentials, service, entitySet, planArea, selectFields = [], top = MUESTRA_POR_OMISION,
}) {
  // El servicio y la entidad van pegados a la ruta, y los campos al `$select`: se aceptan solo nombres que
  // no puedan armar otra consulta con las credenciales de la conexión. Un campo con un nombre raro se
  // descarta —SAP lo habría rechazado de todos modos— y una entidad o un servicio raros no se consultan.
  if (!SERVICIOS.includes(service)) return { row: null, detail: 'servicio no válido' }
  if (!esNombreSeguro(entitySet)) return { row: null, detail: 'nombre de entidad no válido' }
  selectFields = selectFields.filter(esNombreSeguro)

  const pedido = Math.trunc(Number(top))
  const filasPedidas = Math.min(pedido > 0 ? pedido : MUESTRA_POR_OMISION, TOPE_DE_MUESTRA)
  const partes = [`$top=${filasPedidas}`, '$format=json']
  if (selectFields.length > 0) partes.push(`$select=${selectFields.join(',')}`)
  partes.push(`PLANNINGAREA=${encodeURIComponent(planArea)}`)

  const url = `${serviceRoot(baseUrl, service)}/${entitySet}?${partes.join('&')}`

  try {
    const { json } = await sapFetch({ url, credentials, kind: 'ibp' })
    const filas = json?.d?.results ?? json?.value ?? []
    if (filas.length === 0) return { row: null, detail: 'respuesta sin filas' }

    const fila = {}
    for (const registro of filas) {
      for (const [campo, valor] of Object.entries(registro)) {
        // `__metadata` es la envoltura de OData, no un dato. Nunca coincide con un campo destino, así
        // que solo ocuparía lugar.
        if (campo.startsWith('__')) continue
        const clave = campo.toUpperCase()
        if (clave in fila) continue
        if (formatIbpExample(valor) !== '') fila[clave] = valor
      }
    }
    return { row: fila, detail: '' }
  } catch (error) {
    // `detail` trae el mensaje de SAP, que dice qué falta; `message` solo dice "SAP devolvió 400".
    // Es la diferencia entre un aviso accionable y uno inútil.
    return { row: null, detail: error?.detail || error?.message || 'error al consultar' }
  }
}

/**
 * La consulta dirigida de v9 (`fetchFieldExampleMD`): UN valor no vacío de UN campo de dato maestro.
 *
 * Es el respaldo cuando la muestra dejó un campo vacío porque el dato es disperso: filtra
 * `CAMPO ne ''` y se queda con la primera fila. Solo vale en dato maestro. En planning no aplica
 * —seleccionar un solo atributo lo rechaza el servicio—, y la regla de SAP de que `KF ne 0` se
 * ignora tampoco: aquí el campo es de texto y el predicado que descarta lo vacío es justo lo que se
 * busca. Nunca lanza: sin valor devuelve `null`.
 */
export async function readFieldExample({ baseUrl, credentials, entitySet, planArea, field }) {
  if (!esNombreSeguro(entitySet) || !esNombreSeguro(field)) return { value: null }

  const filtro = encodeURIComponent(`${field} ne ''`)
  const partes = [
    '$top=1', '$format=json', `$select=${field}`, `$filter=${filtro}`,
    `PLANNINGAREA=${encodeURIComponent(planArea)}`,
  ]
  const url = `${serviceRoot(baseUrl, 'MASTER_DATA_API_SRV')}/${entitySet}?${partes.join('&')}`

  try {
    const { json } = await sapFetch({ url, credentials, kind: 'ibp' })
    const registro = (json?.d?.results ?? json?.value ?? [])[0]
    if (!registro) return { value: null }

    const clave = Object.keys(registro).find((uno) => uno.toUpperCase() === String(field).toUpperCase())
    const valor = clave === undefined ? undefined : registro[clave]
    return { value: formatIbpExample(valor) !== '' ? valor : null }
  } catch {
    return { value: null }
  }
}
