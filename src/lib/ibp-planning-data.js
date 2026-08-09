// Lo que la interfaz le pregunta a IBP sobre sus cifras clave.

import { api } from './api.js'

/** Lo que define una consulta de cifras, tal como viaja por la red. */
const comoConsulta = ({ area, cifra, dimensiones, condiciones, conversiones, soloConValor }) => ({
  area,
  ...(cifra ? { cifra } : {}),
  ...(dimensiones?.length ? { dimensiones: JSON.stringify(dimensiones) } : {}),
  ...(condiciones?.length ? { condiciones: JSON.stringify(condiciones) } : {}),
  ...(conversiones && Object.keys(conversiones).length ? { conversiones: JSON.stringify(conversiones) } : {}),
  ...(soloConValor ? { soloConValor: 'true' } : {}),
})

/** Áreas, dimensiones, cifras clave, etiquetas y versiones. Es una lectura cara: se pide una vez. */
export function fetchPlanningCatalog(connectionId, area) {
  return api.get('/api/ibp/planning-data', { connectionId, accion: 'catalogo', ...(area ? { area } : {}) })
}

/** Qué atributos de conversión exige una cifra: sin ellos SAP no deja leerla. */
export async function fetchConversions(connectionId, { area, cifra }) {
  const { conversiones } = await api.get('/api/ibp/planning-data', {
    connectionId, accion: 'conversiones', area, cifra,
  })
  return conversiones
}

/** Cuántas filas devolvería la consulta, sin traerlas. */
export async function fetchPlanningCount(connectionId, consulta) {
  const { total } = await api.get('/api/ibp/planning-data', {
    connectionId, accion: 'cuenta', ...comoConsulta(consulta),
  })
  return total
}

/** Una página de filas. Devuelve también cuántas se descartaron por valer cero. */
export function fetchPlanningRows(connectionId, consulta, { skip = 0, top = 500 } = {}) {
  return api.get('/api/ibp/planning-data', {
    connectionId, accion: 'filas', skip, top, ...comoConsulta(consulta),
  })
}
