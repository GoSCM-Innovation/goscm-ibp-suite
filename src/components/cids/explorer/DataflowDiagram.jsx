// El dataflow dibujado como lo dibuja CI-DS: lectores, transformaciones y escritores.
//
// v9 usaba vis-network, que se cargaba de un CDN. Aquí se usa `@xyflow/react`, que ya está en el
// proyecto para el lienzo de orquestaciones: una librería menos y ninguna descarga externa.
//
// Se carga aparte del resto (`lazy`) porque pesa, y a este diagrama se entra solo cuando se abre su
// sección dentro de una integración.
//
// Lo demás es de v9: la paleta y los iconos de los doce tipos de nodo, el tooltip de cada caja, la
// etiqueta cortada de las flechas, el panel de detalle POR TIPO de nodo bajo el lienzo (con su
// mensaje inicial) y la pantalla completa de verdad, con el panel a la derecha y un divisor que se
// arrastra para cambiarle el ancho (`openDataflowFullscreen`).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Background, Controls, Handle, Position, ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { layoutDataflow } from '../../../lib/dataflow-layout.js'
import { cortarEtiqueta, estiloDe, tooltipDelNodo } from '../../../lib/dataflow-style.js'
import { COLOR_DE_TIPO } from '../../../lib/integration-view.js'

/**
 * Una caja del diagrama.
 *
 * Los conectores van escondidos: aquí no se dibuja nada a mano, pero sin ellos la librería no sabe de
 * dónde a dónde tirar la flecha y el diagrama sale sin ninguna.
 */
function NodoDelDataflow({ data }) {
  return (
    <div className="exp-df-node" style={{ background: data.color, borderColor: data.color }} title={data.tooltip}>
      <Handle type="target" position={Position.Left} className="exp-handle" />
      <div className="exp-df-node-title">{data.icono}  {data.displayName || data.xmiType}</div>
      <Handle type="source" position={Position.Right} className="exp-handle" />
    </div>
  )
}

const nodeTypes = { paso: NodoDelDataflow }

const HINT = 'Click en un nodo del diagrama para ver sus detalles'

/** Una línea «Etiqueta: **valor**» del panel de detalle. */
const Dato = ({ etiqueta, valor }) => (
  <div className="exp-df-kv">{etiqueta}: <b>{valor || '—'}</b></div>
)

/**
 * El panel de detalle de un nodo, según su tipo (`renderDataflowNodeDetail` de v9):
 * lectores y escritores de tabla o de archivo, el generador de filas, las consultas con sus entradas,
 * uniones, WHERE y mappings, y «sin detalle» para el resto.
 */
export function DetalleDelNodo({ nodo }) {
  if (!nodo) return <div className="exp-df-detail"><div className="exp-df-hint">{HINT}</div></div>

  const tipo = nodo.xmiType || ''
  const estilo = estiloDe(tipo)
  let cuerpo

  if (tipo.includes('TableReader') || tipo.includes('TableLoader')) {
    cuerpo = (
      <>
        <Dato etiqueta="Datastore" valor={nodo.dsName} />
        <Dato etiqueta="Tabla" valor={nodo.tableName} />
      </>
    )
  } else if (tipo.includes('FileReader') || tipo.includes('FileLoader')) {
    cuerpo = (
      <>
        <Dato etiqueta="Datastore" valor={nodo.dsName} />
        <Dato etiqueta="Archivo" valor={nodo.fileName} />
      </>
    )
  } else if (tipo.includes('RowGenerationTransform')) {
    cuerpo = <Dato etiqueta="Filas" valor={nodo.rowCount} />
  } else if (tipo.includes('QueryTransform') || tipo.includes('XMLMapTransform')) {
    // Solo los campos con proyección, como la pestaña «Mappings» del detalle de la integración.
    const mapeados = (nodo.fields ?? []).filter((uno) => (uno.projectionExpression || '').trim())
    cuerpo = (
      <>
        {nodo.inputSchemas?.length > 0 && (
          <div className="exp-df-inputs">
            <span className="exp-df-seccion">Inputs:</span>
            {nodo.inputSchemas.map((uno) => <span className="exp-df-chip" key={uno}>{uno}</span>)}
          </div>
        )}
        {(nodo.joins ?? []).map((una, i) => (
          <div className="exp-df-join" key={`join-${i}`}>
            <div className="exp-df-join-titulo">{una.leftSchemaName} ⋈ {una.rightSchemaName}</div>
            <pre className="exp-expr">{una.expression}</pre>
          </div>
        ))}
        {nodo.filterExpression && (
          <div className="exp-df-filtro">
            <div className="exp-df-seccion">WHERE</div>
            <pre className="exp-expr">{nodo.filterExpression}</pre>
          </div>
        )}
        {mapeados.length > 0 && (
          <>
            <div className="exp-df-seccion">Mappings ({mapeados.length})</div>
            <div className="table-scroll exp-df-fields">
              <table className="table-dense">
                <thead>
                  <tr><th style={{ width: '30%' }}>Campo</th><th>Projection</th></tr>
                </thead>
                <tbody>
                  {mapeados.map((uno, i) => (
                    <tr key={`${uno.name}-${i}`}>
                      <td>
                        <b>{uno.name}</b>
                        {uno.description && <div className="exp-sub">{uno.description}</div>}
                      </td>
                      <td><code className="exp-ops">{uno.projectionExpression}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </>
    )
  } else {
    cuerpo = <div className="exp-muted">Sin detalle adicional disponible para este tipo de nodo.</div>
  }

  return (
    <div className="exp-df-detail">
      <div className="exp-df-detail-head">
        <span className="exp-df-tipo" style={{ background: estilo.color }}>{tipo}</span>
        <b>{nodo.displayName || ''}</b>
      </div>
      {cuerpo}
    </div>
  )
}

/** Cuánto ancho puede tener el panel de la derecha en la pantalla completa: 240 px a 60 % de la ventana. */
const ANCHO_DEL_PANEL = { minimo: 240, porOmision: 380 }
const maximoDelPanel = () => Math.max(ANCHO_DEL_PANEL.minimo, Math.floor(window.innerWidth * 0.6))

export default function DataflowDiagram({ diagrama, integracion = null, nombre = 'Dataflow' }) {
  const [elegido, setElegido] = useState(null)
  const [aPantallaCompleta, setAPantallaCompleta] = useState(false)
  const [anchoDelPanel, setAnchoDelPanel] = useState(ANCHO_DEL_PANEL.porOmision)
  const [arrastrando, setArrastrando] = useState(false)
  const cuerpo = useRef(null)

  const { nodes, edges } = useMemo(() => {
    const posiciones = layoutDataflow(diagrama.nodes)

    return {
      nodes: diagrama.nodes.map((uno, i) => ({
        id: String(uno.id),
        type: 'paso',
        position: posiciones[i],
        data: { ...uno, ...estiloDe(uno.xmiType), tooltip: tooltipDelNodo(uno) },
        // El diagrama es para leer, no para editar: mover una caja no cambia nada en CI-DS.
        draggable: false,
      })),
      edges: diagrama.edges.map((una, i) => ({
        id: `e-${i}`,
        source: String(una.from),
        target: String(una.to),
        // El texto completo va en el `title`: la etiqueta se corta a 14 caracteres.
        label: una.schemaName
          ? <span title={una.schemaName}>{cortarEtiqueta(una.schemaName)}</span>
          : '',
        animated: false,
        style: { stroke: '#9db4d0' },
      })),
    }
  }, [diagrama])

  const detalle = elegido === null ? null : diagrama.nodes.find((uno) => uno.id === elegido) ?? null

  const lienzo = (
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
  )

  // Esc cierra la pantalla completa, y mientras está abierta la página de atrás no se desplaza.
  useEffect(() => {
    if (!aPantallaCompleta) return undefined

    const escape = (evento) => { if (evento.key === 'Escape') setAPantallaCompleta(false) }
    const desbordeAnterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', escape)
    return () => {
      document.body.style.overflow = desbordeAnterior
      document.removeEventListener('keydown', escape)
    }
  }, [aPantallaCompleta])

  // El divisor entre el lienzo y el panel: se arrastra con el ratón o con el dedo.
  const mover = useCallback((clientX) => {
    const caja = cuerpo.current?.getBoundingClientRect()
    if (!caja) return
    const ancho = caja.right - clientX
    setAnchoDelPanel(Math.min(maximoDelPanel(), Math.max(ANCHO_DEL_PANEL.minimo, Math.round(ancho))))
  }, [])

  useEffect(() => {
    if (!arrastrando) return undefined

    const alMover = (evento) => mover(evento.clientX)
    const alSoltar = () => setArrastrando(false)
    document.body.style.cursor = 'col-resize'
    document.addEventListener('pointermove', alMover)
    document.addEventListener('pointerup', alSoltar)
    document.addEventListener('pointercancel', alSoltar)
    return () => {
      document.body.style.cursor = ''
      document.removeEventListener('pointermove', alMover)
      document.removeEventListener('pointerup', alSoltar)
      document.removeEventListener('pointercancel', alSoltar)
    }
  }, [arrastrando, mover])

  const tipo = integracion?.tipoIntegracion || 'MD'

  return (
    <>
      <div className="exp-df-wrap">
        <div className="exp-df-canvas-wrap">
          <div className="exp-df-canvas">{lienzo}</div>
          <button
            type="button"
            className="btn btn-sm exp-df-fs"
            onClick={() => setAPantallaCompleta(true)}
            title="Pantalla completa"
          >
            ⛶
          </button>
        </div>
        <DetalleDelNodo nodo={detalle} />
      </div>

      {/* La pantalla completa monta SU PROPIO lienzo, no mueve el de la sección: la librería mide el
          contenedor al montarse, y arrastrar el mismo nodo del DOM a otro sitio lo deja sin medir y
          sin dibujar ninguna flecha. Va en un portal para quedar por encima de todo, como el modal
          de v9 (`#ex-df-fs-modal`, que ocupaba la ventana entera). */}
      {aPantallaCompleta && createPortal(
        <div className="exp-df-fs-modal" role="dialog" aria-label={nombre}>
          <div className="exp-df-fs-cabecera">
            <span className="exp-df-fs-titulo">
              {integracion
                ? (
                  <>
                    <span className="exp-type" style={{ '--tipo': COLOR_DE_TIPO[tipo] || 'var(--text3)' }}>{tipo}</span>
                    {' '}{integracion.jobName || ''}
                    {integracion.dataflowName && integracion.dataflowName !== integracion.jobName && (
                      <span className="exp-sub"> ↳ {integracion.dataflowName}</span>
                    )}
                  </>
                )
                : nombre}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setAPantallaCompleta(false)}
              title="Cerrar (Esc)"
              aria-label="Cerrar (Esc)"
            >
              ✕
            </button>
          </div>

          <div className="exp-df-fs-cuerpo" ref={cuerpo}>
            <div className="exp-df-fs-lienzo">{lienzo}</div>
            <div
              className={`exp-df-fs-divisor${arrastrando ? ' arrastrando' : ''}`}
              role="separator"
              aria-orientation="vertical"
              title="Arrastra para ajustar el ancho del panel"
              onPointerDown={(evento) => { evento.preventDefault(); setArrastrando(true) }}
            />
            <div className="exp-df-fs-panel" style={{ width: anchoDelPanel, maxWidth: '60vw' }}>
              <DetalleDelNodo nodo={detalle} />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
