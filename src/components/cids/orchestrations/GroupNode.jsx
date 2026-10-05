// Un grupo dibujado en el lienzo: una caja punteada que contiene otros pasos.
//
// Idéntico al `canvas/GroupNode.jsx` de v9. Los hijos corren según las conexiones que tengan ENTRE
// ELLOS: sin conexiones arrancan todos a la vez, encadenados van en fila, y un poco de cada es un
// híbrido. La insignia de la cabecera lo dice. El grupo termina cuando terminan todos sus hijos, y
// queda fallado si alguno falló.
//
// Se agranda arrastrando sus esquinas cuando está seleccionado (mínimo 260×140); el tamaño se guarda.

import { Handle, NodeResizer, Position } from '@xyflow/react'
import {
  GROUP_MODE_STYLES,
  TAMANIO_MINIMO_DE_GRUPO,
  conAlfa,
  nodeStatusColor,
  nodeStatusIcon,
} from '../../../lib/orchestration-canvas.js'
import './lienzo.css'

export default function GroupNode({ data, selected }) {
  const estado = data.runStatus || 'pending'
  const activo = estado === 'running'
  const color = nodeStatusColor(estado)

  const modo = GROUP_MODE_STYLES[data.groupMode] ?? GROUP_MODE_STYLES.parallel
  const colorBorde = selected ? 'var(--accent)' : activo ? color : conAlfa(modo.color, 0.4)

  return (
    <div
      className="orq-grupo"
      style={{
        background: conAlfa(modo.color, activo ? 0.08 : 0.04),
        border: `1.5px dashed ${colorBorde}`,
      }}
    >
      <NodeResizer
        minWidth={TAMANIO_MINIMO_DE_GRUPO.width}
        minHeight={TAMANIO_MINIMO_DE_GRUPO.height}
        isVisible={Boolean(selected) && !data.bloqueado}
        lineStyle={{ border: '1px dashed var(--accent)' }}
        handleStyle={{ background: 'var(--accent)', width: 8, height: 8, borderRadius: 2 }}
      />

      <div
        className="orq-grupo-cabeza"
        style={{ borderBottom: `1px solid ${conAlfa(modo.color, selected ? 0.3 : 0.15)}` }}
      >
        <span className="orq-nodo-icono" style={{ color }}>{activo ? '◉' : '⊞'}</span>
        <span className="orq-grupo-nombre" style={{ color: modo.color }}>{data.label || 'Grupo'}</span>
        <span
          className="orq-grupo-insignia"
          style={{
            background: conAlfa(modo.color, 0.133),
            border: `1px solid ${conAlfa(modo.color, 0.267)}`,
            color: modo.color,
            marginRight: 4,
          }}
        >
          {modo.label}
        </span>
        <span
          className="orq-grupo-insignia"
          style={{
            background: conAlfa(color, 0.133),
            border: `1px solid ${conAlfa(color, 0.267)}`,
            color,
          }}
        >
          {nodeStatusIcon(estado)}
        </span>
      </div>

      {data.childSummary && <div className="orq-grupo-resumen">{data.childSummary}</div>}

      <Handle type="target" position={Position.Left} className="orq-handle-entrada" style={{ top: '50%' }} />
      <Handle type="source" position={Position.Right} className="orq-handle-grupo" style={{ top: '50%' }} />
    </div>
  )
}
