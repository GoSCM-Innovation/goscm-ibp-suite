// El proceso de CI-DS al que pertenece una integración, y los choques con su orden de ejecución.
//
// Es lo que sale de cruzar dos fuentes que por separado no lo dicen: el explorador deduce de los
// datos qué integración alimenta a cuál, y el ATL dice en qué orden las corre CI-DS. Cuando se
// contradicen, hay un problema de verdad en la orquestación.

import { MOTIVO_DEL_CONFLICTO, conflictosDe } from '../../../lib/atl-enrich.js'
import { NOMBRE_DE_VIA } from '../../../lib/integration-view.js'
import { Seccion } from './IntegrationDetail.jsx'

export default function AtlSection({ idx, atl, integraciones }) {
  const propia = atl.orquestacion.get(idx)
  if (!propia) {
    return (
      <div className="notice notice-info">
        Ningún proceso de los ATL cargados ejecuta esta integración.
      </div>
    )
  }

  const proceso = atl.procesos[propia.procesoIdx]
  const choques = conflictosDe(atl.conflictos, idx)

  return (
    <>
      {choques.length > 0 && (
        <div className="notice notice-error exp-conflictos">
          <div className="exp-conflicto-titulo">
            ⚠ {choques.length === 1 ? 'Un choque' : `${choques.length} choques`} entre los datos y el orden de ejecución
          </div>
          {choques.map((uno, i) => {
            const esOrigen = uno.from === idx
            const otra = integraciones[esOrigen ? uno.to : uno.from]
            return (
              <div className="exp-conflicto" key={`${uno.from}-${uno.to}-${i}`}>
                {esOrigen ? 'Alimenta a' : 'La alimenta'} <b>{otra?.dataflowName || otra?.jobName}</b>
                {' '}por {NOMBRE_DE_VIA[uno.via]}, y {MOTIVO_DEL_CONFLICTO[uno.reason]}.
              </div>
            )
          })}
        </div>
      )}

      <Seccion titulo="🧩 Proceso de CI-DS" cantidad={proceso.declarados}>
        <div className="exp-atl-datos">
          <div><span className="exp-k">Proceso</span> <b>{propia.session}</b></div>
          <div>
            <span className="exp-k">Grupo</span> {propia.grupo || '—'}
            <span className={`tag ${propia.parallel ? 'tag-accent' : 'tag-muted'}`}>
              {propia.parallel ? 'en paralelo' : 'secuencial'}
            </span>
          </div>
          <div><span className="exp-k">Orden</span> {propia.orden} de {proceso.declarados}</div>
          {proceso.description && <div><span className="exp-k">Descripción</span> {proceso.description}</div>}
        </div>

        {proceso.faltantes.length > 0 && (
          <div className="exp-sub">
            El proceso llama a {proceso.faltantes.length}
            {proceso.faltantes.length === 1 ? ' dataflow que no está' : ' dataflows que no están'} en los ZIP
            cargados: {proceso.faltantes.map((uno) => uno.displayName).join(', ')}.
          </div>
        )}

        {proceso.variables.length > 0 && (
          <>
            <div className="exp-k">Variables del proceso</div>
            {proceso.variables.map((uno) => (
              <div className="exp-var" key={uno.name}>
                <span className="exp-var-name">{uno.name}</span>
                <span className="exp-var-value">
                  {uno.type}{uno.default ? ` = ${uno.default}` : ''}
                </span>
              </div>
            ))}
          </>
        )}
      </Seccion>
    </>
  )
}
