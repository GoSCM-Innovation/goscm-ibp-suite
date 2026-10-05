// Un paso dibujado en el lienzo.
//
// Idéntico al `canvas/TaskNode.jsx` de v9: 210 de ancho, una franja de color a la izquierda según el
// tipo de tarea, una barra de 3 px con el color del estado, la cabecera con el icono del estado y el
// nombre, y debajo el agente, la configuración, las variables y qué hace si falla. Las entradas van a
// la izquierda y las salidas a la derecha.
//
// Mientras hay una ejecución en curso, el borde dice cómo va ese paso: en una orquestación de quince
// pasos, ver cuál está corriendo sobre el grafo vale más que una lista al lado.
//
// Lo que se agrega a v9 y se conserva: el texto del estado («Corriendo», «Correcta»…) con el intento en
// que va, y el aviso «Falta elegir la tarea» cuando el paso no dice qué lanzar.

import { useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { statusMeta } from '../../../../core/cids/task-status.js'
import {
  STRATEGY_COLOR,
  STRATEGY_LABEL,
  colorDeTipo,
  conAlfa,
  nodeStatusColor,
  nodeStatusIcon,
} from '../../../lib/orchestration-canvas.js'
import PromotedBadge from '../PromotedBadge.jsx'
import './lienzo.css'

const TEXTO_DEL_PASO = {
  pending: 'En espera',
  running: 'Corriendo',
  success: 'Correcta',
  success_with_errors: 'Correcta con errores',
  error: 'Fallada',
  skipped: 'Salteada',
  cancelled: 'Cancelada',
}

export default function TaskNode({ data, selected, id }) {
  const [encima, setEncima] = useState(false)

  const ejecucion = data.runStep
  const estado = data.runStatus || 'pending'
  const activo = estado === 'running'
  const color = nodeStatusColor(estado)
  const colorEstrategia = STRATEGY_COLOR[data.errorStrategy] ?? STRATEGY_COLOR.stop
  const variables = (data.globalVariables ?? []).filter((variable) => variable.name)
  const queLanza = data.taskName || data.templateName

  const clases = ['orq-nodo']
  if (selected) clases.push('seleccionado')
  if (activo) clases.push('activo')

  return (
    <div
      className={clases.join(' ')}
      onMouseEnter={() => setEncima(true)}
      onMouseLeave={() => setEncima(false)}
    >
      {/* Franja del tipo de tarea, a la izquierda. */}
      <div className="orq-nodo-tipo" style={{ background: colorDeTipo(data.taskType) }} />

      {/* Barra del estado. */}
      <div className="orq-nodo-estado" style={{ background: color }} />

      <div className="orq-nodo-cabeza">
        <span className="orq-nodo-icono" style={{ color }}>{nodeStatusIcon(estado)}</span>
        <span className="orq-nodo-nombre" title={queLanza ?? ''}>
          {data.label || queLanza || 'Sin tarea'}
        </span>
        {data.promoted && <PromotedBadge />}
        {encima && data.onRunSingle && (
          <button
            type="button"
            className="orq-nodo-ejecutar nodrag"
            onClick={(evento) => { evento.stopPropagation(); data.onRunSingle(id) }}
            title="Ejecutar solo este task"
          >
            ▶
          </button>
        )}
      </div>

      <div className="orq-nodo-detalle">
        {/* Sin tarea elegida el paso no se puede ejecutar, así que se dice aquí y no al guardar. */}
        {!queLanza && <span className="orq-nodo-aviso">Falta elegir la tarea</span>}

        {(data.agentName || data.profileName) && (
          <div className="orq-nodo-mono">
            {data.agentName && <span>agent: {data.agentName}</span>}
            {data.profileName && <span>profile: {data.profileName}</span>}
          </div>
        )}

        {variables.length > 0 && <div className="orq-nodo-mono">vars: {variables.length}</div>}

        <div className="orq-nodo-pie">
          <span
            className="orq-nodo-etiqueta"
            style={{
              background: conAlfa(colorEstrategia, 0.133),
              border: `1px solid ${conAlfa(colorEstrategia, 0.267)}`,
              color: colorEstrategia,
            }}
          >
            {STRATEGY_LABEL[data.errorStrategy] ?? STRATEGY_LABEL.stop}
            {data.errorStrategy === 'retry' && data.maxRetries ? ` ×${data.maxRetries}` : ''}
          </span>
          {data.sapRunId && (
            <span className="orq-nodo-sap">#{String(data.sapRunId).slice(-6)}</span>
          )}
        </div>

        {ejecucion && (
          <div className="orq-nodo-texto-estado" style={{ color }}>
            {TEXTO_DEL_PASO[ejecucion.status] ?? ejecucion.status}
            {ejecucion.sapStatusCode && ` · ${statusMeta(ejecucion.sapStatusCode).label}`}
            {ejecucion.retryCount > 0 && ` · intento ${ejecucion.retryCount + 1}`}
          </div>
        )}
      </div>

      <Handle type="target" position={Position.Left} className="orq-handle-entrada" />
      <Handle type="source" position={Position.Right} className="orq-handle-salida" />
    </div>
  )
}
