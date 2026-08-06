// Un paso dibujado en el lienzo.
//
// Muestra lo que hay que saber de un vistazo sin abrir la configuración: qué tarea corre, si tiene
// reintentos, y qué pasa si falla. Portado de `canvas/TaskNode.jsx` de v9.
//
// Mientras hay una ejecución en curso, el borde dice cómo va ese paso. Es la misma información que
// el monitor, pero puesta encima del dibujo: en una orquestación de quince pasos, ver cuál está
// corriendo sobre el grafo vale más que una lista al lado.

import { Handle, Position } from '@xyflow/react'
import { statusMeta } from '../../../../core/cids/task-status.js'

/** Cómo se pinta cada estado de un paso durante una ejecución. */
const COLOR_DEL_PASO = {
  pending: 'var(--text3)',
  running: 'var(--cyan)',
  success: 'var(--green)',
  success_with_errors: 'var(--accent)',
  error: 'var(--red)',
  skipped: 'var(--text3)',
  cancelled: 'var(--text3)',
}

const TEXTO_DEL_PASO = {
  pending: 'En espera',
  running: 'Corriendo',
  success: 'Correcta',
  success_with_errors: 'Correcta con errores',
  error: 'Fallada',
  skipped: 'Salteada',
  cancelled: 'Cancelada',
}

/** Qué se hace si el paso falla, en palabras. */
const QUE_SI_FALLA = {
  stop: 'para',
  continue: 'sigue',
  retry: 'reintenta',
}

export default function TaskNode({ data, selected }) {
  const ejecucion = data.runStep
  const color = ejecucion ? COLOR_DEL_PASO[ejecucion.status] ?? 'var(--text3)' : null

  return (
    <div
      className={`nodo-tarea${selected ? ' seleccionado' : ''}`}
      style={color ? { borderColor: color, boxShadow: `0 0 0 1px ${color}` } : undefined}
    >
      <Handle type="target" position={Position.Top} />

      <div className="nodo-tarea-nombre" title={data.taskName ?? ''}>
        {data.label || data.taskName || 'Sin tarea'}
      </div>

      <div className="nodo-tarea-pie">
        {/* Sin tarea elegida el paso no se puede ejecutar, así que se dice acá y no al guardar. */}
        {!data.taskName && <span className="nodo-aviso">Falta elegir la tarea</span>}

        {data.taskName && (
          <>
            <span title="Qué hace si falla">Si falla, {QUE_SI_FALLA[data.errorStrategy] ?? 'para'}</span>
            {data.errorStrategy === 'retry' && data.maxRetries > 0 && (
              <span title="Cuántas veces reintenta y cuánto espera">
                ×{data.maxRetries} · {data.retryDelaySeconds}s
              </span>
            )}
            {data.agentName && <span title="Agente fijado">🖥 {data.agentName}</span>}
          </>
        )}
      </div>

      {ejecucion && (
        <div className="nodo-estado" style={{ color }}>
          {TEXTO_DEL_PASO[ejecucion.status] ?? ejecucion.status}
          {ejecucion.sapStatusCode && ` · ${statusMeta(ejecucion.sapStatusCode).label}`}
          {ejecucion.retryCount > 0 && ` · intento ${ejecucion.retryCount + 1}`}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
