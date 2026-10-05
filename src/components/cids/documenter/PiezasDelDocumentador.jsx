// Las piezas pequeñas de la pantalla del documentador, con la forma de `mapping-dataflow.html` de v9:
// el avance por pasos, la ayuda «?», el log de procesamiento y el panel de resultado.

import { useEffect, useRef } from 'react'

import { PASOS_DEL_MODO } from '../../../lib/documentador-pasos.js'

/**
 * El avance por pasos: un círculo numerado por paso, con ✓ cuando se completó, unidos por una línea.
 * Es el mismo componente visual del asistente de conexión, que ya tenía esas clases.
 */
export function AvanceDePasos({ modo, actual }) {
  const pasos = PASOS_DEL_MODO[modo] ?? []
  if (pasos.length === 0) return null

  return (
    <div className="conn-wizard-stepper docs-stepper">
      {pasos.map((etiqueta, i) => {
        const hecho = i < actual
        const activo = i === actual
        return (
          <div key={etiqueta} className="docs-stepper-item">
            <div className={`stepper-step${hecho ? ' completed' : activo ? ' active' : ''}`}>
              <div className="step-circle">{hecho ? '✓' : i + 1}</div>
              <div className="step-label">{etiqueta}</div>
            </div>
            {i < pasos.length - 1 && <div className={`stepper-connector${hecho ? ' completed' : ''}`} />}
          </div>
        )
      })}
    </div>
  )
}

/**
 * El «?» con su cuadro de ayuda, que sale al pasar el ratón o al enfocarlo (`zip-help-icon` de v9).
 * Con `imagen` lleva además una captura.
 */
export function AyudaConCuadro({ imagen = '', alt = '', children }) {
  return (
    <span className="docs-ayuda" tabIndex={0}>
      ?
      <span className="docs-ayuda-cuadro">
        {imagen && <img src={imagen} alt={alt} />}
        <p>{children}</p>
      </span>
    </span>
  )
}

/** El log de procesamiento: una línea por paso, con el color de su tipo, siempre al fondo. */
export function LogDeProcesamiento({ lineas }) {
  const caja = useRef(null)

  // Como `docsLog` de v9: la última línea siempre a la vista.
  useEffect(() => {
    if (caja.current) caja.current.scrollTop = caja.current.scrollHeight
  }, [lineas])

  return (
    <div className="card exp-upload">
      <div className="card-title">📋 Log de procesamiento</div>
      {lineas.length > 0 && (
        <div className="docs-log" ref={caja}>
          {lineas.map((una, i) => <div key={i} className={`docs-log-${una.tipo}`}>{una.texto}</div>)}
        </div>
      )}
      {lineas.length === 0 && <p className="exp-empty">Sube un ZIP para comenzar</p>}
    </div>
  )
}

/** El panel «📊 Resultado»: tres contadores y el botón que baja el Excel ya armado. */
export function PanelDeResultado({ resultado, onDescargar }) {
  return (
    <div className="card exp-upload">
      <div className="card-title">📊 Resultado</div>
      <div className="docs-stats">
        <div className="docs-stat"><span className="docs-stat-num es-azul">{resultado.integraciones}</span><span>Integraciones</span></div>
        <div className="docs-stat"><span className="docs-stat-num es-morado">{resultado.mapeos}</span><span>Mapeos</span></div>
        <div className="docs-stat"><span className="docs-stat-num es-verde">{resultado.filtros}</span><span>Filtros</span></div>
      </div>
      <div className="exp-upload-actions">
        <button type="button" className="btn btn-primary docs-descargar" onClick={onDescargar}>⬇️ Descargar Excel</button>
      </div>
    </div>
  )
}
