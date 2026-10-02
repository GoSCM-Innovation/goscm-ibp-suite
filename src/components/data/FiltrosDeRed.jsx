// El diálogo «Filtros de red»: qué ubicaciones y qué clientes se dibujan.
//
// Portado de `vizFilterDlg` de `index.html` de v7 y de `vizOpenFilter`, `vizRenderFilterList`,
// `vizFilterSelectAll`, `vizApplyFilter` y `vizClearFilter` de `visualizer.js`. Dos columnas, cada una
// con su buscador —con comodines: `*T1`, `T1*`, `*US*`—, su «Seleccionar todo» y su lista de casillas.
//
// UNA DIFERENCIA CONSCIENTE con v7: allí cada casilla modificaba los conjuntos de ocultos AL MARCARLA,
// y cerrar con la ✕ o con Escape dejaba esos cambios puestos sin redibujar nada ni actualizar el
// «▼ Filtros (N)»: la pantalla decía una cosa y el siguiente «Compactar» aplicaba otra. Aquí los
// cambios son un borrador que solo se confirma con «Aplicar»; cerrar sin aplicar los descarta.

import { useEffect, useMemo, useRef, useState } from 'react'

import { coincideConComodin } from '../../../core/ibp/supply-network.js'
import DialogoDeRed from './DialogoDeRed.jsx'

/** Una columna: encabezado con su cuenta, buscador, «Seleccionar todo» y la lista. */
function Columna({ titulo, items, ocultos, onCambiar }) {
  const [buscado, setBuscado] = useState('')
  const todos = useRef(null)

  const filtrados = useMemo(() => {
    const q = buscado.trim()
    return q ? items.filter((uno) => coincideConComodin(uno.id, q) || coincideConComodin(uno.descr, q)) : items
  }, [items, buscado])

  const visibles = filtrados.filter((uno) => !ocultos.has(uno.id)).length

  // «Indeterminado» solo se puede poner desde el elemento, no con un atributo.
  useEffect(() => {
    if (todos.current) todos.current.indeterminate = visibles > 0 && visibles < filtrados.length
  }, [visibles, filtrados.length])

  return (
    <div className="nv-filtros-columna">
      <div className="nv-filtros-titulo">
        <span>{titulo}</span>
        <span className="nv-filtros-cuenta">({visibles} de {filtrados.length})</span>
      </div>
      <input
        className="nv-filtros-buscar"
        type="text"
        value={buscado}
        onChange={(evento) => setBuscado(evento.target.value)}
        placeholder="Buscar... (ej: *T1, T1*, *US*)"
        aria-label={`Buscar en ${titulo}`}
      />
      <label className="nv-filtros-todo">
        <input
          ref={todos}
          type="checkbox"
          checked={visibles === filtrados.length}
          onChange={(evento) => onCambiar(filtrados.map((uno) => uno.id), evento.target.checked)}
        />
        <span>Seleccionar todo</span>
      </label>
      <div className="nv-filtros-raya" />
      <div className="nv-filtros-lista">
        {filtrados.map((uno) => (
          <label key={uno.id} className="nv-filtros-fila">
            <input
              type="checkbox"
              checked={!ocultos.has(uno.id)}
              onChange={(evento) => onCambiar([uno.id], evento.target.checked)}
            />
            <span className="nv-filtros-id">{uno.id}</span>
            {uno.descr && <span className="nv-filtros-descr">{uno.descr}</span>}
          </label>
        ))}
      </div>
    </div>
  )
}

/**
 * `ubicaciones` y `clientes` son `[{ id, descr }]`. `ubicacionesOcultas` y `clientesOcultos`, los
 * `Set` con los apagados hoy. `onAplicar(ubicaciones, clientes)` recibe los nuevos; `onLimpiar` apaga
 * todos los filtros; `onCerrar` cierra sin cambiar nada.
 */
export default function FiltrosDeRed({
  ubicaciones, clientes, ubicacionesOcultas, clientesOcultos, onAplicar, onLimpiar, onCerrar,
}) {
  const [ubicacionesBorrador, setUbicacionesBorrador] = useState(() => new Set(ubicacionesOcultas))
  const [clientesBorrador, setClientesBorrador] = useState(() => new Set(clientesOcultos))

  const cambiar = (poner) => (ids, visible) => poner((previos) => {
    const siguientes = new Set(previos)
    for (const id of ids) {
      if (visible) siguientes.delete(id)
      else siguientes.add(id)
    }
    return siguientes
  })

  return (
    <DialogoDeRed className="nv-filtros" etiqueta="Filtros de red" onCerrar={onCerrar}>
      <div className="nv-filtros-cabecera">
        <span className="nv-filtros-nombre">Filtros de red</span>
        <button type="button" className="nv-filtros-x" onClick={onCerrar} aria-label="Cerrar">✕</button>
      </div>
      <div className="nv-filtros-cuerpo">
        <Columna
          titulo="Ubicaciones"
          items={ubicaciones}
          ocultos={ubicacionesBorrador}
          onCambiar={cambiar(setUbicacionesBorrador)}
        />
        <Columna
          titulo="Clientes"
          items={clientes}
          ocultos={clientesBorrador}
          onCambiar={cambiar(setClientesBorrador)}
        />
      </div>
      <div className="nv-filtros-pie">
        <button type="button" className="btn btn-secondary btn-small" onClick={onLimpiar}>Limpiar todo</button>
        <button
          type="button"
          className="btn btn-primary btn-small"
          onClick={() => onAplicar(ubicacionesBorrador, clientesBorrador)}
        >
          Aplicar
        </button>
      </div>
    </DialogoDeRed>
  )
}
