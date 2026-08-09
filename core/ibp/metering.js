// Leer del tenant su actividad medida: quién lo usó, con qué aplicaciones y cuánto tiempo.
//
// Va por el acuerdo `SAP_COM_0924`. Es el único servicio de IBP que la aplicación usa en OData v4,
// con lo que las respuestas vienen en `value` y no en `d.results`.
//
// Tres cosas de aquí son conocimiento ganado contra un tenant real:
//
//   1. `TimestampStart` de `MtrgActyGroupOverview` se declara con precisión CERO. Un literal con
//      fracción de segundo —lo que devuelve `toISOString()`— hace que SAP conteste 500 con
//      "violates facet information 'Precision'". v8 mandaba siempre la fracción, así que su filtro
//      de fechas para ese conjunto no funcionó en ningún tenant: la pantalla se traía todo el
//      histórico y lo presentaba como si fuera el rango elegido. Es el mismo tropiezo que ya
//      apareció con las fechas de los Application Jobs, y por eso aquí se recorta SIEMPRE.
//
//   2. El servicio NO sabe agregar. `$apply` con `groupby` provoca un vuelco de ABAP
//      (`RAISE_SHORTDUMP`) y `aggregate($count)` contesta 501. Así que las cuentas se hacen leyendo
//      las filas —de ahí que se paginen— y se resumen antes de contestar.
//
//   3. El tope real por respuesta son 5.000 filas, aunque se pida más. Con `$top=20000` devuelve
//      5.000 igual, así que hay que paginar de verdad.

import { sapFetch } from '../transport/sap-fetch.js'

/** La raíz del servicio de actividad medida. */
export const meteringRoot = (baseUrl) =>
  `${String(baseUrl).replace(/\/+$/, '')}/sap/opu/odata4/ibp/api_meteringactivity/srvd_a2x/ibp/api_meteringactivity/0001`

/** Lo máximo que el servicio devuelve de una vez, medido contra un tenant real. */
export const METERING_PAGE = 5000

/**
 * Tope de filas por conjunto.
 *
 * Cuatro páginas. En un tenant mediano, treinta días de actividad de aplicaciones son unas 15.600
 * filas, así que entra entero; el tope está para que un tenant grande no deje la pantalla colgada
 * diez minutos. Cuando se alcanza, la respuesta lo dice en vez de callarlo: v8 se quedaba con las
 * primeras 1.000 de 15.623 y dibujaba el ranking con eso, sin avisar.
 */
export const METERING_MAX = 20_000

/**
 * La marca de tiempo como la acepta este servicio: ISO sin fracción de segundo.
 *
 * Ver el punto 1 de la cabecera. Se recorta siempre, no solo para el conjunto que lo exige: no hay
 * ningún conjunto al que la fracción le aporte algo, y una regla con excepciones se olvida.
 */
export function toMeteringTimestamp(fecha) {
  const d = fecha instanceof Date ? fecha : new Date(fecha)
  if (Number.isNaN(d.getTime())) throw new Error('Fecha inválida al armar el filtro de consumo.')
  return d.toISOString().replace(/\.\d+Z$/, 'Z')
}

/**
 * Los conjuntos que se leen, con el campo por el que filtra cada uno.
 *
 * `MtrgActyBusinessUser` y `MtrgComponent` son catálogos —quién es quién y cómo se llama cada
 * componente—, no actividad: no tienen fecha por la que filtrar.
 */
export const CONJUNTOS_DE_CONSUMO = Object.freeze([
  { clave: 'sesiones', entidad: 'MtrgActyGroupOverview', campo: 'TimestampStart' },
  { clave: 'vistas', entidad: 'MtrgActyExcelAddInPlanningView', campo: 'Timestamp' },
  { clave: 'entradas', entidad: 'MtrgActyExcelAddInLogon', campo: 'Timestamp' },
  { clave: 'aplicaciones', entidad: 'MtrgGenericUIActionUsage', campo: 'Timestamp' },
  { clave: 'alertas', entidad: 'MtrgActyAlertMonitor', campo: 'Timestamp' },
  { clave: 'cifras', entidad: 'MtrgActyExcelAddInChgKeyFig', campo: 'Timestamp' },
  { clave: 'tableros', entidad: 'MtrgDashboard', campo: 'Timestamp' },
  { clave: 'historias', entidad: 'MtrgMngAnalyticStory', campo: 'Timestamp' },
  // Los catálogos siempre completos: quiénes son los usuarios del tenant no depende del período
  // elegido, y es justamente lo que hace falta para saber a quién NO se vio en él.
  { clave: 'usuarios', entidad: 'MtrgActyBusinessUser', sinContexto: true },
  { clave: 'componentes', entidad: 'MtrgComponent', sinContexto: true },
])

/** Escapa un literal de texto de OData: la comilla simple se duplica. */
const literal = (valor) => String(valor ?? '').replace(/'/g, "''")

/**
 * Todas las filas de un conjunto en el rango, paginando hasta el tope.
 *
 * El `$orderby` es obligatorio para paginar: sin un orden estable, dos páginas leídas de una tabla
 * que sigue creciendo se solapan y dejan huecos. Se ordena por la clave del conjunto —`ActivityID` o
 * `UserID`— y no por la fecha, porque la fecha se repite y no desempata.
 */
export async function readMeteringSet({
  baseUrl, credentials, entidad, campo, desde, hasta, usuario, area,
  sinContexto = false, maxFilas = METERING_MAX,
}) {
  const condiciones = []
  if (campo && desde && hasta) {
    condiciones.push(`${campo} ge ${toMeteringTimestamp(desde)} and ${campo} le ${toMeteringTimestamp(hasta)}`)
  }
  // El servicio filtra por usuario y por área, así que se le pide a él: mirar a una persona baja de
  // 15.623 filas a 4.397 en el tenant de pruebas. v8 se traía todo y filtraba en el navegador.
  if (!sinContexto && usuario) condiciones.push(`UserID eq '${literal(usuario)}'`)
  if (!sinContexto && area) condiciones.push(`PlanningAreaID eq '${literal(area)}'`)

  const partes = condiciones.length > 0
    ? [`$filter=${encodeURIComponent(condiciones.join(' and '))}`]
    : []

  const filas = []
  let total = null

  for (let pagina = 0; filas.length < maxFilas; pagina += 1) {
    const consulta = [
      ...partes,
      `$top=${Math.min(METERING_PAGE, maxFilas - filas.length)}`,
      `$skip=${filas.length}`,
      ...(pagina === 0 ? ['$count=true'] : []),
    ].join('&')

    const { json } = await sapFetch({ url: `${meteringRoot(baseUrl)}/${entidad}?${consulta}`, credentials, kind: 'ibp' })
    const lote = json?.value ?? []
    if (pagina === 0) total = Number(json['@odata.count'] ?? lote.length)

    filas.push(...lote)
    if (lote.length === 0 || filas.length >= (total ?? 0)) break
  }

  return { filas, total: total ?? filas.length, truncado: filas.length < (total ?? 0) }
}

/**
 * Todos los conjuntos del rango, a la vez, opcionalmente acotados a un usuario o a un área.
 *
 * En paralelo porque son independientes y el costo de cada petición a IBP es casi todo latencia: en
 * serie, la pantalla tardaría la suma y no el máximo. Un conjunto que falle no tumba la lectura —se
 * devuelve vacío y se anota el aviso—: que el tenant no tenga historias analíticas no es motivo para
 * dejar la pestaña en blanco.
 */
export async function readMetering({ baseUrl, credentials, desde, hasta, usuario, area, maxFilas = METERING_MAX }) {
  const leidos = await Promise.all(CONJUNTOS_DE_CONSUMO.map(async (uno) => {
    try {
      const salida = await readMeteringSet({ baseUrl, credentials, ...uno, desde, hasta, usuario, area, maxFilas })
      return { ...uno, ...salida }
    } catch (error) {
      return { ...uno, filas: [], total: 0, truncado: false, fallo: error.detail || error.message }
    }
  }))

  const datos = Object.fromEntries(leidos.map((uno) => [uno.clave, uno.filas]))
  const avisos = [
    ...leidos.filter((uno) => uno.truncado)
      .map((uno) => `De ${uno.entidad} se leyeron ${uno.filas.length} de ${uno.total} filas: el resumen es de esa parte.`),
    ...leidos.filter((uno) => uno.fallo)
      .map((uno) => `No se pudo leer ${uno.entidad}: ${uno.fallo}`),
  ]

  return { datos, avisos, totales: Object.fromEntries(leidos.map((uno) => [uno.clave, uno.total])) }
}
