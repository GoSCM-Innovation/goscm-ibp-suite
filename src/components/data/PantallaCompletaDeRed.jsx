// La red a pantalla completa, en su propio diálogo.
//
// Portado de `vizFullscreenDlg` de `index.html` de v7 y de `vizOpenFullscreen`, `vizCloseFullscreen`
// y `vizFsFit`. No es la pantalla completa del navegador: es un `<dialog>` que cubre la ventana, con
// su título (el código del material), «⊞ Ajustar», «⊟ Compactar» y «✕ Cerrar», su propia leyenda, su
// propio detalle de nodo y el panel «Rutas» como franja inferior.
//
// El lienzo de aquí es OTRO grafo, construido al abrir: la leyenda y los filtros son los mismos que en
// la página, pero lo que se arrastra o se selecciona en uno no se ve en el otro, como en v7.

import { useRef, useState } from 'react'

import DetalleDeNodo from './DetalleDeNodo.jsx'
import DialogoDeRed from './DialogoDeRed.jsx'
import LeyendaDeRed from './LeyendaDeRed.jsx'
import LienzoDeRed from './LienzoDeRed.jsx'
import PanelDeRutas from './PanelDeRutas.jsx'

export default function PantallaCompletaDeRed({
  producto, red, filas, descripciones, visibles, onVisibles, seleccion, analisis, filtroRutas,
  onFiltroRutas, onResaltar, onExportar, onCompactar, onCerrar,
}) {
  const lienzo = useRef(null)
  const [elegido, setElegido] = useState(null)

  const nodo = elegido ? red.nodos.find((uno) => uno.id === elegido) : null

  return (
    <DialogoDeRed className="nv-pantalla" etiqueta={`Red de ${producto}`} onCerrar={onCerrar}>
      <div className="nv-pantalla-cabecera">
        <span className="nv-pantalla-titulo">{producto}</span>
        <div className="nv-pantalla-botones">
          <button type="button" className="btn btn-secondary btn-small" onClick={() => lienzo.current?.ajustar()}>
            ⊞ Ajustar
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={onCompactar}>
            ⊟ Compactar
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={onCerrar}>
            ✕ Cerrar
          </button>
        </div>
      </div>

      {nodo && (
        <div className="nv-pantalla-detalle">
          <div className="nv-pantalla-detalle-cuerpo">
            <DetalleDeNodo nodo={nodo} filas={filas} descripciones={descripciones} />
          </div>
          <button type="button" className="nv-pantalla-detalle-x" onClick={() => setElegido(null)} aria-label="Cerrar detalle">
            ✕
          </button>
        </div>
      )}

      <LienzoDeRed
        ref={lienzo}
        red={red}
        visibles={visibles}
        seleccion={seleccion}
        alElegir={setElegido}
        className="nv-pantalla-lienzo"
      />

      <LeyendaDeRed visibles={visibles} onCambiar={onVisibles} variante="pantalla" />

      {/* Como en v7, el panel solo aparece si la red tiene rutas. */}
      {analisis && analisis.rutas.length > 0 && (
        <PanelDeRutas
          variante="pantalla"
          analisis={analisis}
          filtro={filtroRutas}
          onFiltro={onFiltroRutas}
          onResaltar={onResaltar}
          onExportar={onExportar}
        />
      )}
    </DialogoDeRed>
  )
}
