// Copiar una tabla de dato maestro de un tenant a otro.
//
// Portado de `runMigration` de `Migration.jsx` de v8, que lo tenía dentro del componente.
//
// La forma de la cosa, y por qué:
//
//   - Se copia por SEGMENTOS, cada uno en su propia transacción confirmada. Un fallo a mitad
//     rehace SOLO el segmento en curso, y lo ya confirmado se queda. Sin segmentos, un tropiezo en
//     la fila 300.000 tira las 299.999 anteriores.
//
//   - El reintento es de la TRANSACCIÓN, nunca del envío. Repetir un envío ya mandado duplica
//     claves y al confirmar SAP rechaza las dos copias: el registro se pierde. Reaplicar un
//     segmento entero en una transacción nueva sí es seguro, porque es alta-o-modificación.
//
//   - Se lee con `$select` de solo las columnas que se van a copiar. Bajar columnas que se van a
//     descartar es tráfico y tiempo tirados, y además permite páginas más grandes.

import {
  abrirSesionDeEscritura,
  commitTransaction,
  getTransactionId,
  initiateParallelProcess,
  partirEnEnvios,
  postTransChunk,
  readMessages,
  waitForProcessed,
} from './master-data-write.js'
import { filasPorPagina } from './master-data-model.js'
import { readEntityPage } from './master-data.js'

/**
 * Filas por segmento.
 *
 * Cada segmento es una transacción: menos segmentos son menos ciclos de pedir-confirmar-esperar,
 * pero un fallo cuesta más. Cuarenta mil es el punto que usaba v8 tras medirlo.
 */
export const FILAS_POR_SEGMENTO = 40_000

/** Cuántas veces se rehace un segmento antes de darlo por perdido. */
export const INTENTOS_POR_SEGMENTO = 3

/** Un aviso de progreso, para que la pantalla pueda contar qué está pasando. */
const avisar = (onProgreso, evento) => { if (onProgreso) onProgreso(evento) }

/**
 * Lee del origen las filas de un segmento.
 *
 * El orden estable por las claves es obligatorio: sin él, dos ventanas sobre una tabla que alguien
 * está tocando se solapan y dejan huecos, y aquí un hueco es un registro que no se copia.
 */
async function leerSegmento({ origen, entidad, columnas, claves, desde, cuantas, condiciones }) {
  const porPagina = filasPorPagina(0)
  const filas = []

  while (filas.length < cuantas) {
    const pedidas = Math.min(porPagina, cuantas - filas.length)
    const pagina = await readEntityPage({
      ...origen,
      entidad,
      skip: desde + filas.length,
      top: pedidas,
      select: columnas,
      orderby: claves,
      extraFilter: condiciones,
    })

    filas.push(...pagina)
    // Menos filas de las pedidas significa que la tabla se acabó, no que haya que insistir.
    if (pagina.length < pedidas) break
  }

  return filas
}

/**
 * Manda un segmento al destino dentro de UNA transacción, y la confirma.
 *
 * Si algo falla, la transacción se queda sin confirmar —SAP la descarta sola— y quien llama vuelve
 * a intentar el segmento entero en otra nueva.
 */
async function escribirSegmento({ destino, entidad, filas, borrar, nombre, csrf, onProgreso }) {
  const transactionId = await getTransactionId({
    ...destino, entidad, planningArea: destino.planningArea, versionId: destino.versionId, csrf,
  })
  avisar(onProgreso, { fase: 'transaccion', transactionId })

  await initiateParallelProcess({
    ...destino, transactionId, entidad, planningArea: destino.planningArea, versionId: destino.versionId, nombre, csrf,
  })

  const envios = partirEnEnvios(filas)
  for (const [indice, envio] of envios.entries()) {
    await postTransChunk({
      ...destino,
      entidad,
      transactionId,
      filas: envio,
      borrar,
      planningArea: destino.planningArea,
      versionId: destino.versionId,
      csrf,
    })
    avisar(onProgreso, { fase: 'enviando', enviadas: indice + 1, envios: envios.length, filas: envio.length })
  }

  avisar(onProgreso, { fase: 'confirmando', transactionId })
  await commitTransaction({ ...destino, transactionId, csrf })

  const estado = await waitForProcessed({ ...destino, transactionId })
  avisar(onProgreso, { fase: 'procesada', transactionId, estado })

  return { transactionId, estado }
}

/**
 * Copia UN segmento: lo lee del origen y lo escribe en el destino, en su propia transacción.
 *
 * Es la unidad que se expone al exterior porque es la que cabe en una función serverless: una tabla
 * de trescientas mil filas no entra en una sola llamada, pero cada segmento sí, y quien llama
 * encadena. Además es la unidad natural del reintento, porque cada segmento es una transacción.
 *
 * NO lanza cuando falla: devuelve el fallo dentro del resultado, porque una migración de veinte
 * tablas no debe pararse entera por una.
 */
export async function migrarSegmento({
  origen, destino, entidad, entidadDestino, columnas, claves, desde = 0, cuantas = FILAS_POR_SEGMENTO,
  condiciones, borrar = false, nombre, csrf, onProgreso,
}) {
  const sesion = csrf ?? await abrirSesionDeEscritura(destino)
  avisar(onProgreso, { fase: 'leyendo', desde, cuantas })

  let filas
  try {
    filas = await leerSegmento({ origen, entidad, columnas, claves, desde, cuantas, condiciones })
  } catch (error) {
    return { desde, filas: 0, ok: false, agotado: false, fase: 'lectura', error: error.detail || error.message }
  }

  // Menos filas de las pedidas quiere decir que la tabla se acabó: quien encadena para aquí.
  const agotado = filas.length < cuantas

  if (filas.length === 0) return { desde, filas: 0, ok: true, agotado: true, mensajes: [] }

  let ultimoFallo = null
  let hecho = null

  for (let intento = 1; intento <= INTENTOS_POR_SEGMENTO && !hecho; intento += 1) {
    try {
      // Cada intento arranca una transacción NUEVA. La anterior se quedó sin confirmar y SAP la
      // descarta: reenviar dentro de la vieja duplicaría claves.
      hecho = await escribirSegmento({
        destino, entidad: entidadDestino, filas, borrar, nombre, csrf: sesion, onProgreso,
      })
    } catch (error) {
      ultimoFallo = error.detail || error.message
      avisar(onProgreso, { fase: 'reintento', desde, intento, error: ultimoFallo })
    }
  }

  if (!hecho) {
    return { desde, filas: filas.length, ok: false, agotado, fase: 'escritura', error: ultimoFallo }
  }

  let mensajes = []
  try {
    mensajes = await readMessages({ ...destino, entidad: entidadDestino, transactionId: hecho.transactionId })
  } catch {
    // Que no se puedan leer los mensajes no cambia lo que se copió.
    mensajes = []
  }

  return { desde, filas: filas.length, ok: true, agotado, mensajes, ...hecho }
}

/**
 * Copia una tabla entera, segmento a segmento.
 *
 * Para quien pueda encadenarlos de un tirón —los tests, y un futuro trabajo de fondo—. La pantalla
 * no lo usa: encadena `migrarSegmento` ella misma para poder ir contando qué pasa.
 */
export async function migrarTabla({ total, onProgreso, ...resto }) {
  const csrf = await abrirSesionDeEscritura(resto.destino)
  const segmentos = []
  let copiadas = 0

  for (let desde = 0; desde < total; desde += FILAS_POR_SEGMENTO) {
    const segmento = await migrarSegmento({
      ...resto,
      csrf,
      desde,
      cuantas: Math.min(FILAS_POR_SEGMENTO, total - desde),
      onProgreso,
    })

    segmentos.push(segmento)
    if (segmento.ok) copiadas += segmento.filas
    if (segmento.agotado) break
  }

  return {
    entidad: resto.entidad,
    entidadDestino: resto.entidadDestino,
    total,
    copiadas,
    segmentos,
    mensajes: [...segmentos].reverse().find((uno) => uno.mensajes?.length)?.mensajes ?? [],
    ok: segmentos.every((uno) => uno.ok),
  }
}