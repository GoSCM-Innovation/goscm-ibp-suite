// Escribir en el tenant las key figures editadas a mano. La parte que habla con SAP.
//
// Portado de `doSave` de `DataViewer/TransactionalDataViewer.jsx` de v8: getTransactionID →
// [InitiateParallelProcess] → envíos a `<ÁREA>Trans` → commit → esperar → mensajes. Separado de
// `planning-data-edit.js` por lo del bundle del navegador; ver su cabecera.

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

/**
 * Cuánto se espera a que SAP aplique la edición. Dos minutos, como v8: una edición a mano son docenas
 * de filas, y esperar los diez de una migración dejaría la pantalla colgada si algo se atasca.
 */
export const ESPERA_DE_EDICION_MS = 120_000

/** El nombre con que la transacción aparece en SAP, el de v8. */
export const NOMBRE_DE_LA_TRANSACCION = 'IBP-Viewer-KF-EDIT'

/**
 * Escribe las filas en UNA transacción.
 *
 * Sin segmentos ni reintentos: una edición a mano cabe en una transacción, y repetir un envío ya
 * preparado duplicaría valores dentro de ella. Si algo falla, la transacción queda sin confirmar y SAP
 * no guarda nada; se vuelve a pulsar «Guardar».
 *
 * `cifras` son las key figures que viajan en cada fila: el tope de envío se cuenta en VALORES.
 */
export async function escribirCifrasEditadas({
  baseUrl, credentials, area, versionId = '', campos, cifras = [], filas,
  esperaMs = ESPERA_DE_EDICION_MS, esperar,
}) {
  if (!filas?.length) throw new Error('No hay ninguna fila que escribir.')
  const destino = { baseUrl, credentials }

  // El token se pide una vez para toda la transacción. Si no llega, cada envío pide el suyo: más
  // lento, pero escribe igual. Es lo que hacía v8.
  let csrf = null
  try {
    csrf = await abrirSesionDeEscritura(destino)
  } catch {
    csrf = null
  }

  const transactionId = await getTransactionId({ ...destino, csrf })

  // Procesar en paralelo es una mejora, no un requisito: si falla, se escribe igual.
  try {
    await initiateParallelProcess({
      ...destino, transactionId, area, versionId, nombre: NOMBRE_DE_LA_TRANSACCION, csrf,
    })
  } catch {
    // Sin paralelo.
  }

  for (const envio of partirEnEnvios(filas, cifras.length)) {
    await postKfChunk({
      ...destino, area, transactionId, filas: envio, campos, versionId, confirmarYa: false, csrf,
    })
  }

  await commitTransaction({ ...destino, transactionId, csrf })
  const estado = await waitForProcessed({
    ...destino, transactionId, timeoutMs: esperaMs, ...(esperar ? { esperar } : {}),
  })

  let mensajes = []
  try {
    mensajes = await readMessages({ ...destino, area, transactionId })
  } catch {
    // Que no se puedan leer los mensajes no cambia lo que se escribió.
    mensajes = []
  }

  return { transactionId, estado, mensajes, filas: filas.length }
}
