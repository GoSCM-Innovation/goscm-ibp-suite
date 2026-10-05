// Qué trabajo de IBP ejecuta esta tarea, y en qué paso.
//
// Cierra el círculo: el ZIP dice qué hace la integración, el ATL en qué orden corre dentro de su
// proceso, y esto en qué momento del día la dispara IBP.
//
// Como en v9, la sección se pinta SIEMPRE que haya un tenant de IBP elegido, también sin
// coincidencias (con (0) y el aviso «Esta task no se encontró…»). Los textos y las columnas son los
// suyos: «Job», «Step», «Pos.», «Tipo».

import { claveDeTarea } from '../../../lib/ibp.js'
import { Seccion } from './IntegrationDetail.jsx'

export default function IbpJobsSection({ jobName, indice }) {
  const usos = indice[claveDeTarea(jobName)] ?? []

  // Cuando la misma tarea aparece en dos pasos del MISMO trabajo suele ser un paso copiado al que no
  // le cambiaron la tarea. v9 no lo avisaba; aquí se conserva el aviso porque ahorra una búsqueda.
  const porTrabajo = new Map()
  for (const uso of usos) porTrabajo.set(uso.template, [...(porTrabajo.get(uso.template) ?? []), uso])
  const repetidos = [...porTrabajo.values()].filter((unos) => unos.length > 1)

  return (
    <Seccion titulo="🔌 SAP IBP · Jobs y Steps" cantidad={usos.length} abiertaPorOmision>
      {usos.length === 0
        ? <p className="exp-empty">Esta task no se encontró en ningún job de SAP IBP.</p>
        : (
          <>
            {repetidos.length > 0 && (
              <div className="notice notice-info">
                {repetidos[0][0].jobName} la ejecuta {repetidos[0].length} veces, en los pasos
                {' '}{repetidos[0].map((uno) => uno.stepPos).join(', ')}. Suele ser un paso copiado al
                que no le cambiaron la tarea.
              </div>
            )}
            <div className="table-scroll">
              <table className="table-dense">
                <thead>
                  <tr><th>Job</th><th>Step</th><th style={{ width: 48 }}>Pos.</th><th>Tipo</th></tr>
                </thead>
                <tbody>
                  {usos.map((uno, i) => (
                    <tr key={`${uno.template}-${uno.stepPos}-${i}`}>
                      <td>{uno.jobName || '—'}</td>
                      <td>{uno.stepName || '—'}</td>
                      <td>{String(uno.stepPos ?? '')}</td>
                      <td>{uno.stepType || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
    </Seccion>
  )
}
