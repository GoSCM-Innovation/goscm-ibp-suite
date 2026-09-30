// Lo que la interfaz le pregunta a IBP sobre lo que consume el tenant: sus recursos y su uso.

import { expandRows } from '../../core/ibp/metering-rows.js'
import { api } from './api.js'

/** La serie de CPU y memoria de las últimas `horas`, ya agrupada, con su resumen. */
export function fetchResourceStats(connectionId, horas) {
  return api.get('/api/ibp/resource-stats', { connectionId, horas })
}

/** Los diez conjuntos de la telemetría, con los nombres que les daba v8. */
const CONJUNTOS = ['overview', 'planningViews', 'logons', 'fiori', 'dashboards', 'stories', 'alerts', 'users', 'components', 'chgKeyFig']

/**
 * La telemetría del período, como filas: `{ data: { overview, planningViews, … }, avisos }`.
 *
 * El servidor las manda compactadas para que quepan en una respuesta; aquí se expanden a las filas
 * que v8 leía directamente de SAP. Tarda: son diez conjuntos y el más grande se lee de a 5.000 filas.
 */
export async function fetchMetering(connectionId, { desde, hasta }) {
  const respuesta = await api.get('/api/ibp/metering', { connectionId, desde, hasta })
  const data = Object.fromEntries(CONJUNTOS.map((clave) => [clave, expandRows(respuesta.conjuntos?.[clave])]))
  return { data, avisos: respuesta.avisos ?? [] }
}
