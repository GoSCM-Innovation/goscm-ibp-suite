// Un grupo dibujado en el lienzo: una caja que contiene otros pasos.
//
// Portado de `canvas/GroupNode.jsx` de v9. Los hijos corren según las conexiones que tengan ENTRE
// ELLOS: sin conexiones arrancan todos a la vez, encadenados van en fila. El grupo termina cuando
// terminan todos, y queda fallado si alguno falló.

import { Handle, Position } from '@xyflow/react'

const COLOR_DEL_GRUPO = {
  pending: 'var(--text3)',
  running: 'var(--cyan)',
  success: 'var(--green)',
  success_with_errors: 'var(--accent)',
  error: 'var(--red)',
  skipped: 'var(--text3)',
  cancelled: 'var(--text3)',
}

export default function GroupNode({ data, selected }) {
  const ejecucion = data.runStep
  const color = ejecucion ? COLOR_DEL_GRUPO[ejecucion.status] ?? 'var(--text3)' : null

  return (
    <div
      className={`nodo-grupo${selected ? ' seleccionado' : ''}`}
      style={color ? { borderColor: color } : undefined}
    >
      <Handle type="target" position={Position.Top} />
      <div className="nodo-grupo-titulo" style={color ? { color } : undefined}>
        {data.label || 'Grupo'}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
