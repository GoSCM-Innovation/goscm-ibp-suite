// El lector: convierte unas credenciales en una función que trae una URL y devuelve su
// contenido, reintentando lo que merece reintento.
//
// Reintentar una LECTURA es seguro: leer dos veces no cambia nada. Por eso el reintento vive
// aquí y no en el transporte, que no sabe si lo que le piden es una lectura o una escritura.
// **Las escrituras no se reintentan así** — un envío que ya llegó a SAP no se repite, porque
// duplicaría claves; lo que se repite es la operación completa.

import { SapError, sapFetch } from '../transport/sap-fetch.js'

export const DEFAULT_RETRIES = 5

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

/** Espera creciente y con techo: 400 ms, 800, 1600… hasta 5 s. */
export const defaultBackoff = (attempt) => Math.min(400 * 2 ** (attempt - 1), 5000)

export function createReader({
  credentials,
  kind = 'ibp',
  timeoutMs,
  retries = DEFAULT_RETRIES,
  onRetry,
  backoffMs = defaultBackoff,
} = {}) {
  return async function read(url) {
    let attempt = 0
    for (;;) {
      try {
        const { json } = await sapFetch({ url, credentials, kind, ...(timeoutMs ? { timeoutMs } : {}) })
        return json
      } catch (error) {
        const canRetry = error instanceof SapError && error.retryable && attempt < retries
        if (!canRetry) throw error
        attempt += 1
        onRetry?.({ attempt, error, url })
        await wait(backoffMs(attempt))
      }
    }
  }
}
