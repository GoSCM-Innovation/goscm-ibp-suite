// Cómo se ve un Application Job desde el motor de orquestaciones.
//
// El motor es de CI-DS de nacimiento: `step-outcome.js` entiende códigos como `SUCCESS`, `ERROR` o
// `RUNNING`, y decide con ellos si un paso terminó, si hay que reintentarlo y si lo que viene detrás
// puede arrancar. Un trabajo de IBP habla otro idioma —letras: `F`, `A`, `C`— así que se traduce
// aquí, y el motor no se entera de que hay dos SAP distintos por debajo.
//
// Traducir en vez de duplicar el motor: las reglas de reintento, de dependencias y de grupos son las
// mismas, y tenerlas dos veces significa arreglar un fallo en una copia y no en la otra. Es la misma
// decisión que ya se tomó con los gráficos de los tableros. Lo que en IBP se decide distinto que en
// CI-DS (qué hace un paso cancelado, si se avisa a SAP al cortar…) va en la política del adaptador
// de IBP, en `core/orchestrations/adapters.js`.
//
// Sin dependencias que hablen con SAP: solo traduce.

import { isJobQueued, isJobRunning, jobStatusMeta } from './job-status.js'

/**
 * Una ejecución de IBP se identifica con DOS datos y el motor guarda uno.
 *
 * `JobName` es el identificador técnico y `JobRunCount` distingue las repeticiones de un trabajo
 * periódico; hacen falta los dos para volver a encontrarla. Se juntan con una barra vertical, que no
 * aparece en ninguno de los dos —`JobName` es hexadecimal y `JobRunCount` un número—.
 */
export const SEPARADOR_DE_EJECUCION = '|'

export const identificadorDeEjecucion = (jobName, jobRunCount) =>
  `${jobName}${SEPARADOR_DE_EJECUCION}${jobRunCount ?? ''}`

/**
 * Lo contrario. Devuelve `null` si no tiene esa forma, para no consultar a SAP con datos rotos.
 *
 * La repetición SÍ puede faltar (`J|`): `JobSchedule` no siempre la devuelve. Sin ella se pregunta
 * solo por el nombre, como hacía v8, y el motor la completa en cuanto SAP la cuenta. Rechazarla
 * dejaba el paso «En ejecución» para siempre: cada consulta fallaba y el motor esperaba a la
 * siguiente.
 */
export function partirIdentificador(identificador) {
  const partes = String(identificador ?? '').split(SEPARADOR_DE_EJECUCION)
  if (partes.length !== 2 || !partes[0]) return null
  return { jobName: partes[0], jobRunCount: partes[1] }
}

/**
 * El código con que el motor marca un paso CANCELADO en SAP. No es de CI-DS: solo lo entiende el
 * motor cuando la política del adaptador de IBP se lo pide (`cancelledCodes`).
 */
export const CODIGO_CANCELADO = 'CANCELLED'

/** Las letras que el orquestador de v8 daba por terminadas, y cómo las clasificaba. */
const BIEN = new Set(['F'])
const CON_AVISOS = new Set(['W'])
const FALLADOS = new Set(['A', 'U', 'K'])
const CANCELADOS = new Set(['C', 'D'])

/**
 * El estado de un trabajo en el idioma que entiende el motor.
 *
 * Es la clasificación de `useOrchRun.js` de v8, letra por letra:
 *
 *   - `F` terminó bien y `W` terminó con avisos: los dos dejan seguir.
 *   - `A`, `U` y `K` son fallos (`K`, «saltado», también: v8 lo daba por terminado y lo contaba
 *     como error).
 *   - `C` y `D` son CANCELADOS, no fallos: el paso queda «Cancelado» y la cadena SIGUE. Es lo que
 *     hacía v8, que solo paraba ante un error.
 *   - Lo demás no es final y se sigue preguntando. Incluye `X` (desconocido) y `k` (por saltar), que
 *     v8 no daba por terminados, y `c` (cancelándose).
 *   - Una ejecución que SAP TODAVÍA NO REGISTRÓ cuenta como EN COLA. El motor trata «desconocido»
 *     como FALLO, así que devolverlo aquí marcaría fallado un trabajo sano en la primera vuelta,
 *     antes de que SAP alcance a anotarlo. v8 seguía preguntando en ese caso, y esto es lo mismo.
 *
 * Además de lo que el motor entiende, devuelve la letra tal cual (`codigoSap`): la pantalla de v8 la
 * enseñaba junto al trabajo, «Job: … [F]», y el motor la guarda en el paso.
 *
 * Un código que v8 no conocía y esta tabla tampoco se pasa como `UNKNOWN`, y el motor lo da por
 * fallado con la letra en el mensaje. Es la única desviación: v8 se quedaba preguntando para
 * siempre, y un paso colgado sin explicación es peor que uno que dice qué letra no entendió.
 */
export function estadoParaElMotor(run) {
  if (!run) return { statusCode: 'QUEUEING', statusMsg: 'SAP todavía no la registró', endTime: null }

  const codigo = run.JobStatus
  const meta = jobStatusMeta(codigo)
  const fin = run.JobEndDateTime || null
  const comun = { statusMsg: meta.label, ...(codigo ? { codigoSap: codigo } : {}) }

  if (BIEN.has(codigo)) return { ...comun, statusCode: 'SUCCESS', endTime: fin }
  if (CON_AVISOS.has(codigo)) return { ...comun, statusCode: 'SUCCESS_WITH_ERRORS_D', endTime: fin }
  if (FALLADOS.has(codigo)) return { ...comun, statusCode: 'ERROR', endTime: fin }
  if (CANCELADOS.has(codigo)) return { ...comun, statusCode: CODIGO_CANCELADO, endTime: fin }

  if (isJobQueued(codigo)) return { ...comun, statusCode: 'QUEUEING', endTime: null }
  if (isJobRunning(codigo) || codigo === 'X' || codigo === 'k') {
    return { ...comun, statusCode: 'RUNNING', endTime: null }
  }

  return { ...comun, statusCode: 'UNKNOWN', endTime: fin }
}
