// Lo que la interfaz le pregunta a IBP sobre migrar cifras clave entre tenants.

import { api } from './api.js'

/** Lo que el servidor exige recibir para escribir de verdad. */
export const CONFIRMACION_DE_COPIA = 'copiar'

/** Qué se copiaría y qué lo impide, con los catálogos de los dos lados. Solo lee. */
export function revisarMigracionDeCifras(peticion) {
  return api.post('/api/ibp/kf-migration', { ...peticion, accion: 'revisar' })
}

/** Cuántas filas hay al nivel elegido. Solo lee. */
export async function contarCifras(peticion) {
  const { plan } = await api.post('/api/ibp/kf-migration', { ...peticion, accion: 'contar' })
  return plan
}

/**
 * Copia UN segmento. **Esto escribe en el tenant de destino.**
 *
 * Un segmento por llamada porque una cifra puede ser un millón de filas y no cabe en el tiempo de una
 * función. Quien llama encadena.
 */
export function copiarSegmentoDeCifras(peticion) {
  return api.post('/api/ibp/kf-migration', {
    ...peticion, accion: 'copiar', confirmacion: CONFIRMACION_DE_COPIA,
  })
}
