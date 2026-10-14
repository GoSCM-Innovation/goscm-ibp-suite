// El historial de ejecuciones: quién ejecutó qué, contra qué, cuándo, cuánto tardó y cómo salió.
//
// Vive en Postgres (`ci_runs`) y no en Redis: es el rastro de lo que se cargó a IBP, y quien pregunta por una
// carga de la semana pasada no puede encontrarse con que venció. El estado de una ORQUESTACIÓN en marcha sí
// vive en Redis (ver `core/orchestrations`); aquí queda una fila por cada llamada a CPI, venga de donde venga.
//
// Una fila nace «running» ANTES de enviar y se cierra al recibir la respuesta. Si la función muere en medio,
// la fila se queda «running» para siempre: `estadoMostrado` la lee como «sin confirmar» pasado el tiempo que
// puede tardar una llamada, en vez de decir «en curso» eternamente.

import { queryOneScoped, queryScoped } from '../persistence/tenant-scope.js'
import { assertConexionCi, esUuid } from './integrations.js'

/**
 * Cuánto tiempo puede estar una fila «running» antes de leerse como «sin confirmar»: la llamada se corta a los
 * 270 s y la función a los 300, así que pasados 6 minutos nadie la está esperando ya.
 */
export const HUERFANA_MS = 6 * 60 * 1000

export const LIMITE_POR_OMISION = 100
export const LIMITE_MAXIMO = 500

/**
 * El estado que se enseña. Una fila «running» vieja es «unconfirmed»: se envió y nadie recogió la respuesta.
 */
export function estadoMostrado(fila, ahora = Date.now()) {
  if (fila.status !== 'running') return { status: fila.status, message: fila.message }
  const desde = Date.parse(fila.started_at)
  if (Number.isFinite(desde) && ahora - desde > HUERFANA_MS) {
    return {
      status: 'unconfirmed',
      message: 'No quedó registrada la respuesta de CPI (se interrumpió la ejecución). La carga pudo haber entrado: '
        + 'revísala en Cloud Integration antes de repetirla.',
    }
  }
  return { status: 'running', message: fila.message }
}

const aEjecucion = (fila, ahora) => {
  const { status, message } = estadoMostrado(fila, ahora)
  return {
    id: fila.id,
    integrationId: fila.integration_id,
    integrationName: fila.integration_name,
    folder: fila.folder,
    orchestrationId: fila.orchestration_id,
    orchestrationName: fila.orchestration_name ?? null,
    origin: fila.origin,
    userEmail: fila.user_email,
    status,
    httpStatus: fila.http_status,
    durationMs: fila.duration_ms,
    mplId: fila.mpl_id,
    message,
    variables: fila.variables ?? {},
    startedAt: fila.started_at,
    finishedAt: fila.finished_at,
  }
}

/**
 * Anota una ejecución. Sin `resultado` queda «running» (se acaba de enviar); con él, ya cerrada (es lo que se
 * usa para los fallos que ocurren antes de enviar, que nacen y terminan en el mismo instante).
 */
export async function registrarEjecucion(clientId, {
  id, connectionId, integracion, orchestrationId = null, origin, user = null, variables = {}, resultado = null,
}) {
  const cerrada = resultado !== null
  await queryScoped(
    clientId,
    `insert into ci_runs
       (id, client_id, connection_id, integration_id, integration_name, folder, orchestration_id, origin,
        user_id, user_email, status, http_status, duration_ms, mpl_id, message, variables, finished_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb,
             ${cerrada ? 'now()' : 'null'})`,
    [
      id, clientId, connectionId, integracion.id, integracion.name, integracion.folder, orchestrationId, origin,
      user?.id ?? null, user?.email ?? null,
      cerrada ? resultado.resultado : 'running',
      cerrada ? resultado.httpStatus ?? null : null,
      cerrada ? Math.round(resultado.duracionMs ?? 0) : null,
      cerrada ? resultado.mplId ?? null : null,
      cerrada ? resultado.mensaje ?? null : null,
      JSON.stringify(variables),
    ],
  )
}

/** Cierra una ejecución que estaba «running» con lo que CPI contestó. */
export async function cerrarEjecucion(clientId, id, resultado) {
  await queryScoped(
    clientId,
    `update ci_runs
        set status = $1, http_status = $2, duration_ms = $3, mpl_id = $4, message = $5, finished_at = now()
      where id = $6 and client_id = $7`,
    [
      resultado.resultado,
      resultado.httpStatus ?? null,
      Math.round(resultado.duracionMs ?? 0),
      resultado.mplId ?? null,
      resultado.mensaje ?? null,
      id,
      clientId,
    ],
  )
}

/** Las últimas ejecuciones de una conexión, las más recientes primero; opcionalmente de UNA integración. */
export async function listarEjecuciones(clientId, { connectionId, integrationId = null, limit = LIMITE_POR_OMISION }, ahora = Date.now()) {
  await assertConexionCi(clientId, connectionId)
  const tope = Math.min(LIMITE_MAXIMO, Math.max(1, Math.trunc(Number(limit)) || LIMITE_POR_OMISION))
  const filtraPorIntegracion = integrationId !== null
  if (filtraPorIntegracion && !esUuid(integrationId)) return []

  const filas = await queryScoped(
    clientId,
    `select r.id, r.integration_id, r.integration_name, r.folder, r.orchestration_id, o.name as orchestration_name,
            r.origin, r.user_email, r.status, r.http_status, r.duration_ms, r.mpl_id, r.message, r.variables,
            r.started_at, r.finished_at
       from ci_runs r
       left join orchestrations o on o.id = r.orchestration_id and o.client_id = r.client_id
      where r.client_id = $1 and r.connection_id = $2${filtraPorIntegracion ? ' and r.integration_id = $3' : ''}
      order by r.started_at desc
      limit ${tope}`,
    filtraPorIntegracion ? [clientId, connectionId, integrationId] : [clientId, connectionId],
  )
  return filas.map((fila) => aEjecucion(fila, ahora))
}

/**
 * Los valores de variables con que se corrió por última vez, para proponerlos en el diálogo de ejecutar: las
 * fechas se cambian a mano en cada corrida, y que aparezcan las de la anterior ahorra escribirlas de cero.
 * Vive en el servidor y no en el navegador a propósito: un valor guardado en el navegador no sabría de qué
 * tenant es.
 */
export async function ultimasVariables(clientId, { integrationId = null, orchestrationId = null }) {
  const porIntegracion = integrationId !== null
  const identificador = porIntegracion ? integrationId : orchestrationId
  if (!esUuid(identificador)) return {}

  const filas = await queryScoped(
    clientId,
    `select variables from ci_runs
      where client_id = $1 and ${porIntegracion ? 'integration_id' : 'orchestration_id'} = $2
        and variables <> '{}'::jsonb
      order by started_at desc
      limit 20`,
    [clientId, identificador],
  )

  // Las más recientes mandan: se recorre del final al principio para que lo nuevo pise a lo viejo.
  const reunidas = {}
  for (const fila of [...filas].reverse()) Object.assign(reunidas, fila.variables ?? {})
  return reunidas
}

/** Una ejecución por su identificador, o `null`. */
export async function obtenerEjecucion(clientId, id, ahora = Date.now()) {
  if (!esUuid(id)) return null
  const fila = await queryOneScoped(
    clientId,
    `select r.id, r.integration_id, r.integration_name, r.folder, r.orchestration_id, null as orchestration_name,
            r.origin, r.user_email, r.status, r.http_status, r.duration_ms, r.mpl_id, r.message, r.variables,
            r.started_at, r.finished_at
       from ci_runs r where r.id = $1 and r.client_id = $2`,
    [id, clientId],
  )
  return fila ? aEjecucion(fila, ahora) : null
}
