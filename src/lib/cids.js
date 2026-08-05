// Lo que la interfaz necesita para hablar con CI-DS: siempre a través de nuestra API.
//
// El navegador no sabe la dirección del tenant, ni su usuario, ni el identificador de sesión con
// SAP. Todo eso vive en el servidor. Aquí solo se dice a qué conexión y qué operación.

import { api } from './api.js'

/**
 * Cuántas ejecuciones lleva cada tanda al pedir fin y duración.
 *
 * Tiene que ser menor o igual que `MAX_RUNS_PER_BATCH` de `core/cids/task-details.js`, que es
 * quien lo hace cumplir. Está repetido a propósito: el frontend no importa de `core/`.
 */
export const RUNS_PER_BATCH = 15

/**
 * Una operación de CI-DS. Devuelve ya el resultado, sin la envoltura de la respuesta.
 *
 * `destino` es una conexión Y uno de sus dos repositorios: en CI-DS la misma conexión da acceso al de
 * pruebas y al productivo, y lo decide una bandera del logon.
 */
export async function cidsCall(destino, operation, params = {}) {
  const { result } = await api.post('/api/cids/call', {
    connectionId: destino.connectionId,
    production: destino.production,
    operation,
    params,
  })
  return result
}

/** Las conexiones de CI-DS a las que puede apuntar este usuario. */
export async function listCidsConnections() {
  const { connections } = await api.get('/api/connections', { kind: 'cids' })
  return connections
}

/**
 * Cada conexión de CI-DS rinde DOS destinos: su repositorio de pruebas y su productivo.
 *
 * No es una comodidad de la interfaz, es cómo funciona el servicio: no hay dos conexiones que dar de
 * alta ni nada que enlazar. Con la misma dirección, la misma organización y las mismas credenciales,
 * `isProduction` en el logon decide a cuál de los dos entrás.
 */
export function cidsTargets(conexiones) {
  return conexiones.flatMap((conexion) => [
    {
      id: `${conexion.id}:sandbox`,
      connectionId: conexion.id,
      production: false,
      name: conexion.name,
      label: `${conexion.name} · Pruebas`,
    },
    {
      id: `${conexion.id}:production`,
      connectionId: conexion.id,
      production: true,
      name: conexion.name,
      label: `${conexion.name} · Productivo`,
    },
  ])
}

/**
 * Los nombres de tarea que este tenant ya tiene en producción, como conjunto para consultarlo
 * rápido. `null` significa que la comparación no aplica —esta conexión es la productiva o no
 * declaró su contraparte— y NO que no haya ninguna transportada.
 */
export async function fetchPromotedTaskNames(destino) {
  const { names } = await api.get('/api/cids/promoted', {
    connectionId: destino.connectionId,
    production: String(destino.production),
  })
  return Array.isArray(names) ? new Set(names) : null
}

/** Así se comparan los nombres. Tiene que coincidir con `normalizeTaskName` de `core/cids`. */
export function isTaskPromoted(promoted, taskName) {
  return Boolean(promoted?.has(String(taskName ?? '').trim().toUpperCase()))
}

/**
 * Qué marca de "ya transportada" corresponde al destino que se está mirando.
 *
 * La lista se pide por destino y tarda, así que hay momentos en los que la guardada es de otro: al
 * cambiar de repositorio, o antes de que llegue la primera. En esos casos no aplica ninguna, y
 * mostrar la anterior diría que una tarea está transportada cuando no se sabe.
 *
 * Está aquí y no dentro del componente porque es una decisión, no pintado — y porque escrita como
 * expresión suelta tenía un caso mortal: con las dos cosas en nulo, comparar sus identificadores daba
 * `undefined === undefined`, salía verdadero, y leer la lista de `null` reventaba la pantalla entera.
 */
export function promotedForTarget(guardadas, destino) {
  if (!destino || !guardadas) return null
  return guardadas.destinoId === destino.id ? guardadas.nombres : null
}

/**
 * Fin y duración de un puñado de ejecuciones, en tandas.
 *
 * Las tandas van **una tras otra, no en paralelo**. Si salieran a la vez, cada una consultaría a
 * SAP de a seis y el tenant recibiría veinticuatro consultas simultáneas en vez de seis. El
 * precio es una pequeña espera entre tandas; a cambio, el tope de concurrencia contra SAP es el
 * mismo que tenía v9.
 *
 * `shouldStop` se consulta antes de cada tanda: si el usuario ya cambió de página, las que
 * quedan no se piden.
 */
export async function fetchTaskDetails(destino, runIds, { shouldStop = () => false } = {}) {
  const detalles = {}

  for (let desde = 0; desde < runIds.length; desde += RUNS_PER_BATCH) {
    if (shouldStop()) break
    const { details } = await api.post('/api/cids/task-details', {
      connectionId: destino.connectionId,
      production: destino.production,
      runIds: runIds.slice(desde, desde + RUNS_PER_BATCH),
    })
    Object.assign(detalles, details)
  }

  return detalles
}
