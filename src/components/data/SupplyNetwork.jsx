// La red de suministro de un producto, en columnas de origen a destino.
//
// Portado de `visualizer.js` de v7. El grafo lo arma `core/ibp/supply-network.js` con sus pruebas;
// aquí se dibuja.
//
// v7 usaba `vis-network` traído de un CDN y colocaba los nodos con un algoritmo de baricentros para
// reducir cruces. Aquí se dibujan COLUMNAS: proveedores, plantas, ubicaciones, el producto y los
// clientes, cada clase en la suya, y los arcos como una lista al lado. Es una decisión, no una
// simplificación: una red de suministro se lee de izquierda a derecha —de dónde entra, por dónde pasa,
// a quién sale— y un lienzo con nodos arrastrables invita a moverlos, que es justo lo que hace que dos
// personas mirando el mismo dato vean dibujos distintos.
//
// Los arcos se listan además de dibujarse porque en una red real son decenas, y «¿de dónde le llega a
// esta planta?» se contesta antes leyendo una lista que persiguiendo flechas.

import { useEffect, useMemo, useState } from 'react'

import {
  ARCOS, CLASES, armarRed, nodosSueltos, repartirEnColumnas, vecinosDe,
} from '../../../core/ibp/supply-network.js'
import { cargarRed, productosConRed } from '../../lib/network-load.js'

const numero = (valor) => Number(valor ?? 0).toLocaleString('es')

/** Cuántos productos se ofrecen a la vez. */
const VISIBLES = 60

/** El icono y el nombre de cada clase. Se lee antes que el texto. */
const CLASE = {
  [CLASES.proveedor]: { icono: '🚚', label: 'Proveedor' },
  [CLASES.planta]: { icono: '🏭', label: 'Planta' },
  [CLASES.ubicacion]: { icono: '🏬', label: 'Ubicación' },
  [CLASES.producto]: { icono: '⭐', label: 'Producto' },
  [CLASES.cliente]: { icono: '🛒', label: 'Cliente' },
}

/** Cómo se nombra cada clase de arco. */
const ARCO = {
  [ARCOS.suministro]: 'suministra',
  [ARCOS.fabricacion]: 'fabrica',
  [ARCOS.transporte]: 'transporta a',
  [ARCOS.entrega]: 'entrega a',
}

export default function SupplyNetwork() {
  const [productos, setProductos] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [error, setError] = useState('')

  const [elegido, setElegido] = useState('')
  const [cargando, setCargando] = useState(false)
  const [red, setRed] = useState(null)
  const [marcado, setMarcado] = useState('')

  useEffect(() => {
    let abandonado = false

    productosConRed()
      .then((lista) => { if (!abandonado) setProductos(lista) })
      .catch((fallo) => { if (!abandonado) { setError(fallo.message); setProductos([]) } })

    return () => { abandonado = true }
  }, [])

  const visibles = useMemo(() => {
    const texto = busqueda.trim().toUpperCase()
    const lista = productos ?? []
    return (texto ? lista.filter((uno) => uno.prdid.includes(texto)) : lista).slice(0, VISIBLES)
  }, [productos, busqueda])

  async function abrir(prdid) {
    setElegido(prdid)
    setRed(null)
    setMarcado('')
    setError('')
    setCargando(true)

    try {
      const datos = await cargarRed(prdid)
      setRed(armarRed(prdid, datos))
    } catch (fallo) {
      setError(fallo.message)
    } finally {
      setCargando(false)
    }
  }

  const columnas = useMemo(() => repartirEnColumnas(red?.nodos), [red])
  const sueltos = useMemo(() => nodosSueltos(red?.nodos, red?.arcos), [red])
  const vecinos = useMemo(
    () => (marcado ? vecinosDe(marcado, red?.arcos) : null),
    [marcado, red],
  )

  const nombreDe = (id) => red?.nodos.find((uno) => uno.id === id)?.nombre ?? id

  if (productos === null) return <div className="page-hint">Leyendo lo que hay descargado…</div>

  if (productos.length === 0) {
    return (
      <div className="module-body">
        {error
          ? <div className="notice notice-error">✕ {error}</div>
          : (
            <div className="notice notice-info">
              No hay red descargada. Andá a <b>Descargar</b> y bajá el grupo «Red de suministro»; esta
              pantalla trabaja sobre lo que quedó guardado en este navegador.
            </div>
          )}
      </div>
    )
  }

  return (
    <div className="module-body">
      {error && <div className="notice notice-error">✕ {error}</div>}

      <div className="tablero">
        <div className="card">
          <div className="card-label">
            Producto
            <span className="exp-sub">{numero(productos.length)} con red</span>
          </div>

          <input
            className="input input-sm"
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
            placeholder="Buscar por código"
            aria-label="Buscar un producto"
          />

          <div className="bom-lista">
            {visibles.map((uno) => (
              <button
                key={uno.prdid}
                type="button"
                className={`bom-opcion${elegido === uno.prdid ? ' active' : ''}`}
                onClick={() => abrir(uno.prdid)}
              >
                <span className="mono">{uno.prdid}</span>
                <span className="exp-sub">
                  {uno.plantas > 0 && `${uno.plantas} 🏭 `}
                  {uno.arcos > 0 && `${uno.arcos} 🏬 `}
                  {uno.clientes > 0 && `${uno.clientes} 🛒`}
                </span>
              </button>
            ))}
            {visibles.length === 0 && <div className="sin-datos">Ninguno coincide</div>}
          </div>

          {productos.length > visibles.length && (
            <div className="exp-sub">
              Se ven {visibles.length} de {numero(productos.length)}; buscá para acotar.
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-label">Cómo leer esto</div>
          <p className="exp-sub">
            La red se lee de izquierda a derecha: de dónde entra el material, dónde se fabrica, por
            dónde pasa y a quién se entrega. Es la red <b>de este producto</b>, no la del tenant.
          </p>
          <div className="bom-leyenda">
            {Object.values(CLASE).map((una) => (
              <span key={una.label}>{una.icono} {una.label}</span>
            ))}
          </div>
          <p className="exp-sub">
            Un proveedor solo aparece si trae un material que de verdad está en la receta de esa
            planta. Sin esa regla, cualquier proveedor del tenant cuelga de cualquier planta.
          </p>
        </div>
      </div>

      {cargando && <div className="page-hint">Armando la red de {elegido}…</div>}

      {red && red.nodos.length <= 1 && (
        <div className="notice notice-info">
          {elegido} no tiene red: ni plantas que lo fabriquen, ni arcos, ni clientes en lo descargado.
        </div>
      )}

      {red && red.nodos.length > 1 && (
        <>
          <div className="monitor-bar">
            <span className="page-hint">
              {numero(red.resumen.nodos)} nodos · {numero(red.resumen.arcos)} arcos
            </span>
            {Object.entries(red.resumen.porClase).map(([clase, cuantos]) => (
              <span className="tag" key={clase}>
                {CLASE[clase]?.icono} {cuantos} {CLASE[clase]?.label ?? clase}
              </span>
            ))}
            {marcado && (
              <button type="button" className="btn btn-sm" onClick={() => setMarcado('')}>
                Quitar la marca
              </button>
            )}
          </div>

          {sueltos.length > 0 && (
            <div className="notice notice-info">
              {numero(sueltos.length)} {sueltos.length === 1 ? 'nodo no se conecta' : 'nodos no se conectan'} con
              nada: {sueltos.slice(0, 6).map((uno) => uno.id).join(', ')}
              {sueltos.length > 6 && ` y ${sueltos.length - 6} más`}. Es un dato incompleto en SAP, no
              un problema de esta pantalla.
            </div>
          )}

          <div className="red-columnas">
            {columnas.map((columna) => (
              <div className="red-columna" key={columna.clase}>
                <div className="red-columna-titulo">
                  {CLASE[columna.clase]?.icono} {CLASE[columna.clase]?.label ?? columna.clase}
                  <span className="exp-sub">{columna.nodos.length}</span>
                </div>

                {columna.nodos.map((nodo) => {
                  const suyos = vecinosDe(nodo.id, red.arcos)
                  const relacionado = marcado
                    && (marcado === nodo.id
                      || suyos.entran.some((uno) => uno.desde === marcado)
                      || suyos.salen.some((uno) => uno.hasta === marcado))

                  return (
                    <button
                      key={nodo.id}
                      type="button"
                      className={`red-nodo red-${columna.clase.toLowerCase()}`
                        + `${marcado === nodo.id ? ' red-marcado' : ''}`
                        + `${marcado && !relacionado ? ' red-apagado' : ''}`}
                      onClick={() => setMarcado(marcado === nodo.id ? '' : nodo.id)}
                      title={`${nodo.id} · ${suyos.entran.length} entran, ${suyos.salen.length} salen`}
                    >
                      <span className="mono">{nodo.id}</span>
                      {nodo.nombre !== nodo.id && <span className="red-nombre">{nodo.nombre}</span>}
                      {nodo.plazo && <span className="exp-sub">plazo {nodo.plazo}</span>}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          {/* En una red real los arcos son decenas: «¿de dónde le llega a esta planta?» se contesta
              antes leyendo una lista que persiguiendo flechas. */}
          {vecinos && (
            <div className="card">
              <div className="card-label">
                {CLASE[red.nodos.find((uno) => uno.id === marcado)?.clase]?.icono} {marcado}
                <span className="exp-sub">{nombreDe(marcado)}</span>
              </div>

              <div className="tablero">
                <div>
                  <div className="exp-sub">Le llega de ({vecinos.entran.length})</div>
                  {vecinos.entran.length === 0 && <div className="sin-datos">De nadie</div>}
                  {vecinos.entran.map((arco) => (
                    <div className="red-arco" key={arco.id}>
                      <button type="button" className="enlace mono" onClick={() => setMarcado(arco.desde)}>
                        {arco.desde}
                      </button>
                      <span className="exp-sub">{nombreDe(arco.desde)}</span>
                      {arco.detalle && <span className="tag">{arco.detalle}</span>}
                    </div>
                  ))}
                </div>

                <div>
                  <div className="exp-sub">Manda a ({vecinos.salen.length})</div>
                  {vecinos.salen.length === 0 && <div className="sin-datos">A nadie</div>}
                  {vecinos.salen.map((arco) => (
                    <div className="red-arco" key={arco.id}>
                      <span className="exp-sub">{ARCO[arco.clase] ?? ''}</span>
                      <button type="button" className="enlace mono" onClick={() => setMarcado(arco.hasta)}>
                        {arco.hasta}
                      </button>
                      <span className="exp-sub">{nombreDe(arco.hasta)}</span>
                      {arco.detalle && <span className="tag">{arco.detalle}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {!marcado && (
            <div className="page-hint">
              Pulsá una ubicación para ver de dónde le llega y a dónde manda.
            </div>
          )}
        </>
      )}
    </div>
  )
}
