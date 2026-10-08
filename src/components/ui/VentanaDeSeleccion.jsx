// La ventana emergente para elegir de una lista extensa: buscador por ID o descripción y, según el
// modo, un interruptor por elemento («múltiple») o un clic que elige y cierra («única»).
//
// Pedido el 2026-10-06: elegir de una lista larga dentro de la página, o en un desplegable de 300 px,
// no escala. La forma es la del diálogo de «Campos adicionales» de los Analyzers
// (`data/CamposAdicionales.jsx`), con el mismo `<dialog>` nativo y las mismas clases `ef-*`: capa
// superior del navegador, foco atrapado y Escape gratis.
//
// CUÁNDO se usa lo decide `lib/lista-extensa.js` (más de 12 opciones), no cada pantalla. Esta pieza no
// sabe qué se está eligiendo: todo llega por props. Se monta al abrirse y se desmonta al cerrarse, así la
// selección temporal y el buscador nacen limpios cada vez, y «Cancelar» descarta lo marcado.
//
// Modo múltiple: lo marcado no se aplica hasta «Aplicar». El orden de la selección es el orden en que se
// marcó (se agrega al final, se quita sin mover el resto): en las columnas de una tabla es el de las
// columnas.
// Modo única: pulsar una fila (o Enter sobre la primera coincidencia) la elige y cierra, sin «Aplicar».

import { useEffect, useRef, useState } from 'react'

// Dibujar miles de filas de golpe congela la ventana. Pasado esto se pide afinar la búsqueda.
const TOPE_DE_FILAS = 500

/**
 * @param {object} props
 * @param {string}   props.titulo
 * @param {string[]} props.opciones             Todos los elementos elegibles (sus IDs), en el orden en que se listan.
 * @param {() => void} props.onCerrar
 * @param {'multiple'|'unica'} [props.modo]
 * @param {string[]} [props.seleccion]          Múltiple: lo elegido al abrir, en orden.
 * @param {(sel: string[]) => void} [props.onGuardar]   Múltiple.
 * @param {string}   [props.valor]              Única: el elegido ahora (se resalta).
 * @param {(id: string) => void} [props.onElegir]       Única.
 * @param {Record<string, string>} [props.nombres]      Texto principal de cada elemento si NO es su ID
 *        («ID — descripción» ya armado, o una fecha legible). Se busca en él también.
 * @param {Record<string, string>} [props.etiquetas]    Descripción de cada elemento, si se conoce.
 * @param {string[]} [props.claves]             Elementos que se marcan con la insignia «clave».
 * @param {(id: string) => import('react').ReactNode} [props.insignia]  Marca extra por elemento.
 * @param {(ctl: { opciones: string[], temporal: string[], setTemporal: Function }) => import('react').ReactNode} [props.cabecera]
 *        Controles propios sobre el buscador (las preselecciones de columnas, por ejemplo).
 * @param {string}   [props.sufijoDeConteo]     «campo(s) seleccionado(s)».
 * @param {boolean}  [props.cargando]           Las opciones aún se están leyendo (de SAP, por ejemplo).
 * @param {string}   [props.mensajeDeCarga]
 * @param {string}   [props.error]              Si las opciones no se pudieron leer.
 * @param {string}   [props.aviso]              Una advertencia sobre la lista (por ejemplo, que está recortada).
 * @param {string}   [props.textoVacio]
 */
export default function VentanaDeSeleccion({
  titulo,
  opciones,
  onCerrar,
  modo = 'multiple',
  seleccion = [],
  onGuardar,
  valor,
  onElegir,
  nombres = {},
  etiquetas = {},
  claves = [],
  insignia = null,
  cabecera = null,
  sufijoDeConteo = 'seleccionado(s)',
  cargando = false,
  mensajeDeCarga = 'Cargando…',
  error = '',
  aviso = '',
  textoVacio = 'No hay elementos para elegir.',
}) {
  const unica = modo === 'unica'
  const dialogo = useRef(null)
  const [filtro, setFiltro] = useState('')
  const [temporal, setTemporal] = useState(() => [...seleccion])

  useEffect(() => {
    const el = dialogo.current
    if (!el || el.open) return
    if (typeof el.showModal === 'function') el.showModal()
    else el.open = true
  }, [])

  // El buscador mira el ID, el texto principal y la descripción, sin distinguir mayúsculas.
  const consulta = filtro.trim().toUpperCase()
  const coincide = (id) => !consulta
    || id.toUpperCase().includes(consulta)
    || Boolean(nombres[id] && nombres[id].toUpperCase().includes(consulta))
    || Boolean(etiquetas[id] && etiquetas[id].toUpperCase().includes(consulta))
  const visibles = opciones.filter(coincide)
  const claveSet = new Set(claves)
  const marcadas = new Set(temporal)

  // Lo elegido va fijo ARRIBA, fuera de la lista que se desplaza, y no se repite debajo: con 600
  // opciones, saber cuál está activo no puede obligar a buscarlo. El encabezado NO obedece al buscador
  // (es justo lo que se quiere ver siempre) y quitar algo de ahí lo devuelve a la lista.
  // Múltiple: TODO lo marcado (es lo que se aplica), en el orden en que se marcó. Única: el valor
  // actual, si es una de las opciones.
  const elegidas = unica
    ? (valor !== undefined && valor !== '' && opciones.includes(valor) ? [valor] : [])
    : temporal
  const elegidasSet = new Set(elegidas)
  const enLista = visibles.filter((id) => !elegidasSet.has(id))
  const dibujadas = enLista.slice(0, TOPE_DE_FILAS)
  const elegidasDibujadas = elegidas.slice(0, TOPE_DE_FILAS)
  // «Marcar visibles» cuenta lo que de verdad va a marcar, no lo que ya estaba marcado.
  const porMarcar = visibles.filter((id) => !marcadas.has(id))

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

  const nombreDe = (id) => nombres[id] ?? id
  const descripcionDe = (id) => (etiquetas[id] && etiquetas[id] !== id && etiquetas[id] !== nombreDe(id) ? etiquetas[id] : '')

  // La misma fila en el encabezado de lo elegido y en la lista de abajo.
  const fila = (id) => (unica ? (
    <button
      type="button"
      key={id}
      className={`vs-fila${id === valor ? ' sel' : ''}`}
      onClick={() => onElegir(id)}
    >
      <span className="ef-field-info">
        <span className="ef-field-name">{nombreDe(id)}</span>
        {descripcionDe(id) && <span className="ef-field-desc">{descripcionDe(id)}</span>}
      </span>
      {insignia?.(id)}
    </button>
  ) : (
    <div className="ef-field-item" key={id}>
      <label className="ef-toggle-wrap">
        <input type="checkbox" checked={marcadas.has(id)} onChange={() => alternar(id)} />
        <span className="ef-toggle-slider" />
      </label>
      <div className="ef-field-info">
        <span className="ef-field-name">{nombreDe(id)}</span>
        {descripcionDe(id) && <span className="ef-field-desc">{descripcionDe(id)}</span>}
      </div>
      {insignia?.(id)}
      {claveSet.has(id) && <span className="ef-mandatory-badge">clave</span>}
    </div>
  ))

  return (
    // `onClose` se dispara cuando el navegador cierra el diálogo por su cuenta (Escape): hay que
    // desmontarlo también, o el estado de quien lo usa diría «abierto» sobre un diálogo ya cerrado.
    <dialog ref={dialogo} className="connect-dialog ef-fields-dialog" onClose={onCerrar} aria-label={titulo}>
      <div className="connect-dialog-header">
        <span className="connect-dialog-title">{titulo}</span>
        <button type="button" className="dialog-close-btn" onClick={onCerrar} aria-label="Cerrar">✕</button>
      </div>
      <div className="ef-fields-dialog-body">
        {cabecera && !unica && <div className="vs-cabecera">{cabecera({ opciones, temporal, setTemporal })}</div>}

        <div className="ef-fields-search-wrap">
          <input
            type="text"
            autoFocus
            placeholder="Buscar por ID o descripción..."
            className="ef-fields-search"
            value={filtro}
            onChange={(evento) => setFiltro(evento.target.value)}
            onKeyDown={(evento) => {
              // Como en el desplegable de siempre: Enter elige la primera coincidencia.
              if (unica && evento.key === 'Enter' && visibles.length > 0) {
                evento.preventDefault()
                onElegir(enLista[0] ?? visibles[0])
              }
            }}
          />
          {!unica && (
            <div className="vs-masivas">
              <button type="button" className="vs-enlace" onClick={marcarVisibles} disabled={porMarcar.length === 0}>
                Marcar visibles ({porMarcar.length})
              </button>
              <button type="button" className="vs-enlace" onClick={quitarVisibles} disabled={visibles.length === 0}>
                Quitar visibles
              </button>
            </div>
          )}
        </div>

        {!cargando && elegidas.length > 0 && (
          <div className="vs-elegidas">
            <div className="ef-section-label">{unica ? 'Elegido ahora' : `Seleccionados (${elegidas.length})`}</div>
            {elegidasDibujadas.map(fila)}
            {elegidas.length > elegidasDibujadas.length && (
              <p className="vs-nota">y {elegidas.length - elegidasDibujadas.length} más.</p>
            )}
          </div>
        )}

        <div className="ef-fields-list">
          {cargando && <p className="vs-nota">{mensajeDeCarga}</p>}
          {!cargando && error && <p className="vs-nota vs-nota-aviso">{error}</p>}
          {!cargando && aviso && <p className="vs-nota vs-nota-aviso">{aviso}</p>}

          {!cargando && elegidas.length > 0 && dibujadas.length > 0 && (
            <div className="ef-section-label">{unica ? 'Otras opciones' : 'Disponibles'}</div>
          )}
          {!cargando && dibujadas.map(fila)}

          {!cargando && enLista.length > dibujadas.length && (
            <p className="vs-nota">Se muestran {dibujadas.length} de {enLista.length}. Afina la búsqueda para ver el resto.</p>
          )}
          {!cargando && !error && visibles.length === 0 && (
            <p className="vs-nota">{consulta ? `Sin resultados para "${filtro}".` : textoVacio}</p>
          )}
        </div>

        <div className="ef-fields-footer">
          {/* Cuenta TODA la selección, también lo que el buscador esconde: es lo que se aplica. */}
          <span className="ef-fields-count">
            {!unica && temporal.length > 0 ? `${temporal.length} ${sufijoDeConteo}` : ''}
          </span>
          <div className="btn-row" style={{ margin: 0 }}>
            <button type="button" className="btn btn-secondary" onClick={onCerrar}>Cancelar</button>
            {!unica && (
              <button type="button" className="btn btn-primary" onClick={() => onGuardar(temporal)}>Aplicar</button>
            )}
          </div>
        </div>
      </div>
    </dialog>
  )
}
