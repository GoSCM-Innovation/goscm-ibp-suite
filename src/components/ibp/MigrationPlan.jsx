// «Migración» → «Dato maestro»: copiar tablas de dato maestro de un sistema origen a ESTE sistema.
//
// Portado tal cual de `Migration/Migration.jsx` de v8: las mismas secciones —«Origen y destino»,
// «Datos maestros a migrar» con su «Orden de migración», «Opciones y acciones»—, el mismo diálogo de
// «Confirmar migración» con el análisis de campos, el mismo panel de progreso tabla por tabla, el
// mismo resultado con sus tiempos y el mismo historial. Los textos son los de `es.json` de v8.
//
// Dos cosas cambian respecto de v8, las dos por seguridad, y por nada más:
//
//   1. El sistema origen se ELIGE entre las conexiones dadas de alta. v8 pedía usuario y contraseña
//      del origen en un formulario y las guardaba en el navegador; aquí las credenciales viven
//      cifradas en el servidor y el navegador nunca las ve. Por eso no hay «Iniciar sesión en origen».
//   2. El navegador no habla con SAP. v8 corría la carga entera aquí, a través de un proxy; aquí cada
//      lectura y cada escritura la hace nuestro servidor (`/api/ibp/migration-run`), y la pantalla
//      solo ENCADENA los pasos con la misma forma de v8: segmentos de veinte mil filas, seis a la vez,
//      cada uno en su transacción, y el reintento siempre del segmento entero en una transacción nueva.
//      Los números y el porqué están en `core/ibp/migration-plan.js`.
//
// El destino es siempre la conexión de la pestaña, como en v8: se migra HACIA el sistema que se está
// mirando.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import { TOPES } from '../../../core/ibp/export-csv.js'
import {
  etiquetaDeCondicion as condChip,
  filasPorPaginaSegunCampos,
  filtroDeCondiciones as buildConditionFilter,
  valorLegible,
} from '../../../core/ibp/master-data-model.js'
import {
  BASE_VERSION_ID,
  ESPERA_DE_PROCESO_MS,
  INTENTOS_POR_SEGMENTO as MAX_SEGMENT_ATTEMPTS,
  emparejarTabla as suggestDstName,
  esFalloTransitorio,
  esperaAntesDeReintentar,
  estadoDeCorrida,
  estadoDeTabla,
  filasPorSegmento,
  iniciosDeSegmento,
  paralelismo,
  partirPorBytes,
} from '../../../core/ibp/migration-plan.js'
import { useGuardaDeSalida } from '../../lib/guarda-de-salida.js'
import { listIbpConnections } from '../../lib/ibp.js'
import {
  fetchMasterCatalogCached, fetchMasterMetadataCached, fetchMasterPage, fetchMasterRows, fetchMasterSchema,
  fetchMasterValues, invalidateMasterCaches,
} from '../../lib/ibp-master-data.js'
import { analyzeMigrationTable, countMasterRows, migrationStep } from '../../lib/ibp-migration.js'
import { nombreConAmbiente } from '../../lib/nombre-de-conexion.js'
import { useIsMobile } from '../../lib/useIsMobile.js'
import BotonActualizar from '../ui/BotonActualizar.jsx'
import SelectorDeLista from '../ui/SelectorDeLista.jsx'
import VentanaDeSeleccion from '../ui/VentanaDeSeleccion.jsx'
import { MultiValueSelect, SearchSelect } from './FilterControls.jsx'

// ── Textos de v8 (`src/i18n/es.json`), copiados tal cual ─────────────────────────────────────────

const TXT = {
  'mig.title': 'Migración de Datos Maestros',
  'mig.sectionConfig': 'Origen y destino',
  'mig.sectionOptions': 'Opciones y acciones',
  'mig.srcLabel': 'Sistema origen',
  'mig.dstLabel': 'Sistema destino (actual)',
  'mig.noSource': 'Seleccionar sistema origen…',
  'mig.noSourceOptions': 'No hay otras conexiones con SAP_COM_0720 configurado',
  'mig.loadingCatalog': 'Cargando catálogo…',
  'mig.paLabel': 'Área de planificación',
  'mig.versionLabel': 'Versión',
  'mig.baseVersion': 'Base (__BASE)',
  'mig.selectPa': 'Seleccionar área…',
  'mig.mdtTitle': 'Datos maestros a migrar',
  'mig.pickMdts': 'Elegir tablas',
  'mig.pickMdtsTitle': 'Tablas de dato maestro a migrar',
  'mig.pickedMdts': 'tabla(s) seleccionada(s)',
  'mig.mdtSelectAll': 'Todos',
  'mig.mdtNone': 'Ninguno',
  'mig.mdtCountSelected': '{n} seleccionado(s)',
  'mig.removeStep': 'Quitar este paso',
  'mig.refreshingMsg': 'Leyendo catálogos de SAP…',
  'mig.mdtNoIntersection': 'No hay tipos comunes entre origen y destino para las áreas/versiones seleccionadas',
  'mig.deleteEntries': 'Borrar datos del destino antes de cargar',
  'mig.deleteEntriesNote': 'Elimina los registros existentes en destino para los tipos seleccionados antes de importar (DeleteEntries=true)',
  'mig.txNameLoad': 'Nombre de transacción — carga',
  'mig.txNameDel': 'Nombre de transacción — borrado',
  'mig.txNameNote': 'Etiqueta que queda registrada en el sistema destino para identificar esta operación.',
  'mig.previewBtn': 'Vista previa',
  'mig.migrateBtn': '↑ Migrar',
  'mig.cancelBtn': '⊘ Cancelar',
  'mig.phaseReading': 'Leyendo origen…',
  'mig.phaseDeleting': 'Borrando datos del destino…',
  'mig.phaseWriting': 'Escribiendo destino…',
  'mig.phaseCommitting': 'Confirmando transacción…',
  'mig.phaseProcessing': 'Procesando en SAP IBP…',
  'mig.phaseMessages': 'Leyendo resultados…',
  'mig.phaseRetrying': 'Reintentando (transacción nueva)…',
  'mig.progressTitle': 'Progreso de la migración ({cur}/{total})',
  'mig.stepPending': 'Pendiente',
  'mig.resultsTitle': 'Resultado de la migración',
  'mig.colMdt': 'Tipo',
  'mig.colStatus': 'Estado',
  'mig.colTotal': 'Total',
  'mig.colOk': 'OK',
  'mig.colErrors': 'Errores',
  'mig.colTxId': 'TransactionID',
  'mig.statusOk': '✓ OK',
  'mig.statusError': '✕ Error',
  'mig.statusCancelled': '⊘ Cancelado',
  'mig.statusProcessing': '⧗ Procesando',
  'mig.statusWarning': '⚠ Procesado con errores',
  'mig.statusSkipped': '⊘ Omitida (límite)',
  'mig.statusProcessingNote': 'Los datos se enviaron y confirmaron, pero el postprocessing seguía en SAP IBP al agotar la espera. Verifica el conteo final más tarde.',
  'mig.rowCount': '{n} registros',
  'mig.limitWarnTag': 'supera {max}, requiere confirmación',
  'mig.limitBlockedTag': 'supera el límite de {max}, se omitirá',
  'mig.limitBlockedMsg': 'Omitida: {n} registros supera el límite de {max}.',
  'mig.limitRunBlocked': 'La corrida suma {n} registros y supera el límite de {max} de la versión web. Redúcela con filtros (fecha/versión) o ejecútala en la versión local.',
  'mig.webLimitBanner': 'Versión web · máximo {max} registros por migración. Para volúmenes mayores, usa la versión local (sin límite).',
  'mig.histToggleOpen': 'Ver historial ▾',
  'mig.histToggleClose': 'Ocultar historial ▴',
  'mig.histDate': 'Fecha',
  'mig.histSrc': 'Origen',
  'mig.histDst': 'Destino',
  'mig.histDatasets': 'Datasets',
  'mig.histRows': 'Filas',
  'mig.histStatus': 'Estado',
  'mig.histTime': 'Tiempo',
  'mig.previewTitle': 'Vista previa: {name}',
  'mig.previewCount': '{count} registros en origen · mostrando primeros {shown} · sin orden aplicado',
  'mig.previewLoading': 'Cargando vista previa…',
  'mig.previewClose': 'Cerrar',
  'mig.confirmMsg': 'El destino "{name}" está marcado como Producción. Los datos se sobreescribirán. ¿Continuar?',
  'mig.confirmBtn': 'Confirmar y migrar',
  'mig.confirmCancel': 'Cancelar',
  'mig.catalogError': 'Error al cargar el catálogo: {msg}',
  'mig.errDetail': '▸ Ver errores ({n})',
  'mig.errDetailHide': '▾ Ocultar detalle',
  'mig.noErrDetail': 'Sin detalle de mensajes disponible.',
  'mig.refreshConns': '↺ Actualizar',
  'mig.cancelConfirmTitle': '¿Detener migración?',
  'mig.cancelConfirmMsg': 'La transacción actual no se confirmará. Los datos ya enviados serán descartados.',
  'mig.cancelConfirmStop': 'Detener',
  'mig.cancelConfirmBack': 'Continuar',
  'mig.baseWarning': '⚠ Versión Base seleccionada — puede haber tipos no listados',
  'mig.orderTitle': 'Orden de migración',
  'mig.mappedTo': 'Tabla de destino mapeada (nombre distinto al origen)',
  'mig.leaveWarning': 'Hay una migración en curso. Si sales de esta pantalla, la migración se cancelará. ¿Continuar?',
  'mig.analyzing': 'Analizando campos…',
  'mig.analyzeTitle': 'Confirmar migración',
  'mig.analyzeIntro': 'Revisa las diferencias de campos entre origen y destino antes de continuar. Solo se migrarán los campos comunes.',
  'mig.analyzeError': 'No se pudieron analizar los campos: {msg}',
  'mig.fieldsMatch': 'Los campos coinciden ({n} comunes)',
  'mig.fieldsMigrated': 'Se migran ({n})',
  'mig.fieldsOmitted': 'Se omiten (no existen en destino)',
  'mig.fieldsUnfilled': 'Quedan vacíos en destino',
  'mig.fieldsUnverifiable': 'No se pudo verificar el esquema del destino (sin datos de muestra); se enviarán todos los campos del origen.',
  'mig.unverifiedSchema': 'Esquema del destino no verificado: se enviaron todos los campos del origen (pueden incluir campos inexistentes en destino).',
  'mig.colDst': 'Destino (antes→después)',
  'mig.versionIndepWarning': '⚠ Estos tipos no son específicos de la versión destino y se escribirán en la versión base: {mdts}',
  'mig.colTime': 'Tiempo',
  'mig.srcSelf': '{name} — este sistema',
  'mig.sameTargetWarning': 'Origen y destino son idénticos (mismo sistema, área y versión). Elige una versión o área distinta.',
  'mig.summaryTotal': 'Tiempo total: {dur}',
  'mig.summarySlowest': '· Más lenta: {name} ({dur})',
  'mig.timeBreakdownHint': 'Ver desglose por fase',
  'mig.noTimeDetail': 'Sin detalle de tiempos.',
  'mig.tReading': 'Lectura',
  'mig.tDeleting': 'Borrado',
  'mig.tWriting': 'Escritura',
  'mig.tCommitting': 'Commit',
  'mig.tProcessing': 'Procesamiento',
  'mig.tMessages': 'Resultados',
  'mig.tRetrying': 'Reintentos',
  'flt.btn': 'Filtrar registros',
  'flt.note': 'El filtro se aplica al ORIGEN: solo se migran los registros que cumplen todas las condiciones.',
  'flt.fieldPh': 'Campo…',
  'flt.opIn': 'igual / en lista',
  'flt.opSw': 'comienza con',
  'flt.btnShort': 'Filtro',
  'flt.valuesPh': 'Valores (separados por coma)…',
  'flt.valuePh': 'Prefijo…',
  'flt.addCond': '+ Añadir condición',
  'flt.remove': 'Quitar condición',
  'flt.test': 'Probar filtro',
  'flt.testing': 'Contando…',
  'flt.testResult': '{n} de {total} registros coinciden',
  'flt.testErr': 'No se pudo contar: {msg}',
  'flt.fieldsLoading': 'Leyendo campos de la tabla…',
  'flt.fieldsErr': 'No se pudieron leer los campos de la tabla origen.',
  'flt.confirmTitle': 'Filtros activos (migración selectiva)',
  'flt.deleteConflict': 'Hay filtros activos y "Eliminar registros del destino" está marcado: se borrará TODO el contenido del destino y solo se repondrán los registros que cumplan el filtro. El resto se perderá.',
  'flt.deleteAutoOff': 'Se desmarcó "Eliminar registros del destino" automáticamente porque hay filtros activos (un reemplazo completo borraría lo que no cumple el filtro). Puedes volver a marcarlo si realmente lo quieres.',
  'kfm.typeToFilter': 'Escribir para filtrar…',
  'kfm.rate': '{n} filas/s',
  'kfm.eta': '≈ {t} restantes',
  'kfm.segs': 'segmentos confirmados: {a}/{b}',
  'kfm.rowsNoTotal': 'filas (total desconocido)',
}

/** El `t()` de v8, sobre los textos de arriba: `{n}` se sustituye por `vars.n`. */
function t(clave, vars) {
  const texto = TXT[clave] ?? clave
  return vars ? texto.replace(/\{(\w+)\}/g, (entero, k) => (vars[k] != null ? String(vars[k]) : entero)) : texto
}

// ── Historial, como lo guardaba v8 ──
//
// En este navegador y por conexión de destino. Solo lleva nombres, áreas, tablas, filtros y tiempos:
// ninguna credencial, igual que en v8.

const HIST_KEY = id => `ibp:migrations:${id}`

function loadHistory(connId) {
  try { return JSON.parse(localStorage.getItem(HIST_KEY(connId))) || [] } catch { return [] }
}
function saveHistory(connId, entries) {
  try { localStorage.setItem(HIST_KEY(connId), JSON.stringify(entries.slice(0, 50))) } catch { /* sin espacio */ }
}

// ── Topes de volumen de v8 (`config/migrationLimits.js`) ──
//
// La suma de una corrida por encima del máximo se BLOQUEA; una tabla por encima, se omite; entre el
// aviso y el máximo, se marca en el diálogo. En local (localhost) no aplican, como en v8.

const MAX_ROWS_WARN = TOPES.maestro.aviso
const MAX_ROWS_HARD = TOPES.maestro.maximo

function isLocalRun() {
  if (typeof window === 'undefined' || !window.location) return false
  const h = window.location.hostname
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]'
}

// Los acuerdos con los que el servidor lee y escribe dato maestro: `SAP_COM_0720`, y `SAP_COM_0326`
// en los tenants que emiten un único usuario para todo (ver `handlers/ibp/master-data.js`).
const ACUERDOS_DE_DATO_MAESTRO = ['SAP_COM_0720', 'SAP_COM_0326']
const tieneAcuerdo = c => (c?.agreements ?? []).some(a => ACUERDOS_DE_DATO_MAESTRO.includes(typeof a === 'string' ? a : a?.agreement))

// Campos que SAP devuelve al leer y rechaza al escribir (v8: `READONLY_FIELDS`).
const READONLY_FIELDS = new Set(['PlanningAreaID', 'VersionID', 'CREATEDDATE', 'LASTMODIFIEDDATE'])

// ── Estilos de v8 ──

const SECTION = {
  background: 'var(--bg2)', border: '1px solid var(--border)',
  borderRadius: 10, padding: '16px 20px', marginBottom: 16,
}
const SECTION_HDR = {
  fontSize: 11, fontWeight: 700, color: 'var(--accent)',
  textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 14,
}
const LABEL = {
  fontSize: 10, fontWeight: 700, color: 'var(--text2)',
  textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 5, display: 'block',
}
const SELECT = {
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text)', fontSize: 12, padding: '7px 10px', width: '100%', outline: 'none',
}
const INPUT = { ...SELECT }
const BTN_SEC = {
  background: 'none', border: '1px solid var(--border2)', borderRadius: 6,
  color: 'var(--text2)', fontSize: 12, fontWeight: 600, padding: '7px 14px', cursor: 'pointer',
}
const BTN_DANGER = {
  background: 'none', border: '1px solid var(--red)', borderRadius: 6,
  color: 'var(--red)', fontSize: 12, fontWeight: 600, padding: '7px 14px', cursor: 'pointer',
}
function btnPrimary(disabled) {
  return {
    background: disabled ? 'var(--border2)' : 'var(--accent)', border: 'none', borderRadius: 6,
    color: disabled ? 'var(--text3)' : 'var(--text-on-accent)', fontSize: 12, fontWeight: 700,
    padding: '7px 18px', cursor: disabled ? 'not-allowed' : 'pointer', transition: 'background .15s',
  }
}
const TH = {
  textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--border)',
  color: 'var(--text2)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em',
}
function td(extra) {
  return { padding: '6px 8px', borderBottom: '1px solid var(--border)', ...extra }
}

// ── Ayudas ──

// Un texto legible de cualquier cosa lanzada, nunca «[object Object]».
function errText(e) {
  if (e == null) return 'Error desconocido'
  if (typeof e === 'string') return e
  const m = e.message
  if (typeof m === 'string' && m && m !== '[object Object]') return m
  try { const s = JSON.stringify(e); if (s && s !== '{}') return s } catch { /* nada */ }
  return String(e)
}

// Una duración compacta: «1h 02m», «2m 14s», «4,2 s», «850 ms».
function fmtDuration(ms) {
  if (ms == null || !isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1).replace('.', ',')} s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s % 60)
  if (m < 60) return `${m}m ${String(rem).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, '0')}m`
}

// Un valor de una celda: las fechas de OData legibles, y un objeto anidado (la fila que trae un
// mensaje con `$expand`) como texto en vez de romper la tabla.
function formatCell(val, columna) {
  if (val == null) return ''
  if (typeof val === 'object') {
    const { __metadata, __deferred, ...resto } = val
    return JSON.stringify(resto)
  }
  return valorLegible(val, columna)
}

// Las fases del desglose por tabla, en el orden en que pasan.
const TIMED_PHASES = ['reading', 'deleting', 'writing', 'committing', 'processing', 'messages', 'retrying']

// Cuántas tablas se analizan a la vez. v8 lo hacía de una en una; el número de lecturas por tabla es
// el mismo (tres), solo se solapan.
const ANALYSIS_CONCURRENCY = 4

// Una espera que «⊘ Cancelar» corta.
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(id); reject(new DOMException('cancelled', 'AbortError')) }, { once: true })
  })
}

const cancelledError = () => Object.assign(new Error('cancelled'), { isCancelled: true })

// ── Componente ──

export default function MigrationPlan({ connection }) {
  const isMobile = useIsMobile()

  // Incrementar para volver a leer la lista de conexiones / el catálogo («↺ Actualizar»).
  const [connsTick, setConnsTick] = useState(0)
  const [catalogTick, setCatalogTick] = useState(0)
  const [conns, setConns] = useState([])

  useEffect(() => {
    let alive = true
    listIbpConnections()
      .then(list => { if (alive) setConns(list || []) })
      .catch(() => { if (alive) setConns([]) })
    return () => { alive = false }
  }, [connsTick])

  // Candidatos de origen: ESTE sistema primero —para migrar entre áreas o versiones del mismo— y
  // después las OTRAS conexiones con el acuerdo de dato maestro.
  const allConns = useMemo(() => {
    const selfConn = conns.find(c => c.id === connection.id) || connection
    const self = (selfConn.agreements === undefined || tieneAcuerdo(selfConn)) ? [selfConn] : []
    const others = conns.filter(c => c.id !== connection.id && tieneAcuerdo(c))
    return [...self, ...others]
  }, [conns, connection])

  // Todas por id, para el nombre en el historial aunque se haya renombrado.
  const connById = useMemo(() => Object.fromEntries(conns.map(c => [c.id, c])), [conns])

  // ── Origen ──
  const [srcConnId, setSrcConnId] = useState(null)
  const srcConn = useMemo(() => allConns.find(c => c.id === srcConnId) || null, [allConns, srcConnId])

  // ── Catálogos ──
  const [srcCatalog, setSrcCatalog]   = useState(null)
  const [dstCatalog, setDstCatalog]   = useState(null)
  const [dstLoading, setDstLoading]   = useState(false)
  const [srcLoading, setSrcLoading]   = useState(false)
  const [catalogError, setCatalogError] = useState('')

  // Las tablas que se pueden IMPORTAR en el destino (las que exponen `<TABLA>Trans`). `null` = sin
  // cargar o sin respuesta → no se filtra nada, que es lo seguro.
  const [importableSet, setImportableSet] = useState(null)

  // Las etiquetas de los campos del ORIGEN para el selector del filtro (de mejor esfuerzo).
  const [srcFieldLabels, setSrcFieldLabels] = useState({})

  // ── Área / versión ──
  const [srcPa, setSrcPa]           = useState('')
  const [srcVersion, setSrcVersion] = useState('')
  const [dstPa, setDstPa]           = useState('')
  const [dstVersion, setDstVersion] = useState('')

  // ── Tablas elegidas y su orden ──
  const [pickMdts, setPickMdts]   = useState(false)   // la ventana de selección de tablas
  const [mdtOrder, setMdtOrder]   = useState([])   // nombres de ORIGEN, en orden
  // Origen → destino para tablas que se llaman distinto en cada sistema (AS1PRODUCT → AS4PRODUCT).
  const [mdtMapping, setMdtMapping] = useState({})

  // ── Arrastrar y soltar ──
  const dragId = useRef(null)
  const [dragOver, setDragOver] = useState(null)

  // ── Filtros por tabla (migración selectiva) ──
  // { [tablaOrigen]: [{ field, op: 'in'|'sw', value: 'A,B' }] } — se aplican SOLO a las lecturas del
  // origen; el destino no se toca con ellos.
  const [mdtFilters, setMdtFilters]     = useState({})
  const [filterOpen, setFilterOpen]     = useState(null)
  const [mdtFieldOpts, setMdtFieldOpts] = useState({})   // { [tabla]: string[] | 'loading' | 'error' }
  const [filterTest, setFilterTest]     = useState({})   // { [tabla]: { loading?, n?, total?, error? } }

  // ── Opciones ──
  // Apagado de entrada: el borrado relee TODAS las claves del destino y las vuelve a mandar como
  // borrados antes de cargar, que dobla el tráfico. Se activa a propósito.
  const [deleteEntries, setDeleteEntries] = useState(false)
  const [txNameLoad, setTxNameLoad] = useState('IBP-ControlTower-MD')
  const [txNameDel, setTxNameDel]   = useState('IBP-ControlTower-DEL')

  // ── Corrida ──
  const cancelledRef = useRef(false)
  const abortRef     = useRef(null)
  const [running, setRunning]   = useState(false)
  const [progress, setProgress] = useState(null)
  const [results, setResults]   = useState(null)

  const [expandedMdt, setExpandedMdt] = useState(null)
  const [expandedTimeMdt, setExpandedTimeMdt] = useState(null)

  // Reloj de la corrida: se actualiza una vez por segundo mientras corre.
  const runStartRef = useRef(0)
  const [runElapsed, setRunElapsed] = useState(0)
  const [ahora, setAhora] = useState(() => Date.now())

  // ── Vista previa ──
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewData, setPreviewData]       = useState(null)

  // ── Confirmación (análisis de campos + aviso de producción) ──
  const [showConfirm, setShowConfirm] = useState(false)
  const [analyzing, setAnalyzing]     = useState(false)
  const [analysis, setAnalysis]       = useState(null)
  const analysisRef                   = useRef(null)

  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

  // ── Historial ──
  const [history, setHistory]         = useState(() => loadHistory(connection.id))
  const [showHistory, setShowHistory] = useState(false)

  // Lo que depende del contexto elegido se olvida cuando el contexto cambia (v8).
  function resetSelection() {
    setMdtOrder([]); setMdtMapping({})
    setMdtFilters({}); setFilterOpen(null); setMdtFieldOpts({}); setFilterTest({})
  }

  // La ventana de selección de tablas. Las que siguen elegidas conservan su lugar, su mapeo y su filtro;
  // las desmarcadas se van con ellos; las nuevas entran al final con el destino sugerido.
  function aplicarMdts(sel) {
    const quedan = new Set(sel)
    const fuera = mdtOrder.filter(m => !quedan.has(m))
    const nuevas = sel.filter(m => !mdtOrder.includes(m))
    setMdtOrder(prev => [...prev.filter(m => quedan.has(m)), ...nuevas])
    setMdtMapping(prev => {
      const n = { ...prev }
      fuera.forEach(m => { delete n[m] })
      nuevas.forEach(m => { n[m] = suggestDstName(m, dstCandidates) || m })
      return n
    })
    setMdtFilters(prev => {
      const n = { ...prev }
      fuera.forEach(m => { delete n[m] })
      return n
    })
    if (fuera.includes(filterOpen)) setFilterOpen(null)
  }

  // Quitar UNA tabla de la selección, con su mapeo y su filtro: lo hace el botón «✕» del paso.
  function quitarMdt(mdt) {
    setMdtOrder(prev => prev.filter(m => m !== mdt))
    setMdtMapping(prev => { const n = { ...prev }; delete n[mdt]; return n })
    setMdtFilters(prev => { const n = { ...prev }; delete n[mdt]; return n })
    if (filterOpen === mdt) setFilterOpen(null)
  }

  // ── Catálogo del destino ──
  useEffect(() => {
    let alive = true
    const id = setTimeout(() => {
      setDstLoading(true)
      setCatalogError('')
      fetchMasterCatalogCached(connection.id)
        .then(r => {
          if (!alive) return
          setDstCatalog(r?.catalogo ?? {})
          // Sin lista de importables no se filtra nada: la pestaña sigue sirviendo.
          setImportableSet(r?.importables?.length ? new Set(r.importables) : null)
          setDstPa(''); setDstVersion('')
          setMdtOrder([]); setMdtMapping({}); setMdtFilters({}); setFilterOpen(null); setMdtFieldOpts({}); setFilterTest({})
        })
        .catch(e => { if (alive) { setCatalogError(t('mig.catalogError', { msg: errText(e) })); setImportableSet(null) } })
        .finally(() => { if (alive) setDstLoading(false) })
    }, 0)
    return () => { alive = false; clearTimeout(id) }
  }, [connection.id, catalogTick])

  // ── Catálogo y etiquetas del origen ──
  useEffect(() => {
    let alive = true
    const id = setTimeout(() => {
      setSrcPa(''); setSrcVersion('')
      setMdtOrder([]); setMdtMapping({}); setMdtFilters({}); setFilterOpen(null); setMdtFieldOpts({}); setFilterTest({})
      if (!srcConnId) { setSrcCatalog(null); setSrcFieldLabels({}); return }
      setSrcLoading(true)
      setCatalogError('')
      fetchMasterCatalogCached(srcConnId)
        .then(r => { if (alive) setSrcCatalog(r?.catalogo ?? {}) })
        .catch(e => { if (alive) setCatalogError(t('mig.catalogError', { msg: errText(e) })) })
        .finally(() => { if (alive) setSrcLoading(false) })
      fetchMasterMetadataCached(srcConnId)
        .then(m => { if (alive) setSrcFieldLabels(m?.etiquetas || {}) })
    }, 0)
    return () => { alive = false; clearTimeout(id) }
  }, [srcConnId, catalogTick])

  // ── Guarda de salida: avisar antes de irse con una migración en marcha ──
  useGuardaDeSalida(running, t('mig.leaveWarning'))

  // Al desmontar (se confirmó salir de la pestaña o de la conexión), se corta la corrida.
  useEffect(() => () => { cancelledRef.current = true; abortRef.current?.abort() }, [])

  useEffect(() => {
    if (!running) return undefined
    const id = setInterval(() => { setRunElapsed(Date.now() - runStartRef.current); setAhora(Date.now()) }, 1000)
    return () => clearInterval(id)
  }, [running])

  // El fragmento de filtro efectivo de cada tabla ('' sin condición completa).
  const mdtExtraFilter = mdt => buildConditionFilter(mdtFilters[mdt])
  const hasAnyFilter = mdtOrder.some(m => buildConditionFilter(mdtFilters[m]))

  // Filtros + reemplazo completo es peligroso (el borrado limpia TODO, la carga repone solo lo
  // filtrado): «Borrar datos del destino» se desmarca solo en cuanto aparece un filtro. Se puede
  // volver a marcar; el diálogo avisa en rojo.
  const [prevHadFilter, setPrevHadFilter] = useState(false)
  if (hasAnyFilter !== prevHadFilter) {
    setPrevHadFilter(hasAnyFilter)
    if (hasAnyFilter) setDeleteEntries(false)
  }

  // ── Tablas disponibles ──
  // Con la versión base (''), la unión de las tablas de todas las versiones del área (v8 `getMdts`).
  const getMdts = (catalog, pa, version) => {
    const entry = catalog && pa ? catalog[pa] : null
    if (!entry) return []
    if (!version) {
      const all = new Set()
      entry.versions.forEach(v => v.mdts.forEach(m => all.add(m)))
      return [...all].sort()
    }
    const v = entry.versions.find(x => x.id === version)
    return v ? [...v.mdts].sort() : []
  }
  const getPas = catalog => Object.entries(catalog || {}).map(([id, { desc }]) => ({ id, desc })).sort((a, b) => a.id.localeCompare(b.id))
  const getVersions = (catalog, pa) => (catalog && pa ? catalog[pa]?.versions || [] : [])

  const srcMdts = useMemo(() => getMdts(srcCatalog, srcPa, srcVersion), [srcCatalog, srcPa, srcVersion])
  const dstMdts = useMemo(() => getMdts(dstCatalog, dstPa, dstVersion), [dstCatalog, dstPa, dstVersion])

  // Las tablas importables del área/versión de destino: a las que se puede emparejar una de origen.
  const dstCandidates = useMemo(() =>
    importableSet ? dstMdts.filter(m => importableSet.has(m)) : [...dstMdts],
  [dstMdts, importableSet])

  // Las tablas de origen que tienen pareja en el destino (nombre exacto o raíz común). Una sin pareja
  // importable no se ofrece.
  const availableMdts = useMemo(() => {
    if (!srcPa || !dstPa) return []
    return srcMdts.filter(src => suggestDstName(src, dstCandidates) != null).sort()
  }, [srcMdts, dstCandidates, srcPa, dstPa])

  // La tabla de destino de una de origen: la elegida a mano → la sugerida → la misma.
  const resolveDst = src => mdtMapping[src] || suggestDstName(src, dstCandidates) || src

  // Tablas elegidas cuyo destino NO es específico de la versión elegida: SAP las escribe en la base.
  const nonVersionMdts = (() => {
    if (!dstVersion) return []
    const dstSet = new Set(dstMdts)
    return mdtOrder.filter(src => !dstSet.has(resolveDst(src)))
  })()

  // ── Contexto de cada lado, como lo pide el servidor ──
  const srcSide = { connectionId: srcConnId, planningArea: srcPa, versionId: srcVersion }
  const dstSide = { connectionId: connection.id, planningArea: dstPa, versionId: dstVersion }

  // ── Vista previa ──
  async function handlePreview(mdtName) {
    if (!srcConn) return
    setPreviewLoading(true)
    setPreviewData(null)
    try {
      const [count, rows] = await Promise.all([
        countMasterRows(srcConnId, { entidad: mdtName, planningArea: srcPa, versionId: srcVersion }),
        fetchMasterRows(srcConnId, { entidad: mdtName, planningArea: srcPa, versionId: srcVersion, skip: 0, top: 100 }),
      ])
      setPreviewData({ name: mdtName, count, rows })
    } catch (e) {
      setPreviewData({ name: mdtName, count: 0, rows: [], error: errText(e) })
    } finally {
      setPreviewLoading(false)
    }
  }

  // ── Editor de filtro por tabla ──
  // Los campos se leen una vez por tabla (una fila de muestra del ORIGEN, sin versión).
  function handleToggleFilter(mdt) {
    const opening = filterOpen !== mdt
    setFilterOpen(opening ? mdt : null)
    if (!opening) return
    if (!(mdtFilters[mdt] || []).length) setMdtFilters(p => ({ ...p, [mdt]: [{ field: '', op: 'in', value: '' }] }))
    if (mdtFieldOpts[mdt]) return
    setMdtFieldOpts(p => ({ ...p, [mdt]: 'loading' }))
    fetchMasterRows(srcConnId, { entidad: mdt, planningArea: srcPa, versionId: '', skip: 0, top: 1 })
      .then(rows => {
        const fields = rows?.[0] ? Object.keys(rows[0]) : []
        setMdtFieldOpts(p => ({ ...p, [mdt]: fields.filter(f => !READONLY_FIELDS.has(f)).sort() }))
      })
      .catch(() => setMdtFieldOpts(p => ({ ...p, [mdt]: 'error' })))
  }

  // Cuántos registros del ORIGEN cumplen el filtro frente al total, para validarlo ANTES de migrar.
  async function handleTestFilter(mdt) {
    setFilterTest(p => ({ ...p, [mdt]: { loading: true } }))
    try {
      const [n, total] = await Promise.all([
        countMasterRows(srcConnId, { entidad: mdt, planningArea: srcPa, versionId: srcVersion, condiciones: mdtFilters[mdt] }),
        countMasterRows(srcConnId, { entidad: mdt, planningArea: srcPa, versionId: srcVersion }),
      ])
      setFilterTest(p => ({ ...p, [mdt]: { n, total } }))
    } catch (e) {
      setFilterTest(p => ({ ...p, [mdt]: { error: errText(e) } }))
    }
  }

  // ── Análisis de campos ──
  // Por tabla: cuenta del origen con su filtro (tope de volumen y total de la carga) y una fila de
  // muestra de cada lado para mandar solo los campos comunes y decir qué difiere. Las tres lecturas
  // de v8, ahora en el servidor.
  async function analyzeFields() {
    const byMdt = {}
    let firstError = null
    let failed = 0
    const pending = [...mdtOrder]
    const worker = async () => {
      for (;;) {
        const srcName = pending.shift()
        if (!srcName) return
        try {
          byMdt[srcName] = await analyzeMigrationTable({
            origen: srcSide, destino: dstSide, entidad: srcName, entidadDestino: resolveDst(srcName),
            condiciones: mdtFilters[srcName] || [],
          })
        } catch (e) {
          // Como en v8: una lectura del análisis que falla deja esa tabla sin verificar, sin más.
          firstError = firstError || errText(e)
          failed += 1
          byMdt[srcName] = { verifiable: false, common: null, omitted: [], unfilled: [], count: null, failed: true }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(ANALYSIS_CONCURRENCY, pending.length) }, worker))
    const hasConflicts = Object.values(byMdt).some(x => !x.verifiable || x.omitted.length > 0 || x.unfilled.length > 0)
    // Solo si no se pudo analizar NINGUNA se dice que el análisis falló, que es cuando v8 lo decía.
    return { byMdt, hasConflicts, error: failed > 0 && failed === mdtOrder.length ? firstError : null }
  }

  async function handleMigrateClick() {
    setAnalyzing(true)
    setAnalysis(null)
    let result
    try {
      result = await analyzeFields()
    } catch (e) {
      result = { byMdt: {}, hasConflicts: false, error: errText(e) }
    }
    analysisRef.current = result
    setAnalysis(result)
    setAnalyzing(false)
    setShowConfirm(true)
  }

  // ── La carga ──
  async function runMigration() {
    setShowConfirm(false)
    setRunning(true)
    setResults([])
    cancelledRef.current = false
    abortRef.current = new AbortController()
    const signal = abortRef.current.signal
    runStartRef.current = Date.now()
    setRunElapsed(0)
    setAhora(Date.now())

    const isCancel = e => e?.isCancelled || e?.name === 'AbortError' || cancelledRef.current
    const checkCancel = () => { if (cancelledRef.current) throw cancelledError() }
    const step = (accion, body) => migrationStep(accion, { origen: srcSide, destino: dstSide, ...body }, { signal })
    const loadName = txNameLoad.trim() || 'IBP-ControlTower-MD'
    const delName = txNameDel.trim() || 'IBP-ControlTower-DEL'

    // Una lectura idempotente se repite si el fallo es pasajero (v8: `withRetry` de las lecturas).
    async function readWithRetry(read, attempts = 5) {
      for (let attempt = 1; ; attempt++) {
        try { return await read() } catch (e) {
          if (isCancel(e) || !esFalloTransitorio(e) || attempt >= attempts) throw e
          await sleep(1500 * attempt, signal)
        }
      }
    }

    // SAP confirma de forma asíncrona: hay que preguntar hasta que diga PROCESSED (v8:
    // `waitForProcessed`). Cada pregunta es una llamada; la espera la lleva el navegador.
    async function waitProcessed(transactionId) {
      const deadline = Date.now() + ESPERA_DE_PROCESO_MS
      for (;;) {
        let estado
        try { estado = (await step('estado', { transactionId })).estado } catch (e) {
          if (isCancel(e)) throw e
          estado = undefined   // un fallo al preguntar no dice nada de la transacción
        }
        if (estado === 'PROCESADA' || estado === 'CON_ERROR' || estado === 'SIN_SOPORTE') return estado
        if (Date.now() >= deadline) return 'SIN_RESPUESTA'
        await sleep(2000, signal)
      }
    }

    // Todos los mensajes de rechazo (E/A) de una transacción, página a página.
    async function readRejections(dstName, transactionId) {
      const out = []
      let skip = 0
      let conExpand = true
      for (;;) {
        let page
        try {
          page = await step('mensajes', { entidadDestino: dstName, transactionId, skip, conExpand })
        } catch (e) {
          if (isCancel(e)) throw e
          break   // v8: si no se pueden leer, se cuenta lo que haya
        }
        out.push(...(page.rechazos || []))
        conExpand = page.conExpand
        if ((page.leidos || 0) < 1000) break
        skip += 1000
      }
      return out
    }

    const mdtList = [...mdtOrder]
    const allResults = []
    const pushResult = r => { allResults.push(r); setResults([...allResults]) }

    // Tope por CORRIDA: la suma de todas las tablas. Bloquea ANTES de transferir nada.
    const runTotal = mdtList.reduce((s, m) => s + (analysisRef.current?.byMdt?.[m]?.count || 0), 0)
    if (!isLocalRun() && runTotal > MAX_ROWS_HARD) {
      setResults([{ mdt: '—', dstName: '—', unverified: false, status: 'skipped', total: 0, ok: 0, errors: 0, txId: null, errorMsg: t('mig.limitRunBlocked', { max: MAX_ROWS_HARD.toLocaleString(), n: runTotal.toLocaleString() }), phaseTimes: {}, durationMs: 0 }])
      setRunning(false)
      return
    }

    try {
      for (let di = 0; di < mdtList.length; di++) {
        if (cancelledRef.current) break
        const srcName = mdtList[di]
        const dstName = resolveDst(srcName)
        const label   = srcName === dstName ? srcName : `${srcName} → ${dstName}`
        const entry = analysisRef.current?.byMdt?.[srcName]
        const unverified = entry?.verifiable === false
        // Con el esquema verificado se leen SOLO los campos comunes ($select): menos tráfico, páginas
        // más grandes. Sin verificar se leen y se mandan TODAS las columnas del origen (v8).
        const selectFields = (entry?.common && entry.common.length) ? entry.common : null
        const conditions = mdtFilters[srcName] || []
        const readFields = selectFields ? selectFields.length : ((entry?.srcFields?.length) || ((entry?.common?.length || 0) + (entry?.omitted?.length || 0)))

        // Tiempos por tabla: el total de pared y lo acumulado por fase entre los segmentos en paralelo.
        const tableStart = Date.now()
        const phaseAcc = {}
        const addPhase = (k, ms) => { if (ms) phaseAcc[k] = (phaseAcc[k] || 0) + ms }
        setProgress({ datasetCur: di + 1, datasetTotal: mdtList.length, datasetName: label, rows: 0, totalRows: 0, phase: 'reading', tableStart, segsDone: 0, totalSegs: 0 })

        let totalRows = 0
        let loadedRows = 0
        let dstBefore = null
        const segmentTxIds = []

        try {
          // La cuenta del análisis se reutiliza; si no la hay, se cuenta aquí.
          const preCount = entry?.count
          if (typeof preCount === 'number') {
            totalRows = preCount
          } else {
            const t0 = Date.now()
            try {
              totalRows = await readWithRetry(() => countMasterRows(srcConnId, { entidad: srcName, planningArea: srcPa, versionId: srcVersion, condiciones: conditions }, { signal }), 2)
            } finally { addPhase('reading', Date.now() - t0) }
          }
        } catch (e) {
          if (isCancel(e)) { pushResult({ mdt: srcName, dstName, unverified, status: 'cancelled', total: 0, ok: 0, errors: 0, txId: null, phaseTimes: { ...phaseAcc }, durationMs: Date.now() - tableStart }); break }
          pushResult({ mdt: srcName, dstName, unverified, status: 'error', total: 0, ok: 0, errors: 1, txId: null, errorMsg: errText(e), phaseTimes: { ...phaseAcc }, durationMs: Date.now() - tableStart })
          continue
        }

        // Una tabla por encima del máximo se OMITE: no se transfiere nada.
        if (!isLocalRun() && totalRows > MAX_ROWS_HARD) {
          pushResult({ mdt: srcName, dstName, unverified, status: 'skipped', total: 0, ok: 0, errors: 0, txId: null, errorMsg: t('mig.limitBlockedMsg', { max: MAX_ROWS_HARD.toLocaleString(), n: totalRows.toLocaleString() }), phaseTimes: { ...phaseAcc }, durationMs: Date.now() - tableStart })
          continue
        }

        // Cuenta del destino ANTES y tamaño de página medido con una muestra real del origen.
        let readPage = filasPorPaginaSegunCampos(readFields || 60)
        try {
          const prep = await step('preparar', { entidad: srcName, entidadDestino: dstName, columnas: selectFields || [], campos: readFields, condiciones: conditions })
          dstBefore = prep.dstBefore ?? null
          if (prep.porPagina) readPage = prep.porPagina
        } catch { /* sin cuenta previa y con la estimación por columnas */ }

        try {
          // ── Reemplazo completo: borrar el destino en segmentos confirmados ──
          // SAP no deja mezclar DeleteEntries true/false en una transacción, así que el borrado va en
          // transacciones propias ANTES de la carga. Se borra por CLAVES explícitas —una foto leída
          // entera antes de empezar—, así confirmar un segmento a mitad no corre ninguna ventana de
          // $skip. Todos los borrados terminan de procesarse antes de cargar: si no, un borrado aún
          // pendiente podría llevarse una clave recién cargada.
          if (deleteEntries) {
            const tDel = Date.now()
            setProgress(p => ({ ...p, phase: 'deleting' }))
            let keyNames = entry?.dstKeys?.length ? entry.dstKeys : []
            if (!keyNames.length) {
              try {
                keyNames = (await readWithRetry(() => fetchMasterSchema(connection.id, { entidad: dstName, planningArea: dstPa, versionId: dstVersion }))).claves || []
              } catch (e) { if (isCancel(e)) throw e }
            }
            const keyRows = []
            if (keyNames.length > 0) {
              const pageSize = filasPorPaginaSegunCampos(keyNames.length)
              for (let skip = 0; ; skip += pageSize) {
                checkCancel()
                const { filas } = await readWithRetry(() => fetchMasterPage(connection.id, {
                  entidad: dstName, planningArea: dstPa, versionId: dstVersion,
                  select: keyNames, orderby: keyNames, skip, top: pageSize, signal,
                }))
                keyRows.push(...filas)
                if (filas.length < pageSize) break
              }
            }
            if (keyRows.length > 0) {
              const delTxIds = []
              for (const segKeys of partirPorBytes(keyRows)) {
                for (let attempt = 1; ; attempt++) {
                  checkCancel()
                  try {
                    const { transactionId } = await step('borrar', { entidadDestino: dstName, filas: segKeys, nombre: delName })
                    checkCancel()   // cancelado: el borrado en staging no se confirma
                    if (transactionId) {
                      await step('confirmar', { transactionId })
                      delTxIds.push(transactionId)
                    }
                    break
                  } catch (e) {
                    if (isCancel(e)) throw e
                    if (esFalloTransitorio(e) && attempt < MAX_SEGMENT_ATTEMPTS) { await sleep(esperaAntesDeReintentar(attempt), signal); continue }
                    throw e
                  }
                }
              }
              for (const tx of delTxIds) {
                if (cancelledRef.current) break
                await waitProcessed(tx)
              }
            }
            addPhase('deleting', Date.now() - tDel)
          }

          checkCancel()

          // ── Carga por SEGMENTOS confirmados, varios a la vez ──
          // Cada segmento es su propia transacción: un fallo pasajero rehace SOLO ese segmento, en una
          // transacción nueva, y lo ya confirmado se queda. Sin claves no hay orden estable y se lee en
          // serie: una página y un segmento a la vez.
          // Las claves salen de la muestra del análisis; si el análisis de esta tabla falló, se leen
          // aquí, como hacía v8 con `fetchKeyNames` justo antes de cargar.
          let srcKeys = entry?.srcKeys || []
          if (!entry || entry.failed) {
            try {
              srcKeys = (await readWithRetry(() => fetchMasterSchema(srcConnId, { entidad: srcName, planningArea: srcPa, versionId: srcVersion }))).claves || []
            } catch (e) { if (isCancel(e)) throw e; srcKeys = [] }
          }
          const { paginas, segmentos } = paralelismo(srcKeys)
          const segSize = filasPorSegmento(readPage, { paralelo: paginas })
          const segStarts = iniciosDeSegmento(totalRows, segSize)
          setProgress(p => ({ ...p, totalRows, totalSegs: segStarts.length }))

          let nextSeg = 0
          let committedRows = 0
          let stop = false
          const failures = []

          const worker = async () => {
            for (;;) {
              if (stop || cancelledRef.current) return
              const myIdx = nextSeg++
              if (myIdx >= segStarts.length) return
              const segStart = segStarts[myIdx]
              const segEnd = Math.min(segStart + segSize, totalRows)

              for (let attempt = 1; ; attempt++) {
                try {
                  checkCancel()
                  setProgress(p => ({ ...p, phase: 'reading' }))
                  // Leer el segmento y mandarlo a staging en una transacción NUEVA, sin confirmar.
                  const seg = await step('cargar', {
                    entidad: srcName, entidadDestino: dstName, columnas: selectFields || [], claves: srcKeys,
                    desde: segStart, cuantas: segEnd - segStart, porPagina: readPage, paralelo: paginas,
                    condiciones: conditions, nombre: loadName,
                  })
                  addPhase('reading', seg.tiempos?.reading)
                  addPhase('writing', seg.tiempos?.writing)
                  // Cancelado mientras se cargaba: no se confirma y SAP descarta la transacción.
                  checkCancel()
                  if (seg.transactionId) {
                    setProgress(p => ({ ...p, phase: 'committing' }))
                    const tCommit = Date.now()
                    await step('confirmar', { transactionId: seg.transactionId })
                    addPhase('committing', Date.now() - tCommit)
                    segmentTxIds.push(seg.transactionId)
                  }
                  // Confirmado → duradero.
                  committedRows += seg.filas || 0
                  loadedRows = committedRows
                  setProgress(p => ({ ...p, rows: committedRows, segsDone: (p.segsDone || 0) + 1 }))
                  break
                } catch (e) {
                  if (isCancel(e)) { failures.push(e); stop = true; return }
                  if (esFalloTransitorio(e) && attempt < MAX_SEGMENT_ATTEMPTS) {
                    setProgress(p => ({ ...p, phase: 'retrying' }))
                    const wait = esperaAntesDeReintentar(attempt)
                    try { await sleep(wait, signal) } catch (abort) { failures.push(abort); stop = true; return }
                    addPhase('retrying', wait)
                    continue
                  }
                  // Un fallo que no se arregla repitiendo para la tabla: los demás no toman más segmentos.
                  failures.push(e); stop = true; return
                }
              }
            }
          }
          const workerCount = Math.min(segmentos, segStarts.length || 1)
          await Promise.all(Array.from({ length: workerCount }, () => worker()))
          if (cancelledRef.current || failures.some(isCancel)) throw cancelledError()
          if (failures.length) throw failures[0]

          // SAP confirma de forma asíncrona: se espera a que procese cada segmento y se leen sus
          // mensajes antes de contar el destino, o se vería lo de antes.
          setProgress(p => ({ ...p, phase: 'processing' }))
          const tProc = Date.now()
          let anyError = false
          let anyUnconfirmed = false
          const errorMsgs = []
          for (const tx of segmentTxIds) {
            checkCancel()
            const st = await waitProcessed(tx)
            if (st === 'CON_ERROR') anyError = true
            else if (st !== 'PROCESADA') anyUnconfirmed = true
            setProgress(p => ({ ...p, phase: 'messages' }))
            errorMsgs.push(...await readRejections(dstName, tx))
          }
          addPhase('processing', Date.now() - tProc)

          // Cuenta del destino DESPUÉS. Si algo no se confirmó, se reintenta mientras se pone al día.
          let dstAfter = null
          const attempts = (!anyError && !anyUnconfirmed) ? 1 : 3
          for (let a = 0; a < attempts; a++) {
            if (a > 0) await sleep(2500, signal)
            try {
              dstAfter = await countMasterRows(connection.id, { entidad: dstName, planningArea: dstPa, versionId: dstVersion || BASE_VERSION_ID }, { signal })
            } catch (e) { if (isCancel(e)) throw e; dstAfter = null }
            if (dstAfter != null) break
          }

          // Cuentas honestas: rechazadas = filas que SAP no aceptó (un mensaje E/A por fila, sumando
          // todos los segmentos); enviadas = filas leídas Y confirmadas.
          const rejected = errorMsgs.length
          const sent     = committedRows
          pushResult({
            mdt: srcName, dstName, unverified,
            txId: segmentTxIds[segmentTxIds.length - 1] || null,
            segments: segmentTxIds.length,
            status: estadoDeTabla({ conError: anyError, rechazadas: rejected, sinConfirmar: anyUnconfirmed }),
            total:    sent,
            ok:       Math.max(0, sent - rejected),
            errors:   rejected,
            messages: errorMsgs,
            dstBefore, dstAfter,
            phaseTimes: { ...phaseAcc }, durationMs: Date.now() - tableStart,
          })
        } catch (e) {
          const phaseTimes = { ...phaseAcc }
          const durationMs = Date.now() - tableStart
          const lastTx = segmentTxIds.length ? segmentTxIds[segmentTxIds.length - 1] : null
          if (isCancel(e)) {
            pushResult({ mdt: srcName, dstName, unverified, status: 'cancelled', total: loadedRows, ok: 0, errors: 0, txId: lastTx, dstBefore, dstAfter: null, phaseTimes, durationMs })
            break
          }
          pushResult({ mdt: srcName, dstName, unverified, status: 'error', total: loadedRows, ok: 0, errors: 1, txId: lastTx, errorMsg: errText(e), dstBefore, dstAfter: null, phaseTimes, durationMs })
        }
      }
    } finally {
      setRunning(false)
      setProgress(null)
      setResults(allResults)

      const entry = {
        date: new Date().toISOString(),
        srcConnId:   srcConn?.id || '',
        srcConnName: srcConn ? nombreConAmbiente(srcConn) : '',
        srcPa, srcVersion, dstPa, dstVersion,
        mdts: mdtList,
        filters: Object.fromEntries(mdtList.map(m => [m, mdtExtraFilter(m)]).filter(([, f]) => f)),
        totalRows: allResults.reduce((s, r) => s + (r.total || 0), 0),
        status: estadoDeCorrida(allResults),
        durationMs: Date.now() - runStartRef.current,
        timings: allResults.map(r => ({ mdt: r.mdt, durationMs: r.durationMs, phaseTimes: r.phaseTimes })),
      }
      const updated = [entry, ...loadHistory(connection.id)].slice(0, 50)
      saveHistory(connection.id, updated)
      setHistory(updated)
    }
  }

  // ── Derivados ──
  // Origen y destino idénticos se BLOQUEAN: con «Borrar datos del destino» borraría el origen antes
  // de leerlo. El mismo sistema con OTRA área o versión es la migración interna admitida.
  const sameTarget = !!srcConn && srcConn.id === connection.id && !!srcPa && srcPa === dstPa && (srcVersion || '') === (dstVersion || '')
  const canMigrate = !running && !!srcConn && !!srcPa && !!dstPa && mdtOrder.length > 0 && !sameTarget
  const oneSel     = !running && mdtOrder.length === 1

  const PHASE_LABEL = {
    reading:    t('mig.phaseReading'),
    deleting:   t('mig.phaseDeleting'),
    writing:    t('mig.phaseWriting'),
    committing: t('mig.phaseCommitting'),
    processing: t('mig.phaseProcessing'),
    messages:   t('mig.phaseMessages'),
    retrying:   t('mig.phaseRetrying'),
  }
  const PHASE_SHORT = {
    reading:    t('mig.tReading'),
    deleting:   t('mig.tDeleting'),
    writing:    t('mig.tWriting'),
    committing: t('mig.tCommitting'),
    processing: t('mig.tProcessing'),
    messages:   t('mig.tMessages'),
    retrying:   t('mig.tRetrying'),
  }

  const statusLabel = s => s === 'ok' ? t('mig.statusOk') : s === 'error' ? t('mig.statusError')
    : s === 'warning' ? t('mig.statusWarning')
    : s === 'skipped' ? t('mig.statusSkipped')
    : s === 'processing' ? t('mig.statusProcessing') : t('mig.statusCancelled')
  const statusColor = s => s === 'ok' ? 'var(--green)' : s === 'error' ? 'var(--red)'
    : s === 'warning' ? 'var(--yellow, #e6a817)'
    : s === 'skipped' ? 'var(--text3)'
    : s === 'processing' ? 'var(--yellow, #e6a817)' : 'var(--text3)'
  const statusIcon  = s => s === 'ok' ? '✓' : s === 'error' ? '✕' : s === 'warning' ? '⚠'
    : s === 'skipped' ? '⊘'
    : s === 'processing' ? '⧗' : '⊘'

  const destName = nombreConAmbiente(connection)
  const destEnv  = connection.isProduction ? 'Producción' : 'Calidad'

  // ─────────────────────────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>

      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 20 }}>
        {t('mig.title')}
      </div>

      {/* Aviso de tope de volumen: solo en la web; en local (sin tope) no se muestra. */}
      {!isLocalRun() && (
        <div style={{
          fontSize: 11, color: 'var(--text2)', lineHeight: 1.5, marginBottom: 20,
          background: 'color-mix(in srgb, var(--accent) 7%, transparent)',
          border: '1px solid color-mix(in srgb, var(--accent) 28%, transparent)',
          borderRadius: 8, padding: '9px 12px',
        }}>
          ℹ️ {t('mig.webLimitBanner', { max: MAX_ROWS_HARD.toLocaleString() })}
        </div>
      )}

      {/* ── Origen y destino ── */}
      <div style={SECTION}>
        <div style={SECTION_HDR}>{t('mig.sectionConfig')}</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, opacity: running ? 0.5 : 1, pointerEvents: running ? 'none' : 'auto' }}>

          {/* Origen */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
              <label style={{ ...LABEL, marginBottom: 0 }}>{t('mig.srcLabel')}</label>
              <BotonActualizar
                etiqueta={t('mig.refreshConns').replace(/^↺\s*/, '')}
                cargando={dstLoading || srcLoading}
                mensaje={t('mig.refreshingMsg')}
                confirmar
                error={Boolean(catalogError)}
                style={{ ...BTN_SEC, padding: '3px 10px', fontSize: 11 }}
                onClick={() => {
                  // Las conexiones Y los catálogos: se olvida lo guardado de destino y origen para que
                  // un catálogo viejo o vacío no deje el desplegable de áreas vacío para siempre.
                  invalidateMasterCaches(connection.id)
                  if (srcConn) invalidateMasterCaches(srcConn.id)
                  setConnsTick(n => n + 1)
                  setCatalogTick(n => n + 1)
                }}
                title={t('mig.refreshConns')}
              />
            </div>

            {/* Se elige entre las conexiones dadas de alta: v8 pedía aquí usuario y contraseña del
                origen, pero las credenciales viven cifradas en el servidor (ver la cabecera). */}
            {allConns.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text3)', padding: '6px 0' }}>
                {t('mig.noSourceOptions')}
              </div>
            ) : (
              <SelectorDeLista
                style={SELECT}
                className=""
                titulo={t('mig.srcLabel')}
                value={srcConnId || ''}
                onChange={v => setSrcConnId(v || null)}
                options={[
                  { value: '', label: t('mig.noSource') },
                  ...allConns.map(c => ({
                    value: c.id,
                    label: c.id === connection.id ? t('mig.srcSelf', { name: nombreConAmbiente(c) }) : nombreConAmbiente(c),
                  })),
                ]}
              />
            )}

            {/* Área / versión del origen */}
            {srcConn && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {srcLoading ? (
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>{t('mig.loadingCatalog')}</div>
                ) : (
                  <>
                    <div>
                      <label style={LABEL}>{t('mig.paLabel')}</label>
                      <SelectorDeLista
                        style={SELECT}
                        className=""
                        titulo={t('mig.paLabel')}
                        value={srcPa}
                        onChange={v => { setSrcPa(v); setSrcVersion(''); resetSelection() }}
                        options={[
                          { value: '', label: t('mig.selectPa') },
                          ...getPas(srcCatalog).map(p => ({ value: p.id, label: p.desc ? `${p.id} — ${p.desc}` : p.id })),
                        ]}
                      />
                    </div>
                    <div>
                      <label style={LABEL}>{t('mig.versionLabel')}</label>
                      <SelectorDeLista
                        style={SELECT}
                        className=""
                        titulo={t('mig.versionLabel')}
                        value={srcVersion}
                        onChange={v => { setSrcVersion(v); resetSelection() }}
                        options={[
                          { value: '', label: t('mig.baseVersion') },
                          ...getVersions(srcCatalog, srcPa).map(v => ({ value: v.id, label: v.name ? `${v.name} (${v.id})` : v.id })),
                        ]}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Destino: siempre ESTE sistema */}
          <div>
            <label style={LABEL}>{t('mig.dstLabel')}</label>
            <div style={{
              background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
              borderRadius: 6, padding: '7px 10px', fontSize: 12, fontWeight: 600, color: 'var(--text)',
            }}>
              {destName}
              <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 8 }}>
                ({destEnv})
              </span>
            </div>

            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {dstLoading ? (
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{t('mig.loadingCatalog')}</div>
              ) : (
                <>
                  <div>
                    <label style={LABEL}>{t('mig.paLabel')}</label>
                    <SelectorDeLista
                      style={SELECT}
                      className=""
                      titulo={t('mig.paLabel')}
                      value={dstPa}
                      onChange={v => { setDstPa(v); setDstVersion(''); resetSelection() }}
                      options={[
                        { value: '', label: t('mig.selectPa') },
                        ...getPas(dstCatalog).map(p => ({ value: p.id, label: p.desc ? `${p.id} — ${p.desc}` : p.id })),
                      ]}
                    />
                  </div>
                  <div>
                    <label style={LABEL}>{t('mig.versionLabel')}</label>
                    <SelectorDeLista
                      style={SELECT}
                      className=""
                      titulo={t('mig.versionLabel')}
                      value={dstVersion}
                      onChange={v => { setDstVersion(v); resetSelection() }}
                      options={[
                        { value: '', label: t('mig.baseVersion') },
                        ...getVersions(dstCatalog, dstPa).map(v => ({ value: v.id, label: v.name ? `${v.name} (${v.id})` : v.id })),
                      ]}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {catalogError && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--red)' }}>✕ {catalogError}</div>
        )}
      </div>

      {/* ── Datos maestros a migrar ── */}
      {srcPa && dstPa && (
        <div style={{ ...SECTION, opacity: running ? 0.5 : 1, pointerEvents: running ? 'none' : 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={SECTION_HDR}>{t('mig.mdtTitle')}</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {mdtOrder.length > 0 && (
                <span style={{ fontSize: 11, color: 'var(--text2)' }}>
                  {t('mig.mdtCountSelected', { n: mdtOrder.length })}
                </span>
              )}
              <button style={{ ...BTN_SEC, padding: '4px 10px', fontSize: 11 }}
                onClick={() => {
                  setMdtOrder([...availableMdts])
                  setMdtMapping(Object.fromEntries(availableMdts.map(src => [src, suggestDstName(src, dstCandidates) || src])))
                }}>
                {t('mig.mdtSelectAll')}
              </button>
              <button style={{ ...BTN_SEC, padding: '4px 10px', fontSize: 11 }}
                onClick={() => { setMdtOrder([]); setMdtMapping({}); setMdtFilters({}); setFilterOpen(null) }}>
                {t('mig.mdtNone')}
              </button>
            </div>
          </div>

          {(!srcVersion || !dstVersion) && (
            <div style={{
              fontSize: 11, color: 'var(--yellow, #e6a817)',
              background: 'color-mix(in srgb, var(--yellow, #e6a817) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--yellow, #e6a817) 30%, transparent)',
              borderRadius: 6, padding: '5px 10px', marginBottom: 10,
            }}>
              {t('mig.baseWarning')}
            </div>
          )}

          {availableMdts.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text3)', padding: '6px 0' }}>
              {t('mig.mdtNoIntersection')}
            </div>
          ) : (
            // La lista de tablas es larga: se elige en una ventana (pedido el 2026-10-06) y las elegidas
            // quedan debajo, en «Orden de migración», donde cada una se puede quitar.
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="button" className="vs-boton" style={BTN_SEC} onClick={() => setPickMdts(true)}>
                {t('mig.pickMdts')} <span className="vs-boton-cuenta">({mdtOrder.length}/{availableMdts.length})</span>
              </button>
              {/* La vista previa del v8 salía en la fila de la única tabla marcada. */}
              {oneSel && (
                <button
                  type="button"
                  style={{ ...BTN_SEC, padding: '5px 10px', fontSize: 11 }}
                  onClick={() => handlePreview(mdtOrder[0])}
                >
                  {t('mig.previewBtn')} ({mdtOrder[0]})
                </button>
              )}
            </div>
          )}
          {pickMdts && (
            <VentanaDeSeleccion
              titulo={t('mig.pickMdtsTitle')}
              opciones={availableMdts}
              seleccion={mdtOrder}
              sufijoDeConteo={t('mig.pickedMdts')}
              onGuardar={sel => { aplicarMdts(sel); setPickMdts(false) }}
              onCerrar={() => setPickMdts(false)}
            />
          )}

          {/* ── Orden de migración ── */}
          {mdtOrder.length > 0 && (
            <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ ...SECTION_HDR, marginBottom: 8 }}>{t('mig.orderTitle')}</div>
              {mdtOrder.map((mdt, idx) => {
                const isOver  = dragOver?.id === mdt
                const overPos = isOver ? dragOver.pos : null
                const conds      = mdtFilters[mdt] || []
                const hasFilter  = !!mdtExtraFilter(mdt)
                const editorOpen = filterOpen === mdt
                return (
                  <Fragment key={mdt}>
                  <div
                    draggable={!isMobile}
                    onDragStart={e => { dragId.current = mdt; e.dataTransfer.effectAllowed = 'move' }}
                    onDragEnd={() => setDragOver(null)}
                    onDragOver={e => {
                      e.preventDefault()
                      if (!dragId.current || dragId.current === mdt) { setDragOver(null); return }
                      const rect = e.currentTarget.getBoundingClientRect()
                      const pos  = (e.clientY - rect.top) < rect.height / 2 ? 'top' : 'bottom'
                      setDragOver({ id: mdt, pos })
                    }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={e => {
                      e.preventDefault()
                      const from = dragId.current
                      dragId.current = null
                      const pos = dragOver?.pos ?? 'bottom'
                      setDragOver(null)
                      if (!from || from === mdt) return
                      setMdtOrder(prev => {
                        const fromIdx = prev.indexOf(from)
                        const toIdx   = prev.indexOf(mdt)
                        if (fromIdx < 0 || toIdx < 0) return prev
                        const insertIdx = pos === 'top'
                          ? (fromIdx < toIdx ? toIdx - 1 : toIdx)
                          : (fromIdx < toIdx ? toIdx : toIdx + 1)
                        const next = [...prev]
                        const [moved] = next.splice(fromIdx, 1)
                        next.splice(insertIdx, 0, moved)
                        return next
                      })
                    }}
                    style={{
                      position: 'relative',
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '5px 8px', marginBottom: 4,
                      background: 'var(--bg)', border: '1px solid var(--border)',
                      borderRadius: 7,
                      cursor: isMobile ? 'default' : 'grab',
                      transition: 'opacity .15s',
                    }}
                  >
                    {/* Línea de destino */}
                    {isOver && (
                      <div style={{
                        position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2,
                        background: 'rgba(34,197,94,.8)', pointerEvents: 'none',
                        top:    overPos === 'top'    ? -2 : undefined,
                        bottom: overPos === 'bottom' ? -2 : undefined,
                      }} />
                    )}
                    {/* Asa (solo escritorio) */}
                    {!isMobile && (
                      <span style={{ color: 'var(--text3)', opacity: 0.45, fontSize: 14, userSelect: 'none', flexShrink: 0 }}>⠿</span>
                    )}
                    {/* Número */}
                    <div style={{
                      width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 700, color: 'var(--text2)',
                      background: 'var(--bg2)', border: '1px solid var(--border)',
                    }}>
                      {idx + 1}
                    </div>
                    {/* Origen → destino (mapeo de tabla) */}
                    <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text)', flexShrink: 0, maxWidth: '38%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={mdt}>{mdt}</span>
                    <span style={{ color: 'var(--text3)', fontSize: 12, flexShrink: 0 }}>→</span>
                    <div
                      draggable={false}
                      onPointerDown={e => e.stopPropagation()}
                      title={resolveDst(mdt) === mdt ? '' : t('mig.mappedTo')}
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      <SearchSelect
                        value={resolveDst(mdt)}
                        options={dstCandidates.map(d => ({ value: d, label: d }))}
                        onChange={v => setMdtMapping(prev => ({ ...prev, [mdt]: v }))}
                        searchPlaceholder={t('kfm.typeToFilter')}
                        titulo={`Tabla de destino de ${mdt}`}
                        btnStyle={{
                          fontSize: 11, padding: '3px 6px',
                          borderColor: resolveDst(mdt) === mdt ? 'var(--border)' : 'var(--accent)',
                        }}
                      />
                    </div>
                    {/* Filtro de registros (migración selectiva) */}
                    <button
                      onPointerDown={e => e.stopPropagation()}
                      onClick={() => handleToggleFilter(mdt)}
                      title={t('flt.btn')}
                      style={{
                        ...BTN_SEC, padding: '2px 9px', fontSize: 10, flexShrink: 0, whiteSpace: 'nowrap',
                        borderColor: hasFilter ? 'var(--accent)' : 'var(--border2)',
                        color: hasFilter ? 'var(--accent)' : 'var(--text2)',
                        fontWeight: hasFilter ? 700 : 600,
                        background: editorOpen ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'none',
                      }}
                    >
                      ⧩ {t('flt.btnShort')}{hasFilter ? ` (${conds.filter(c => condChip(c)).length})` : ''} {editorOpen ? '▾' : '▸'}
                    </button>
                    {/* ↑ ↓ */}
                    <button
                      disabled={idx === 0}
                      onClick={() => setMdtOrder(prev => {
                        const a = [...prev];[a[idx], a[idx - 1]] = [a[idx - 1], a[idx]]; return a
                      })}
                      style={{ ...BTN_SEC, padding: '2px 7px', fontSize: 10, opacity: idx === 0 ? 0.25 : 1 }}
                    >↑</button>
                    <button
                      disabled={idx === mdtOrder.length - 1}
                      onClick={() => setMdtOrder(prev => {
                        const a = [...prev];[a[idx], a[idx + 1]] = [a[idx + 1], a[idx]]; return a
                      })}
                      style={{ ...BTN_SEC, padding: '2px 7px', fontSize: 10, opacity: idx === mdtOrder.length - 1 ? 0.25 : 1 }}
                    >↓</button>
                    {/* Quitar el paso (pedido el 2026-10-06): lo mismo que desmarcar su casilla. */}
                    <button
                      type="button"
                      onPointerDown={e => e.stopPropagation()}
                      onClick={() => quitarMdt(mdt)}
                      title={t('mig.removeStep')}
                      aria-label={t('mig.removeStep')}
                      style={{ ...BTN_SEC, padding: '2px 7px', fontSize: 10, color: 'var(--red)' }}
                    >✕</button>
                  </div>

                  {/* Fichas del filtro activo (editor cerrado) */}
                  {hasFilter && !editorOpen && (
                    <div style={{ margin: '-2px 0 6px 36px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {conds.map((c, ci) => {
                        const chip = condChip(c)
                        return chip ? (
                          <span key={ci} style={{
                            fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--accent)',
                            background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                            border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                            borderRadius: 5, padding: '1px 7px',
                          }}>{chip}</span>
                        ) : null
                      })}
                    </div>
                  )}

                  {/* Editor de filtro */}
                  {editorOpen && (
                    <div style={{
                      margin: '-2px 0 8px 36px', padding: '10px 12px',
                      background: 'var(--bg)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                      borderRadius: 7,
                    }}>
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 8 }}>{t('flt.note')}</div>
                      {mdtFieldOpts[mdt] === 'loading' && (
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{t('flt.fieldsLoading')}</div>
                      )}
                      {mdtFieldOpts[mdt] === 'error' && (
                        <div style={{ fontSize: 11, color: 'var(--red)' }}>✕ {t('flt.fieldsErr')}</div>
                      )}
                      {Array.isArray(mdtFieldOpts[mdt]) && (
                        <>
                          {conds.map((c, ci) => (
                            <div key={ci} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                              <SearchSelect
                                value={c.field}
                                options={mdtFieldOpts[mdt].map(f => ({ value: f, label: srcFieldLabels[f] && srcFieldLabels[f] !== f ? `${f} — ${srcFieldLabels[f]}` : f }))}
                                onChange={v => setMdtFilters(p => ({ ...p, [mdt]: conds.map((x, xi) => xi === ci ? { ...x, field: v, value: '' } : x) }))}
                                placeholder={t('flt.fieldPh')}
                                titulo={t('flt.fieldPh')}
                                searchPlaceholder={t('kfm.typeToFilter')}
                                style={{ flex: '0 0 32%', minWidth: 0 }}
                                btnStyle={{ fontSize: 11, padding: '4px 8px' }}
                              />
                              {/* select-fijo: lista cerrada y corta, no crece con los datos */}
                              <select
                                value={c.op}
                                onChange={e => setMdtFilters(p => ({ ...p, [mdt]: conds.map((x, xi) => xi === ci ? { ...x, op: e.target.value } : x) }))}
                                style={{ ...SELECT, flex: '0 0 150px', fontSize: 11, padding: '4px 6px' }}
                              >
                                <option value="in">{t('flt.opIn')}</option>
                                <option value="sw">{t('flt.opSw')}</option>
                              </select>
                              {c.op === 'sw' ? (
                                <input
                                  value={c.value}
                                  onChange={e => setMdtFilters(p => ({ ...p, [mdt]: conds.map((x, xi) => xi === ci ? { ...x, value: e.target.value } : x) }))}
                                  placeholder={t('flt.valuePh')}
                                  style={{ ...INPUT, flex: 1, minWidth: 0, fontSize: 11, padding: '4px 8px', fontFamily: 'var(--mono)' }}
                                />
                              ) : (
                                <MultiValueSelect
                                  value={c.value}
                                  onChange={v => setMdtFilters(p => ({ ...p, [mdt]: conds.map((x, xi) => xi === ci ? { ...x, value: v } : x) }))}
                                  loadValues={() => fetchMasterValues(srcConnId, { entidad: mdt, campo: c.field, planningArea: srcPa, versionId: srcVersion })}
                                  placeholder={t('flt.valuesPh')}
                                  titulo={`Valores de ${c.field || mdt}`}
                                  disabled={!c.field}
                                />
                              )}
                              <button
                                onClick={() => setMdtFilters(p => {
                                  const next = conds.filter((_, xi) => xi !== ci)
                                  const n = { ...p }
                                  if (next.length) n[mdt] = next; else delete n[mdt]
                                  return n
                                })}
                                title={t('flt.remove')}
                                style={{ ...BTN_SEC, padding: '2px 7px', fontSize: 10, flexShrink: 0, color: 'var(--red)', borderColor: 'var(--red)' }}
                              >✕</button>
                            </div>
                          ))}
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                            <button
                              onClick={() => setMdtFilters(p => ({ ...p, [mdt]: [...conds, { field: '', op: 'in', value: '' }] }))}
                              style={{ ...BTN_SEC, padding: '3px 10px', fontSize: 10 }}
                            >
                              {t('flt.addCond')}
                            </button>
                            {hasFilter && (
                              <button
                                onClick={() => handleTestFilter(mdt)}
                                disabled={filterTest[mdt]?.loading}
                                style={{ ...BTN_SEC, padding: '3px 10px', fontSize: 10, borderColor: 'var(--accent)', color: 'var(--accent)' }}
                              >
                                {filterTest[mdt]?.loading ? t('flt.testing') : t('flt.test')}
                              </button>
                            )}
                            {filterTest[mdt]?.n != null && (
                              <span style={{ fontSize: 11, color: 'var(--green)', fontFamily: 'var(--mono)' }}>
                                ✓ {t('flt.testResult', { n: filterTest[mdt].n.toLocaleString(), total: (filterTest[mdt].total ?? 0).toLocaleString() })}
                              </span>
                            )}
                            {filterTest[mdt]?.error && (
                              <span style={{ fontSize: 11, color: 'var(--red)' }}>✕ {t('flt.testErr', { msg: filterTest[mdt].error })}</span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  </Fragment>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Opciones y acciones ── */}
      {srcPa && dstPa && mdtOrder.length > 0 && (
        <div style={{ ...SECTION, opacity: running ? 0.5 : 1, pointerEvents: running ? 'none' : 'auto' }}>
          <div style={SECTION_HDR}>{t('mig.sectionOptions')}</div>

          {nonVersionMdts.length > 0 && (
            <div style={{
              fontSize: 11, color: 'var(--yellow, #e6a817)',
              background: 'color-mix(in srgb, var(--yellow, #e6a817) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--yellow, #e6a817) 30%, transparent)',
              borderRadius: 6, padding: '7px 10px', marginBottom: 12,
            }}>
              {t('mig.versionIndepWarning', { mdts: nonVersionMdts.join(', ') })}
            </div>
          )}

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={deleteEntries} onChange={e => setDeleteEntries(e.target.checked)} style={{ marginTop: 2 }} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{t('mig.deleteEntries')}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>{t('mig.deleteEntriesNote')}</div>
            </div>
          </label>

          {hasAnyFilter && !deleteEntries && (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8, marginLeft: 26 }}>
              ⓘ {t('flt.deleteAutoOff')}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
            <div>
              <label style={LABEL}>{t('mig.txNameLoad')}</label>
              <input style={INPUT} value={txNameLoad} onChange={e => setTxNameLoad(e.target.value)} placeholder="IBP-ControlTower-MD" maxLength={40} />
            </div>
            <div>
              <label style={LABEL}>{t('mig.txNameDel')}</label>
              <input style={{ ...INPUT, ...(deleteEntries ? {} : { opacity: 0.5 }) }} value={txNameDel} onChange={e => setTxNameDel(e.target.value)} placeholder="IBP-ControlTower-DEL" maxLength={40} disabled={!deleteEntries} />
            </div>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6 }}>{t('mig.txNameNote')}</div>
          {hasAnyFilter && deleteEntries && (
            <div style={{
              fontSize: 11, color: 'var(--red)', lineHeight: 1.5, marginTop: 10,
              background: 'color-mix(in srgb, var(--red) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--red) 30%, transparent)',
              borderRadius: 6, padding: '7px 10px',
            }}>
              ⚠ {t('flt.deleteConflict')}
            </div>
          )}
        </div>
      )}

      {/* ── Barra de acción ── */}
      {srcPa && dstPa && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          {running ? (
            <button style={BTN_DANGER} onClick={() => setShowCancelConfirm(true)}>
              {t('mig.cancelBtn')}
            </button>
          ) : (
            <button style={btnPrimary(!canMigrate || analyzing)} disabled={!canMigrate || analyzing} onClick={handleMigrateClick}>
              {analyzing ? t('mig.analyzing') : t('mig.migrateBtn')}
            </button>
          )}
          {sameTarget && (
            <span style={{ fontSize: 11, color: 'var(--red)', alignSelf: 'center' }}>✕ {t('mig.sameTargetWarning')}</span>
          )}
        </div>
      )}

      {/* ── Progreso (cada tabla elegida con su estado en vivo) ── */}
      {running && (
        <div style={{ ...SECTION, background: 'color-mix(in srgb, var(--accent) 5%, var(--bg2))' }}>
          <div style={{ ...SECTION_HDR, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{t('mig.progressTitle', { cur: progress?.datasetCur || 0, total: mdtOrder.length })}</span>
            <span style={{ fontFamily: 'var(--mono)', color: 'var(--text2)', letterSpacing: 0 }}>⏱ {fmtDuration(runElapsed)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {mdtOrder.map((srcName, i) => {
              const done      = (results || []).find(r => r.mdt === srcName)
              const isCurrent = !done && progress && progress.datasetCur === i + 1
              const dstName   = resolveDst(srcName)
              const label     = srcName === dstName ? srcName : `${srcName} → ${dstName}`
              const icon  = done ? statusIcon(done.status) : isCurrent ? '⏳' : '○'
              const color = done ? statusColor(done.status) : isCurrent ? 'var(--accent)' : 'var(--text3)'
              const deltaStr = done && done.dstBefore != null && done.dstAfter != null
                ? `${done.dstBefore.toLocaleString()}→${done.dstAfter.toLocaleString()}` : null
              return (
                <div key={srcName} style={{
                  border: '1px solid var(--border)', borderRadius: 7, padding: '7px 10px',
                  background: 'var(--bg)', opacity: (!done && !isCurrent) ? 0.55 : 1,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color, fontSize: 12, flexShrink: 0, width: 14, textAlign: 'center' }}>{icon}</span>
                    <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                    <span style={{ fontSize: 11, color, flexShrink: 0 }} title={done?.status === 'processing' ? t('mig.statusProcessingNote') : ''}>
                      {done
                        ? statusLabel(done.status)
                        : isCurrent ? (PHASE_LABEL[progress.phase] || '') : t('mig.stepPending')}
                    </span>
                  </div>
                  {done && (
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 22, marginTop: 2 }}>
                      {(done.total || 0).toLocaleString()} {t('mig.colTotal').toLowerCase()}
                      {done.errors > 0 ? ` · ${done.errors} ${t('mig.colErrors').toLowerCase()}` : ''}
                      {deltaStr ? ` · ${deltaStr}` : ''}
                      {done.durationMs != null ? ` · ${fmtDuration(done.durationMs)}` : ''}
                    </div>
                  )}
                  {isCurrent && (() => {
                    const elapsedS = Math.max(1, (ahora - (progress.tableStart || ahora)) / 1000)
                    const rate = progress.rows > 0 ? Math.round(progress.rows / elapsedS) : 0
                    const pct  = progress.totalRows > 0 ? Math.min(100, (progress.rows / progress.totalRows) * 100) : null
                    const etaS = (pct != null && rate > 0) ? Math.max(0, (progress.totalRows - progress.rows) / rate) : null
                    return (
                      <div style={{ marginLeft: 22, marginTop: 5 }}>
                        {pct != null && (
                          <div style={{ background: 'var(--border)', borderRadius: 4, height: 5, overflow: 'hidden', marginBottom: 3 }}>
                            <div style={{
                              background: 'var(--accent)', height: '100%', borderRadius: 4,
                              width: `${pct}%`, transition: 'width .3s',
                            }} />
                          </div>
                        )}
                        <div style={{ fontSize: 10, color: 'var(--text3)', display: 'flex', flexWrap: 'wrap', gap: '2px 14px' }}>
                          <span style={{ fontFamily: 'var(--mono)' }}>
                            {progress.rows.toLocaleString()}{progress.totalRows > 0 ? ` / ${progress.totalRows.toLocaleString()} (${Math.floor(pct)}%)` : ` ${t('kfm.rowsNoTotal')}`}
                          </span>
                          {rate > 0 && <span>{t('kfm.rate', { n: rate.toLocaleString() })}</span>}
                          {etaS != null && etaS > 1 && <span>{t('kfm.eta', { t: fmtDuration(etaS * 1000) })}</span>}
                          {(progress.segsDone || 0) > 0 && <span>{t('kfm.segs', { a: progress.segsDone, b: progress.totalSegs > 0 ? progress.totalSegs : '?' })}</span>}
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Resultado (al terminar) ── */}
      {!running && results && results.length > 0 && (
        <div style={SECTION}>
          <div style={SECTION_HDR}>{t('mig.resultsTitle')}</div>

          {/* ── Resumen de tiempos ── */}
          {(() => {
            const totalRun = results.reduce((s, r) => s + (r.durationMs || 0), 0)
            const phaseTotals = {}
            results.forEach(r => Object.entries(r.phaseTimes || {}).forEach(([p, ms]) => { phaseTotals[p] = (phaseTotals[p] || 0) + ms }))
            const slowest = results.reduce((a, b) => ((b.durationMs || 0) > (a?.durationMs || 0) ? b : a), null)
            return (
              <div style={{
                background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
                padding: '10px 12px', marginBottom: 14, fontSize: 12,
              }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 700, color: 'var(--text)' }}>
                    {t('mig.summaryTotal', { dur: fmtDuration(totalRun) })}
                  </span>
                  {slowest && (
                    <span style={{ color: 'var(--text2)' }}>
                      {t('mig.summarySlowest', { name: slowest.mdt, dur: fmtDuration(slowest.durationMs) })}
                    </span>
                  )}
                </div>
                {Object.keys(phaseTotals).length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 6, color: 'var(--text3)', fontSize: 11 }}>
                    {TIMED_PHASES.filter(p => phaseTotals[p]).map(p => (
                      <span key={p}>{PHASE_SHORT[p]}: <span style={{ color: 'var(--text2)', fontFamily: 'var(--mono)' }}>{fmtDuration(phaseTotals[p])}</span></span>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={TH}>{t('mig.colMdt')}</th>
                <th style={TH}>{t('mig.colStatus')}</th>
                <th style={TH}>{t('mig.colTotal')}</th>
                <th style={TH}>{t('mig.colOk')}</th>
                <th style={TH}>{t('mig.colErrors')}</th>
                <th style={TH}>{t('mig.colDst')}</th>
                <th style={TH}>{t('mig.colTime')}</th>
                <th style={TH}>{t('mig.colTxId')}</th>
              </tr>
            </thead>
            <tbody>
              {results.map(r => {
                const isExpanded = expandedMdt === r.mdt
                const isTimeExpanded = expandedTimeMdt === r.mdt
                const detailMsgs = r.messages || []
                const msgCols    = detailMsgs.length > 0
                  ? Object.keys(detailMsgs[0]).filter(k => k !== '__metadata')
                  : []
                return (
                  <Fragment key={r.mdt}>
                    <tr>
                      <td style={td({ fontFamily: 'var(--mono)', color: 'var(--text)' })}>
                        {r.mdt}{r.dstName && r.dstName !== r.mdt ? ` → ${r.dstName}` : ''}
                        {r.unverified && (
                          <span title={t('mig.unverifiedSchema')} style={{ color: 'var(--yellow, #e6a817)', marginLeft: 6, cursor: 'help' }}>⚠</span>
                        )}
                      </td>
                      <td style={td({ fontWeight: 600, color: statusColor(r.status) })} title={r.status === 'processing' ? t('mig.statusProcessingNote') : ''}>
                        {statusLabel(r.status)}{r.status === 'processing' ? ' ⓘ' : ''}
                      </td>
                      <td style={td({ color: 'var(--text2)' })}>{(r.total || 0).toLocaleString()}</td>
                      <td style={td({ color: 'var(--text2)' })}>{(r.ok || 0).toLocaleString()}</td>
                      <td style={td({ color: r.errors > 0 ? 'var(--red)' : 'var(--text3)' })}>
                        {r.errors > 0 ? (
                          <button
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 11, fontWeight: 600, padding: 0 }}
                            onClick={() => setExpandedMdt(isExpanded ? null : r.mdt)}
                          >
                            {isExpanded ? t('mig.errDetailHide') : t('mig.errDetail', { n: r.errors })}
                          </button>
                        ) : (r.errors || 0).toLocaleString()}
                      </td>
                      <td style={td({ color: 'var(--text2)', fontSize: 11, whiteSpace: 'nowrap' })}>
                        {r.dstBefore == null
                          ? '—'
                          : (() => {
                              const after = r.dstAfter == null ? null : r.dstAfter
                              const delta = after == null ? null : after - r.dstBefore
                              return (
                                <span>
                                  {r.dstBefore.toLocaleString()} → {after == null ? '?' : after.toLocaleString()}
                                  {delta != null && delta !== 0 && (
                                    <span style={{ color: delta > 0 ? 'var(--green)' : 'var(--red)', marginLeft: 5, fontWeight: 600 }}>
                                      ({delta > 0 ? '+' : ''}{delta.toLocaleString()})
                                    </span>
                                  )}
                                </span>
                              )
                            })()}
                      </td>
                      <td style={td({ color: 'var(--text2)', fontSize: 11, whiteSpace: 'nowrap' })}>
                        {r.durationMs == null ? '—' : (
                          <button
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text2)', fontSize: 11, padding: 0, fontFamily: 'var(--mono)' }}
                            title={t('mig.timeBreakdownHint')}
                            onClick={() => setExpandedTimeMdt(isTimeExpanded ? null : r.mdt)}
                          >
                            {fmtDuration(r.durationMs)} {isTimeExpanded ? '▾' : '▸'}
                          </button>
                        )}
                      </td>
                      <td style={td({ fontFamily: 'var(--mono)', color: 'var(--text3)', fontSize: 10 })}>{r.txId || '—'}</td>
                    </tr>
                    {isTimeExpanded && (
                      <tr>
                        <td colSpan={8} style={{ padding: '4px 0 8px 24px', borderBottom: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 11, color: 'var(--text3)' }}>
                            {TIMED_PHASES.filter(p => r.phaseTimes?.[p]).map(p => (
                              <span key={p}>{PHASE_SHORT[p]}: <span style={{ color: 'var(--text2)', fontFamily: 'var(--mono)' }}>{fmtDuration(r.phaseTimes[p])}</span></span>
                            ))}
                            {(!r.phaseTimes || Object.keys(r.phaseTimes).length === 0) && (
                              <span>{t('mig.noTimeDetail')}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} style={{ padding: '0 0 8px 24px', borderBottom: '1px solid var(--border)' }}>
                          {detailMsgs.length === 0 ? (
                            <div style={{ fontSize: 11, color: 'var(--text3)', padding: '6px 0' }}>{t('mig.noErrDetail')}</div>
                          ) : (
                            <div style={{ overflowX: 'auto' }}>
                              <table style={{ borderCollapse: 'collapse', fontSize: 11, marginTop: 6 }}>
                                <thead>
                                  <tr>
                                    {msgCols.map(c => (
                                      <th key={c} style={{ ...TH, fontSize: 9 }}>{c}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {detailMsgs.map((msg, mi) => (
                                    <tr key={mi}>
                                      {msgCols.map(c => (
                                        <td key={c} style={{ padding: '3px 8px', borderBottom: '1px solid var(--border)', color: msg.Severity === 'E' || msg.Severity === 'A' ? 'var(--red)' : 'var(--text2)', fontFamily: 'var(--mono)' }}>
                                          {formatCell(msg[c], c)}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          {results.some(r => r.errorMsg) && (
            <div style={{ marginTop: 10 }}>
              {results.filter(r => r.errorMsg).map(r => (
                <div key={r.mdt} style={{ fontSize: 11, color: 'var(--red)' }}>{r.mdt}: {r.errorMsg}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Historial ── */}
      {history.length > 0 && (
        <div style={SECTION}>
          <button
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text2)', fontWeight: 600, padding: 0 }}
            onClick={() => setShowHistory(p => !p)}
          >
            {showHistory ? t('mig.histToggleClose') : t('mig.histToggleOpen')}
          </button>
          {showHistory && (
            <div style={{ marginTop: 12, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr>
                    <th style={TH}>{t('mig.histDate')}</th>
                    <th style={TH}>{t('mig.histSrc')}</th>
                    <th style={TH}>{t('mig.histDst')}</th>
                    <th style={TH}>{t('mig.histDatasets')}</th>
                    <th style={TH}>{t('mig.histRows')}</th>
                    <th style={TH}>{t('mig.histTime')}</th>
                    <th style={TH}>{t('mig.histStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => {
                    const srcName = (h.srcConnId && connById[h.srcConnId] && nombreConAmbiente(connById[h.srcConnId])) || h.srcConnName || h.srcConnId || '—'
                    return (
                      <tr key={i}>
                        <td style={td({ color: 'var(--text3)', fontSize: 11 })}>{new Date(h.date).toLocaleString()}</td>
                        <td style={td({ color: 'var(--text2)' })}>{srcName} / {h.srcPa}</td>
                        <td style={td({ color: 'var(--text2)' })}>{destName} / {h.dstPa}</td>
                        <td style={td({ color: 'var(--text2)' })}>{h.mdts?.length || 0}</td>
                        <td style={td({ color: 'var(--text2)' })}>{(h.totalRows || 0).toLocaleString()}</td>
                        <td style={td({ color: 'var(--text2)', fontFamily: 'var(--mono)' })}>{fmtDuration(h.durationMs)}</td>
                        <td style={td({ fontWeight: 600, color: statusColor(h.status) })}>
                          {statusLabel(h.status)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Vista previa ── */}
      {(previewLoading || previewData) && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'var(--overlay)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => { setPreviewData(null); setPreviewLoading(false) }}
        >
          <div
            style={{
              background: 'var(--bg2)', border: '1px solid var(--border2)',
              borderRadius: 12, padding: 24, width: '82vw', maxWidth: 960, maxHeight: '80vh',
              display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)',
            }}
            onClick={e => e.stopPropagation()}
          >
            {previewLoading ? (
              <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 40 }}>
                {t('mig.previewLoading')}
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                      {t('mig.previewTitle', { name: previewData.name })}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                      {t('mig.previewCount', { count: (previewData.count ?? 0).toLocaleString(), shown: previewData.rows.length })}
                    </div>
                    {previewData.error && (
                      <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>✕ {previewData.error}</div>
                    )}
                  </div>
                  <button style={{ ...BTN_SEC, flexShrink: 0 }} onClick={() => setPreviewData(null)}>
                    {t('mig.previewClose')}
                  </button>
                </div>
                {previewData.rows.length > 0 && (() => {
                  const cols = Object.keys(previewData.rows[0])
                  return (
                    <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1 }}>
                      <table style={{ borderCollapse: 'collapse', fontSize: 11, whiteSpace: 'nowrap' }}>
                        <thead>
                          <tr>
                            {cols.map(c => (
                              <th key={c} style={{ ...TH, padding: '4px 10px' }}>{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewData.rows.map((row, i) => (
                            <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--bg)' }}>
                              {cols.map(c => (
                                <td key={c} style={{ padding: '4px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)' }}>
                                  {formatCell(row[c], c)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                })()}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── ¿Detener migración? ── */}
      {showCancelConfirm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1001,
          background: 'var(--overlay)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--bg2)', border: '1px solid var(--border2)',
            borderRadius: 12, padding: 28, width: 400, maxWidth: '90vw',
            boxShadow: 'var(--shadow-lg)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>
              {t('mig.cancelConfirmTitle')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 22 }}>
              {t('mig.cancelConfirmMsg')}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button style={BTN_SEC} onClick={() => setShowCancelConfirm(false)}>
                {t('mig.cancelConfirmBack')}
              </button>
              <button
                style={{ ...btnPrimary(false), background: 'var(--red)', color: '#fff' }}
                onClick={() => { cancelledRef.current = true; abortRef.current?.abort(); setShowCancelConfirm(false) }}
              >
                {t('mig.cancelConfirmStop')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirmar migración (análisis de campos + aviso de producción) ── */}
      {showConfirm && analysis && (() => {
        const isProd = !!connection.isProduction
        const runTotal   = mdtOrder.reduce((s, m) => s + (analysis.byMdt?.[m]?.count || 0), 0)
        const runBlocked = !isLocalRun() && runTotal > MAX_ROWS_HARD
        return (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'var(--overlay)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--bg2)', border: '1px solid var(--border2)',
            borderRadius: 12, padding: 24, width: 560, maxWidth: '92vw', maxHeight: '82vh',
            display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>
              {t('mig.analyzeTitle')}
            </div>

            {isProd && (
              <div style={{
                fontSize: 11, color: 'var(--red)', lineHeight: 1.5, marginBottom: 12,
                background: 'color-mix(in srgb, var(--red) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--red) 30%, transparent)',
                borderRadius: 6, padding: '7px 10px',
              }}>
                ⚠ {t('mig.confirmMsg', { name: destName })}
              </div>
            )}

            {runBlocked && (
              <div style={{
                fontSize: 11, color: 'var(--red)', lineHeight: 1.5, marginBottom: 12,
                background: 'color-mix(in srgb, var(--red) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--red) 30%, transparent)',
                borderRadius: 6, padding: '7px 10px',
              }}>
                ⊘ {t('mig.limitRunBlocked', { max: MAX_ROWS_HARD.toLocaleString(), n: runTotal.toLocaleString() })}
              </div>
            )}

            {hasAnyFilter && (
              <div style={{
                fontSize: 11, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 12,
                background: 'color-mix(in srgb, var(--accent) 6%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
                borderRadius: 6, padding: '7px 10px',
              }}>
                <div style={{ fontWeight: 700, color: 'var(--accent)', marginBottom: 3 }}>⧩ {t('flt.confirmTitle')}</div>
                {mdtOrder.filter(m => mdtExtraFilter(m)).map(m => (
                  <div key={m} style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>
                    {m}: {(mdtFilters[m] || []).map(condChip).filter(Boolean).join(' · ')}
                  </div>
                ))}
              </div>
            )}

            {hasAnyFilter && deleteEntries && (
              <div style={{
                fontSize: 11, color: 'var(--red)', lineHeight: 1.5, marginBottom: 12,
                background: 'color-mix(in srgb, var(--red) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--red) 30%, transparent)',
                borderRadius: 6, padding: '7px 10px',
              }}>
                ⚠ {t('flt.deleteConflict')}
              </div>
            )}

            {analysis.error ? (
              <div style={{ fontSize: 12, color: 'var(--red)' }}>✕ {t('mig.analyzeError', { msg: analysis.error })}</div>
            ) : (
            <>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10 }}>{t('mig.analyzeIntro')}</div>
            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {mdtOrder.map(mdt => {
                const a = analysis.byMdt[mdt] || {}
                const ok = a.verifiable && a.omitted.length === 0 && a.unfilled.length === 0
                return (
                  <div key={mdt} style={{
                    border: '1px solid var(--border)', borderRadius: 7, padding: '8px 10px',
                    background: 'var(--bg)',
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text)', marginBottom: 4 }}>{mdt}</div>
                    {typeof a.count === 'number' && (() => {
                      const blocked = !isLocalRun() && a.count > MAX_ROWS_HARD
                      const warned  = !isLocalRun() && !blocked && a.count > MAX_ROWS_WARN
                      const col = blocked ? 'var(--red)' : warned ? 'var(--yellow, #e6a817)' : 'var(--text3)'
                      return (
                        <div style={{ fontSize: 11, color: col, marginBottom: 4 }}>
                          {blocked ? '⊘ ' : warned ? '⚠ ' : ''}
                          {t('mig.rowCount', { n: a.count.toLocaleString() })}
                          {blocked && ` — ${t('mig.limitBlockedTag', { max: MAX_ROWS_HARD.toLocaleString() })}`}
                          {warned && ` — ${t('mig.limitWarnTag', { max: MAX_ROWS_WARN.toLocaleString() })}`}
                        </div>
                      )
                    })()}
                    {!a.verifiable ? (
                      <div style={{ fontSize: 11, color: 'var(--yellow, #e6a817)' }}>⚠ {t('mig.fieldsUnverifiable')}</div>
                    ) : ok ? (
                      <div style={{ fontSize: 11, color: 'var(--green)' }}>✓ {t('mig.fieldsMatch', { n: a.common.length })}</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {a.common.length > 0 && (
                          <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                            <span style={{ color: 'var(--green)' }}>✓ {t('mig.fieldsMigrated', { n: a.common.length })}:</span> <span style={{ fontFamily: 'var(--mono)' }}>{a.common.join(', ')}</span>
                          </div>
                        )}
                        {a.omitted.length > 0 && (
                          <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                            <span style={{ color: 'var(--yellow, #e6a817)' }}>↪ {t('mig.fieldsOmitted')}:</span> <span style={{ fontFamily: 'var(--mono)' }}>{a.omitted.join(', ')}</span>
                          </div>
                        )}
                        {a.unfilled.length > 0 && (
                          <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                            <span style={{ color: 'var(--yellow, #e6a817)' }}>○ {t('mig.fieldsUnfilled')}:</span> <span style={{ fontFamily: 'var(--mono)' }}>{a.unfilled.join(', ')}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            </>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              <button style={BTN_SEC} onClick={() => setShowConfirm(false)}>
                {t('mig.confirmCancel')}
              </button>
              <button
                disabled={runBlocked}
                style={runBlocked ? btnPrimary(true) : (isProd ? { ...btnPrimary(false), background: 'var(--red)', color: '#fff' } : btnPrimary(false))}
                onClick={runMigration}
              >
                {t('mig.confirmBtn')}
              </button>
            </div>
          </div>
        </div>
        )
      })()}

    </div>
  )
}
