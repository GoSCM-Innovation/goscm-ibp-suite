// La ventana emergente para elegir de una lista extensa: buscador por ID o descripción, un
// interruptor por elemento, el conteo de lo elegido y «Cancelar» / «Aplicar».
//
// Pedido el 2026-10-06: elegir atributos de un maestro o key figures en una lista dentro de la
// página, o en un desplegable de 300 px, no escala. La forma es la del diálogo de «Campos adicionales»
// de los Analyzers (`data/CamposAdicionales.jsx`), con el mismo `<dialog>` nativo y las mismas
// clases `ef-*`: capa superior del navegador, foco atrapado y Escape gratis.
//
// Es de presentación pura y NO sabe qué se está eligiendo: todo llega por props. Se monta al abrirse y
// se desmonta al cerrarse, así la selección temporal y el buscador nacen limpios cada vez, y «Cancelar»
// descarta lo marcado sin que quien la usa tenga que deshacer nada.
//
// El orden en que se marca es el orden de la selección (se agrega al final, se quita sin mover el
// resto): en las columnas de una tabla ese orden es el de las columnas.

import { useEffect, useRef, useState } from 'react'

// Dibujar miles de filas de golpe congela la ventana. Pasado esto se pide afinar la búsqueda.
const TOPE_DE_FILAS = 500

const coincide = (id, descripcion, consulta) => (
  !consulta || id.toUpperCase().includes(consulta) || Boolean(descripcion && descripcion.toUpperCase().includes(consulta))
)

/**
 * @param {object} props
 * @param {string}   props.titulo
 * @param {string[]} props.opciones             Todos los elementos elegibles, en el orden en que se listan.
 * @param {string[]} props.seleccion            Lo elegido al abrir, en orden.
 * @param {(sel: string[]) => void} props.onGuardar
 * @param {() => void} props.onCerrar
 * @param {Record<string, string>} [props.etiquetas]  Descripción de cada elemento, si se conoce.
 * @param {string[]} [props.claves]             Elementos que se marcan con la insignia «clave».
 * @param {(id: string) => import('react').ReactNode} [props.insignia]  Marca extra por elemento.
 * @param {(ctl: { opciones: string[], temporal: string[], setTemporal: Function }) => import('react').ReactNode} [props.cabecera]
 *        Controles propios sobre el buscador (las preselecciones de columnas, por ejemplo).
 * @param {string}   [props.sufijoDeConteo]     «campo(s) seleccionado(s)».
 */
export default function VentanaDeSeleccion({
  titulo,
  opciones,
  seleccion,
  onGuardar,
  onCerrar,
  etiquetas = {},
  claves = [],
  insignia = null,
  cabecera = null,
  sufijoDeConteo = 'seleccionado(s)',
}) {
  const dialogo = useRef(null)
  const [filtro, setFiltro] = useState('')
  const [temporal, setTemporal] = useState(() => [...seleccion])

  useEffect(() => {
    const el = dialogo.current
    if (!el || el.open) return
    if (typeof el.showModal === 'function') el.showModal()
    else el.open = true
  }, [])

  const consulta = filtro.trim().toUpperCase()
  const visibles = opciones.filter((id) => coincide(id, etiquetas[id] || '', consulta))
  const dibujadas = visibles.slice(0, TOPE_DE_FILAS)
  const claveSet = new Set(claves)
  const marcadas = new Set(temporal)

  function alternar(id) {
    setTemporal((actual) => (actual.includes(id) ? actual.filter((otro) => otro !== id) : [...actual, id]))
  }

  // Lo que el buscador deja ver, de golpe. Con 400 key figures nadie marca una a una.
  function marcarVisibles() {
    setTemporal((actual) => [...actual, ...visibles.filter((id) => !actual.includes(id))])
  }
  function quitarVisibles() {
    const fuera = new Set(visibles)
    setTemporal((actual) => actual.filter((id) => !fuera.has(id)))
  }

  return (
    // `onClose` se dispara cuando el navegador cierra el diálogo por su cuenta (Escape): hay que
    // desmontarlo también, o el estado de quien lo usa diría «abierto» sobre un diálogo ya cerrado.
    <dialog ref={dialogo} className="connect-dialog ef-fields-dialog" onClose={onCerrar} aria-label={titulo}>
      <div className="connect-dialog-header">
        <span className="connect-dialog-title">{titulo}</span>
        <button type="button" className="dialog-close-btn" onClick={onCerrar} aria-label="Cerrar">✕</button>
      </div>
      <div className="ef-fields-dialog-body">
        {cabecera && <div className="vs-cabecera">{cabecera({ opciones, temporal, setTemporal })}</div>}

        <div className="ef-fields-search-wrap">
          <input
            type="text"
            autoFocus
            placeholder="Buscar por ID o descripción..."
            className="ef-fields-search"
            value={filtro}
            onChange={(evento) => setFiltro(evento.target.value)}
          />
          <div className="vs-masivas">
            <button type="button" className="vs-enlace" onClick={marcarVisibles} disabled={visibles.length === 0}>
              Marcar visibles ({visibles.length})
            </button>
            <button type="button" className="vs-enlace" onClick={quitarVisibles} disabled={visibles.length === 0}>
              Quitar visibles
            </button>
          </div>
        </div>

        <div className="ef-fields-list">
          {dibujadas.map((id) => (
            <div className="ef-field-item" key={id}>
              <label className="ef-toggle-wrap">
                <input type="checkbox" checked={marcadas.has(id)} onChange={() => alternar(id)} />
                <span className="ef-toggle-slider" />
              </label>
              <div className="ef-field-info">
                <span className="ef-field-name">{id}</span>
                {etiquetas[id] && etiquetas[id] !== id && <span className="ef-field-desc">{etiquetas[id]}</span>}
              </div>
              {insignia?.(id)}
              {claveSet.has(id) && <span className="ef-mandatory-badge">clave</span>}
            </div>
          ))}
          {visibles.length > dibujadas.length && (
            <p className="vs-nota">Se muestran {dibujadas.length} de {visibles.length}. Afina la búsqueda para ver el resto.</p>
          )}
          {visibles.length === 0 && (
            <p className="vs-nota">{consulta ? `Sin resultados para "${filtro}".` : 'No hay elementos para elegir.'}</p>
          )}
        </div>

        <div className="ef-fields-footer">
          {/* Cuenta TODA la selección, también lo que el buscador esconde: es lo que se aplica. */}
          <span className="ef-fields-count">{temporal.length > 0 ? `${temporal.length} ${sufijoDeConteo}` : ''}</span>
          <div className="btn-row" style={{ margin: 0 }}>
            <button type="button" className="btn btn-secondary" onClick={onCerrar}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={() => onGuardar(temporal)}>Aplicar</button>
          </div>
        </div>
      </div>
    </dialog>
  )
}
