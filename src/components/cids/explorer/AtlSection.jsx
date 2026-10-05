// El proceso de CI-DS al que pertenece una integración, y los choques con su orden de ejecución.
//
// Es lo que sale de cruzar dos fuentes que por separado no lo dicen: el explorador deduce de los
// datos qué integración alimenta a cuál, y el ATL dice en qué orden las corre CI-DS. Cuando se
// contradicen, hay un problema de verdad en la orquestación.
//
// Los textos y el orden son los de v9 (`ex.atl.*`), y como allí, si la integración no está en
// ningún ATL no se pinta NADA.

import { conflictosDe } from '../../../lib/atl-enrich.js'
import { Seccion } from './IntegrationDetail.jsx'

/** Por qué choca, con las palabras de v9. */
const MOTIVO = {
  parallel: 'el ATL los ejecuta en paralelo, pero hay dependencia de datos entre ellos',
  reverse: 'el ATL lo ejecuta antes que su origen de datos',
}

export default function AtlSection({ idx, atl, integraciones }) {
  const propia = atl.orquestacion.get(idx)
  if (!propia) return null

  const proceso = atl.procesos[propia.procesoIdx]
  const choques = conflictosDe(atl.conflictos, idx)
  const variables = proceso.variables ?? []

  return (
    <Seccion titulo="🧩 Proceso CI-DS (ATL)" cantidad={proceso.declarados} abiertaPorOmision>
      <div className="exp-atl-datos">
        <div><span className="exp-k">Proceso:</span> <b>{propia.session}</b></div>
        {propia.grupo && (
          <div>
            <span className="exp-k">Grupo:</span> {propia.grupo}
            {' '}
            <span className={`exp-atl-par ${propia.parallel ? 'es-paralelo' : 'es-secuencial'}`}>
              {propia.parallel ? '∥ Paralelo' : '→ Secuencial'}
            </span>
          </div>
        )}
        <div><span className="exp-k">Orden:</span> {propia.orden || '—'}</div>
      </div>

      {choques.length > 0 && (
        <div className="exp-atl-conflictos">
          <div className="exp-atl-conflictos-titulo">⚠ Conflictos de orden con el ATL</div>
          {choques.map((uno, i) => {
            const esOrigen = uno.from === idx
            const otra = integraciones[esOrigen ? uno.to : uno.from]
            return (
              <div className="exp-atl-conflicto" key={`${uno.from}-${uno.to}-${i}`}>
                {esOrigen ? 'Alimenta a' : 'Alimentado por'} <b>{otra?.dataflowName || otra?.jobName}</b>
                {' · '}{uno.via} — {MOTIVO[uno.reason]}
              </div>
            )
          })}
        </div>
      )}

      <div className="exp-atl-vars-titulo">
        Variables del proceso <span className="exp-muted">({variables.length})</span>
      </div>
      {variables.length > 0
        ? variables.map((uno) => (
          <div className="exp-var" key={uno.name}>
            <span className="exp-var-name">{uno.name}</span>
            <span className="exp-var-value">{uno.type}{uno.default ? ` = ${uno.default}` : ''}</span>
          </div>
        ))
        : <p className="exp-empty">Sin variables</p>}
    </Seccion>
  )
}
