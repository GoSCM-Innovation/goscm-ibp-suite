// De dónde sale el registro de un paso de una orquestación.
//
// Lo común —el árbol, los tiempos, la tabla— está en `RunDetail`. Aquí solo está lo que DIFIERE entre
// los dos SAP, que es el mismo reparto que hace el motor con sus adaptadores: en CI-DS el registro es
// el log de la tarea, y en IBP son los mensajes de los pasos del trabajo, que hay que pedir en dos
// tiempos —primero qué registros dejó cada paso, después sus líneas—.

import { partirIdentificador } from '../../core/ibp/job-orchestration.js'
import { cidsCall } from './cids.js'
import { fetchLogMessages, fetchRunSteps, fetchStepLogs } from './ibp-jobs.js'

/** Una sección de registro con sus líneas. Vacía si no trajo nada. */
const seccion = (nombre, lineas) => ({ nombre, lineas: (lineas ?? []).filter(Boolean) })

/**
 * El registro de una tarea de CI-DS.
 *
 * Se piden las dos partes que v9 pedía: el registro del monitor y el de errores. El de traza se
 * muestra si viene, pero no se pide: en una tarea grande pesa muchísimo y casi nunca se mira.
 */
export function lectorDeCids(destino) {
  return async (paso) => {
    const datos = await cidsCall(destino, 'getTaskLogs', {
      runId: paso.sapRunId,
      errorLog: { getLog: true },
      monitorLog: { getLog: true },
    })

    return ['monitorLog', 'errorLog', 'traceLog']
      .map((cual) => seccion(cual, datos?.[cual]?.messageLines))
      .filter((una) => una.lineas.length > 0)
  }
}

/**
 * El registro de un Application Job de IBP.
 *
 * Son sus PASOS: un trabajo puede tener treinta, y cada uno deja sus propios registros. Se junta todo
 * con el nombre del paso por delante, que es lo que permite leer de un tirón dónde se rompió.
 *
 * Un paso sin registros no se salta en silencio: aparece diciendo que no dejó ninguno, porque «este
 * paso no dijo nada» y «este paso no existe» no son lo mismo cuando se está buscando un fallo.
 */
export function lectorDeIbp(conexionId) {
  return async (paso) => {
    const partes = partirIdentificador(paso.sapRunId)
    if (!partes) throw new Error(`No se entiende el identificador de ejecución «${paso.sapRunId}».`)

    const pasos = await fetchRunSteps(conexionId, { jobName: partes.jobName, runCount: partes.jobRunCount })
    const secciones = []

    for (const uno of pasos) {
      const registros = await fetchStepLogs(conexionId, {
        jobName: partes.jobName,
        runCount: partes.jobRunCount,
        stepNumber: uno.StepNumber,
      })

      const nombre = `Paso ${uno.StepNumber} · ${uno.JobCatalogEntryText || uno.JobCatalogEntry || ''}`.trim()

      if (registros.length === 0) {
        secciones.push(seccion(nombre, ['(sin registros)']))
        continue
      }

      const lineas = []
      for (const registro of registros) {
        const mensajes = await fetchLogMessages(conexionId, {
          jobName: partes.jobName,
          runCount: partes.jobRunCount,
          stepNumber: uno.StepNumber,
          logHandle: registro.LogHandle,
        })
        // El tipo de mensaje delante: es lo que deja ver de un vistazo dónde están los errores entre
        // cincuenta líneas informativas.
        lineas.push(...mensajes.map((mensaje) => `[${mensaje.MsgType ?? ' '}] ${mensaje.MsgText ?? ''}`))
      }

      secciones.push(seccion(nombre, lineas))
    }

    return secciones.filter((una) => una.lineas.length > 0)
  }
}
