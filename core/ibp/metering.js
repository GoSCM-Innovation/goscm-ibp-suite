// Leer del tenant su actividad medida: quién lo usó, con qué aplicaciones y cuánto tiempo. Es lo que
// dibuja la pestaña «Telemetría» de v8.
//
// Va por el acuerdo `SAP_COM_0924`. Es el único servicio de IBP que la aplicación usa en OData v4,
// con lo que las respuestas vienen en `value` y no en `d.results`.
//
// Se leen los MISMOS diez conjuntos que leía v8, con los campos que su pantalla mira, y las cuentas
// se hacen en el navegador como allí (`core/ibp/metering-summary.js`). Lo que cambia:
//
//   - LOS TOPES. v8 se quedaba con las primeras 2.000, 1.000 o 500 filas de cada conjunto y dibujaba
//     con eso sin decirlo: de `MtrgGenericUIActionUsage` leía 1.000 de 15.623. Aquí se pagina hasta
//     20.000 por conjunto, y si se llega al tope la respuesta lo dice.
//   - EL ORDEN AL PAGINAR. Sin un `$orderby` estable, dos páginas leídas de una tabla que sigue
//     creciendo se solapan y dejan huecos. Se ordena por la clave de cada conjunto, que se lee del
//     `$metadata` del servicio en vez de suponerla.
//   - LOS CAMPOS. Se piden con `$select` solo los que la pantalla usa, cruzados con los que el
//     servicio declara: pedir uno que no existe hace que SAP rechace la consulta entera.
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
//      las filas —de ahí que se paginen—.
//
//   3. El tope real por respuesta son 5.000 filas, aunque se pida más. Con `$top=20000` devuelve
//      5.000 igual, así que hay que paginar de verdad.

import { sapFetch } from '../transport/sap-fetch.js'
import { compactRows } from './metering-rows.js'

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
 * Lo más que puede pesar la respuesta al navegador.
 *
 * Vercel corta las respuestas de una función en 4,5 MB. Con las filas compactadas un período normal
 * pesa unos cientos de kB; esto es para que un período enorme dé un mensaje claro y no un error
 * genérico de la plataforma.
 */
export const LIMITE_DE_RESPUESTA = 4_000_000

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
 * Los diez conjuntos de v8, en su orden y con la clave con la que los nombraba su pantalla.
 *
 * `campo` es la fecha por la que se filtra el período, `campos` lo que la pantalla de v8 lee de cada
 * fila, y `orden` lo que v8 pedía de orden (solo en las vistas de Excel: `TotalDuration desc`, que es
 * lo que hace que sus «Errores» sean los más lentos). `MtrgActyBusinessUser` y `MtrgComponent` son
 * catálogos —quién es quién y cómo se llama cada componente—, no actividad: no se filtran por fecha.
 */
export const CONJUNTOS_DE_CONSUMO = Object.freeze([
  {
    clave: 'overview', entidad: 'MtrgActyGroupOverview', campo: 'TimestampStart',
    campos: ['UserID', 'PlanningAreaID', 'TimestampStart', 'MeteringComponent', 'NumberOfActions'],
  },
  {
    clave: 'planningViews', entidad: 'MtrgActyExcelAddInPlanningView', campo: 'Timestamp',
    orden: ['TotalDuration desc'],
    campos: [
      'UserID', 'PlanningAreaID', 'Timestamp', 'TimestampStart', 'SuccessfullyCompleted', 'ActivityType',
      'TotalDuration', 'DurationWithoutUserInteraction', 'DurationUnit', 'PlanningViewCells',
      'TemplateName', 'FavoriteName', 'WorksheetName',
    ],
  },
  {
    clave: 'logons', entidad: 'MtrgActyExcelAddInLogon', campo: 'Timestamp',
    campos: ['UserID', 'PlanningAreaID', 'TotalDuration', 'DurationUnit'],
  },
  {
    clave: 'fiori', entidad: 'MtrgGenericUIActionUsage', campo: 'Timestamp',
    campos: ['UserID', 'PlanningAreaID', 'FioriProjectID', 'FioriProjectTitle'],
  },
  {
    clave: 'dashboards', entidad: 'MtrgDashboard', campo: 'Timestamp',
    campos: ['UserID', 'PlanningAreaID'],
  },
  {
    clave: 'stories', entidad: 'MtrgMngAnalyticStory', campo: 'Timestamp',
    campos: ['UserID', 'PlanningAreaID', 'StoryName', 'StoryID'],
  },
  {
    clave: 'alerts', entidad: 'MtrgActyAlertMonitor', campo: 'Timestamp',
    campos: ['UserID', 'PlanningAreaID', 'Timestamp'],
  },
  {
    clave: 'users', entidad: 'MtrgActyBusinessUser',
    campos: ['UserID', 'FullName', 'FirstName', 'LastName'],
  },
  {
    clave: 'components', entidad: 'MtrgComponent',
    campos: ['MeteringComponent', 'MeteringComponentText'],
  },
  {
    clave: 'chgKeyFig', entidad: 'MtrgActyExcelAddInChgKeyFig', campo: 'Timestamp',
    campos: ['UserID', 'PlanningAreaID', 'KeyFigureID', 'KeyFigureCount'],
  },
])

/** Los campos de fecha: de ellos la pantalla solo usa el día (ver `metering-rows.js`). */
const CAMPOS_DE_FECHA = ['Timestamp', 'TimestampStart']

/**
 * De un `$metadata`, cada conjunto con sus campos clave y todos sus campos.
 *
 * Se lee con expresiones sobre el texto, como el resto de los `$metadata` de la aplicación
 * (`core/transport/metadata.js`). El conjunto dice de qué tipo es; el tipo, cuál es su clave.
 */
export function entidadesDelServicio(xml) {
  const texto = String(xml ?? '')

  const tipos = {}
  for (const bloque of texto.matchAll(/<EntityType\b[^>]*>[\s\S]*?<\/EntityType>/g)) {
    const nombre = bloque[0].match(/\bName="([^"]*)"/)?.[1]
    if (!nombre) continue
    const clave = bloque[0].match(/<Key>[\s\S]*?<\/Key>/)?.[0] ?? ''
    tipos[nombre] = {
      claves: [...clave.matchAll(/<PropertyRef\b[^>]*?\bName="([^"]*)"/g)].map((m) => m[1]),
      // El límite de palabra en `<Property\b` es lo que deja fuera `<PropertyRef>` y
      // `<NavigationProperty>`.
      campos: [...bloque[0].matchAll(/<Property\b[^>]*?\bName="([^"]*)"/g)].map((m) => m[1]),
    }
  }

  const conjuntos = {}
  for (const etiqueta of texto.matchAll(/<EntitySet\b[^>]*>/g)) {
    const nombre = etiqueta[0].match(/\bName="([^"]*)"/)?.[1]
    const tipo = etiqueta[0].match(/\bEntityType="([^"]*)"/)?.[1]?.split('.').pop()
    if (nombre && tipo && tipos[tipo]) conjuntos[nombre] = tipos[tipo]
  }
  return conjuntos
}

/** Los conjuntos del servicio de telemetría, con su clave y sus campos. */
export async function readMeteringModel({ baseUrl, credentials }) {
  const { text } = await sapFetch({
    url: `${meteringRoot(baseUrl)}/$metadata`,
    credentials,
    kind: 'ibp',
    expect: 'xml',
  })
  return entidadesDelServicio(text)
}

/**
 * El `$orderby` con el que se pagina un conjunto: el orden que se quiera y, detrás, su clave.
 *
 * La clave va SIEMPRE, también cuando hay otro orden delante: `TotalDuration` se repite y no desempata.
 * Sin clave no hay orden estable, y paginar sin él da páginas que se solapan y huecos; es una de las
 * reglas de SAP del proyecto, así que aquí se niega en vez de seguir.
 */
export function ordenEstable(claves, previo = []) {
  if (!Array.isArray(claves) || claves.length === 0) {
    throw new Error('El conjunto no declara clave: sin un orden estable no se puede paginar.')
  }
  const yaOrdenados = new Set(previo.map((uno) => uno.split(' ')[0]))
  return [...previo, ...claves.filter((clave) => !yaOrdenados.has(clave))].join(',')
}

/**
 * Todas las filas de un conjunto en el rango, paginando hasta el tope.
 *
 * `claves` son la clave del conjunto, para el orden estable; `campos`, lo que se pide con `$select`
 * (ya cruzado con lo que el servicio declara).
 */
export async function readMeteringSet({
  baseUrl, credentials, entidad, campo, desde, hasta, campos = [], claves, orden = [],
  maxFilas = METERING_MAX,
}) {
  const partes = []
  if (campo && desde && hasta) {
    const filtro = `${campo} ge ${toMeteringTimestamp(desde)} and ${campo} le ${toMeteringTimestamp(hasta)}`
    partes.push(`$filter=${encodeURIComponent(filtro)}`)
  }
  partes.push(`$orderby=${encodeURIComponent(ordenEstable(claves, orden))}`)
  if (campos.length > 0) partes.push(`$select=${campos.join(',')}`)

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
    if (pagina === 0) total = Number(json?.['@odata.count'] ?? lote.length)

    filas.push(...lote)
    if (lote.length === 0 || filas.length >= (total ?? 0)) break
  }

  return { filas, total: total ?? filas.length, truncado: filas.length < (total ?? 0) }
}

/**
 * Los diez conjuntos del período, compactados para el navegador.
 *
 * Como en v8, si uno falla falla la lectura entera: la pantalla cruza unos con otros —los activos
 * contra los licenciados, las vistas de Excel contra las áreas— y con uno vacío daría cifras que
 * parecen buenas y no lo son. El contexto (un usuario o un área) NO se aplica aquí: v8 lo aplicaba en
 * el navegador sobre lo ya leído, y cambiarlo era instantáneo.
 */
export async function readMetering({ baseUrl, credentials, desde, hasta, maxFilas = METERING_MAX }) {
  const modelo = await readMeteringModel({ baseUrl, credentials })

  const leidos = await Promise.all(CONJUNTOS_DE_CONSUMO.map(async (uno) => {
    const declarado = modelo[uno.entidad]
    if (!declarado) throw new Error(`El servicio de telemetría no declara el conjunto ${uno.entidad}.`)

    const campos = uno.campos.filter((nombre) => declarado.campos.includes(nombre))
    try {
      const { filas, total, truncado } = await readMeteringSet({
        baseUrl, credentials, ...uno, campos, claves: declarado.claves, desde, hasta, maxFilas,
      })
      return { ...uno, filas: compactRows(filas, campos, { soloElDia: CAMPOS_DE_FECHA }), leidas: filas.length, total, truncado }
    } catch (error) {
      // Se dice qué conjunto falló: cada uno puede tener su propio problema de permisos.
      error.message = `${uno.entidad}: ${error.message}`
      throw error
    }
  }))

  const salida = {
    conjuntos: Object.fromEntries(leidos.map((uno) => [uno.clave, uno.filas])),
    avisos: leidos.filter((uno) => uno.truncado)
      .map((uno) => `De ${uno.entidad} se leyeron ${uno.leidas.toLocaleString('es')} de ${uno.total.toLocaleString('es')} filas: las cifras son de esa parte.`),
  }

  const peso = Buffer.byteLength(JSON.stringify(salida))
  if (peso > LIMITE_DE_RESPUESTA) {
    throw new Error(`El período elegido trae demasiada actividad para mostrarla de una vez (${(peso / 1e6).toFixed(1)} MB). Elige un período más corto.`)
  }
  return salida
}
