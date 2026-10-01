// La migración de dato transaccional (key figures) de v8: qué se lee, qué se escribe y cómo se juzga.
//
// Portado de `components/Migration/KeyFigureMigration.jsx` y `services/planningDataApi.js` de v8. Aquí
// va solo lo PURO —sin red—, porque lo usan el servidor, la pantalla y las pruebas.
//
// El modelo es el de v8: se migra UNA key figure a la vez, cada una con su propio filtro de «no cero»,
// su propia lectura y su propio resultado. No se agrupan: agrupar solo convenía cuando las key figures
// compartían filas, y escribir varias juntas obliga a escribir un cero en la que no tenía valor en esa
// fila, que pisa lo que el destino ya tenía.
//
// El nivel se define en el DESTINO —atributos más un nivel de tiempo— y cada atributo se lee del origen
// con su mismo nombre o con el que se elija (CUSTID ← ATRIBUTOZ). El `$select` es el nivel de
// agregación: SAP suma al nivel que se le pide, así que la lista que se lee y la que se escribe son la
// misma, en el mismo orden, con los nombres de cada lado.

/**
 * Los niveles de tiempo estándar de SAP IBP, en el orden de v8. Semana es el de omisión.
 *
 * Que el número no siga el calendario —4 es semana, 3 mes, 0 día— es de SAP.
 */
export const NIVELES_DE_TIEMPO = Object.freeze([
  { campo: 'PERIODID4_TSTAMP', clave: 'week' },
  { campo: 'PERIODID3_TSTAMP', clave: 'month' },
  { campo: 'PERIODID2_TSTAMP', clave: 'quarter' },
  { campo: 'PERIODID1_TSTAMP', clave: 'year' },
  { campo: 'PERIODID0_TSTAMP', clave: 'day' },
  { campo: 'PERIODID5_TSTAMP', clave: 'techweek' },
])

export const CAMPOS_DE_TIEMPO = Object.freeze(NIVELES_DE_TIEMPO.map((uno) => uno.campo))

/** Lo que SAP devuelve pero no es un atributo del nivel: el contexto de versión y escenario, y la auditoría. */
export const ATRIBUTOS_DE_SOLO_LECTURA = Object.freeze([
  'VERSIONID', 'VERSIONNAME', 'SCENARIOID', 'SCENARIONAME',
  'MASTER_DATA_TYPE', 'AGGREGATE', 'LASTMODIFIEDDATE', 'CREATEDDATE',
])

/** Los atributos de conversión que una key figure puede exigir, en el orden en que v8 los añadía. */
export const CAMPOS_DE_CONVERSION = Object.freeze(['UOMTOID', 'CURRTOID'])

// ── Los números del motor ────────────────────────────────────────────────────────────────────────
//
// En v8 el motor corría en el navegador, detrás de un proxy: 6 trabajadores, cada uno con un segmento
// de 40.000 filas leídas en páginas medidas en bytes —para no pasar los ~4,5 MB que el proxy de Vercel
// dejaba en un cuerpo— y escritas con 3 envíos a la vez de 2.500 valores. Aquí cada segmento lo hace el
// SERVIDOR en una sola llamada —lectura, escritura y confirmación—, porque las credenciales no salen de
// allí. Lo que cambia, y por qué:
//
//   - El segmento baja a 10.000 filas. Tiene que caber en el tiempo de UNA función: con una key figure
//     son 4 envíos de 2.500 valores, unos 53 s cada uno según lo medido en v8 (~20 ms por valor), 3 a la
//     vez → dos rondas, ~110 s, más 2 páginas de lectura en paralelo (~6 s) y la transacción.
//   - La concurrencia se queda como en v8: 6 segmentos a la vez × 3 envíos = 18 envíos en vuelo.
//   - Ya no se mide el tamaño de la fila. Esa medición existía por el límite de cuerpo del proxy, y
//     ahora SAP le contesta directamente al servidor: la página es de 5.000 filas (el presupuesto de
//     2,5 MB de v8 daba eso con filas normales) y el envío lo acota el tope de valores.

/** Filas leídas por segmento. Cada segmento es una transacción propia, confirmada, y una llamada. */
export const FILAS_POR_SEGMENTO = 10_000

/** Segmentos en vuelo a la vez (CONCURRENT_SEGMENTS de v8). */
export const SEGMENTOS_EN_PARALELO = 6

/** Páginas leídas a la vez dentro de un segmento (PARALLEL_R de v8). */
export const LECTURAS_EN_PARALELO = 2

/** Envíos a la vez dentro de un segmento (PARALLEL_W de v8). */
export const ENVIOS_EN_PARALELO = 3

/** Filas por página de lectura. Pocas páginas grandes: el costo de SAP es casi fijo por petición. */
export const FILAS_POR_LECTURA = 5000

/** Intentos por segmento (MAX_SEGMENT_ATTEMPTS de v8). Cada intento es una transacción nueva. */
export const INTENTOS_POR_SEGMENTO = 5

/** Por encima de estas filas, la lectura se parte por periodo (TIME_PARTITION_THRESHOLD de v8). */
export const UMBRAL_PARA_PARTIR_POR_TIEMPO = 100_000

/**
 * Cuánto se espera a que SAP procese una transacción ya confirmada.
 *
 * v8 esperaba `max(120 s, filas del segmento × 3 ms)`, que con sus segmentos daba 120 s. Con segmentos
 * más pequeños la fórmula da menos; se deja el piso de v8.
 */
export const ESPERA_DE_CONFIRMACION_MS = 120_000

// ── Lo que se le pide a SAP ──────────────────────────────────────────────────────────────────────

/** Una lista sin repetidos, conservando el orden. */
const sinRepetir = (lista) => [...new Set((lista ?? []).filter(Boolean))]

/** Los atributos de conversión que lleva la lectura, en el orden de `CAMPOS_DE_CONVERSION`. */
export const conversionesDe = (conversiones) =>
  CAMPOS_DE_CONVERSION.filter((campo) => conversiones?.[campo])

/**
 * El `$select` y el `$orderby` de la lectura de una key figure, como en v8:
 *
 *   select  = atributos del origen + conversiones + key figure del origen + tiempo
 *   orderby = atributos del origen + conversiones + tiempo
 *
 * El tiempo va SIEMPRE: sin él, SAP suma todo el horizonte en un valor por combinación. Y el orden es
 * estable —el nivel entero identifica la fila—, que es lo que deja leer ventanas de `$skip` a la vez
 * sin solapes ni huecos.
 */
export function lecturaDeLaCifra({ nivel = [], cifra, campoDeTiempo, conversiones } = {}) {
  const atributos = [...nivel.map((uno) => uno.origen), ...conversionesDe(conversiones)]
  return {
    select: sinRepetir([...atributos, cifra?.origen, campoDeTiempo]),
    orderby: sinRepetir([...atributos, campoDeTiempo]),
  }
}

/** `AggregationLevelFieldsString` de la escritura: atributos del destino + key figure + tiempo. */
export const camposDeEscritura = ({ nivel = [], cifra, campoDeTiempo } = {}) =>
  [...nivel.map((uno) => uno.destino), cifra?.destino, campoDeTiempo].filter(Boolean)

/** Un periodo como lo da `periodoIso`: `2026-01-05T00:00:00`. */
export const esPeriodoIso = (valor) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(String(valor ?? ''))

/** El filtro de un tramo de tiempo: el de la key figure y, si hay periodo, solo ese periodo. */
export function filtroDePeriodo(filtro, campoDeTiempo, periodo) {
  if (!periodo || !campoDeTiempo) return filtro || ''
  const delPeriodo = `${campoDeTiempo} eq datetime'${periodo}'`
  return filtro ? `${filtro} and ${delPeriodo}` : delPeriodo
}

/** Un valor de key figure que no aporta nada: vacío, nulo o cero (`isEmpty` de v8). */
export const esVacio = (valor) => valor == null || String(valor).trim() === '' || Number(valor) === 0

/**
 * Las filas leídas, listas para escribir (`projectBatch` de v8).
 *
 * Cada atributo del destino toma el valor de su atributo del origen, el periodo pasa de
 * `/Date(…)/` a ISO —que es lo que acepta la importación—, y la key figure se renombra. Las filas
 * cuya key figure está vacía o en cero se descartan: no traen información, y escribirlas pisaría con
 * un cero lo que el destino tenía.
 */
export function filasParaEscribir(filas, { nivel = [], cifra, campoDeTiempo } = {}, periodoIso = (v) => v) {
  const salida = []
  for (const fila of filas ?? []) {
    const valor = fila?.[cifra.origen]
    if (esVacio(valor)) continue
    const una = {}
    for (const { destino, origen } of nivel) una[destino] = fila[origen] ?? ''
    una[campoDeTiempo] = periodoIso(fila[campoDeTiempo])
    una[cifra.destino] = valor ?? '0'
    salida.push(una)
  }
  return salida
}

// ── Lo que llega por la red ──────────────────────────────────────────────────────────────────────

/** Un nombre de campo de OData. Lo demás no llega a la dirección de SAP. */
const esCampo = (valor) => typeof valor === 'string' && /^[A-Za-z0-9_]+$/.test(valor)

/** Una fecha del `<input type="date">`. */
const esFecha = (valor) => /^\d{4}-\d{2}-\d{2}$/.test(String(valor ?? ''))

/**
 * La definición de la migración de UNA key figure, tal como la manda la pantalla, comprobada.
 *
 * Devuelve `{ definicion }` o `{ error }`. Los nombres van a la dirección de SAP: solo pasan los que
 * son nombres de campo de verdad. El `$filter` lo arma el servidor con esto, no el navegador.
 * `nivelObligatorio: false` es para contar: v8 dejaba contar con el nivel todavía vacío.
 */
export function definicionDeLaCifra(entrada = {}, { nivelObligatorio = true } = {}) {
  const nivel = Array.isArray(entrada.nivel) ? entrada.nivel : []
  // «Contar registros» de v8 cuenta aunque el nivel todavía esté vacío; copiar, nunca.
  if (nivel.length === 0 && nivelObligatorio) return { error: 'Falta el nivel de planificación.' }
  if (!nivel.every((uno) => esCampo(uno?.destino) && esCampo(uno?.origen))) {
    return { error: 'Hay un atributo del nivel sin su atributo de origen.' }
  }
  if (nivel.some((uno) => ATRIBUTOS_DE_SOLO_LECTURA.includes(uno.destino) || CAMPOS_DE_TIEMPO.includes(uno.destino))) {
    return { error: 'El nivel incluye un atributo que no se puede escribir.' }
  }

  const cifra = entrada.cifra ?? {}
  if (!esCampo(cifra.origen) || !esCampo(cifra.destino)) return { error: 'Falta la key figure de origen o de destino.' }

  if (!CAMPOS_DE_TIEMPO.includes(entrada.campoDeTiempo)) return { error: 'Falta el nivel de tiempo.' }

  const conversiones = {}
  for (const campo of CAMPOS_DE_CONVERSION) {
    const valor = entrada.conversiones?.[campo]
    if (valor) conversiones[campo] = String(valor)
  }

  const condiciones = Array.isArray(entrada.condiciones)
    ? entrada.condiciones.filter((una) => esCampo(una?.field)).map((una) => ({
      field: una.field, op: una.op, value: String(una.value ?? ''),
    }))
    : []

  return {
    definicion: {
      nivel: nivel.map(({ destino, origen }) => ({ destino, origen })),
      cifra: { origen: cifra.origen, destino: cifra.destino },
      campoDeTiempo: entrada.campoDeTiempo,
      conversiones,
      condiciones,
      desde: esFecha(entrada.desde) ? entrada.desde : '',
      hasta: esFecha(entrada.hasta) ? entrada.hasta : '',
      soloConValor: entrada.soloConValor !== false,
    },
  }
}

// ── El resultado ─────────────────────────────────────────────────────────────────────────────────

/**
 * Si un fallo merece otro intento del segmento, en una transacción nueva (v8: 403, sin estado o 5xx).
 *
 * El 403 es el token de escritura vencido: no deja nada preparado, así que repetir es seguro.
 */
export const esFalloTransitorio = (status) => status == null || status === 0 || status === 403 || status >= 500

/**
 * Los mensajes que cuentan como rechazo: errores y cancelaciones (E/A).
 *
 * Si el tenant no expone la severidad se cuentan todos, que es lo que hacía v8.
 */
export const esMensajeDeRechazo = (mensaje) => mensaje?.Severity == null || ['E', 'A'].includes(mensaje.Severity)

/** Un mensaje reducido a lo que se enseña: su identificador, su texto y su severidad. */
export function mensajeBreve(mensaje) {
  const salida = {}
  for (const campo of ['ExceptionId', 'MessageId', 'MsgText', 'Text', 'Severity']) {
    if (mensaje?.[campo] != null) salida[campo] = mensaje[campo]
  }
  return salida
}

/**
 * El estado de una key figure terminada, como v8: cualquier ERROR → error; rechazos o «procesada con
 * errores» → aviso; alguna transacción sin confirmar → procesando; si no, ok.
 */
export function estadoDeCifra({ hayError, hayAviso, sinConfirmar, mensajes = [] } = {}) {
  if (hayError) return 'error'
  if (mensajes.length > 0 || hayAviso) return 'warning'
  if (sinConfirmar) return 'processing'
  return 'ok'
}

/** El estado de toda la corrida, para el historial y el informe. */
export function estadoDeCorrida(resultados = []) {
  const hay = (estado) => resultados.some((uno) => uno.status === estado)
  if (hay('cancelled')) return 'cancelled'
  if (hay('error')) return 'error'
  if (hay('processing')) return 'processing'
  if (hay('warning')) return 'warning'
  return 'ok'
}

/**
 * Las filas escritas en la corrida.
 *
 * Se cuentan una vez por transacción —o por key figure si no tuvo—, como v8, que agrupaba las filas
 * de un grupo bajo la misma transacción.
 */
export function totalEscrito(resultados = []) {
  const vistos = new Set()
  let total = 0
  for (const uno of resultados) {
    const clave = uno.txId || uno.kf
    if (vistos.has(clave)) continue
    vistos.add(clave)
    total += uno.total || 0
  }
  return total
}

/** Las fases que se cronometran, en el orden en que pasan. */
export const FASES_CRONOMETRADAS = Object.freeze(['count', 'reading', 'writing', 'committing', 'processing', 'messages'])

/** Los tiempos sumados por fase y la key figure más lenta. */
export function tiemposDeLaCorrida(resultados = []) {
  const vistos = new Set()
  const totales = {}
  let masLenta = null
  for (const uno of resultados) {
    const clave = uno.txId || uno.kf
    if (vistos.has(clave)) continue
    vistos.add(clave)
    for (const [fase, ms] of Object.entries(uno.phaseTimes || {})) totales[fase] = (totales[fase] || 0) + ms
    if ((uno.durationMs || 0) > (masLenta?.durationMs || 0)) masLenta = uno
  }
  return { totales, masLenta }
}

/** Una duración compacta, como `fmtDuration` de v8: «1h 02m», «2m 14s», «4,2 s», «850 ms». */
export function duracionLegible(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1).replace('.', ',')} s`
  const m = Math.floor(s / 60)
  const resto = Math.round(s % 60)
  if (m < 60) return `${m}m ${String(resto).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, '0')}m`
}

/**
 * El siguiente tramo de trabajo (`nextWork` de v8).
 *
 * Cada periodo se reparte POR POSICIÓN: varios trabajadores leen el mismo periodo en ventanas de
 * `$skip` distintas, así que hay concurrencia completa aunque haya un solo periodo. Un periodo se da
 * por terminado cuando una lectura vuelve corta; quien ya tomó una ventana más allá lee vacío, que no
 * hace daño.
 */
export function siguienteTramo(periodos, porSegmento = FILAS_POR_SEGMENTO) {
  for (const uno of periodos) {
    if (!uno.done) {
      const desde = uno.skip
      uno.skip += porSegmento
      return { periodo: uno, desde }
    }
  }
  return null
}

/**
 * «📋 Pegar lista» (`handlePasteApply` de v8).
 *
 * Una key figure por línea —una línea puede traer varias separadas por coma o punto y coma— y se
 * agrega con el origen del mismo nombre. Una línea con TAB (dos columnas copiadas de Excel) es
 * ORIGEN⇥DESTINO. Se compara sin distinguir mayúsculas contra el catálogo del DESTINO, se respeta el
 * orden pegado, lo ya elegido se salta y lo que no existe se informa: nunca se descarta en silencio.
 */
export function cifrasPegadas(texto, { delDestino = [], delOrigen = [], yaElegidas = [] } = {}) {
  const destinoPorMayusculas = new Map(delDestino.map((uno) => [uno.toUpperCase(), uno]))
  const origenPorMayusculas = new Map(delOrigen.map((uno) => [uno.toUpperCase(), uno]))
  const limpiar = (pieza) => pieza.trim().replace(/^["']+|["']+$/g, '')

  const pares = []
  for (const cruda of String(texto ?? '').split(/\r?\n/)) {
    const linea = cruda.trim()
    if (!linea) continue
    if (linea.includes('\t')) {
      const [a, b] = linea.split('\t').map(limpiar).filter(Boolean)
      if (a) pares.push({ origen: b ? a : '', destino: b || a })
    } else {
      for (const pieza of linea.split(/[,;]/).map(limpiar).filter(Boolean)) pares.push({ origen: '', destino: pieza })
    }
  }

  const faltantes = []
  const agregadas = []
  let repetidas = 0
  const elegidas = new Set(yaElegidas)
  for (const par of pares) {
    const destino = destinoPorMayusculas.get(par.destino.toUpperCase())
    if (!destino) { faltantes.push(par.destino); continue }
    if (elegidas.has(destino)) { repetidas += 1; continue }
    elegidas.add(destino)
    agregadas.push({ dstKf: destino, srcKf: origenPorMayusculas.get((par.origen || destino).toUpperCase()) || '' })
  }
  return { agregadas, faltantes, repetidas }
}

/** El nombre del archivo del informe, como v8: `migracion-kf_<destino>_<AAAAMMDD-HHMM>.pdf`. */
export function nombreDelInforme(destino, fecha = new Date()) {
  const dos = (n) => String(n).padStart(2, '0')
  const sistema = String(destino || 'sistema').replace(/[^\w-]+/g, '-')
  return `migracion-kf_${sistema}_${fecha.getFullYear()}${dos(fecha.getMonth() + 1)}${dos(fecha.getDate())}`
    + `-${dos(fecha.getHours())}${dos(fecha.getMinutes())}.pdf`
}
