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
