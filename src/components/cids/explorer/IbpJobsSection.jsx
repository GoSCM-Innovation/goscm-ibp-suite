// Qué trabajo de IBP ejecuta esta tarea, y en qué paso.
//
// Cierra el círculo: el ZIP dice qué hace la integración, el ATL en qué orden corre dentro de su
// proceso, y esto en qué momento del día la dispara IBP.
//
// Cuando la misma tarea aparece en dos pasos del MISMO trabajo suele ser un paso copiado al que no
// le cambiaron la tarea, y por eso se muestran todos en vez de quedarse con el primero.

import { claveDeTarea } from '../../../lib/ibp.js'
import { Seccion } from './IntegrationDetail.jsx'

export default function IbpJobsSection({ jobName, indice }) {
  const usos = indice[claveDeTarea(jobName)] ?? []

  if (usos.length === 0) {
    return (
      <div className="notice notice-info">
        Ningún Application Job del tenant ejecuta esta tarea. Puede que se dispare desde otro lado, o
        que todavía no esté programada.
      </div>
    )
  }

  // Dos pasos del mismo trabajo con la misma tarea casi siempre es un descuido al copiar el paso.
  const porTrabajo = new Map()
  for (const uso of usos) porTrabajo.set(uso.template, [...(porTrabajo.get(uso.template) ?? []), uso])
  const repetidos = [...porTrabajo.values()].filter((unos) => unos.length > 1)

  return (
    <>
      {repetidos.length > 0 && (
        <div className="notice notice-info">
          {repetidos[0][0].jobName} la ejecuta {repetidos[0].length} veces, en los pasos
          {' '}{repetidos[0].map((uno) => uno.stepPos).join(', ')}. Suele ser un paso copiado al que
          no le cambiaron la tarea.
        </div>
      )}

      <Seccion titulo="⚙️ Trabajos de IBP" cantidad={usos.length}>
        <div className="table-scroll">
          <table className="table-dense">
            <thead>
              <tr><th>Trabajo</th><th>Paso</th><th>Nº</th><th>Tipo</th></tr>
            </thead>
            <tbody>
              {usos.map((uno, i) => (
                <tr key={`${uno.template}-${uno.stepPos}-${i}`}>
                  <td>{uno.jobName}</td>
                  <td>{uno.stepName || <span className="exp-muted">—</span>}</td>
                  <td>{uno.stepPos}</td>
                  <td className="exp-sub">{uno.stepType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Seccion>
    </>
  )
}
