// Leer el dato maestro de un tenant: qué áreas y tablas hay, cuántas filas y cuáles.
//
// Portado del lado de LECTURA de `services/masterDataApi.js` de v8. Va por `SAP_COM_0720`, que es el
// que habilita `MASTER_DATA_API_SRV` —comprobado: un usuario de `SAP_COM_0326` lo rechaza con 403—.
//
// Dos cosas que este servicio hace y el de datos de planificación NO:
//
//   1. `$top=0` con `$inlinecount` es SEGURO aquí. En `PLANNING_DATA_API_SRV` revienta el tenant con
//      `TSV_TNEW_PAGE_ALLOC_FAILED` y hay que contar con un `$top` pequeño.
//   2. Deduplica del lado del servidor cuando el `$select` proyecta un campo que no es clave, así
//      que los valores distintos de un campo salen en una sola consulta barata. El servicio de
//      planificación rechaza esas lecturas con "This service cannot be used to extract master data".

import { sapFetch } from '../transport/sap-fetch.js'
import { serviceRoot } from './catalog.js'
import { clavesDesdeUri, filtroDeDatos, sinMetadatos } from './master-data-model.js'

/** La raíz del servicio de dato maestro. */
export const masterDataRoot = (baseUrl) => serviceRoot(baseUrl, 'MASTER_DATA_API_SRV')

/** Arma la consulta y pide. Devuelve las filas ya sin el sobre de OData. */
async function leer({ baseUrl, credentials, entidad, consulta }) {
  const url = `${masterDataRoot(baseUrl)}/${entidad}?$format=json&${consulta}`
  const { json } = await sapFetch({ url, credentials, kind: 'ibp' })
  return json?.d ?? {}
}

/**
 * El catálogo de áreas, versiones y tipos de dato maestro específicos de versión.
 *
 * Se trae plano y quien llama lo estructura con `catalogoDesdeVsmt`. En un tenant real son unas 400
 * filas para tres áreas y 176 tipos, así que entra de una.
 */
export async function readVsmt({ baseUrl, credentials, top = 5000 }) {
  const d = await leer({
    baseUrl,
    credentials,
    entidad: 'VersionSpecificMasterDataTypes',
    consulta: `$select=${encodeURIComponent('PlanningAreaID,VersionID,MasterDataTypeID,PlanningAreaDescr,VersionName')}&$top=${top}`,
  })
  return d.results ?? []
}

/**
 * Los tipos de dato maestro que se pueden IMPORTAR.
 *
 * Son los que exponen una entidad `<TIPO>Trans`. Los tipos de referencia y los virtuales no la
 * generan, así que no se pueden cargar por más que aparezcan en el catálogo, y ofrecerlos sería
 * prometer algo que va a fallar al final.
 */
export async function readImportableMdts({ baseUrl, credentials }) {
  const { json } = await sapFetch({
    url: `${masterDataRoot(baseUrl)}/?$format=json`,
    credentials,
    kind: 'ibp',
  })

  const conjuntos = json?.d?.EntitySets ?? []
  return conjuntos
    .filter((uno) => uno.endsWith('Trans'))
    .map((uno) => uno.slice(0, -'Trans'.length))
    .sort()
}

/**
 * Cuántas filas hay.
 *
 * Con `$top=0` y `$inlinecount`, que aquí es seguro. Ver la cabecera.
 */
export async function countEntity({ baseUrl, credentials, entidad, planningArea, versionId, extraFilter }) {
  const filtro = filtroDeDatos({ planningArea, versionId, extraFilter })
  const d = await leer({
    baseUrl,
    credentials,
    entidad,
    consulta: `$top=0&$inlinecount=allpages${filtro ? `&$filter=${encodeURIComponent(filtro)}` : ''}`,
  })
  return Number.parseInt(d.__count ?? '0', 10)
}

/**
 * Una página de filas.
 *
 * `orderby` no es opcional de verdad: sin un orden estable, dos ventanas de `$skip`/`$top` sobre una
 * tabla que alguien está tocando se solapan y dejan huecos. Quien llama pasa las claves de negocio,
 * que es lo único que desempata siempre.
 */
export async function readEntityPage(opciones) {
  const { filas } = await readEntityPageWithTotal(opciones)
  return filas
}

/**
 * Lo mismo, y además cuántas filas hay en total.
 *
 * `conTotal` añade `$inlinecount=allpages`, que en ESTE servicio viaja en la misma respuesta que las
 * filas: saber el total no cuesta una petición más. Importa porque el único criterio de fin que queda
 * sin él es «llegaron menos filas de las pedidas», y eso también es lo que pasa cuando la respuesta
 * viene recortada. Sin un total con el que comparar, una descarga cortada por la mitad se presenta
 * como una tabla completa.
 *
 * `total` sale `null` si no se pidió o si SAP no lo mandó. `null` no es cero: quien llama tiene que
 * distinguir «no lo sé» de «no hay filas».
 */
export async function readEntityPageWithTotal({
  baseUrl, credentials, entidad, skip = 0, top = 2000,
  planningArea, versionId, extraFilter, select, orderby, conTotal = false,
}) {
  const filtro = filtroDeDatos({ planningArea, versionId, extraFilter })
  const partes = [`$top=${top}`, `$skip=${skip}`]
  if (orderby?.length) partes.push(`$orderby=${encodeURIComponent(orderby.join(','))}`)
  if (select?.length) partes.push(`$select=${encodeURIComponent(select.join(','))}`)
  if (filtro) partes.push(`$filter=${encodeURIComponent(filtro)}`)
  if (conTotal) partes.push('$inlinecount=allpages')

  const d = await leer({ baseUrl, credentials, entidad, consulta: partes.join('&') })
  const leido = Number.parseInt(d.__count ?? '', 10)

  return {
    filas: (d.results ?? []).map(sinMetadatos),
    total: Number.isFinite(leido) ? leido : null,
  }
}

/**
 * Qué columnas tiene una tabla, cuáles son sus claves y cuántas filas hay.
 *
 * Las columnas y las claves salen de UNA fila de muestra, porque el `$metadata` del servicio pesa
 * unos 4,8 MB y leerlo para abrir una tabla sería absurdo. Si la tabla está vacía no hay muestra: se
 * devuelve `columnas: []` y `vacia: true`, que no es lo mismo que un fallo de lectura y la pantalla
 * lo dice distinto.
 */
export async function readSchema({ baseUrl, credentials, entidad, planningArea, versionId, extraFilter }) {
  const filtro = filtroDeDatos({ planningArea, versionId })
  const [d, total] = await Promise.all([
    leer({
      baseUrl,
      credentials,
      entidad,
      consulta: `$top=1&$skip=0${filtro ? `&$filter=${encodeURIComponent(filtro)}` : ''}`,
    }),
    countEntity({ baseUrl, credentials, entidad, planningArea, versionId, extraFilter }),
  ])

  const muestra = (d.results ?? [])[0]
  if (!muestra) return { columnas: [], claves: [], total, vacia: true, bytesPorFila: 0 }

  const bytes = JSON.stringify(sinMetadatos(muestra)).length
  return {
    columnas: Object.keys(sinMetadatos(muestra)),
    claves: clavesDesdeUri(muestra.__metadata?.uri),
    total,
    vacia: false,
    // Con una sola fila la medida es gruesa, pero sirve para no pedir 2.000 filas de una tabla cuyas
    // filas pesan un kilobyte cada una.
    bytesPorFila: Math.ceil(bytes * 1.3),
  }
}

/**
 * Los valores distintos de un campo, para poder ofrecerlos en un desplegable.
 *
 * Barato porque el servicio deduplica del lado del servidor. La deduplicación del cliente se hace
 * igual, por si un tenant no lo hace.
 */
export async function readDistinctValues({ baseUrl, credentials, entidad, campo, planningArea, versionId, top = 5000 }) {
  const filtro = filtroDeDatos({ planningArea, versionId })
  const partes = [`$top=${top}`, `$select=${encodeURIComponent(campo)}`]
  if (filtro) partes.push(`$filter=${encodeURIComponent(filtro)}`)

  const d = await leer({ baseUrl, credentials, entidad, consulta: partes.join('&') })

  const vistos = new Set()
  for (const fila of d.results ?? []) {
    const valor = fila[campo]
    if (valor === null || valor === undefined || valor === '') continue
    vistos.add(String(valor))
  }
  return [...vistos].sort()
}