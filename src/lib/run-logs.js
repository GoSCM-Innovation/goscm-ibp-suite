// De dónde sale el registro de un paso de una orquestación.
//
// Lo común —el árbol, los tiempos, la tabla— está en `RunDetail`. Aquí está el registro de CI-DS: el
// log de la tarea. El orquestador de IBP tiene su propia pantalla, la de v8, y lee los pasos del
// trabajo con el panel «Steps SAP».

import { cidsCall } from './cids.js'

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

