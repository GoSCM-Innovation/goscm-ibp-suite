// Cómo lanza y consulta un paso cada tipo de conexión.
//
// El motor no sabe de SAP: sabe de pasos, dependencias, grupos y reintentos. Lo que cambia entre
// CI-DS e IBP es solo qué se lanza y cómo se pregunta cómo va, y eso son estas dos funciones.
//
// Es la misma decisión de siempre en este proyecto —fusión hacia abajo, separación hacia arriba—:
// las reglas de reintento y de dependencias son las mismas para los dos, y duplicar el motor
// significaría arreglar un fallo en una copia y no en la otra. Lo que de verdad difiere se aísla
// aquí, donde se ve de un vistazo.

import { getConnectionTarget, getCredentials } from '../connections/index.js'
import { runCidsOperation } from '../cids/operations.js'
import { estadoParaElMotor, identificadorDeEjecucion, partirIdentificador } from '../ibp/job-orchestration.js'
import { cancelJobRun, readJobRun } from '../ibp/job-runs.js'
import { scheduleJob } from '../ibp/job-schedule.js'

/** El acuerdo de los Application Jobs. */
const ACUERDO_DE_TRABAJOS = 'SAP_COM_0326'

const adaptadorCids = {
  /** Lanza una tarea en CI-DS y devuelve el identificador de la ejecución. */
  async lanzar(destino, nodo, porOmision) {
    const datos = nodo.data ?? {}
    const respuesta = await runCidsOperation({
      ...destino,
      operation: 'runTask',
      params: {
        taskName: datos.taskName,
        ...(datos.agentName ?? porOmision.agentName ? { agentName: datos.agentName ?? porOmision.agentName } : {}),
        ...(datos.profileName ?? porOmision.profileName
          ? { profileName: datos.profileName ?? porOmision.profileName }
          : {}),
        // Las del paso pisan a las generales: lo específico manda sobre lo que se puso para todos.
        globalVariables: [...(porOmision.globalVariables ?? []), ...(datos.globalVariables ?? [])],
      },
    })

    const runId = respuesta?.runId
    if (!runId) throw new Error(`CI-DS no devolvió el identificador de ejecución de "${datos.taskName}".`)
    return runId
  },

  consultar(destino, sapRunId) {
    return runCidsOperation({ ...destino, operation: 'getTaskStatusByRunId2', params: { runId: sapRunId } })
  },

  cancelar(destino, sapRunId) {
    return runCidsOperation({ ...destino, operation: 'cancelTask', params: { runId: sapRunId } })
  },
}

/** La dirección y las credenciales de un tenant de IBP, para los Application Jobs. */
async function tenantDeIbp({ clientId, connectionId }) {
  const conexion = await getConnectionTarget(clientId, connectionId)
  return {
    baseUrl: conexion.baseUrl,
    credentials: await getCredentials(clientId, connectionId, ACUERDO_DE_TRABAJOS),
  }
}

const adaptadorIbp = {
  /**
   * Lanza una plantilla de Application Job.
   *
   * El usuario con el que SAP lo corre lo decide el servidor, igual que en la pantalla de trabajos:
   * dejar que lo ponga la orquestación sería una forma de correr algo en nombre de un tercero.
   */
  async lanzar(destino, nodo) {
    const datos = nodo.data ?? {}
    if (!datos.templateName) throw new Error('El paso no dice qué plantilla de trabajo lanzar.')

    const tenant = await tenantDeIbp(destino)
    const salida = await scheduleJob({
      ...tenant,
      templateName: datos.templateName,
      jobText: datos.jobText || datos.templateName,
    })

    if (!salida?.jobName) throw new Error(`SAP no devolvió la ejecución de "${datos.templateName}".`)
    return identificadorDeEjecucion(salida.jobName, salida.jobRunCount ?? '')
  },

  /**
   * Pregunta cómo va una ejecución y lo traduce al idioma del motor.
   *
   * Se pide SOLO esa, filtrando por nombre y repetición en la consulta. El motor pregunta una vez
   * por vuelta y por cada paso en marcha, así que traer el lote entero para buscar dentro sería
   * pagar una lectura de dos mil filas muchas veces.
   *
   * Si SAP todavía no la registró, `estadoParaElMotor` lo traduce como «en cola» y no como fallo.
   */
  async consultar(destino, sapRunId) {
    const partes = partirIdentificador(sapRunId)
    if (!partes) throw new Error(`Identificador de ejecución ilegible: "${sapRunId}".`)

    const tenant = await tenantDeIbp(destino)
    return estadoParaElMotor(await readJobRun({ ...tenant, ...partes }))
  },

  /** Le pide a SAP que detenga la ejecución. Solo se puede con las que están en marcha. */
  async cancelar(destino, sapRunId) {
    const partes = partirIdentificador(sapRunId)
    if (!partes) return null

    const tenant = await tenantDeIbp(destino)
    return cancelJobRun({ ...tenant, jobName: partes.jobName, jobRunCount: partes.jobRunCount })
  },
}

/** Los adaptadores, por el tipo de conexión contra la que corre la orquestación. */
export const ADAPTADORES = Object.freeze({ cids: adaptadorCids, ibp: adaptadorIbp })

/** El adaptador de un tipo de conexión. Un tipo desconocido es un error, no un silencio. */
export function adaptadorPara(kind) {
  const adaptador = ADAPTADORES[kind]
  if (!adaptador) throw new Error(`No hay forma de orquestar una conexión de tipo "${kind}".`)
  return adaptador
}
