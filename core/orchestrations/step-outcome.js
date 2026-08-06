// Qué le pasa a un paso de una orquestación cuando SAP contesta.
//
// Es la parte del motor que decide, separada de la que hace: no toca Redis, no llama a SAP y no mira
// el reloj —el instante se le pasa—, así que se puede probar entera. Todo el conocimiento de SAP del
// motor vive aquí.
//
// Portado de `applyTaskResult` de `api/orchestrate.js` de v9.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// Por qué estas listas NO son las de `core/cids/task-status.js`, aunque se parezcan
// ────────────────────────────────────────────────────────────────────────────────────────────────
//
// La tabla de estados contesta "¿esta ejecución ya terminó?" para una pantalla que refresca. El motor
// contesta "¿puedo seguir con el paso siguiente?". Son preguntas distintas y en dos casos dan
// respuestas distintas, a propósito:
//
//   - `UNKNOWN`: la tabla dice que NO es terminal, para que el monitor siga preguntando en vez de
//     dejar una fila congelada para siempre. El motor lo trata como fallo, porque una orquestación
//     que espera indefinidamente a un paso del que SAP no sabe nada se cuelga sin decir nada.
//   - `TERMINATED`: para la tabla es un final más —alguien la canceló—. Para el motor es un fallo:
//     el paso no hizo su trabajo, así que lo que venía detrás no puede darse por bueno.
//
// Forzar una sola lista sería elegir una de las dos respuestas y equivocarse en la otra pantalla.

/** Terminó e hizo su trabajo. Los dos "con errores" cuentan: terminaron y dejaron el dato. */
const CODIGOS_CORRECTOS = new Set(['SUCCESS', 'SUCCESS_WITH_ERRORS_D', 'SUCCESS_WITH_ERRORS_E'])

/**
 * Códigos que algunos tenants devuelven en lugar de `SUCCESS`. No están documentados; están aquí
 * porque aparecieron en tenants reales y v9 tuvo que contemplarlos.
 */
const ALIAS_DE_CORRECTO = new Set(['COMPLETED', 'FINISHED', 'DONE'])

/** Terminó sin hacer su trabajo. Ver arriba por qué están `TERMINATED` y `UNKNOWN`. */
const CODIGOS_FALLIDOS = new Set(['ERROR', 'TERMINATED', 'TERMINATION_FAILED', 'UNKNOWN'])

/** Todavía está en marcha: no se decide nada y se vuelve a preguntar en el siguiente tick. */
const CODIGOS_EN_MARCHA = new Set(['RUNNING', 'QUEUEING', 'IMPORTED', 'FETCHED'])

/** Estados de un paso en los que ya no hay nada más que esperar. */
export const DONE_STEP_STATUSES = Object.freeze([
  'success', 'success_with_errors', 'error', 'skipped', 'cancelled',
])

export function isStepDone(status) {
  return DONE_STEP_STATUSES.includes(status)
}

/** Un mensaje que habla de error, en cualquiera de los dos idiomas en que SAP los escribe. */
const suenaAError = (mensaje) => /error|fail/i.test(String(mensaje ?? ''))

/**
 * Decide el estado siguiente de un paso que está corriendo, a partir de lo que contestó SAP.
 *
 * Devuelve **un objeto nuevo**: no modifica el que recibe. Quien llama lo guarda donde corresponda.
 *
 * `now` se pasa en vez de leer el reloj para que la espera entre reintentos se pueda probar sin
 * esperarla de verdad.
 */
export function nextStepState(estado, sapStatus, config = {}, now = Date.now()) {
  const codigo = String(sapStatus?.statusCode ?? '').trim().toUpperCase()
  const mensaje = sapStatus?.statusMsg ?? ''
  const tieneFin = Boolean(sapStatus?.endTime)

  const detalle = mensaje ? ` - ${mensaje}` : ''
  const terminado = (extra) => ({ ...estado, finishedAt: new Date(now).toISOString(), ...extra })

  if (CODIGOS_CORRECTOS.has(codigo)) {
    return terminado({
      status: codigo === 'SUCCESS' ? 'success' : 'success_with_errors',
      sapStatusCode: codigo,
      error: null,
    })
  }

  if (ALIAS_DE_CORRECTO.has(codigo)) {
    return terminado({ status: 'success', sapStatusCode: codigo, error: null })
  }

  if (CODIGOS_FALLIDOS.has(codigo)) {
    const intentosPermitidos = Number(config.maxRetries ?? 0)
    const yaIntentados = Number(estado.retryCount ?? 0)

    if (config.errorStrategy === 'retry' && yaIntentados < intentosPermitidos) {
      const espera = Number(config.retryDelaySeconds ?? 30)
      return {
        ...estado,
        // Vuelve a "pendiente" y se relanza cuando pase la espera. El identificador de la ejecución
        // anterior se suelta: el reintento es una ejecución nueva en SAP, no la misma otra vez.
        status: 'pending',
        sapRunId: null,
        sapStatusCode: null,
        retryCount: yaIntentados + 1,
        retryAt: new Date(now + espera * 1000).toISOString(),
        error: `SAP: ${codigo}${detalle} (intento ${yaIntentados + 1} de ${intentosPermitidos})`,
      }
    }

    return terminado({ status: 'error', sapStatusCode: codigo, error: `SAP: ${codigo}${detalle}` })
  }

  if (CODIGOS_EN_MARCHA.has(codigo)) return estado

  /**
   * Red de seguridad: hay tenants que devuelven códigos que no están en ninguna lista.
   *
   * Si SAP puso hora de fin, la ejecución terminó aunque no sepamos con qué nombre. Se mira el
   * mensaje para decidir si fue bien o mal. Sin hora de fin no se supone nada: se sigue esperando,
   * que es lo prudente cuando el que sigue es un paso que va a escribir en SAP.
   */
  if (tieneFin) {
    const fallo = suenaAError(mensaje)
    return terminado({
      status: fallo ? 'error' : 'success',
      sapStatusCode: codigo || 'SOLO_HORA_DE_FIN',
      error: fallo ? `SAP: ${codigo || 'DESCONOCIDO'}${detalle}` : null,
    })
  }

  return estado
}

/**
 * ¿Le toca relanzarse a un paso que quedó esperando entre reintentos?
 *
 * Se pregunta aparte porque el motor lo consulta en cada tick, sin haber hablado con SAP.
 */
export function isRetryDue(estado, now = Date.now()) {
  if (estado?.status !== 'pending' || !estado.retryAt) return false
  const cuando = Date.parse(estado.retryAt)
  return Number.isFinite(cuando) && cuando <= now
}
