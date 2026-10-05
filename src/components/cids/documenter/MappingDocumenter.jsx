// Mapping Dataflow Generator: de los exports de un proyecto de CI-DS a un Excel para entregar.
//
// Portado de `mapping-dataflow.html` y `docs.js` de v9, con SU pantalla de arriba abajo: el banner, la
// conexión a IBP, los tres modos («📦 Desde archivos ZIP», «🔄 Desde Application Jobs» y
// «🔗 ZIP + Jobs»), el avance por pasos, el «Pro tip», los paneles de carga de cada modo, la selección
// de integraciones, el resultado con sus tres contadores y el log de procesamiento.
//
// COMO EN v9, los paneles de carga SIGUEN a la vista al analizar —la selección sale debajo—, el Excel
// se genera con «⚙️ Generar Excel» y se baja con «⬇️ Descargar Excel» desde el panel de resultado, y el
// ATL del modo ZIP se aplica al generar, no al analizar: así se puede añadir uno después de analizar.
//
// El único desvío de fondo es de seguridad y está en `PanelConexionIbp.jsx`: la conexión a IBP se
// ELIGE entre las dadas de alta, no se escriben credenciales.

import { useEffect, useMemo, useRef, useState } from 'react'

import { aplicarAtlSinReordenar, parseATL } from '../../../lib/cids-atl.js'
import { buildWorkbook, scanForDocument } from '../../../lib/cids-doc.js'
import { emparejarConJobs } from '../../../lib/documentador-zipjobs.js'
import { enrichAll } from '../../../lib/ibp-enrich.js'
import { ordenarPorJobs } from '../../../lib/ibp-jobs-order.js'
import {
  fetchCatalog, fetchFieldExample, fetchJobSteps, fetchJobTemplates, fetchSampleRow, fetchTaskIndex,
  nombreDeJob, plantillaDe,
} from '../../../lib/ibp.js'
import FileDropzone from '../../ui/FileDropzone.jsx'
import PanelConexionIbp from './PanelConexionIbp.jsx'
import {
  AvanceDePasos, AyudaConCuadro, LogDeProcesamiento, PanelDeResultado,
} from './PiezasDelDocumentador.jsx'

/** Baja un buffer como archivo. La única forma de entregar algo generado en el navegador. */
function descargar(buffer, nombre) {
  const url = URL.createObjectURL(new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombre
  enlace.click()
  URL.revokeObjectURL(url)
}

/** El nombre de v9, con la fecha: se generan varios y hay que poder distinguirlos. */
const nombreDelArchivo = () => `SAP_CIDS_Documentacion_${new Date().toISOString().slice(0, 10)}.xlsx`

const MODOS = [
  { id: 'zip', label: '📦 Desde archivos ZIP' },
  { id: 'jobs', label: '🔄 Desde Application Jobs' },
  { id: 'zipjobs', label: '🔗 ZIP + Jobs' },
]

const AYUDA_ZIP = 'Debes exportar el project desde CI-DS y obtendrás el archivo comprimido, luego adjúntalo '
  + 'aquí. Puedes exportar y adjuntar los que necesites.'
const AYUDA_ATL = 'Exporta los procesos (tasks) CI-DS en formato ATL desde SAP Data Services. El archivo ATL '
  + 'contiene la estructura de ejecución: grupos paralelos y orden de dataflows.'

const SUGERENCIA_DE_ARCHIVOS = (
  <>o haz click para seleccionar &nbsp;·&nbsp; <b>Múltiples archivos</b> permitidos</>
)

const claveDeJob = (job) => `${job.JobTemplateName}|${job.JobTemplateVersion ?? ''}`
const claseDeTipo = (tipo) => (tipo === 'KF' ? 'es-kf' : tipo === 'MD' ? 'es-md' : 'es-file')

export default function MappingDocumenter() {
  const [modo, setModo] = useState('zip')
  const [pasoActual, setPasoActual] = useState(0)

  // Los archivos de cada panel, separados como en v9 (`files`, `zipAtlFiles`, `atlFiles`, `jobsFiles`,
  // `zipjobsFiles`): cambiar de modo no los borra.
  const [zipsZip, setZipsZip] = useState([])
  const [atlsZip, setAtlsZip] = useState([])
  const [atlsJobs, setAtlsJobs] = useState([])
  const [zipsJobs, setZipsJobs] = useState([])
  const [zipsZj, setZipsZj] = useState([])

  // La conexión a IBP. El catálogo se guarda junto al tenant del que salió, no suelto: así al cambiar
  // de conexión no hay que limpiarlo y nunca se ve ni un instante el del tenant anterior.
  const [conexionId, setConexionId] = useState('')
  const [usada, setUsada] = useState('')
  const [intento, setIntento] = useState(0)
  const [leido, setLeido] = useState(null)
  const [planArea, setPlanArea] = useState('')

  // Los Application Jobs del modo Jobs.
  const [jobs, setJobs] = useState(null)
  const [jobsMarcados, setJobsMarcados] = useState(new Set())
  const [busquedaJobs, setBusquedaJobs] = useState('')

  // La selección de integraciones, el resultado y el log.
  const [entradas, setEntradas] = useState(null)
  const [elegidas, setElegidas] = useState(new Set())
  const [busqueda, setBusqueda] = useState('')
  const [resultado, setResultado] = useState(null)
  const [lineas, setLineas] = useState([])
  const [progreso, setProgreso] = useState(null)
  const [ocupado, setOcupado] = useState(false)

  const buffer = useRef(null)
  const panelDeSeleccion = useRef(null)

  const registrar = (texto, tipo = 'linea') => setLineas((previas) => [...previas, { texto, tipo }])
  const registrarVarias = (lista) => setLineas((previas) => [...previas, ...lista])

  // El catálogo se pide una vez por conexión usada. Es la consulta más cara de todas —el `$metadata`
  // de dato maestro pesa unos 4,8 MB— y no cambia mientras se trabaja.
  useEffect(() => {
    if (!usada) return undefined

    let abandonado = false
    const guardar = (salida) => { if (!abandonado) setLeido({ conexionId: usada, intento, ...salida }) }

    fetchCatalog(usada)
      .then((catalogo) => guardar({ catalogo, error: '' }))
      .catch((error) => guardar({ catalogo: null, error: error.message }))

    return () => { abandonado = true }
  }, [usada, intento])

  const delTenant = leido?.conexionId === usada && leido?.intento === intento ? leido : null
  const catalogo = delTenant?.catalogo ?? null
  const errorCatalogo = delTenant?.error ?? ''
  const cargandoCatalogo = Boolean(usada) && !delTenant

  // Al terminar de analizar, la selección sale debajo y se lleva a la vista, como v9.
  useEffect(() => {
    if (entradas) panelDeSeleccion.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [entradas])

  function cambiarDeModo(nuevo) {
    setModo(nuevo)
    // Como `switchDocsMode`: se esconden la selección y el resultado, y el avance vuelve al principio.
    // No se limpian ni los archivos ni el log.
    setEntradas(null)
    setResultado(null)
    buffer.current = null
    setPasoActual(0)
    setProgreso(null)
  }

  const avanzar = () => setPasoActual((previo) => previo + 1)

  /** Los archivos de un panel; en cuanto entra el primer ZIP el avance sale del paso cero (como v9). */
  function cambiarZips(setter, lista) {
    setter(lista)
    if (lista.length === 1 && pasoActual === 0) avanzar()
  }

  // ── Leer los ZIP, con el log de v9 ───────────────────────────────────────────────────────────────
  async function leerLosZip(archivos, { conLookups, pesoDelProgreso = 96 }) {
    registrar('📦 Escaneando ZIPs…', 'info')
    setProgreso(2)

    const eventos = []
    const { entradas: leidas } = await scanForDocument(archivos, {
      alRegistrar: (evento) => {
        if (evento.tipo === 'zip') eventos.push({ texto: `📦 ${evento.nombre}`, tipo: 'info' })
        else if (evento.tipo === 'batch') eventos.push({ texto: `  ✔ batch.csv: ${evento.cuantos} entradas`, tipo: 'ok' })
        else if (evento.tipo === 'xmls') eventos.push({ texto: `  📄 ${evento.cuantos} XMLs`, tipo: 'linea' })
        else if (evento.tipo === 'sinDataflows') eventos.push({ texto: `  ⚠ Sin DataFlows: ${evento.archivo}`, tipo: 'aviso' })
        else if (evento.tipo === 'error') {
          eventos.push({
            texto: evento.archivo ? `  ✗ Parse ${evento.archivo}: ${evento.mensaje}` : `  ✗ ${evento.mensaje}`,
            tipo: 'error',
          })
        }
      },
      alAvanzar: (fraccion) => setProgreso(2 + Math.round(pesoDelProgreso * fraccion)),
    })
    registrarVarias(eventos)

    registrarVarias(leidas.map((una) => ({
      tipo: 'ok',
      texto: conLookups
        ? `  ✔ ${una.sheetName}  (${una.parsed.mappings.length} mapeos · ${una.parsed.filters.length} filtros · ${una.parsed.lookups.length} lookups)`
        : `  ✔ ${una.sheetName}  (${una.parsed.mappings.length} mapeos · ${una.parsed.filters.length} filtros)`,
    })))

    return leidas
  }

  function mostrarLaSeleccion(leidas) {
    setEntradas(leidas)
    setElegidas(new Set(leidas.filter((una) => !una.isNonDI).map((una) => una.sheetName)))
    setBusqueda('')
    avanzar()
  }

  // ── Modo ZIP: «⚙️ Analizar Integraciones» ────────────────────────────────────────────────────────
  async function analizarZip() {
    setLineas([])
    setResultado(null)
    buffer.current = null
    setEntradas(null)
    setOcupado(true)
    try {
      const leidas = await leerLosZip(zipsZip, { conLookups: true })
      setProgreso(100)
      registrar(`✅ Escaneado — ${leidas.length} integraciones encontradas`, 'ok')
      mostrarLaSeleccion(leidas)
    } catch (error) {
      registrar(`✗ Error: ${error?.message || error}`, 'error')
    } finally {
      setOcupado(false)
    }
  }

  // ── Modo ZIP + Jobs: «⚙️ Analizar ZIPs + Enriquecer con Jobs IBP» ────────────────────────────────
  async function analizarZipJobs() {
    setLineas([])
    setResultado(null)
    buffer.current = null
    setEntradas(null)
    setOcupado(true)
    try {
      let leidas = await leerLosZip(zipsZj, { conLookups: false, pesoDelProgreso: 45 })
      registrar(`✔ ${leidas.length} integraciones encontradas`, 'ok')
      setProgreso(50)

      if (usada && leidas.length > 0) {
        registrar('🔍 Obteniendo JobTemplateSet desde IBP…', 'info')
        registrar('🔍 Obteniendo JobTemplateSequenceSet…', 'info')
        try {
          const indice = await fetchTaskIndex(usada)
          setProgreso(90)
          registrar(`  ✔ ${Object.keys(indice).length} task IDs indexados`, 'ok')
          const salida = emparejarConJobs(leidas, indice)
          leidas = salida.entradas
          registrarVarias(salida.registro)
        } catch (error) {
          registrar(`  ⚠ No se pudo obtener JobTemplateSequenceSet: ${error?.message || error}`, 'aviso')
        }
      } else {
        registrar('ℹ Sin conexión a IBP — las columnas Job/Step quedarán vacías.', 'info')
      }

      setProgreso(100)
      mostrarLaSeleccion(leidas)
    } catch (error) {
      registrar(`✗ Error: ${error?.message || error}`, 'error')
    } finally {
      setOcupado(false)
    }
  }

  // ── Lo que comparten los tres modos: enriquecer con IBP, armar el libro y guardarlo ──────────────
  async function armarElExcel(filas, { modoJobs, textoFinal }) {
    registrar('🔍 Obteniendo descripciones de campos desde IBP…', 'info')
    let paraDocumentar = filas

    if (catalogo) {
      const n = Object.keys(catalogo.descs).length
      registrar(n > 0 ? `✔ ${n} descripciones de campos obtenidas de IBP` : '⚠ Sin descripciones IBP', n > 0 ? 'ok' : 'aviso')
      setProgreso(15)

      const documentables = filas.filter((una) => !una.isNonDI)
      const { entradas: enriquecidas, registro } = await enrichAll(
        documentables,
        catalogo,
        (destino) => fetchSampleRow(usada, destino),
        planArea,
        (consulta) => fetchFieldExample(usada, consulta),
      )
      registrarVarias(registro)

      const porHoja = new Map(enriquecidas.map((una) => [una.sheetName, una]))
      paraDocumentar = filas.map((una) => porHoja.get(una.sheetName) ?? una)
    } else {
      registrar('⚠ Sin conexión a IBP — se usarán descripciones del XML', 'aviso')
    }

    registrar('📋 Generando hoja Parámetros…', 'info')
    const conParametros = paraDocumentar.map((una) => ({
      ...una,
      paramRow: {
        ...una.paramRow,
        atlSession: una.atlSession ?? una.paramRow.atlSession ?? '',
        atlGroup: una.atlGroup ?? una.paramRow.atlGroup ?? '',
        ibpJobName: una.ibpJobName ?? una.paramRow.ibpJobName ?? '',
        ibpStepName: una.ibpStepName ?? una.paramRow.ibpStepName ?? '',
        ibpStepType: una.ibpStepType ?? una.paramRow.ibpStepType ?? '',
      },
    }))

    registrar('📦 Ensamblando archivo Excel…', 'info')
    buffer.current = await buildWorkbook(conParametros, { modoJobs })
    setProgreso(100)

    const documentadas = conParametros.filter((una) => !una.isNonDI)
    const cuenta = {
      integraciones: documentadas.length,
      mapeos: documentadas.reduce((suma, una) => suma + una.parsed.mappings.length, 0),
      filtros: documentadas.reduce((suma, una) => suma + una.parsed.filters.length, 0),
    }
    registrar(textoFinal(cuenta), 'ok')
    setResultado(cuenta)
    avanzar()
  }

  // ── «⚙️ Generar Excel» de la selección (modos ZIP y ZIP + Jobs) ──────────────────────────────────
  async function generarDeLaSeleccion() {
    setLineas([])
    setResultado(null)
    buffer.current = null

    const seleccionadas = entradas.filter((una) => elegidas.has(una.sheetName))
    if (seleccionadas.length === 0) {
      registrar('⚠ No hay integraciones seleccionadas.', 'aviso')
      return
    }

    setOcupado(true)
    try {
      registrar(`📋 Generando Excel con ${seleccionadas.length} integraciones…`, 'info')
      setProgreso(5)

      let filas = seleccionadas

      // El ATL del modo ZIP se aplica AHORA, no al analizar: así se puede añadir uno después de
      // analizar. Solo rellena Proceso y Grupo; no mueve las filas, y varios se acumulan.
      if (modo === 'zip' && atlsZip.length > 0) {
        registrar(`📋 Procesando ${atlsZip.length} archivo(s) ATL…`, 'info')
        let todas = entradas
        const hojasConAtl = new Set()

        for (const archivo of atlsZip) {
          let leido
          try { leido = parseATL(archivo.text) } catch (error) {
            registrar(`  ✗ ${archivo.name}: ${error?.message || error}`, 'error')
            continue
          }
          const { integraciones: conAtl, ambiguas, sinPareja, hojas } = aplicarAtlSinReordenar(leido, todas)
          todas = conAtl
          hojas.forEach((hoja) => hojasConAtl.add(hoja))
          ambiguas.forEach((nombre) => registrar(
            `  ⚠ Múltiples ZIPs con dataflow "${nombre}" y sin GUID — no se puede desambiguar`, 'aviso',
          ))
          sinPareja.forEach((una) => registrar(
            `  ⚠ ATL dataflow sin match en ZIPs: ${una.displayName} (guid: ${una.guid || 'n/a'})`, 'aviso',
          ))
        }
        registrar(`  ✔ ATL procesado: ${hojasConAtl.size} dataflows mapeados`, 'ok')

        const porHoja = new Map(todas.map((una) => [una.sheetName, una]))
        filas = seleccionadas.map((una) => porHoja.get(una.sheetName) ?? una)
        // Lo que ningún ATL menciona sale con el grupo vacío, no con «Sin grupo ATL».
        filas = filas.map((una) => ({
          ...una,
          paramRow: { ...una.paramRow, atlGroup: una.atlGroup ?? '', atlSession: una.atlSession ?? '' },
        }))
      }

      await armarElExcel(filas, {
        modoJobs: modo === 'zipjobs',
        textoFinal: (c) => (modo === 'zipjobs'
          ? `✅ Listo — ${c.integraciones} integraciones · ${c.mapeos} mapeos · ${c.filtros} filtros`
          : `✅ Listo — ${c.integraciones} jobs · ${c.mapeos} mapeos · ${c.filtros} filtros`),
      })
    } catch (error) {
      registrar(`✗ Error: ${error?.message || error}`, 'error')
    } finally {
      setOcupado(false)
    }
  }

  // ── Modo Jobs: «🔍 Obtener Application Jobs» ─────────────────────────────────────────────────────
  async function obtenerJobs() {
    if (!usada) { registrar('⚠ Debes conectarte a SAP IBP primero.', 'aviso'); return }

    setLineas([])
    setOcupado(true)
    registrar('🔍 Consultando Application Jobs…', 'info')
    try {
      const lista = await fetchJobTemplates(usada)
      registrar(`✔ ${lista.length} jobs obtenidos`, 'ok')
      setJobs(lista)
      setJobsMarcados(new Set())
      setBusquedaJobs('')
      if (pasoActual === 0) avanzar()
    } catch (error) {
      registrar(`✗ Error obteniendo $metadata: ${error?.message || error}`, 'error')
      registrar('ℹ Asegúrate de tener el Communication Arrangement SAP_COM_0326 configurado.', 'info')
    } finally {
      setOcupado(false)
    }
  }

  // ── Modo Jobs: «⚙️ Analizar y Generar» — una sola pasada, sin lista de integraciones ─────────────
  async function generarDesdeJobs() {
    setLineas([])
    setResultado(null)
    buffer.current = null
    setEntradas(null)
    setOcupado(true)

    try {
      const elegidos = (jobs ?? []).filter((job) => jobsMarcados.has(claveDeJob(job)))
      registrar(`📋 ${elegidos.length} jobs seleccionados`, 'info')

      // Los pasos de cada job, con el task ID técnico (P_TSKID) puesto.
      let pasosPorJob = elegidos.map(() => [])
      if (elegidos.length > 0) {
        registrar('🔍 Obteniendo pasos de los jobs…', 'info')
        const { pasos, avisoDeTaskId } = await fetchJobSteps(usada, elegidos.map(plantillaDe))
        pasosPorJob = pasos
        pasos.forEach((lista, i) => {
          registrar(`  ✔ ${nombreDeJob(elegidos[i])}: ${lista.length} pasos`, 'ok')
          lista.forEach((paso) => registrar(`    pos=${paso.pos} → ${paso.text}`, 'info'))
        })
        if (avisoDeTaskId) {
          registrar(`  ⚠ P_TSKID no disponible, usando JobSequenceText como fallback: ${avisoDeTaskId}`, 'aviso')
        } else {
          const resueltos = pasos.flat().filter((paso) => paso.taskId).length
          registrar(`  ✔ ${resueltos} task IDs resueltos via P_TSKID`, 'ok')
        }
      }

      // Los ATL.
      const atlsLeidos = []
      if (atlsJobs.length > 0) {
        registrar('📄 Parseando archivos ATL…', 'info')
        for (const archivo of atlsJobs) {
          try {
            const leido = parseATL(archivo.text)
            atlsLeidos.push(leido)
            const dataflows = leido.groups.reduce((suma, grupo) => suma + grupo.dataflows.length, 0)
            registrar(`  ✔ ${archivo.name}: "${leido.sessionName}" — ${leido.groups.length} grupos, ${dataflows} dataflows`, 'ok')
          } catch (error) {
            registrar(`  ✗ ${archivo.name}: ${error?.message || error}`, 'error')
          }
        }
      } else {
        registrar('ℹ Sin archivos ATL — las integraciones no tendrán orden de proceso.', 'info')
      }
      setProgreso(10)

      let leidas = []
      if (zipsJobs.length > 0) leidas = await leerLosZip(zipsJobs, { conLookups: false, pesoDelProgreso: 40 })
      setProgreso(55)

      registrar('🔗 Mapeando steps → integraciones…', 'info')
      const { filas, registro } = ordenarPorJobs({
        atls: atlsLeidos,
        entradas: leidas,
        jobs: elegidos.map((uno) => ({ nombre: nombreDeJob(uno) })),
        pasosPorJob,
      })
      registrarVarias(registro.filter((una) => una.texto.startsWith('  ')))
      registrar(registro.at(-1).texto, 'ok')
      setProgreso(60)

      await armarElExcel(filas, {
        modoJobs: true,
        textoFinal: (c) => `✅ Listo — ${c.integraciones} integraciones · ${c.mapeos} mapeos · ${c.filtros} filtros`,
      })
    } catch (error) {
      registrar(`✗ Error: ${error?.message || error}`, 'error')
    } finally {
      setOcupado(false)
    }
  }

  // ── La lista de selección de integraciones ──────────────────────────────────────────────────────
  const visibles = useMemo(() => {
    if (!entradas) return []
    const buscado = busqueda.trim().toLowerCase()
    if (!buscado) return entradas
    return entradas.filter((una) => [
      una.sheetName, una.paramRow.tipoIntegracion, una.paramRow.dataflowName, una.paramRow.jobName,
      una.paramRow.srcDS, una.paramRow.dstDS, una.pkg,
    ].join(' ').toLowerCase().includes(buscado))
  }, [entradas, busqueda])

  function alternar(hoja) {
    setElegidas((previas) => {
      const nuevas = new Set(previas)
      if (nuevas.has(hoja)) nuevas.delete(hoja)
      else nuevas.add(hoja)
      return nuevas
    })
  }

  /** «Activar filtradas» / «Desactivar filtradas»: solo lo que se está viendo, no todo. */
  function marcarVisibles(marcar) {
    setElegidas((previas) => {
      const nuevas = new Set(previas)
      for (const una of visibles) {
        if (marcar) nuevas.add(una.sheetName)
        else nuevas.delete(una.sheetName)
      }
      return nuevas
    })
  }

  const contador = (() => {
    const total = entradas?.length ?? 0
    const marcadas = elegidas.size
    if (busqueda.trim()) {
      const visiblesMarcadas = visibles.filter((una) => elegidas.has(una.sheetName)).length
      return `${visiblesMarcadas} / ${visibles.length} filtradas · ${marcadas} / ${total} total`
    }
    return `${marcadas} / ${total} seleccionadas`
  })()

  // ── La lista de Application Jobs ────────────────────────────────────────────────────────────────
  const jobsVisibles = useMemo(() => {
    const buscado = busquedaJobs.trim().toLowerCase()
    return (jobs ?? []).filter((job) => !buscado || nombreDeJob(job).toLowerCase().includes(buscado))
  }, [jobs, busquedaJobs])

  function alternarJob(job) {
    setJobsMarcados((previos) => {
      const nuevos = new Set(previos)
      const clave = claveDeJob(job)
      if (nuevos.has(clave)) nuevos.delete(clave)
      else nuevos.add(clave)
      return nuevos
    })
  }

  function marcarJobsVisibles(marcar) {
    setJobsMarcados((previos) => {
      const nuevos = new Set(previos)
      for (const job of jobsVisibles) {
        if (marcar) nuevos.add(claveDeJob(job))
        else nuevos.delete(claveDeJob(job))
      }
      return nuevos
    })
  }

  const contadorDeJobs = (() => {
    const total = jobs?.length ?? 0
    if (busquedaJobs.trim()) {
      const visiblesMarcados = jobsVisibles.filter((job) => jobsMarcados.has(claveDeJob(job))).length
      return `${visiblesMarcados} / ${jobsVisibles.length} filtrados · ${jobsMarcados.size} / ${total} total`
    }
    return `${jobsMarcados.size} / ${total} seleccionados`
  })()

  const barraDeProgreso = progreso !== null && (
    <div className="progress-bar docs-progreso"><div className="fill" style={{ width: `${progreso}%` }} /></div>
  )

  return (
    <div className="exp-page">
      <div className="tab-info-banner">
        <span className="tab-info-icon">📄</span>
        <div className="tab-info-content">
          <div className="tab-info-desc">Generador de Mapping Dataflow para tareas de integración de SAP CI-DS</div>
        </div>
      </div>

      <PanelConexionIbp
        conexionId={conexionId}
        onConexionElegida={setConexionId}
        usada={usada}
        onUsar={(conexion) => { setUsada(conexion.id); setIntento((previo) => previo + 1); setPlanArea('') }}
        cargando={cargandoCatalogo}
        catalogo={catalogo}
        errorCatalogo={errorCatalogo}
        planArea={planArea}
        onPlanArea={setPlanArea}
      />

      {/* El selector de modo: tres botones que ocupan todo el ancho (`docs-mode-toggle`). */}
      <div className="docs-modos">
        {MODOS.map((uno) => (
          <button
            key={uno.id}
            type="button"
            className={`exp-modo-btn${modo === uno.id ? ' active' : ''}`}
            onClick={() => cambiarDeModo(uno.id)}
          >
            {uno.label}
          </button>
        ))}
      </div>

      <AvanceDePasos modo={modo} actual={pasoActual} />

      <div className="docs-protip">
        <span aria-hidden="true">💡</span>
        <div>
          <strong>Pro tip:</strong> Si conectas tu sistema SAP IBP obtendrás una documentación enriquecida con
          las descripciones y datos de SAP IBP.
        </div>
      </div>

      {/* ── Modo ZIP ─────────────────────────────────────────────────────────────────────────── */}
      {modo === 'zip' && (
        <>
          <div className="card exp-upload">
            <div className="card-title docs-titulo-ayuda">
              <span>📦 Archivos ZIP de entrada</span>
              <AyudaConCuadro imagen="/ci-ds-export.png" alt="CI-DS Export">{AYUDA_ZIP}</AyudaConCuadro>
            </div>
            <FileDropzone
              archivos={zipsZip}
              onCambiar={(lista) => cambiarZips(setZipsZip, lista)}
              accept=".zip"
              titulo="Arrastra los ZIP aquí"
              ayuda={SUGERENCIA_DE_ARCHIVOS}
              iconoDeArchivo="📦"
            />
            {barraDeProgreso}
            <div className="exp-upload-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={zipsZip.length === 0 || ocupado}
                onClick={analizarZip}
              >
                ⚙️ Analizar Integraciones
              </button>
            </div>
          </div>

          <div className="card exp-upload">
            <div className="card-title">📋 Archivos ATL (opcional)</div>
            <p className="docs-descripcion">
              Sube los archivos ATL de SAP Data Services para enriquecer el Excel con el nombre del
              proceso y el grupo al que pertenece cada dataflow. Se asocian por GUID o nombre del dataflow.
            </p>
            <FileDropzone
              archivos={atlsZip}
              onCambiar={setAtlsZip}
              accept=".atl,.txt"
              como="texto"
              icono="📋"
              titulo="Arrastra los ATL aquí"
              ayuda={SUGERENCIA_DE_ARCHIVOS}
              iconoDeArchivo="📋"
              conTamano={false}
            />
          </div>
        </>
      )}

      {/* ── Modo Application Jobs ─────────────────────────────────────────────────────────────── */}
      {modo === 'jobs' && (
        <>
          <div className="card exp-upload">
            <div className="card-title">🔄 Application Jobs desde SAP IBP</div>
            <p className="docs-descripcion">
              Conecta tu sistema SAP IBP para obtener los Application Jobs configurados. Requiere
              Communication Arrangement <b>SAP_COM_0326</b>.
            </p>
            <div className="exp-upload-actions">
              <button type="button" className="btn btn-primary" disabled={ocupado} onClick={obtenerJobs}>
                🔍 Obtener Application Jobs
              </button>
            </div>
          </div>

          {jobs && (
            <div className="card exp-upload">
              <div className="card-title">✅ Selección de Jobs</div>
              <div className="docs-sel-barra">
                <input
                  className="input input-sm exp-search"
                  type="text"
                  placeholder="🔍  Buscar por nombre de job…"
                  value={busquedaJobs}
                  onChange={(evento) => setBusquedaJobs(evento.target.value)}
                />
                <button type="button" className="btn btn-sm" onClick={() => marcarJobsVisibles(true)}>Activar filtrados</button>
                <button type="button" className="btn btn-sm" onClick={() => marcarJobsVisibles(false)}>Desactivar filtrados</button>
                <span className="exp-counter">{contadorDeJobs}</span>
              </div>
              <div className="docs-sel-lista">
                {jobs.length === 0 && <div className="exp-empty">No se encontraron jobs.</div>}
                {jobsVisibles.map((job) => {
                  const principal = job.JobTemplateText || job.Text || job.TextEn || ''
                  return (
                    <label className="docs-sel-item" key={claveDeJob(job)}>
                      <input
                        type="checkbox"
                        checked={jobsMarcados.has(claveDeJob(job))}
                        onChange={() => alternarJob(job)}
                      />
                      <span className="docs-sel-name">
                        {principal || job.JobTemplateName}
                        {principal && <span className="docs-sel-df">{job.JobTemplateName}</span>}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          {jobs && (
            <>
              <div className="card exp-upload">
                <div className="card-title docs-titulo-ayuda">
                  <span>📄 Archivos ATL de procesos CI-DS</span>
                  <AyudaConCuadro>{AYUDA_ATL}</AyudaConCuadro>
                </div>
                <FileDropzone
                  archivos={atlsJobs}
                  onCambiar={setAtlsJobs}
                  accept=".atl,.txt"
                  como="texto"
                  icono="📄"
                  titulo="Arrastra archivos ATL aquí"
                  ayuda={<>Formato .atl o .txt &nbsp;·&nbsp; <b>Múltiples archivos</b> permitidos</>}
                  iconoDeArchivo="📄"
                  conTamano={false}
                />
              </div>

              <div className="card exp-upload">
                <div className="card-title">📦 Archivos ZIP de integraciones CI-DS</div>
                <FileDropzone
                  archivos={zipsJobs}
                  onCambiar={setZipsJobs}
                  accept=".zip"
                  titulo="Arrastra los ZIP aquí"
                  ayuda="Los mismos exports de CI-DS que usarías en el modo ZIP"
                  iconoDeArchivo="📦"
                />
                {barraDeProgreso}
                <div className="exp-upload-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={(atlsJobs.length === 0 && zipsJobs.length === 0) || ocupado}
                    onClick={generarDesdeJobs}
                  >
                    ⚙️ Analizar y Generar
                  </button>
                </div>
              </div>
            </>
          )}

          <div className="card exp-upload">
            <div className="card-title">🔧 Configuración: Communication Arrangement</div>
            <div className="docs-guia">
              <p>
                Para usar la funcionalidad de Application Jobs, necesitas configurar el escenario{' '}
                <b>SAP_COM_0326</b> en tu sistema SAP IBP:
              </p>
              <ol>
                <li><b>Communication User:</b> Crea un usuario técnico en <em>Maintain Communication Users</em></li>
                <li><b>Communication System:</b> Crea un sistema en <em>Communication Systems</em> apuntando a tu tenant IBP</li>
                <li>
                  <b>Communication Arrangement:</b> Crea un arrangement con escenario <b>SAP_COM_0326</b>{' '}
                  (External Scheduler - Application Job Administration Integration)
                </li>
                <li>Asigna el Communication User y System al arrangement</li>
                <li>Configura autenticación <b>Basic Auth</b> (usuario y contraseña)</li>
                {/* v9 dice «Usa las mismas credenciales en el panel de conexión de arriba». Aquí las
                    credenciales no se escriben en el navegador: se dan de alta una vez en el servidor. */}
                <li>
                  Da de alta esas credenciales en Administración → Conexiones y elige la conexión en el
                  panel de conexión de arriba
                </li>
              </ol>
              <p className="docs-descripcion">
                Este Communication Arrangement expone el servicio <code>BC_EXT_APPJOB_MANAGEMENT</code> que
                permite leer los Application Jobs y sus pasos.
              </p>
            </div>
          </div>
        </>
      )}

      {/* ── Modo ZIP + Jobs ───────────────────────────────────────────────────────────────────── */}
      {modo === 'zipjobs' && (
        <div className="card exp-upload">
          <div className="card-title">📦 Archivos ZIP de integraciones CI-DS</div>
          <p className="docs-descripcion">
            Sube los mismos ZIPs de CI-DS que usarías en el modo ZIP. El sistema los analiza y{' '}
            <b>enriquece automáticamente</b> con los Jobs y Steps de SAP IBP usando{' '}
            <code>JobTemplateSequenceSet</code>.
          </p>
          <FileDropzone
            archivos={zipsZj}
            onCambiar={(lista) => cambiarZips(setZipsZj, lista)}
            accept=".zip"
            titulo="Arrastra los ZIP aquí"
            ayuda={SUGERENCIA_DE_ARCHIVOS}
            iconoDeArchivo="📦"
          />
          {barraDeProgreso}
          <div className="exp-upload-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={zipsZj.length === 0 || ocupado}
              onClick={analizarZipJobs}
            >
              ⚙️ Analizar ZIPs + Enriquecer con Jobs IBP
            </button>
          </div>
        </div>
      )}

      {/* ── La selección de integraciones (modos ZIP y ZIP + Jobs) ────────────────────────────── */}
      {entradas && modo !== 'jobs' && (
        <div className="card exp-upload" ref={panelDeSeleccion}>
          <div className="card-title">✅ Selección de integraciones</div>
          <div className="docs-sel-barra">
            <input
              className="input input-sm exp-search"
              type="text"
              placeholder="🔍  Buscar por nombre, tipo, dataflow…"
              value={busqueda}
              onChange={(evento) => setBusqueda(evento.target.value)}
            />
            <button type="button" className="btn btn-sm" onClick={() => marcarVisibles(true)}>Activar filtradas</button>
            <button type="button" className="btn btn-sm" onClick={() => marcarVisibles(false)}>Desactivar filtradas</button>
            <span className="exp-counter">{contador}</span>
          </div>

          <div className="docs-sel-lista">
            {visibles.map((una) => {
              const tipo = String(una.paramRow.tipoIntegracion || '').toUpperCase()
              const dataflow = una.paramRow.dataflowName
              return (
                <label className="docs-sel-item" key={una.sheetName}>
                  <input type="checkbox" checked={elegidas.has(una.sheetName)} onChange={() => alternar(una.sheetName)} />
                  <span className={`docs-sel-badge ${claseDeTipo(tipo)}`}>{tipo || '?'}</span>
                  <span className="docs-sel-name">
                    {una.paramRow.jobName || una.sheetName}
                    {dataflow && <span className="docs-sel-df">{dataflow}</span>}
                  </span>
                  <span className="docs-sel-pkg" title={una.pkg}>{una.pkg}</span>
                </label>
              )
            })}
          </div>

          <div className="exp-upload-actions">
            <button type="button" className="btn btn-primary" disabled={ocupado} onClick={generarDeLaSeleccion}>
              ⚙️ Generar Excel
            </button>
          </div>
        </div>
      )}

      {resultado && (
        <PanelDeResultado
          resultado={resultado}
          onDescargar={() => buffer.current && descargar(buffer.current, nombreDelArchivo())}
        />
      )}

      <LogDeProcesamiento lineas={lineas} />
    </div>
  )
}
