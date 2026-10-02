// La vista web de resultados de v7 (`snWebView.js`): el mismo análisis que el Excel, explorable en
// pantalla. Es genérica a propósito —Production Analyzer y Network Analyzer le pasan sus datos con la
// misma forma—, así que nada de lo que hay aquí sabe de producción ni de red.
//
//   datos = {
//     titulo, generadoEl,
//     orden:   nombres de hoja, en el orden de las pestañas,
//     hojas:   { [nombre]: { nombre, encabezados, filas: [{ c: [...celdas], s: 'red'|'yel'|'ok' }],
//                            total, red, yel, ok, conEstado } },
//     resumen: [{ nombre, total, red, yel, ok }]            (las tarjetas de arriba),
//     estadisticas: string[][]                              (la hoja Estadísticas: [] = separador,
//                                                            1 elemento = título, >1 = tabla),
//     nombreEstadisticas,
//   }
//
// Las filas viven COMPLETAS en memoria (en v7 las hojas grandes iban a IndexedDB; aquí no hay tal cosa).
// Por eso el filtrado se memoriza —puede haber 100.000 filas— y solo se dibujan las 50 de la página.
//
// El estado de la vista (hoja, filtro, búsqueda, página) vive en este componente y no en la tabla, para
// que «Cerrar» —que solo minimiza— y «Ver resultados» lo reabran tal como estaba, sin recalcular nada.
// Si llega un análisis NUEVO, monta el componente con otra `key`: así se reinicia todo, como el
// `render()` sin `preserve` de v7. No se reinicia solo al cambiar `datos` porque un padre que arma el
// objeto en cada render borraría el filtro del usuario a cada tecla.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const TAM_PAGINA = 50
const ANCHO_MINIMO = 40
const RETARDO_BUSQUEDA_MS = 220
const HOJA_ESTADISTICAS = '__stats__'

const SEV = {
  red: { icono: '⛔', cls: 'snwv-red', etiqueta: 'Alerta' },
  yel: { icono: '⚠', cls: 'snwv-yel', etiqueta: 'Advertencia' },
  ok: { icono: '✅', cls: 'snwv-ok', etiqueta: 'OK' },
}

function fmtN(n) {
  try { return Number(n).toLocaleString('es-CL') } catch { return String(n) }
}

// Anchos de partida: «Estado» angosto, «Observación» ancho, el resto medio (los de v7).
function anchosPorDefecto(n) {
  return Array.from({ length: n }, (_, i) => (i === 0 ? 90 : i === 1 ? 300 : 150))
}

/**
 * Un div/span que se comporta como botón: clic y también Enter/Espacio, para llegar con el teclado.
 * Es un componente y no una función de props porque el linter no deja pasar a una función, durante el
 * render, un cierre que toca el temporizador de la búsqueda; como prop de un componente sí.
 */
function Activable({ como: Etiqueta = 'div', role = 'button', onActivar, children, ...resto }) {
  return (
    <Etiqueta
      role={role}
      tabIndex={0}
      onClick={onActivar}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivar() }
      }}
      {...resto}
    >
      {children}
    </Etiqueta>
  )
}

/** Mientras se arrastra el borde de una columna no debe seleccionarse texto de la página. */
function bloquearSeleccion(bloquear) {
  document.body.style.userSelect = bloquear ? 'none' : ''
}

/**
 * Filtra por severidad y por texto. La columna 0 (el estado) NO se busca por texto: se filtra con los
 * chips. Una celda vacía no cuenta como coincidencia.
 */
function filtrarFilas(filas, sev, texto) {
  const q = texto.trim().toLowerCase()
  const salida = []
  for (const fila of filas) {
    if (sev !== 'all' && fila.s !== sev) continue
    if (q) {
      let coincide = false
      const c = fila.c || []
      for (let j = 1; j < c.length; j++) {
        // En v7 las celdas de la vista eran texto ('0' cuenta); aquí pueden ser números, y un 0 también
        // tiene que poder buscarse. Lo que no cuenta es la celda vacía.
        const v = c[j]
        if (v !== null && v !== undefined && v !== '' && String(v).toLowerCase().includes(q)) { coincide = true; break }
      }
      if (!coincide) continue
    }
    salida.push(fila)
  }
  return salida
}

/** La hoja Estadísticas: una secuencia de títulos y tablas, como la dejaba `StatsSheet` en el Excel. */
function Estadisticas({ filas }) {
  if (!filas || !filas.length) return <div className="snwv-empty">Estadísticas no disponibles.</div>
  const bloques = []
  let i = 0
  while (i < filas.length) {
    const r = filas[i]
    if (!r || !r.length) { i++; continue } // separador
    if (r.length === 1) { // título o banner de sección
      if (String(r[0] ?? '').trim() !== '') bloques.push({ tipo: 'titulo', texto: String(r[0]), clave: i })
      i++
      continue
    }
    const tabla = [] // bloque contiguo de filas con más de un elemento: la primera es la cabecera
    const inicio = i
    while (i < filas.length && filas[i] && filas[i].length > 1) { tabla.push(filas[i]); i++ }
    bloques.push({ tipo: 'tabla', tabla, clave: inicio })
  }
  const texto = (v) => (v == null ? '' : String(v))
  return (
    <div className="snwv-statsbox">
      {bloques.map((b) => (b.tipo === 'titulo'
        ? <div key={b.clave} className="snwv-st-h">{b.texto}</div>
        : (
          <div key={b.clave} className="snwv-tablewrap" style={{ maxHeight: 'none', marginBottom: 14 }}>
            <table className="snwv-table">
              <thead>
                <tr>{b.tabla[0].map((v, c) => <th key={c}>{texto(v)}</th>)}</tr>
              </thead>
              <tbody>
                {b.tabla.slice(1).map((fila, r) => (
                  <tr key={r}>{fila.map((v, c) => <td key={c}>{texto(v)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )))}
    </div>
  )
}

/** El contenido completo de una celda recortada, con «Copiar» y «Cerrar». Escape y clic fuera cierran. */
function PopupDeCelda({ cabecera, valor, onCerrar }) {
  const [copiado, setCopiado] = useState(false)
  const botonCerrar = useRef(null)
  const cerrar = useRef(onCerrar)
  useEffect(() => { cerrar.current = onCerrar })

  useEffect(() => {
    botonCerrar.current?.focus()
    function alTeclear(e) {
      if (e.key === 'Escape') { e.stopPropagation(); cerrar.current?.() }
    }
    document.addEventListener('keydown', alTeclear)
    return () => document.removeEventListener('keydown', alTeclear)
  }, [])

  function copiar() {
    try {
      // `writeText` devuelve una promesa que puede rechazarse (sin permiso, sin foco): no debe quedar suelta.
      Promise.resolve(navigator.clipboard.writeText(valor)).catch(() => {})
      setCopiado(true)
    } catch { /* sin portapapeles disponible: el botón queda como estaba */ }
  }

  return createPortal(
    <div
      className="snwv-ov snwv-cellpop"
      onClick={(e) => { if (e.target === e.currentTarget) onCerrar() }}
    >
      <div className="snwv-modal" role="dialog" aria-modal="true">
        {cabecera ? <div className="snwv-cellpop-h">{cabecera}</div> : null}
        <div className="snwv-cellpop-body">{valor}</div>
        <div className="snwv-modal-foot">
          <button type="button" className="snwv-btn" data-cp="copy" onClick={copiar}>
            {copiado ? 'Copiado ✓' : 'Copiar'}
          </button>{' '}
          <button
            type="button"
            ref={botonCerrar}
            className="snwv-btn snwv-btn-primary"
            data-cp="close"
            onClick={onCerrar}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default function VistaWebAnalisis({ datos, descargarExcel = null, excelDescargado = false }) {
  const orden = useMemo(() => datos?.orden ?? [], [datos])
  const hojas = datos?.hojas
  const estadisticas = datos?.estadisticas
  const hayEstadisticas = !!(estadisticas && estadisticas.length)

  const [elegida, setElegida] = useState(null)
  const [sev, setSev] = useState('all')
  const [q, setQ] = useState('') // el texto YA aplicado (tras el retardo)
  const [qEscrita, setQEscrita] = useState('') // lo que hay en el cuadro ahora mismo
  const [pagina, setPagina] = useState(1)
  const [fs, setFs] = useState(false)
  const [colapsado, setColapsado] = useState(false)
  const [popup, setPopup] = useState(null)
  const [anchos, setAnchos] = useState({}) // por hoja: persisten al paginar
  const [descarga, setDescarga] = useState('inactivo') // 'inactivo' | 'generando' | 'listo'

  const temporizador = useRef(null)
  const soltarRedimension = useRef(null)
  const envoltura = useRef(null)
  const area = useRef(null)

  // La hoja activa: la elegida si sigue existiendo, o la primera. Se deriva y no se guarda así, si
  // llegaran otros datos sin esa hoja, la vista no se queda apuntando a algo que ya no está.
  const hoja = (elegida === HOJA_ESTADISTICAS && hayEstadisticas) || (elegida && hojas?.[elegida])
    ? elegida
    : orden[0]
  const hojaActual = hoja && hoja !== HOJA_ESTADISTICAS ? hojas?.[hoja] ?? null : null

  const filtradas = useMemo(
    () => (hojaActual ? filtrarFilas(hojaActual.filas || [], sev, q) : []),
    [hojaActual, sev, q],
  )
  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / TAM_PAGINA))
  const paginaActual = Math.min(Math.max(1, pagina), totalPaginas) // acotada: filtrar puede achicar la lista
  const desde = (paginaActual - 1) * TAM_PAGINA
  const filasPagina = useMemo(() => filtradas.slice(desde, desde + TAM_PAGINA), [filtradas, desde])

  const nColumnas = hojaActual?.encabezados?.length ?? 0
  const anchosGuardados = hoja ? anchos[hoja] : undefined
  const anchosHoja = useMemo(
    () => (anchosGuardados && anchosGuardados.length === nColumnas ? anchosGuardados : anchosPorDefecto(nColumnas)),
    [anchosGuardados, nColumnas],
  )

  // Pantalla completa: Escape sale (salvo que haya un popup abierto, que se queda ese Escape) y el
  // fondo de la página no se desplaza mientras tanto.
  useEffect(() => {
    if (!fs) return undefined
    function alTeclear(e) {
      if (popup) return
      if (e.key === 'Escape') setFs(false)
    }
    document.addEventListener('keydown', alTeclear)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', alTeclear)
      document.body.style.overflow = ''
    }
  }, [fs, popup])

  // Al montar y al reabrir, lleva la vista a la pantalla (v7 hacía scrollIntoView al pintar).
  useEffect(() => {
    if (!colapsado && !fs) envoltura.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [colapsado]) // eslint-disable-line react-hooks/exhaustive-deps -- solo al montar y al reabrir, no al salir de pantalla completa

  // No dejar temporizadores ni arrastres a medias si la vista se desmonta.
  useEffect(() => () => {
    if (temporizador.current) clearTimeout(temporizador.current)
    soltarRedimension.current?.()
  }, [])

  // Marca las celdas cuyo texto quedó recortado («…») para volverlas clicables. Se mide en el DOM, no
  // en los datos: lo que se recorta depende del ancho que el usuario le haya dado a la columna. Se
  // toca la clase directamente porque React no puede saber qué cabe, y vuelve a medir cada vez que
  // cambia lo que se dibuja o los anchos.
  useLayoutEffect(() => {
    const cont = area.current
    if (!cont) return
    cont.querySelectorAll('table.snwv-dtable td').forEach((td) => {
      td.classList.toggle('snwv-clip', td.scrollWidth > td.clientWidth + 1)
    })
  }, [filasPagina, anchosHoja, colapsado, hoja])

  if (!datos || !orden.length) {
    return (
      <div className="snwv-wrap">
        <div className="snwv-empty">No hay datos para mostrar en la vista web.</div>
      </div>
    )
  }

  const titulo = datos.titulo || ''

  function irAHoja(nombre) {
    if (nombre !== HOJA_ESTADISTICAS && !hojas?.[nombre]) return
    if (temporizador.current) { clearTimeout(temporizador.current); temporizador.current = null }
    setElegida(nombre)
    setSev('all')
    setQ('')
    setQEscrita('')
    setPagina(1)
  }

  function alEscribir(e) {
    const valor = e.target.value
    setQEscrita(valor)
    if (temporizador.current) clearTimeout(temporizador.current)
    temporizador.current = setTimeout(() => {
      temporizador.current = null
      setQ(valor)
      setPagina(1)
    }, RETARDO_BUSQUEDA_MS)
  }

  function elegirSeveridad(valor) {
    setSev(valor)
    setPagina(1)
  }

  async function bajarExcel() {
    setDescarga('generando')
    try {
      await descargarExcel()
      setDescarga('listo')
    } catch (e) {
      setDescarga('inactivo')
      window.alert('No se pudo generar el Excel: ' + (e && e.message ? e.message : e))
    }
  }

  function minimizar() {
    setFs(false) // salir de pantalla completa si estaba activa
    setColapsado(true)
  }

  // Arrastrar el borde derecho de la cabecera cambia el ancho de esa columna (mínimo 40 px).
  function empezarRedimension(e, ci) {
    e.preventDefault()
    e.stopPropagation()
    const inicioX = e.clientX
    const inicioAncho = anchosHoja[ci]
    const nombre = hoja
    const n = nColumnas
    function mover(ev) {
      const ancho = Math.max(ANCHO_MINIMO, inicioAncho + (ev.clientX - inicioX))
      setAnchos((prev) => {
        const base = prev[nombre] && prev[nombre].length === n ? prev[nombre] : anchosPorDefecto(n)
        const siguiente = base.slice()
        siguiente[ci] = ancho
        return { ...prev, [nombre]: siguiente }
      })
    }
    function soltar() {
      document.removeEventListener('mousemove', mover)
      document.removeEventListener('mouseup', soltar)
      bloquearSeleccion(false)
      soltarRedimension.current = null
    }
    bloquearSeleccion(true)
    document.addEventListener('mousemove', mover)
    document.addEventListener('mouseup', soltar)
    soltarRedimension.current = soltar
  }

  // Clic en una celda recortada → popup con el contenido completo (delegado: una sola escucha).
  function alHacerClicEnTabla(e) {
    const td = e.target.closest?.('td')
    if (!td || !td.classList.contains('snwv-clip') || !hojaActual) return
    const cabecera = hojaActual.encabezados[td.cellIndex] ?? ''
    const completo = td.getAttribute('title') ?? td.textContent ?? ''
    setPopup({ cabecera, valor: completo })
  }

  if (colapsado) {
    return (
      <div className="snwv-wrap">
        <div className="snwv-collapsed">
          <span className="snwv-collapsed-txt">🌐 {titulo} — análisis disponible</span>
          <button type="button" className="snwv-btn snwv-btn-primary" onClick={() => setColapsado(false)}>
            Ver resultados
          </button>
        </div>
      </div>
    )
  }

  const resumen = datos.resumen && datos.resumen.length
    ? datos.resumen
    : orden.map((nombre) => {
      const h = hojas[nombre]
      return { nombre, total: h.total, red: h.red, yel: h.yel, ok: h.ok }
    })

  const hayFiltro = sev !== 'all' || q.trim() !== ''
  const mostrandoDesde = filtradas.length ? desde + 1 : 0
  const mostrandoHasta = Math.min(desde + TAM_PAGINA, filtradas.length)
  const etiquetaFs = fs ? 'Salir de pantalla completa' : 'Pantalla completa'
  const chips = hojaActual && [
    { k: 'all', etiqueta: 'Todos', n: hojaActual.total },
    { k: 'red', etiqueta: '⛔ Alertas', n: hojaActual.red },
    { k: 'yel', etiqueta: '⚠ Advertencias', n: hojaActual.yel },
    { k: 'ok', etiqueta: '✅ OK', n: hojaActual.ok },
  ]
  const anchoTotal = anchosHoja.reduce((a, b) => a + b, 0)

  return (
    <>
      <div ref={envoltura} className={`snwv-wrap${fs ? ' snwv-fs' : ''}`}>
        <div className="snwv-head">
          <div>
            <div className="snwv-title">🌐 {titulo}</div>
            <div className="snwv-sub">
              Mismo análisis que el Excel, explorable en pantalla{datos.generadoEl ? ` · ${datos.generadoEl}` : ''}
            </div>
          </div>
          <div className="snwv-actions">
            {typeof descargarExcel === 'function' ? (
              <button
                type="button"
                className="snwv-btn snwv-btn-primary"
                disabled={descarga !== 'inactivo'}
                onClick={bajarExcel}
              >
                {descarga === 'generando'
                  ? 'Generando...'
                  : descarga === 'listo' ? '✅ Excel descargado' : '⬇️ Descargar Excel'}
              </button>
            ) : excelDescargado ? (
              <span className="snwv-dlnote">✅ Excel descargado</span>
            ) : null}
            <button
              type="button"
              className="snwv-btn"
              data-accion="pantalla-completa"
              aria-pressed={fs}
              title={etiquetaFs}
              onClick={() => setFs((v) => !v)}
            >
              ⛶ {etiquetaFs}
            </button>
            <button type="button" className="snwv-btn" data-accion="cerrar" onClick={minimizar}>Cerrar</button>
          </div>
        </div>

        <div className="snwv-cards">
          {resumen.map((r) => (
            <Activable
              key={r.nombre}
              className={`snwv-card${r.nombre === hoja ? ' active' : ''}`}
              data-sheet={r.nombre}
              onActivar={() => irAHoja(r.nombre)}
            >
              <div className="snwv-card-name">{r.nombre}</div>
              <div className="snwv-card-total">{fmtN(r.total)}</div>
              <div className="snwv-card-sev">
                <span className="snwv-dot" style={{ color: 'var(--red)' }}>⛔ <b>{fmtN(r.red)}</b></span>
                <span className="snwv-dot" style={{ color: 'var(--amber)' }}>⚠ <b>{fmtN(r.yel)}</b></span>
                <span className="snwv-dot" style={{ color: 'var(--green)' }}>✅ <b>{fmtN(r.ok)}</b></span>
              </div>
            </Activable>
          ))}
        </div>

        <div className="snwv-tabs" role="tablist">
          {orden.map((nombre) => (
            <Activable
              key={nombre}
              role="tab"
              className={`snwv-tab${nombre === hoja ? ' active' : ''}`}
              data-sheet={nombre}
              aria-selected={nombre === hoja}
              onActivar={() => irAHoja(nombre)}
            >
              {nombre} <span style={{ opacity: 0.6 }}>({fmtN(hojas[nombre]?.total ?? 0)})</span>
            </Activable>
          ))}
          {hayEstadisticas ? (
            <Activable
              role="tab"
              className={`snwv-tab${hoja === HOJA_ESTADISTICAS ? ' active' : ''}`}
              data-sheet={HOJA_ESTADISTICAS}
              aria-selected={hoja === HOJA_ESTADISTICAS}
              onActivar={() => irAHoja(HOJA_ESTADISTICAS)}
            >
              📈 {datos.nombreEstadisticas || 'Estadísticas'}
            </Activable>
          ) : null}
        </div>

        <div>
          {hoja === HOJA_ESTADISTICAS ? (
            <Estadisticas filas={estadisticas} />
          ) : hojaActual ? (
            <>
              <div className="snwv-toolbar">
                <div className="snwv-chips">
                  {chips.map((c) => (
                    <Activable
                      como="span"
                      key={c.k}
                      className={`snwv-chip${sev === c.k ? ' active' : ''}`}
                      data-sev={c.k}
                      aria-pressed={sev === c.k}
                      onActivar={() => elegirSeveridad(c.k)}
                    >
                      {`${c.etiqueta} (${fmtN(c.n)})`}
                    </Activable>
                  ))}
                </div>
                <input
                  className="snwv-search"
                  type="text"
                  placeholder={`Buscar en ${hojaActual.nombre}...`}
                  value={qEscrita}
                  onChange={alEscribir}
                />
              </div>

              <div ref={area} className="snwv-tablearea">
                {filasPagina.length ? (
                  <div className="snwv-tablewrap" onClick={alHacerClicEnTabla}>
                    <table className="snwv-dtable" style={{ width: anchoTotal }}>
                      <colgroup>
                        {anchosHoja.map((w, i) => <col key={i} style={{ width: w }} />)}
                      </colgroup>
                      <thead>
                        <tr>
                          {hojaActual.encabezados.map((enc, k) => (
                            <th key={k} title={enc}>
                              {enc}
                              <span
                                className="snwv-resizer"
                                data-ci={k}
                                onMouseDown={(e) => empezarRedimension(e, k)}
                              />
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filasPagina.map((fila, ri) => {
                          const meta = SEV[fila.s] || SEV.ok
                          return (
                            <tr key={ri} className={meta.cls}>
                              {hojaActual.encabezados.map((_, ci) => {
                                const v = fila.c && fila.c[ci] != null ? fila.c[ci] : ''
                                // Columna 0 = Estado: se compone desde la severidad. Las hojas sin esa
                                // columna (p. ej. «Tipos Excluidos») NO se pisan: su severidad se ve
                                // por el color de la fila.
                                if (ci === 0 && hojaActual.conEstado !== false) {
                                  return (
                                    <td key={ci} className={`snwv-sevcell ${meta.cls}`}>
                                      {`${meta.icono} ${(SEV[fila.s] || SEV.ok).etiqueta}`}
                                    </td>
                                  )
                                }
                                return (
                                  <td key={ci} className={v === '—' ? 'snwv-na' : undefined} title={String(v)}>
                                    {String(v)}
                                  </td>
                                )
                              })}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="snwv-empty">Sin filas que coincidan con el filtro.</div>
                )}

                <div className="snwv-foot">
                  <div>
                    <div className="snwv-count">
                      {`Mostrando ${fmtN(mostrandoDesde)}–${fmtN(mostrandoHasta)} de ${fmtN(filtradas.length)}`}
                      {hayFiltro ? ` (filtrado de ${fmtN(hojaActual.total)})` : ''}
                    </div>
                  </div>
                  <div className="snwv-pager">
                    <button
                      type="button"
                      className="snwv-btn"
                      data-pag="anterior"
                      disabled={paginaActual <= 1}
                      onClick={() => setPagina(paginaActual - 1)}
                    >
                      ‹ Anterior
                    </button>
                    <span className="snwv-count">{`Página ${fmtN(paginaActual)} / ${fmtN(totalPaginas)}`}</span>
                    <button
                      type="button"
                      className="snwv-btn"
                      data-pag="siguiente"
                      disabled={paginaActual >= totalPaginas}
                      onClick={() => setPagina(paginaActual + 1)}
                    >
                      Siguiente ›
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
      {popup ? (
        <PopupDeCelda cabecera={popup.cabecera} valor={popup.valor} onCerrar={() => setPopup(null)} />
      ) : null}
    </>
  )
}
