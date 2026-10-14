// Ejecutar una integración: lo que hace el botón «Ejecutar», y cada paso de una orquestación.
//
// Es UN solo camino para los dos, a propósito: lo que protege una carga a IBP (el candado, la validación de
// las variables, el registro, la regla de no reintentar lo que quedó en duda) vive aquí una vez, y una
// orquestación no puede saltárselo.
//
// El orden importa y cada paso tiene su razón:
//
//   1. Se comprueba todo lo que se puede comprobar SIN enviar: la conexión, que la integración sea de esa
//      conexión, que no falte ninguna variable, que haya credenciales. Un fallo aquí no envía nada.
//   2. Se toma el candado de la integración. Si alguien más la está ejecutando (otra pestaña, otra persona, un
//      doble clic), esta no sale: lanzar la misma carga dos veces a la vez es duplicarla en IBP.
//      Sin Redis no hay candado, y sin candado NO se envía: falla cerrado.
//   3. Se anota la ejecución como «running» ANTES de enviar. Si la función muere a mitad, queda constancia de
//      que algo salió.
//   4. Se envía, y se cierra el registro con lo que CPI contestó.
//
// El candado dura lo que la llamada más larga (300 s): si la función muere con él puesto, vence solo.

import { randomUUID } from 'node:crypto'
import { getRedis, tenantKey } from '../persistence/redis.js'
import { CI_AGREEMENT, getCredentials } from '../connections/connections.js'
import { aplicarVariables } from './body.js'
import { llamarEndpoint } from './call.js'
import { cerrarEjecucion, registrarEjecucion } from './history.js'
import { assertConexionCi, getIntegration } from './integrations.js'

export const CANDADO_SEGUNDOS = 300

const claveDelCandado = (clientId, integrationId) => tenantKey(clientId, 'ci-lock', integrationId)

/** Toma el candado de una integración. Devuelve `true` si es nuestro. */
async function tomarCandado(clientId, integrationId, marca) {
  return Boolean(await getRedis().set(claveDelCandado(clientId, integrationId), marca, { nx: true, ex: CANDADO_SEGUNDOS }))
}

/** Suelta el candado solo si sigue siendo el nuestro: si venció y es de otro, borrarlo lo dejaría sin protección. */
async function soltarCandado(clientId, integrationId, marca) {
  try {
    const redis = getRedis()
    const clave = claveDelCandado(clientId, integrationId)
    if (await redis.get(clave) === marca) await redis.del(clave)
  } catch {
    // Vence solo; no vale la pena tumbar el resultado por no poder soltarlo.
  }
}

/** El resultado de una ejecución que no llegó a enviar nada. */
const sinEnviar = (mensaje, extra = {}) => ({
  resultado: 'error', enviado: false, httpStatus: null, duracionMs: 0, mplId: null, mensaje, ...extra,
})

/**
 * Ejecuta una integración y devuelve cómo salió:
 *
 *   { runId, nombre, resultado: 'success' | 'error' | 'unconfirmed', enviado, httpStatus, duracionMs, mplId,
 *     mensaje, bloqueada? }
 *
 * No lanza por problemas de la ejecución: los devuelve como `error` para que un paso de una orquestación los
 * trate como el fallo de ese paso. `bloqueada` es `true` cuando no salió porque otra ejecución de la misma
 * integración estaba en curso.
 *
 * `llamar` y `ahora` se inyectan para las pruebas.
 */
export async function executeIntegration({
  clientId,
  connectionId,
  integrationId,
  variables = {},
  origin = 'manual',
  orchestrationId = null,
  user = null,
  runId = randomUUID(),
  llamar = llamarEndpoint,
}) {
  let conexion
  try {
    conexion = await assertConexionCi(clientId, connectionId)
  } catch (fallo) {
    return { runId, nombre: null, ...sinEnviar(fallo.message) }
  }

  const integracion = await getIntegration(clientId, integrationId)
  if (!integracion || integracion.connectionId !== connectionId) {
    return { runId, nombre: null, ...sinEnviar('La integración no existe en esta conexión.') }
  }

  const registro = { id: runId, connectionId, integracion, orchestrationId, origin, user, variables }

  /** Falla antes de enviar: se anota (nace y termina cerrada) y se devuelve. */
  const fallaAntes = async (mensaje) => {
    const resultado = sinEnviar(mensaje)
    try {
      await registrarEjecucion(clientId, { ...registro, resultado })
    } catch (fallo) {
      console.error(`[ci/execute] no se pudo anotar el fallo: ${fallo.message}`)
    }
    return { runId, nombre: integracion.name, ...resultado }
  }

  let cuerpo
  try {
    cuerpo = aplicarVariables(integracion.body, variables)
  } catch (fallo) {
    return fallaAntes(fallo.message)
  }

  let credenciales
  try {
    credenciales = await getCredentials(clientId, connectionId, CI_AGREEMENT)
  } catch (fallo) {
    return fallaAntes(fallo.message)
  }

  let candado
  try {
    candado = await tomarCandado(clientId, integrationId, runId)
  } catch (fallo) {
    // Sin candado no se envía: sin él, un doble clic duplicaría la carga.
    console.error(`[ci/execute] no se pudo tomar el candado: ${fallo.message}`)
    return fallaAntes('No se pudo comprobar que la integración no esté ya en ejecución, así que no se envió.')
  }
  if (!candado) {
    return {
      runId, nombre: integracion.name, bloqueada: true,
      ...sinEnviar('Esa integración ya se está ejecutando. Espera a que termine.'),
    }
  }

  try {
    try {
      await registrarEjecucion(clientId, registro)
    } catch (fallo) {
      // Sin registro no se envía: una carga a IBP sin rastro de quién la lanzó no es aceptable.
      console.error(`[ci/execute] no se pudo anotar la ejecución: ${fallo.message}`)
      return { runId, nombre: integracion.name, ...sinEnviar('No se pudo registrar la ejecución, así que no se envió.') }
    }

    const resultado = await llamar({ url: conexion.baseUrl, credentials: credenciales, cuerpo })

    try {
      await cerrarEjecucion(clientId, runId, resultado)
    } catch (fallo) {
      // La carga ya salió: se devuelve su resultado aunque no se haya podido anotar.
      console.error(`[ci/execute] no se pudo cerrar el registro: ${fallo.message}`)
    }
    return { runId, nombre: integracion.name, ...resultado }
  } finally {
    await soltarCandado(clientId, integrationId, runId)
  }
}
