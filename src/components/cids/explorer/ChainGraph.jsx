// El proyecto entero como un grafo: qué integración alimenta a cuál.
//
// Es la vista que contesta "¿en qué orden hay que correr esto?" sin abrir una por una. Se dibuja de
// izquierda a derecha por niveles de dependencia, y cada flecha lleva el color de la vía por la que
// están unidas: tabla, archivo o lookup.
//
// Se carga aparte porque usa `@xyflow/react`, igual que el diagrama del dataflow.

import { useMemo } from 'react'
import { Background, Controls, Handle, MarkerType, Position, ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { layoutChainGraph } from '../../../lib/chain-layout.js'
import { COLOR_DE_TIPO, COLOR_DE_VIA, NOMBRE_DE_VIA } from '../../../lib/integration-view.js'

/** Una integración en el grafo. Los conectores van escondidos; sin ellos no hay flechas. */
function NodoDeIntegracion({ data }) {
  return (
    <div className="exp-graph-node" style={{ borderLeftColor: data.color }}>
      <Handle type="target" position={Position.Left} className="exp-handle" />
      <div className="exp-graph-node-title">{data.titulo}</div>
      <div className="exp-graph-node-sub">{data.destino}</div>
      <Handle type="source" position={Position.Right} className="exp-handle" />
    </div>
  )
}

const nodeTypes = { integracion: NodoDeIntegracion }

/** El trazo de cada vía. La tabla va llena porque es la unión más fiable. */
const TRAZO_DE_VIA = { table: undefined, file: '6 4', lookup: '2 3 8 3' }

export default function ChainGraph({ integraciones, cadenas, onElegir }) {
  const { nodes, edges } = useMemo(() => {
    const visibles = new Set(integraciones.map((una) => una._idx))
    const propias = cadenas.filter((una) => visibles.has(una.from) && visibles.has(una.to))
    const posiciones = layoutChainGraph(integraciones.map((una) => una._idx), propias)

    return {
      nodes: integraciones.map((una) => ({
        id: String(una._idx),
        type: 'integracion',
        position: posiciones.get(una._idx),
        draggable: false,
        data: {
          titulo: una.dataflowName || una.jobName,
          destino: una.targetTable,
          color: COLOR_DE_TIPO[una.tipoIntegracion] || 'var(--text3)',
        },
      })),
      edges: propias.map((una, i) => ({
        id: `c-${i}`,
        source: String(una.from),
        target: String(una.to),
        label: una.label,
        style: { stroke: COLOR_DE_VIA[una.via], strokeDasharray: TRAZO_DE_VIA[una.via] },
        markerEnd: { type: MarkerType.ArrowClosed, color: COLOR_DE_VIA[una.via] },
        labelStyle: { fill: 'var(--text2)', fontSize: 10 },
      })),
    }
  }, [integraciones, cadenas])

  if (integraciones.length === 0) return <p className="exp-empty">No hay nada que dibujar.</p>

  return (
    <div className="exp-graph">
      <div className="exp-graph-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, nodo) => onElegir(Number(nodo.id))}
        >
          <Background gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <div className="exp-legend">
        <div className="exp-legend-title">Cómo se unen</div>
        {Object.entries(NOMBRE_DE_VIA).map(([via, nombre]) => (
          <div className="exp-legend-item" key={via}>
            <span className="exp-legend-line" style={{ background: COLOR_DE_VIA[via] }} />
            {nombre}
          </div>
        ))}
        <div className="exp-legend-title">Tipo</div>
        {Object.entries(COLOR_DE_TIPO).map(([tipo, color]) => (
          <div className="exp-legend-item" key={tipo}>
            <span className="exp-type" style={{ background: color }}>{tipo}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
