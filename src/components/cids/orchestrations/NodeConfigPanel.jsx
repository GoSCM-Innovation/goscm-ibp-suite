// La configuración del nodo elegido: qué hacer si falla y qué variables globales fijar.
//
// Portado de `canvas/NodeConfigPanel.jsx` de v9, con la misma cabecera («⬡ Task» / «⊞ Grupo», el
// nombre en mono y la ×), los mismos topes en los reintentos (1 a 5 intentos, 5 a 3600 segundos de
// espera) y las variables globales como v9: se piden a SAP las que la tarea declara y cada fila es un
// desplegable «— Seleccionar —» con el valor precargado con el que SAP trae por omisión.
//
// Un GRUPO solo tiene nombre: cómo corren sus hijos lo decide el dibujo (las conexiones entre ellos),
// no un campo.
//
// Desvíos de v9, los dos a propósito:
//   - Los cambios se aplican al momento y el lienzo los autoguarda, así que no hay botón «Guardar
//     cambios»: v9 lo tenía porque guardaba aparte del dibujo.
//   - Se conservan el agente y la configuración del sistema del nodo, que v9 no mostraba pero el
//     motor sí usa; quitarlos sería perder la forma de fijarlos. Van después de las variables.

import { useEffect, useState } from 'react'
import {
  ERROR_STRATEGIES,
  MAX_RETRIES_LIMIT,
  MAX_RETRY_DELAY_SECONDS,
  RETRY_LIMITS,
} from '../../../../core/orchestrations/graph.js'
import { cidsCall } from '../../../lib/cids.js'
import './lienzo.css'

const QUE_SI_FALLA = [
  { value: 'stop', label: 'Detener orquestación', ayuda: 'Lo que venga detrás no se ejecuta.' },
  { value: 'continue', label: 'Continuar al siguiente', ayuda: 'El fallo se da por asumido y la cadena continúa.' },
  { value: 'retry', label: 'Reintentar', ayuda: 'Se vuelve a lanzar; si se agotan los intentos, para.' },
]

/** Los topes de los campos de reintento: los de v9 para CI-DS y los del orquestador de v8 para IBP. */
const TOPES_CIDS = {
  maxRetries: { min: 1, max: MAX_RETRIES_LIMIT },
  retryDelaySeconds: { min: 5, max: MAX_RETRY_DELAY_SECONDS },
}

export default function NodeConfigPanel({ destino, nodo, onCambiar, onBorrar, onCerrar }) {
  const datos = nodo.data ?? {}
  const esGrupo = nodo.type === 'group'

  // El tipo se deduce de lo que el paso guarda y no de una marca aparte: un paso que lanza una
  // plantilla de trabajo es de IBP, y uno que nombra una tarea es de CI-DS. Sin marca no hay forma
  // de que se contradiga con lo que el paso realmente hace.
  const esDeIbp = Boolean(datos.templateName)
  const topes = esDeIbp ? RETRY_LIMITS.ibp : TOPES_CIDS

  const cambiar = (campo, valor) => onCambiar({ ...datos, [campo]: valor })

  /** Al elegir «Reintentar» con cero intentos, sube al mínimo: reintentar cero veces no es reintentar. */
  function cambiarEstrategia(valor) {
    const intentos = Number(datos.maxRetries ?? 0)
    onCambiar({
      ...datos,
      errorStrategy: valor,
      ...(valor === 'retry' && intentos < topes.maxRetries.min ? { maxRetries: topes.maxRetries.min } : {}),
    })
  }

  const estrategia = datos.errorStrategy ?? 'stop'

  return (
    <div className="config-panel">
      <div className="cfg-cabeza">
        <div>
          <div className="cfg-titulo">{esGrupo ? '⊞ Grupo' : '⬡ Task'}</div>
          <div className="cfg-nombre" title={datos.taskName || datos.templateName || datos.label || ''}>
            {datos.taskName || datos.templateName || datos.label}
          </div>
        </div>
        <button type="button" className="cfg-cerrar" onClick={onCerrar} title="Cerrar" aria-label="Cerrar">×</button>
      </div>

      <div className="config-cuerpo">
        <div className="field">
          <label htmlFor="cfg-etiqueta">Nombre visible</label>
          <input
            id="cfg-etiqueta"
            className="input"
            value={datos.label ?? ''}
            placeholder={datos.taskName || datos.templateName || 'Nombre del nodo'}
            onChange={(evento) => cambiar('label', evento.target.value)}
          />
        </div>

        {esGrupo && (
          <div className="cfg-info">
            El orden lo determinan los edges entre sus tasks.<br />
            Sin edges → paralelo · Todos conectados → en secuencia · Mix → híbrido
          </div>
        )}

        {!esGrupo && (
          <>
            <div className="field">
              <label htmlFor="cfg-falla">En caso de error</label>
              <select
                id="cfg-falla"
                className="select"
                value={estrategia}
                onChange={(evento) => cambiarEstrategia(evento.target.value)}
              >
                {QUE_SI_FALLA.filter((una) => ERROR_STRATEGIES.includes(una.value)).map((una) => (
                  <option key={una.value} value={una.value}>{una.label}</option>
                ))}
              </select>
              <span className="card-hint">
                {QUE_SI_FALLA.find((una) => una.value === estrategia)?.ayuda}
              </span>
            </div>

            {estrategia === 'retry' && (
              <div className="config-fila">
                <div className="field">
                  <label htmlFor="cfg-intentos">Máx reintentos</label>
                  <input
                    id="cfg-intentos"
                    className="input"
                    type="number"
                    min={topes.maxRetries.min}
                    max={topes.maxRetries.max}
                    value={datos.maxRetries ?? topes.maxRetries.min}
                    onChange={(evento) => cambiar('maxRetries', Number(evento.target.value))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="cfg-espera">Espera (seg)</label>
                  <input
                    id="cfg-espera"
                    className="input"
                    type="number"
                    min={topes.retryDelaySeconds.min}
                    max={topes.retryDelaySeconds.max}
                    value={datos.retryDelaySeconds ?? 30}
                    onChange={(evento) => cambiar('retryDelaySeconds', Number(evento.target.value))}
                  />
                </div>
              </div>
            )}

            {/* Las variables globales son de CI-DS. Un Application Job corre con los parámetros que
                tiene configurados en IBP, y dejarlos cambiar aquí duplicaría esa configuración. */}
            {!esDeIbp && (
              <>
                <VariablesGlobales destino={destino} datos={datos} onCambiar={cambiar} />
                <AgenteYConfiguracion destino={destino} datos={datos} onCambiar={cambiar} />
              </>
            )}
          </>
        )}

        <button type="button" className="cfg-eliminar" onClick={onBorrar}>Eliminar nodo</button>
      </div>
    </div>
  )
}

/**
 * Las variables globales del paso, como en v9: siempre un desplegable con las que la tarea declara en
 * SAP, nunca texto libre. Se piden con `getTaskInfo`; si el paso no trae el identificador de la tarea,
 * se busca por su nombre exacto.
 */
function VariablesGlobales({ destino, datos, onCambiar }) {
  const { taskGuid, taskName } = datos
  const hayQuePedir = Boolean(taskGuid || taskName)
  const clave = `${destino?.id ?? ''}|${taskGuid ?? ''}|${taskName ?? ''}`

  // El resultado guarda la clave de lo que se pidió. Si ya no es la del paso actual, vale como si no
  // hubiera llegado nada: así «cargando» se deduce y no se escribe desde el efecto.
  const [carga, setCarga] = useState({ clave: null, estado: 'idle', variables: [] })

  useEffect(() => {
    if (!hayQuePedir) return undefined
    let abandonado = false

    async function pedir() {
      let guid = taskGuid
      // Sin identificador, se busca el de la tarea por su nombre exacto.
      if (!guid && taskName) {
        const encontradas = await cidsCall(destino, 'searchTasks', { nameFilter: taskName })
        if (abandonado) return
        const coincidente = Array.isArray(encontradas)
          ? encontradas.find((una) => una.taskName?.trim() === taskName.trim())
          : null
        guid = coincidente?.taskGuid
      }
      if (!guid) {
        setCarga({ clave, estado: 'error', variables: [] })
        return
      }
      const info = await cidsCall(destino, 'getTaskInfo', { taskGuid: guid })
      if (abandonado) return
      setCarga({
        clave,
        estado: 'loaded',
        variables: Array.isArray(info?.globalVariables) ? info.globalVariables : [],
      })
    }

    pedir().catch(() => { if (!abandonado) setCarga({ clave, estado: 'error', variables: [] }) })
    return () => { abandonado = true }
  }, [destino, taskGuid, taskName, clave, hayQuePedir])

  const vigente = carga.clave === clave
  const estado = !hayQuePedir ? 'idle' : vigente ? carga.estado : 'loading'
  const disponibles = vigente ? carga.variables : []
  const filas = datos.globalVariables ?? []

  const encabezado = estado === 'loading'
    ? 'Variables globales — cargando…'
    : estado === 'error'
      ? 'Variables globales — error al cargar'
      : estado === 'loaded'
        ? `Variables globales (${disponibles.length} disponibles)`
        : 'Variables globales'

  function cambiarFila(indice, campo, valor) {
    const variables = filas.map((fila, i) => {
      if (i !== indice) return fila
      const siguiente = { ...fila, [campo]: valor }
      // Al elegir otra variable, el valor se precarga con el que SAP trae por omisión.
      if (campo === 'name') siguiente.value = disponibles.find((una) => una.name === valor)?.defaultValue ?? ''
      return siguiente
    })
    onCambiar('globalVariables', variables)
  }

  return (
    <div>
      <div className="cfg-variables-cabeza">
        <label>{encabezado}</label>
        {estado === 'loading' && <span className="card-hint">⏳</span>}
        {estado === 'error' && <span style={{ color: 'var(--red)', fontSize: 9 }}>Error SAP</span>}
      </div>

      {estado === 'loaded' && disponibles.length === 0 && (
        <div className="cfg-info chico">Este task no tiene variables globales en SAP.</div>
      )}

      {/* La clave es la posición: dos variables pueden llamarse igual mientras se eligen, así que el
          nombre no sirve para identificarlas. */}
      {filas.map((fila, indice) => (
        <div className="cfg-variable" key={indice}>
          {estado === 'loading' ? (
            <div className="cfg-variable-cargando">Cargando variables…</div>
          ) : (
            <select
              className="select"
              value={fila.name ?? ''}
              onChange={(evento) => cambiarFila(indice, 'name', evento.target.value)}
              aria-label="Variable"
            >
              <option value="">— Seleccionar —</option>
              {/* Si el nombre ya estaba puesto y SAP ya no lo declara, se conserva en la lista. */}
              {fila.name && !disponibles.some((una) => una.name === fila.name) && (
                <option value={fila.name}>{fila.name}</option>
              )}
              {disponibles.map((una) => (
                <option key={una.name} value={una.name}>
                  {una.name}{una.description ? ` — ${una.description}` : ''}
                </option>
              ))}
            </select>
          )}
          <input
            className="input"
            value={fila.value ?? ''}
            onChange={(evento) => cambiarFila(indice, 'value', evento.target.value)}
            placeholder={estado === 'loading' ? '…' : (disponibles.find((una) => una.name === fila.name)?.defaultValue || 'valor')}
            disabled={estado === 'loading'}
            aria-label="Valor"
          />
          <button
            type="button"
            className="cfg-quitar-variable"
            onClick={() => onCambiar('globalVariables', filas.filter((_, i) => i !== indice))}
            title="Quitar la variable"
            aria-label="Quitar la variable"
          >
            ×
          </button>
        </div>
      ))}

      {estado === 'loaded' && disponibles.length > 0 && (
        <button
          type="button"
          className="cfg-mas-variable"
          onClick={() => onCambiar('globalVariables', [...filas, { name: '', value: '' }])}
        >
          + Variable
        </button>
      )}

      {estado === 'error' && (
        <div className="card-hint" style={{ marginTop: 2 }}>No se pudieron cargar las variables del sistema.</div>
      )}

      {estado !== 'error' && (
        <span className="card-hint" style={{ display: 'block', marginTop: 6 }}>
          Solo las que quieras fijar para este paso. Las que dejes fuera conservan el valor que la tarea
          tenga configurado en CI-DS.
        </span>
      )}
    </div>
  )
}

/**
 * El agente y la configuración del sistema del paso. Se piden una vez por destino, no por paso;
 * que no lleguen no impide configurar el paso: los dos campos son opcionales.
 */
function AgenteYConfiguracion({ destino, datos, onCambiar }) {
  const [agentes, setAgentes] = useState([])
  const [configuraciones, setConfiguraciones] = useState([])

  useEffect(() => {
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
      .catch(() => {})
    return () => { abandonado = true }
  }, [destino])

  return (
    <>
      <div className="field">
        <label htmlFor="cfg-agente">Agente (opcional)</label>
        <select
          id="cfg-agente"
          className="select"
          value={datos.agentName ?? ''}
          onChange={(evento) => onCambiar('agentName', evento.target.value || null)}
        >
          <option value="">— Que lo decida CI-DS —</option>
          {datos.agentName && !agentes.some((uno) => uno.name === datos.agentName) && (
            <option value={datos.agentName}>{datos.agentName}</option>
          )}
          {agentes.map((uno) => (
            <option key={uno.guid ?? uno.name} value={uno.name}>{uno.name}</option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="cfg-config">Configuración del sistema (opcional)</label>
        <select
          id="cfg-config"
          className="select"
          value={datos.profileName ?? ''}
          onChange={(evento) => onCambiar('profileName', evento.target.value || null)}
        >
          <option value="">— Que lo decida CI-DS —</option>
          {datos.profileName && !configuraciones.some((una) => una.name === datos.profileName) && (
            <option value={datos.profileName}>{datos.profileName}</option>
          )}
          {configuraciones.map((una) => (
            <option key={una.guid ?? una.name} value={una.name}>{una.name}</option>
          ))}
        </select>
      </div>
    </>
  )
}
