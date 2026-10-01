// La migración de dato transaccional (key figures) de v8, del lado que habla con SAP.
//
// Portado de `runMigration` de `KeyFigureMigration.jsx` y de `services/planningDataApi.js` de v8. En v8
// todo esto corría en el navegador detrás de un proxy; aquí corre en el servidor, porque las
// credenciales viven cifradas allí. La pantalla ORQUESTA —cuenta, reparte segmentos entre seis
// trabajadores, reintenta, confirma— y cada pieza de aquí es una llamada que cabe en una función:
//
//   contarCifra             — cuántas filas no cero hay al nivel elegido (o todas, si SAP no acepta ese filtro).
//   periodosDeLaCifra       — los periodos que tienen dato, para partir los volúmenes grandes por tiempo.
//   copiarSegmentoDeCifra   — UN segmento: leer, escribir y confirmar en una transacción propia.
//   confirmarTransaccionDeCifra — esperar a que SAP la procese y, si no quedó limpia, sus rechazos.
//
// El reintento es del SEGMENTO entero en una transacción nueva y lo decide quien llama. Un envío ya
// preparado nunca se repite: duplicaría valores dentro de la misma transacción.

import {
  abrirSesionDeEscritura,
  commitTransaction,
  getTransactionId,
  initiateParallelProcess,
  partirEnEnvios,
  postKfChunk,
  readMessages,
  waitForProcessed,
} from './planning-data-write.js'
import { countKf, readKfPage } from './planning-data.js'
import { filtroDePlanificacion, periodoIso } from './planning-data-model.js'
import {
  ENVIOS_EN_PARALELO, ESPERA_DE_CONFIRMACION_MS, FILAS_POR_LECTURA, FILAS_POR_SEGMENTO, LECTURAS_EN_PARALELO,
  camposDeEscritura, esFalloTransitorio, esMensajeDeRechazo, filasParaEscribir, filtroDePeriodo,
  lecturaDeLaCifra, mensajeBreve,
} from './kf-migration-plan.js'

/** Una lectura de página: dos reintentos y 90 s, como el visor. */
const PAGINA = Object.freeze({ reintentos: 2, timeoutMs: 90_000 })

/**
 * El `$filter` de la lectura de una key figure.
 *
 * La versión del ORIGEN acota la lectura: sin el predicado se leería la versión base y se escribiría
 * en la versión elegida del destino con números de otra. Los filtros de atributo y las fechas viajan
 * en cada lectura —conteo, periodos y páginas—, y con `soloConValor` solo las filas donde la key
 * figure es distinta de cero, con `gt 0 or lt 0`: `ne 0` SAP lo ignora en silencio.
 */
export function filtroDeLaCifra(definicion, version) {
  return filtroDePlanificacion({
    version,
    condiciones: definicion.condiciones,
    campoDeTiempo: definicion.campoDeTiempo,
    desde: definicion.desde,
    hasta: definicion.hasta,
    conversiones: definicion.conversiones,
    cifras: [definicion.cifra.origen],
    soloConValor: definicion.soloConValor,
  })
}

/**
 * Cuántas filas hay al nivel elegido, con `$top` pequeño y `$inlinecount` (nunca `$top=0`).
 *
 * `reintentos` y `timeoutMs` los pone quien llama: el conteo de la corrida va con uno y 60 s, como
 * v8; el de «Contar registros», sin reintento.
 */
export async function contarCifra({ origen, area, definicion, reintentos = 0, timeoutMs = 60_000 }) {
  const { select } = lecturaDeLaCifra(definicion)
  return countKf({
    ...origen, area, select, filtro: filtroDeLaCifra(definicion, origen.versionId), reintentos, timeoutMs,
  })
}

/**
 * Los periodos que tienen dato (`fetchTimeBuckets` de v8).
 *
 * Pedir solo el periodo y la key figure hace que SAP agregue a nivel de tiempo y devuelva una fila
 * por periodo: es la forma barata de saber cómo partir una lectura enorme.
 */
export async function periodosDeLaCifra({ origen, area, definicion }) {
  const filas = await readKfPage({
    ...origen,
    area,
    select: [definicion.campoDeTiempo, definicion.cifra.origen],
    filtro: filtroDeLaCifra(definicion, origen.versionId),
    top: 5000,
    timeoutMs: PAGINA.timeoutMs,
  })
  const vistos = new Set()
  for (const fila of filas) {
    const crudo = fila[definicion.campoDeTiempo]
    if (crudo != null) vistos.add(periodoIso(crudo))
  }
  return [...vistos].sort()
}

/** Lee la ventana `[desde, desde + cuantas)` del tramo, de a `LECTURAS_EN_PARALELO` páginas. */
async function leerSegmento({ origen, area, select, orderby, filtro, desde, cuantas }) {
  const fin = desde + cuantas
  const filas = []
  let agotado = false

  for (let inicio = desde; inicio < fin; inicio += FILAS_POR_LECTURA * LECTURAS_EN_PARALELO) {
    const paginas = Math.min(LECTURAS_EN_PARALELO, Math.ceil((fin - inicio) / FILAS_POR_LECTURA))
    const lote = await Promise.all(Array.from({ length: paginas }, (_, j) => {
      const skip = inicio + j * FILAS_POR_LECTURA
      return readKfPage({
        ...origen, area, select, orderby, filtro, skip, top: Math.min(FILAS_POR_LECTURA, fin - skip), ...PAGINA,
      })
    }))
    const leidas = lote.flat()
    for (const fila of leidas) filas.push(fila)
    // Una lectura que vuelve corta quiere decir que el tramo se acabó dentro de este segmento.
    const pedidas = Math.min(FILAS_POR_LECTURA * LECTURAS_EN_PARALELO, fin - inicio)
    if (leidas.length < pedidas) { agotado = true; break }
  }

  return { filas, agotado }
}

/**
 * Copia UN segmento de una key figure: lo lee del origen, lo escribe en el destino en una transacción
 * propia y la confirma.
 *
 * NO lanza: devuelve el fallo dentro del resultado, con `transitorio` para que quien llama decida si
 * lo vuelve a intentar entero en una transacción nueva. Una key figure CALCULADA no se arregla
 * reintentando y se marca aparte.
 *
 * `tiempos` son los milisegundos de cada fase, que la pantalla suma por key figure como v8.
 */
export async function copiarSegmentoDeCifra({
  origen, destino, areaOrigen, areaDestino, definicion, periodo = null, desde = 0,
  cuantas = FILAS_POR_SEGMENTO, nombre = 'IBP-ControlTower-KF', ahora = () => Date.now(),
}) {
  const tiempos = { reading: 0, writing: 0, committing: 0 }
  const { select, orderby } = lecturaDeLaCifra(definicion)
  const filtro = filtroDePeriodo(filtroDeLaCifra(definicion, origen.versionId), definicion.campoDeTiempo, periodo)
  let leidas = 0
  let fase = 'reading'

  try {
    let marca = ahora()
    const { filas, agotado } = await leerSegmento({
      origen, area: areaOrigen, select, orderby, filtro, desde, cuantas,
    })
    leidas = filas.length
    tiempos.reading = ahora() - marca

    const escribibles = filasParaEscribir(filas, definicion, periodoIso)
    // Nada con valor: no se abre transacción. v8 la abría y la abandonaba; da lo mismo para SAP.
    if (escribibles.length === 0) {
      return { ok: true, leidas, escritas: 0, agotado, transactionId: null, tiempos }
    }

    fase = 'writing'
    marca = ahora()
    const csrf = await abrirSesionDeEscritura(destino)
    const transactionId = await getTransactionId({ ...destino, csrf })
    try {
      await initiateParallelProcess({
        ...destino, transactionId, area: areaDestino, versionId: destino.versionId, nombre, csrf,
      })
    } catch { /* de mejor esfuerzo, como en v8 */ }

    const campos = camposDeEscritura(definicion)
    const envios = partirEnEnvios(escribibles, 1)
    for (let i = 0; i < envios.length; i += ENVIOS_EN_PARALELO) {
      await Promise.all(envios.slice(i, i + ENVIOS_EN_PARALELO).map((filasDelEnvio) => postKfChunk({
        ...destino, area: areaDestino, transactionId, filas: filasDelEnvio, campos, versionId: destino.versionId, csrf,
      })))
    }
    tiempos.writing = ahora() - marca

    fase = 'committing'
    marca = ahora()
    await commitTransaction({ ...destino, transactionId, csrf })
    tiempos.committing = ahora() - marca

    return { ok: true, leidas, escritas: escribibles.length, agotado, transactionId, tiempos }
  } catch (error) {
    return {
      ok: false,
      fase,
      leidas,
      tiempos,
      error: error.detail ? `[${error.status ?? ''}] ${error.detail}` : (error.message || String(error)),
      cifraCalculada: error.cifraCalculada ?? null,
      // La transacción sin confirmar SAP la descarta: repetir el segmento entero es seguro.
      // El transporte marca `retryable` (corte de red, respuesta cortada, 429, 5xx) y deja el estado en
      // 0; un 0 sin esa marca es un rechazo propio —una dirección no permitida— y no mejora repitiendo.
      transitorio: !error.cifraCalculada
        && (Boolean(error.retryable) || (error.status !== 0 && esFalloTransitorio(error.status))),
    }
  }
}

/**
 * Espera a que SAP procese una transacción confirmada y, si no quedó limpia, lee sus rechazos.
 *
 * Como v8: los mensajes solo se piden cuando el estado no es PROCESSED —una limpia no tiene errores y
 * la petición sobraría—, y solo cuentan los de error o cancelación (E/A).
 */
export async function confirmarTransaccionDeCifra({
  destino, area, transactionId, timeoutMs = ESPERA_DE_CONFIRMACION_MS, esperar, ahora,
}) {
  const estado = await waitForProcessed({
    ...destino, transactionId, timeoutMs, ...(esperar ? { esperar } : {}), ...(ahora ? { ahora } : {}),
  })
  if (estado === 'PROCESADA') return { estado, mensajes: [] }

  let mensajes = []
  try {
    mensajes = await readMessages({ ...destino, area, transactionId })
  } catch {
    // Que no se puedan leer los mensajes no cambia lo que se escribió.
    mensajes = []
  }
  return { estado, mensajes: mensajes.filter(esMensajeDeRechazo).map(mensajeBreve) }
}
