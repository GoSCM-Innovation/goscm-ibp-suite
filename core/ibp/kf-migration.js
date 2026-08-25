// Copiar cifras clave de un tenant a otro.
//
// Portado de `runMigration` de `KeyFigureMigration.jsx` de v8. La forma, y por qué:
//
//   - Se copia por SEGMENTOS, cada uno en su propia transacción confirmada. Un fallo a mitad rehace
//     SOLO el segmento en curso y lo ya confirmado se queda. Es la misma decisión que en dato
//     maestro, y aquí pesa más: una cifra clave puede ser un millón de filas.
//
//   - El reintento es de la TRANSACCIÓN, nunca del envío. Repetir un envío ya mandado duplica valores
//     dentro de la misma transacción.
//
//   - El `$select` de la lectura y `AggregationLevelFieldsString` de la escritura salen de la MISMA
//     lista. Si se separan, se lee a un nivel y se escribe a otro, y el resultado es creíble.

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
import { sinFilasEnCero } from './planning-data-model.js'
import {
  FILAS_POR_SEGMENTO, filaParaEscribir, nombreEnDestino, planificarSegmentos, selectDeLaMigracion,
} from './kf-migration-plan.js'

/** Cuántas veces se rehace un segmento antes de darlo por perdido. */
export const INTENTOS_POR_SEGMENTO = 3

const avisar = (onProgreso, evento) => { if (onProgreso) onProgreso(evento) }

/** Cuántas filas devuelve una lectura de una vez. Pocas páginas grandes: el costo es casi todo fijo. */
export const FILAS_POR_LECTURA = 5000

/** Lee un tramo del origen, paginando dentro del segmento. */
async function leerSegmento({ origen, area, select, filtro, orderby, desde, cuantas }) {
  const filas = []

  while (filas.length < cuantas) {
    const pedidas = Math.min(FILAS_POR_LECTURA, cuantas - filas.length)
    const pagina = await readKfPage({
      ...origen,
      area,
      select,
      filtro,
      orderby,
      skip: desde + filas.length,
      top: pedidas,
    })

    filas.push(...pagina)
    // Menos filas de las pedidas quiere decir que se acabó, no que haya que insistir.
    if (pagina.length < pedidas) break
  }

  return filas
}

/**
 * Escribe un segmento en el destino, en UNA transacción, y la confirma.
 *
 * Si algo falla, la transacción se queda sin confirmar —SAP la descarta— y quien llama vuelve a
 * intentar el segmento entero en otra nueva.
 */
async function escribirSegmento({
  destino, area, nivel, cifras, filas, nombre, csrf, onProgreso, destinoDe,
}) {
  const transactionId = await getTransactionId({ ...destino, csrf })
  avisar(onProgreso, { fase: 'transaccion', transactionId })

  await initiateParallelProcess({
    ...destino, transactionId, area, versionId: destino.versionId, nombre, csrf,
  })

  const paraEscribir = filas.map((una) => filaParaEscribir(una, nivel, cifras, destinoDe))
  const envios = partirEnEnvios(paraEscribir, cifras.length)

  for (const [indice, envio] of envios.entries()) {
    await postKfChunk({
      ...destino,
      area,
      transactionId,
      filas: envio,
      // La MISMA lista que el `$select` de la lectura, con los nombres del destino: si se separan,
      // se escribe a otro nivel del que se leyó.
      campos: nivel.map((uno) => nombreEnDestino(uno, destinoDe)),
      versionId: destino.versionId,
      csrf,
    })
    avisar(onProgreso, { fase: 'enviando', enviados: indice + 1, envios: envios.length, filas: envio.length })
  }

  avisar(onProgreso, { fase: 'confirmando', transactionId })
  await commitTransaction({ ...destino, transactionId, csrf })

  const estado = await waitForProcessed({ ...destino, transactionId })
  avisar(onProgreso, { fase: 'procesada', transactionId, estado })

  return { transactionId, estado }
}

/**
 * Cuántas filas hay que copiar, al nivel elegido.
 *
 * Se cuenta antes de empezar porque de eso depende todo lo demás: cuántos segmentos, si conviene
 * partir por periodo, y si vale la pena avisar de que esto va a tardar.
 */
export async function contarLoQueSeCopia({ origen, area, nivel, cifras, filtro, filtroBase }) {
  const select = selectDeLaMigracion(nivel, cifras)
  const contar = (cual) => countKf({ ...origen, area, select, filtro: cual })

  // Primero acotando a las filas que tienen valor: un nivel de planificación es casi todo ceros y
  // leerlo entero para copiar las pocas celdas con dato es la diferencia entre minutos y una tarde.
  try {
    return { ...planificarSegmentos(await contar(filtro)), soloConValor: true }
  } catch (error) {
    // Si SAP no acepta ese filtro —hay cifras que no lo admiten— se cuenta sin él y se sigue. El
    // original hacía exactamente esto, y la alternativa sería no poder copiar.
    if (filtroBase === undefined || filtroBase === filtro) throw error
    return {
      ...planificarSegmentos(await contar(filtroBase)),
      soloConValor: false,
      porQueTodo: error.detail || error.message,
    }
  }
}

/**
 * Copia UN segmento. Es la unidad que cabe en una función serverless y la del reintento.
 *
 * NO lanza cuando falla: devuelve el fallo dentro del resultado. Una migración de varias cifras no
 * debe pararse entera por una.
 */
export async function migrarSegmentoDeCifras({
  origen, destino, area, areaDestino, nivel, cifras, filtro, destinoDe,
  desde = 0, cuantas = FILAS_POR_SEGMENTO, nombre, csrf, onProgreso,
}) {
  const sesion = csrf ?? await abrirSesionDeEscritura(destino)
  const select = selectDeLaMigracion(nivel, cifras)

  avisar(onProgreso, { fase: 'leyendo', desde, cuantas })

  let filas
  try {
    filas = await leerSegmento({ origen, area, select, filtro, orderby: nivel, desde, cuantas })
  } catch (error) {
    return { desde, filas: 0, ok: false, agotado: false, fase: 'lectura', error: error.detail || error.message }
  }

  const agotado = filas.length < cuantas
  if (filas.length === 0) return { desde, filas: 0, escritas: 0, ok: true, agotado: true, mensajes: [] }

  // Las filas donde TODAS las cifras valen cero no se escriben: no aportan nada y pisarían con un
  // cero un valor que el destino ya tenía. `filas.length` sigue siendo lo LEÍDO, porque de eso
  // depende el `$skip` del segmento siguiente; lo escrito se cuenta aparte.
  const escribibles = sinFilasEnCero(filas, cifras)
  if (escribibles.length === 0) {
    return { desde, filas: filas.length, escritas: 0, ok: true, agotado, mensajes: [] }
  }

  let ultimoFallo = null
  let hecho = null
  let cifraCalculada = null

  for (let intento = 1; intento <= INTENTOS_POR_SEGMENTO && !hecho; intento += 1) {
    try {
      hecho = await escribirSegmento({
        destino, area: areaDestino ?? area, nivel, cifras, filas: escribibles, nombre,
        csrf: sesion, onProgreso, destinoDe,
      })
    } catch (error) {
      ultimoFallo = error.detail || error.message
      // Una cifra CALCULADA no se arregla reintentando: no se puede escribir nunca. Se corta aquí en
      // vez de gastar tres intentos y dar un mensaje que no explica nada.
      if (error.cifraCalculada) {
        cifraCalculada = error.cifraCalculada
        ultimoFallo = error.message
        break
      }
      avisar(onProgreso, { fase: 'reintento', desde, intento, error: ultimoFallo })
    }
  }

  if (!hecho) {
    return {
      desde, filas: filas.length, escritas: 0, ok: false, agotado,
      fase: 'escritura', error: ultimoFallo, cifraCalculada,
    }
  }

  let mensajes = []
  try {
    mensajes = await readMessages({ ...destino, area: areaDestino ?? area, transactionId: hecho.transactionId })
  } catch {
    // Que no se puedan leer los mensajes no cambia lo que se escribió.
    mensajes = []
  }

  return { desde, filas: filas.length, escritas: escribibles.length, ok: true, agotado, mensajes, ...hecho }
}

/**
 * Copia una cifra clave entera, segmento a segmento.
 *
 * Para los tests y para quien pueda encadenarlos de un tirón. La pantalla encadena
 * `migrarSegmentoDeCifras` ella misma para ir contando.
 */
export async function migrarCifras({ total, onProgreso, ...resto }) {
  const csrf = await abrirSesionDeEscritura(resto.destino)
  const segmentos = []
  let copiadas = 0

  for (let desde = 0; desde < total; desde += FILAS_POR_SEGMENTO) {
    const segmento = await migrarSegmentoDeCifras({
      ...resto,
      csrf,
      desde,
      cuantas: Math.min(FILAS_POR_SEGMENTO, total - desde),
      onProgreso,
    })

    segmentos.push(segmento)
    if (segmento.ok) copiadas += segmento.filas
    // Una cifra calculada no mejora en el segmento siguiente: se para.
    if (segmento.cifraCalculada || segmento.agotado) break
  }

  return {
    total,
    copiadas,
    segmentos,
    mensajes: [...segmentos].reverse().find((uno) => uno.mensajes?.length)?.mensajes ?? [],
    cifraCalculada: segmentos.find((uno) => uno.cifraCalculada)?.cifraCalculada ?? null,
    ok: segmentos.every((uno) => uno.ok),
  }
}
