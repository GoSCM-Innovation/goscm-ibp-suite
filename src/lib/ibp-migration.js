// Lo que la interfaz le pregunta a IBP sobre una migración entre dos tenants.

import { api } from './api.js'

/**
 * Qué se copiaría de un tenant a otro. Solo lee.
 *
 * Va por POST porque lleva la lista de tablas y las parejas puestas a mano, no porque cambie nada.
 */
export function fetchMigrationPlan({ origen, destino, tablas, tablasDelDestino, destinoDe, condiciones }) {
  return api.post('/api/ibp/migration', {
    origen, destino, tablas, tablasDelDestino, destinoDe, condiciones,
  })
}

/** Lo que el servidor exige recibir para escribir de verdad. */
export const CONFIRMACION_DE_CARGA = 'copiar'

/**
 * Copia UN segmento. **Esto escribe en el tenant de destino.**
 *
 * Un segmento por llamada porque una tabla grande no cabe en el tiempo de una función, y porque
 * cada segmento es ya una transacción de SAP. Quien llama encadena.
 */
export function runMigrationSegment(peticion) {
  return api.post('/api/ibp/migration-run', { ...peticion, confirmacion: CONFIRMACION_DE_CARGA })
}
