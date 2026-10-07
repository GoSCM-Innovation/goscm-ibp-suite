// «Ver Dato Maestro»: mirar, editar y borrar el dato maestro de un tenant.
//
// Portado tal cual de `DataViewer/MasterDataViewer.jsx` de v8: las mismas dos secciones plegables
// —«Selección» con sus tres desplegables rotulados y «↺ Actualizar», y «Columnas y filtros»—, la
// misma versión «(base / sin versión)», el área virtual de dato maestro simple, la misma tabla con su
// barra de edición y exportación, y los mismos diálogos de revisión y de borrado.
//
// El recorrido: área → versión → tabla. Al elegir la tabla se lee SOLO su estructura y cuántas filas
// tiene, nunca las filas. Los filtros los resuelve SAP ($filter) y hay que pulsar «Mostrar datos»
// para traer la primera página. Toda lectura va paginada por SAP ($skip/$top) y sobre las columnas
// elegidas ($select): nunca se baja una tabla entera. Las claves van SIEMPRE en el $select aunque no
// se miren, para que cada fila se pueda identificar al editarla o borrarla.
//
// Lo único que cambia respecto de v8 es DÓNDE se habla con SAP: aquí es el servidor, porque las
// credenciales viven cifradas allí y nunca llegan al navegador.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { etiquetaDeCondicion, filtroDeCondiciones } from '../../../core/ibp/master-data-model.js'
import { TOPES } from '../../../core/ibp/export-csv.js'
import { volcarACsv } from '../../lib/descargar-csv.js'
import {
  fetchMasterCatalogCached, fetchMasterCount, fetchMasterMetadataCached, fetchMasterRows,
  fetchMasterSchema, fetchMasterValues, invalidateMasterCaches,
} from '../../lib/ibp-master-data.js'
import { borrarDatoMaestro, guardarDatoMaestro } from '../../lib/ibp-master-data-edit.js'
import { useIsMobile } from '../../lib/useIsMobile.js'
import BotonActualizar from '../ui/BotonActualizar.jsx'
import SeccionPlegable from '../ui/SeccionPlegable.jsx'
import ColumnPicker from './ColumnPicker.jsx'
import DataGrid from './DataGrid.jsx'
import DeleteConfirmModal from './DeleteConfirmModal.jsx'
import EditReviewModal from './EditReviewModal.jsx'
import { MultiValueSelect, SearchSelect } from './FilterControls.jsx'

// El área virtual que agrupa las tablas de dato maestro SIMPLE (no específicas de versión). No
// llevan PlanningAreaID, así que SAP no las puede atribuir a un área real.
const SIMPLE_PA = '__SIMPLE__'

// ── Lo que se recuerda en este navegador, como en v8 ──
const COLS_KEY     = (connId, mdt) => `ibp:viewer:cols:master:${connId}:${mdt}`
const PAGESIZE_KEY = 'ibp:viewer:pagesize'
const PAGE_SIZES   = [50, 100, 200, 500]

// Campos que SAP devuelve al leer y rechaza al escribir: el contexto de la transacción y la
// auditoría.
const READONLY_FIELDS = new Set(['PlanningAreaID', 'VersionID', 'CREATEDDATE', 'LASTMODIFIEDDATE'])

function loadCols(connId, mdt) {
  try { return JSON.parse(localStorage.getItem(COLS_KEY(connId, mdt))) || null } catch { return null }
}
function saveCols(connId, mdt, cols) {
  try { localStorage.setItem(COLS_KEY(connId, mdt), JSON.stringify(cols)) } catch { /* sin espacio */ }
}
function loadPageSize() {
  let n = 500
  try { n = parseInt(localStorage.getItem(PAGESIZE_KEY) || '500', 10) } catch { /* nada guardado */ }
  return PAGE_SIZES.includes(n) ? n : 500
}

// Lo que se ve de entrada: las claves y las descripciones si las hay; si no, todas.
function defaultSelection(allColumns, keyNames) {
  const keySet = new Set(keyNames)
  const sel = allColumns.filter(c => keySet.has(c) || /DESCR/i.test(c))
  return sel.length > 0 ? sel : [...allColumns]
}

const errText = e => (e == null ? 'Error' : (typeof e === 'string' ? e : (e.message || String(e))))
const num = n => Number(n ?? 0).toLocaleString()

// Las condiciones que de verdad filtran. Una a medio escribir no cuenta.
const condsCompletas = conds => (conds || []).filter(c => c.field)

// ── Estilos de v8 ──
const SECTION = { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }
const LABEL   = { fontSize: 10, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 5, display: 'block' }
const SELECT  = { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12, padding: '7px 10px', width: '100%', outline: 'none' }
const BTN_SEC = { background: 'none', border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--text2)', fontSize: 12, fontWeight: 600, padding: '7px 12px', cursor: 'pointer' }
function btnPrimary(disabled) {
  return {
    background: disabled ? 'var(--border2)' : 'var(--accent)', border: 'none', borderRadius: 6,
    color: disabled ? 'var(--text3)' : 'var(--text-on-accent)', fontSize: 12, fontWeight: 700,
    padding: '8px 18px', cursor: disabled ? 'not-allowed' : 'pointer',
  }
}

// Lo que pone el envoltorio de pestañas, además de la conexión:
//   active  — si esta pestaña es la que se ve. Si no, no se dibuja nada, pero el componente sigue
//             montado y conserva su página.
//   initial — { pa, version, mdt, conds, cols, pageSize } para rehacer una pestaña restaurada o duplicada.
//   onMeta  — avisa qué está mirando (y si tiene cambios sin guardar) para nombrar la pestaña.
//   fullscreen / onToggleFullscreen — la pantalla completa, que la lleva el envoltorio.
export default function MasterDataViewer({ connectionId, active = true, initial = null, onMeta, fullscreen = false, onToggleFullscreen }) {
  const isMobile = useIsMobile()

  // ── Catálogo ──
  const [catalog, setCatalog]               = useState(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError]     = useState('')
  const [catalogTick, setCatalogTick]       = useState(0)   // sube con «↺ Actualizar»

  // Etiquetas de campo («ID — descripción») y catálogo de tablas simples, del $metadata.
  const [fieldLabels, setFieldLabels]     = useState({})
  const [simpleCatalog, setSimpleCatalog] = useState({})

  // ── Secciones plegables: abiertas mientras se configura, se pliegan al cargar datos. ──
  const [selCollapsed, setSelCollapsed]   = useState(false)
  const [dataCollapsed, setDataCollapsed] = useState(false)

  // ── Selección (la de una pestaña restaurada, si la hay) ──
  const [pa, setPa]           = useState(() => initial?.pa || '')
  const [version, setVersion] = useState(() => initial?.version || '')   // '' = base / sin versión
  const [mdt, setMdt]         = useState(() => initial?.mdt || '')

  // ── Estructura de la tabla elegida ──
  const [schema, setSchema]               = useState(null)   // { allColumns, keyNames, total }
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [schemaError, setSchemaError]     = useState('')
  const [selectedCols, setSelectedCols]   = useState([])   // borrador: se toca sin consultar
  const [appliedCols, setAppliedCols]     = useState([])   // lo aplicado con el botón: lo que se ve

  // ── Filtros ──
  const [conds, setConds]           = useState(() => initial?.conds || [])  // [{ field, op: 'in'|'sw', value }]
  const [filterTest, setFilterTest] = useState(null)   // { loading?, n?, total?, error? }
  // Las columnas que trae una pestaña duplicada o restaurada: se usan una vez, en la primera lectura.
  const hydrateColsRef = useRef(initial?.cols || null)

  // ── La consulta de la tabla (null hasta «Mostrar datos») ──
  // { page, pageSize, sort: { field, dir } | null, conds, filter, total }
  const [query, setQuery]       = useState(null)
  const [pageSize, setPageSize] = useState(() => initial?.pageSize || loadPageSize())
  const [rows, setRows]         = useState([])
  const [gridLoading, setGridLoading] = useState(false)
  const [gridError, setGridError]     = useState('')
  const [applying, setApplying]       = useState(false)

  // ── Edición ──
  const [editMode, setEditMode]       = useState(false)
  const [edits, setEdits]             = useState({})    // { [rk]: { row, changes } } — sobrevive a pasar de página
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [saving, setSaving]           = useState(false)
  const [saveResult, setSaveResult]   = useState(null)

  // ── Selección para borrar ──
  const [selected, setSelected]           = useState({})    // { [rk]: row } — sobrevive a pasar de página
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleting, setDeleting]           = useState(false)
  const [deleteResult, setDeleteResult]   = useState(null)

  const abortRef  = useRef(null)
  const writeBusy = useRef(false)   // contra el doble clic al guardar o borrar

  // ── Exportar a CSV (todas las páginas de la consulta) ──
  const [exporting, setExporting]           = useState(false)
  const [exportProgress, setExportProgress] = useState(null)   // { loaded, total }
  const exportAbortRef = useRef(null)

  // ── Cargar el catálogo ──
  useEffect(() => {
    let alive = true
    const id = setTimeout(() => {
      setCatalogLoading(true); setCatalogError('')
      fetchMasterCatalogCached(connectionId)
        .then(r => { if (alive) setCatalog(r?.catalogo ?? {}) })
        .catch(e => { if (alive) setCatalogError(errText(e)) })
        .finally(() => { if (alive) setCatalogLoading(false) })
      // Las etiquetas y las tablas simples son de mejor esfuerzo: sin ellas, nombres técnicos.
      fetchMasterMetadataCached(connectionId)
        .then(m => { if (alive) { setFieldLabels(m.etiquetas || {}); setSimpleCatalog(m.simples || {}) } })
    }, 0)
    return () => { alive = false; clearTimeout(id) }
  }, [connectionId, catalogTick])

  useEffect(() => () => { abortRef.current?.abort(); exportAbortRef.current?.abort() }, [])

  // «↺ Actualizar»: olvidar lo guardado y volver a descubrir el catálogo en SAP. Recupera un cambio
  // de configuración en IBP (un área, versión o tabla nueva) sin esperar a que caduque el día.
  const refreshCatalog = useCallback(() => {
    invalidateMasterCaches(connectionId)
    setCatalogTick(n => n + 1)
  }, [connectionId])

  // El área de dato maestro simple: sus tablas salen del $metadata y no tiene versiones. Sus
  // lecturas NO llevan PlanningAreaID ni VersionID —esas tablas los rechazan—, así que para ella el
  // área y la versión que se mandan son vacías.
  const isSimple     = pa === SIMPLE_PA
  const simpleTables = useMemo(() => Object.keys(simpleCatalog).sort(), [simpleCatalog])
  const readPA       = isSimple ? '' : pa
  const readVersion  = isSimple ? '' : version

  const pas = useMemo(() => {
    const base = Object.entries(catalog || {})
      .map(([id, { desc }]) => ({ id, desc }))
      .sort((a, b) => a.id.localeCompare(b.id))
    return simpleTables.length ? [...base, { id: SIMPLE_PA, desc: 'Dato maestro simple (sin versión)' }] : base
  }, [catalog, simpleTables])
  const versions = useMemo(() => (isSimple || !pa ? [] : (catalog?.[pa]?.versions || [])), [catalog, pa, isSimple])
  // Con la versión base se ofrecen TODAS las tablas del área: la unión de las de sus versiones.
  const mdts = useMemo(() => {
    if (isSimple) return simpleTables
    const entry = pa ? catalog?.[pa] : null
    if (!entry) return []
    if (!version) {
      const all = new Set()
      entry.versions.forEach(v => v.mdts.forEach(m => all.add(m)))
      return [...all].sort()
    }
    const v = entry.versions.find(x => x.id === version)
    return v ? [...v.mdts].sort() : []
  }, [catalog, pa, version, isSimple, simpleTables])

  // Si hay una sola área, se elige sola. Con varias no se adivina.
  useEffect(() => {
    if (pa || pas.length !== 1) return undefined
    const id = setTimeout(() => setPa(pas[0].id), 0)
    return () => clearTimeout(id)
  }, [pas, pa])

  // Cambiar el área limpia la versión y la tabla; cambiar la versión limpia la tabla. Solo cuando
  // de verdad CAMBIAN, no al montar: una pestaña restaurada conserva lo suyo.
  function chooseArea(next) {
    if (next === pa) return
    setPa(next); setVersion(''); setMdt('')
  }
  function chooseVersion(next) {
    if (next === version) return
    setVersion(next); setMdt('')
  }

  // ── Al cambiar de tabla: se limpia lo mirado y se lee la estructura (NO las filas) ──
  // Se compara con la tabla anterior para que la primera vez —al montar— no borre los filtros de
  // una pestaña restaurada o duplicada.
  // El catálogo de simples solo importa si la tabla es simple: que llegue tarde no debe releer la
  // estructura de una tabla normal.
  const simpleDep = pa === SIMPLE_PA ? simpleCatalog : null
  const prevTableRef = useRef(`${pa}|${version}|${mdt}`)
  useEffect(() => {
    const tableKey = `${pa}|${version}|${mdt}`
    const tableChanged = prevTableRef.current !== tableKey
    prevTableRef.current = tableKey
    let alive = true
    const ac = new AbortController()

    const id = setTimeout(() => {
      abortRef.current?.abort()
      setQuery(null); setRows([]); setGridError('')
      if (tableChanged) { setConds([]); setFilterTest(null) }
      setSchema(null); setSchemaError('')
      // Los cambios y las filas marcadas eran de la tabla anterior.
      setEdits({}); setEditMode(false); setSaveResult(null)
      setSelected({}); setDeleteResult(null)
      setSelCollapsed(false); setDataCollapsed(false)
      if (!mdt) return
      setSchemaLoading(true)

      // Deja la estructura y elige las columnas de entrada.
      const applySchema = (allColumns, keyNames, total) => {
        if (!alive) return
        setSchema({ allColumns, keyNames, total })
        const saved = loadCols(connectionId, mdt)
        let validSaved = saved ? saved.filter(c => allColumns.includes(c)) : []
        // Una selección guardada que no tiene NINGUNA clave de esta tabla no es de verdad de esta
        // tabla: se descarta y se usa la de entrada, que sí las lleva.
        if (validSaved.length && keyNames.length && !validSaved.some(c => keyNames.includes(c))) validSaved = []
        const hydrateCols = hydrateColsRef.current
        hydrateColsRef.current = null
        const validHydrate = hydrateCols ? hydrateCols.filter(c => allColumns.includes(c)) : []
        const initialCols = validHydrate.length ? validHydrate
          : (validSaved.length ? validSaved : defaultSelection(allColumns, keyNames))
        setSelectedCols(initialCols)
        setAppliedCols(initialCols)
      }

      // Tabla simple: la estructura sale del $metadata, así que funciona aunque esté vacía. Solo
      // se cuenta en vivo, y siempre SIN área ni versión.
      if (pa === SIMPLE_PA) {
        const entry = simpleDep?.[mdt]
        if (!entry) { setSchemaLoading(false); return }
        fetchMasterCount(connectionId, { entidad: mdt, planningArea: '', versionId: '' })
          .then(total => applySchema(entry.fields || [], entry.keys || [], total))
          // Sin cuenta la estructura igual se conoce: se enseña con el total en cero antes que
          // bloquear la tabla por una cuenta lenta.
          .catch(() => { if (alive && !ac.signal.aborted) applySchema(entry.fields || [], entry.keys || [], 0) })
          .finally(() => { if (alive) setSchemaLoading(false) })
        return
      }

      fetchMasterSchema(connectionId, { entidad: mdt, planningArea: pa, versionId: version })
        .then(s => applySchema(s.columnas || [], s.claves || [], s.total ?? 0))
        .catch(e => { if (alive) setSchemaError(errText(e)) })
        .finally(() => { if (alive) setSchemaLoading(false) })
    }, 0)

    return () => { alive = false; ac.abort(); clearTimeout(id) }
  }, [mdt, pa, version, connectionId, simpleDep])

  // Las columnas se guardan SOLO cuando las cambia quien mira, y para la tabla abierta.
  const onColumnsChange = useCallback(cols => {
    setSelectedCols(cols)
    if (mdt) saveCols(connectionId, mdt, cols)
  }, [mdt, connectionId])

  // Reordenar arrastrando: cambia el orden de lo que se ve y del borrador. Sin consultar: son los
  // mismos datos en otro orden.
  const onReorderColumns = useCallback(newOrder => {
    setAppliedCols(newOrder)
    setSelectedCols(prev => {
      const prevSet = new Set(prev)
      const ordered = newOrder.filter(c => prevSet.has(c))
      const extras  = prev.filter(c => !newOrder.includes(c))
      const next = [...ordered, ...extras]
      if (mdt) saveCols(connectionId, mdt, next)
      return next
    })
  }, [mdt, connectionId])

  useEffect(() => { try { localStorage.setItem(PAGESIZE_KEY, String(pageSize)) } catch { /* sin espacio */ } }, [pageSize])

  const extraFilter = useMemo(() => filtroDeCondiciones(condsCompletas(conds)) || undefined, [conds])

  // ── Edición ──
  // Se edita todo menos las claves de negocio y los campos que SAP maneja solo.
  const editableCols = useMemo(() => {
    if (!schema) return []
    const keySet = new Set(schema.keyNames)
    return schema.allColumns.filter(c => !keySet.has(c) && !READONLY_FIELDS.has(c))
  }, [schema])

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

  // El $orderby: la columna elegida primero y las claves detrás. Las claves no son decoración: un
  // orden estable es obligatorio al paginar, o dos páginas seguidas traen la misma fila y pierden
  // otra. v8 ordenaba solo por la columna elegida.
  const orderFor = useCallback((sort, keyNames) => {
    if (!sort) return keyNames.length ? keyNames : undefined
    const first = `${sort.field}${sort.dir === 'desc' ? ' desc' : ''}`
    return [first, ...keyNames.filter(k => k !== sort.field)]
  }, [])

  // ── Leer una página de la consulta ──
  const runLoad = useCallback(async q => {
    if (!mdt || !schema) return
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setGridLoading(true); setGridError('')
    // Las claves van siempre, aunque no se vean: son lo que identifica la fila al editar o borrar.
    const select = [...new Set([...appliedCols, ...schema.keyNames])]
    try {
      const data = await fetchMasterRows(connectionId, {
        entidad: mdt, planningArea: readPA, versionId: readVersion, condiciones: q.conds,
        select, orderby: orderFor(q.sort, schema.keyNames),
        skip: (q.page - 1) * q.pageSize, top: q.pageSize, signal: ac.signal,
      })
      if (ac.signal.aborted) return
      setRows(data)
    } catch (e) {
      if (e?.name === 'AbortError' || ac.signal.aborted) return
      setGridError(`No se pudieron cargar los datos: ${errText(e)}`)
    } finally {
      if (abortRef.current === ac) setGridLoading(false)
    }
  }, [mdt, schema, appliedCols, connectionId, readPA, readVersion, orderFor])

  // Solo se lee cuando cambia la consulta (página, orden, filtro, columnas aplicadas). Tocar
  // columnas no consulta: espera al botón.
  useEffect(() => {
    if (!query) return undefined
    const id = setTimeout(() => runLoad(query), 0)
    return () => clearTimeout(id)
  }, [query]) // eslint-disable-line react-hooks/exhaustive-deps

  // «Mostrar datos» / «Aplicar»: contar con el filtro puesto y traer la página 1.
  const applyAndShow = useCallback(async () => {
    if (!mdt || !schema) return
    // Cambiar columnas o filtro vuelve a leer: los cambios sin guardar dejarían de cuadrar.
    if (Object.keys(edits).length) {
      if (!window.confirm('Hay cambios sin guardar. ¿Descartarlos?')) return
      setEdits({})
    }
    setSelected({})
    setApplying(true)
    try {
      // Se cuenta en CADA aplicación: los datos pueden haber cambiado, y con la cuenta vieja el
      // total y las páginas mentirían. Sin filtro, esta cuenta es la de la tabla entera.
      const activeConds = condsCompletas(conds)
      let total = schema.total
      try {
        total = await fetchMasterCount(connectionId, { entidad: mdt, planningArea: readPA, versionId: readVersion, condiciones: activeConds })
      } catch { /* se queda el total anterior */ }
      if (!extraFilter) setSchema(s => (s ? { ...s, total } : s))
      setAppliedCols(selectedCols)
      setQuery({ page: 1, pageSize, sort: null, conds: activeConds, filter: extraFilter, total })
      // Con los datos a la vista, se pliega la configuración para darle aire a la tabla.
      setSelCollapsed(true); setDataCollapsed(true)
    } finally {
      setApplying(false)
    }
  }, [mdt, schema, extraFilter, conds, selectedCols, connectionId, readPA, readVersion, pageSize, edits])

  // Exportar TODAS las filas de la consulta (todas las páginas) a un CSV. Páginas grandes, porque en
  // SAP el costo es por petición y no por fila.
  const exportCsv = useCallback(async () => {
    if (!mdt || !schema || !query) return
    const total = query.total ?? schema.total ?? 0
    const { aviso, maximo } = TOPES.maestro
    if (total > maximo) { window.alert(`El export supera el tope de ${num(maximo)} filas (el filtro actual tiene ${num(total)}). Acota el filtro e inténtalo de nuevo.`); return }
    if (total > aviso && !window.confirm(`Vas a exportar ${num(total)} filas (todas las páginas). Puede tardar varios minutos y consumir bastante tráfico. ¿Continuar?`)) return

    const ac = new AbortController()
    exportAbortRef.current = ac
    setExporting(true); setExportProgress({ loaded: 0, total })
    // Se exportan EXACTAMENTE las columnas que se ven, en su orden. Las claves se leen para que el
    // orden sea estable entre páginas, pero al archivo llegan solo si están a la vista.
    const exportCols = appliedCols.length ? appliedCols : [...schema.allColumns]
    const select  = [...new Set([...exportCols, ...schema.keyNames])]
    const orderby = orderFor(query.sort, schema.keyNames)
    try {
      const salida = await volcarACsv({
        columnas: exportCols,
        leerPagina: ({ skip, top, signal }) => fetchMasterRows(connectionId, {
          entidad: mdt, planningArea: readPA, versionId: readVersion, condiciones: query.conds,
          select, orderby, skip, top, signal,
        }),
        nombre: [mdt, (isSimple ? 'simple' : version) || 'base'],
        total,
        tope: maximo,
        signal: ac.signal,
        onAvance: a => setExportProgress({ loaded: a.leidas, total: a.total }),
      })
      if (salida?.cortado) window.alert(`Export detenido en el tope de ${num(maximo)} filas; el archivo queda incompleto. Acota el filtro para exportar todo.`)
    } catch (e) {
      if (e?.name === 'AbortError' || ac.signal.aborted) return
      window.alert(`No se pudo exportar: ${errText(e)}`)
    } finally {
      setExporting(false); setExportProgress(null)
      if (exportAbortRef.current === ac) exportAbortRef.current = null
    }
  }, [mdt, schema, query, appliedCols, connectionId, readPA, readVersion, isSimple, version, orderFor])

  const cancelExport = useCallback(() => exportAbortRef.current?.abort(), [])

  // Lo que devolvió SAP, con los criterios de v8: un mensaje de gravedad E o A es un registro
  // rechazado; una transacción marcada con error, un fallo.
  const resultOf = (salida, count) => {
    const errors = (salida?.mensajes || []).filter(m => ['E', 'A'].includes(m.Severity))
    const status = errors.length ? 'warning' : (salida?.estado === 'CON_ERROR' ? 'error' : 'ok')
    return { status, count, errors, message: salida?.estado === 'CON_ERROR' ? 'SAP marcó la transacción con error al procesar.' : '' }
  }

  // ── Guardar: revisado en el diálogo → escritura en SAP ──
  const doSave = useCallback(async () => {
    const entries = Object.entries(edits)
    if (!entries.length || !schema) return
    if (writeBusy.current) return
    writeBusy.current = true
    setSaving(true); setSaveResult(null)
    try {
      const salida = await guardarDatoMaestro(connectionId, {
        entidad: mdt, planningArea: readPA, versionId: readVersion, claves: schema.keyNames,
        edits: Object.fromEntries(entries.map(([rk, { row, changes }]) => [rk, { fila: row, cambios: changes }])),
      })
      const result = resultOf(salida, entries.length)
      setSaveResult(result)
      if (result.status === 'ok') {
        setEdits({})
        if (query) runLoad(query)   // que la página enseñe lo que quedó guardado
      }
    } catch (e) {
      setSaveResult({ status: 'error', message: errText(e) })
    } finally {
      setSaving(false)
      writeBusy.current = false
    }
  }, [edits, schema, connectionId, mdt, readPA, readVersion, query, runLoad])

  const selCount = Object.keys(selected).length

  // ── Avisar al envoltorio qué se mira (y si hay cambios sin guardar) ──
  const onMetaRef = useRef(onMeta)
  useEffect(() => { onMetaRef.current = onMeta })
  useEffect(() => {
    // `def` lleva la configuración entera —selección, filtros, columnas, página— para que
    // «Duplicar pestaña» dé una pestaña idéntica e independiente. Nunca filas.
    onMetaRef.current?.(
      { pa, version, mdt, conds, cols: selectedCols, pageSize },
      { areaId: pa, versionId: version, leafLabel: mdt, dirty: editCount > 0 || selCount > 0 },
    )
  }, [pa, version, mdt, conds, selectedCols, pageSize, editCount, selCount])

  const onToggleRow = useCallback((rk, row) => {
    setSelected(prev => {
      const next = { ...prev }
      if (next[rk]) delete next[rk]; else next[rk] = row
      return next
    })
  }, [])
  const onToggleAllPage = useCallback((rowsOnPage, checked) => {
    setSelected(prev => {
      const next = { ...prev }
      for (const { rk, row } of rowsOnPage) {
        if (checked) next[rk] = row; else delete next[rk]
      }
      return next
    })
  }, [])

  // Tras borrar hay menos filas: se vuelve a contar y se relee la página (acotada).
  const refreshAfterDelete = useCallback(async () => {
    if (!query || !mdt) return
    let total = query.total
    try {
      total = await fetchMasterCount(connectionId, { entidad: mdt, planningArea: readPA, versionId: readVersion, condiciones: query.conds })
    } catch { /* se queda el total anterior */ }
    setQuery(q => {
      if (!q) return q
      const pages = Math.max(1, Math.ceil(total / q.pageSize))
      return { ...q, total, page: Math.min(q.page, pages) }
    })
  }, [query, mdt, connectionId, readPA, readVersion])

  // ── Borrar: confirmado en el diálogo → borrado en SAP ──
  const doDelete = useCallback(async () => {
    const entries = Object.values(selected)
    if (!entries.length || !schema) return
    if (writeBusy.current) return
    writeBusy.current = true
    setDeleting(true); setDeleteResult(null)
    try {
      const salida = await borrarDatoMaestro(connectionId, {
        entidad: mdt, planningArea: readPA, versionId: readVersion, claves: schema.keyNames, filas: entries,
      })
      const result = resultOf(salida, entries.length)
      setDeleteResult(result)
      if (result.status === 'ok') {
        setSelected({})
        await refreshAfterDelete()
      }
    } catch (e) {
      setDeleteResult({ status: 'error', message: errText(e) })
    } finally {
      setDeleting(false)
      writeBusy.current = false
    }
  }, [selected, schema, connectionId, mdt, readPA, readVersion, refreshAfterDelete])

  const pageCount = Math.max(1, Math.ceil((query?.total || 0) / (query?.pageSize || pageSize)))

  const onPageChange     = p  => setQuery(q => (q ? { ...q, page: Math.min(Math.max(1, p), pageCount) } : q))
  const onPageSizeChange = sz => { setPageSize(sz); setQuery(q => (q ? { ...q, pageSize: sz, page: 1 } : q)) }
  // Clic en una cabecera: ascendente, descendente y, a la tercera, sin orden. Ordena SAP la tabla
  // entera, así que se vuelve a la primera página.
  const onSort = field => setQuery(q => {
    if (!q) return q
    let sort
    if (!q.sort || q.sort.field !== field) sort = { field, dir: 'asc' }
    else if (q.sort.dir === 'asc')         sort = { field, dir: 'desc' }
    else                                   sort = null
    return { ...q, sort, page: 1 }
  })

  // ── Editor de filtros ──
  const addCond    = () => setConds(c => [...c, { field: '', op: 'in', value: '' }])
  const removeCond = i  => setConds(c => c.filter((_, idx) => idx !== i))
  const setCond    = (i, patch) => setConds(c => c.map((x, idx) => (idx === i ? { ...x, ...patch } : x)))

  const fieldOptions = useMemo(
    () => (schema?.allColumns || []).slice().sort().map(c => ({
      value: c,
      label: fieldLabels[c] && fieldLabels[c] !== c ? `${c} — ${fieldLabels[c]}` : c,
    })),
    [schema, fieldLabels],
  )

  async function testFilter() {
    if (!mdt) return
    setFilterTest({ loading: true })
    try {
      const n = await fetchMasterCount(connectionId, { entidad: mdt, planningArea: readPA, versionId: readVersion, condiciones: condsCompletas(conds) })
      setFilterTest({ n, total: schema?.total ?? 0 })
    } catch (e) {
      setFilterTest({ error: errText(e) })
    }
  }

  const activeChips = conds.map(etiquetaDeCondicion).filter(Boolean)

  // ¿Hay columnas o filtro tocados que todavía no se aplicaron? Cambia el texto del botón.
  const pendingChanges = useMemo(() => {
    if (!query) return false
    const a = new Set(appliedCols)
    const colsDirty = selectedCols.length !== appliedCols.length || selectedCols.some(c => !a.has(c))
    const filterDirty = (extraFilter || undefined) !== (query.filter || undefined)
    return colsDirty || filterDirty
  }, [query, selectedCols, appliedCols, extraFilter])

  // Lo que dice cada sección plegada, para no perder el contexto.
  const selSummary = pa
    ? [isSimple ? 'Dato maestro simple (sin versión)' : pa, isSimple ? '' : (version || '(base / sin versión)'), mdt].filter(Boolean).join('  /  ')
    : '—'
  const dataSummary = schema
    ? `${selectedCols.length}/${schema.allColumns.length} columnas · ${conds.length} filtros`
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

        <SeccionPlegable
          titulo="Selección"
          plegada={selCollapsed}
          onAlternar={() => setSelCollapsed(v => !v)}
          resumen={selSummary}
          acciones={(
            <BotonActualizar
              style={BTN_SEC}
              onClick={refreshCatalog}
              cargando={catalogLoading}
              mensaje="Leyendo áreas, versiones y tablas de SAP…"
              confirmar
              error={Boolean(catalogError)}
              title="Vuelve a leer el catálogo de SAP (áreas, versiones y tablas). Úsalo si cambiaste una configuración en IBP y aún no se refleja."
            />
          )}
        >
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1.4fr', gap: 12 }}>
            <div>
              <label style={LABEL}>Área de planificación</label>
              <select style={SELECT} value={pa} onChange={e => chooseArea(e.target.value)} disabled={catalogLoading}>
                <option value="">{catalogLoading ? '…' : '—'}</option>
                {pas.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.id === SIMPLE_PA ? p.desc : `${p.id}${p.desc && p.desc !== p.id ? ` — ${p.desc}` : ''}`}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={LABEL}>Versión</label>
              <select style={SELECT} value={version} onChange={e => chooseVersion(e.target.value)} disabled={!pa || isSimple}>
                <option value="">(base / sin versión)</option>
                {versions.map(v => <option key={v.id} value={v.id}>{v.id}{v.name && v.name !== v.id ? ` — ${v.name}` : ''}</option>)}
              </select>
            </div>
            <div>
              <label style={LABEL}>Tabla (dato maestro)</label>
              <SearchSelect
                value={mdt}
                options={mdts.map(m => ({ value: m, label: m }))}
                onChange={setMdt}
                placeholder={pa ? 'Selecciona una tabla…' : 'Selecciona un área de planificación y una tabla para empezar.'}
                searchPlaceholder="Buscar tabla…"
              />
            </div>
          </div>
          {isSimple && (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 10 }}>
              ⓘ Tablas de dato maestro no específicas por versión (la API no las liga a un área). Se leen, editan y borran directamente, sin versión.
            </div>
          )}
        </SeccionPlegable>

        {mdt && schemaLoading && (
          <div style={SECTION}>
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>Leyendo estructura de la tabla…</div>
          </div>
        )}
        {mdt && schemaError && !schemaLoading && (
          <div style={SECTION}>
            <div style={{ fontSize: 12, color: 'var(--red)' }}>No se pudo leer la estructura de la tabla: {schemaError}</div>
          </div>
        )}
        {mdt && schema && !schemaLoading && (
          <SeccionPlegable
            titulo="Columnas y filtros"
            plegada={dataCollapsed}
            onAlternar={() => setDataCollapsed(v => !v)}
            resumen={dataSummary}
            acciones={(
              <button
                type="button"
                style={btnPrimary(!schema.allColumns.length || applying)}
                disabled={!schema.allColumns.length || applying}
                onClick={applyAndShow}
              >
                {applying ? '⏳ Cargando…' : (!query ? 'Mostrar datos' : (pendingChanges ? 'Aplicar cambios' : 'Aplicar'))}
              </button>
            )}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <ColumnPicker
                allColumns={schema.allColumns}
                keyNames={schema.keyNames}
                selected={selectedCols}
                onChange={onColumnsChange}
                connId={connectionId}
                labels={fieldLabels}
              />
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>
                {num(schema.total)} filas en total
              </span>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>
                Filtros (opcional)
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10 }}>
                El filtro lo resuelve SAP: solo se traen las filas que coinciden, nunca se descarga la tabla completa.
              </div>

              {conds.map((c, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ width: isMobile ? '100%' : 200 }}>
                    <SearchSelect
                      value={c.field}
                      options={fieldOptions}
                      onChange={v => setCond(i, { field: v })}
                      placeholder="Campo…"
                      searchPlaceholder="Buscar valor…"
                    />
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
                      style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11, padding: '4px 8px', flex: 1, minWidth: 120, outline: 'none', fontFamily: 'var(--mono)' }}
                    />
                  ) : (
                    <MultiValueSelect
                      value={c.value}
                      onChange={v => setCond(i, { value: v })}
                      placeholder="Valores (separados por coma)…"
                      disabled={!c.field}
                      loadValues={() => fetchMasterValues(connectionId, { entidad: mdt, campo: c.field, planningArea: readPA, versionId: readVersion })}
                    />
                  )}
                  <button type="button" title="Quitar condición" onClick={() => removeCond(i)} style={{ ...BTN_SEC, padding: '5px 9px', color: 'var(--red)', borderColor: 'var(--border)' }}>×</button>
                </div>
              ))}

              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                <button type="button" style={BTN_SEC} onClick={addCond}>+ Añadir condición</button>
                {conds.length > 0 && (
                  <button type="button" style={BTN_SEC} onClick={testFilter} disabled={filterTest?.loading}>
                    {filterTest?.loading ? 'Contando…' : 'Probar filtro'}
                  </button>
                )}
                {filterTest && !filterTest.loading && filterTest.error == null && (
                  <span style={{ fontSize: 12, color: 'var(--text2)' }}>
                    {num(filterTest.n)} de {num(filterTest.total)} registros coinciden
                  </span>
                )}
                {filterTest?.error && <span style={{ fontSize: 12, color: 'var(--red)' }}>No se pudo contar: {filterTest.error}</span>}
                {activeChips.length > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--mono)' }}>{activeChips.join('  ·  ')}</span>
                )}
              </div>
            </div>
          </SeccionPlegable>
        )}
      </div>
      )}

      {/* La tabla, o lo que falta para verla */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: isMobile ? '0 12px 12px' : '0 20px 16px' }}>
        {applying && !query && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
            ⏳ Cargando datos… (consultando SAP)
          </div>
        )}
        {!applying && !mdt && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
            Selecciona un área de planificación y una tabla para empezar.
          </div>
        )}
        {!applying && mdt && schema && !query && !schemaLoading && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
            Define filtros (opcional) y pulsa «Mostrar datos».
          </div>
        )}
        {query && (
          <DataGrid
            columns={appliedCols}
            onReorder={onReorderColumns}
            rows={rows}
            keyNames={schema?.keyNames || []}
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
            onToggleEdit={() => setEditMode(v => !v)}
            onCellEdit={onCellEdit}
            onSaveEdits={() => { setSaveResult(null); setShowSaveModal(true) }}
            onDiscardEdits={discardEdits}
            selectedKeys={selected}
            selCount={selCount}
            onToggleRow={onToggleRow}
            onToggleAllPage={onToggleAllPage}
            onDeleteSelected={() => { setDeleteResult(null); setShowDeleteModal(true) }}
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
        keyNames={schema?.keyNames || []}
        saving={saving}
        result={saveResult}
        onConfirm={doSave}
        onClose={() => setShowSaveModal(false)}
      />

      <DeleteConfirmModal
        open={showDeleteModal}
        rows={Object.values(selected)}
        keyNames={schema?.keyNames || []}
        deleting={deleting}
        result={deleteResult}
        onConfirm={doDelete}
        onClose={() => setShowDeleteModal(false)}
      />
    </div>
  )
}

