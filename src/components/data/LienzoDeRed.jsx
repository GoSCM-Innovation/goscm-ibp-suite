// El lienzo de la red de suministro: el grafo interactivo de v7, con la misma librería.
//
// Portado de `vizMakeNetwork` y `vizBuildGraph` de `visualizer.js` de v7. Los colores, las formas, los
// tamaños, el grosor de las flechas y la curvatura de los arcos son los suyos, valor por valor: es lo
// que el cliente reconoce como «la red», y cambiarlo por columnas estáticas —que es lo que había aquí
// antes— convertía una herramienta de exploración en una tabla dibujada.
//
// LA FÍSICA VA APAGADA, como en v7. Las posiciones las calcula `posicionesEnLienzo` en `core/` y el
// lienzo solo las pinta. Una red con física se recoloca sola en cada apertura, así que dos personas
// mirando el mismo producto ven dibujos distintos y ninguna puede decir «el nodo de arriba a la
// izquierda». Se puede arrastrar, acercar y desplazar; lo que no hace es moverse sola.

import { useEffect, useRef } from 'react'
import { DataSet, Network } from 'vis-network/standalone'
import 'vis-network/styles/vis-network.css'

import { ARCOS, CLASES, posicionesEnLienzo } from '../../../core/ibp/supply-network.js'
import {
  COLORES, FORMAS, NOMBRE_DE_CLASE, TAMANOS, TAMANO_POR_DEFECTO,
} from '../../lib/clases-de-red.js'

export default function LienzoDeRed({ red, ocultas, alElegir, alto = 'calc(100vh - 320px)' }) {
  const caja = useRef(null)
  const grafo = useRef(null)

  useEffect(() => {
    if (!caja.current || !red) return undefined

    const visibles = (red.nodos ?? []).filter(
      // El producto no se puede ocultar: es de lo que trata el dibujo.
      (uno) => uno.clase === CLASES.producto || !ocultas.has(uno.clase),
    )
    const conPosicion = posicionesEnLienzo(visibles, red.arcos)
    const dentro = new Set(conPosicion.map((uno) => uno.id))

    const nodos = new DataSet(conPosicion.map((uno) => ({
      id: uno.id,
      label: uno.nombre && uno.nombre !== uno.id ? `${uno.id}\n${uno.nombre}` : uno.id,
      title: [
        `${NOMBRE_DE_CLASE[uno.clase] ?? uno.clase}: ${uno.id}`,
        uno.nombre && uno.nombre !== uno.id ? uno.nombre : '',
        uno.plazo ? `Producción: ${uno.plazo}` : '',
      ].filter(Boolean).join('\n'),
      color: COLORES[uno.clase] ?? COLORES[CLASES.ubicacion],
      shape: FORMAS[uno.clase] ?? 'ellipse',
      font: {
        color: '#ffffff',
        size: uno.clase === CLASES.producto ? 13 : 11,
        bold: uno.clase === CLASES.producto,
        multi: false,
      },
      size: TAMANOS[uno.clase] ?? TAMANO_POR_DEFECTO,
      x: uno.x,
      y: uno.y,
      fixed: { x: false, y: false },
    })))

    const arcos = new DataSet((red.arcos ?? [])
      .filter((uno) => dentro.has(uno.desde) && dentro.has(uno.hasta))
      .map((uno) => ({
        id: uno.id,
        from: uno.desde,
        to: uno.hasta,
        // La entrega al cliente va punteada, como en v7: es el único arco que sale del sistema.
        dashes: uno.clase === ARCOS.entrega,
        arrows: { to: { enabled: true, scaleFactor: 0.55 } },
        color: {
          color: 'rgba(148,163,184,0.45)',
          highlight: 'rgba(247,168,0,0.9)',
          hover: 'rgba(247,168,0,0.7)',
        },
        width: 1.5,
        title: uno.detalle || `${uno.desde} → ${uno.hasta}`,
      })))

    const red_ = new Network(caja.current, { nodes: nodos, edges: arcos }, {
      physics: { enabled: false },
      interaction: { hover: true, tooltipDelay: 150, zoomView: true, dragView: true },
      nodes: { borderWidth: 1.5, borderWidthSelected: 3 },
      edges: {
        smooth: { type: 'curvedCW', roundness: 0.15 },
        arrows: { to: { enabled: true, scaleFactor: 0.55 } },
      },
    })

    red_.once('afterDrawing', () => {
      red_.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } })
    })

    red_.on('click', (evento) => {
      alElegir?.(evento.nodes.length > 0 ? String(evento.nodes[0]) : '')
    })

    grafo.current = red_
    return () => { red_.destroy(); grafo.current = null }
  }, [red, ocultas, alElegir])

  return <div ref={caja} className="viz-canvas" style={{ height: alto }} />
}
