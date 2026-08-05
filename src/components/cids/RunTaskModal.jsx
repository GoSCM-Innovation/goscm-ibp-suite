// Ejecutar una tarea de CI-DS: elegir agente, configuración del sistema y variables.
//
// Portado del diálogo de v9. Las tres consultas de arranque —qué variables tiene la tarea, qué
// agentes hay activos y qué configuraciones del sistema existen— salen en paralelo, como allí:
// son independientes entre sí y esperarlas en fila triplicaría la espera.
//
// Se descarta el bloque de depuración de SOAP que v9 tenía aquí: era andamiaje de desarrollo que
// mandaba una consulta extra en cada apertura.

import { useEffect, useState } from 'react'
import { cidsCall } from '../../lib/cids.js'
import Modal from '../ui/Modal.jsx'

/** SAP prefija el estado de un agente con "AGENT:". Se quita solo para mostrarlo, como en v9. */
const estadoAgente = (valor) => String(valor || '').replace(/^AGENT:/, '')

export default function RunTaskModal({ connectionId, task, onClose, onLanzada }) {
  const [paso, setPaso] = useState('cargando')
  const [variables, setVariables] = useState([])
  const [agentes, setAgentes] = useState([])
  const [configuraciones, setConfiguraciones] = useState([])
  const [agente, setAgente] = useState('')
  const [configuracion, setConfiguracion] = useState('')
  const [valores, setValores] = useState({})
  const [runId, setRunId] = useState(null)
  const [error, setError] = useState('')
  const [intento, setIntento] = useState(0)

  // El paso inicial ya es "cargando" y quien reintenta lo vuelve a poner, así que el efecto no
  // toca el estado antes de pedir: hacerlo encadena repintados.
  useEffect(() => {
    let abandonado = false

    Promise.all([
      cidsCall(connectionId, 'getTaskInfo', { taskGuid: task.taskGuid }),
      cidsCall(connectionId, 'getAgents', { activeOnly: true }),
      cidsCall(connectionId, 'getSystemConfigurations'),
    ])
      .then(([info, grupos, configs]) => {
        if (abandonado) return
        const declaradas = info?.globalVariables ?? []
        setVariables(declaradas)
        // Los agentes vienen agrupados y el desplegable los quiere sueltos.
        setAgentes((Array.isArray(grupos) ? grupos : []).flatMap((grupo) => grupo.agents ?? []))
        setConfiguraciones(Array.isArray(configs) ? configs : [])
        setValores(Object.fromEntries(declaradas.map((v) => [v.name, v.defaultValue || ''])))
        setPaso('formulario')
      })
      .catch((fallo) => {
        if (abandonado) return
        setError(fallo.message)
        setPaso('error')
      })

    return () => { abandonado = true }
  }, [connectionId, task.taskGuid, intento])

  async function ejecutar() {
    setPaso('enviando')
    try {
      // Una variable que quedó vacía NO se manda: mandarla en blanco pisaría el valor por
      // omisión que la tarea tiene configurado en CI-DS. Es lo que hacía v9.
      const globalVariables = Object.entries(valores)
        .filter(([, valor]) => valor !== '')
        .map(([name, value]) => ({ name, value }))

      const respuesta = await cidsCall(connectionId, 'runTask', {
        taskName: task.taskName,
        ...(agente ? { agentName: agente } : {}),
        ...(configuracion ? { profileName: configuracion } : {}),
        globalVariables,
      })
      setRunId(respuesta?.runId ?? null)
      setPaso('listo')
    } catch (fallo) {
      setError(fallo.message)
      setPaso('error')
    }
  }

  return (
    <Modal title="Ejecutar tarea" subtitle={task.taskName} onClose={onClose} footer={pie()}>
      {paso === 'cargando' && <div className="page-hint">Cargando la configuración de la tarea…</div>}
      {paso === 'enviando' && <div className="page-hint">Enviando la solicitud a CI-DS…</div>}

      {paso === 'error' && <div className="notice notice-error">✕ {error}</div>}

      {paso === 'listo' && (
        <>
          <div className="notice notice-ok">✓ La tarea se envió a CI-DS.</div>
          <p style={{ marginTop: 12 }}>
            RunID <span className="mono">{runId ?? '—'}</span>
          </p>
        </>
      )}

      {paso === 'formulario' && (
        <div className="form-stack">
          <div className="field">
            <label htmlFor="agente">Agente (opcional)</label>
            <select id="agente" className="select" value={agente} onChange={(e) => setAgente(e.target.value)}>
              <option value="">— Que lo decida CI-DS —</option>
              {agentes.map((uno) => (
                <option key={uno.guid ?? uno.name} value={uno.name}>
                  {uno.name}{uno.agentStatus ? ` (${estadoAgente(uno.agentStatus)})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="configuracion">Configuración del sistema (opcional)</label>
            <select
              id="configuracion"
              className="select"
              value={configuracion}
              onChange={(e) => setConfiguracion(e.target.value)}
            >
              <option value="">— Que lo decida CI-DS —</option>
              {configuraciones.map((una) => (
                <option key={una.guid ?? una.name} value={una.name}>{una.name}</option>
              ))}
            </select>
          </div>

          {variables.length > 0 && (
            <div className="field">
              <label>Variables globales</label>
              <div className="form-stack">
                {variables.map((variable) => (
                  <div key={variable.name} className="var-row">
                    <label className="var-name" htmlFor={`var-${variable.name}`}>
                      {variable.name}
                      {variable.description && <span className="var-desc"> — {variable.description}</span>}
                    </label>
                    <input
                      id={`var-${variable.name}`}
                      type="text"
                      className="input mono"
                      value={valores[variable.name] ?? ''}
                      placeholder={variable.defaultValue || variable.dataType || ''}
                      onChange={(e) => setValores((previos) => ({ ...previos, [variable.name]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )

  function pie() {
    if (paso === 'formulario') {
      return (
        <>
          <div className="modal-foot-info" />
          <button type="button" className="btn btn-sm" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-sm btn-primary" onClick={ejecutar}>▶ Ejecutar</button>
        </>
      )
    }
    if (paso === 'listo') {
      return (
        <>
          <div className="modal-foot-info" />
          <button type="button" className="btn btn-sm" onClick={onClose}>Cerrar</button>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => onLanzada(task.taskName)}>
            Verla en el monitor →
          </button>
        </>
      )
    }
    if (paso === 'error') {
      return (
        <>
          <div className="modal-foot-info" />
          <button type="button" className="btn btn-sm" onClick={onClose}>Cerrar</button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => { setPaso('cargando'); setError(''); setIntento((n) => n + 1) }}
          >
            Reintentar
          </button>
        </>
      )
    }
    return null
  }
}
