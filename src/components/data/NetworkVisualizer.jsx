// Network Visualizer — la red logística de un material, idéntica a la de v7.
//
// Portado del `tab-visualizer` de `index.html` de v7 y de `visualizer.js`. La secuencia es la suya y
// no es decorativa: confirmar el mapeo carga el catálogo de materiales, elegir uno habilita «Cargar red
// logística», y hasta entonces no hay lienzo. La red de un producto son varias consultas a SAP, y
// dispararlas al teclear sería una tormenta.
//
// El dibujo lo hace `LienzoDeRed`, con la misma librería y los mismos colores que v7. Lo que vive aquí
// es el estado de la pantalla: la barra de control, la franja de carga, el detalle del nodo, los
// filtros, la pantalla completa y las rutas — y que todo eso se llame, se diga y se pliegue como en v7.
//
// DECISIÓN DEL USUARIO (2026-10-01): «Data Tools tiene que ser idéntico a v7». Lo que esta pantalla
// tenía y v7 no —el nodo «Producto», el aviso de nodos sueltos, «Le llega de / Manda a», leer primero
// de lo descargado— se quitó. Las diferencias que quedan, con su motivo, están junto al código y en
// `docs/PARIDAD-DATA-TOOLS.md`.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import DetalleDeNodo from './DetalleDeNodo.jsx'
import EstadoConRegistro, { ListaDeRegistro } from './EstadoConRegistro.jsx'
import FiltrosDeRed from './FiltrosDeRed.jsx'
import LeyendaDeRed from './LeyendaDeRed.jsx'
import LienzoDeRed from './LienzoDeRed.jsx'
import PanelDeRutas from './PanelDeRutas.jsx'
import PanelMapeo from './PanelMapeo.jsx'
import PantallaCompletaDeRed from './PantallaCompletaDeRed.jsx'
import {
  TODAS_VISIBLES, armarRed, clientesParaFiltro, clientesQueSobran, rutasDeLaRed, ubicacionesParaFiltro,
} from '../../../core/ibp/supply-network.js'
import { cargarRedDeSap, planDeLaRed, productosDeSap } from '../../lib/network-load-sap.js'
import { descargarTexto } from '../../lib/descargar-csv.js'
import { linea } from '../../lib/registro-de-descarga.js'
import { csvDeRutas, nombreDelCsv, trazaDeRuta } from '../../lib/rutas-de-red.js'
import { buscarMateriales } from '../../lib/buscar-material.js'

const RUTAS_DE_INICIO = { tipo: 'todas', final: 'todos', q: '' }

export default function NetworkVisualizer({ destino }) {
  const [mapeoAbierto, setMapeoAbierto] = useState(true)

  // ① El catálogo de materiales.
  const [catalogo, setCatalogo] = useState(null)
  const [descargando, setDescargando] = useState(false)
  const [progreso, setProgreso] = useState(null)
  const [registroCatalogo, setRegistroCatalogo] = useState([])
  const [logsCatalogo, setLogsCatalogo] = useState(false)
  // Qué tabla es cada papel en este tenant, para pedir la red de un material.
  const mapa = useRef(null)

  // El buscador de material.
  const [busqueda, setBusqueda] = useState('')
  const [listaAbierta, setListaAbierta] = useState(false)
  const [elegido, setElegido] = useState('')
  const cajaDeBusqueda = useRef(null)

  // La red cargada.
  const [cargando, setCargando] = useState(false)
  const [cargado, setCargado] = useState(null) // { prdid, filas }: «VIZ_DATA» de v7
  const [red, setRed] = useState(null)
  const [vacio, setVacio] = useState(false)
  const [estado, setEstado] = useState('')
  const [franja, setFranja] = useState(null)
  const [registroRed, setRegistroRed] = useState([])
  const [logsRed, setLogsRed] = useState(false)
  const [filtrable, setFiltrable] = useState(false)
  const [conPantalla, setConPantalla] = useState(false)

  // Lo que se enciende y se apaga.
  const [visibles, setVisibles] = useState(TODAS_VISIBLES)
  const [ubicacionesOcultas, setUbicacionesOcultas] = useState(() => new Set())
  const [clientesOcultos, setClientesOcultos] = useState(() => new Set())
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false)

  // El detalle, las rutas y la pantalla completa.
  const [detalle, setDetalle] = useState(null)
  const [analisis, setAnalisis] = useState(null)
  const [filtroRutas, setFiltroRutas] = useState(RUTAS_DE_INICIO)
  const [seleccion, setSeleccion] = useState(null)
  const [pantalla, setPantalla] = useState(null)
  const lienzo = useRef(null)

  const anotarCatalogo = useCallback(
    (clase, texto) => setRegistroCatalogo((previas) => [...previas, linea(clase, texto)]),
    [],
  )
  const anotarRed = useCallback(
    (clase, texto) => setRegistroRed((previas) => [...previas, linea(clase, texto)]),
    [],
  )

  // La lista de sugerencias se cierra al pulsar fuera, como en v7.
  useEffect(() => {
    const alPulsar = (evento) => {
      if (cajaDeBusqueda.current && !cajaDeBusqueda.current.contains(evento.target)) setListaAbierta(false)
    }
    document.addEventListener('click', alPulsar)
    return () => document.removeEventListener('click', alPulsar)
  }, [])

  /**
   * «Confirmar mapeo y cargar productos»: descarga el catálogo de materiales.
   *
   * Es `vizConfirmMapping` de v7: barra al 5 %, la petición de los productos, y al terminar el estado
   * «✓ N materiales listos…» al 100 % con los controles de abajo ya a la vista. El panel ① se pliega
   * solo si salió bien, como allí.
   */
  const confirmarMapeo = useCallback(async (efectivo, mapaDelTenant) => {
    setDescargando(true)
    setRegistroCatalogo([])
    setLogsCatalogo(false)
    setProgreso({ porcentaje: 5, texto: 'Descargando catálogo de productos…' })

    try {
      const campos = mapaDelTenant?.guardado?.fields ?? {}
      const plan = planDeLaRed(efectivo, campos)
      // Lo que este tenant no tiene (una tabla, un campo) queda escrito en los logs. v7 lo resolvía
      // con su panel de corrección de campos; aquí al menos no pasa en silencio.
      for (const aviso of plan.avisos) anotarCatalogo('warn', aviso)
      const productos = await productosDeSap({
        conexionId: destino.connectionId, destino, plan, mapa: campos, onRegistro: anotarCatalogo,
      })

      mapa.current = { plan, campos }
      setCatalogo(productos)
      setVacio(true)
      setProgreso({
        porcentaje: 100,
        texto: `✓ ${productos.length} materiales listos — selecciona uno y haz click en "Cargar red logística"`,
      })
      setMapeoAbierto(false)
    } catch (fallo) {
      setProgreso({ porcentaje: 0, texto: `✕ Error: ${fallo.message}` })
      anotarCatalogo('err', `✕ ${fallo.message}`)
    } finally {
      setDescargando(false)
    }
  }, [destino, anotarCatalogo])

  const sugerencias = useMemo(
    () => (listaAbierta ? buscarMateriales(catalogo, busqueda) : []),
    [catalogo, busqueda, listaAbierta],
  )

  /** Los nombres de los materiales, para los chips del detalle de un proveedor. */
  const descripciones = useMemo(
    () => Object.fromEntries((catalogo ?? []).map((uno) => [uno.prdid, uno.descripcion])),
    [catalogo],
  )

  function elegirMaterial(prdid) {
    setBusqueda(prdid)
    setElegido(prdid)
    setListaAbierta(false)
    // Como en v7, elegir otro material descarta los datos de la red cargada: lo dibujado se queda,
    // pero los filtros y la pantalla completa ya no tienen de dónde reconstruir hasta que se cargue.
    setCargado(null)
    setEstado(`Material: ${prdid} — haz click en "Cargar red logística"`)
  }

  /** Arma el grafo con el estado actual, o con lo que se le cambie. */
  const armar = useCallback((cambios = {}) => armarRed(cargado.prdid, cargado.filas, {
    visibles,
    ubicacionesOcultas,
    clientesOcultos,
    ...cambios,
  }), [cargado, visibles, ubicacionesOcultas, clientesOcultos])

  /**
   * «Cargar red logística»: lo que hacía `vizLoadNetwork`.
   *
   * Reinicia leyenda y filtros, lee la red de SAP, aplica el ocultado automático de clientes, dibuja y
   * calcula las rutas. El panel ① se pliega al terminar.
   */
  async function cargarLaRed() {
    const prdid = elegido
    if (!prdid) return

    setAnalisis(null)
    setFiltroRutas(RUTAS_DE_INICIO)
    setSeleccion(null)
    setPantalla(null)
    setVisibles(TODAS_VISIBLES)
    setUbicacionesOcultas(new Set())
    setClientesOcultos(new Set())
    setRegistroRed([])
    setLogsRed(false)
    setFranja(`Procesando red de ${prdid}…`)
    setCargando(true)
    setDetalle(null)
    setVacio(false)
    setEstado(`⏳ Cargando ${prdid}…`)
    setConPantalla(false)
    anotarRed('info', `▶ Cargando red para: ${prdid}`)

    try {
      const filas = await cargarRedDeSap({
        conexionId: destino.connectionId,
        destino,
        plan: mapa.current.plan,
        mapa: mapa.current.campos,
        prdid,
        onRegistro: anotarRed,
      })
      setCargado({ prdid, filas })

      // Si hay más de 20 clientes, se ocultan los que sobran y se avisa.
      const sobran = clientesQueSobran(filas)
      const ocultos = new Set(sobran)
      setClientesOcultos(ocultos)

      const nueva = armarRed(prdid, filas, { visibles: TODAS_VISIBLES, clientesOcultos: ocultos })
      setRed(nueva)

      const resumen = `${nueva.resumen.nodos} nodos · ${nueva.resumen.arcos} conexiones`
      setFranja(`✓ ${resumen}`)
      setEstado(sobran.length > 0
        ? `${resumen} — ${sobran.length} clientes ocultos automáticamente. Usa ▼ Filtros para ajustar.`
        : resumen)
      setConPantalla(true)
      setFiltrable(true)
      anotarRed('ok', `✓ Diagrama: ${resumen}`)

      try {
        setAnalisis(rutasDeLaRed(filas))
      } catch (fallo) {
        anotarRed('warn', `⚠ Panel Rutas: ${fallo.message}`)
      }
      setMapeoAbierto(false)
    } catch (fallo) {
      setFranja(`✕ Error: ${fallo.message}`)
      setEstado(`✕ Error: ${fallo.message}`)
      anotarRed('err', `✕ Error: ${fallo.message}`)
    } finally {
      setCargando(false)
    }
  }

  /** «⊟ Compactar»: reconstruye el grafo para reordenar las posiciones. */
  function compactar() {
    if (!cargado) return
    setSeleccion(null)
    setRed(armar())
  }

  /** «Aplicar» de los filtros: guarda lo apagado y reconstruye. */
  function aplicarFiltros(ubicaciones, clientes) {
    setUbicacionesOcultas(ubicaciones)
    setClientesOcultos(clientes)
    setFiltrosAbiertos(false)
    setSeleccion(null)
    if (cargado) setRed(armar({ ubicacionesOcultas: ubicaciones, clientesOcultos: clientes }))
  }

  function limpiarFiltros() {
    aplicarFiltros(new Set(), new Set())
  }

  function abrirFiltros() {
    if (cargado) setFiltrosAbiertos(true)
  }

  function abrirPantalla() {
    if (!cargado) return
    setSeleccion(null)
    setPantalla({ red: armar() })
  }

  function compactarPantalla() {
    if (cargado) setPantalla({ red: armar() })
  }

  function cambiarVisible(clase, visible) {
    setVisibles((previas) => ({ ...previas, [clase]: visible }))
  }

  /**
   * Un clic en una fila de «Rutas»: resalta la ruta en el grafo (`vizRutasHighlight`).
   *
   * Si algún nodo de la ruta estaba apagado en los filtros, se enciende y se reconstruye el grafo —los
   * nodos apagados no existen en él—, y después se selecciona.
   */
  function resaltar(indice) {
    const ruta = analisis?.rutas[indice]
    if (!ruta) return
    const traza = trazaDeRuta(ruta)

    const ubicaciones = new Set(ubicacionesOcultas)
    const clientes = new Set(clientesOcultos)
    let cambio = false
    for (const id of traza.nodos) {
      if (ubicaciones.delete(id)) cambio = true
      if (clientes.delete(id)) cambio = true
    }

    if (cambio && cargado) {
      setUbicacionesOcultas(ubicaciones)
      setClientesOcultos(clientes)
      const filtros = { ubicacionesOcultas: ubicaciones, clientesOcultos: clientes }
      setRed(armar(filtros))
      if (pantalla) setPantalla({ red: armar(filtros) })
    }

    // Un objeto nuevo en cada clic: pulsar la misma ruta dos veces la vuelve a resaltar.
    setSeleccion({ ...traza })
  }

  function exportarRutas() {
    if (!analisis || analisis.rutas.length === 0) return
    // Sin marca de codificación y con coma, como en v7: es el formato que sus hojas ya esperan.
    descargarTexto(csvDeRutas(analisis.rutas), nombreDelCsv(cargado?.prdid ?? red?.producto), 'text/csv')
  }

  const alFiltrarRutas = useCallback(
    (cambios) => setFiltroRutas((previo) => ({ ...previo, ...cambios })),
    [],
  )

  const totalOcultos = ubicacionesOcultas.size + clientesOcultos.size
  const nodoDelDetalle = detalle && red ? red.nodos.find((uno) => uno.id === detalle) : null

  return (
    <>
      {/* ── ① Mapeo de entidades ─────────────────────────────────────────────────────────────── */}
      <PanelMapeo
        variante="nv"
        destino={destino}
        abierto={mapeoAbierto}
        onAlternar={() => setMapeoAbierto((previo) => !previo)}
        textoConfirmar="Confirmar mapeo y cargar productos"
        confirmando={descargando}
        onConfirmar={confirmarMapeo}
      >
        {progreso && (
          <EstadoConRegistro
            porcentaje={progreso.porcentaje}
            texto={progreso.texto}
            registro={registroCatalogo}
            abierto={logsCatalogo}
            onAlternar={() => setLogsCatalogo((previo) => !previo)}
          />
        )}
      </PanelMapeo>

      {catalogo && (
        <div className="nv-pagina">
          {/* ── La barra de control: el buscador de material y los botones ─────────────────────── */}
          <div className="nv-barra">
            <span className="nv-barra-rotulo">Material</span>
            <div className="ss-wrap nv-barra-buscador" ref={cajaDeBusqueda}>
              <input
                className="ss-input-vis"
                type="text"
                value={busqueda}
                onChange={(evento) => { setBusqueda(evento.target.value); setListaAbierta(true) }}
                placeholder="Buscar material..."
                autoComplete="off"
                aria-label="Buscar material"
              />
              <div className={`ss-list${sugerencias.length > 0 ? ' open' : ''}`}>
                {sugerencias.map((uno) => (
                  <div
                    key={uno.prdid}
                    className="ss-opt"
                    role="option"
                    aria-selected={elegido === uno.prdid}
                    onClick={() => elegirMaterial(uno.prdid)}
                  >
                    <strong>{uno.prdid}</strong>
                    {uno.descripcion && (<>{' '}<span style={{ color: 'var(--text3)' }}>{uno.descripcion}</span></>)}
                  </div>
                ))}
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary btn-small nv-cargar"
              onClick={cargarLaRed}
              disabled={!elegido || cargando}
              style={{ opacity: !elegido ? 0.5 : (cargando ? 0.7 : 1) }}
            >
              {cargando ? '⏳ Cargando...' : 'Cargar red logística'}
            </button>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => lienzo.current?.ajustar()}>
              ⊞ Ajustar
            </button>
            <button type="button" className="btn btn-secondary btn-small" onClick={compactar}>
              ⊟ Compactar
            </button>
            {filtrable && (
              <button
                type="button"
                className={`btn btn-secondary btn-small${totalOcultos > 0 ? ' nv-filtros-activos' : ''}`}
                onClick={abrirFiltros}
              >
                {totalOcultos > 0 ? `▼ Filtros (${totalOcultos})` : '▼ Filtros'}
              </button>
            )}
            {conPantalla && (
              <button type="button" className="btn btn-secondary btn-small" onClick={abrirPantalla}>
                ⛶ Pantalla completa
              </button>
            )}
            <span className="nv-barra-estado" title={estado}>{estado}</span>
          </div>

          {/* ── La franja de carga y sus logs ──────────────────────────────────────────────────── */}
          {franja !== null && (
            <>
              <div className="nv-franja">
                <span className="nv-franja-texto">{franja}</span>
                <button
                  type="button"
                  className="btn btn-secondary btn-small prog-logs-btn"
                  onClick={() => setLogsRed((previo) => !previo)}
                >
                  {logsRed ? 'Ocultar logs' : 'Ver logs técnicos'}
                </button>
              </div>
              {logsRed && <ListaDeRegistro registro={registroRed} />}
            </>
          )}

          {/* ── El detalle del nodo pulsado ────────────────────────────────────────────────────── */}
          {nodoDelDetalle && (
            <div className="nv-detalle">
              <div className="nv-detalle-cabecera">
                <span className="nv-detalle-rotulo">Seleccionado</span>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  className="btn btn-secondary btn-small nv-detalle-cerrar"
                  onClick={() => setDetalle(null)}
                  aria-label="Cerrar detalle"
                >
                  ✕
                </button>
              </div>
              <div className="nv-detalle-cuerpo">
                <DetalleDeNodo nodo={nodoDelDetalle} filas={cargado?.filas} descripciones={descripciones} />
              </div>
            </div>
          )}

          {/* ── La leyenda y el lienzo ─────────────────────────────────────────────────────────── */}
          <div className="nv-lienzo-caja">
            <LeyendaDeRed visibles={visibles} onCambiar={cambiarVisible} />
            {vacio && (
              <div className="nv-vacio empty-state">
                <div className="icon">🔭</div>
                <p>Busca un material para visualizar su red logística</p>
              </div>
            )}
            {red
              ? (
                <LienzoDeRed
                  ref={lienzo}
                  red={red}
                  visibles={visibles}
                  seleccion={seleccion}
                  alElegir={setDetalle}
                />
              )
              : <div className="nv-lienzo" />}
          </div>

          {/* ── Las rutas ──────────────────────────────────────────────────────────────────────── */}
          {analisis && (
            <PanelDeRutas
              analisis={analisis}
              filtro={filtroRutas}
              onFiltro={alFiltrarRutas}
              onResaltar={resaltar}
              onExportar={exportarRutas}
            />
          )}
        </div>
      )}

      {filtrosAbiertos && cargado && (
        <FiltrosDeRed
          ubicaciones={ubicacionesParaFiltro(cargado.filas)}
          clientes={clientesParaFiltro(cargado.filas)}
          ubicacionesOcultas={ubicacionesOcultas}
          clientesOcultos={clientesOcultos}
          onAplicar={aplicarFiltros}
          onLimpiar={limpiarFiltros}
          onCerrar={() => setFiltrosAbiertos(false)}
        />
      )}

      {pantalla && cargado && (
        <PantallaCompletaDeRed
          producto={cargado.prdid}
          red={pantalla.red}
          filas={cargado.filas}
          descripciones={descripciones}
          visibles={visibles}
          onVisibles={cambiarVisible}
          seleccion={seleccion}
          analisis={analisis}
          filtroRutas={filtroRutas}
          onFiltroRutas={alFiltrarRutas}
          onResaltar={resaltar}
          onExportar={exportarRutas}
          onCompactar={compactarPantalla}
          onCerrar={() => setPantalla(null)}
        />
      )}
    </>
  )
}
