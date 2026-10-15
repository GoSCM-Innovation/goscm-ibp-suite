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
//
// Con `ibp` (una función para saber si un campo es de IBP y otra para leer sus valores) cada fila «campo = valores»
// ofrece «Valores de IBP»: se eligen de los que IBP tiene para ese campo. Escribirlos a mano sigue siendo posible, y
// un campo que no es de IBP (los del filtro suelen ser del sistema de origen) no ofrece nada.

import { useRef, useState } from 'react'
import { escribirFiltro, leerFiltro, motivoDeValorDeFiltroInvalido } from '../../../core/ci/filter.js'
import { valoresParaFiltro } from '../../lib/ci-ibp.js'
import { deFechaDelCalendario, esCampoDeFecha } from '../../lib/fechas.js'
import { useFilasLocales } from '../../lib/useFilasLocales.js'
import VentanaDeSeleccion from '../ui/VentanaDeSeleccion.jsx'
import CampoDeFecha from './CampoDeFecha.jsx'

/** Parte lo que se pega («A B, C\nD») en valores sueltos. */
const valoresDe = (texto) => String(texto).split(/[\s,]+/).map((uno) => uno.trim()).filter(Boolean)

function Fichas({ valores, onCambiar, deshabilitado, conFecha = false }) {
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
      {/* Las fechas se agregan con un calendario: al elegir una, entra como una ficha más. */}
      {!deshabilitado && conFecha && (
        <input
          type="date"
          className="input input-sm mono"
          value=""
          aria-label="Agregar una fecha"
          onChange={(evento) => { const fecha = deFechaDelCalendario(evento.target.value); if (fecha) onCambiar([...valores, fecha]) }}
        />
      )}
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

/** Lo que se avisa en la ventana de valores de IBP: lo que dijo el servidor, lo descartado y si la lista está recortada. */
function avisoDeValores({ motivo, truncado }, descartados) {
  return [
    motivo,
    descartados > 0 ? `${descartados} ${descartados === 1 ? 'valor no se ofrece' : 'valores no se ofrecen'}: llevan comillas simples o comas, que cortarían el filtro.` : '',
    truncado ? 'La lista está recortada: escribe a mano los que falten.' : '',
  ].filter(Boolean).join(' ')
}

export default function ConstructorDeFiltro({ valor, onCambiar, deshabilitado = false, ibp = null }) {
  const [filas, ponerFilas] = useFilasLocales(valor, leerFiltro)
  const [comoTexto, setComoTexto] = useState(false)
  // La ventana de valores de IBP: qué fila y qué se leyó. `peticion` descarta una respuesta que llega tarde.
  const [ventana, setVentana] = useState(null)
  const peticion = useRef(0)

  async function abrirValores(indice, campo) {
    const esta = peticion.current + 1
    peticion.current = esta
    setVentana({ fila: indice, campo, cargando: true, valores: [], aviso: '', error: '' })
    try {
      const leido = await ibp.leer(campo)
      if (peticion.current !== esta) return
      const { usables, descartados } = valoresParaFiltro(leido.valores)
      setVentana((actual) => actual && { ...actual, cargando: false, valores: usables, aviso: avisoDeValores(leido, descartados) })
    } catch (fallo) {
      if (peticion.current === esta) setVentana((actual) => actual && { ...actual, cargando: false, error: fallo.message })
    }
  }

  function cerrarValores() {
    peticion.current += 1
    setVentana(null)
  }

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
                    esCampoDeFecha(fila.campo) ? (
                      // La fecha del periodo se elige en un calendario (o se deja como variable, que se pide al ejecutar).
                      <>
                        <CampoDeFecha valor={fila.desde} ariaLabel="Desde" deshabilitado={deshabilitado} onCambiar={(desde) => cambiarFila(i, { desde })} />
                        <CampoDeFecha valor={fila.hasta} ariaLabel="Hasta" deshabilitado={deshabilitado} onCambiar={(hasta) => cambiarFila(i, { hasta })} />
                      </>
                    ) : (
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
                    )
                  ) : (
                    <Fichas
                      valores={fila.valores}
                      deshabilitado={deshabilitado}
                      conFecha={esCampoDeFecha(fila.campo)}
                      onCambiar={(valores) => cambiarFila(i, { valores })}
                    />
                  )}
                  {!deshabilitado && ibp && fila.tipo === 'igual' && fila.campo !== '' && ibp.puede(fila.campo) !== false && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => abrirValores(i, fila.campo)}
                      aria-label={`Valores de IBP de ${fila.campo}`}
                      title="Elegir entre los valores que IBP tiene para este campo"
                    >
                      Valores de IBP
                    </button>
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
              <button
                type="button"
                className="btn btn-sm"
                title="Un rango de fechas del periodo (KEYFIGUREDATE), con calendario"
                onClick={() => agregarFila({ tipo: 'entre', campo: 'KEYFIGUREDATE', desde: '', hasta: '' })}
              >
                + Rango de fechas
              </button>
            </div>
          )}
        </>
      )}

      {valor && !comoTexto && <div className="ci-filtro-vista mono" title="Lo que se envía">{valor}</div>}

      {ventana && (
        <VentanaDeSeleccion
          titulo={`Valores de ${ventana.campo}`}
          opciones={ventana.valores}
          seleccion={filas[ventana.fila]?.valores ?? []}
          sufijoDeConteo="valor(es) seleccionado(s)"
          cargando={ventana.cargando}
          mensajeDeCarga="Leyendo los valores de IBP… puede tardar unos segundos."
          error={ventana.error}
          aviso={ventana.aviso}
          textoVacio="IBP no tiene valores para este campo."
          onGuardar={(elegidos) => { cambiarFila(ventana.fila, { valores: elegidos }); cerrarValores() }}
          onCerrar={cerrarValores}
        />
      )}
    </div>
  )
}
