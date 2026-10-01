// «Migración» → «Dato transaccional»: migrar valores de key figures entre sistemas SAP IBP.
//
// Portado tal cual de `components/Migration/KeyFigureMigration.jsx` de v8: las mismas secciones
// —«Origen y destino», «Nivel de planificación (destino)», «Filtros (opcional)», «Key figures del
// destino a llenar», «Unidad / moneda de extracción»—, la misma barra de acción, el mismo diálogo de
// confirmación, el mismo panel de progreso, la misma tabla de resultados por key figure con su
// desglose por fase, el mismo informe PDF y el mismo historial por conexión de destino.
//
// El destino es SIEMPRE la conexión de la pestaña, como en v8. Se migra UNA key figure a la vez: un
// barrido del origen, sus transacciones y un resultado por key figure.
//
// Lo que cambia respecto de v8 es DÓNDE se habla con SAP, y las dos desviaciones salen de ahí:
//   - El origen se elige entre las conexiones dadas de alta. v8 pedía usuario y contraseña del origen
//     aquí mismo; aquí las credenciales viven cifradas en el servidor y nunca llegan al navegador.
//   - Cada segmento —leer, escribir y confirmar en su transacción— lo hace el SERVIDOR en una llamada
//     (`handlers/ibp/kf-migration.js`). La pantalla orquesta como v8: cuenta, reparte los segmentos
//     entre seis trabajadores, reintenta el segmento entero en una transacción nueva y confirma. Los
//     números del motor, y por qué difieren de v8, están en `core/ibp/kf-migration-plan.js`.
//
// «Ver logs técnicos» de v8 no se porta aquí: lo cubre el panel global «Llamadas técnicas».

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import { TOPES } from '../../../core/ibp/export-csv.js'
import {
  ATRIBUTOS_DE_SOLO_LECTURA, FASES_CRONOMETRADAS, FILAS_POR_SEGMENTO, INTENTOS_POR_SEGMENTO, NIVELES_DE_TIEMPO,
  SEGMENTOS_EN_PARALELO, UMBRAL_PARA_PARTIR_POR_TIEMPO,
  cifrasPegadas, duracionLegible, esFalloTransitorio, estadoDeCifra, estadoDeCorrida, siguienteTramo,
  tiemposDeLaCorrida, totalEscrito,
} from '../../../core/ibp/kf-migration-plan.js'
import { etiquetaDeCondicion, filtroDeCondiciones } from '../../../core/ibp/master-data-model.js'
import { filtroDeFechas } from '../../../core/ibp/planning-data-model.js'
import { useGuardaDeSalida } from '../../lib/guarda-de-salida.js'
import { listIbpConnections } from '../../lib/ibp.js'
import {
  confirmarTransaccionDeCifra, contarCifra, copiarSegmentoDeCifra, periodosDeCifra,
} from '../../lib/ibp-kf-migration.js'
import {
  fetchAttrValues, fetchConversionValuesCached, fetchConversions, fetchPlanningCatalogCached, invalidatePlanningCaches,
} from '../../lib/ibp-planning-data.js'
import { nombreConAmbiente } from '../../lib/nombre-de-conexion.js'
import { MultiValueSelect, SearchSelect } from './FilterControls.jsx'

// ── Los textos de v8 (`i18n/es.json`), con sus mismas claves ──────────────────────────────────────
const TEXTOS = {
  'kfm.limitBlockedMsg': 'Omitida: {n} registros supera el límite de {max} de la versión web. Redúcela con filtros o ejecútala en la versión local.',
  'kfm.errCountRequired': 'No se pudo contar el volumen y la versión web exige el conteo para aplicar el límite. Reintenta, acota con filtros o ejecútala en la versión local.',
  'kfm.title': 'Migración de Dato Transaccional (Key Figures)',
  'kfm.subtitle': 'Migra valores de key figures entre sistemas SAP IBP. Define el nivel en el destino; el origen se lee a ese mismo nivel.',
  'kfm.catErr': 'Error al leer el catálogo: {msg}',
  'kfm.sectionConn': 'Origen y destino',
  'kfm.srcLabel': 'Sistema origen',
  'kfm.noSource': 'No hay otras conexiones con SAP_COM_0720 configurado',
  'kfm.selectSource': 'Seleccionar origen…',
  'kfm.srcVersion': 'Versión origen',
  'kfm.dstVersion': 'Versión destino',
  'kfm.txName': 'Nombre de transacción',
  'kfm.txNameNote': 'Etiqueta que queda registrada en el sistema destino para identificar esta carga.',
  'kfm.loadingCat': 'Cargando catálogo…',
  'kfm.baseVersion': 'Versión base (Baseline)',
  'kfm.area': 'Área de planificación',
  'kfm.selectArea': 'Selecciona un área',
  'kfm.dstLabel': 'Sistema destino (actual)',
  'kfm.sectionLevel': 'Nivel de planificación (destino)',
  'kfm.timeLevel': 'Nivel de tiempo',
  'kfm.levelPreview': 'Nivel: {attrs}',
  'kfm.levelHint': 'Selecciona los atributos raíz que definen el nivel del dato.',
  'kfm.attrSearch': 'Buscar atributo…',
  'kfm.attrNeedsMap': 'No existe con ese nombre en el origen — requiere mapeo',
  'kfm.dst': 'destino',
  'kfm.selectSrcAttr': 'Atributo del origen…',
  'kfm.attrSrcTitle': 'Origen de cada atributo del nivel',
  'kfm.attrSrcHint': 'Por defecto cada atributo se lee del mismo nombre en el origen. Cámbialo para leer un atributo desde OTRO (p. ej. CUSTID ← ATRIBUTOZ): SAP reagrega (suma) el KF a ese nivel al leer.',
  'kfm.sameAreaNote': 'Origen y destino son la misma área y versión: se escribe sobre el mismo KF (upsert in-place). Los miembros de destino que coincidan con los valores leídos quedan sobrescritos con el valor agregado.',
  'kfm.sectionKf': 'Key figures del destino a llenar ({n})',
  'kfm.kfHint': 'Marca los key figures del DESTINO ({dst}) que quieres llenar. Luego, en cada paso, eliges de qué key figure del ORIGEN ({src}) sale cada uno.',
  'kfm.kfSearch': 'Buscar key figure…',
  'kfm.pasteBtn': '📋 Pegar lista',
  'kfm.pasteClose': '✕ Cerrar',
  'kfm.pasteHint': 'Un key figure por línea (también valen coma o punto y coma) — se agregan con origen del mismo nombre. Línea con dos columnas separadas por TAB (copia de dos columnas de Excel) = ORIGEN → DESTINO.',
  'kfm.pasteApply': 'Agregar a la selección',
  'kfm.pasteAdded': '{n} agregado(s)',
  'kfm.pasteDupes': '{n} ya estaba(n)',
  'kfm.pasteMissing': '{n} no encontrado(s) en el destino: {list}',
  'kfm.clearAll': '✕ Desmarcar todos ({n})',
  'kfm.clearAllHint': 'Quita todos los key figures seleccionados (con sus mapeos)',
  'kfm.pdfBtn': '⬇ Exportar PDF',
  'kfm.pdfBusy': 'Generando PDF…',
  'kfm.typeToFilter': 'Escribir para filtrar…',
  'kfm.rate': '{n} filas/s',
  'kfm.eta': '≈ {t} restantes',
  'kfm.segs': 'segmentos confirmados: {a}/{b}',
  'kfm.rowsNoTotal': 'filas (total desconocido)',
  'kfm.tCount': 'Conteo',
  'kfm.histKfs': 'Key figures',
  'kfm.orderTitle': 'Orden y mapeo (origen → destino)',
  'kfm.colSrc': 'Origen ({sys})',
  'kfm.colDst': 'Destino ({sys})',
  'kfm.selectSrcKf': 'Key figure del origen…',
  'kfm.cancelBtn': 'Cancelar migración',
  'kfm.migrateBtn': 'Migrar',
  'kfm.confirmTitle': 'Confirmar migración',
  'kfm.confirmSimpleIntro': 'Se migrarán {n} key figure(s) a la versión destino {ver}. SAP valida cada registro al cargar; el resultado mostrará los rechazos si los hay.',
  'kfm.confirmLevel': 'Nivel destino',
  'kfm.confirmRemap': 'Lectura desde origen',
  'kfm.confirmCancel': 'Cancelar',
  'kfm.confirmMigrate': 'Migrar de todas formas',
  'kfm.baseWarning': 'Sin versión seleccionada se escribe en la versión base.',
  'kfm.progressTitle': 'Progreso ({cur}/{total})',
  'kfm.resultsTitle': 'Resultados',
  'kfm.colKf': 'Key figure',
  'kfm.colStatus': 'Estado',
  'kfm.colTotal': 'Registros',
  'kfm.colErrors': 'Errores',
  'kfm.colTx': 'Transacción',
  'kfm.stOk': 'OK',
  'kfm.stErr': 'Error',
  'kfm.stWarning': 'Procesado con errores',
  'kfm.stProc': 'Procesando',
  'kfm.stCancel': 'Cancelado',
  'kfm.phDetect': 'detectando',
  'kfm.phCount': 'contando',
  'kfm.phReading': 'leyendo',
  'kfm.phWriting': 'escribiendo',
  'kfm.phCommit': 'confirmando',
  'kfm.phProcessing': 'procesando',
  'kfm.phRetrying': 'reintentando (transacción nueva)',
  'kfm.time_week': 'Semana',
  'kfm.time_month': 'Mes',
  'kfm.time_quarter': 'Trimestre',
  'kfm.time_year': 'Año',
  'kfm.time_day': 'Día',
  'kfm.time_techweek': 'Semana técnica',
  'kfm.errNoUnit': 'No se encontró unidad/moneda para {kf} (sin datos al nivel elegido)',
  'kfm.errCalculated': "SAP rechazó la escritura de {kf} ('invalid column name'): el key figure no es cargable por el API — es calculado o snapshot. Los snapshot solo los llena el operador de snapshots de IBP (validado: la restricción es de SAP, a nivel de base de datos).",
  'kfm.sectionConv': 'Unidad / moneda de extracción',
  'kfm.convHint': 'Algunas key figures requieren convertir a una unidad o moneda. Elige en cuál extraer del origen (desde el dato maestro).',
  'kfm.uomLabel': 'Unidad de medida',
  'kfm.currLabel': 'Moneda',
  'kfm.selectUom': 'Seleccionar unidad…',
  'kfm.selectCurr': 'Seleccionar moneda…',
  'kfm.fltActive': '● Filtros activos',
  'kfm.fltHint': 'Acota la migración: del origen solo se leerán las filas que cumplan los filtros (atributos y/o rango de fechas). Sin filtros se migra el nivel completo.',
  'kfm.fltAttrPh': 'Atributo del origen…',
  'kfm.fltAddAttr': '+ Añadir filtro de atributo',
  'kfm.fltDateFrom': 'Desde',
  'kfm.fltDateTo': 'Hasta',
  'kfm.fltDateHint': 'Rango aplicado al nivel de tiempo elegido ({time}).',
  'kfm.fltCountBtn': 'Contar registros',
  'kfm.fltCountNeedKf': 'Selecciona al menos un key figure (con origen asignado) para poder contar.',
  'kfm.fltCountResult': '{n} filas no-cero coinciden (medido con {kf})',
  'mig.stepPending': 'Pendiente',
  'mig.statusSkipped': '⊘ Omitida (límite)',
  'mig.webLimitBanner': 'Versión web · máximo {max} registros por migración. Para volúmenes mayores, usa la versión local (sin límite).',
  'mig.histToggleOpen': 'Ver historial ▾',
  'mig.histToggleClose': 'Ocultar historial ▴',
  'mig.histDate': 'Fecha',
  'mig.histSrc': 'Origen',
  'mig.histDst': 'Destino',
  'mig.confirmMsg': 'El destino "{name}" está marcado como Producción. Los datos se sobreescribirán. ¿Continuar?',
  'mig.histRows': 'Filas',
  'mig.histStatus': 'Estado',
  'mig.refreshConns': '↺ Actualizar',
  'mig.leaveWarning': 'Hay una migración en curso. Si sales de esta pantalla, la migración se cancelará. ¿Continuar?',
  'mig.colTime': 'Tiempo',
  'mig.srcSelf': '{name} — este sistema',
  'mig.sameTargetWarning': 'Origen y destino son idénticos (mismo sistema, área y versión). Elige una versión o área distinta.',
  'mig.histTime': 'Tiempo',
  'mig.summaryTotal': 'Tiempo total: {dur}',
  'mig.summarySlowest': '· Más lenta: {name} ({dur})',
  'mig.timeBreakdownHint': 'Ver desglose por fase',
  'mig.noTimeDetail': 'Sin detalle de tiempos.',
  'mig.tReading': 'Lectura',
  'mig.tWriting': 'Escritura',
  'mig.tCommitting': 'Commit',
  'mig.tProcessing': 'Procesamiento',
  'mig.tMessages': 'Resultados',
  'flt.title': 'Filtros (opcional)',
  'flt.opIn': 'igual / en lista',
  'flt.opSw': 'comienza con',
  'flt.opNb': 'no está vacío',
  'flt.nbNote': 'sin valor — solo exige que el atributo tenga dato',
  'flt.valuesPh': 'Valores (separados por coma)…',
  'flt.valuePh': 'Prefijo…',
  'flt.remove': 'Quitar condición',
  'flt.testing': 'Contando…',
  'flt.testErr': 'No se pudo contar: {msg}',
  'flt.confirmTitle': 'Filtros activos (migración selectiva)',
  // El informe PDF
  'pdf.title': 'Reporte de migración — Dato transaccional (Key Figures)',
  'pdf.generated': 'Generado: {d}',
  'pdf.status': 'Estado',
  'pdf.startedAt': 'Inicio',
  'pdf.finishedAt': 'Fin',
  'pdf.duration': 'Duración total',
  'pdf.totalRows': 'Registros escritos',
  'pdf.secConfig': 'Configuración de la corrida',
  'pdf.secSteps': 'Key figures migradas ({n})',
  'pdf.secResults': 'Resultados por key figure',
  'pdf.secTimes': 'Tiempos por fase',
  'pdf.secMessages': 'Mensajes de SAP (rechazos)',
  'pdf.src': 'Origen',
  'pdf.dst': 'Destino',
  'pdf.areaVer': 'área {pa} · versión {v}',
  'pdf.verBase': 'Base',
  'pdf.txName': 'Nombre de transacción',
  'pdf.level': 'Nivel de planificación',
  'pdf.attrSources': 'Origen de atributos',
  'pdf.sameNames': 'todos se leen del mismo nombre en el origen',
  'pdf.filters': 'Filtros selectivos',
  'pdf.dateRange': 'Rango de fechas ({time})',
  'pdf.odataFilter': 'Filtro OData',
  'pdf.none': '—',
  'pdf.uom': 'Unidad de medida',
  'pdf.curr': 'Moneda',
  'pdf.colN': '#',
  'pdf.colSrcKf': 'Key figure origen',
  'pdf.colDstKf': 'Key figure destino',
  'pdf.rowTotals': 'Total fases',
  'pdf.timesNote': 'Los tiempos por fase suman el esfuerzo de varios workers concurrentes, por lo que pueden exceder la duración total de la corrida.',
  'pdf.colMsg': 'Mensaje',
  'pdf.msgsOf': '{kf} — {n} mensaje(s)',
  'pdf.more': '... y {n} más',
  'pdf.page': 'Página {a} de {b}',
}

/** `t()` de v8: el texto de la clave, con sus `{variables}` puestas. */
function t(clave, vars) {
  let texto = TEXTOS[clave] ?? clave
  if (vars) for (const [nombre, valor] of Object.entries(vars)) texto = texto.split(`{${nombre}}`).join(String(valor))
  return texto
}

// ── Estilos de v8 (el mismo lenguaje visual que la migración de dato maestro) ─────────────────────
const SECTION     = { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', marginBottom: 16 }
const SECTION_HDR = { fontSize: 11, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 14 }
const LABEL       = { fontSize: 10, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 5, display: 'block' }
const SELECT      = { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12, padding: '7px 10px', width: '100%', outline: 'none' }
const INPUT       = { ...SELECT }
const BTN_SEC     = { background: 'none', border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--text2)', fontSize: 12, fontWeight: 600, padding: '7px 14px', cursor: 'pointer' }
const BTN_DANGER  = { background: 'none', border: '1px solid var(--red)', borderRadius: 6, color: 'var(--red)', fontSize: 12, fontWeight: 600, padding: '7px 14px', cursor: 'pointer' }
function btnPrimary(disabled) {
  return { background: disabled ? 'var(--border2)' : 'var(--accent)', border: 'none', borderRadius: 6, color: disabled ? 'var(--text3)' : 'var(--text-on-accent)', fontSize: 12, fontWeight: 700, padding: '7px 18px', cursor: disabled ? 'not-allowed' : 'pointer' }
}
const TH = { textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--border)', color: 'var(--text2)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em' }
const td = extra => ({ padding: '6px 8px', borderBottom: '1px solid var(--border)', ...extra })

// Los niveles de tiempo de SAP IBP (campos de marca de tiempo). Semana es el de omisión.
const TIME_LEVELS = NIVELES_DE_TIEMPO.map(({ campo, clave }) => ({ field: campo, key: clave }))
const READONLY_ATTRS = new Set(ATRIBUTOS_DE_SOLO_LECTURA)

// Tope de volumen por corrida en la web (`config/migrationLimits.js` de v8). En LOCAL (localhost) no
// aplica: ahí se migra sin tope, que es donde se hacen las ejecuciones masivas.
const KF_MAX_HARD = TOPES.cifras.maximo
const LOCAL_RUN = typeof window !== 'undefined' && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location?.hostname)
const isLocalRun = () => LOCAL_RUN

const fmtDuration = duracionLegible

function errText(e) {
  if (e == null) return 'Error desconocido'
  if (typeof e === 'string') return e
  return (typeof e.message === 'string' && e.message) || String(e)
}

const cancelError = () => Object.assign(new Error('cancelled'), { isCancelled: true })

// ── Historial (por conexión de destino, como el de dato maestro) ──
const KF_HIST_KEY = id => `ibp:kfmigrations:${id}`
function loadKfHistory(connId) {
  try { return JSON.parse(localStorage.getItem(KF_HIST_KEY(connId))) || [] } catch { return [] }
}
function saveKfHistory(connId, entries) {
  try { localStorage.setItem(KF_HIST_KEY(connId), JSON.stringify(entries.slice(0, 50))) } catch { /* sin espacio */ }
}

// El catálogo del servidor con los nombres que usaba v8.
const comoCatalogo = cat => (cat ? {
  pa: cat.area, areas: cat.areas || [], dims: cat.dims || [], measures: cat.cifras || [],
  labels: cat.etiquetas || {}, versions: cat.versiones || [],
} : null)

const usaPlanificacion = c => (c?.agreements ?? []).includes('SAP_COM_0720')

export default function KfMigration({ connection }) {
  // Destino = la conexión actual. Origen = otra conexión con SAP_COM_0720, más ESTA misma (primera de
  // la lista), para migrar entre áreas o versiones del mismo sistema.
  const [conns, setConns] = useState([])
  useEffect(() => {
    let alive = true
    listIbpConnections().then(lista => { if (alive) setConns(lista || []) }).catch(() => {})
    return () => { alive = false }
  }, [])
  const allConns = useMemo(() => {
    const self = conns.find(c => c.id === connection.id) || connection
    return [self, ...conns.filter(c => c.id !== connection.id && usaPlanificacion(c))]
  }, [conns, connection])

  // ── Conexión de origen ──
  const [srcConnId, setSrcConnId] = useState(null)
  const srcConn = useMemo(() => allConns.find(c => c.id === srcConnId) || null, [allConns, srcConnId])

  // ── Catálogos y área de planificación ──
  const [dstAreas, setDstAreas] = useState([])
  const [srcAreas, setSrcAreas] = useState([])
  const [dstPa, setDstPa]   = useState('')   // área elegida en el destino
  const [srcPa, setSrcPa]   = useState('')   // área elegida en el origen
  const [dstCat, setDstCat] = useState(null)
  const [srcCat, setSrcCat] = useState(null)
  const [dstLoading, setDstLoading] = useState(false)
  const [srcLoading, setSrcLoading] = useState(false)
  const [catError, setCatError] = useState('')
  // Sube con «↺ Actualizar» para volver a leer áreas y catálogos (origen y destino) de SAP.
  const [catalogTick, setCatalogTick] = useState(0)

  // ── Selecciones ──
  const [dstVersion, setDstVersion] = useState('')   // '' = base
  const [srcVersion, setSrcVersion] = useState('')
  const [txName, setTxName]         = useState('IBP-ControlTower-KF')  // etiqueta de la transacción en el destino
  const [timeField, setTimeField]   = useState('PERIODID4_TSTAMP')
  const [levelAttrs, setLevelAttrs] = useState([])   // atributos del destino (nivel raíz)
  const [attrSearch, setAttrSearch] = useState('')
  const [steps, setSteps]           = useState([])   // [{ dstKf, srcKf, convs }]
  const [kfSearch, setKfSearch]     = useState('')
  // Agregar en bloque: pegar una lista (de Excel o del bloc de notas) en vez de marcar una por una
  const [showPaste, setShowPaste]     = useState(false)
  const [pasteText, setPasteText]     = useState('')
  const [pasteResult, setPasteResult] = useState(null)   // { added, missing: [], dupes }
  // Atributo del destino → atributo del origen (solo cuando los nombres difieren)
  const [attrMap, setAttrMap]       = useState({})
  // ── Filtros previos (migración selectiva), con los nombres del ORIGEN ──
  const [attrFilters, setAttrFilters] = useState([])   // [{ field, op: 'in'|'sw'|'nb', value }]
  const [dateFrom, setDateFrom]       = useState('')   // AAAA-MM-DD
  const [dateTo, setDateTo]           = useState('')
  const [fltCount, setFltCount]       = useState(null) // { key, loading?, n?, kf?, error? }
  // Conversión (unidad / moneda): valores del dato maestro del ORIGEN
  const [units, setUnits]           = useState([])
  const [currencies, setCurrencies] = useState([])
  const [selUom, setSelUom]         = useState('')
  const [selCurr, setSelCurr]       = useState('')

  // ── Estado de la corrida ──
  const cancelledRef = useRef(false)
  const abortRef     = useRef(null)
  const runSnapRef   = useRef(null)   // la configuración congelada de la ÚLTIMA corrida (para el PDF)
  const convTokenRef = useRef(0)
  const [running, setRunning]   = useState(false)
  const [progress, setProgress] = useState(null)
  const [results, setResults]   = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [pdfBusy, setPdfBusy]   = useState(false)
  const [pdfErr, setPdfErr]     = useState('')
  const [showConfirm, setShowConfirm] = useState(false)

  // ── Reloj en vivo (un tic por segundo mientras corre) ──
  const runStartRef = useRef(0)
  const [runElapsed, setRunElapsed] = useState(0)
  const [now, setNow] = useState(0)
  const [expandedTimeKf, setExpandedTimeKf] = useState(null)

  // ── Historial (por conexión de destino) ──
  const [history, setHistory]         = useState(() => loadKfHistory(connection.id))
  const [showHistory, setShowHistory] = useState(false)

  // Un catálogo de destino nuevo deja el nivel y los pasos en blanco, y el nivel de tiempo VÁLIDO para
  // el área: semana no existe en todas (un área diaria solo expone PERIODID0).
  function applyDstCat(c) {
    setDstCat(c)
    setLevelAttrs([]); setSteps([]); setAttrMap({}); setPasteResult(null); setPasteText('')
    const available = TIME_LEVELS.filter(tl => (c?.dims || []).includes(tl.field))
    if (available.length > 0) setTimeField(tf => (available.some(tl => tl.field === tf) ? tf : available[0].field))
  }

  // Un catálogo de origen nuevo deja los filtros en blanco y carga sus unidades y monedas.
  function applySrcCat(c, connId) {
    setSrcCat(c)
    setAttrFilters([]); setDateFrom(''); setDateTo(''); setFltCount(null)
    setUnits([]); setCurrencies([]); setSelUom(''); setSelCurr('')
    const token = ++convTokenRef.current
    if (!c || !connId) return
    fetchConversionValuesCached(connId, c.pa, 'UOMTOID').then(u => { if (convTokenRef.current === token) setUnits(u) }).catch(() => {})
    fetchConversionValuesCached(connId, c.pa, 'CURRTOID').then(v => { if (convTokenRef.current === token) setCurrencies(v) }).catch(() => {})
  }

  // ── Áreas del destino al montar (se elige sola si hay una) ──
  useEffect(() => {
    let alive = true
    const id = setTimeout(() => {
      setDstPa(''); applyDstCat(null)
      setDstLoading(true); setCatError('')
      fetchPlanningCatalogCached(connection.id)
        .then(cat => {
          if (!alive) return
          const areas = cat?.areas || []
          setDstAreas(areas)
          if (areas.length === 1) setDstPa(areas[0])
        })
        .catch(e => { if (alive) setCatError(t('kfm.catErr', { msg: errText(e) })) })
        .finally(() => { if (alive) setDstLoading(false) })
    }, 0)
    return () => { alive = false; clearTimeout(id) }
  }, [connection.id, catalogTick])

  // ── Catálogo del destino para el área elegida ──
  useEffect(() => {
    if (!dstPa) return undefined
    let alive = true
    const id = setTimeout(() => {
      setDstLoading(true); setCatError('')
      fetchPlanningCatalogCached(connection.id, dstPa)
        .then(c => { if (alive) applyDstCat(comoCatalogo(c)) })
        .catch(e => { if (alive) setCatError(t('kfm.catErr', { msg: errText(e) })) })
        .finally(() => { if (alive) setDstLoading(false) })
    }, 0)
    return () => { alive = false; clearTimeout(id) }
  }, [connection.id, dstPa, catalogTick])

  // ── Áreas del origen cuando se elige la conexión ──
  useEffect(() => {
    if (!srcConnId) return undefined
    let alive = true
    const id = setTimeout(() => {
      setSrcPa(''); applySrcCat(null)
      setSrcLoading(true); setCatError('')
      fetchPlanningCatalogCached(srcConnId)
        .then(cat => {
          if (!alive) return
          const areas = cat?.areas || []
          setSrcAreas(areas)
          if (areas.length === 1) setSrcPa(areas[0])
        })
        .catch(e => { if (alive) setCatError(t('kfm.catErr', { msg: errText(e) })) })
        .finally(() => { if (alive) setSrcLoading(false) })
    }, 0)
    return () => { alive = false; clearTimeout(id) }
  }, [srcConnId, catalogTick])

  // ── Catálogo del origen para el área elegida ──
  useEffect(() => {
    if (!srcConnId || !srcPa) return undefined
    let alive = true
    const id = setTimeout(() => {
      setSrcLoading(true); setCatError('')
      fetchPlanningCatalogCached(srcConnId, srcPa)
        .then(c => { if (alive) applySrcCat(comoCatalogo(c), srcConnId) })
        .catch(e => { if (alive) setCatError(t('kfm.catErr', { msg: errText(e) })) })
        .finally(() => { if (alive) setSrcLoading(false) })
    }, 0)
    return () => { alive = false; clearTimeout(id) }
  }, [srcConnId, srcPa, catalogTick])

  // «↺ Actualizar»: olvidar las áreas y catálogos guardados (destino y origen) y volver a leerlos.
  function refreshCatalogs() {
    invalidatePlanningCaches(connection.id)
    if (srcConnId) invalidatePlanningCaches(srcConnId)
    setCatalogTick(n => n + 1)
  }

  // ── Guarda de salida mientras corre; salir de la pantalla cancela la migración ──
  useGuardaDeSalida(running, t('mig.leaveWarning'))
  useEffect(() => () => { cancelledRef.current = true; abortRef.current?.abort() }, [])

  // El reloj en vivo, que además mueve la velocidad y el tiempo restante del panel de progreso.
  useEffect(() => {
    if (!running) return undefined
    const id = setInterval(() => {
      const ahora = Date.now()
      setNow(ahora)
      setRunElapsed(ahora - runStartRef.current)
    }, 1000)
    return () => clearInterval(id)
  }, [running])

  // El fragmento de filtro selectivo ('' = sin filtro → el nivel completo). El servidor arma el suyo
  // con las mismas funciones; este es para saber si hay filtros y para el historial y el informe.
  const extraKfFilter = useMemo(() => {
    const parts = []
    const cond = filtroDeCondiciones(attrFilters)
    if (cond) parts.push(cond)
    const fechas = filtroDeFechas(timeField, dateFrom, dateTo)
    if (fechas) parts.push(fechas)
    return parts.join(' and ')
  }, [attrFilters, dateFrom, dateTo, timeField])
  // Un conteo pertenece a los filtros con los que se hizo.
  const fltKey = `${extraKfFilter}|${srcVersion}`
  const fltShown = fltCount?.key === fltKey ? fltCount : null

  // ── Listas derivadas ──
  const dstAttrs = useMemo(() => (dstCat?.dims || []).filter(a => !a.startsWith('PERIODID') && !READONLY_ATTRS.has(a)).sort(), [dstCat])
  const dstKfs   = useMemo(() => (dstCat?.measures || []).slice().sort(), [dstCat])
  const srcKfSet = useMemo(() => new Set(srcCat?.measures || []), [srcCat])
  const srcKfOptions = useMemo(() => [...srcKfSet].sort().map(sk => ({ value: sk, label: sk })), [srcKfSet])
  const srcAttrSet = useMemo(() => new Set(srcCat?.dims || []), [srcCat])

  // Atributos del origen para FILTRAR (cualquiera del área, del nivel o derivado: uno derivado como
  // BRAND filtra bien sin estar en el nivel).
  const srcFilterAttrOptions = useMemo(() =>
    (srcCat?.dims || []).filter(a => !a.startsWith('PERIODID') && !READONLY_ATTRS.has(a)).sort().map(a => {
      const lbl = srcCat?.labels?.[a]
      return { value: a, label: lbl && lbl !== a ? `${a} — ${lbl}` : a }
    }), [srcCat])
  // Opciones del selector de ORIGEN de cada atributo del nivel, «ID — descripción».
  const srcAttrOptions = useMemo(() =>
    [...srcAttrSet].filter(s => !s.startsWith('PERIODID')).sort().map(s => {
      const lbl = srcCat?.labels?.[s]
      return { value: s, label: lbl && lbl !== s ? `${s} — ${lbl}` : s }
    }), [srcAttrSet, srcCat])

  const filteredAttrs = useMemo(() => dstAttrs.filter(a => !attrSearch || a.toLowerCase().includes(attrSearch.toLowerCase()) || (dstCat?.labels?.[a] || '').toLowerCase().includes(attrSearch.toLowerCase())), [dstAttrs, attrSearch, dstCat])
  const filteredKfs   = useMemo(() => dstKfs.filter(k => !kfSearch || k.toLowerCase().includes(kfSearch.toLowerCase()) || (dstCat?.labels?.[k] || '').toLowerCase().includes(kfSearch.toLowerCase())), [dstKfs, kfSearch, dstCat])

  // El atributo del origen de un atributo del destino: el elegido → el mismo nombre → ninguno.
  const resolveSrcAttr = a => attrMap[a] || (srcAttrSet.has(a) ? a : null)
  // Atributos sin contrapartida en el origen (otro nombre): necesitan que se elija
  const unmappedAttrs = srcCat ? levelAttrs.filter(a => !resolveSrcAttr(a)) : []

  // La key figure del origen de un paso: la del mismo nombre si existe; si no, a elegir.
  const defaultSrcKf = dstKf => (srcKfSet.has(dstKf) ? dstKf : '')

  // Detectar qué conversión pide una key figure (una lectura real contra el origen). Si no se
  // resuelve aquí, se resuelve al empezar la corrida.
  function detectConvs(dstKf, kf) {
    return fetchConversions(srcConnId, { area: srcCat.pa, cifra: kf })
      .then(convs => setSteps(p => p.map(s => (s.dstKf === dstKf ? { ...s, convs } : s))))
      .catch(() => {})
  }

  // ── Agregar en bloque desde una lista pegada ──
  function handlePasteApply() {
    const { agregadas, faltantes, repetidas } = cifrasPegadas(pasteText, {
      delDestino: dstKfs, delOrigen: [...srcKfSet], yaElegidas: steps.map(s => s.dstKf),
    })
    if (agregadas.length > 0) {
      setSteps(prev => [...prev, ...agregadas.map(a => ({ ...a, convs: undefined }))])
      // Detectar conversiones como al marcar a mano, de tres en tres.
      const queue = [...agregadas]
      Array.from({ length: 3 }, async () => {
        for (;;) {
          const s = queue.shift()
          if (!s) return
          await detectConvs(s.dstKf, s.srcKf || s.dstKf)
        }
      })
      setPasteText('')
    }
    setPasteResult({ added: agregadas.length, missing: faltantes, dupes: repetidas })
  }

  // ── El motor ──
  const needsUom  = steps.some(s => s.convs?.includes('UOMTOID'))
  const needsCurr = steps.some(s => s.convs?.includes('CURRTOID'))
  // Leer y escribir en el MISMO sitio (sistema + área + versión) solo es inútil si NADA se renombra:
  // ni un atributo del nivel ni una key figure. Con un renombrado (CUSTID ← ATRIBUTOZ reagrega el KF a
  // otro nivel) escribir sobre la misma área y versión es una operación legítima.
  const sameLocation = !!srcConn && srcConn.id === connection.id && !!srcPa && srcPa === dstPa && (srcVersion || '') === (dstVersion || '')
  const hasRemap = levelAttrs.some(a => { const s = resolveSrcAttr(a); return s && s !== a }) || steps.some(s => s.srcKf && s.srcKf !== s.dstKf)
  const sameTarget = sameLocation && !hasRemap
  const canMigrate = !running && !!srcConn && !!dstCat && !!srcCat &&
    levelAttrs.length > 0 && steps.length > 0 && steps.every(s => s.srcKf) && unmappedAttrs.length === 0 &&
    (!needsUom || selUom) && (!needsCurr || selCurr) && !sameTarget

  // Abre la confirmación al instante: sin análisis previo del nivel, como v8.
  function handleMigrateClick() { setShowConfirm(true) }

  // El nivel tal como viaja al servidor: cada atributo del destino con su atributo del origen.
  const nivelDeLectura = () => levelAttrs.map(a => ({ destino: a, origen: resolveSrcAttr(a) })).filter(x => x.origen)

  // ── «Contar registros» ──
  // Cuenta las filas del origen que cumplen los filtros al nivel configurado, con la primera key
  // figure con origen (el servicio exige una en el `$select`; la cláusula de «no cero» es la que usará
  // la migración). Es orientativo: un fallo no bloquea.
  async function handleFilterCount() {
    const step = steps.find(s => s.srcKf)
    if (!step || !srcCat) return
    const key = fltKey
    setFltCount({ key, loading: true })
    try {
      const conversiones = {}
      for (const c of step.convs || []) {
        const v = c === 'UOMTOID' ? selUom : selCurr
        if (v) conversiones[c] = v
      }
      const n = await contarCifra({
        origen: { connectionId: srcConnId, area: srcCat.pa, versionId: srcVersion },
        definicion: {
          nivel: nivelDeLectura(), cifra: { origen: step.srcKf, destino: step.dstKf }, campoDeTiempo: timeField,
          conversiones, condiciones: attrFilters.filter(c => c.field), desde: dateFrom, hasta: dateTo, soloConValor: true,
        },
        reintentos: 0,
      })
      setFltCount({ key, n, kf: step.srcKf })
    } catch (e) {
      setFltCount({ key, error: errText(e) })
    }
  }

  // El nombre del nivel de tiempo elegido.
  const timeLabel = t(`kfm.time_${(TIME_LEVELS.find(x => x.field === timeField) || {}).key}`)
  // El nivel del DESTINO, tal cual (atributos + tiempo). El remapeo del origen se enseña aparte.
  const levelStr = dims => [...dims, timeLabel].join(' × ')
  // Los atributos que se leen de OTRO atributo del origen («CUSTID ← ZCUST…»), '' si ninguno.
  const remapSummary = levelAttrs
    .map(a => { const s = resolveSrcAttr(a); return s && s !== a ? `${a} ← ${s}` : null })
    .filter(Boolean).join(', ')

  const srcName = srcConn ? nombreConAmbiente(srcConn) : ''
  const dstName = nombreConAmbiente(connection)

  async function runMigration() {
    setShowConfirm(false)
    setRunning(true); setResults([])
    cancelledRef.current = false
    const ac = new AbortController()
    abortRef.current = ac
    const signal = ac.signal
    const runStart = Date.now()
    runStartRef.current = runStart
    setRunElapsed(0); setNow(runStart)
    const runDstPa = dstCat.pa, runSrcPa = srcCat.pa
    const runTxName = txName.trim() || 'IBP-ControlTower-KF'
    const conds = attrFilters.filter(c => c.field)
    // La configuración se congela AHORA: el PDF tiene que describir lo que corrió, aunque después se
    // edite el formulario.
    runSnapRef.current = {
      startedAt: new Date(runStart).toISOString(),
      srcConn: srcName, srcPa: runSrcPa, srcVersion: srcVersion || '',
      dstConn: dstName, dstPa: runDstPa, dstVersion: dstVersion || '',
      txName: runTxName,
      levelAttrs: [...levelAttrs],
      attrSources: levelAttrs.map(a => ({ dst: a, src: resolveSrcAttr(a) || '' })),
      timeField, timeLabel,
      conds: conds.map(c => ({ field: c.field, op: c.op, value: c.value })),
      dateFrom, dateTo, filterStr: extraKfFilter || '',
      uom: needsUom ? selUom : '', curr: needsCurr ? selCurr : '',
      steps: steps.map(s => ({ src: s.srcKf, dst: s.dstKf })),
    }
    setPdfErr('')
    const all = []
    const push = r => { all.push(r); setResults([...all]) }
    const cancelled = () => cancelledRef.current || signal.aborted
    const isCancel = e => e?.isCancelled || e?.name === 'AbortError' || cancelled()
    const nivel = nivelDeLectura()
    const base = {
      origen: { connectionId: srcConnId, area: runSrcPa, versionId: srcVersion },
      destino: { connectionId: connection.id, area: runDstPa, versionId: dstVersion },
    }

    try {
      // La conversión de cada paso (la ya detectada o se detecta ahora). Después cada key figure se
      // migra SOLA, una detrás de otra: un barrido del origen, sus transacciones y un resultado.
      const resolved = []
      for (const s of steps) {
        let convs = s.convs
        if (convs === undefined) { try { convs = await fetchConversions(srcConnId, { area: runSrcPa, cifra: s.srcKf }) } catch { convs = [] } }
        resolved.push({ ...s, convs: convs || [] })
      }

      let done = 0
      let runRows = 0   // filas acumuladas de la corrida (para el tope de la web)
      for (const s of resolved) {
        if (cancelled()) break
        const groupStart = Date.now()
        const phaseAcc = {}   // ms acumulados por fase (sumados entre trabajadores concurrentes)
        const addPhase = (k, ms) => { if (ms) phaseAcc[k] = (phaseAcc[k] || 0) + ms }
        const finish = extra => ({ kf: s.dstKf, srcKf: s.srcKf, durationMs: Date.now() - groupStart, phaseTimes: { ...phaseAcc }, ...extra })

        // Cada atributo de conversión que pide la key figure (puede pedir unidad Y moneda). Si falta el
        // valor elegido, error claro en vez de dejar que SAP conteste 400.
        const conversiones = {}
        let missingConv = false
        for (const c of s.convs) {
          const v = c === 'UOMTOID' ? selUom : selCurr
          if (!v) { missingConv = true; break }
          conversiones[c] = v
        }
        if (missingConv) {
          push({ kf: s.dstKf, srcKf: s.srcKf, status: 'error', total: 0, ok: 0, errors: 1, errorMsg: t('kfm.errNoUnit', { kf: s.srcKf }) })
          done += 1; continue
        }

        const definicion = {
          nivel, cifra: { origen: s.srcKf, destino: s.dstKf }, campoDeTiempo: timeField, conversiones,
          condiciones: conds, desde: dateFrom, hasta: dateTo, soloConValor: true,
        }
        setProgress({ cur: done + 1, total: steps.length, name: s.dstKf, rows: 0, totalRows: 0, phase: 'count', groupStart, segsDone: 0, totalSegs: 0 })

        try {
          // El conteo, con el filtro de «no cero» del origen (positivos Y negativos; `ne 0` SAP lo
          // ignora). Acotado: un reintento y 60 s. Si SAP no acepta ese filtro, se cuenta sin él y la
          // lectura tampoco lo lleva. En la web el conteo es OBLIGATORIO: sin total no hay tope.
          let totalRows = 0
          let countKnown = false   // distingue «no se pudo contar» de un 0 legítimo
          const t0count = Date.now()
          try {
            totalRows = await contarCifra({ ...base, definicion, reintentos: 1 }, { signal })
            countKnown = true
          } catch (e) {
            if (isCancel(e)) throw e
            definicion.soloConValor = false
            try {
              totalRows = await contarCifra({ ...base, definicion, reintentos: 1 }, { signal })
              countKnown = true
            } catch (e2) { if (isCancel(e2)) throw e2 }
          }
          addPhase('count', Date.now() - t0count)
          setProgress(p => ({ ...p, totalRows, totalSegs: totalRows > 0 ? Math.ceil(totalRows / FILAS_POR_SEGMENTO) : 0 }))

          if (!isLocalRun() && !countKnown) {
            push(finish({ status: 'error', total: 0, ok: 0, errors: 1, errorMsg: t('kfm.errCountRequired') }))
            done += 1; continue
          }
          // Tope por CORRIDA (acumulado de las key figures). En local no aplica.
          if (!isLocalRun() && totalRows > 0 && runRows + totalRows > KF_MAX_HARD) {
            push(finish({ status: 'skipped', total: 0, ok: 0, errors: 0, errorMsg: t('kfm.limitBlockedMsg', { max: KF_MAX_HARD.toLocaleString(), n: totalRows.toLocaleString() }) }))
            done += 1; continue
          }
          runRows += totalRows

          // Con volúmenes grandes, la lectura se parte por periodo (uno por tramo).
          let periodos = [null]
          if (totalRows > UMBRAL_PARA_PARTIR_POR_TIEMPO) {
            try {
              const ps = await periodosDeCifra({ ...base, definicion }, { signal })
              if (ps.length > 1) periodos = ps
            } catch (e) { if (isCancel(e)) throw e }
          }

          // ── Segmentos CONFIRMADOS, en paralelo ──
          // Seis trabajadores toman (periodo, desde) de un cursor común y cada segmento va en su propia
          // transacción, confirmada. Un fallo pasajero rehace SOLO ese segmento, entero, en una
          // transacción nueva; lo ya confirmado se queda. Un envío preparado nunca se repite.
          const tramos = periodos.map(periodo => ({ periodo, skip: 0, done: false }))
          setProgress(p => ({ ...p, totalSegs: Math.max(totalRows > 0 ? Math.ceil(totalRows / FILAS_POR_SEGMENTO) : 0, tramos.length) }))
          const segmentTxIds = []   // una transacción confirmada por segmento con algo escrito
          let committedRows = 0     // filas leídas de segmentos confirmados
          let totalWritten = 0      // valores escritos de verdad
          let failure = null
          const peticion = { ...base, definicion, nombre: runTxName }

          const worker = async () => {
            for (;;) {
              if (cancelled()) throw cancelError()
              if (failure) return   // otro trabajador falló: no se toma trabajo nuevo
              const w = siguienteTramo(tramos, FILAS_POR_SEGMENTO)
              if (!w) return
              for (let attempt = 1; ; attempt++) {
                if (cancelled()) throw cancelError()
                setProgress(p => ({ ...p, phase: 'reading' }))
                let r
                try {
                  r = await copiarSegmentoDeCifra({ ...peticion, periodo: w.periodo.periodo, desde: w.desde, cuantas: FILAS_POR_SEGMENTO }, { signal })
                } catch (e) {
                  if (isCancel(e)) throw e
                  // Sin respuesta del servidor (red, tiempo agotado): el segmento se rehace entero.
                  r = { ok: false, error: errText(e), transitorio: esFalloTransitorio(e?.status) }
                }
                for (const [fase, ms] of Object.entries(r.tiempos || {})) addPhase(fase, ms)
                if (r.ok) {
                  if (r.agotado) w.periodo.done = true
                  committedRows += r.leidas || 0
                  if (r.transactionId) segmentTxIds.push(r.transactionId)
                  totalWritten += r.escritas || 0
                  setProgress(p => ({ ...p, rows: committedRows, segsDone: (p.segsDone || 0) + 1 }))
                  break
                }
                // Una key figure calculada no se arregla reintentando.
                if (r.cifraCalculada) throw Object.assign(new Error(r.error), { isCalculated: true, calculatedKf: r.cifraCalculada })
                if (r.transitorio && attempt < INTENTOS_POR_SEGMENTO) {
                  setProgress(p => ({ ...p, phase: 'retrying' }))
                  await new Promise(res => { setTimeout(res, 1500 * attempt) })
                  continue
                }
                throw new Error(r.error)
              }
            }
          }
          const guarded = async () => {
            try { await worker() } catch (e) { if (!failure) failure = e; throw e }
          }
          // La velocidad y el tiempo restante se miden desde que empieza la lectura.
          setProgress(p => ({ ...p, readStart: Date.now() }))
          const settled = await Promise.allSettled(Array.from({ length: SEGMENTOS_EN_PARALELO }, guarded))
          if (settled.some(x => x.status === 'rejected')) throw (cancelled() ? cancelError() : failure)

          // Nada tenía valor → nada migrado (y nada confirmado).
          if (totalWritten === 0) {
            push(finish({ txId: null, status: 'ok', total: 0, ok: 0, errors: 0 }))
            done += 1; continue
          }

          // Confirmar el procesamiento de TODAS las transacciones, a la vez (con tope). Los mensajes
          // solo se piden si una transacción no volvió limpia, y solo cuentan los E/A.
          setProgress(p => ({ ...p, phase: 'processing' }))
          const tProc = Date.now()
          let hayError = false, hayAviso = false, sinConfirmar = false
          const msgs = []
          const txQueue = [...segmentTxIds]
          const confirmWorker = async () => {
            for (;;) {
              if (cancelled()) break
              const tx = txQueue.shift()
              if (!tx) break
              let estado = null, mensajes = []
              try {
                ({ estado, mensajes } = await confirmarTransaccionDeCifra({ destino: base.destino, transactionId: tx }, { signal }))
              } catch (e) { if (isCancel(e)) break }
              if (estado === 'CON_ERROR') hayError = true
              else if (estado === 'PROCESADA_CON_ERRORES') hayAviso = true
              else if (estado !== 'PROCESADA') sinConfirmar = true
              msgs.push(...(mensajes || []))
            }
          }
          await Promise.all(Array.from({ length: Math.min(SEGMENTOS_EN_PARALELO, Math.max(1, segmentTxIds.length)) }, confirmWorker))
          addPhase('processing', Date.now() - tProc)
          // Estado honesto: cualquier ERROR → error; rechazos → con errores; sin confirmar → procesando.
          const st = estadoDeCifra({ hayError, hayAviso, sinConfirmar, mensajes: msgs })
          push(finish({
            txId: segmentTxIds[segmentTxIds.length - 1] || null, status: st, total: totalWritten,
            ok: Math.max(0, totalWritten - msgs.length), errors: msgs.length, messages: msgs, segments: segmentTxIds.length,
          }))
        } catch (e) {
          if (isCancel(e)) {
            push(finish({ status: 'cancelled', total: 0, ok: 0, errors: 0 }))
            break
          }
          // Una key figure calculada: se dice cuál, para que se pueda quitar.
          const msg = e.isCalculated ? t('kfm.errCalculated', { kf: e.calculatedKf || s.dstKf }) : errText(e)
          push(finish({ status: 'error', total: 0, ok: 0, errors: 1, errorMsg: msg }))
        }
        done += 1
      }
    } finally {
      const endedAt = Date.now()
      setRunning(false); setProgress(null); setResults(all); setRunElapsed(endedAt - runStart)

      // La corrida queda en el historial de la conexión de destino.
      const entry = {
        date: new Date(endedAt).toISOString(),
        srcConnId: srcConn?.id || '', srcConnName: srcName,
        srcPa: runSrcPa, srcVersion, dstPa: runDstPa, dstVersion,
        kfs: steps.map(s => s.dstKf),
        filters: extraKfFilter || '',
        totalRows: totalEscrito(all),
        status: estadoDeCorrida(all),
        durationMs: endedAt - runStart,
        timings: all.map(r => ({ kf: r.kf, durationMs: r.durationMs, phaseTimes: r.phaseTimes })),
      }
      const updated = [entry, ...loadKfHistory(connection.id)].slice(0, 50)
      saveKfHistory(connection.id, updated)
      setHistory(updated)
      // El resultado se congela en la foto de la corrida (alimenta el PDF).
      if (runSnapRef.current) runSnapRef.current = { ...runSnapRef.current, finishedAt: entry.date, durationMs: entry.durationMs, status: entry.status, totalRows: entry.totalRows }
    }
  }

  const statusLabel = s => s === 'ok' ? t('kfm.stOk') : s === 'error' ? t('kfm.stErr') : s === 'warning' ? t('kfm.stWarning') : s === 'processing' ? t('kfm.stProc') : s === 'skipped' ? t('mig.statusSkipped') : t('kfm.stCancel')
  const statusColor = s => s === 'ok' ? 'var(--green)' : s === 'error' ? 'var(--red)' : s === 'warning' ? 'var(--yellow, #e6a817)' : s === 'processing' ? 'var(--yellow, #e6a817)' : 'var(--text3)'
  const PHASE = { detect: t('kfm.phDetect'), count: t('kfm.phCount'), reading: t('kfm.phReading'), writing: t('kfm.phWriting'), committing: t('kfm.phCommit'), processing: t('kfm.phProcessing'), retrying: t('kfm.phRetrying') }
  // Los nombres cortos de las fases para el desglose de tiempos.
  const PHASE_SHORT = { count: t('kfm.tCount'), reading: t('mig.tReading'), writing: t('mig.tWriting'), committing: t('mig.tCommitting'), processing: t('mig.tProcessing'), messages: t('mig.tMessages') }

  // ── El informe PDF de la corrida terminada (configuración + resultados + tiempos) ──
  // jsPDF se carga a pedido: su propio fragmento, fuera del paquete principal.
  async function handleExportPdf() {
    if (!results?.length || !runSnapRef.current) return
    setPdfBusy(true); setPdfErr('')
    try {
      const { downloadKfReport } = await import('../../lib/kf-report-pdf.js')
      await downloadKfReport({ snap: runSnapRef.current, results, t, fmtDuration, statusLabel, phaseShort: PHASE_SHORT, timedPhases: FASES_CRONOMETRADAS })
    } catch (e) { setPdfErr(errText(e)) }
    finally { setPdfBusy(false) }
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{t('kfm.title')}</div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 20 }}>{t('kfm.subtitle')}</div>

      {/* Aviso del tope de volumen: solo en la web; en local (sin tope) no se muestra. */}
      {!isLocalRun() && (
        <div style={{
          fontSize: 11, color: 'var(--text2)', lineHeight: 1.5, marginBottom: 20,
          background: 'color-mix(in srgb, var(--accent) 7%, transparent)',
          border: '1px solid color-mix(in srgb, var(--accent) 28%, transparent)',
          borderRadius: 8, padding: '9px 12px',
        }}>
          ℹ️ {t('mig.webLimitBanner', { max: KF_MAX_HARD.toLocaleString() })}
        </div>
      )}

      {/* ── Origen / destino ── */}
      <div style={{ ...SECTION, opacity: running ? 0.5 : 1, pointerEvents: running ? 'none' : 'auto' }}>
        <div style={{ ...SECTION_HDR, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{t('kfm.sectionConn')}</span>
          <button
            type="button"
            onClick={refreshCatalogs}
            disabled={dstLoading || srcLoading}
            title={t('mig.refreshConns')}
            style={{ background: 'none', border: 'none', cursor: (dstLoading || srcLoading) ? 'default' : 'pointer', fontSize: 10, color: 'var(--text3)', padding: '0 2px', textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}
          >
            {t('mig.refreshConns')}
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {/* Origen */}
          <div>
            <label style={LABEL}>{t('kfm.srcLabel')}</label>
            {allConns.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{t('kfm.noSource')}</div>
            ) : (
              // v8 pedía aquí usuario y contraseña del origen. En esta plataforma las credenciales viven
              // cifradas en el servidor: se elige entre las conexiones dadas de alta.
              <select style={SELECT} value={srcConnId || ''} onChange={e => {
                const id = e.target.value || null
                setSrcConnId(id)
                setSrcVersion('')
                setSrcAreas([]); setSrcPa(''); applySrcCat(null)
              }}>
                <option value="">{t('kfm.selectSource')}</option>
                {allConns.map(c => <option key={c.id} value={c.id}>{c.id === connection.id ? t('mig.srcSelf', { name: nombreConAmbiente(c) }) : nombreConAmbiente(c)}</option>)}
              </select>
            )}
            {srcConn && (
              <div style={{ marginTop: 12 }}>
                <label style={LABEL}>{t('kfm.area')}</label>
                <select style={SELECT} value={srcPa} onChange={e => { setSrcPa(e.target.value); applySrcCat(null) }} disabled={srcAreas.length <= 1}>
                  {srcAreas.length !== 1 && <option value="">{srcLoading ? t('kfm.loadingCat') : t('kfm.selectArea')}</option>}
                  {srcAreas.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                <label style={{ ...LABEL, marginTop: 10 }}>{t('kfm.srcVersion')}</label>
                <select style={SELECT} value={srcVersion} onChange={e => setSrcVersion(e.target.value)} disabled={!srcCat}>
                  <option value="">{t('kfm.baseVersion')}</option>
                  {(srcCat?.versions || []).filter(v => v.id && v.id !== '__BASELINE').map(v => <option key={v.id} value={v.id}>{v.name} ({v.id})</option>)}
                </select>
              </div>
            )}
          </div>
          {/* Destino */}
          <div>
            <label style={LABEL}>{t('kfm.dstLabel')}</label>
            <div style={{ background: 'color-mix(in srgb, var(--accent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)', borderRadius: 6, padding: '7px 10px', fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
              {dstName}
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={LABEL}>{t('kfm.area')}</label>
              <select style={SELECT} value={dstPa} onChange={e => { setDstPa(e.target.value); applyDstCat(null) }} disabled={dstAreas.length <= 1}>
                {dstAreas.length !== 1 && <option value="">{dstLoading ? t('kfm.loadingCat') : t('kfm.selectArea')}</option>}
                {dstAreas.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={LABEL}>{t('kfm.dstVersion')}</label>
              <select style={SELECT} value={dstVersion} onChange={e => setDstVersion(e.target.value)} disabled={!dstCat}>
                <option value="">{t('kfm.baseVersion')}</option>
                {(dstCat?.versions || []).filter(v => v.id && v.id !== '__BASELINE').map(v => <option key={v.id} value={v.id}>{v.name} ({v.id})</option>)}
              </select>
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={LABEL}>{t('kfm.txName')}</label>
              <input style={INPUT} value={txName} onChange={e => setTxName(e.target.value)} placeholder="IBP-ControlTower-KF" maxLength={40} />
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>{t('kfm.txNameNote')}</div>
            </div>
          </div>
        </div>
        {catError && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--red)' }}>✕ {catError}</div>}
      </div>

      {/* ── Nivel (atributos del destino + tiempo) ── */}
      {dstCat && srcCat && (
        <div style={{ ...SECTION, opacity: running ? 0.5 : 1, pointerEvents: running ? 'none' : 'auto' }}>
          <div style={SECTION_HDR}>{t('kfm.sectionLevel')}</div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: '0 0 220px' }}>
              <label style={LABEL}>{t('kfm.timeLevel')}</label>
              <select style={SELECT} value={timeField} onChange={e => setTimeField(e.target.value)}>
                {TIME_LEVELS.filter(tl => (dstCat.dims || []).includes(tl.field)).map(tl => (
                  <option key={tl.field} value={tl.field}>{t(`kfm.time_${tl.key}`)}</option>
                ))}
              </select>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>
              {levelAttrs.length > 0 ? t('kfm.levelPreview', { attrs: [...levelAttrs, timeLabel].join(' · ') }) : t('kfm.levelHint')}
            </div>
          </div>
          <input style={{ ...INPUT, marginBottom: 8 }} placeholder={t('kfm.attrSearch')} value={attrSearch} onChange={e => setAttrSearch(e.target.value)} />
          <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {filteredAttrs.slice(0, 200).map(a => {
              const sel = levelAttrs.includes(a)
              const inSrc = srcAttrSet.has(a)
              return (
                <button key={a} type="button" onClick={() => setLevelAttrs(p => sel ? p.filter(x => x !== a) : [...p, a])}
                  title={dstCat.labels?.[a] || a}
                  style={{ fontSize: 11, fontFamily: 'var(--mono)', padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                    border: `1px solid ${sel ? 'var(--accent)' : 'var(--border)'}`,
                    background: sel ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'var(--bg)',
                    color: sel ? 'var(--text)' : 'var(--text2)' }}>
                  {a}{!inSrc && <span title={t('kfm.attrNeedsMap')} style={{ color: 'var(--yellow, #e6a817)', marginLeft: 4 }}>⚠</span>}
                </button>
              )
            })}
          </div>

          {/* El atributo del origen de cada atributo del nivel. Por omisión, el mismo nombre. Cambiarlo
              LEE un atributo del destino desde OTRO del origen (CUSTID ← ATRIBUTOZ) y SAP agrega el KF a
              ese nivel. Uno sin contrapartida del mismo nombre es obligatorio (borde rojo). */}
          {levelAttrs.length > 0 && (
            <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>{t('kfm.attrSrcTitle')}</div>
              {levelAttrs.map(a => {
                const inSrc = srcAttrSet.has(a)
                const cur = attrMap[a] || (inSrc ? a : '')
                const overridden = !!attrMap[a] && attrMap[a] !== a
                const missing = !cur
                const dstLbl = dstCat?.labels?.[a]
                return (
                  <div key={a} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ flex: '0 0 210px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text)' }}>{a} <span style={{ color: 'var(--text3)' }}>({t('kfm.dst')})</span></span>
                      {dstLbl && dstLbl !== a && <span style={{ fontSize: 10, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={dstLbl}>{dstLbl}</span>}
                    </span>
                    <span style={{ color: overridden ? 'var(--accent)' : 'var(--text3)' }}>←</span>
                    <SearchSelect
                      value={cur}
                      options={srcAttrOptions}
                      onChange={v => setAttrMap(p => { const n = { ...p }; if (!v || v === a) delete n[a]; else n[a] = v; return n })}
                      placeholder={t('kfm.selectSrcAttr')}
                      searchPlaceholder={t('kfm.typeToFilter')}
                      invalid={missing}
                      style={{ flex: 1, minWidth: 0 }}
                      btnStyle={overridden && !missing ? { borderColor: 'var(--accent)' } : undefined}
                    />
                  </div>
                )
              })}
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>{t('kfm.attrSrcHint')}</div>
            </div>
          )}
        </div>
      )}

      {/* ── Filtros previos (migración selectiva) ── */}
      {dstCat && srcCat && (
        <div style={{ ...SECTION, opacity: running ? 0.5 : 1, pointerEvents: running ? 'none' : 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ ...SECTION_HDR, marginBottom: 0 }}>⧩ {t('flt.title')}</div>
            {extraKfFilter && (
              <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700 }}>
                {t('kfm.fltActive')}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>{t('kfm.fltHint')}</div>

          {/* Rango de fechas (sobre el nivel de tiempo elegido) */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ flex: '0 0 170px' }}>
              <label style={LABEL}>{t('kfm.fltDateFrom')}</label>
              <input type="date" style={INPUT} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div style={{ flex: '0 0 170px' }}>
              <label style={LABEL}>{t('kfm.fltDateTo')}</label>
              <input type="date" style={INPUT} value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            <div style={{ fontSize: 10, color: 'var(--text3)', paddingBottom: 8 }}>
              {t('kfm.fltDateHint', { time: timeLabel })}
            </div>
          </div>

          {/* Condiciones sobre atributos del origen */}
          {attrFilters.map((c, ci) => (
            <div key={ci} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <SearchSelect
                value={c.field}
                options={srcFilterAttrOptions}
                onChange={v => setAttrFilters(p => p.map((x, xi) => xi === ci ? { ...x, field: v, value: '' } : x))}
                placeholder={t('kfm.fltAttrPh')}
                searchPlaceholder={t('kfm.typeToFilter')}
                style={{ flex: '0 0 32%', minWidth: 0 }}
                btnStyle={{ fontSize: 11, padding: '4px 8px' }}
              />
              <select
                value={c.op}
                onChange={e => {
                  const v = e.target.value
                  // 'nb' no lleva valor: se limpia el que hubiera para que la ficha y el conteo digan la verdad.
                  setAttrFilters(p => p.map((x, xi) => xi === ci ? { ...x, op: v, ...(v === 'nb' ? { value: '' } : {}) } : x))
                }}
                style={{ ...SELECT, flex: '0 0 150px', fontSize: 11, padding: '4px 6px' }}
              >
                <option value="in">{t('flt.opIn')}</option>
                <option value="sw">{t('flt.opSw')}</option>
                <option value="nb">{t('flt.opNb')}</option>
              </select>
              {c.op === 'nb' ? (
                <span style={{ flex: 1, minWidth: 0, fontSize: 10, color: 'var(--text3)', fontStyle: 'italic', padding: '4px 2px' }}>
                  {t('flt.nbNote')}
                </span>
              ) : c.op === 'sw' ? (
                <input
                  value={c.value}
                  onChange={e => setAttrFilters(p => p.map((x, xi) => xi === ci ? { ...x, value: e.target.value } : x))}
                  placeholder={t('flt.valuePh')}
                  style={{ ...INPUT, flex: 1, minWidth: 0, fontSize: 11, padding: '4px 8px', fontFamily: 'var(--mono)' }}
                />
              ) : (
                <MultiValueSelect
                  key={c.field}
                  value={c.value}
                  onChange={v => setAttrFilters(p => p.map((x, xi) => xi === ci ? { ...x, value: v } : x))}
                  loadValues={() => fetchAttrValues(srcConnId, { area: srcCat.pa, campo: c.field })}
                  placeholder={t('flt.valuesPh')}
                  disabled={!c.field}
                />
              )}
              <button
                type="button"
                onClick={() => setAttrFilters(p => p.filter((_, xi) => xi !== ci))}
                title={t('flt.remove')}
                style={{ ...BTN_SEC, padding: '2px 7px', fontSize: 10, flexShrink: 0, color: 'var(--red)', borderColor: 'var(--red)' }}
              >✕</button>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setAttrFilters(p => [...p, { field: '', op: 'in', value: '' }])}
              style={{ ...BTN_SEC, padding: '3px 10px', fontSize: 10 }}
            >
              {t('kfm.fltAddAttr')}
            </button>
            {extraKfFilter && (
              <button
                type="button"
                onClick={handleFilterCount}
                disabled={fltShown?.loading || !steps.some(s => s.srcKf)}
                title={!steps.some(s => s.srcKf) ? t('kfm.fltCountNeedKf') : ''}
                style={{ ...BTN_SEC, padding: '3px 10px', fontSize: 10, borderColor: 'var(--accent)', color: 'var(--accent)', opacity: !steps.some(s => s.srcKf) ? 0.5 : 1 }}
              >
                {fltShown?.loading ? t('flt.testing') : t('kfm.fltCountBtn')}
              </button>
            )}
            {extraKfFilter && !steps.some(s => s.srcKf) && (
              <span style={{ fontSize: 10, color: 'var(--text3)' }}>{t('kfm.fltCountNeedKf')}</span>
            )}
            {fltShown?.n != null && (
              <span style={{ fontSize: 11, color: 'var(--green)', fontFamily: 'var(--mono)' }}>
                ✓ {t('kfm.fltCountResult', { n: fltShown.n.toLocaleString(), kf: fltShown.kf })}
              </span>
            )}
            {fltShown?.error && (
              <span style={{ fontSize: 11, color: 'var(--red)' }}>✕ {t('flt.testErr', { msg: fltShown.error })}</span>
            )}
          </div>
        </div>
      )}

      {/* ── Key figures (pasos) ── */}
      {dstCat && srcCat && levelAttrs.length > 0 && (
        <div style={{ ...SECTION, opacity: running ? 0.5 : 1, pointerEvents: running ? 'none' : 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, alignItems: 'baseline' }}>
            <div style={SECTION_HDR}>{t('kfm.sectionKf', { n: steps.length })}</div>
            <div style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
              {steps.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setSteps([]); setPasteResult(null) }}
                  title={t('kfm.clearAllHint')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--red)', padding: '0 2px', fontWeight: 600 }}
                >
                  {t('kfm.clearAll', { n: steps.length })}
                </button>
              )}
              <button
                type="button"
                onClick={() => { setShowPaste(p => !p); setPasteResult(null) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--text3)', padding: '0 2px', fontWeight: 600 }}
              >
                {showPaste ? t('kfm.pasteClose') : t('kfm.pasteBtn')}
              </button>
            </div>
          </div>
          {showPaste && (
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 8, padding: 12, marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 6 }}>{t('kfm.pasteHint')}</div>
              <textarea
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                placeholder={'ZWKFORECASTCCOLABPROM1\nZWKFORECASTCCOLABPROM2\n…'}
                rows={6}
                style={{ ...INPUT, fontFamily: 'var(--mono)', resize: 'vertical', marginBottom: 8, display: 'block' }}
              />
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" onClick={handlePasteApply} disabled={!pasteText.trim()} style={btnPrimary(!pasteText.trim())}>
                  {t('kfm.pasteApply')}
                </button>
                {pasteResult && (
                  <span style={{ fontSize: 11 }}>
                    {pasteResult.added > 0 && <span style={{ color: 'var(--green)' }}>✓ {t('kfm.pasteAdded', { n: pasteResult.added })}</span>}
                    {pasteResult.dupes > 0 && <span style={{ color: 'var(--text3)' }}> · {t('kfm.pasteDupes', { n: pasteResult.dupes })}</span>}
                    {pasteResult.added === 0 && pasteResult.dupes === 0 && pasteResult.missing.length === 0 && <span style={{ color: 'var(--text3)' }}>—</span>}
                  </span>
                )}
              </div>
              {pasteResult?.missing?.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--yellow, #e6a817)', marginTop: 6, fontFamily: 'var(--mono)' }}>
                  ⚠ {t('kfm.pasteMissing', { n: pasteResult.missing.length, list: pasteResult.missing.slice(0, 10).join(', ') + (pasteResult.missing.length > 10 ? ` +${pasteResult.missing.length - 10}` : '') })}
                </div>
              )}
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>
            {t('kfm.kfHint', { dst: dstName, src: srcName || t('kfm.srcLabel') })}
          </div>
          <input style={{ ...INPUT, marginBottom: 8 }} placeholder={t('kfm.kfSearch')} value={kfSearch} onChange={e => setKfSearch(e.target.value)} />
          <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {filteredKfs.slice(0, 300).map(k => {
              const sel = steps.some(s => s.dstKf === k)
              return (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '3px 2px' }} title={dstCat.labels?.[k] || k}>
                  <input type="checkbox" checked={sel} onChange={e => {
                    if (e.target.checked) {
                      setSteps(p => [...p, { dstKf: k, srcKf: defaultSrcKf(k), convs: undefined }])
                      detectConvs(k, defaultSrcKf(k) || k)
                    } else setSteps(p => p.filter(s => s.dstKf !== k))
                  }} />
                  <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text)', flex: 1 }}>{k}</span>
                </label>
              )
            })}
          </div>

          {/* Los pasos en orden, con el mapeo de key figure */}
          {steps.length > 0 && (
            <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ ...SECTION_HDR, marginBottom: 8 }}>{t('kfm.orderTitle')}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 4px', fontSize: 9, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                <span style={{ width: 22, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>{t('kfm.colSrc', { sys: srcName })}</span>
                <span style={{ width: 12, flexShrink: 0 }} />
                <span style={{ flex: '0 0 38%' }}>{t('kfm.colDst', { sys: dstName })}</span>
                <span style={{ width: 58, flexShrink: 0 }} />
              </div>
              {steps.map((s, idx) => (
                <div key={s.dstKf} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', marginBottom: 4, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 7 }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: 'var(--text2)', background: 'var(--bg2)', border: '1px solid var(--border)' }}>{idx + 1}</div>
                  {/* La key figure del origen, con buscador: cientos de key figures no caben en un select */}
                  <SearchSelect
                    value={s.srcKf}
                    options={srcKfOptions}
                    onChange={v => setSteps(p => p.map(x => x.dstKf === s.dstKf ? { ...x, srcKf: v } : x))}
                    placeholder={t('kfm.selectSrcKf')}
                    searchPlaceholder={t('kfm.typeToFilter')}
                    invalid={!s.srcKf}
                    style={{ flex: 1, minWidth: 0 }}
                    btnStyle={{ fontSize: 11, padding: '3px 6px' }}
                  />
                  <span style={{ color: 'var(--text3)', fontSize: 12 }}>→</span>
                  <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text)', flex: '0 0 38%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.dstKf}>{s.dstKf}</span>
                  <button type="button" disabled={idx === 0} onClick={() => setSteps(p => { const a = [...p];[a[idx], a[idx - 1]] = [a[idx - 1], a[idx]]; return a })} style={{ ...BTN_SEC, padding: '2px 7px', fontSize: 10, opacity: idx === 0 ? 0.25 : 1 }}>↑</button>
                  <button type="button" disabled={idx === steps.length - 1} onClick={() => setSteps(p => { const a = [...p];[a[idx], a[idx + 1]] = [a[idx + 1], a[idx]]; return a })} style={{ ...BTN_SEC, padding: '2px 7px', fontSize: 10, opacity: idx === steps.length - 1 ? 0.25 : 1 }}>↓</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Conversión (unidad / moneda) ── */}
      {dstCat && srcCat && (needsUom || needsCurr) && (
        <div style={{ ...SECTION, opacity: running ? 0.5 : 1, pointerEvents: running ? 'none' : 'auto' }}>
          <div style={SECTION_HDR}>{t('kfm.sectionConv')}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10 }}>{t('kfm.convHint')}</div>
          <div style={{ display: 'flex', gap: 24 }}>
            {needsUom && (
              <div style={{ flex: 1 }}>
                <label style={LABEL}>{t('kfm.uomLabel')}</label>
                <SearchSelect
                  value={selUom}
                  options={units.map(u => ({ value: u.id, label: u.id + (u.descripcion && u.descripcion !== u.id ? ` — ${u.descripcion}` : '') }))}
                  onChange={setSelUom}
                  placeholder={t('kfm.selectUom')}
                  searchPlaceholder={t('kfm.typeToFilter')}
                  invalid={!selUom}
                  mono={false}
                />
              </div>
            )}
            {needsCurr && (
              <div style={{ flex: 1 }}>
                <label style={LABEL}>{t('kfm.currLabel')}</label>
                <SearchSelect
                  value={selCurr}
                  options={currencies.map(c => ({ value: c.id, label: c.id + (c.descripcion && c.descripcion !== c.id ? ` — ${c.descripcion}` : '') }))}
                  onChange={setSelCurr}
                  placeholder={t('kfm.selectCurr')}
                  searchPlaceholder={t('kfm.typeToFilter')}
                  invalid={!selCurr}
                  mono={false}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Barra de acción ── */}
      {dstCat && srcCat && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
          {running ? (
            <button type="button" style={BTN_DANGER} onClick={() => { cancelledRef.current = true; abortRef.current?.abort() }}>{t('kfm.cancelBtn')}</button>
          ) : (
            <button type="button" style={btnPrimary(!canMigrate)} disabled={!canMigrate} onClick={handleMigrateClick}>{t('kfm.migrateBtn')}</button>
          )}
          {sameTarget && <span style={{ fontSize: 11, color: 'var(--red)' }}>✕ {t('mig.sameTargetWarning')}</span>}
          {!dstVersion && <span style={{ fontSize: 11, color: 'var(--yellow, #e6a817)' }}>{t('kfm.baseWarning')}</span>}
        </div>
      )}

      {/* ── Progreso: reloj, lista de pasos, %, velocidad, tiempo restante y segmentos confirmados ── */}
      {running && progress && (
        <div style={{ ...SECTION, background: 'color-mix(in srgb, var(--accent) 5%, var(--bg2))' }}>
          <div style={{ ...SECTION_HDR, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{t('kfm.progressTitle', { cur: progress.cur, total: progress.total })}</span>
            <span style={{ fontFamily: 'var(--mono)', color: 'var(--text2)', letterSpacing: 0 }}>⏱ {fmtDuration(runElapsed)}</span>
          </div>

          {/* Cada key figure elegida con su estado en vivo */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
            {steps.map(s => {
              const doneR = (results || []).find(r => r.kf === s.dstKf)
              const isCurrent = !doneR && progress.name === s.dstKf
              const icon = doneR
                ? (doneR.status === 'ok' ? '✓' : doneR.status === 'error' ? '✕' : doneR.status === 'warning' ? '⚠' : doneR.status === 'processing' ? '⧗' : '⊘')
                : isCurrent ? '⏳' : '○'
              const color = doneR ? statusColor(doneR.status) : isCurrent ? 'var(--accent)' : 'var(--text3)'
              return (
                <div key={s.dstKf} style={{ border: '1px solid var(--border)', borderRadius: 7, padding: '6px 10px', background: 'var(--bg)', opacity: (!doneR && !isCurrent) ? 0.55 : 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color, fontSize: 12, width: 14, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
                  <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.srcKf && s.srcKf !== s.dstKf ? `${s.srcKf} → ${s.dstKf}` : s.dstKf}
                  </span>
                  <span style={{ fontSize: 11, color, flexShrink: 0 }}>
                    {doneR
                      ? `${statusLabel(doneR.status)} · ${(doneR.total || 0).toLocaleString()} · ${fmtDuration(doneR.durationMs)}`
                      : isCurrent ? (PHASE[progress.phase] || '') : t('mig.stepPending')}
                  </span>
                </div>
              )
            })}
          </div>

          {/* La key figure en curso: barra y %, velocidad, tiempo restante y segmentos confirmados */}
          {(() => {
            // La velocidad se mide desde que empezó la LECTURA, no desde el conteo.
            const rateClock = progress.readStart || progress.groupStart || now
            const elapsedS = Math.max(1, (now - rateClock) / 1000)
            const rate = (progress.rows > 0 && progress.readStart) ? Math.round(progress.rows / elapsedS) : 0
            const pct = progress.totalRows > 0 ? Math.min(100, (progress.rows / progress.totalRows) * 100) : null
            const etaS = (pct != null && rate > 0) ? Math.max(0, (progress.totalRows - progress.rows) / rate) : null
            return (
              <>
                {pct != null && (
                  <div style={{ background: 'var(--border)', borderRadius: 4, height: 6, overflow: 'hidden', marginBottom: 4 }}>
                    <div style={{ background: 'var(--accent)', height: '100%', width: `${pct}%`, transition: 'width .3s' }} />
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
              </>
            )
          })()}
        </div>
      )}

      {/* ── Resultados: tiempo por key figure, desglose por fase y resumen ── */}
      {!running && results && results.length > 0 && (
        <div style={SECTION}>
          <div style={{ ...SECTION_HDR, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{t('kfm.resultsTitle')}</span>
            <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {pdfErr && <span style={{ fontSize: 10, color: 'var(--red)', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>✕ {pdfErr}</span>}
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={pdfBusy}
                style={{ ...BTN_SEC, padding: '3px 10px', fontSize: 10, letterSpacing: 0, textTransform: 'none' }}
              >
                {pdfBusy ? t('kfm.pdfBusy') : t('kfm.pdfBtn')}
              </button>
            </span>
          </div>

          {/* Resumen de tiempos */}
          {(() => {
            const { totales: phaseTotals, masLenta: slowest } = tiemposDeLaCorrida(results)
            return (
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 12 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 700, color: 'var(--text)' }}>{t('mig.summaryTotal', { dur: fmtDuration(runElapsed) })}</span>
                  {slowest && <span style={{ color: 'var(--text2)' }}>{t('mig.summarySlowest', { name: slowest.kf, dur: fmtDuration(slowest.durationMs) })}</span>}
                </div>
                {Object.keys(phaseTotals).length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 6, color: 'var(--text3)', fontSize: 11 }}>
                    {FASES_CRONOMETRADAS.filter(p => phaseTotals[p]).map(p => (
                      <span key={p}>{PHASE_SHORT[p]}: <span style={{ color: 'var(--text2)', fontFamily: 'var(--mono)' }}>{fmtDuration(phaseTotals[p])}</span></span>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>
              <th style={TH}>{t('kfm.colKf')}</th><th style={TH}>{t('kfm.colStatus')}</th>
              <th style={TH}>{t('kfm.colTotal')}</th><th style={TH}>{t('kfm.colErrors')}</th>
              <th style={TH}>{t('mig.colTime')}</th><th style={TH}>{t('kfm.colTx')}</th>
            </tr></thead>
            <tbody>
              {results.map(r => {
                const isTimeOpen = expandedTimeKf === r.kf
                return (
                  <Fragment key={r.kf}>
                    <tr>
                      <td style={td({ fontFamily: 'var(--mono)', color: 'var(--text)' })}>{r.srcKf && r.srcKf !== r.kf ? `${r.srcKf} → ${r.kf}` : r.kf}</td>
                      <td style={td({ fontWeight: 600, color: statusColor(r.status) })}>{statusLabel(r.status)}</td>
                      <td style={td({ color: 'var(--text2)' })}>{(r.total || 0).toLocaleString()}</td>
                      <td style={td({ color: r.errors > 0 ? 'var(--red)' : 'var(--text3)' })}>
                        {r.errors > 0 ? <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 11, fontWeight: 600 }} onClick={() => setExpanded(expanded === r.kf ? null : r.kf)}>{r.errors}</button> : (r.errors || 0)}
                        {r.errorMsg && <div style={{ fontSize: 10, color: 'var(--red)' }}>{r.errorMsg}</div>}
                      </td>
                      <td style={td({ color: 'var(--text2)', fontSize: 11, whiteSpace: 'nowrap' })}>
                        {r.durationMs == null ? '—' : (
                          <button
                            type="button"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text2)', fontSize: 11, padding: 0, fontFamily: 'var(--mono)' }}
                            title={t('mig.timeBreakdownHint')}
                            onClick={() => setExpandedTimeKf(isTimeOpen ? null : r.kf)}
                          >
                            {fmtDuration(r.durationMs)} {isTimeOpen ? '▾' : '▸'}
                          </button>
                        )}
                      </td>
                      <td style={td({ fontFamily: 'var(--mono)', color: 'var(--text3)', fontSize: 10 })}>{r.txId || '—'}</td>
                    </tr>
                    {isTimeOpen && (
                      <tr>
                        <td colSpan={6} style={{ padding: '4px 0 8px 24px', borderBottom: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 11, color: 'var(--text3)' }}>
                            {FASES_CRONOMETRADAS.filter(p => r.phaseTimes?.[p]).map(p => (
                              <span key={p}>{PHASE_SHORT[p]}: <span style={{ color: 'var(--text2)', fontFamily: 'var(--mono)' }}>{fmtDuration(r.phaseTimes[p])}</span></span>
                            ))}
                            {r.segments > 0 && <span>{t('kfm.segs', { a: r.segments, b: r.segments })}</span>}
                            {(!r.phaseTimes || Object.keys(r.phaseTimes).length === 0) && <span>{t('mig.noTimeDetail')}</span>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          {expanded && (results.find(r => r.kf === expanded)?.messages || []).length > 0 && (
            <div style={{ marginTop: 10, maxHeight: 200, overflowY: 'auto', fontSize: 11 }}>
              {(results.find(r => r.kf === expanded).messages).map((m, i) => (
                <div key={i} style={{ color: 'var(--red)', fontFamily: 'var(--mono)', padding: '2px 0' }}>{m.ExceptionId}: {m.MsgText}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Historial (por conexión de destino) ── */}
      {history.length > 0 && (
        <div style={SECTION}>
          <button
            type="button"
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
                    <th style={TH}>{t('kfm.histKfs')}</th>
                    <th style={TH}>{t('mig.histRows')}</th>
                    <th style={TH}>{t('mig.histTime')}</th>
                    <th style={TH}>{t('mig.histStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i}>
                      <td style={td({ color: 'var(--text3)', fontSize: 11 })}>{new Date(h.date).toLocaleString()}</td>
                      <td style={td({ color: 'var(--text2)' })}>{h.srcConnName || '—'} / {h.srcPa}{h.srcVersion ? ` / ${h.srcVersion}` : ''}</td>
                      <td style={td({ color: 'var(--text2)' })}>{dstName} / {h.dstPa}{h.dstVersion ? ` / ${h.dstVersion}` : ''}</td>
                      <td style={td({ color: 'var(--text2)' })} title={(h.kfs || []).join(', ')}>{h.kfs?.length || 0}</td>
                      <td style={td({ color: 'var(--text2)' })}>{(h.totalRows || 0).toLocaleString()}</td>
                      <td style={td({ color: 'var(--text2)', fontFamily: 'var(--mono)' })}>{fmtDuration(h.durationMs)}</td>
                      <td style={td({ fontWeight: 600, color: statusColor(h.status) })}>{statusLabel(h.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Confirmación previa: resumen INSTANTÁNEO (sin análisis lento) ── */}
      {showConfirm && (() => {
        const isProd = !!connection.isProduction
        return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--overlay)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 12, padding: 24, width: 580, maxWidth: '92vw', maxHeight: '82vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>{t('kfm.confirmTitle')}</div>
            {isProd && (
              <div style={{
                fontSize: 11, color: 'var(--red)', lineHeight: 1.5, marginBottom: 12,
                background: 'color-mix(in srgb, var(--red) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--red) 30%, transparent)',
                borderRadius: 6, padding: '7px 10px',
              }}>
                ⚠ {t('mig.confirmMsg', { name: dstName })}
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10 }}>
              {t('kfm.confirmSimpleIntro', { n: steps.length, ver: dstVersion || 'Base' })}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 10 }}>
              {t('kfm.confirmLevel')}: <span style={{ fontFamily: 'var(--mono)' }}>{levelStr(levelAttrs)}</span>
            </div>
            {remapSummary && (
              <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 10 }}>
                {t('kfm.confirmRemap')}: <span style={{ fontFamily: 'var(--mono)', color: 'var(--accent)' }}>{remapSummary}</span>
              </div>
            )}
            {sameLocation && (
              <div style={{
                fontSize: 11, color: 'var(--yellow, #e6a817)', lineHeight: 1.5, marginBottom: 10,
                background: 'color-mix(in srgb, var(--yellow, #e6a817) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--yellow, #e6a817) 30%, transparent)',
                borderRadius: 6, padding: '7px 10px',
              }}>
                ⚠ {t('kfm.sameAreaNote')}
              </div>
            )}
            {extraKfFilter && (
              <div style={{
                fontSize: 11, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 10,
                background: 'color-mix(in srgb, var(--accent) 6%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
                borderRadius: 6, padding: '7px 10px',
              }}>
                <div style={{ fontWeight: 700, color: 'var(--accent)', marginBottom: 3 }}>⧩ {t('flt.confirmTitle')}</div>
                {attrFilters.map((c, ci) => {
                  const chip = etiquetaDeCondicion(c)
                  return chip ? <div key={ci} style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>{chip}</div> : null
                })}
                {(dateFrom || dateTo) && (
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>
                    {timeLabel}: {dateFrom || '…'} → {dateTo || '…'}
                  </div>
                )}
              </div>
            )}
            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {steps.map(s => (
                <div key={s.dstKf} style={{ border: '1px solid var(--border)', borderRadius: 7, padding: '7px 10px', background: 'var(--bg)', fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text)' }}>
                  {s.srcKf && s.srcKf !== s.dstKf ? `${s.srcKf} → ${s.dstKf}` : s.dstKf}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" style={BTN_SEC} onClick={() => setShowConfirm(false)}>{t('kfm.confirmCancel')}</button>
              <button type="button" style={isProd ? { ...btnPrimary(false), background: 'var(--red)', color: '#fff' } : btnPrimary(false)} onClick={runMigration}>{t('kfm.confirmMigrate')}</button>
            </div>
          </div>
        </div>
        )
      })()}
    </div>
  )
}
