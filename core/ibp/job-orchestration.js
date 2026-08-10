// Cómo se ve un Application Job desde el motor de orquestaciones.
//
// El motor es de CI-DS de nacimiento: `step-outcome.js` entiende códigos como `SUCCESS`, `ERROR` o
// `RUNNING`, y decide con ellos si un paso terminó, si hay que reintentarlo y si lo que viene detrás
// puede arrancar. Un trabajo de IBP habla otro idioma —letras: `F`, `A`, `C`— así que se traduce
// aquí, y el motor no se entera de que hay dos SAP distintos por debajo.
//
// Traducir en vez de duplicar el motor: las reglas de reintento, de dependencias y de grupos son las
// mismas, y tenerlas dos veces significa arreglar un fallo en una copia y no en la otra. Es la misma
// decisión que ya se tomó con los gráficos de los tableros.
//
// Sin dependencias que hablen con SAP: solo traduce.

import { isJobFailed, isJobFinished, isJobQueued, isJobRunning, jobStatusMeta } from './job-status.js'

/**
 * Una ejecución de IBP se identifica con DOS datos y el motor guarda uno.
 *
 * `JobName` es el identificador técnico y `JobRunCount` distingue las repeticiones de un trabajo
 * periódico; hacen falta los dos para volver a encontrarla. Se juntan con una barra vertical, que no
 * aparece en ninguno de los dos —`JobName` es hexadecimal y `JobRunCount` un número—.
 */
export const SEPARADOR_DE_EJECUCION = '|'

export const identificadorDeEjecucion = (jobName, jobRunCount) =>
  `${jobName}${SEPARADOR_DE_EJECUCION}${jobRunCount}`

/** Lo contrario. Devuelve `null` si no tiene esa forma, para no consultar a SAP con datos rotos. */
export function partirIdentificador(identificador) {
  const partes = String(identificador ?? '').split(SEPARADOR_DE_EJECUCION)
  if (partes.length !== 2 || !partes[0] || !partes[1]) return null
  return { jobName: partes[0], jobRunCount: partes[1] }
}

/**
 * El estado de un trabajo en el idioma que entiende el motor.
 *
 * Las tres decisiones que importan:
 *
 *   - «Terminado con avisos» (`W`) cuenta como CORRECTO, igual que en CI-DS: el trabajo hizo lo suyo
 *     y dejó el dato, así que lo que viene detrás puede seguir. Tratarlo como fallo pararía cadenas
 *     enteras por un aviso.
 *   - Un trabajo CANCELADO es un FALLO para el motor, aunque el monitor lo pinte como un final más.
 *     No hizo su trabajo, así que dar por bueno lo que venía detrás sería mentir. Es exactamente el
 *     mismo criterio que el motor ya aplica a `TERMINATED` de CI-DS.
 *   - Una ejecución que SAP TODAVÍA NO REGISTRÓ cuenta como EN COLA, no como desconocida. Esto no es
 *     un matiz: el motor trata «desconocido» como FALLO —a propósito, para no colgarse esperando algo
 *     de lo que SAP no sabe nada—, así que devolverlo aquí marcaría fallado un trabajo sano en la
 *     primera vuelta, antes de que SAP alcance a anotarlo. El orquestador de v8 seguía preguntando
 *     en ese caso, y esto es lo mismo.
 *
 * Contrapartida asumida, igual que en v8: si la ejecución no aparece NUNCA —porque alguien la borró—
 * el paso se queda esperando. Es preferible a romper cadenas sanas, que pasaría siempre.
 */
export function estadoParaElMotor(run) {
  if (!run) return { statusCode: 'QUEUEING', statusMsg: 'SAP todavía no la registró', endTime: null }

  const codigo = run.JobStatus
  const meta = jobStatusMeta(codigo)
  const fin = run.JobEndDateTime || null

  if (isJobFinished(codigo)) {
    // `F` es limpio; `W` terminó con avisos, y el motor tiene un estado propio para eso.
    return { statusCode: codigo === 'W' ? 'SUCCESS_WITH_ERRORS_D' : 'SUCCESS', statusMsg: meta.label, endTime: fin }
  }

  if (isJobFailed(codigo)) return { statusCode: 'ERROR', statusMsg: meta.label, endTime: fin }
  if (isJobRunning(codigo)) return { statusCode: 'RUNNING', statusMsg: meta.label, endTime: null }
  if (isJobQueued(codigo)) return { statusCode: 'QUEUEING', statusMsg: meta.label, endTime: null }

  // Un código que no está en ninguna lista. Se pasa tal cual con la hora de fin: el motor tiene una
  // red de seguridad que decide por ahí, y suponer aquí escondería el caso raro en vez de mostrarlo.
  return { statusCode: 'UNKNOWN', statusMsg: meta.label, endTime: fin }
}
