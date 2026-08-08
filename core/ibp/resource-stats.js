// Leer del tenant su consumo de CPU y memoria.
//
// Va por el acuerdo `SAP_COM_0068`, que habilita `RES_CONS_STATS_API_SRV` — un único conjunto,
// `RES_CONS_STATS`, con una fila cada diez minutos: `Timestamp`, `CpuUsage` y `MemoryUsage`, los dos
// últimos como texto con dos decimales. Comprobado contra un tenant real.
//
// A diferencia del resto de los servicios de IBP, aquí `Timestamp` SÍ es una fecha de verdad
// (`Edm.DateTimeOffset`), así que el filtro usa el literal `datetimeoffset'…'` y no una cadena.

import { sapFetch } from '../transport/sap-fetch.js'
import { agrupar, intervaloDeAgrupacion, resumenDeRecursos, serieDesdeFilas } from './resource-series.js'

/** La raíz del servicio de consumo de recursos. */
export const resourceRoot = (baseUrl) => `${String(baseUrl).replace(/\/+$/, '')}/sap/opu/odata/IBP/RES_CONS_STATS_API_SRV`

/**
 * Tope de filas por respuesta.
 *
 * Treinta días muestreados cada diez minutos son 4.320 filas; el doble deja margen para un tenant
 * que muestree más fino sin que la respuesta pueda crecer sin límite.
 */
export const RES_CONS_TOP = 10_000

/**
 * La serie de consumo de las últimas `horas`, ya agrupada, con su resumen.
 *
 * Se agrupa aquí y no en la pantalla para no mandar 4.320 puntos por la red y que el navegador los
 * promedie igual. `ahora` se puede fijar desde los tests.
 */
export async function readResourceStats({ baseUrl, credentials, horas = 24, ahora = Date.now() }) {
  const ventana = Number(horas)
  if (!Number.isFinite(ventana) || ventana <= 0) throw new Error('El rango de horas no es válido.')

  const desde = new Date(ahora - ventana * 3600_000).toISOString()
  const filtro = encodeURIComponent(`Timestamp gt datetimeoffset'${desde}'`)
  const url = `${resourceRoot(baseUrl)}/RES_CONS_STATS?$format=json&$filter=${filtro}&$top=${RES_CONS_TOP}`

  const { json } = await sapFetch({ url, credentials, kind: 'ibp' })
  const serie = agrupar(serieDesdeFilas(json?.d?.results ?? json?.value ?? []), intervaloDeAgrupacion(ventana))

  return { horas: ventana, desde, serie, resumen: resumenDeRecursos(serie) }
}
