// Lo que la interfaz le pregunta al servidor sobre cómo se llama cada cosa en un tenant.

import { api } from './api.js'

/**
 * Qué entidad cumple cada papel en ese destino.
 *
 * Devuelve las tres cosas: `detectado` (lo que dedujo la máquina), `guardado` (lo que corrigió una
 * persona) y `efectivo` (la respuesta combinada, que es la que se usa). La pantalla necesita las tres
 * porque lo que muestra es justamente la diferencia.
 */
export function fetchExplorerMap({ connectionId, planningArea, versionId = '' }) {
  return api.get('/api/ibp/explorer-map', { connectionId, planningArea, versionId })
}

/** Guarda las correcciones de ese destino, reemplazando las que hubiera. */
export function saveExplorerMap({ connectionId, planningArea, versionId = '', roles, fields }) {
  return api.put('/api/ibp/explorer-map', { connectionId, planningArea, versionId, roles, fields })
}

/** Borra las correcciones para volver a la detección automática. */
export function resetExplorerMap({ connectionId, planningArea, versionId = '' }) {
  return api.del('/api/ibp/explorer-map', { connectionId, planningArea, versionId })
}
