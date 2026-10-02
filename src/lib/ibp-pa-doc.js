// Lo que el documentador le pregunta a IBP en vivo.
//
// El navegador no sabe la dirección del tenant ni sus credenciales: solo dice a qué conexión. Las tres
// operaciones son de `handlers/ibp/pa-doc-live.js`.

import { api } from './api.js'

const llamar = (connectionId, accion, ids) => api.post('/api/ibp/pa-doc-live', {
  connectionId, accion, ...(ids ? { ids } : {}),
})

/** Qué entidad de dato maestro tiene cada tipo: `{ ID: 'Entidad' | null }`. */
export async function fetchEntidadesDeTipos(connectionId, ids) {
  const { entidades } = await llamar(connectionId, 'entidades', ids)
  return entidades
}

/** Cuántos registros tiene cada tipo: `{ ID: número | null }`. */
export async function fetchVolumetria(connectionId, ids) {
  const { cuentas } = await llamar(connectionId, 'volumetria', ids)
  return cuentas
}

/** Las plantillas de Application Job con sus pasos: `{ entidades, jobs }`. */
export function fetchApplicationJobs(connectionId) {
  return llamar(connectionId, 'application-jobs')
}
