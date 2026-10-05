// El proyecto entero como un grafo: qué integración alimenta a cuál.
//
// Es la vista que contesta "¿en qué orden hay que correr esto?" sin abrir una por una. Se dibuja de
// izquierda a derecha por niveles de dependencia, y cada flecha lleva el color y el trazo de la vía
// por la que están unidas: tabla (verde, llena), archivo (naranja, guiones) o lookup (violeta,
// punto-raya).
//
// Las cajas, los rótulos, los tooltips y la leyenda son los de v9 (`renderGraph`): relleno del color
// del tipo con texto negro, rótulo partido en dos líneas si pasa de 30 caracteres, y la leyenda
// «Conexiones / Nodos» abajo a la derecha.
//
// Se carga aparte porque usa `@xyflow/react`, igual que el diagrama del dataflow.

import { useMemo } from 'react'
import { Background, Controls, Handle, MarkerType, Position, ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { layoutChainGraph } from '../../../lib/chain-layout.js'
import {
  RELLENO_DE_TIPO, RELLENO_POR_OMISION, cortarEtiquetaDeCadena, etiquetaDelNodoDeCadena, tooltipDeLaIntegracion,
} from '../../../lib/dataflow-style.js'
import { COLOR_DE_VIA } from '../../../lib/integration-view.js'

/** Una integración en el grafo. Los conectores van escondidos; sin ellos no hay flechas. */
function NodoDeIntegracion({ data }) {
  return (
    <div
      className="exp-graph-node"
      style={{ background: data.color, borderColor: data.color }}
      title={data.tooltip}
    >
      <Handle type="target" position={Position.Left} className="exp-handle" />
      {data.etiqueta}
      <Handle type="source" position={Position.Right} className="exp-handle" />
    </div>
  )
}

const nodeTypes = { integracion: NodoDeIntegracion }

/** El trazo de cada vía y su grosor, tal cual v9. La tabla va llena porque es la unión más fiable. */
const ESTILO_DE_VIA = {
  table: { trazo: undefined, grosor: 2 },
  file: { trazo: '6 4', grosor: 1.5 },
  lookup: { trazo: '2 3 8 3', grosor: 1.5 },
}

/** Una muestra de la leyenda: la flecha con el trazo real de su vía. */
function MuestraDeVia({ via }) {
  const { trazo, grosor } = ESTILO_DE_VIA[via]
  const color = COLOR_DE_VIA[via]
  return (
    <svg width="32" height="10" aria-hidden="true">
      <line x1="0" y1="5" x2="26" y2="5" stroke={color} strokeWidth={grosor + 0.5} strokeDasharray={trazo} />
      <polygon points="20,1 26,5 20,9" fill={color} />
    </svg>
  )
}

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
          etiqueta: etiquetaDelNodoDeCadena(una.dataflowName || una.jobName),
          tooltip: tooltipDeLaIntegracion(una),
          color: RELLENO_DE_TIPO[una.tipoIntegracion] || RELLENO_POR_OMISION,
        },
      })),
      edges: propias.map((una, i) => {
        const { trazo, grosor } = ESTILO_DE_VIA[una.via] ?? ESTILO_DE_VIA.table
        return {
          id: `c-${i}`,
          source: String(una.from),
          target: String(una.to),
          // El rótulo largo se corta a 24 y el completo va en el `title` con el tipo de vía.
          label: una.label
            ? <span title={`Tipo: ${una.via}\nVía: ${una.label}`}>{cortarEtiquetaDeCadena(una.label)}</span>
            : '',
          style: { stroke: COLOR_DE_VIA[una.via], strokeDasharray: trazo, strokeWidth: grosor },
          markerEnd: { type: MarkerType.ArrowClosed, color: COLOR_DE_VIA[una.via] },
          labelStyle: { fill: '#9db4d0', fontSize: 10 },
        }
      }),
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
        <div className="exp-legend-title">Leyenda</div>
        <div className="exp-legend-seccion">Conexiones</div>
        <div className="exp-legend-item"><MuestraDeVia via="table" /> Tabla (DB)</div>
        <div className="exp-legend-item"><MuestraDeVia via="file" /> Archivo</div>
        <div className="exp-legend-item"><MuestraDeVia via="lookup" /> Lookup</div>
        <div className="exp-legend-sep" />
        <div className="exp-legend-seccion">Nodos</div>
        <div className="exp-legend-item">
          <span className="exp-legend-nodo" style={{ background: RELLENO_DE_TIPO.MD, color: '#000' }}>MD</span>
          Master data
        </div>
        <div className="exp-legend-item">
          <span className="exp-legend-nodo" style={{ background: RELLENO_DE_TIPO.KF, color: '#000' }}>KF</span>
          Key figure
        </div>
        <div className="exp-legend-item">
          <span className="exp-legend-nodo" style={{ background: RELLENO_DE_TIPO.FILE, color: '#fff' }}>FILE</span>
          Archivo
        </div>
      </div>
    </div>
  )
}
