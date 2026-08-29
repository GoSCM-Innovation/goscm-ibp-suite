// Network Visualizer — la red logística de un material, con la forma que tenía en v7.
//
// Portado del `tab-visualizer` de `index.html` de v7 y de `visualizer.js`: el paso ① de mapeo, la
// barra de control con el buscador de material, la leyenda que enciende y apaga clases de nodo, el
// lienzo, y el panel de detalle que se abre al pulsar un nodo.
//
// El dibujo lo hace `LienzoDeRed`, con la misma librería y los mismos colores que v7. Lo que vive
// aquí es la secuencia: confirmar el mapeo carga el catálogo de materiales, elegir uno habilita
// «Cargar red logística», y hasta entonces no hay lienzo. Es el orden de v7 y no es decorativo — la
// red de un producto son varias consultas a SAP, y dispararlas al teclear sería una tormenta.

import { useCallback, useMemo, useRef, useState } from 'react'

import LienzoDeRed from './LienzoDeRed.jsx'
import PanelDeRutas from './PanelDeRutas.jsx'
import PanelMapeo from './PanelMapeo.jsx'
import BotonPantallaCompleta from '../ui/BotonPantallaCompleta.jsx'
import { usePantallaCompleta } from '../../lib/usePantallaCompleta.js'
import { ARCOS, CLASES, armarRed, nodosSueltos, vecinosDe } from '../../../core/ibp/supply-network.js'
import { cargarRed, productosConRed } from '../../lib/network-load.js'
import { cargarRedDeSap, productosDeSap } from '../../lib/network-load-sap.js'
import { COLOR_DE_CLASE, NOMBRE_DE_CLASE } from '../../lib/clases-de-red.js'
import { fetchExplorerMap } from '../../lib/ibp-explorer.js'
import { planificarExtraccion } from '../../../core/ibp/explorer-extract-plan.js'

const numero = (valor) => Number(valor ?? 0).toLocaleString('es')

/** Cuántos materiales se ofrecen a la vez en el buscador. Con mil, la lista no se usa. */
const VISIBLES = 40

/** Las cuatro clases que se pueden apagar. El producto no: es de lo que trata el dibujo. */
const APAGABLES = [CLASES.planta, CLASES.ubicacion, CLASES.cliente, CLASES.proveedor]

/** Cómo se nombra cada clase de arco en el detalle. */
const ARCO = {
  [ARCOS.suministro]: 'suministra',
  [ARCOS.fabricacion]: 'fabrica',
  [ARCOS.transporte]: 'transporta a',
  [ARCOS.entrega]: 'entrega a',
}

export default function NetworkVisualizer({ destino }) {
  const [mapeoAbierto, setMapeoAbierto] = useState(true)
  const [confirmado, setConfirmado] = useState(false)

  const [productos, setProductos] = useState(null)
  const [fuente, setFuente] = useState(null)
  const [mapa, setMapa] = useState(null)
  const [error, setError] = useState('')
  const [cargandoCatalogo, setCargandoCatalogo] = useState(false)

  const [busqueda, setBusqueda] = useState('')
  const [listaAbierta, setListaAbierta] = useState(false)
  const [elegido, setElegido] = useState('')

  const [cargando, setCargando] = useState(false)
  const [red, setRed] = useState(null)
  const [marcado, setMarcado] = useState('')
  const [ocultas, setOcultas] = useState(() => new Set())

  const lienzo = useRef(null)
  const pantalla = usePantallaCompleta(lienzo)

  /**
   * ① confirmado: se carga el catálogo de materiales.
   *
   * Primero lo local, que es instantáneo y sin tope. Si no hay nada descargado, se lee de SAP: exigir
   * la descarga completa —casi 3 millones de filas en un tenant real— para dibujar una red de veinte
   * nodos convertía en una hora algo que en v7 era inmediato.
   */
  const cargarCatalogo = useCallback(async () => {
    setCargandoCatalogo(true)
    setError('')
    try {
      const locales = await productosConRed()
      if (locales.length > 0) {
        setProductos(locales)
        setFuente('local')
        return
      }

      const leido = await fetchExplorerMap(destino)
      const plan = planificarExtraccion({
        efectivo: leido.efectivo, mapa: leido.guardado.fields, grupos: ['arbol', 'red'],
      })
      const desdeSap = await productosDeSap({
        conexionId: destino.connectionId, destino, plan, mapa: leido.guardado.fields,
      })
      setMapa({ plan, campos: leido.guardado.fields })
      setProductos(desdeSap)
      setFuente('sap')
    } catch (fallo) {
      setError(fallo.message)
      setProductos([])
    } finally {
      setCargandoCatalogo(false)
    }
  }, [destino])

  const visibles = useMemo(() => {
    const texto = busqueda.trim().toUpperCase()
    const lista = productos ?? []
    return (texto ? lista.filter((uno) => uno.prdid.includes(texto)) : lista).slice(0, VISIBLES)
  }, [productos, busqueda])

  async function cargarLaRed() {
    if (!elegido) return
    setRed(null)
    setMarcado('')
    setError('')
    setCargando(true)

    try {
      const datos = fuente === 'sap'
        ? await cargarRedDeSap({
          conexionId: destino.connectionId, destino, plan: mapa.plan, mapa: mapa.campos, prdid: elegido,
        })
        : await cargarRed(elegido)
      setRed(armarRed(elegido, datos))
    } catch (fallo) {
      setError(fallo.message)
    } finally {
      setCargando(false)
    }
  }

  const sueltos = useMemo(() => nodosSueltos(red?.nodos, red?.arcos), [red])
  const vecinos = useMemo(() => (marcado ? vecinosDe(marcado, red?.arcos) : null), [marcado, red])
  const nodoMarcado = red?.nodos.find((uno) => uno.id === marcado) ?? null
  const nombreDe = (id) => red?.nodos.find((uno) => uno.id === id)?.nombre ?? id

  const alElegirNodo = useCallback((id) => setMarcado(id), [])

  function alternarClase(clase) {
    setOcultas((previas) => {
      const siguientes = new Set(previas)
      if (siguientes.has(clase)) siguientes.delete(clase)
      else siguientes.add(clase)
      return siguientes
    })
  }

  return (
    <>
      {/* ── ① Mapeo de entidades ─────────────────────────────────────────────────────────────── */}
      <PanelMapeo
        grupo="red"
        destino={destino}
        abierto={mapeoAbierto}
        onAlternar={() => setMapeoAbierto((previo) => !previo)}
        textoConfirmar="Confirmar mapeo y cargar materiales"
        confirmando={cargandoCatalogo}
        onConfirmar={() => { setConfirmado(true); setMapeoAbierto(false); cargarCatalogo() }}
      />

      {error && <div className="notice notice-error">✕ {error}</div>}

      {confirmado && cargandoCatalogo && (
        <div className="page-hint">Buscando la red: primero lo descargado, y si no, en SAP…</div>
      )}

      {confirmado && productos !== null && productos.length === 0 && !cargandoCatalogo && (
        <div className="notice notice-info">
          No hay red descargada y tampoco se pudo leer el maestro de productos de SAP. Vuelve al paso
          {' '}<b>① Mapeo de entidades</b>: quizá haya que decirle a mano qué tabla cumple cada papel.
        </div>
      )}

      {confirmado && productos !== null && productos.length > 0 && (
        <div ref={lienzo} className="a-pantalla-completa">
          {/* ── La barra de control ──────────────────────────────────────────────────────────── */}
          <div className="viz-controls-bar">
            <div className="prod-search-group">
              <label style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text3)' }}>
                Material
              </label>
              <div className="ss-wrap" style={{ width: 320 }}>
                <input
                  className="ss-input-vis"
                  value={busqueda}
                  onChange={(evento) => { setBusqueda(evento.target.value); setListaAbierta(true) }}
                  onFocus={() => setListaAbierta(true)}
                  onBlur={() => { setTimeout(() => setListaAbierta(false), 150) }}
                  placeholder="Buscar material..."
                  autoComplete="off"
                  aria-label="Buscar material"
                />
                <div className={`ss-list${listaAbierta && visibles.length > 0 ? ' open' : ''}`}>
                  {visibles.map((uno) => (
                    <button
                      key={uno.prdid}
                      type="button"
                      className={`ss-opt${elegido === uno.prdid ? ' active' : ''}`}
                      onMouseDown={() => {
                        setElegido(uno.prdid)
                        setBusqueda(uno.prdid)
                        setListaAbierta(false)
                        setRed(null)
                      }}
                    >
                      <strong>{uno.prdid}</strong>
                      {uno.prddescr && <span style={{ color: 'var(--text3)' }}> {uno.prddescr}</span>}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary btn-small"
              onClick={cargarLaRed}
              disabled={!elegido || cargando}
            >
              {cargando ? 'Cargando…' : 'Cargar red logística'}
            </button>

            <BotonPantallaCompleta {...pantalla} que="la red" />

            <span style={{ fontSize: 11, color: 'var(--text2)' }}>
              {red
                ? `${numero(red.resumen.nodos)} nodos · ${numero(red.resumen.arcos)} arcos`
                : elegido
                  ? `${elegido} — pulsa «Cargar red logística»`
                  : `${numero(productos.length)} materiales`}
            </span>
          </div>

          {/* ── La leyenda, que además enciende y apaga clases ───────────────────────────────── */}
          <div className="viz-legend">
            {APAGABLES.map((clase) => (
              <label key={clase}>
                <input
                  type="checkbox"
                  checked={!ocultas.has(clase)}
                  onChange={() => alternarClase(clase)}
                />
                <span className="viz-swatch" style={{ background: COLOR_DE_CLASE[clase] }} />
                {NOMBRE_DE_CLASE[clase]}
              </label>
            ))}
            <label style={{ cursor: 'default', opacity: .7 }}>
              <span className="viz-swatch" style={{ background: COLOR_DE_CLASE[CLASES.producto] }} />
              {NOMBRE_DE_CLASE[CLASES.producto]}
            </label>

            {/* La procedencia del dato cambia lo que el dato PUEDE decir, así que se dice siempre:
                leyendo de SAP los arcos de proveedor se topan en 100 componentes por el largo de la
                URL, y leyendo de la base local no. */}
            <span style={{ marginLeft: 'auto', color: 'var(--text3)' }}>
              {fuente === 'sap'
                ? 'Leyendo de SAP en vivo · los arcos de proveedor se topan en 100 componentes'
                : 'Leyendo de lo descargado en este navegador'}
            </span>
          </div>

          {/* ── El detalle del nodo pulsado ──────────────────────────────────────────────────── */}
          {nodoMarcado && (
            <div className="viz-detail">
              <span className="badge badge-main">{NOMBRE_DE_CLASE[nodoMarcado.clase]}</span>
              {' '}
              <strong className="mono">{nodoMarcado.id}</strong>
              {nodoMarcado.nombre && nodoMarcado.nombre !== nodoMarcado.id && (
                <span style={{ color: 'var(--text2)', marginLeft: 8 }}>{nodoMarcado.nombre}</span>
              )}
              {nodoMarcado.plazo && (
                <span style={{ color: 'var(--text3)', marginLeft: 8 }}>Producción: {nodoMarcado.plazo}</span>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 8 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>
                    Le llega de ({vecinos.entran.length})
                  </div>
                  {vecinos.entran.length === 0
                    ? <div style={{ color: 'var(--text3)' }}>—</div>
                    : vecinos.entran.map((arco) => (
                      <div key={arco.id} style={{ fontSize: 11 }}>
                        <span className="mono">{arco.desde}</span>{' '}
                        <span style={{ color: 'var(--text3)' }}>{nombreDe(arco.desde)}</span>
                        {arco.detalle && <span style={{ color: 'var(--text3)' }}> · {arco.detalle}</span>}
                      </div>
                    ))}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>
                    Manda a ({vecinos.salen.length})
                  </div>
                  {vecinos.salen.length === 0
                    ? <div style={{ color: 'var(--text3)' }}>—</div>
                    : vecinos.salen.map((arco) => (
                      <div key={arco.id} style={{ fontSize: 11 }}>
                        <span style={{ color: 'var(--text3)' }}>{ARCO[arco.clase] ?? ''}</span>{' '}
                        <span className="mono">{arco.hasta}</span>{' '}
                        <span style={{ color: 'var(--text3)' }}>{nombreDe(arco.hasta)}</span>
                        {arco.detalle && <span style={{ color: 'var(--text3)' }}> · {arco.detalle}</span>}
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}

          {/* ── El lienzo ───────────────────────────────────────────────────────────────────── */}
          {red
            ? <LienzoDeRed red={red} ocultas={ocultas} alElegir={alElegirNodo} />
            : (
              <div className="viz-canvas empty-state" style={{ height: 260 }}>
                <div className="icon">🔭</div>
                {cargando
                  ? 'Leyendo la red…'
                  : 'Elige un material y pulsa «Cargar red logística».'}
              </div>
            )}

          {/* Las rutas: si lo que sale de cada planta llega a alguien. Es lo que el dibujo no dice. */}
          {red && <PanelDeRutas red={red} nombreDe={nombreDe} />}

          {/* Un nodo suelto en una red de suministro es un dato incompleto, y decirlo es más útil que
              dibujarlo en una esquina. */}
          {red && sueltos.length > 0 && (
            <div className="notice notice-info">
              {sueltos.length === 1
                ? 'Hay 1 nodo sin ningún arco: '
                : `Hay ${sueltos.length} nodos sin ningún arco: `}
              <span className="mono">{sueltos.slice(0, 12).map((uno) => uno.id).join(', ')}</span>
              {sueltos.length > 12 && ` y ${sueltos.length - 12} más`}. No se conectan con nada de esta
              red: o les falta el arco en SAP, o pertenecen a otro producto.
            </div>
          )}
        </div>
      )}
    </>
  )
}
