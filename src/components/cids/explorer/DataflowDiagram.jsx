// El dataflow dibujado como lo dibuja CI-DS: lectores, transformaciones y escritores.
//
// v9 usaba vis-network, que se cargaba de un CDN. Acá se usa `@xyflow/react`, que ya está en el
// proyecto para el lienzo de orquestaciones: una librería menos y ninguna descarga externa.
//
// Se carga aparte del resto (`lazy`) porque pesa, y a este diagrama se entra solo cuando se abre su
// sección dentro de una integración.

import { useMemo, useState } from 'react'
import { Background, Controls, Handle, Position, ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import Modal from '../../ui/Modal.jsx'
import { layoutDataflow } from '../../../lib/dataflow-layout.js'

/**
 * El color y el icono de cada tipo de nodo. Paleta sobria, la de v9.
 *
 * Los lectores son azul (de dónde viene), las transformaciones gris oscuro (el trabajo) y los
 * escritores terracota (a dónde va).
 */
const ESTILO_POR_TIPO = {
  TableReader: { color: '#5b7a99', icono: '📋' },
  FileReader: { color: '#6f7a8a', icono: '📄' },
  TableLoader: { color: '#8a6450', icono: '🎯' },
  FileLoader: { color: '#8a6450', icono: '💾' },
  QueryTransform: { color: '#3d4a5c', icono: '🔧' },
  XMLMapTransform: { color: '#3d4a5c', icono: '🧩' },
  RowGenerationTransform: { color: '#6b6455', icono: '➕' },
}

const estiloDe = (tipo) => {
  const encontrado = Object.entries(ESTILO_POR_TIPO).find(([nombre]) => tipo.includes(nombre))
  return encontrado ? encontrado[1] : { color: '#4a5568', icono: '⬛' }
}

/** Lo que se ve debajo del nombre: la tabla, el archivo, o nada. */
function subtitulo(nodo) {
  if (nodo.tableName) return nodo.dsName ? `${nodo.dsName} · ${nodo.tableName}` : nodo.tableName
  if (nodo.fileName) return nodo.fileName
  if (nodo.rowCount) return `${nodo.rowCount} filas`
  return ''
}

/**
 * Una caja del diagrama.
 *
 * Los conectores van escondidos: acá no se dibuja nada a mano, pero sin ellos la librería no sabe de
 * dónde a dónde tirar la flecha y el diagrama sale sin ninguna.
 */
function NodoDelDataflow({ data }) {
  return (
    <div className="exp-df-node" style={{ borderLeftColor: data.color }}>
      <Handle type="target" position={Position.Left} className="exp-handle" />
      <div className="exp-df-node-title">
        <span aria-hidden="true">{data.icono}</span> {data.displayName || data.xmiType}
      </div>
      <div className="exp-df-node-type">{data.xmiType}</div>
      {data.subtitulo && <div className="exp-df-node-sub">{data.subtitulo}</div>}
      <Handle type="source" position={Position.Right} className="exp-handle" />
    </div>
  )
}

const nodeTypes = { paso: NodoDelDataflow }

export default function DataflowDiagram({ diagrama, nombre = 'Dataflow' }) {
  const [elegido, setElegido] = useState(null)
  const [aPantallaCompleta, setAPantallaCompleta] = useState(false)

  const { nodes, edges } = useMemo(() => {
    const posiciones = layoutDataflow(diagrama.nodes)

    return {
      nodes: diagrama.nodes.map((uno, i) => ({
        id: String(uno.id),
        type: 'paso',
        position: posiciones[i],
        data: { ...uno, ...estiloDe(uno.xmiType), subtitulo: subtitulo(uno) },
        // El diagrama es para leer, no para editar: mover una caja no cambia nada en CI-DS.
        draggable: false,
      })),
      edges: diagrama.edges.map((una, i) => ({
        id: `e-${i}`,
        source: String(una.from),
        target: String(una.to),
        label: una.schemaName || '',
        animated: false,
      })),
    }
  }, [diagrama])

  const detalle = elegido === null ? null : diagrama.nodes.find((uno) => uno.id === elegido)

  const lienzo = (
    <div className="exp-df-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, nodo) => setElegido(Number(nodo.id))}
        onPaneClick={() => setElegido(null)}
      >
        <Background gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )

  // El detalle del nodo elegido. Se arma aparte porque va tanto en la sección como en el diálogo.
  const detalleDelNodo = detalle && (
    <div className="exp-df-detail">
      <div className="exp-df-detail-head">
        <b>{detalle.displayName || detalle.xmiType}</b>
        <span className="exp-df-node-type">{detalle.xmiType}</span>
      </div>

      {detalle.inputSchemas?.length > 0 && (
        <div className="exp-df-detail-row">
          <span className="exp-k">Entradas</span> {detalle.inputSchemas.join(', ')}
        </div>
      )}

      {detalle.joins?.map((una, i) => (
        <div className="exp-df-detail-row" key={`join-${i}`}>
          <span className="exp-k">Unión</span> {una.leftSchemaName} ↔ {una.rightSchemaName}
          <pre className="exp-expr">{una.expression}</pre>
        </div>
      ))}

      {detalle.filterExpression && (
        <div className="exp-df-detail-row">
          <span className="exp-k">Filtro</span>
          <pre className="exp-expr">{detalle.filterExpression}</pre>
        </div>
      )}

      {detalle.fields?.length > 0 && (
        <div className="table-scroll exp-df-fields">
          <table className="table-dense">
            <thead>
              <tr><th>Campo</th><th>Expresión</th></tr>
            </thead>
            <tbody>
              {detalle.fields.map((uno, i) => (
                <tr key={`${uno.name}-${i}`}>
                  <td>
                    {uno.name}
                    {uno.description && <div className="exp-sub">{uno.description}</div>}
                  </td>
                  <td><code>{uno.projectionExpression || '—'}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )

  return (
    <>
      <div className="exp-df-wrap">
        <div className="exp-df-canvas-wrap">
          {lienzo}
          <button
            type="button"
            className="btn btn-sm exp-df-fs"
            onClick={() => setAPantallaCompleta(true)}
            title="Ver en grande"
          >
            ⛶
          </button>
        </div>
        {detalleDelNodo}
      </div>

      {/* El diálogo monta SU PROPIO lienzo, no mueve el de la sección: la librería mide el
          contenedor al montarse, y arrastrar el mismo nodo del DOM a otro sitio lo deja sin medir
          y sin dibujar ninguna flecha. */}
      {aPantallaCompleta && (
        <Modal title={nombre} subtitle={`${diagrama.nodes.length} pasos`} onClose={() => setAPantallaCompleta(false)} wide>
          <div className="exp-df-grande">{lienzo}</div>
          {detalleDelNodo}
        </Modal>
      )}
    </>
  )
}
