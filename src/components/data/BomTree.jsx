// El árbol de materiales de un producto: qué lleva, planta por planta.
//
// Portado de `bom.js` de v7. Las reglas de SAP y el armado de nodos están en `core/ibp/bom-tree.js`
// con sus pruebas; la lectura por niveles desde el navegador, en `src/lib/bom-load.js`. Aquí solo se
// dibuja y se decide qué se abre.
//
// Dos cosas heredadas de v7 que no son estilo:
//
//   - El árbol se abre PEREZOSO. Los hijos de un nodo se construyen al abrirlo y se sueltan al
//     cerrarlo. Un árbol de veinte niveles construido entero no cabe en memoria, y meterlo además en
//     el estado de React lo haría el doble de caro. Por eso los nodos viven en un `ref` y el redibujo
//     se pide con un contador: es la única parte de la aplicación donde eso está justificado.
//   - Se carga el subárbol de UN producto, no el tenant. Un tenant real son cientos de miles de filas
//     de recetas y nadie mira más de un árbol a la vez.
//
// Y una que v7 no hacía: los CICLOS se enseñan. v7 los detectaba, borraba la rama en silencio y
// declaraba una lista de ciclos que nunca llenaba. Un árbol al que le falta una rama sin avisar se
// entrega como si estuviera completo.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  TIPOS, abrirTodo, armarHijos, invertirArbol, profundidad, raicesPorPlanta, soltarHijos,
} from '../../../core/ibp/bom-tree.js'
import { cargarSubarbol, descripcionesDe, productosConReceta } from '../../lib/bom-load.js'
import { aplanarArbol, armarLibroDeUnProducto, descargarLibro, nombreDeArchivo } from '../../lib/bom-export.js'
import { usePantallaCompleta } from '../../lib/usePantallaCompleta.js'
import BotonPantallaCompleta from '../ui/BotonPantallaCompleta.jsx'

const numero = (valor) => Number(valor ?? 0).toLocaleString('es')

/** Cuántos productos se ofrecen a la vez en el buscador. Con mil el desplegable no se usa. */
const VISIBLES = 60

/** Un coeficiente de SAP como se lee: sin los seis decimales con los que viene. */
function coeficiente(valor) {
  const texto = String(valor ?? '').trim()
  if (!texto) return ''
  const suelto = Number.parseFloat(texto.replace(',', '.'))
  return Number.isFinite(suelto) ? suelto.toLocaleString('es', { maximumFractionDigits: 4 }) : texto
}

/** El icono de cada clase de nodo. Se lee antes que el texto. */
const ICONO = {
  [TIPOS.raiz]: '🏭',
  [TIPOS.componente]: '⚙️',
  [TIPOS.hoja]: '📦',
  [TIPOS.ciclo]: '🔁',
}

/** Una fila del árbol. Se dibuja plana y con sangría, no anidada: mil nodos anidados van lentos. */
function Fila({ nodo, abierto, onAlternar }) {
  const esCiclo = nodo.tipo === TIPOS.ciclo

  return (
    <div
      className={`bom-fila${esCiclo ? ' bom-ciclo' : ''}`}
      style={{ paddingLeft: `${(nodo.nivel - 1) * 20 + 6}px` }}
    >
      {nodo.sePuedeAbrir ? (
        <button
          type="button"
          className="bom-flecha"
          onClick={() => onAlternar(nodo)}
          aria-expanded={abierto}
          aria-label={abierto ? `Cerrar ${nodo.prdid}` : `Abrir ${nodo.prdid}`}
        >
          {abierto ? '▾' : '▸'}
        </button>
      ) : <span className="bom-flecha bom-flecha-hueca" />}

      <span className="bom-icono" title={nodo.tipo}>{ICONO[nodo.tipo] ?? '•'}</span>

      <span className="bom-prd mono">{nodo.prdid}</span>
      <span className="bom-descr">{nodo.descripcion}</span>

      {nodo.coeficienteDeEntrada && (
        <span className="tag" title="Cuánto entra de este componente">
          {coeficiente(nodo.coeficienteDeEntrada)} {nodo.unidad}
        </span>
      )}
      {nodo.tipoDeMaterial && <span className="exp-sub">{nodo.tipoDeMaterial}</span>}
      {nodo.receta && <span className="exp-sub mono" title="Receta (SOURCEID)">{nodo.receta}</span>}

      {nodo.esAlternativo && <span className="tag tag-accent" title="Componente alternativo">alt</span>}

      {nodo.recursos?.length > 0 && (
        <span className="exp-sub" title="Recursos de la receta">
          🛠 {nodo.recursos.slice(0, 3).join(', ')}
          {nodo.recursos.length > 3 && ` +${nodo.recursos.length - 3}`}
        </span>
      )}

      {nodo.coproductos?.length > 0 && (
        <span className="exp-sub" title="La misma receta produce además">
          ⊕ {nodo.coproductos.map((uno) => uno.prdid).join(', ')}
        </span>
      )}

      {esCiclo && (
        <span className="tag tag-error">
          vuelve a una receta ya vista — se corta aquí
        </span>
      )}
    </div>
  )
}

export default function BomTree({ sinPantallaCompleta = false }) {
  const [productos, setProductos] = useState(null)
  const [exportando, setExportando] = useState(false)
  const [descripciones, setDescripciones] = useState({})
  const [busqueda, setBusqueda] = useState('')
  const [error, setError] = useState('')

  const [elegido, setElegido] = useState('')
  const [cargando, setCargando] = useState(null)
  const [arbol, setArbol] = useState(null)
  const [planta, setPlanta] = useState('')
  const [ciclos, setCiclos] = useState([])

  // Los nodos NO viven en el estado de React: se mutan al abrir y cerrar, y son muchos. El contador es
  // lo que pide el redibujo.
  const indices = useRef(null)
  const lienzo = useRef(null)
  const pantalla = usePantallaCompleta(lienzo)
  const [redibujo, setRedibujo] = useState(0)
  const pedirRedibujo = useCallback(() => setRedibujo((previo) => previo + 1), [])

  const [abiertos, setAbiertos] = useState(() => new Set())

  // El árbol al revés: qué usa cada insumo, en vez de qué lleva cada producto. Portado de
  // `bomToggleInvert` de v7. Se guarda aparte del normal para poder alternar sin reconstruir.
  const [invertido, setInvertido] = useState(null)

  useEffect(() => {
    let abandonado = false

    productosConReceta()
      .then(async (lista) => {
        if (abandonado) return
        setProductos(lista)
        // Las descripciones de los primeros, que son los que se ven sin buscar.
        setDescripciones(await descripcionesDe(lista.slice(0, VISIBLES).map((uno) => uno.prdid)))
      })
      .catch((fallo) => {
        if (!abandonado) { setError(fallo.message); setProductos([]) }
      })

    return () => { abandonado = true }
  }, [])

  const visibles = useMemo(() => {
    const texto = busqueda.trim().toUpperCase()
    const lista = productos ?? []
    const filtrados = texto
      ? lista.filter((uno) => uno.prdid.includes(texto)
        || (descripciones[uno.prdid] ?? '').toUpperCase().includes(texto))
      : lista
    return filtrados.slice(0, VISIBLES)
  }, [productos, busqueda, descripciones])

  // Al buscar, se piden las descripciones de lo que se está viendo: pedirlas todas de golpe son miles.
  useEffect(() => {
    const faltan = visibles.map((uno) => uno.prdid).filter((prd) => descripciones[prd] === undefined)
    if (faltan.length === 0) return

    let abandonado = false
    descripcionesDe(faltan)
      .then((leidas) => {
        if (abandonado) return
        // Lo que no tiene descripción se marca con cadena vacía, o se volvería a pedir sin fin.
        const completas = Object.fromEntries(faltan.map((prd) => [prd, leidas[prd] ?? '']))
        setDescripciones((previas) => ({ ...previas, ...completas }))
      })
      .catch(() => {})

    return () => { abandonado = true }
  }, [visibles, descripciones])

  async function abrirProducto(prdid) {
    setElegido(prdid)
    setArbol(null)
    setInvertido(null)
    setCiclos([])
    setAbiertos(new Set())
    setError('')
    setCargando({ nivel: 1, productos: 1 })

    try {
      const { indices: leidos } = await cargarSubarbol(prdid, { onAvance: setCargando })
      indices.current = leidos

      // Acotado al producto elegido: el resto del índice está para armar sus descendientes, no para
      // ser raíz. Ver la cabecera de `raicesPorPlanta`.
      const armado = raicesPorPlanta(leidos, { soloDe: prdid })
      setArbol(armado)
      // La planta se elige sola solo si hay una: con varias, el árbol cambia por completo según cuál.
      setPlanta(armado.plantas.length === 1 ? armado.plantas[0] : '')
    } catch (fallo) {
      setError(fallo.message)
    } finally {
      setCargando(null)
    }
  }

  const normales = planta ? (arbol?.porPlanta[planta] ?? []) : []
  const raices = invertido ?? normales

  /**
   * Abre o cierra un nodo. Cerrar SUELTA el subárbol: es lo que sostiene un árbol grande.
   *
   * En el árbol invertido NO se suelta nada: sus nodos no salen de los índices —se calculan a partir
   * del árbol ya construido— y soltarlos los borraría sin poder rehacerlos.
   */
  function alternar(nodo) {
    setAbiertos((previos) => {
      const siguientes = new Set(previos)
      if (siguientes.has(nodo.id)) {
        siguientes.delete(nodo.id)
        if (!invertido) soltarHijos(nodo)
      } else {
        siguientes.add(nodo.id)
        if (!invertido) {
          const nuevos = armarHijos(nodo, indices.current)
          if (nuevos.length > 0) setCiclos((antes) => juntarCiclos(antes, nuevos))
        }
      }
      return siguientes
    })
    pedirRedibujo()
  }

  /** Marca como abiertos todos los nodos abribles de un bosque. */
  function marcarTodosAbiertos(nodos) {
    const puestos = new Set()
    const marcar = (lista) => {
      for (const nodo of lista ?? []) {
        if (nodo.sePuedeAbrir) puestos.add(nodo.id)
        marcar(nodo.hijos)
      }
    }
    marcar(nodos)
    return puestos
  }

  function abrirTodoElArbol() {
    if (!invertido) {
      const nuevos = abrirTodo(raices, indices.current)
      setCiclos((antes) => juntarCiclos(antes, nuevos))
    }
    setAbiertos(marcarTodosAbiertos(raices))
    pedirRedibujo()
  }

  function cerrarTodo() {
    if (!invertido) for (const raiz of raices) soltarHijos(raiz)
    setAbiertos(new Set())
    pedirRedibujo()
  }

  /**
   * Alterna entre «qué lleva este producto» y «dónde se usa cada insumo».
   *
   * Portado de `bomToggleInvert` de v7. Invertir exige el árbol ENTERO construido: la vista se arma
   * recorriendo todos los caminos hoja→raíz, y una rama sin abrir no tiene caminos que recorrer.
   */
  function alternarInvertido() {
    if (invertido) { setInvertido(null); setAbiertos(new Set()); pedirRedibujo(); return }

    const nuevos = abrirTodo(normales, indices.current)
    if (nuevos.length > 0) setCiclos((antes) => juntarCiclos(antes, nuevos))
    const alReves = invertirArbol(normales)
    setInvertido(alReves)
    setAbiertos(marcarTodosAbiertos(alReves))
    pedirRedibujo()
  }

  /**
   * El árbol a Excel, con las columnas de v7.
   *
   * Se construye ENTERO antes de volcar, esté abierto o no en pantalla: lo que se lleva a una reunión
   * es la jerarquía completa, no lo que quedó desplegado. Ver `bomExportExcel` de v7.
   */
  async function exportar() {
    setExportando(true)
    try {
      // Se vuelca SIEMPRE el árbol normal: las columnas del Excel —material padre, nivel, coeficiente
      // de entrada— son las de una explosión de arriba abajo, y en la vista invertida significarían
      // otra cosa. v7 hacía lo mismo.
      const nuevos = abrirTodo(normales, indices.current)
      if (nuevos.length > 0) setCiclos((antes) => juntarCiclos(antes, nuevos))
      const libro = await armarLibroDeUnProducto(aplanarArbol(normales))
      descargarLibro(libro, nombreDeArchivo(elegido, new Date().toISOString().slice(0, 10)))
    } catch (fallo) {
      setError(fallo.message)
    } finally {
      setExportando(false)
    }
  }

  /** Aplana el bosque a las filas que hay que dibujar, según qué está abierto. */
  const filas = useMemo(() => {
    const salida = []
    const recorrer = (nodos) => {
      for (const nodo of nodos ?? []) {
        salida.push(nodo)
        if (abiertos.has(nodo.id)) recorrer(nodo.hijos)
      }
    }
    recorrer(raices)
    return salida
    // `redibujo` está a propósito: los hijos se mutan y sin él la lista no se recalcula.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raices, abiertos, redibujo])

  const niveles = useMemo(
    () => (raices.length > 0 ? Math.max(...raices.map(profundidad)) : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raices, redibujo],
  )

  if (productos === null) return <div className="page-hint">Leyendo lo que hay descargado…</div>

  if (productos.length === 0) {
    return (
      <div className="module-body">
        {error
          ? <div className="notice notice-error">✕ {error}</div>
          : (
            <div className="notice notice-info">
              No hay recetas descargadas. Vuelve al paso <b>① Mapeo de entidades</b> y pulsa
              «Descargar datos y construir jerarquía»; este visor trabaja sobre lo que quedó guardado
              en este navegador, sin volver a preguntarle a SAP.
            </div>
          )}
      </div>
    )
  }

  return (
    <div className="module-body a-pantalla-completa" ref={lienzo}>
      {error && <div className="notice notice-error">✕ {error}</div>}

      <div className="tablero">
        <div className="card">
          <div className="card-label">
            Producto a mirar
            <span className="exp-sub">{numero(productos.length)} con receta</span>
          </div>

          <input
            className="input input-sm"
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
            placeholder="Buscar por código o descripción"
            aria-label="Buscar un producto"
          />

          <div className="bom-lista">
            {visibles.map((uno) => (
              <button
                key={uno.prdid}
                type="button"
                className={`bom-opcion${elegido === uno.prdid ? ' active' : ''}`}
                onClick={() => abrirProducto(uno.prdid)}
              >
                <span className="mono">{uno.prdid}</span>
                <span className="bom-descr">{descripciones[uno.prdid] ?? ''}</span>
                <span className="exp-sub">
                  {uno.plantas.join(', ')} · {uno.recetas} {uno.recetas === 1 ? 'receta' : 'recetas'}
                </span>
              </button>
            ))}
            {visibles.length === 0 && <div className="sin-datos">Ninguno coincide</div>}
          </div>

          {productos.length > visibles.length && (
            <div className="exp-sub">
              Se ven {visibles.length} de {numero(productos.length)}; busca para acotar.
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-label">Cómo leer esto</div>
          <p className="exp-sub">
            El árbol se arma por <b>planta</b>: los componentes de una receta se buscan solo entre las
            recetas de la misma planta. Un mismo producto puede ser el terminado en una planta y un
            insumo en otra, y su árbol es distinto en cada una.
          </p>
          <div className="bom-leyenda">
            <span>🏭 encabeza su receta</span>
            <span>⚙️ tiene receta propia</span>
            <span>📦 se compra o es materia prima</span>
            <span>🔁 cierra un ciclo</span>
            <span>⊕ la receta produce además</span>
            <span>🛠 recursos</span>
          </div>
        </div>
      </div>

      {cargando && (
        <div className="page-hint">
          {cargando.nivel === 'maestro'
            ? `Leyendo el maestro de ${numero(cargando.productos)} productos…`
            : `Recorriendo el nivel ${cargando.nivel} · ${numero(cargando.productos)} productos vistos…`}
        </div>
      )}

      {arbol && arbol.plantas.length === 0 && (
        <div className="notice notice-info">
          {elegido} tiene receta, pero ninguna de sus recetas encabeza un árbol: es componente de otros
          en todas sus plantas. Busca el producto terminado que lo lleva.
        </div>
      )}

      {arbol && arbol.plantas.length > 0 && (
        <>
          <div className="monitor-bar">
            <select
              className="select input-sm"
              value={planta}
              onChange={(evento) => { setPlanta(evento.target.value); setAbiertos(new Set()); setInvertido(null) }}
              aria-label="Planta"
            >
              <option value="">Elige una planta…</option>
              {arbol.plantas.map((una) => (
                <option key={una} value={una}>
                  {arbol.resumen[una].descripcion === una ? una : `${una} — ${arbol.resumen[una].descripcion}`}
                  {` (${arbol.resumen[una].raices})`}
                </option>
              ))}
            </select>

            {planta && (
              <>
                <button type="button" className="btn btn-sm" onClick={abrirTodoElArbol}>Abrir todo</button>
                <button type="button" className="btn btn-sm" onClick={cerrarTodo}>Cerrar todo</button>
                <button
                  type="button"
                  className={`btn btn-sm${invertido ? ' btn-primary' : ''}`}
                  onClick={alternarInvertido}
                  title="Ver dónde se usa cada insumo, en vez de qué lleva cada producto"
                >
                  {invertido ? '⇅ Volver al árbol normal' : '⇅ Invertir'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={exportar}
                  disabled={exportando}
                  title="La jerarquía completa a Excel, esté o no desplegada en pantalla"
                >
                  {exportando ? 'Generando…' : '⬇ Exportar Excel'}
                </button>
                {!sinPantallaCompleta && <BotonPantallaCompleta {...pantalla} que="el árbol" />}
                <span className="page-hint">
                  {numero(raices.length)} {raices.length === 1 ? 'raíz' : 'raíces'} ·{' '}
                  {numero(filas.length)} filas a la vista
                  {niveles > 1 && ` · ${niveles} niveles abiertos`}
                </span>
              </>
            )}
          </div>

          {/* Esto es lo que v7 no decía. Un ciclo en las recetas de SAP no se arregla solo. */}
          {ciclos.length > 0 && (
            <div className="notice notice-error">
              ⚠ Hay {numero(ciclos.length)} {ciclos.length === 1 ? 'ciclo' : 'ciclos'} en las recetas:
              una receta acaba usándose a sí misma. El árbol se corta ahí y lo marca con 🔁.
              <div className="bom-ciclos">
                {ciclos.slice(0, 8).map((uno) => (
                  <span key={`${uno.desde}-${uno.receta}`} className="mono">
                    {uno.desde} → {uno.receta} ({uno.prdid})
                  </span>
                ))}
                {ciclos.length > 8 && <span className="exp-sub">y {ciclos.length - 8} más</span>}
              </div>
            </div>
          )}

          {planta && (
            <div className="table-scroll table-alta bom-arbol">
              {filas.map((nodo) => (
                <Fila
                  key={nodo.id}
                  nodo={nodo}
                  abierto={abiertos.has(nodo.id)}
                  onAlternar={alternar}
                />
              ))}
              {filas.length === 0 && <div className="sin-datos">Esta planta no tiene raíces</div>}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Junta ciclos sin repetir: el mismo ciclo aparece cada vez que se reabre la rama. */
function juntarCiclos(antes, nuevos) {
  const vistos = new Set(antes.map((uno) => `${uno.desde}|${uno.receta}`))
  const suma = [...antes]
  for (const uno of nuevos) {
    const clave = `${uno.desde}|${uno.receta}`
    if (vistos.has(clave)) continue
    vistos.add(clave)
    suma.push(uno)
  }
  return suma
}
