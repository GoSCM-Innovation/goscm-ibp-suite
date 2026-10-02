// La leyenda de la red: un cuadro flotante arriba a la derecha del lienzo, con una casilla por clase.
//
// Portada de `vizLegend` y de la leyenda de la pantalla completa de `index.html` de v7. Las cuatro
// casillas encienden y apagan los nodos de su clase; la red no tiene una quinta entrada porque en v7
// el producto no es un nodo.

import { LEYENDA, NOMBRE_DE_CLASE } from '../../lib/clases-de-red.js'

/** `visibles` es `{ [clase]: boolean }`; `onCambiar(clase, visible)`. */
export default function LeyendaDeRed({ visibles, onCambiar, variante = 'pagina' }) {
  return (
    <div className={`nv-leyenda${variante === 'pantalla' ? ' nv-leyenda--pantalla' : ''}`}>
      <div className="nv-leyenda-titulo">Leyenda</div>
      <div className="nv-leyenda-lista">
        {LEYENDA.map((uno) => (
          <label key={uno.clase} className="nv-leyenda-fila" title={uno.ayuda}>
            <input
              type="checkbox"
              checked={visibles[uno.clase] !== false}
              onChange={(evento) => onCambiar(uno.clase, evento.target.checked)}
              style={{ accentColor: uno.color }}
            />
            <span className={`nv-leyenda-marca ${uno.forma}`} style={{ background: uno.color }} />
            <span>{NOMBRE_DE_CLASE[uno.clase]}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
