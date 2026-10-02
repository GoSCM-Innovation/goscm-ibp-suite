// El lienzo de la red de suministro: el grafo interactivo de v7, con la misma librería.
//
// Portado de `vizMakeNetwork` y `vizRender` de `visualizer.js` de v7. Los colores, las formas, los
// tamaños, el grosor de las flechas y la curvatura de los arcos son los suyos, valor por valor: es lo
// que el cliente reconoce como «la red».
//
// LA FÍSICA VA APAGADA, como en v7. Las posiciones las calcula `colocarNodos` en `core/` y el lienzo
// solo las pinta. Una red con física se recoloca sola en cada apertura, así que dos personas mirando
// el mismo producto ven dibujos distintos y ninguna puede decir «el nodo de arriba a la izquierda».
//
// APAGAR UNA CLASE NO RECALCULA NADA, también como en v7 (`vizToggleType`): solo marca esos nodos
// `hidden` en el conjunto de datos y vuelve a encuadrar con una animación. Lo que sí reconstruye el
// lienzo es recibir otra `red` —«Compactar», aplicar filtros, abrir la pantalla completa—.

import { useEffect, useImperativeHandle, useRef } from 'react'
import { DataSet, Network } from 'vis-network/standalone'
import 'vis-network/styles/vis-network.css'

import { ARCOS, CLASES } from '../../../core/ibp/supply-network.js'
import {
  COLORES, FORMAS, TAMANOS, TAMANO_POR_DEFECTO,
} from '../../lib/clases-de-red.js'

const ANIMACION = { easingFunction: 'easeInOutQuad' }

/** Los arcos de proveedor van punteados en púrpura (`_vizAddSupplierEdge`). */
const COLOR_DE_SUMINISTRO = {
  color: 'rgba(167,139,250,0.5)',
  highlight: 'rgba(167,139,250,0.95)',
  hover: 'rgba(167,139,250,0.75)',
}

const COLOR_DE_ARCO = {
  color: 'rgba(148,163,184,0.45)',
  highlight: 'rgba(247,168,0,0.9)',
  hover: 'rgba(247,168,0,0.7)',
}

/** Un nodo del grafo en el formato de la librería. */
function nodoDeLienzo(uno, visibles) {
  return {
    id: uno.id,
    label: uno.etiqueta,
    title: uno.titulo,
    color: COLORES[uno.clase] ?? COLORES[CLASES.ubicacion],
    shape: FORMAS[uno.clase] ?? 'ellipse',
    font: { color: '#ffffff', size: 11, bold: false, multi: false },
    size: TAMANOS[uno.clase] ?? TAMANO_POR_DEFECTO,
    hidden: visibles[uno.clase] === false,
    x: uno.x,
    y: uno.y,
    _clase: uno.clase,
  }
}

/** Un arco del grafo en el formato de la librería. */
function arcoDeLienzo(uno) {
  const proveedor = uno.clase === ARCOS.suministro
  return {
    id: uno.id,
    from: uno.desde,
    to: uno.hasta,
    arrows: { to: { enabled: true, scaleFactor: 0.55 } },
    // Proveedor: punteado corto. Entrega al cliente: punteado, porque es el único arco que sale del
    // sistema. El resto, continuo.
    dashes: proveedor ? [6, 4] : uno.clase === ARCOS.entrega,
    color: proveedor ? COLOR_DE_SUMINISTRO : COLOR_DE_ARCO,
    width: 1.5,
    title: uno.titulo,
  }
}

/**
 * `red` es lo que devuelve `armarRed`. `visibles` dice qué clases están encendidas en la leyenda.
 * `seleccion` ({ nodos, pares }) es una ruta a resaltar; se reaplica al reconstruir.
 * `ref` entrega `ajustar()`: el «⊞ Ajustar» de v7.
 */
export default function LienzoDeRed({
  red, visibles, seleccion = null, alElegir = null, ref = null, className = '', style = null,
}) {
  const caja = useRef(null)
  const grafo = useRef(null)
  const visiblesRef = useRef(visibles)
  const aplicadas = useRef(visibles)
  const alElegirRef = useRef(alElegir)

  useEffect(() => { visiblesRef.current = visibles }, [visibles])
  useEffect(() => { alElegirRef.current = alElegir }, [alElegir])

  useImperativeHandle(ref, () => ({
    ajustar() {
      grafo.current?.fit({ animation: { duration: 500, ...ANIMACION } })
    },
  }), [])

  // Construir el grafo. Solo cuando llega otra red: es lo que deshace lo que el usuario arrastró.
  useEffect(() => {
    if (!caja.current || !red) return undefined

    const ahora = visiblesRef.current
    const nodos = new DataSet(red.nodos.map((uno) => nodoDeLienzo(uno, ahora)))
    const arcos = new DataSet(red.arcos.map(arcoDeLienzo))

    const net = new Network(caja.current, { nodes: nodos, edges: arcos }, {
      physics: { enabled: false },
      interaction: { hover: true, tooltipDelay: 150, zoomView: true, dragView: true },
      nodes: { borderWidth: 1.5, borderWidthSelected: 3 },
      edges: {
        smooth: { type: 'curvedCW', roundness: 0.15 },
        arrows: { to: { enabled: true, scaleFactor: 0.55 } },
      },
    })

    net.once('afterDrawing', () => {
      net.fit({ animation: { duration: 400, ...ANIMACION } })
    })

    // Pulsar en vacío no cierra el detalle, como en v7: solo un nodo lo cambia.
    net.on('click', (evento) => {
      if (evento.nodes.length === 0) return
      alElegirRef.current?.(String(evento.nodes[0]))
    })

    grafo.current = net
    aplicadas.current = { ...ahora }
    return () => { net.destroy(); grafo.current = null }
  }, [red])

  // La leyenda: marcar los nodos de la clase y volver a encuadrar. No se toca la disposición.
  useEffect(() => {
    const net = grafo.current
    if (!net) return
    let cambio = false
    for (const clase of Object.values(CLASES)) {
      if (visibles[clase] === aplicadas.current[clase]) continue
      const cambios = []
      net.body.data.nodes.forEach((nodo) => {
        if (nodo._clase === clase) cambios.push({ id: nodo.id, hidden: visibles[clase] === false })
      })
      if (cambios.length > 0) {
        net.body.data.nodes.update(cambios)
        cambio = true
      }
    }
    aplicadas.current = { ...visibles }
    if (cambio) net.fit({ animation: { duration: 350, ...ANIMACION } })
  }, [visibles])

  // Resaltar una ruta: seleccionar sus nodos y sus arcos, y llevar la vista al primero.
  useEffect(() => {
    const net = grafo.current
    if (!net || !seleccion) return
    const { nodos, pares } = seleccion

    const presentes = nodos.filter((id) => net.body.data.nodes.get(id))
    const idsDeArco = []
    net.body.data.edges.forEach((arco) => {
      if (pares.some(([a, b]) => (arco.from === a && arco.to === b) || (arco.from === b && arco.to === a))) {
        idsDeArco.push(arco.id)
      }
    })

    net.selectNodes(presentes)
    net.selectEdges(idsDeArco)
    if (presentes.length > 0) {
      try {
        net.focus(presentes[0], { animation: { duration: 500, ...ANIMACION }, scale: 0.85 })
      } catch { /* sin vista que mover: no pasa nada */ }
    }
  }, [seleccion, red])

  return <div ref={caja} className={`nv-lienzo ${className}`.trim()} style={style ?? undefined} />
}
