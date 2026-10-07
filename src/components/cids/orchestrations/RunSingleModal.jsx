// «Ejecutar task individual»: lanzar UNA tarea del dibujo, sin correr la orquestación entera.
//
// Portado de `RunSingleModal.jsx` de v9. Lo abre el «▶» de un nodo del lienzo.
//
// Habla con SAP por `cidsCall`, igual que `RunTaskModal`, y toma de ahí su precaución con las
// variables: una que quedó con el valor vacío NO se manda, porque en blanco pisaría el valor por
// omisión que la tarea tiene en CI-DS. (v9 mandaba todas las que tuvieran nombre.)
//
// Contrato con quien lo abre: `nodo` trae lo que el nodo tiene guardado
// (`{ id, taskName, taskGuid, agentName, profileName, globalVariables }`).

import { useEffect, useState } from 'react'

import { cidsCall } from '../../../lib/cids.js'
import { aplanarAgentes } from '../../../lib/orchestration-run-form.js'
import Modal from '../../ui/Modal.jsx'
import SelectorDeLista from '../../ui/SelectorDeLista.jsx'
import './ejecucion.css'

export default function RunSingleModal({ destino, nodo, onClose }) {
  const [agentes, setAgentes] = useState([])
  const [configuraciones, setConfiguraciones] = useState([])
  const [cargando, setCargando] = useState(true)
  const [errorDeCarga, setErrorDeCarga] = useState('')
  const [iniciando, setIniciando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState('')
  const [agente, setAgente] = useState(nodo.agentName || '')
  const [perfil, setPerfil] = useState(nodo.profileName || '')

  const variables = (nodo.globalVariables ?? []).filter((variable) => variable.name)

  useEffect(() => {
    let abandonado = false

    Promise.all([
      cidsCall(destino, 'getAgents', { activeOnly: false }),
      cidsCall(destino, 'getSystemConfigurations'),
    ])
      .then(([grupos, configs]) => {
        if (abandonado) return
        setAgentes(aplanarAgentes(grupos))
        setConfiguraciones(Array.isArray(configs) ? configs : [])
      })
      // v9 se tragaba el fallo y dejaba los desplegables vacíos sin decir por qué.
      .catch((fallo) => { if (!abandonado) setErrorDeCarga(fallo.message) })
      .finally(() => { if (!abandonado) setCargando(false) })

    return () => { abandonado = true }
  }, [destino])

  async function ejecutar() {
    setIniciando(true)
    setError('')
    setResultado(null)
    try {
      const respuesta = await cidsCall(destino, 'runTask', {
        taskName: nodo.taskName,
        ...(agente ? { agentName: agente } : {}),
        ...(perfil ? { profileName: perfil } : {}),
        globalVariables: variables
          .filter((variable) => variable.value !== '' && variable.value != null)
          .map((variable) => ({ name: variable.name, value: variable.value })),
      })
      setResultado(respuesta ?? {})
    } catch (fallo) {
      setError(fallo.message)
    } finally {
      setIniciando(false)
    }
  }

  // Lo que el nodo ya tiene tiene que poder verse aunque SAP no lo liste (un agente apagado, o la
  // carga que falló): un desplegable cuyo valor no está entre sus opciones muestra otra cosa.
  const agenteFueraDeLista = agente && !agentes.some((uno) => uno.name === agente)
  const perfilFueraDeLista = perfil && !configuraciones.some((una) => una.name === perfil)

  return (
    <Modal
      title="Ejecutar task individual"
      subtitle={nodo.taskName}
      onClose={onClose}
      footer={(
        <>
          <div className="modal-foot-info" />
          <button type="button" className="btn btn-sm" onClick={onClose}>{resultado ? 'Cerrar' : 'Cancelar'}</button>
          {!resultado && (
            <button type="button" className="btn btn-sm btn-run" onClick={ejecutar} disabled={cargando || iniciando}>
              {iniciando ? 'Iniciando…' : '▶ Ejecutar'}
            </button>
          )}
        </>
      )}
    >
      {cargando ? (
        <div className="ej-cargando">Cargando…</div>
      ) : (
        <>
          {errorDeCarga && (
            <div className="notice notice-error" style={{ marginBottom: 12 }}>
              Error al cargar desde SAP: {errorDeCarga}
            </div>
          )}

          <div className="ej-campo">
            <div className="ej-campo-cab">
              <label htmlFor="ej-single-agente">Agente ({agentes.length} disponibles)</label>
            </div>
            <SelectorDeLista
              id="ej-single-agente"
              className="select"
              value={agente}
              titulo="Agente"
              placeholder="— Default del sistema —"
              onChange={setAgente}
              options={[
                { value: '', label: '— Default del sistema —' },
                ...(agenteFueraDeLista ? [{ value: agente, label: agente }] : []),
                ...agentes.map((uno) => ({ value: uno.name, label: uno.name })),
              ]}
            />
          </div>

          <div className="ej-campo">
            <div className="ej-campo-cab">
              <label htmlFor="ej-single-perfil">Configuración ({configuraciones.length} disponibles)</label>
            </div>
            <SelectorDeLista
              id="ej-single-perfil"
              className="select"
              value={perfil}
              titulo="Configuración"
              placeholder="— Default del sistema —"
              onChange={setPerfil}
              options={[
                { value: '', label: '— Default del sistema —' },
                ...(perfilFueraDeLista ? [{ value: perfil, label: perfil }] : []),
                ...configuraciones.map((una) => ({ value: una.name, label: una.name })),
              ]}
            />
          </div>

          {variables.length > 0 && (
            <div className="ej-variables-nodo mono">
              Variables: {variables.map((variable) => `${variable.name}=${variable.value || '""'}`).join(', ')}
            </div>
          )}

          {resultado && (
            <div className="notice notice-ok">
              Iniciado — RunID: <span className="mono">{resultado.runId}</span>
            </div>
          )}
          {error && <div className="notice notice-error">{error}</div>}
        </>
      )}
    </Modal>
  )
}
