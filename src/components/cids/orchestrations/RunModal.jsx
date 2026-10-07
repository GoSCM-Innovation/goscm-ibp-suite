// El diálogo de «Iniciar orquestación»: agente, configuración de sistema y variables globales.
//
// Portado de `RunModal.jsx` de v9. Los textos, el orden de los campos y los presets de «Ejecución
// rápida» son los suyos.
//
// Diferencias con v9, todas por lo mismo:
//   - Habla con SAP a través de `cidsCall` (la sesión y las credenciales viven en el servidor), no
//     con `soapCall` desde el navegador.
//   - El botón «raw» de cada campo, que mostraba la respuesta cruda de SAP, no se porta: era
//     andamiaje de depuración (mismo criterio que `RunTaskModal`).
//   - Las consultas de variables salen en tandas y no todas de golpe (`consultarEnTandas`).
//
// El dibujo que se manda mirar (`grafo`) se toma UNA vez, al abrir: las variables que se ofrecen son
// las de las tareas que había entonces, y no cambian mientras el diálogo está abierto.

import { useEffect, useState } from 'react'

import { cidsCall } from '../../../lib/cids.js'
import {
  aplanarAgentes,
  armarValoresGenerales,
  consultarEnTandas,
  crearPreset,
  filasDeVariables,
  guardarPresets,
  guidsDelGrafo,
  leerPresets,
  sufijoDeAgente,
  valoresDePreset,
  variablesDeTareas,
} from '../../../lib/orchestration-run-form.js'
import Modal from '../../ui/Modal.jsx'
import SelectorDeLista from '../../ui/SelectorDeLista.jsx'
import './ejecucion.css'

/** La clave de cada fila de variables: el índice no sirve, porque quitar una del medio movería el foco. */
let ultimaClave = 0
const nuevaClave = () => { ultimaClave += 1; return ultimaClave }

/** «N encontrado(s)», que es como v9 cuenta lo que trajo SAP. */
const cuenta = (n) => `${n} encontrado${n === 1 ? '' : 's'}`

/** Cabecera de un campo con cuántas opciones trajo SAP. */
function Campo({ etiqueta, id, total, children }) {
  return (
    <div className="ej-campo">
      <div className="ej-campo-cab">
        <label htmlFor={id}>{etiqueta}</label>
        <span className={`ej-campo-cuenta${total === 0 ? ' vacio' : ''}`}>{cuenta(total)}</span>
      </div>
      {children}
    </div>
  )
}

export default function RunModal({ destino, grafo, onConfirmar, onClose }) {
  const [cargando, setCargando] = useState(Boolean(destino))
  const [errorDeCarga, setErrorDeCarga] = useState('')
  const [agentes, setAgentes] = useState([])
  const [configuraciones, setConfiguraciones] = useState([])

  // Sin destino no hay a quién preguntar: se escribe a mano, que es lo que v9 hace cuando falla.
  const [manual, setManual] = useState(!destino)
  const [agenteElegido, setAgenteElegido] = useState('')
  const [configuracionElegida, setConfiguracionElegida] = useState('')
  const [agenteManual, setAgenteManual] = useState('')
  const [configuracionManual, setConfiguracionManual] = useState('')

  const [presets, setPresets] = useState(() => leerPresets(destino?.id))

  const [guids] = useState(() => guidsDelGrafo(grafo))
  const [estadoVariables, setEstadoVariables] = useState(destino && guids.length > 0 ? 'loading' : 'idle')
  const [disponibles, setDisponibles] = useState([])
  const [filas, setFilas] = useState([])

  // Agentes y configuraciones, en paralelo: son independientes y esperarlas en fila duplicaría la espera.
  useEffect(() => {
    if (!destino) return undefined
    let abandonado = false

    Promise.all([
      cidsCall(destino, 'getAgents', { activeOnly: false }),
      cidsCall(destino, 'getSystemConfigurations'),
    ])
      .then(([grupos, configs]) => {
        if (abandonado) return
        const sueltos = aplanarAgentes(grupos)
        setAgentes(sueltos)
        setConfiguraciones(Array.isArray(configs) ? configs : [])
        // Sin agentes que elegir un desplegable vacío no sirve de nada: se escribe.
        if (sueltos.length === 0) setManual(true)
      })
      .catch((fallo) => {
        if (abandonado) return
        setErrorDeCarga(fallo.message)
        setManual(true)
      })
      .finally(() => { if (!abandonado) setCargando(false) })

    return () => { abandonado = true }
  }, [destino])

  // Las variables de TODAS las tareas del dibujo, para poder pisarlas desde aquí.
  useEffect(() => {
    if (!destino || guids.length === 0) return undefined
    let abandonado = false

    consultarEnTandas(guids, (taskGuid) => cidsCall(destino, 'getTaskInfo', { taskGuid }))
      .then((resultados) => {
        if (abandonado) return
        // Si SAP no contestó por NINGUNA tarea, eso es un error; si falló alguna, se ofrece lo que hay.
        if (resultados.every((uno) => uno.status === 'rejected')) {
          setEstadoVariables('error')
          return
        }
        const juntas = variablesDeTareas(resultados)
        setDisponibles(juntas)
        setFilas(filasDeVariables(juntas).map((fila) => ({ ...fila, clave: nuevaClave() })))
        setEstadoVariables('loaded')
      })

    return () => { abandonado = true }
  }, [destino, guids])

  const cargandoVariables = estadoVariables === 'loading'

  function cambiarFila(clave, campo, valor) {
    setFilas((previas) => previas.map((fila) => {
      if (fila.clave !== clave) return fila
      const siguiente = { ...fila, [campo]: valor }
      // Cambiar de variable borra el valor: era de otra.
      if (campo === 'name') siguiente.value = ''
      return siguiente
    }))
  }

  const agenteActual = manual ? agenteManual : agenteElegido
  const configuracionActual = manual ? configuracionManual : configuracionElegida

  function valoresActuales() {
    return armarValoresGenerales({
      agentName: agenteActual,
      profileName: configuracionActual,
      globalVariables: filas,
    })
  }

  function guardarComoPreset() {
    const nombre = window.prompt('Nombre del preset:')?.trim()
    if (!nombre) return
    const siguientes = [...presets, crearPreset({
      label: nombre,
      agentName: agenteActual.trim(),
      profileName: configuracionActual.trim(),
      globalVariables: filas,
    })]
    setPresets(siguientes)
    guardarPresets(destino?.id, siguientes)
  }

  function borrarPreset(evento, id) {
    evento.stopPropagation()
    const siguientes = presets.filter((preset) => preset.id !== id)
    setPresets(siguientes)
    guardarPresets(destino?.id, siguientes)
  }

  const encabezadoDeVariables = cargandoVariables
    ? 'Variables globales — cargando…'
    : estadoVariables === 'error'
      ? 'Variables globales — error al cargar'
      : `Variables globales (${disponibles.length} disponibles en sistema)`

  return (
    <Modal
      title="Iniciar orquestación"
      subtitle={<span className="ej-subtitulo">Agente y configuración por defecto para nodos sin valores propios</span>}
      onClose={onClose}
      footer={(
        <>
          <div className="modal-foot-info" />
          <button type="button" className="btn btn-sm" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-sm" onClick={guardarComoPreset} disabled={cargando || !destino}>
            Guardar preset
          </button>
          <button
            type="button"
            className="btn btn-sm btn-run"
            onClick={() => onConfirmar(valoresActuales())}
            disabled={cargando}
          >
            ▶ Iniciar
          </button>
        </>
      )}
    >
      {presets.length > 0 && (
        <div className="ej-campo">
          <div className="ej-campo-cab"><label>Ejecución rápida</label></div>
          <div className="ej-presets">
            {presets.map((preset) => (
              <div key={preset.id} className="ej-preset">
                <button type="button" className="ej-preset-iniciar" onClick={() => onConfirmar(valoresDePreset(preset))}>
                  ▶ {preset.label}
                </button>
                <button
                  type="button"
                  className="ej-preset-borrar"
                  onClick={(evento) => borrarPreset(evento, preset.id)}
                  aria-label={`Borrar el preset ${preset.label}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {cargando && <div className="ej-cargando">Cargando agentes y configuraciones…</div>}

      {!cargando && errorDeCarga && (
        <div className="notice notice-error" style={{ marginBottom: 12 }}>
          Error al cargar desde SAP: {errorDeCarga}
        </div>
      )}

      {!cargando && (
        <>
          {!errorDeCarga && destino && (
            <div className="ej-alternar">
              <button type="button" className="ej-mini" onClick={() => setManual((previo) => !previo)}>
                {manual ? '← Usar dropdown' : 'Escribir manualmente →'}
              </button>
            </div>
          )}

          <Campo etiqueta="Agente" id="ej-agente" total={agentes.length}>
            {manual ? (
              <input
                id="ej-agente"
                className="input"
                value={agenteManual}
                onChange={(evento) => setAgenteManual(evento.target.value)}
                placeholder="Nombre del agente (dejar vacío para default)"
              />
            ) : (
              <SelectorDeLista
                id="ej-agente"
                className="select"
                value={agenteElegido}
                titulo="Agente"
                placeholder="— Sin agente específico —"
                onChange={setAgenteElegido}
                options={[
                  { value: '', label: '— Sin agente específico —' },
                  ...agentes.map((agente) => ({
                    value: agente.name,
                    label: `${agente.name}${sufijoDeAgente(agente)}`,
                  })),
                ]}
              />
            )}
          </Campo>

          <Campo etiqueta="Configuración de sistema" id="ej-configuracion" total={configuraciones.length}>
            {manual ? (
              <input
                id="ej-configuracion"
                className="input"
                value={configuracionManual}
                onChange={(evento) => setConfiguracionManual(evento.target.value)}
                placeholder="Nombre del perfil (dejar vacío para default)"
              />
            ) : (
              <SelectorDeLista
                id="ej-configuracion"
                className="select"
                value={configuracionElegida}
                titulo="Configuración de sistema"
                placeholder="— Sin configuración específica —"
                onChange={setConfiguracionElegida}
                options={[
                  { value: '', label: '— Sin configuración específica —' },
                  ...configuraciones.map((configuracion) => ({
                    value: configuracion.name,
                    label: configuracion.name,
                  })),
                ]}
              />
            )}
          </Campo>

          <div className="ej-campo">
            <div className="ej-campo-cab">
              <label>
                {encabezadoDeVariables}
                {cargandoVariables && <span className="ej-campo-cuenta"> ⏳</span>}
                {estadoVariables === 'error' && <span className="ej-campo-cuenta error"> Error SAP</span>}
              </label>
              <button
                type="button"
                className="ej-mini"
                onClick={() => setFilas((previas) => [...previas, { clave: nuevaClave(), name: '', value: '' }])}
              >
                + Variable
              </button>
            </div>

            {filas.length === 0 && (
              <div className="ej-ayuda cursiva">
                {cargandoVariables
                  ? 'Cargando variables del sistema…'
                  : estadoVariables === 'error'
                    ? 'No se pudieron cargar las variables del sistema.'
                    : 'Sin variables globales — se usarán las de cada task individual.'}
              </div>
            )}

            {filas.map((fila) => (
              <div key={fila.clave} className="ej-variable">
                {cargandoVariables ? (
                  <div className="input ej-variable-cargando">Cargando…</div>
                ) : (
                  <SelectorDeLista
                    className="select"
                    ariaLabel="Variable"
                    value={fila.name}
                    titulo="Variable"
                    placeholder="— Seleccionar —"
                    onChange={(valor) => cambiarFila(fila.clave, 'name', valor)}
                    options={[
                      { value: '', label: '— Seleccionar —' },
                      ...(fila.name && !disponibles.some((una) => una.name === fila.name)
                        ? [{ value: fila.name, label: fila.name }]
                        : []),
                      ...disponibles.map((una) => ({
                        value: una.name,
                        label: `${una.name}${una.description ? ` — ${una.description}` : ''}`,
                      })),
                    ]}
                  />
                )}
                <input
                  className="input"
                  aria-label={`Valor de ${fila.name || 'la variable'}`}
                  value={fila.value}
                  onChange={(evento) => cambiarFila(fila.clave, 'value', evento.target.value)}
                  placeholder="vacío = usar valor del nodo"
                  disabled={cargandoVariables}
                />
                <button
                  type="button"
                  className="ej-variable-quitar"
                  onClick={() => setFilas((previas) => previas.filter((una) => una.clave !== fila.clave))}
                  aria-label="Quitar la variable"
                >
                  ×
                </button>
              </div>
            ))}

            {filas.length > 0 && (
              <div className="ej-ayuda">
                Si escribes un valor, se aplica a TODOS los nodos que usen esa variable (pisa lo del nodo).
                Si lo dejas vacío, cada nodo usa el valor configurado en su panel; si tampoco tiene, SAP usa el default del sistema.
              </div>
            )}
          </div>

          <div className="ej-ayuda">
            Si dejas agente y configuración vacíos, SAP usará los valores por defecto del sistema.
          </div>
        </>
      )}
    </Modal>
  )
}
