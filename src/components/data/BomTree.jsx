// El árbol de materiales de UN producto: la pantalla de una pestaña de v7.
//
// Portado de `bomBuildTabPane`, `bomRenderTable` y compañía de `bom.js` de v7, con SU forma:
//
//   - Arriba, la barra de controles: «BUSCAR PRODUCTO» (código o descripción, con lista de hasta 30
//     coincidencias), «⊟ Colapsar», «⬇ Exportar», «✕ Limpiar» y los contadores Raíces / Visibles /
//     Prof.máx.
//   - Sin producto elegido, solo el mensaje «Busca un producto en el campo superior…». NO hay lista de
//     productos a la vista ni selector de planta: es lo que v7 hacía y lo que se pidió respetar.
//   - Con producto, UNA tabla con las raíces de todas las plantas juntas y sus once columnas, con el
//     color del nivel, las insignias de tipo y de recursos y las columnas de vigencia si la descarga
//     las trajo.
//
// Las reglas de SAP y el armado de nodos siguen en `core/ibp/bom-tree.js` con sus pruebas, y la lectura
// por niveles en `src/lib/bom-load.js`. Aquí solo se dibuja y se decide qué se abre.
//
// Dos cosas heredadas de v7 que no son estilo:
//
//   - El árbol se abre PEREZOSO. Los hijos de un nodo se construyen al abrirlo y se sueltan al
//     cerrarlo. Un árbol de veinte niveles construido entero no cabe en memoria. Por eso los nodos
//     viven en un `ref` y el redibujo se pide con un contador.
//   - Se carga el subárbol de UN producto, no el tenant.
//
// Y una que v7 no hacía: los CICLOS se enseñan. v7 los detectaba, borraba la rama en silencio y
// declaraba una lista de ciclos que nunca llenaba.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  TIPOS, abrirTodo, armarHijos, profundidad, raicesPorPlanta, soltarHijos,
} from '../../../core/ibp/bom-tree.js'
import {
  cargarSubarbol, descripcionesDeLosProductos, hayValidez, productosConReceta,
} from '../../lib/bom-load.js'
import { aplanarArbol, armarLibroDeUnProducto, descargarLibro, nombreDeArchivo } from '../../lib/bom-export.js'

/** Cuántas coincidencias ofrece el buscador, como en v7. */
const SUGERENCIAS = 30

/** Un coeficiente como lo escribía v7 (`fmtCoef`): configuración chilena, hasta 4 decimales. */
function coeficiente(valor) {
  if (valor === '' || valor === null || valor === undefined) return ''
  const n = Number(valor)
  return Number.isNaN(n) ? String(valor) : n.toLocaleString('es-CL', { maximumFractionDigits: 4 })
}

/** Una fecha OData v2 (`/Date(ms)/`) a AAAA-MM-DD; vacío si no se entiende. De `bomFmtSapDate`. */
function fechaDeSap(valor) {
  const texto = String(valor ?? '').trim()
  if (!texto) return ''
  const m = /\/Date\((-?\d+)/.exec(texto)
  const fecha = m ? new Date(Number(m[1])) : new Date(texto)
  if (Number.isNaN(fecha.getTime())) return m ? '' : texto
  return fecha.toISOString().slice(0, 10)
}

/** El nivel que se muestra: raíz = 1, sus componentes directos = 1 y cada receta que se explota suma 1. */
const nivelMostrado = (nivel) => Math.max(1, (nivel || 1) - 1)

/** La celda de coeficientes: `↓ 2,5 (PSI) · ↑ 1 (PSH) KG`. Es `fmtDualCoef` de v7. */
function CoeficienteDoble({ entrada, salida, unidad }) {
  const hayEntrada = entrada !== '' && entrada != null
  const haySalida = salida !== '' && salida != null
  const etiqueta = (texto) => <span style={{ fontSize: 10, opacity: 0.65, fontWeight: 600 }}>({texto})</span>
  const uom = unidad
    ? <> <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{unidad}</span></>
    : null

  if (!hayEntrada && !haySalida) return uom
  return (
    <>
      {hayEntrada && <span style={{ color: 'var(--blue)' }}>↓ {coeficiente(entrada)} {etiqueta('PSI')}</span>}
      {hayEntrada && haySalida && <> <span style={{ color: 'var(--text3)' }}>·</span> </>}
      {haySalida && <span style={{ color: '#48c778' }}>↑ {coeficiente(salida)} {etiqueta('PSH')}</span>}
      {uom}
    </>
  )
}

const mono11 = { fontFamily: 'var(--mono)', fontSize: 11 }
const sub10 = { color: 'var(--text3)', fontSize: 10 }

/** Los nodos sin hijos van antes que los que los tienen, como `sortedNodes` de v7. */
function ordenados(nodos) {
  const conHijos = (n) => Boolean(n.sePuedeAbrir || n.hijos?.length)
  return [...nodos].sort((a, b) => Number(conHijos(a)) - Number(conHijos(b)))
}

/**
 * `recarga` sube cuando termina una descarga y es lo que hace que el árbol vuelva a leer la base.
 *
 * `onCargados` informa de cuántos productos con receta salieron, para la línea «✓ N productos en
 * caché local» que v7 escribía al terminar de indexar. `onProducto` dice qué producto hay elegido, que
 * es lo que la pestaña pone de título (v7: `tab.prdid || 'Nueva búsqueda'`). `onEstado` es la línea de
 * estado del panel de descarga.
 */
export default function BomTree({ recarga = 0, onCargados = null, onProducto = null, onEstado = null }) {
  const [productos, setProductos] = useState(null)
  const [descripciones, setDescripciones] = useState({})
  const [conValidez, setConValidez] = useState(false)
  const [texto, setTexto] = useState('')
  const [lista, setLista] = useState(false)

  const [elegido, setElegido] = useState('')
  const [cargando, setCargando] = useState(null)
  const [arbol, setArbol] = useState(null)
  const [ciclos, setCiclos] = useState([])
  const [error, setError] = useState('')
  const [exportando, setExportando] = useState(false)
  const [profundidadMax, setProfundidadMax] = useState(null)

  // Los nodos NO viven en el estado de React: se mutan al abrir y cerrar, y son muchos.
  const indices = useRef(null)
  // Lo mismo que `indices`, para leerlo al dibujar: React no deja leer un `ref` mientras dibuja.
  const [datos, setDatos] = useState(null)
  const [redibujo, setRedibujo] = useState(0)
  const pedirRedibujo = useCallback(() => setRedibujo((previo) => previo + 1), [])
  const [abiertos, setAbiertos] = useState(() => new Set())

  useEffect(() => {
    let abandonado = false

    Promise.all([productosConReceta(), hayValidez()])
      .then(async ([encontrados, validez]) => {
        if (abandonado) return
        const todas = await descripcionesDeLosProductos(encontrados.map((uno) => uno.prdid))
        if (abandonado) return

        // Lo que se estaba mirando es de ANTES de la descarga, y las filas de las que salió pueden
        // haberse borrado. Se suelta, que es lo que hacía v7 al terminar de bajar.
        setElegido('')
        setTexto('')
        setArbol(null)
        setCiclos([])
        setAbiertos(new Set())
        setProfundidadMax(null)
        indices.current = null
        setDatos(null)
        onProducto?.('')

        setProductos(encontrados)
        setDescripciones(todas)
        setConValidez(validez)
        onCargados?.(encontrados.length)
      })
      .catch((fallo) => {
        if (!abandonado) { setError(fallo.message); setProductos([]) }
      })

    return () => { abandonado = true }
    // Los avisos al padre quedan fuera a propósito: son funciones nuevas en cada dibujo del padre y
    // meterlas aquí volvería a leer la base entera cada vez que el padre se redibuja.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recarga])

  const coincidencias = useMemo(() => {
    const f = texto.trim().toLowerCase()
    if (!f || !productos) return []
    return productos
      .filter((uno) => uno.prdid.toLowerCase().includes(f)
        || (descripciones[uno.prdid] ?? '').toLowerCase().includes(f))
      .slice(0, SUGERENCIAS)
  }, [productos, descripciones, texto])

  /** Todas las raíces de todas las plantas, juntas, como las juntaba `bomGetRoots`. */
  const raices = useMemo(
    () => (arbol ? arbol.plantas.flatMap((planta) => arbol.porPlanta[planta]) : []),
    [arbol],
  )

  async function elegirProducto(prdid) {
    setLista(false)
    setElegido(prdid)
    setArbol(null)
    setCiclos([])
    setAbiertos(new Set())
    setError('')
    setProfundidadMax(null)
    setCargando({ nivel: 1, productos: 1 })
    onProducto?.(prdid)
    onEstado?.('info', `Cargando BOM para ${prdid}...`)

    try {
      const { indices: leidos } = await cargarSubarbol(prdid, { onAvance: setCargando })
      indices.current = leidos
      setDatos(leidos)
      const armado = raicesPorPlanta(leidos, { soloDe: prdid })
      setArbol(armado)
      onEstado?.('ok', `¡Listo! ${armado.plantas.length} plantas · profundidad máx: ${
        Math.max(0, ...armado.plantas.flatMap((p) => armado.porPlanta[p].map(profundidad)))}`)
    } catch (fallo) {
      setError(fallo.message)
      onEstado?.('err', `Error cargando BOM: ${fallo.message}`)
    } finally {
      setCargando(null)
    }
  }

  function alEscribir(valor) {
    setTexto(valor)
    if (!valor.trim()) {
      setLista(false)
      if (elegido) {
        // Borrar el campo suelta el producto, como en v7.
        setElegido('')
        setArbol(null)
        setAbiertos(new Set())
        setProfundidadMax(null)
        onProducto?.('')
      }
      return
    }
    setLista(true)
  }

  function limpiar() {
    setTexto('')
    setLista(false)
    setElegido('')
    setArbol(null)
    setCiclos([])
    setAbiertos(new Set())
    setProfundidadMax(null)
    indices.current = null
    setDatos(null)
    onProducto?.('')
  }

  function colapsar() {
    for (const raiz of raices) soltarHijos(raiz)
    setAbiertos(new Set())
    pedirRedibujo()
  }

  /** Abre o cierra un nodo. Cerrar SUELTA el subárbol: es lo que sostiene un árbol grande. */
  function alternar(nodo) {
    setAbiertos((previos) => {
      const siguientes = new Set(previos)
      if (siguientes.has(nodo.id)) {
        siguientes.delete(nodo.id)
        soltarHijos(nodo)
      } else {
        siguientes.add(nodo.id)
        const nuevos = armarHijos(nodo, indices.current)
        if (nuevos.length > 0) setCiclos((antes) => juntarCiclos(antes, nuevos))
      }
      return siguientes
    })
    pedirRedibujo()
  }

  /**
   * El árbol a Excel, con las columnas de v7: la jerarquía COMPLETA, esté o no abierta en pantalla.
   * Ver `bomExportExcel` de v7.
   */
  async function exportar() {
    if (!elegido || raices.length === 0) {
      onEstado?.('warn', 'Carga un producto antes de exportar.')
      return
    }
    setExportando(true)
    onEstado?.('info', `Generando Excel de la jerarquía de ${elegido}…`)
    try {
      const nuevos = abrirTodo(raices, indices.current)
      if (nuevos.length > 0) setCiclos((antes) => juntarCiclos(antes, nuevos))
      setProfundidadMax(Math.max(0, ...raices.map(profundidad)))
      const filas = aplanarArbol(raices)
      const libro = await armarLibroDeUnProducto(filas)
      descargarLibro(libro, nombreDeArchivo(elegido, new Date().toISOString().slice(0, 10)))
      onEstado?.('ok', `Excel exportado: ${filas.length} filas.`)
    } catch (fallo) {
      setError(fallo.message)
      onEstado?.('err', `Error: ${fallo.message}`)
    } finally {
      setExportando(false)
    }
  }

  /** Aplana el bosque a las filas que hay que dibujar, según qué está abierto. */
  const filas = useMemo(() => {
    const salida = []
    const recorrer = (nodos, raiz, padre) => {
      for (const nodo of nodos) {
        salida.push({ nodo, raiz, padre })
        if (abiertos.has(nodo.id) && nodo.hijos) recorrer(ordenados(nodo.hijos), raiz, nodo.prdid)
      }
    }
    for (const nodo of raices) {
      salida.push({ nodo, raiz: nodo.prdid, padre: '' })
      if (abiertos.has(nodo.id) && nodo.hijos) recorrer(ordenados(nodo.hijos), nodo.prdid, nodo.prdid)
    }
    return salida
    // `redibujo` está a propósito: los hijos se mutan y sin él la lista no se recalcula.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raices, abiertos, redibujo])

  const ubicaciones = datos?.ubicaciones ?? {}
  const descRecursos = datos?.descRecursos ?? {}
  const sustitutos = datos?.subsPorSid ?? {}
  const vigencias = datos?.validezPorSid ?? {}

  /** `bomGetValidity`: todos los periodos del componente en su receta, por fecha de inicio. */
  function vigenciaDe(nodo) {
    const periodos = (vigencias[nodo.recetaDelPadre] ?? [])
      .filter((uno) => String(uno.PRDID ?? '').trim() === nodo.prdid)
      .map((uno) => ({ fr: fechaDeSap(uno.COMPVALIDFR), to: fechaDeSap(uno.COMPVALIDTO) }))
      .sort((a, b) => a.fr.localeCompare(b.fr))
    return { fr: periodos.map((p) => p.fr).join('; '), to: periodos.map((p) => p.to).join('; ') }
  }

  const columnasExtra = conValidez ? 2 : 0

  return (
    <div className="bom-pane">
      <div className="controls-bar" style={{ display: 'flex' }}>
        <div className="prod-search-group">
          <label>Buscar producto</label>
          <div className="ss-wrap prod-ss-wrap">
            <input
              type="text"
              className="ss-input-vis bom-search-inp"
              placeholder="Código o descripción..."
              autoComplete="off"
              value={texto}
              onChange={(evento) => alEscribir(evento.target.value)}
              onFocus={() => { if (texto.trim()) setLista(true) }}
              onBlur={() => setLista(false)}
              onKeyDown={(evento) => { if (evento.key === 'Escape') setLista(false) }}
            />
            <div className={`ss-list bom-sugg-list${lista ? ' open' : ''}`}>
              {coincidencias.length === 0
                ? <div className="ss-none">Sin coincidencias</div>
                : coincidencias.map((uno) => (
                  // `onMouseDown` y no `onClick`: el campo pierde el foco antes del clic y cierra la lista.
                  <div
                    key={uno.prdid}
                    className="ss-opt"
                    onMouseDown={(evento) => {
                      evento.preventDefault()
                      setTexto(`${uno.prdid}${descripciones[uno.prdid] ? `  ·  ${descripciones[uno.prdid]}` : ''}`)
                      elegirProducto(uno.prdid)
                    }}
                  >
                    <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{uno.prdid}</span>
                    {descripciones[uno.prdid] && (
                      <span style={{ color: 'var(--text3)', fontSize: 10 }}> · {descripciones[uno.prdid]}</span>
                    )}
                  </div>
                ))}
            </div>
          </div>
        </div>

        <button type="button" className="btn btn-secondary btn-small" onClick={colapsar}>⊟ Colapsar</button>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          title="Exportar la jerarquía completa del producto a Excel"
          onClick={exportar}
          disabled={exportando}
        >
          ⬇ Exportar
        </button>
        <button type="button" className="btn btn-danger btn-small" onClick={limpiar}>✕ Limpiar</button>

        <div className="stats-row">
          <span>Raíces: <strong>{elegido && arbol ? raices.length : '-'}</strong></span>
          <span>Visibles: <strong>{elegido && arbol ? filas.length : '-'}</strong></span>
          <span>Prof.máx: <strong>{elegido && arbol ? (profundidadMax ?? '?') : '-'}</strong></span>
        </div>
      </div>

      {error && <div className="notice notice-error" style={{ margin: 12 }}>✕ {error}</div>}

      {!elegido && productos !== null && (
        <div className="empty-state bom-prompt" style={{ display: 'block' }}>
          <div className="icon">🔍</div>
          Busca un producto en el campo superior para visualizar su jerarquía BOM.<br />
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>
            Se mostrarán todos los SourceID del producto en cada planta y opción de producción.
          </span>
        </div>
      )}

      {cargando && (
        <div className="bom-loading">
          <div className="bom-loading-spinner" />
          <div className="bom-loading-prd">{elegido}</div>
          <div className="bom-loading-msg">
            {cargando.nivel === 'maestro'
              ? `Cargando maestro de materiales (${cargando.productos})...`
              : `Escaneando nivel ${cargando.nivel} — ${cargando.productos} materiales encontrados...`}
          </div>
        </div>
      )}

      {ciclos.length > 0 && (
        <div className="notice notice-error" style={{ margin: 12 }}>
          ⚠️ <strong>Ciclos detectados:</strong>{' '}
          {ciclos.slice(0, 8).map((uno) => `${uno.desde} → ${uno.receta} (${uno.prdid})`).join('; ')}
          {ciclos.length > 8 && ` y ${ciclos.length - 8} más`}
        </div>
      )}

      {elegido && arbol && !cargando && (
        <div className="table-wrap bom-table-wrap">
          <table>
            <thead>
              <tr>
                <th className="col-exp" />
                <th className="col-rootmat">Material Padre Nivel 1</th>
                <th className="col-parentmat">Material Padre del Nivel</th>
                <th className="col-lvl">Nivel</th>
                <th className="col-loc">Planta</th>
                <th className="col-src">ID de producción</th>
                <th className="col-prd">Material</th>
                <th className="col-alt">Reemplazante</th>
                <th className="col-coef">Coeficiente</th>
                <th className="col-mat">Tipo de Material</th>
                <th className="col-type">Tipo</th>
                <th className="col-res">Puestos de trabajo</th>
                {conValidez && <th className="col-validfr">Válido desde</th>}
                {conValidez && <th className="col-validto">Válido hasta</th>}
              </tr>
            </thead>
            <tbody className="bom-tbody">
              {filas.map(({ nodo, raiz, padre }) => {
                const abierto = abiertos.has(nodo.id)
                const tieneHijos = Boolean(nodo.sePuedeAbrir || nodo.hijos?.length)
                const clase = nodo.tipo === TIPOS.raiz ? 'rt-root'
                  : nodo.tipo === TIPOS.ciclo ? 'rt-cycle'
                    : tieneHijos ? 'rt-subprod' : 'rt-leaf'
                const nivel = nivelMostrado(nodo.nivel)
                const claseNivel = `lvl-c${((nivel - 1) % 8) + 1}`
                const sangria = (nodo.nivel - 1) * 20
                const ubicacion = ubicaciones[nodo.planta]
                const reemplaza = nodo.esAlternativo === 'X'
                  ? (sustitutos[nodo.recetaDelPadre] ?? [])
                    .filter((uno) => String(uno.SPRDFR ?? '').trim() === nodo.prdid)
                    .map((uno) => String(uno.PRDFR ?? '').trim())
                  : []
                const vigencia = conValidez ? vigenciaDe(nodo) : null

                return [
                  <tr key={nodo.id} className={`${clase} ${claseNivel}`}>
                    <td style={{ paddingLeft: sangria + 6 }}>
                      {tieneHijos
                        ? (
                          <button type="button" className="exp-btn" onClick={() => alternar(nodo)}>
                            {abierto ? '▼' : '▶'}
                          </button>
                        )
                        : <button type="button" className="exp-btn no-ch">·</button>}
                    </td>
                    <td style={mono11}>{raiz}</td>
                    <td style={mono11}>{padre}</td>
                    <td><span className="lvl-badge">{nivel}</span></td>
                    <td style={mono11}>
                      {nodo.planta}
                      {ubicacion?.LOCDESCR && <span style={sub10}> — {ubicacion.LOCDESCR}</span>}
                    </td>
                    <td style={mono11}>{nodo.receta}</td>
                    <td style={mono11}>
                      {nodo.tipo === TIPOS.ciclo && '🔁 '}{nodo.prdid}
                      {nodo.descripcion && <span style={sub10}> — {nodo.descripcion}</span>}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {nodo.esAlternativo === 'X' && (
                        <span
                          className="badge badge-alt"
                          title={reemplaza.length > 0 ? `Reemplaza a: ${reemplaza.join(', ')}` : 'Material de reemplazo'}
                        >
                          X
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>
                      <CoeficienteDoble
                        entrada={nodo.coeficienteDeEntrada}
                        salida={nodo.coeficienteDeSalida}
                        unidad={nodo.unidad}
                      />
                    </td>
                    <td style={mono11}>{nodo.tipoDeMaterial}</td>
                    <td>
                      {nodo.tipoDeReceta && (
                        <span className={`badge ${nodo.tipoDeReceta === 'C' ? 'badge-coprod' : 'badge-psh'}`}>
                          {nodo.tipoDeReceta}
                        </span>
                      )}
                    </td>
                    <td>
                      {(nodo.recursos ?? []).map((res) => (
                        <span key={res} className="badge badge-res" title={descRecursos[res] || undefined}>{res}</span>
                      ))}
                    </td>
                    {conValidez && <td style={mono11}>{vigencia.fr}</td>}
                    {conValidez && <td style={mono11}>{vigencia.to}</td>}
                  </tr>,

                  ...(abierto && nodo.coproductos?.length > 0
                    ? nodo.coproductos.map((cp) => (
                      <tr key={`${nodo.id}/co/${cp.prdid}`} className={`rt-coprod ${claseNivel}`}>
                        <td style={{ paddingLeft: sangria + 28 }} />
                        <td style={mono11}>{raiz}</td>
                        <td style={mono11}>{nodo.prdid}</td>
                        <td /><td /><td />
                        <td style={mono11}>
                          {cp.prdid}
                          {cp.descripcion && <span style={sub10}> — {cp.descripcion}</span>}
                        </td>
                        <td />
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>
                          <CoeficienteDoble entrada="" salida={cp.coeficiente} unidad={cp.unidad} />
                        </td>
                        <td style={mono11}>{cp.tipoDeMaterial}</td>
                        <td>
                          {cp.tipo && (
                            <span className={`badge ${cp.tipo === 'C' ? 'badge-coprod' : 'badge-psh'}`}>{cp.tipo}</span>
                          )}
                        </td>
                        <td />
                        {conValidez && <><td /><td /></>}
                      </tr>
                    ))
                    : []),

                  ...(abierto && tieneHijos
                    ? [(
                      <tr key={`${nodo.id}/div`} className="tr-comp-divider">
                        <td style={{ paddingLeft: sangria + 28 }} />
                        <td colSpan={11 + columnasExtra}>
                          <span className="divider-lbl">↓ Componentes PSI ({nodo.hijos?.length || '…'})</span>
                        </td>
                      </tr>
                    )]
                    : []),
                ]
              })}
            </tbody>
          </table>
          {filas.length === 0 && (
            <div className="empty-state bom-empty">
              <div className="icon">🔍</div>Producto no encontrado como raíz en la jerarquía BOM.
            </div>
          )}
        </div>
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
