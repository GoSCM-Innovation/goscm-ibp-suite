// Escribir la edición en el tenant. La parte que habla con SAP.
//
// Está separada de `master-data-edit.js` a propósito, igual que `migration-run.js` lo está de
// `migration-plan.js`: la pantalla necesita las funciones puras —resumir los cambios, armar las
// filas— y si vinieran del mismo archivo que esto, el bundle del navegador acabaría arrastrando
// `node:dns` por la validación SSRF del transporte.

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

/**
 * Escribe un conjunto de filas —modificándolas o borrándolas— en UNA transacción.
 *
 * A diferencia de la migración no hay segmentos: una edición a mano son docenas de filas, no un
 * millón, y partirla en transacciones sueltas solo abriría la puerta a que la mitad quede aplicada.
 *
 * Una transacción no puede MEZCLAR borrado y modificación —SAP responde "Create a new transaction ID
 * to use a different DeleteEntries value"—, así que `borrar` es de la llamada entera.
 */
export async function escribirDatoMaestro({
  baseUrl, credentials, entidad, filas, borrar = false, planningArea, versionId, nombre,
}) {
  if (!filas || filas.length === 0) throw new Error('No hay ninguna fila que escribir.')

  const csrf = await abrirSesionDeEscritura({ baseUrl, credentials })
  const destino = { baseUrl, credentials }

  const transactionId = await getTransactionId({ ...destino, entidad, planningArea, versionId, csrf })
  await initiateParallelProcess({ ...destino, transactionId, entidad, planningArea, versionId, nombre, csrf })

  for (const envio of partirEnEnvios(filas)) {
    await postTransChunk({
      ...destino, entidad, transactionId, filas: envio, borrar, planningArea, versionId, csrf,
    })
  }

  await commitTransaction({ ...destino, transactionId, csrf })
  const estado = await waitForProcessed({ ...destino, transactionId })

  let mensajes = []
  try {
    mensajes = await readMessages({ ...destino, entidad, transactionId })
  } catch {
    // Que no se puedan leer los mensajes no cambia lo que se escribió.
    mensajes = []
  }

  return {
    transactionId,
    estado,
    mensajes,
    filas: filas.length,
    // SAP procesó la transacción y no dejó mensajes de rechazo: eso es haber salido bien.
    ok: (estado === 'PROCESADA' || estado === 'SIN_SOPORTE') && mensajes.length === 0,
  }
}
