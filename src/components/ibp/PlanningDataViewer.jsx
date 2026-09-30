// «Ver Dato Transaccional»: mirar y editar las key figures de un tenant, al nivel que se elija.
//
// Portado tal cual de `DataViewer/TransactionalDataViewer.jsx` de v8: las mismas dos secciones
// plegables —«Selección» con el área, la versión y «↺ Actualizar», y «Columnas y filtros» con el nivel,
// las key figures, las conversiones, las fechas, «Ocultar filas en cero» y los filtros—, la misma
// tabla con su edición de key figures, su exportación y su paginación, y el mismo diálogo de revisión.
//
// Key figures, no atributos de dato maestro: se elige un NIVEL —dimensiones más un nivel de tiempo—
// y las key figures que se ven a ese nivel. SAP AGREGA a ese nivel, así que las columnas elegidas
// definen los datos, no solo la vista. Cada lectura va paginada por SAP ($skip/$top): nunca se baja
// el área entera.
//
// Lo único que cambia respecto de v8 es DÓNDE se habla con SAP: aquí es el servidor, porque las
// credenciales viven cifradas allí y nunca llegan al navegador. Por lo mismo, el `$filter` no lo arma
// esta pantalla: manda la definición y el servidor lo arma con las reglas de SAP de `core/`.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { MARCA_DE_CODIFICACION, TOPES, filasACsv, nombreDeArchivo } from '../../../core/ibp/export-csv.js'
import { etiquetaDeCondicion } from '../../../core/ibp/master-data-model.js'
import { resultadoDeEdicion } from '../../../core/ibp/planning-data-edit.js'
import { conversionQueFalta } from '../../../core/ibp/planning-data-model.js'
import { descargarTexto } from '../../lib/descargar-csv.js'
import {
  fetchAttrValues, fetchConversionValuesCached, fetchKfCount, fetchKfRows,
  fetchPlanningCatalogCached, invalidatePlanningCaches,
} from '../../lib/ibp-planning-data.js'
import { guardarCifras } from '../../lib/ibp-planning-data-edit.js'
import { useIsMobile } from '../../lib/useIsMobile.js'
import SeccionPlegable from '../ui/SeccionPlegable.jsx'
import DataGrid from './DataGrid.jsx'
import EditReviewModal from './EditReviewModal.jsx'
import { MultiValueSelect, SearchSelect } from './FilterControls.jsx'

// Los niveles de tiempo estándar de SAP IBP (campos de marca de tiempo). Semana es el habitual.
const TIME_LEVELS = [
  { field: 'PERIODID4_TSTAMP', label: 'Semana' },
  { field: 'PERIODID3_TSTAMP', label: 'Mes' },
  { field: 'PERIODID2_TSTAMP', label: 'Trimestre' },
  { field: 'PERIODID1_TSTAMP', label: 'Año' },
  { field: 'PERIODID0_TSTAMP', label: 'Día' },
  { field: 'PERIODID5_TSTAMP', label: 'Semana técnica' },
]
// Lo que SAP devuelve pero no es una dimensión del nivel: el contexto de versión y escenario, y la
// auditoría.
const READONLY_ATTRS = new Set(['VERSIONID', 'VERSIONNAME', 'SCENARIOID', 'SCENARIONAME', 'MASTER_DATA_TYPE', 'AGGREGATE', 'LASTMODIFIEDDATE', 'CREATEDDATE'])
const PAGESIZE_KEY = 'ibp:viewer:pagesize'
const PAGE_SIZES = [50, 100, 200, 500]
// Exportar lee páginas grandes: en SAP el costo es por petición (~6 s), no por fila.
const EXPORT_TOP = 5000

function loadPageSize() {
  let n = 500
  try { n = parseInt(localStorage.getItem(PAGESIZE_KEY) || '500', 10) } catch { /* nada guardado */ }
  return PAGE_SIZES.includes(n) ? n : 500
}

const errText = e => (e == null ? 'Error' : (typeof e === 'string' ? e : (e.message || String(e))))
const num = n => Number(n ?? 0).toLocaleString()

// SAP nombra el atributo de conversión que falta cuando una key figure de valor o de cantidad lo
// necesita. El servidor devuelve su mensaje entero, como v8.
function convHint(e) {
  const falta = conversionQueFalta(String(e?.detail || e?.message || '').toUpperCase())
  if (falta === 'UOMTOID') return 'Esta key figure requiere una unidad destino (UOMTOID). Selecciónala y reintenta.'
  if (falta === 'CURRTOID') return 'Esta key figure requiere una moneda destino (CURRTOID). Selecciónala y reintenta.'
  return null
}
const loadErrorText = e => convHint(e) || `No se pudieron cargar los datos: ${errText(e)}`

// ── Estilos de v8 ──
const SECTION = { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }
const LABEL   = { fontSize: 10, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 5, display: 'block' }
const SELECT  = { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12, padding: '7px 10px', width: '100%', outline: 'none' }
const INPUT   = { ...SELECT }
const BTN_SEC = { background: 'none', border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--text2)', fontSize: 12, fontWeight: 600, padding: '7px 12px', cursor: 'pointer' }
function btnPrimary(disabled) {
  return {
    background: disabled ? 'var(--border2)' : 'var(--accent)', border: 'none', borderRadius: 6,
    color: disabled ? 'var(--text3)' : 'var(--text-on-accent)', fontSize: 12, fontWeight: 700,
    padding: '8px 18px', cursor: disabled ? 'not-allowed' : 'pointer',
  }
}

// ── Selector múltiple con buscador (para dimensiones y key figures) ──
const pickBtn = { ...BTN_SEC, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }
const pickPanel = { position: 'absolute', top: '100%', left: 0, zIndex: 60, marginTop: 4, width: 300, background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }
const pickItem = sel => ({ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', fontSize: 11, fontFamily: 'var(--mono)', cursor: 'pointer', color: sel ? 'var(--accent)' : 'var(--text)', background: sel ? 'color-mix(in srgb, var(--accent) 9%, transparent)' : 'transparent' })

function MultiPick({ label, options, selected, onChange, labels = {} }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  const sel = new Set(selected)
  // Se agregan al final: el orden en que se eligen es el orden de las columnas.
  const toggle = c => (sel.has(c) ? onChange(selected.filter(x => x !== c)) : onChange([...selected, c]))
  const ql = q.toLowerCase()
  const filtered = options.filter(o => !q || o.toLowerCase().includes(ql) || String(labels[o] || '').toLowerCase().includes(ql))
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)} style={pickBtn}>
        {label} <span style={{ color: 'var(--text3)', fontWeight: 400 }}>({selected.length})</span> <span style={{ color: 'var(--text3)', fontSize: 9 }}>▾</span>
      </button>
      {open && (
        <div style={pickPanel}>
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Buscar…"
            style={{ background: 'var(--bg)', border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--text)', fontSize: 12, padding: '8px 10px', width: '100%', outline: 'none', boxSizing: 'border-box' }}
          />
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {filtered.map(o => (
              <label key={o} style={pickItem(sel.has(o))} title={labels[o] || o}>
                <input type="checkbox" checked={sel.has(o)} onChange={() => toggle(o)} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o}{labels[o] && labels[o] !== o ? <span style={{ color: 'var(--text3)' }}> — {labels[o]}</span> : null}
                </span>
              </label>
            ))}
            {filtered.length === 0 && <div style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text3)' }}>—</div>}
          </div>
        </div>
      )}
    </div>
  )
}

// Lo que pone el envoltorio de pestañas, además de la conexión:
//   active  — si esta pestaña es la que se ve. Si no, no se dibuja nada, pero sigue montada.
//   initial — la definición entera de una pestaña restaurada o duplicada (área, versión, nivel,
//             key figures, filtros, fechas, conversiones, ceros y tamaño de página).
//   onMeta  — avisa qué se mira (y si hay cambios sin guardar) para nombrar la pestaña.
//   fullscreen / onToggleFullscreen — la pantalla completa, que la lleva el envoltorio.
export default function PlanningDataViewer({
  connection, connectionId: connectionIdProp, active = true, initial = null, onMeta, fullscreen = false, onToggleFullscreen,
}) {
  const connectionId = connectionIdProp ?? connection?.id
  const isMobile = useIsMobile()

  // ── Catálogo ──
  const [catalog, setCatalog]               = useState(null)   // { areas, area, dims, cifras, etiquetas, versiones }
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError]     = useState('')
  const [catalogTick, setCatalogTick]       = useState(0)      // sube con «↺ Actualizar»

  const [selCollapsed, setSelCollapsed]   = useState(false)
  const [dataCollapsed, setDataCollapsed] = useState(false)

  // ── Selección (la de una pestaña restaurada, si la hay) ──
  const [area, setArea]       = useState(() => initial?.area || '')
  const [version, setVersion] = useState(() => initial?.version || '')   // '' = base
  const [selectedAttrs, setSelectedAttrs] = useState(() => initial?.selectedAttrs || [])
  const [timeField, setTimeField]         = useState(() => initial?.timeField || '')
  const [selectedKfs, setSelectedKfs]     = useState(() => initial?.selectedKfs || [])

  // ── Conversiones ──
  const [units, setUnits]           = useState([])
  const [currencies, setCurrencies] = useState([])
  const [selUom, setSelUom]   = useState(() => initial?.selUom || '')
  const [selCurr, setSelCurr] = useState(() => initial?.selCurr || '')

  // ── Filtros ──
  const [conds, setConds]       = useState(() => initial?.conds || [])   // condiciones sobre atributos
  const [dateFrom, setDateFrom] = useState(() => initial?.dateFrom || '')
  const [dateTo, setDateTo]     = useState(() => initial?.dateTo || '')
  const [nonZeroOnly, setNonZeroOnly] = useState(() => initial?.nonZeroOnly ?? true)   // ocultar ceros de entrada

  // ── La consulta de la tabla (null hasta «Mostrar datos») ──
  // { page, pageSize, sort, def, total, columns, keyNames, attrs, timeField, kfs }
  const [query, setQuery]       = useState(null)
  const [colOrder, setColOrder] = useState(null)   // el orden arrastrado de las columnas; null = el de la consulta
  const [pageSize, setPageSize] = useState(() => initial?.pageSize || loadPageSize())
  const [rows, setRows]         = useState([])
  const [gridLoading, setGridLoading] = useState(false)
  const [gridError, setGridError]     = useState('')
  const [applyError, setApplyError]   = useState('')   // lo que falla antes de enseñar (cuenta, conversión)
  const [applying, setApplying]       = useState(false)

  // ── Edición: solo las key figures; el nivel (dimensiones y tiempo) no se toca ──
  const [editMode, setEditMode]       = useState(false)
  const [edits, setEdits]             = useState({})    // { [rk]: { row, changes } }
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [saving, setSaving]           = useState(false)
  const [saveResult, setSaveResult]   = useState(null)

  const abortRef  = useRef(null)
  const writeBusy = useRef(false)   // contra el doble clic al guardar

  // ── Exportar a CSV (todas las páginas de la consulta) ──
  const [exporting, setExporting]           = useState(false)
  const [exportProgress, setExportProgress] = useState(null)   // { loaded, total }
  const exportAbortRef = useRef(null)

  // ── Cargar el catálogo del área ELEGIDA ──
  useEffect(() => {
    let alive = true
    const id = setTimeout(() => {
      setCatalogLoading(true); setCatalogError('')
      fetchPlanningCatalogCached(connectionId, area || undefined)
        .then(cat => {
          if (!alive) return
          setCatalog(cat)
          setCatalogLoading(false)
          // Sin área elegida se toma la primera, como en v8.
          if (!area && cat?.area) setArea(cat.area)
        })
        .catch(e => { if (alive) { setCatalogError(errText(e)); setCatalogLoading(false) } })
    }, 0)
    return () => { alive = false; clearTimeout(id) }
  }, [connectionId, area, catalogTick])

  useEffect(() => () => { abortRef.current?.abort(); exportAbortRef.current?.abort() }, [])

  // «↺ Actualizar»: olvidar lo guardado y volver a leer el catálogo de SAP.
  const refreshCatalog = useCallback(() => {
    invalidatePlanningCaches(connectionId)
    setCatalogTick(n => n + 1)
  }, [connectionId])

  // Las unidades y monedas del área, de mejor esfuerzo: si no hay, sus desplegables no aparecen.
  const catalogArea = catalog?.area || ''
  useEffect(() => {
    if (!catalogArea) return undefined
    let alive = true
    fetchConversionValuesCached(connectionId, catalogArea, 'UOMTOID').then(u => { if (alive) setUnits(u) }).catch(() => {})
    fetchConversionValuesCached(connectionId, catalogArea, 'CURRTOID').then(c => { if (alive) setCurrencies(c) }).catch(() => {})
    return () => { alive = false }
  }, [connectionId, catalogArea])

  const areas    = catalog?.areas || []
  const dims     = useMemo(() => catalog?.dims || [], [catalog])
  const labels   = useMemo(() => catalog?.etiquetas || {}, [catalog])
  const versions = catalog?.versiones || []
  const attrList = useMemo(() => dims.filter(d => !d.startsWith('PERIODID') && !READONLY_ATTRS.has(d)).sort(), [dims])
  const kfList   = useMemo(() => (catalog?.cifras || []).slice().sort(), [catalog])
  const timeLevelsAvail = useMemo(() => TIME_LEVELS.filter(tl => dims.includes(tl.field)), [dims])

  // El nivel de tiempo por omisión: el primero que tenga el área (semana, si está).
  useEffect(() => {
    if (!timeLevelsAvail.length || timeLevelsAvail.some(tl => tl.field === timeField)) return undefined
    const id = setTimeout(() => setTimeField(timeLevelsAvail[0].field), 0)
    return () => clearTimeout(id)
  }, [timeLevelsAvail, timeField])

  // Cambiar el área o la versión deja el nivel y la tabla en blanco. Solo cuando de verdad CAMBIAN:
  // una pestaña restaurada conserva lo suyo.
  function resetLevel() {
    abortRef.current?.abort()
    setSelectedAttrs([]); setSelectedKfs([])
    setConds([]); setDateFrom(''); setDateTo(''); setSelUom(''); setSelCurr('')
    setQuery(null); setColOrder(null); setRows([]); setGridError(''); setApplyError('')
    setEdits({}); setEditMode(false); setSaveResult(null)
    setSelCollapsed(false); setDataCollapsed(false)
  }
  function chooseArea(next) {
    if (next === area) return
    setArea(next); resetLevel()
  }
  function chooseVersion(next) {
    if (next === version) return
    setVersion(next); resetLevel()
  }

  useEffect(() => { try { localStorage.setItem(PAGESIZE_KEY, String(pageSize)) } catch { /* sin espacio */ } }, [pageSize])

  // Lo que se le pide a SAP: el nivel, las key figures y los filtros. El servidor arma con esto el
  // $select, el $filter —condiciones, fechas, conversiones, la versión y el de ceros— y el $orderby.
  const definicion = useMemo(() => ({
    area: catalog?.area || '',
    version,
    atributos: selectedAttrs,
    tiempo: timeField,
    cifras: selectedKfs,
    condiciones: conds.filter(c => c.field),
    desde: dateFrom,
    hasta: dateTo,
    unidad: selUom,
    moneda: selCurr,
    soloConValor: nonZeroOnly,
  }), [catalog, version, selectedAttrs, timeField, selectedKfs, conds, dateFrom, dateTo, selUom, selCurr, nonZeroOnly])

  // ── Leer una página ──
  const runLoad = useCallback(async q => {
    if (!q?.def?.area) return
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setGridLoading(true); setGridError('')
    try {
      const { filas } = await fetchKfRows(connectionId, q.def, {
        skip: (q.page - 1) * q.pageSize, top: q.pageSize, orden: q.sort, signal: ac.signal,
      })
      if (ac.signal.aborted) return
      setRows(filas || [])
    } catch (e) {
      if (e?.name === 'AbortError' || ac.signal.aborted) return
      setGridError(loadErrorText(e))
    } finally {
      if (abortRef.current === ac) setGridLoading(false)
    }
  }, [connectionId])

  // Solo se lee cuando cambia la consulta (página, orden, tamaño, lo aplicado).
  useEffect(() => {
    if (!query) return undefined
    const id = setTimeout(() => runLoad(query), 0)
    return () => clearTimeout(id)
  }, [query, runLoad])

  // Reordenar arrastrando cabeceras: solo cambia lo que se ve, sin volver a consultar.
  const gridColumns = useMemo(() => colOrder || query?.columns || [], [colOrder, query])
  const onReorderColumns = useCallback(newOrder => setColOrder(newOrder), [])

  const canShow = !!catalog?.area && !!timeField && selectedKfs.length > 0

  // «Mostrar datos» / «Aplicar»: validar, contar y traer la página 1.
  const applyAndShow = useCallback(async () => {
    if (!canShow) { setApplyError('Selecciona al menos un key figure y un nivel de tiempo.'); return }
    // Leer a otro nivel o con otro filtro deja sin sentido los cambios sin guardar.
    if (Object.keys(edits).length) {
      if (!window.confirm('Hay cambios sin guardar. ¿Descartarlos?')) return
      setEdits({})
    }
    setApplyError('')
    const columns  = [...selectedAttrs, timeField, ...selectedKfs]
    const keyNames = [...selectedAttrs, timeField]
    const def = definicion
    // La cuenta tarda unos segundos; mientras tanto se dice que se está consultando.
    setApplying(true)
    try {
      let total = 0
      try {
        total = await fetchKfCount(connectionId, def)
      } catch (e) {
        setApplyError(loadErrorText(e))
        return
      }
      // Se guarda el nivel APLICADO en la consulta: al editar y guardar se usa exactamente lo que
      // se leyó, no lo que se haya tocado después sin aplicar.
      setColOrder(null)
      setQuery({ page: 1, pageSize, sort: null, def, total, columns, keyNames, attrs: [...selectedAttrs], timeField, kfs: [...selectedKfs] })
      setSelCollapsed(true); setDataCollapsed(true)
    } finally {
      setApplying(false)
    }
  }, [canShow, edits, selectedAttrs, timeField, selectedKfs, definicion, connectionId, pageSize])

  // ── Edición: solo las key figures de la consulta aplicada ──
  const editableCols = query?.kfs || []
  // Un cambio de celda. `row` es la fila ORIGINAL: con ella se sabe si se volvió al valor de antes.
  const onCellEdit = useCallback((rk, field, value, row) => {
    setEdits(prev => {
      const orig    = row[field]
      const cur     = prev[rk] || { row, changes: {} }
      const changes = { ...cur.changes }
      if (String(value) === String(orig ?? '')) delete changes[field]
      else changes[field] = value
      const next = { ...prev }
      if (Object.keys(changes).length === 0) delete next[rk]
      else next[rk] = { row: cur.row, changes }
      return next
    })
  }, [])
  const editCount    = Object.keys(edits).length
  const discardEdits = useCallback(() => setEdits({}), [])

  // ── Avisar al envoltorio qué se mira (y si hay cambios sin guardar) ──
  const onMetaRef = useRef(onMeta)
  useEffect(() => { onMetaRef.current = onMeta })
  useEffect(() => {
    // `def` lleva la configuración entera —área, versión, nivel, filtros y opciones— para que
    // «Duplicar pestaña» dé una pestaña idéntica e independiente. Nunca filas.
    onMetaRef.current?.(
      { area, version, selectedAttrs, timeField, selectedKfs, conds, dateFrom, dateTo, nonZeroOnly, selUom, selCurr, pageSize },
      { areaId: area, versionId: version, leafLabel: selectedKfs.length ? `${selectedKfs.length} KF` : '', dirty: editCount > 0 },
    )
  }, [area, version, selectedAttrs, timeField, selectedKfs, conds, dateFrom, dateTo, nonZeroOnly, selUom, selCurr, pageSize, editCount])

  // Exportar TODAS las filas de la consulta (todas las páginas), con las columnas del nivel aplicado
  // en el orden en que se ven. Páginas grandes, porque en SAP el costo es por petición.
  const exportCsv = useCallback(async () => {
    if (!query) return
    const total = query.total ?? 0
    const { aviso, maximo } = TOPES.cifras
    if (total > maximo) { window.alert(`El export supera el tope de ${num(maximo)} filas (el filtro actual tiene ${num(total)}). Acota el filtro e inténtalo de nuevo.`); return }
    if (total > aviso && !window.confirm(`Vas a exportar ${num(total)} filas (todas las páginas). Puede tardar varios minutos y consumir bastante tráfico. ¿Continuar?`)) return

    const ac = new AbortController()
    exportAbortRef.current = ac
    setExporting(true); setExportProgress({ loaded: 0, total })
    const columns = gridColumns
    const all = []
    let truncated = false
    try {
      for (let skip = 0; ; skip += EXPORT_TOP) {
        if (ac.signal.aborted) return
        const { filas, leidas } = await fetchKfRows(connectionId, query.def, {
          skip, top: EXPORT_TOP, orden: query.sort, signal: ac.signal,
        })
        all.push(...(filas || []))
        setExportProgress({ loaded: all.length, total })
        // Se decide con lo que llegó de SAP, no con lo que quedó tras quitar ceros.
        if ((leidas ?? filas?.length ?? 0) < EXPORT_TOP) break
        if (all.length >= maximo) { truncated = true; break }   // por si la cuenta se quedó corta
      }
      if (ac.signal.aborted) return
      // Las celdas se escriben como se ven en la tabla: las fechas de OData como fecha, el resto tal cual.
      descargarTexto(MARCA_DE_CODIFICACION + filasACsv(columns, all), nombreDeArchivo([query.def.area, query.def.version || 'base', all.length]))
      if (truncated) window.alert(`Export detenido en el tope de ${num(maximo)} filas; el archivo queda incompleto. Acota el filtro para exportar todo.`)
    } catch (e) {
      if (e?.name === 'AbortError' || ac.signal.aborted) return
      window.alert(`No se pudo exportar: ${convHint(e) || errText(e)}`)
    } finally {
      setExporting(false); setExportProgress(null)
      if (exportAbortRef.current === ac) exportAbortRef.current = null
    }
  }, [query, gridColumns, connectionId])

  const cancelExport = useCallback(() => exportAbortRef.current?.abort(), [])

  // ── Guardar: revisado en el diálogo → escritura en SAP ──
  const doSave = useCallback(async () => {
    const entries = Object.values(edits)
    if (!entries.length || !query) return
    // Solo si cambió alguna key figure del nivel aplicado.
    const union = new Set()
    entries.forEach(e => Object.keys(e.changes).forEach(f => union.add(f)))
    if (!query.kfs.some(k => union.has(k))) return
    if (writeBusy.current) return            // ya se está enviando: se ignora el doble clic
    writeBusy.current = true
    setSaving(true); setSaveResult(null)
    try {
      const salida = await guardarCifras(connectionId, {
        area: query.def.area, versionId: query.def.version || '',
        atributos: query.attrs, tiempo: query.timeField, cifras: query.kfs, edits,
      })
      const result = resultadoDeEdicion(salida, entries.length)
      setSaveResult(result)
      if (result.status === 'ok') { setEdits({}); runLoad(query) }   // que la página enseñe lo guardado
    } catch (e) {
      // Una key figure calculada la rechaza SAP; el servidor lo dice con el texto de v8.
      setSaveResult({ status: 'error', message: errText(e) })
    } finally {
      setSaving(false)
      writeBusy.current = false
    }
  }, [edits, query, connectionId, runLoad])

  const pageCount = Math.max(1, Math.ceil((query?.total || 0) / (query?.pageSize || pageSize)))

  const onPageChange     = p  => setQuery(q => (q ? { ...q, page: Math.min(Math.max(1, p), pageCount) } : q))
  const onPageSizeChange = sz => { setPageSize(sz); setQuery(q => (q ? { ...q, pageSize: sz, page: 1 } : q)) }
  // Clic en una cabecera: ascendente, descendente y, a la tercera, sin orden. Ordena SAP, así que se
  // vuelve a la primera página.
  const onSort = field => setQuery(q => {
    if (!q) return q
    let sort
    if (!q.sort || q.sort.field !== field) sort = { field, dir: 'asc' }
    else if (q.sort.dir === 'asc')         sort = { field, dir: 'desc' }
    else                                   sort = null
    return { ...q, sort, page: 1 }
  })

  // ── Editor de filtros (condiciones sobre atributos) ──
  const addCond    = () => setConds(c => [...c, { field: '', op: 'in', value: '' }])
  const removeCond = i  => setConds(c => c.filter((_, idx) => idx !== i))
  const setCond    = (i, patch) => setConds(c => c.map((x, idx) => (idx === i ? { ...x, ...patch } : x)))
  const fieldOptions = useMemo(() => attrList.map(c => ({ value: c, label: labels[c] && labels[c] !== c ? `${c} — ${labels[c]}` : c })), [attrList, labels])
  const activeChips = conds.map(etiquetaDeCondicion).filter(Boolean)

  const timeLabel = f => TIME_LEVELS.find(x => x.field === f)?.label || f

  const selSummary = area ? [area, version || '(base / sin versión)'].join('  /  ') : '—'
  const levelSummary = catalog
    ? `${selectedAttrs.length} dim. × ${timeLabel(timeField)} · ${selectedKfs.length} key figure(s)`
    : ''

  // Pestaña de atrás: sigue viva pero no dibuja nada.
  if (!active) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* La configuración. A pantalla completa se esconde en cuanto hay datos, para darle todo el
          alto a la tabla; una pestaña vacía la sigue enseñando. */}
      {(!fullscreen || !query) && (
      <div style={{ padding: isMobile ? '12px' : '16px 20px', flexShrink: 0 }}>
        {catalogError && (
          <div style={{ ...SECTION, borderColor: 'var(--red)', color: 'var(--red)', fontSize: 12 }}>
            No se pudo cargar el catálogo: {catalogError}
          </div>
        )}

        {/* Área / versión */}
        <SeccionPlegable
          titulo="Selección"
          plegada={selCollapsed}
          onAlternar={() => setSelCollapsed(v => !v)}
          resumen={selSummary}
          acciones={(
            <button
              type="button"
              style={{ ...BTN_SEC, opacity: catalogLoading ? 0.6 : 1 }}
              onClick={refreshCatalog}
              disabled={catalogLoading}
              title="Vuelve a leer el catálogo de SAP (áreas, versiones y tablas). Úsalo si cambiaste una configuración en IBP y aún no se refleja."
            >
              ↺ Actualizar
            </button>
          )}
        >
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
            <div>
              <label style={LABEL}>Área de planificación</label>
              <select style={SELECT} value={area} onChange={e => chooseArea(e.target.value)} disabled={catalogLoading || areas.length <= 1}>
                {areas.length === 0 && <option value="">{catalogLoading ? '…' : '—'}</option>}
                {areas.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label style={LABEL}>Versión</label>
              <select style={SELECT} value={version} onChange={e => chooseVersion(e.target.value)} disabled={!catalog}>
                <option value="">(base / sin versión)</option>
                {versions.filter(v => v.id).map(v => <option key={v.id} value={v.id}>{v.id}{v.name && v.name !== v.id ? ` — ${v.name}` : ''}</option>)}
              </select>
            </div>
          </div>
        </SeccionPlegable>

        {/* Nivel + key figures + filtros */}
        {catalog && (
          <SeccionPlegable
            titulo="Columnas y filtros"
            plegada={dataCollapsed}
            onAlternar={() => setDataCollapsed(v => !v)}
            resumen={levelSummary}
            acciones={(
              <button type="button" style={btnPrimary(!canShow || applying)} disabled={!canShow || applying} onClick={applyAndShow}>
                {applying ? '⏳ Cargando…' : (!query ? 'Mostrar datos' : 'Aplicar')}
              </button>
            )}
          >
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10 }}>
              Elige el nivel (dimensiones + tiempo) y las key figures. SAP agrega los datos al nivel elegido; cambiarlo cambia las filas.
            </div>

            {/* El nivel */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
              <div>
                <label style={LABEL}>Dimensiones</label>
                <MultiPick label="Dimensiones" options={attrList} selected={selectedAttrs} onChange={setSelectedAttrs} labels={labels} />
              </div>
              <div>
                <label style={LABEL}>Nivel de tiempo</label>
                <select style={{ ...SELECT, width: 'auto' }} value={timeField} onChange={e => setTimeField(e.target.value)}>
                  {timeLevelsAvail.map(tl => <option key={tl.field} value={tl.field}>{tl.label}</option>)}
                </select>
              </div>
              <div>
                <label style={LABEL}>Key figures</label>
                <MultiPick label="Key figures" options={kfList} selected={selectedKfs} onChange={setSelectedKfs} labels={labels} />
              </div>
              {units.length > 0 && (
                <div>
                  <label style={LABEL}>Unidad destino</label>
                  <select style={{ ...SELECT, width: 'auto' }} value={selUom} onChange={e => setSelUom(e.target.value)}>
                    <option value="">—</option>
                    {units.map(u => <option key={u.id} value={u.id}>{u.id}{u.descripcion && u.descripcion !== u.id ? ` — ${u.descripcion}` : ''}</option>)}
                  </select>
                </div>
              )}
              {currencies.length > 0 && (
                <div>
                  <label style={LABEL}>Moneda destino</label>
                  <select style={{ ...SELECT, width: 'auto' }} value={selCurr} onChange={e => setSelCurr(e.target.value)}>
                    <option value="">—</option>
                    {currencies.map(c => <option key={c.id} value={c.id}>{c.id}{c.descripcion && c.descripcion !== c.id ? ` — ${c.descripcion}` : ''}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* Rango de fechas */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
              <div>
                <label style={LABEL}>Desde ({timeLabel(timeField)})</label>
                <input type="date" style={{ ...INPUT, width: 'auto' }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              </div>
              <div>
                <label style={LABEL}>Hasta</label>
                <input type="date" style={{ ...INPUT, width: 'auto' }} value={dateTo} onChange={e => setDateTo(e.target.value)} />
              </div>
            </div>

            {/* Ocultar las filas en cero: el mismo filtro que la migración de key figures */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text2)', marginBottom: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={nonZeroOnly} onChange={e => setNonZeroOnly(e.target.checked)} />
              Ocultar filas en cero (solo valores ≠ 0)
            </label>

            {/* Filtros sobre atributos */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Filtros (opcional)</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10 }}>
                El filtro lo resuelve SAP: solo se traen las filas que coinciden, nunca se descarga la tabla completa.
              </div>
              {conds.map((c, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ width: isMobile ? '100%' : 220 }}>
                    <SearchSelect value={c.field} options={fieldOptions} onChange={v => setCond(i, { field: v })} placeholder="Campo…" searchPlaceholder="Buscar valor…" />
                  </div>
                  <select style={{ ...SELECT, width: 'auto' }} value={c.op} onChange={e => setCond(i, { op: e.target.value })}>
                    <option value="in">igual / en lista</option>
                    <option value="sw">comienza con</option>
                  </select>
                  {c.op === 'sw' ? (
                    <input
                      value={c.value}
                      onChange={e => setCond(i, { value: e.target.value })}
                      placeholder="Prefijo…"
                      style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11, padding: '4px 8px', flex: 1, minWidth: 140, outline: 'none', fontFamily: 'var(--mono)' }}
                    />
                  ) : (
                    <MultiValueSelect
                      value={c.value}
                      onChange={v => setCond(i, { value: v })}
                      placeholder="Valores (separados por coma)…"
                      disabled={!c.field}
                      loadValues={() => fetchAttrValues(connectionId, { area: catalog.area, campo: c.field })}
                    />
                  )}
                  <button type="button" title="Quitar condición" onClick={() => removeCond(i)} style={{ ...BTN_SEC, padding: '5px 9px', color: 'var(--red)', borderColor: 'var(--border)' }}>×</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                <button type="button" style={BTN_SEC} onClick={addCond}>+ Añadir condición</button>
                {activeChips.length > 0 && <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--mono)' }}>{activeChips.join('  ·  ')}</span>}
              </div>
            </div>

            {applyError && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 10 }}>{applyError}</div>}
          </SeccionPlegable>
        )}
      </div>
      )}

      {/* La tabla, o lo que falta para verla */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: isMobile ? '0 12px 12px' : '0 20px 16px' }}>
        {applying && !query && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>⏳ Cargando datos… (consultando SAP)</div>
        )}
        {!applying && !catalog && !catalogError && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Leyendo estructura de la tabla…</div>
        )}
        {!applying && catalog && !query && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Elige nivel y key figures, y pulsa «Mostrar datos».</div>
        )}
        {query && (
          <DataGrid
            columns={gridColumns}
            onReorder={onReorderColumns}
            rows={rows}
            keyNames={query.keyNames}
            loading={gridLoading}
            error={gridError}
            sort={query.sort}
            onSort={onSort}
            page={query.page}
            pageCount={pageCount}
            pageSize={query.pageSize}
            total={query.total}
            pageSizeOptions={PAGE_SIZES}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
            editMode={editMode}
            editableCols={editableCols}
            edits={edits}
            editCount={editCount}
            editHint="Modo edición: solo las key figures son editables; dimensiones y tiempo están bloqueados. Las key figures calculadas no se pueden guardar."
            onToggleEdit={() => setEditMode(v => !v)}
            onCellEdit={onCellEdit}
            onSaveEdits={() => { setSaveResult(null); setShowSaveModal(true) }}
            onDiscardEdits={discardEdits}
            fullscreen={fullscreen}
            onToggleFullscreen={onToggleFullscreen}
            onExport={exportCsv}
            exporting={exporting}
            exportProgress={exportProgress}
            onCancelExport={cancelExport}
          />
        )}
      </div>

      <EditReviewModal
        open={showSaveModal}
        edits={edits}
        keyNames={query?.keyNames || []}
        saving={saving}
        result={saveResult}
        onConfirm={doSave}
        onClose={() => setShowSaveModal(false)}
      />
    </div>
  )
}
