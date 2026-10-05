// El modo «ZIP + Jobs» del documentador, tal como lo hace v9 (`generateZipJobs`).
//
// No se elige ningún trabajo ni se sube ningún ATL. Se leen los ZIP y, para TODO el tenant de IBP, qué
// trabajo y qué paso ejecuta cada tarea (por su `P_TSKID`, el identificador técnico de la tarea de
// CI-DS). Cada integración se empareja con el paso que ejecuta su tarea y recibe el trabajo, el paso y
// el tipo de paso; la columna «Grupo» queda vacía, porque no hay ATL.
//
// El índice es el mismo del explorador (`/api/ibp/jobs?indice=true`): tres consultas para todo el
// tenant. Una tarea puede aparecer en varios pasos; v9 se quedaba con el PRIMERO que encontraba, y aquí
// es el de menor posición.

import { claveDeTarea } from './ibp.js'

/**
 * Pone el trabajo y el paso de IBP a cada integración. Devuelve también cuántas emparejó y las líneas
 * del log, con los textos de v9.
 */
export function emparejarConJobs(entradas, indice) {
  const registro = []
  let emparejadas = 0
  let sinEmparejar = 0

  const resultado = entradas.map((entrada) => {
    const usos = indice?.[claveDeTarea(entrada.parsed.jobName)] ?? []
    const golpe = usos[0]

    if (!golpe) {
      sinEmparejar += 1
      registro.push({ tipo: 'aviso', texto: `  ⚠ "${entrada.parsed.jobName}" sin match en IBP` })
      return entrada
    }

    emparejadas += 1
    registro.push({
      tipo: 'ok',
      texto: `  📌 "${entrada.parsed.jobName}" → Job: "${golpe.jobName}" (pos ${golpe.stepPos})`,
    })

    return {
      ...entrada,
      paramRow: {
        ...entrada.paramRow,
        ibpJobName: golpe.jobName,
        ibpStepName: golpe.stepName,
        ibpStepType: golpe.stepType,
      },
    }
  })

  registro.push({
    tipo: emparejadas > 0 ? 'ok' : 'aviso',
    texto: `✔ Match: ${emparejadas} encontrados · ${sinEmparejar} sin match`,
  })

  return { entradas: resultado, emparejadas, sinEmparejar, registro }
}
