// Lo que la interfaz le pregunta a IBP sobre lo que consume el tenant: sus recursos y su uso.

import { api } from './api.js'

/** La serie de CPU y memoria de las últimas `horas`, ya agrupada, con su resumen. */
export function fetchResourceStats(connectionId, horas) {
  return api.get('/api/ibp/resource-stats', { connectionId, horas })
}

/**
 * El consumo del tenant en los últimos `dias`, ya resumido.
 *
 * Tarda: son ocho conjuntos y el más grande se lee de a 5.000 filas. Por eso la pantalla lo avisa.
 */
export function fetchMetering(connectionId, dias) {
  return api.get('/api/ibp/metering', { connectionId, dias })
}
