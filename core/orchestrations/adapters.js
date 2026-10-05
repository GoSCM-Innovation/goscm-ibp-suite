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
import {
  CODIGO_CANCELADO,
  estadoParaElMotor,
  identificadorDeEjecucion,
  partirIdentificador,
} from '../ibp/job-orchestration.js'
import { cancelJobRun, readJobRun, readLatestTemplateRun } from '../ibp/job-runs.js'
import { scheduleJob } from '../ibp/job-schedule.js'

/** El acuerdo de los Application Jobs. */
const ACUERDO_DE_TRABAJOS = 'SAP_COM_0326'

/**
 * Cuánto esperaba v8 antes de buscar el trabajo que `JobSchedule` no nombró. Ver `lanzar` de IBP.
 */
export const ESPERA_ANTES_DE_BUSCAR_MS = 2000

const esperarMs = (ms) => new Promise((resolver) => { setTimeout(resolver, ms) })

/**
 * Las reglas de ejecución de los Application Jobs: las del orquestador de v8 (`useOrchRun.js`), en
 * lo que difiere del de v9. Ver `DEFAULT_RUN_POLICY` en `run-state.js` para qué es cada una.
 *
 *   - Cortar no le pide nada a SAP: v8 solo dejaba de preguntar.
 *   - Un trabajo `C` o `D` deja el paso «Cancelado» y la cadena SIGUE; un hijo cancelado deja
 *     cancelado a su grupo.
 *   - Agotar los reintentos PARA la cadena, igual que «Detener si falla».
 *   - Un paso fallado con «Continuar si falla» no deja la ejecución en error: termina «Completado».
 *   - Cortar deja TODO lo no terminado «Cancelado» (no hay «omitido») y no reintenta el cerrojo.
 */
export const POLITICA_IBP = Object.freeze({
  cancelSkipsPending: false,
  cancelLockAttempts: 1,
  cancelInSap: false,
  cancelledBlocks: false,
  exhaustedRetryBlocks: true,
  assumedFailureFailsRun: false,
  cancelledChildCancelsGroup: true,
  cancelledCodes: Object.freeze([CODIGO_CANCELADO]),
})

/**
 * Cuánto espera CI-DS antes del segundo intento de lanzar una tarea. Ver `lanzar` de CI-DS.
 */
export const ESPERA_ANTES_DE_RELANZAR_MS = 1500

/**
 * Las variables globales con que se lanza un paso: las del paso, con el valor de la ejecución encima.
 *
 * Como `mergeVariables` de v9: una variable que la ejecución trae SOLO se aplica a los pasos que ya la
 * tienen declarada, y entonces su valor pisa al del paso. Las que el paso no declara NO se mandan:
 * lanzar una tarea con una variable que no conoce es pedirle a CI-DS algo que no definió esa tarea.
 * Sin variables de la ejecución, las del paso se mandan tal cual.
 */
export function mergeVariables(delPaso = [], deLaEjecucion = []) {
  if (!deLaEjecucion || deLaEjecucion.length === 0) return delPaso

  const porNombre = new Map()
  for (const variable of delPaso) porNombre.set(variable?.name, variable)
  // `deLaEjecucion` lo manda quien lanza, sin validar: una entrada rota no puede tumbar el lanzamiento.
  for (const variable of deLaEjecucion) {
    if (!variable || !porNombre.has(variable.name)) continue
    porNombre.set(variable.name, { ...porNombre.get(variable.name), value: variable.value })
  }
  return [...porNombre.values()]
}

const adaptadorCids = {
  /**
   * Lanza una tarea en CI-DS y devuelve el identificador de la ejecución.
   *
   * Como v9: si CI-DS rechaza el lanzamiento con un error que NO es de sesión, se vuelve a intentar UNA
   * vez tras 1,5 s. A veces rechaza la primera llamada de un arranque en frío y la segunda entra. Un
   * error de sesión no se reintenta aquí: la misma sesión no se va a arreglar sola, y `runCidsOperation`
   * ya se vuelve a identificar una vez por su cuenta.
   *
   * Solo se reintenta si la llamada FALLÓ. Una respuesta que llega sin identificador de ejecución no
   * se reintenta (v9 sí lo hacía): CI-DS contestó, y puede haber arrancado la tarea. Volver a
   * lanzarla duplicaría una carga.
   *
   * `esperar` se inyecta para probarlo sin esperar de verdad.
   */
  async lanzar(destino, nodo, porOmision, { esperar = esperarMs } = {}) {
    const datos = nodo.data ?? {}
    const params = {
      taskName: datos.taskName,
      ...(datos.agentName ?? porOmision.agentName ? { agentName: datos.agentName ?? porOmision.agentName } : {}),
      ...(datos.profileName ?? porOmision.profileName
        ? { profileName: datos.profileName ?? porOmision.profileName }
        : {}),
      // Como v9: el valor de la ejecución pisa al del paso, y solo en los pasos que ya la declaran.
      globalVariables: mergeVariables(datos.globalVariables ?? [], porOmision.globalVariables ?? []),
    }

    const lanzarUnaVez = () => runCidsOperation({ ...destino, operation: 'runTask', params })

    let respuesta
    try {
      respuesta = await lanzarUnaVez()
    } catch (fallo) {
      if (/session/i.test(fallo?.message ?? '')) throw fallo
      await esperar(ESPERA_ANTES_DE_RELANZAR_MS)
      respuesta = await lanzarUnaVez()
    }

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
  politica: POLITICA_IBP,

  /**
   * Lanza una plantilla de Application Job.
   *
   * El usuario con el que SAP lo corre es el de comunicación de la conexión, el mismo que manda la
   * pantalla «Job Templates» (y el que v8 inyectaba en `JobUser`). Lo pone el servidor: dejar que lo
   * diga la orquestación sería una forma de correr algo en nombre de un tercero.
   *
   * Si `JobSchedule` no devuelve el nombre del trabajo creado, se hace lo que hacía v8: esperar dos
   * segundos y tomar el último trabajo de esa plantilla.
   */
  async lanzar(destino, nodo) {
    const datos = nodo.data ?? {}
    if (!datos.templateName) throw new Error('El paso no dice qué plantilla de trabajo lanzar.')

    const tenant = await tenantDeIbp(destino)
    const salida = await scheduleJob({
      ...tenant,
      templateName: datos.templateName,
      jobText: datos.jobText || datos.templateName,
      jobUser: tenant.credentials?.user,
    })

    if (salida?.jobName) return identificadorDeEjecucion(salida.jobName, salida.jobRunCount ?? '')

    await esperarMs(ESPERA_ANTES_DE_BUSCAR_MS)
    const ultimo = await readLatestTemplateRun({ ...tenant, templateName: datos.templateName })
    if (!ultimo?.JobName) throw new Error(`No se encontró el job programado para ${datos.templateName}`)
    return identificadorDeEjecucion(ultimo.JobName, ultimo.JobRunCount ?? '')
  },

  /**
   * Pregunta cómo va una ejecución y lo traduce al idioma del motor.
   *
   * Se pide SOLO esa, filtrando por nombre y repetición en la consulta. El motor pregunta una vez
   * por vuelta y por cada paso en marcha, así que traer el lote entero para buscar dentro sería
   * pagar una lectura de dos mil filas muchas veces.
   *
   * Sin repetición se pregunta solo por el nombre, como v8, y la que conteste SAP se devuelve en
   * `sapRunId` para que el motor la guarde: sin ella no se pueden abrir los «Steps SAP» del paso.
   *
   * Si SAP todavía no la registró, `estadoParaElMotor` lo traduce como «en cola» y no como fallo.
   */
  async consultar(destino, sapRunId) {
    const partes = partirIdentificador(sapRunId)
    if (!partes) throw new Error(`Identificador de ejecución ilegible: "${sapRunId}".`)

    const tenant = await tenantDeIbp(destino)
    const fila = await readJobRun({ ...tenant, ...partes })
    const estado = estadoParaElMotor(fila)

    const repeticion = fila?.JobRunCount
    if (!partes.jobRunCount && repeticion !== undefined && repeticion !== null && repeticion !== '') {
      return { ...estado, sapRunId: identificadorDeEjecucion(partes.jobName, repeticion) }
    }
    return estado
  },

  /**
   * Le pide a SAP que detenga la ejecución. Solo se puede con las que están en marcha.
   *
   * El motor NO lo llama para IBP (`cancelInSap: false`); queda para el día que se decida avisar a
   * SAP al cortar, que es una decisión de producto y no de código.
   */
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
