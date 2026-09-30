// Guardar key figures editadas a mano en «Ver Dato Transaccional».
//
// Escribe en el tenant valores que ya existen, así que la confirmación viaja en el cuerpo: sin ella
// el servidor rechaza la llamada. Es la misma palabra que al guardar dato maestro.

import { api } from './api.js'

/**
 * Escribe los cambios pendientes.
 *
 * `edits` es `{ [claveDeFila]: { row, changes } }` tal como lo junta la pantalla —la forma de v8—;
 * aquí se pasa a la del servidor. El servidor arma las filas y solo deja pasar key figures.
 */
export function guardarCifras(connectionId, { area, versionId, atributos, tiempo, cifras, edits }) {
  return api.post('/api/ibp/planning-data-edit', {
    confirmacion: 'guardar',
    connectionId,
    area,
    versionId,
    atributos,
    tiempo,
    cifras,
    edits: Object.fromEntries(Object.entries(edits ?? {})
      .map(([clave, { row, changes }]) => [clave, { fila: row, cambios: changes }])),
  })
}
