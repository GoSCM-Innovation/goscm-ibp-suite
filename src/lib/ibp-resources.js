// Lo que la interfaz le pregunta a IBP sobre el consumo de recursos del tenant.

import { api } from './api.js'

/** La serie de CPU y memoria de las últimas `horas`, ya agrupada, con su resumen. */
export function fetchResourceStats(connectionId, horas) {
  return api.get('/api/ibp/resource-stats', { connectionId, horas })
}
