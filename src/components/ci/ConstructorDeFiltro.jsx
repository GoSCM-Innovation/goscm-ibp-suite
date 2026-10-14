// El filtro de la fuente de datos, como filas en vez de una cadena larga.
//
//     MATTYPEID  EQ  [ZFER] [ZHAW]            ← una fila por campo, con sus valores como fichas
//     ZVIGENTE   EQ  [S]
//     KEYFIGUREDATE  BT  [20261005] [20270412] ← un rango: desde y hasta
//
// Lo que se vio en los bodies reales es `EQ` y `BT`. Se desconoce si el iFlow admite más operadores, así que lo
// que el constructor no entiende NO se toca: queda en una fila de «texto» que se envía tal cual (ver
// `core/ci/filter.js`). Tampoco explica cómo se combinan las condiciones, porque nadie lo ha confirmado: solo
// las muestra en el mismo orden en que se envían.
//
// «Ver como texto» abre la cadena entera para editarla a mano; es la salida para todo lo que las filas no cubren.

import { useState } from 'react'
import { escribirFiltro, leerFiltro, motivoDeValorDeFiltroInvalido } from '../../../core/ci/filter.js'
import { useFilasLocales } from '../../lib/useFilasLocales.js'

/** Parte lo que se pega («A B, C\nD») en valores sueltos. */
const valoresDe = (texto) => String(texto).split(/[\s,]+/).map((uno) => uno.trim()).filter(Boolean)

function Fichas({ valores, onCambiar, deshabilitado }) {
  const [escrito, setEscrito] = useState('')
  const [aviso, setAviso] = useState('')

  function agregar(texto) {
    const nuevos = valoresDe(texto)
    if (nuevos.length === 0) return
    const mala = nuevos.map(motivoDeValorDeFiltroInvalido).find(Boolean)
    if (mala) { setAviso(mala); return }
    setAviso('')
    setEscrito('')
    onCambiar([...valores, ...nuevos])
  }

  return (
    <div className="ci-fichas">
      {valores.map((valor, i) => (
        // El índice es la clave: dos valores pueden repetirse y la ficha no tiene identidad propia.
        <span key={i} className="ci-ficha">
          <span className="mono">{valor}</span>
          {!deshabilitado && (
            <button
              type="button"
              className="ci-ficha-quitar"
              onClick={() => onCambiar(valores.filter((_uno, j) => j !== i))}
              aria-label={`Quitar ${valor}`}
              title="Quitar"
            >
              ×
            </button>
          )}
        </span>
      ))}
      {!deshabilitado && (
        <input
          className="input input-sm ci-ficha-nueva mono"
          value={escrito}
          placeholder="+ valor"
          aria-label="Agregar un valor"
          onChange={(evento) => { setEscrito(evento.target.value); setAviso('') }}
          onKeyDown={(evento) => {
            if (evento.key === 'Enter' || evento.key === ',') { evento.preventDefault(); agregar(escrito) }
            if (evento.key === 'Backspace' && escrito === '' && valores.length > 0) onCambiar(valores.slice(0, -1))
          }}
          onBlur={() => agregar(escrito)}
          onPaste={(evento) => { evento.preventDefault(); agregar(evento.clipboardData.getData('text')) }}
        />
      )}
      {aviso && <span className="ci-aviso-fila">{aviso}</span>}
    </div>
  )
}

export default function ConstructorDeFiltro({ valor, onCambiar, deshabilitado = false }) {
  const [filas, ponerFilas] = useFilasLocales(valor, leerFiltro)
  const [comoTexto, setComoTexto] = useState(false)

  /** Cambia las filas y avisa del texto que resulta. */
  function cambiarFilas(nuevas) {
    const texto = escribirFiltro(nuevas)
    ponerFilas(nuevas, texto)
    onCambiar(texto)
  }

  const cambiarFila = (i, cambios) => cambiarFilas(filas.map((fila, j) => (j === i ? { ...fila, ...cambios } : fila)))
  const quitarFila = (i) => cambiarFilas(filas.filter((_fila, j) => j !== i))
  const agregarFila = (fila) => cambiarFilas([...filas, { id: `nuevo-${filas.length}`, ...fila }])

  return (
    <div className="ci-filtro">
      <div className="ci-filtro-cabeza">
        <span className="card-hint">
          {filas.length === 0 ? 'Sin filtro: se lee todo lo que entregue la fuente.' : `${filas.length} ${filas.length === 1 ? 'fila' : 'filas'}`}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setComoTexto((v) => !v)}>
          {comoTexto ? 'Ver como filas' : 'Ver como texto'}
        </button>
      </div>

      {comoTexto ? (
        <textarea
          className="input mono ci-texto-largo"
          rows={4}
          value={valor ?? ''}
          disabled={deshabilitado}
          aria-label="Filtro como texto"
          onChange={(evento) => onCambiar(evento.target.value)}
        />
      ) : (
        <>
          {filas.map((fila, i) => (
            // El índice es la clave: las filas se recalculan desde el texto y sus identificadores cambian.
            <div key={i} className="ci-filtro-fila">
              {fila.tipo === 'texto' ? (
                <>
                  <input
                    className="input input-sm mono ci-filtro-texto"
                    value={fila.texto}
                    disabled={deshabilitado}
                    aria-label="Condición escrita a mano"
                    onChange={(evento) => cambiarFila(i, { texto: evento.target.value })}
                  />
                  <span className="card-hint">No reconocida por el constructor: se envía tal cual.</span>
                </>
              ) : (
                <>
                  <input
                    className="input input-sm mono ci-filtro-campo"
                    value={fila.campo}
                    placeholder="CAMPO"
                    disabled={deshabilitado}
                    aria-label="Campo"
                    onChange={(evento) => cambiarFila(i, { campo: evento.target.value.trim() })}
                  />
                  <span className="ci-filtro-op mono">{fila.tipo === 'entre' ? 'BT' : 'EQ'}</span>
                  {fila.tipo === 'entre' ? (
                    <>
                      <input
                        className="input input-sm mono ci-filtro-valor"
                        value={fila.desde}
                        placeholder="desde"
                        disabled={deshabilitado}
                        aria-label="Desde"
                        onChange={(evento) => cambiarFila(i, { desde: evento.target.value.trim() })}
                      />
                      <input
                        className="input input-sm mono ci-filtro-valor"
                        value={fila.hasta}
                        placeholder="hasta"
                        disabled={deshabilitado}
                        aria-label="Hasta"
                        onChange={(evento) => cambiarFila(i, { hasta: evento.target.value.trim() })}
                      />
                    </>
                  ) : (
                    <Fichas valores={fila.valores} deshabilitado={deshabilitado} onCambiar={(valores) => cambiarFila(i, { valores })} />
                  )}
                </>
              )}
              {!deshabilitado && (
                <button type="button" className="btn btn-ghost btn-sm ci-quitar" onClick={() => quitarFila(i)} title="Quitar la fila" aria-label="Quitar la fila">
                  ✕
                </button>
              )}
            </div>
          ))}

          {!deshabilitado && (
            <div className="ci-filtro-agregar">
              <button type="button" className="btn btn-sm" onClick={() => agregarFila({ tipo: 'igual', campo: '', valores: [] })}>
                + Campo = valores
              </button>
              <button type="button" className="btn btn-sm" onClick={() => agregarFila({ tipo: 'entre', campo: '', desde: '', hasta: '' })}>
                + Rango (BT)
              </button>
            </div>
          )}
        </>
      )}

      {valor && !comoTexto && <div className="ci-filtro-vista mono" title="Lo que se envía">{valor}</div>}
    </div>
  )
}
