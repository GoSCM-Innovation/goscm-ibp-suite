// La configuración del paso elegido: qué corre, con qué, y qué pasa si falla.
//
// Portado de `canvas/NodeConfigPanel.jsx` de v9. Los topes son los mismos que hace cumplir
// `core/orchestrations/graph.js` al guardar; aquí están para que el campo no deje escribir algo que
// después el servidor va a recortar en silencio.

import { useEffect, useState } from 'react'
import {
  ERROR_STRATEGIES,
  MAX_RETRIES_LIMIT,
  MAX_RETRY_DELAY_SECONDS,
} from '../../../../core/orchestrations/graph.js'
import { cidsCall } from '../../../lib/cids.js'

const QUE_SI_FALLA = [
  { value: 'stop', label: 'Parar la orquestación', ayuda: 'Lo que venga detrás no se ejecuta.' },
  { value: 'continue', label: 'Seguir igual', ayuda: 'El fallo se da por asumido y la cadena continúa.' },
  { value: 'retry', label: 'Reintentar', ayuda: 'Se vuelve a lanzar; si se agotan los intentos, para.' },
]

export default function NodeConfigPanel({ destino, nodo, onCambiar, onBorrar }) {
  const datos = nodo.data ?? {}

  // El tipo se deduce de lo que el paso guarda y no de una marca aparte: un paso que lanza una
  // plantilla de trabajo es de IBP, y uno que nombra una tarea es de CI-DS. Sin marca no hay forma
  // de que se contradiga con lo que el paso realmente hace.
  const esDeIbp = Boolean(datos.templateName)
  const [agentes, setAgentes] = useState([])
  const [configuraciones, setConfiguraciones] = useState([])

  // Los agentes y las configuraciones del tenant se piden una vez por destino, no por paso. Un paso
  // de IBP no los usa, y pedírselos a CI-DS contra un tenant de IBP es un viaje que va a fallar.
  useEffect(() => {
    if (esDeIbp) return undefined
    let abandonado = false
    Promise.all([
      cidsCall(destino, 'getAgents', { activeOnly: true }),
      cidsCall(destino, 'getSystemConfigurations'),
    ])
      .then(([grupos, configs]) => {
        if (abandonado) return
        setAgentes((Array.isArray(grupos) ? grupos : []).flatMap((grupo) => grupo.agents ?? []))
        setConfiguraciones(Array.isArray(configs) ? configs : [])
      })
      // Que no lleguen no impide configurar el paso: los dos campos son opcionales.
      .catch(() => {})
    return () => { abandonado = true }
  }, [destino, esDeIbp])

  const cambiar = (campo, valor) => onCambiar({ ...datos, [campo]: valor })

  function cambiarVariable(indice, campo, valor) {
    const variables = [...(datos.globalVariables ?? [])]
    variables[indice] = { ...variables[indice], [campo]: valor }
    cambiar('globalVariables', variables)
  }

  return (
    <div className="config-panel">
      <div className="config-cabeza">
        <span className="filtro-titulo">Paso</span>
        <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={onBorrar} title="Quitar del lienzo">
          Quitar
        </button>
      </div>

      <div className="config-cuerpo">
        <div className="field">
          <label htmlFor="cfg-etiqueta">Nombre en el dibujo</label>
          <input
            id="cfg-etiqueta"
            className="input"
            value={datos.label ?? ''}
            placeholder={datos.taskName ?? 'Sin nombre'}
            onChange={(evento) => cambiar('label', evento.target.value)}
          />
        </div>

        {/* Un paso de IBP lanza una plantilla de trabajo; uno de CI-DS, una tarea. Lo demás del
            panel —qué hacer si falla, cuántos reintentos— vale igual para los dos. */}
        <div className="field">
          <label>{esDeIbp ? 'Plantilla de trabajo' : 'Tarea de CI-DS'}</label>
          <div className="config-tarea mono">
            {(esDeIbp ? datos.templateName : datos.taskName) ?? '— sin elegir —'}
          </div>
          <span className="card-hint">
            Se elige desde la lista al agregar el paso. Para cambiarla, quita este paso y agrega el
            correcto.
          </span>
        </div>

        {!esDeIbp && (
        <div className="field">
          <label htmlFor="cfg-agente">Agente (opcional)</label>
          <select
            id="cfg-agente"
            className="select"
            value={datos.agentName ?? ''}
            onChange={(evento) => cambiar('agentName', evento.target.value || null)}
          >
            <option value="">— Que lo decida CI-DS —</option>
            {agentes.map((uno) => (
              <option key={uno.guid ?? uno.name} value={uno.name}>{uno.name}</option>
            ))}
          </select>
        </div>
        )}

        {!esDeIbp && (

        <div className="field">
          <label htmlFor="cfg-config">Configuración del sistema (opcional)</label>
          <select
            id="cfg-config"
            className="select"
            value={datos.profileName ?? ''}
            onChange={(evento) => cambiar('profileName', evento.target.value || null)}
          >
            <option value="">— Que lo decida CI-DS —</option>
            {configuraciones.map((una) => (
              <option key={una.guid ?? una.name} value={una.name}>{una.name}</option>
            ))}
          </select>
        </div>
        )}

        <div className="field">
          <label htmlFor="cfg-falla">Si este paso falla</label>
          <select
            id="cfg-falla"
            className="select"
            value={datos.errorStrategy ?? 'stop'}
            onChange={(evento) => cambiar('errorStrategy', evento.target.value)}
          >
            {QUE_SI_FALLA.filter((una) => ERROR_STRATEGIES.includes(una.value)).map((una) => (
              <option key={una.value} value={una.value}>{una.label}</option>
            ))}
          </select>
          <span className="card-hint">
            {QUE_SI_FALLA.find((una) => una.value === (datos.errorStrategy ?? 'stop'))?.ayuda}
          </span>
        </div>

        {datos.errorStrategy === 'retry' && (
          <div className="config-fila">
            <div className="field">
              <label htmlFor="cfg-intentos">Intentos</label>
              <input
                id="cfg-intentos"
                className="input"
                type="number"
                min="0"
                max={MAX_RETRIES_LIMIT}
                value={datos.maxRetries ?? 0}
                onChange={(evento) => cambiar('maxRetries', Number(evento.target.value))}
              />
            </div>
            <div className="field">
              <label htmlFor="cfg-espera">Espera (segundos)</label>
              <input
                id="cfg-espera"
                className="input"
                type="number"
                min="0"
                max={MAX_RETRY_DELAY_SECONDS}
                value={datos.retryDelaySeconds ?? 30}
                onChange={(evento) => cambiar('retryDelaySeconds', Number(evento.target.value))}
              />
            </div>
          </div>
        )}

        {/* Las variables globales son de CI-DS. Un Application Job corre con los parámetros que
            tiene configurados en IBP, y dejarlos cambiar aquí duplicaría esa configuración. */}
        {!esDeIbp && (
        <div className="field">
          <label>Variables globales</label>
          <span className="card-hint">
            Solo las que quieras fijar para este paso. Las que dejes vacías conservan el valor que la
            tarea tenga configurado en CI-DS.
          </span>

          <div className="form-stack" style={{ marginTop: 8 }}>
            {/* La clave es la posición: dos variables pueden llamarse igual mientras se escriben, así
                que el nombre no sirve para identificarlas. */}
            {(datos.globalVariables ?? []).map((variable, indice) => (
              <div className="config-variable" key={indice}>
                <input
                  className="input input-sm mono"
                  placeholder="NOMBRE"
                  value={variable.name ?? ''}
                  onChange={(evento) => cambiarVariable(indice, 'name', evento.target.value)}
                  aria-label="Nombre de la variable"
                />
                <input
                  className="input input-sm mono"
                  placeholder="valor"
                  value={variable.value ?? ''}
                  onChange={(evento) => cambiarVariable(indice, 'value', evento.target.value)}
                  aria-label="Valor de la variable"
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-danger"
                  onClick={() => cambiar('globalVariables', (datos.globalVariables ?? []).filter((_, i) => i !== indice))}
                  title="Quitar la variable"
                >
                  ×
                </button>
              </div>
            ))}

            <button
              type="button"
              className="btn btn-sm"
              onClick={() => cambiar('globalVariables', [...(datos.globalVariables ?? []), { name: '', value: '' }])}
            >
              + Agregar variable
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  )
}
