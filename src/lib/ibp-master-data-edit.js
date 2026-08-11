// Modificar y borrar dato maestro de un tenant.
//
// Son las dos únicas operaciones de la aplicación que tocan filas que YA existen, así que la
// confirmación viaja en el cuerpo: sin ella el servidor rechaza la llamada. Y son dos palabras
// distintas a propósito —modificar se puede volver a cambiar, borrar en IBP no se deshace—, así que
// no se ofrece una función genérica que reciba la acción y la palabra desde fuera.

import { api } from './api.js'

/**
 * Escribe los cambios pendientes.
 *
 * `edits` es `{ [claveDeFila]: { fila, cambios } }` tal como lo junta la pantalla; el servidor arma
 * las filas a mandar y descarta lo de solo lectura.
 */
export function guardarDatoMaestro(connectionId, { entidad, planningArea, versionId, claves, edits }) {
  return api.post('/api/ibp/master-data-edit', {
    accion: 'modificar',
    confirmacion: 'guardar',
    connectionId,
    entidad,
    planningArea,
    versionId,
    claves,
    edits,
  })
}

/** Borra registros. En SAP IBP esto es irreversible: no hay papelera ni deshacer. */
export function borrarDatoMaestro(connectionId, { entidad, planningArea, versionId, claves, filas }) {
  return api.post('/api/ibp/master-data-edit', {
    accion: 'borrar',
    confirmacion: 'borrar',
    connectionId,
    entidad,
    planningArea,
    versionId,
    claves,
    filas,
  })
}
