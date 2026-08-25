// Leer las cifras clave de un tenant: qué áreas hay, qué se puede pedir y cuánto vale.
//
// Portado del lado de LECTURA de `services/planningDataApi.js` de v8. Va por `SAP_COM_0720`, el
// mismo acuerdo que el dato maestro pero OTRO servicio: hay que habilitar el área por separado en
// cada uno.
//
// El área se expone como un conjunto que se llama como ella (`ASIBPTS`). El nombre se DESCUBRE del
// documento de servicio; no se supone nunca.

import { sapFetch } from '../transport/sap-fetch.js'
import { serviceRoot } from './catalog.js'
import {
  areasDesdeConjuntos,
  ATRIBUTOS_DE_CONVERSION,
  conversionQueFalta,
  FILAS_PARA_CONTAR,
  filtroDePlanificacion,
  parseKfMetadata,
  selectDePlanificacion,
  VALOR_DE_SONDEO,
} from './planning-data-model.js'

/** La raíz del servicio de datos de planificación. */
export const planningRoot = (baseUrl) => serviceRoot(baseUrl, 'PLANNING_DATA_API_SRV')

/**
 * Filas por página.
 *
 * El cuello de botella NO es la profundidad del `$skip`: es un costo casi fijo por petición —unos
 * 2,5 s en el tenant de pruebas, plano con la profundidad—. Así que conviene leer pocas páginas
 * grandes y no muchas pequeñas.
 */
export const FILAS_POR_PAGINA = 5000

/** Consulta el área y devuelve el cuerpo ya desenvuelto. */
async function leer({ baseUrl, credentials, area, consulta }) {
  const url = `${planningRoot(baseUrl)}/${area}?$format=json&${consulta}`
  const { json } = await sapFetch({ url, credentials, kind: 'ibp' })
  return json?.d ?? {}
}

/** Las áreas de planificación que este usuario ve en ESTE servicio. */
export async function readPlanningAreas({ baseUrl, credentials }) {
  const { json } = await sapFetch({ url: `${planningRoot(baseUrl)}/?$format=json`, credentials, kind: 'ibp' })
  return areasDesdeConjuntos(json?.d?.EntitySets ?? [])
}

/** Las dimensiones, las cifras clave y sus etiquetas. */
export async function readKfMetadata({ baseUrl, credentials, area }) {
  const { text } = await sapFetch({
    url: `${planningRoot(baseUrl)}/$metadata`,
    credentials,
    kind: 'ibp',
    expect: 'xml',
  })

  const leido = parseKfMetadata(text, area)
  if (!leido) throw new Error(`El área "${area}" no aparece en los metadatos del servicio.`)
  return leido
}

/**
 * Las versiones de planificación del área.
 *
 * Con `$top` acotado: una lectura sin límite de un área grande puede tumbar el servicio, y las
 * versiones son pocas —siete en el tenant de pruebas—.
 */
export async function readVersions({ baseUrl, credentials, area }) {
  const d = await leer({ baseUrl, credentials, area, consulta: '$select=VERSIONID,VERSIONNAME&$top=1000' })

  const vistas = new Map()
  for (const fila of d.results ?? []) {
    if (fila.VERSIONID && !vistas.has(fila.VERSIONID)) {
      vistas.set(fila.VERSIONID, { id: fila.VERSIONID, name: fila.VERSIONNAME || fila.VERSIONID })
    }
  }
  return [...vistas.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * Qué atributos de conversión exige una cifra.
 *
 * Una cifra de cantidad pide la unidad de destino y una de valor pide la moneda, y hay cifras que
 * piden LAS DOS. SAP nombra solo una por respuesta, así que se sondea en rondas: se le da a cada
 * atributo ya encontrado un valor cualquiera —la comprobación mira que esté, no cuánto vale— y se
 * vuelve a preguntar hasta que deja de quejarse.
 *
 * Devuelve los campos que hay que rellenar, en el orden en que SAP los pidió.
 */
export async function detectConversions({ baseUrl, credentials, area, cifra }) {
  const encontrados = []

  for (let ronda = 0; ronda <= ATRIBUTOS_DE_CONVERSION.length; ronda += 1) {
    const conversiones = Object.fromEntries(encontrados.map((campo) => [campo, VALOR_DE_SONDEO]))
    const filtro = filtroDePlanificacion({ conversiones })
    const select = selectDePlanificacion([...encontrados, 'PRDID'], cifra)

    try {
      await leer({
        baseUrl,
        credentials,
        area,
        consulta: `$top=1&$select=${encodeURIComponent(select.join(','))}${filtro ? `&$filter=${encodeURIComponent(filtro)}` : ''}`,
      })
      return encontrados
    } catch (error) {
      const falta = conversionQueFalta(error.detail || error.message)
      // Un error que no nombra un atributo de conversión es otra cosa, y tragárselo escondería el
      // problema real detrás de una lista de conversiones incompleta.
      if (!falta || encontrados.includes(falta)) throw error
      encontrados.push(falta)
    }
  }

  return encontrados
}

/**
 * Cuántas filas devolvería la consulta.
 *
 * Con `$top` pequeño y nunca cero. Ver `FILAS_PARA_CONTAR`.
 */
export async function countKf({ baseUrl, credentials, area, select, filtro }) {
  const d = await leer({
    baseUrl,
    credentials,
    area,
    consulta: `$top=${FILAS_PARA_CONTAR}&$inlinecount=allpages&$select=${encodeURIComponent(select.join(','))}`
      + (filtro ? `&$filter=${encodeURIComponent(filtro)}` : ''),
  })
  return Number.parseInt(d.__count ?? '0', 10)
}

/**
 * Una página de filas.
 *
 * `$select` es obligatorio —sin él SAP contesta "You must pass at least one attribute or one key
 * figure"— y además DEFINE el nivel de agregación, así que quien llama elige con cuidado.
 */
export async function readKfPage({
  baseUrl, credentials, area, select, filtro, orderby, skip = 0, top = FILAS_POR_PAGINA,
}) {
  if (!select?.length) throw new Error('Hay que elegir al menos un atributo o una cifra clave.')

  const partes = [
    `$select=${encodeURIComponent(select.join(','))}`,
    `$top=${top}`,
    `$skip=${skip}`,
  ]
  if (orderby?.length) partes.push(`$orderby=${encodeURIComponent(orderby.join(','))}`)
  if (filtro) partes.push(`$filter=${encodeURIComponent(filtro)}`)

  const d = await leer({ baseUrl, credentials, area, consulta: partes.join('&') })
  return (d.results ?? []).map((fila) => {
    const { __metadata, ...resto } = fila
    return resto
  })
}