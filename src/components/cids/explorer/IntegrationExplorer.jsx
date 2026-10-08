// El explorador de integraciones: abrir los exports de un proyecto de CI-DS y recorrerlos.
//
// Portado de `explorer.js` y `integration-explorer.html` de v9, que eran 2.900 líneas de manipulación
// directa del DOM. La pantalla tiene la forma de v9, de arriba abajo:
//
//   1. el banner «🔎 Explora visualmente…»;
//   2. el panel de carga —ZIP, ATL opcional, «🔬 Explorar integraciones» y las dos conexiones
//      opcionales con su «?»—, que SIGUE ahí mientras se explora y se pliega con su título;
//   3. los resultados: dimensiones, búsqueda, vista, interruptores, filtros y las dos columnas.
//
// Lo que desaparece respecto de v9: los modales para escribir las credenciales de CI-DS y de IBP, y la
// carga de vis-network y JSZip desde un CDN. Es el ÚNICO desvío de fondo y es de seguridad: las
// credenciales de SAP viven cifradas en el servidor y nunca llegan al navegador, así que «Conectar»
// ELIGE una de las conexiones dadas de alta en Administración → Conexiones. La pastilla, el
// «Desconectar» y el «?» son los de v9.
//
// El ZIP se lee en el navegador y no sale del equipo. Lo único que viene del servidor son dos
// enriquecimientos OPCIONALES: de CI-DS, qué tareas ya están en el repositorio productivo (la marca
// ✓), y de IBP, qué Application Job ejecuta cada tarea.

import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'

import { usePantallaCompleta } from '../../../lib/usePantallaCompleta.js'
import BotonCopiar from '../../ui/BotonCopiar.jsx'
import BotonPantallaCompleta from '../../ui/BotonPantallaCompleta.jsx'
import FileDropzone from '../../ui/FileDropzone.jsx'
import Interruptor from '../../ui/Interruptor.jsx'
import SelectorDeLista from '../../ui/SelectorDeLista.jsx'

import { conConflicto, enrichWithAtl } from '../../../lib/atl-enrich.js'
import { parseATL } from '../../../lib/cids-atl.js'
import { copyText } from '../../../lib/clipboard.js'
import { dimensionATsv, integracionesDeLaEntrada, tareasATsv } from '../../../lib/explorer-copy.js'
import { analyzeProject } from '../../../lib/integration-index.js'
import { cidsTargets, fetchPromotedTaskNames, listCidsConnections } from '../../../lib/cids.js'
import { claveDeTarea, fetchTaskIndex, listIbpConnections } from '../../../lib/ibp.js'
import {
  DIMENSIONES,
  datastoreOptions,
  dimensionPorId,
  entradasDeDimension,
  filtrarIntegraciones,
  planAreaOptions,
  tieneScripts,
  tieneSelectDistinct,
} from '../../../lib/integration-view.js'
import { useResizableColumn } from '../../../lib/useResizableColumn.js'
import AtlProcessMaster from './AtlProcessMaster.jsx'
import DimensionDetail from './DimensionDetail.jsx'
import ExplorerMaster from './ExplorerMaster.jsx'
import IntegrationDetail from './IntegrationDetail.jsx'

const ChainGraph = lazy(() => import('./ChainGraph.jsx'))

/** Marca o desmarca un valor en un conjunto de filtro, sin tocar el original. */
function alternar(conjunto, valor) {
  const nuevo = new Set(conjunto)
  if (nuevo.has(valor)) nuevo.delete(valor)
  else nuevo.add(valor)
  return nuevo
}

/** Un grupo de chips de filtro («PA:», «Origen:», «Destino:»). Nada marcado significa «todos». */
function FiltroDeChips({ titulo, opciones, elegidas, onAlternar, textoDelVacio }) {
  // Se muestra solo si hay MÁS de un valor, contando el vacío (como v9).
  if (opciones.length < 2) return null

  return (
    <div className="exp-filter-group">
      <span className="exp-filter-title">{titulo}</span>
      <div className="exp-chips">
        {opciones.map((una) => (
          <button
            key={una || '(vacío)'}
            type="button"
            className={`exp-chip${elegidas.has(una) ? ' active' : ''}`}
            onClick={() => onAlternar(una)}
          >
            {una === '' ? textoDelVacio : una}
          </button>
        ))}
      </div>
    </div>
  )
}

/** La ayuda de cada conexión, con las palabras de v9 salvo la parte de qué configurar (ver arriba). */
const AYUDA = {
  cids: {
    titulo: 'Conexión SAP CI-DS',
    cuerpo: (
      <>
        <b>Para qué sirve:</b> marca qué tareas de tus ZIP ya están <b>promovidas a producción</b> en el
        repositorio CI-DS. Verás un ✓ en cada task promovida y podrás filtrar para mostrar solo esas.
        <br />
        <b>Qué configurar:</b> elige un repositorio de CI-DS. La conexión SOAP (la <b>URL del WebService</b>,
        la organización y el usuario de WebServices) la da de alta quien administra la cuenta en
        Administración → Conexiones; aquí no se escriben.
      </>
    ),
  },
  ibp: {
    titulo: 'Conexión SAP IBP',
    cuerpo: (
      <>
        <b>Para qué sirve:</b> ubica cada task dentro de los <b>Application Jobs</b> de SAP IBP. Al
        seleccionar una task verás en qué <b>Job(s) y Step(s)</b> se ejecuta, con su posición y tipo.
        <br />
        <b>Qué configurar:</b> elige un tenant de IBP. Su <b>Communication User</b> y el Communication
        Arrangement <b>SAP_COM_0326</b> (External Scheduler – Application Job Administration Integration),
        que expone <code>BC_EXT_APPJOB_MANAGEMENT</code>, los da de alta quien administra la cuenta en
        Administración → Conexiones.
      </>
    ),
  },
}

/** El «?» de una conexión y su popover. Se cierra al pulsar fuera o con Escape (como v9). */
function Ayuda({ cual }) {
  const [abierta, setAbierta] = useState(false)
  const caja = useRef(null)

  useEffect(() => {
    if (!abierta) return undefined

    const fuera = (evento) => { if (!caja.current?.contains(evento.target)) setAbierta(false) }
    const escape = (evento) => { if (evento.key === 'Escape') setAbierta(false) }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', escape)
    }
  }, [abierta])

  const { titulo, cuerpo } = AYUDA[cual]

  return (
    <span className="exp-ayuda" ref={caja}>
      <button
        type="button"
        className="exp-ayuda-btn"
        title={titulo}
        aria-label={`Ayuda ${cual === 'cids' ? 'CI-DS' : 'SAP IBP'}`}
        aria-expanded={abierta}
        onClick={() => setAbierta((previo) => !previo)}
      >
        ?
      </button>
      {abierta && (
        <div className="exp-ayuda-pop" role="dialog">
          <div className="exp-ayuda-pop-titulo">{titulo}</div>
          <div className="exp-ayuda-pop-cuerpo">{cuerpo}</div>
        </div>
      )}
    </span>
  )
}

const unidades = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`

export default function IntegrationExplorer() {
  const [archivos, setArchivos] = useState([])
  const [atls, setAtls] = useState([])
  const [base, setBase] = useState(null)
  const [analizando, setAnalizando] = useState(false)
  const [cargaAbierta, setCargaAbierta] = useState(true)

  const [dimension, setDimension] = useState('integracion')
  const [texto, setTexto] = useState('')
  const [vista, setVista] = useState('lista')
  const [aviso, setAviso] = useState(null)

  const { contenedorRef, ancho, arrastrando, propiedadesDelBorde } = useResizableColumn()

  // La pila de navegación: el tope es lo que se está viendo y el fondo es desde dónde se empezó.
  // Es lo que permite saltar de una integración a la que la alimenta y poder volver.
  const [pila, setPila] = useState([])
  const lienzo = useRef(null)
  const pantalla = usePantallaCompleta(lienzo)
  const [clave, setClave] = useState(null)

  const [planAreas, setPlanAreas] = useState(new Set())
  const [srcDS, setSrcDS] = useState(new Set())
  const [dstDS, setDstDS] = useState(new Set())
  const [soloTransportadas, setSoloTransportadas] = useState(false)
  const [soloConflictos, setSoloConflictos] = useState(false)
  const [soloEnIbp, setSoloEnIbp] = useState(false)
  const [soloConScript, setSoloConScript] = useState(false)
  const [soloConDistinct, setSoloConDistinct] = useState(false)

  // De dónde sale cada marca. Vacío = sin conectar.
  const [destinos, setDestinos] = useState([])
  const [tenants, setTenants] = useState([])
  const [destinoCids, setDestinoCids] = useState('')
  const [tenantIbp, setTenantIbp] = useState('')

  const [transportadas, setTransportadas] = useState(null)
  const [indiceDeJobs, setIndiceDeJobs] = useState(null)
  const [falloDeMarcas, setFalloDeMarcas] = useState('')

  // Qué hay disponible para conectar. A diferencia de antes, NADA se elige solo: como en v9, las
  // marcas aparecen cuando se pulsa «Conectar», aunque haya una sola opción.
  useEffect(() => {
    let abandonado = false

    listCidsConnections()
      .then((lista) => { if (!abandonado) setDestinos(cidsTargets(lista)) })
      .catch(() => {})

    listIbpConnections()
      .then((lista) => { if (!abandonado) setTenants(lista) })
      .catch(() => {})

    return () => { abandonado = true }
  }, [])

  // La marca de transportada. Que falle no rompe nada: es una marca de más.
  useEffect(() => {
    if (!destinoCids) return undefined
    const destino = destinos.find((uno) => uno.id === destinoCids)
    if (!destino) return undefined

    let abandonado = false
    fetchPromotedTaskNames(destino)
      .then((nombres) => { if (!abandonado) setTransportadas(nombres) })
      .catch(() => { if (!abandonado) setTransportadas(null) })
    return () => { abandonado = true }
  }, [destinoCids, destinos])

  // El índice de trabajos de IBP. Son tres consultas al tenant, así que se pide una sola vez.
  useEffect(() => {
    if (!tenantIbp) return undefined

    let abandonado = false
    fetchTaskIndex(tenantIbp)
      .then((indice) => { if (!abandonado) { setIndiceDeJobs(indice); setFalloDeMarcas('') } })
      .catch((fallo) => { if (!abandonado) setFalloDeMarcas(fallo.message) })
    return () => { abandonado = true }
  }, [tenantIbp])

  // Cambiar de origen invalida la marca anterior: mostrar la del tenant que ya no está elegido
  // sería peor que no mostrar ninguna.
  const marcaTransportadas = destinoCids ? transportadas : null
  const marcaDeJobs = tenantIbp ? indiceDeJobs : null

  // La lista vacía va en un `useMemo` para que sea la misma referencia entre repintados: si no,
  // todos los cálculos de abajo se rehacen en cada tecla mientras no hay proyecto cargado.
  const integraciones = useMemo(() => base?.integraciones ?? [], [base])

  // Los ATL se pueden añadir y quitar DESPUÉS de explorar (como en v9): el cruce se rehace al vuelo
  // sin volver a leer los ZIP. Uno que no se pueda leer se salta con su aviso.
  const { atl, fallosDeAtl } = useMemo(() => {
    if (!base || atls.length === 0) return { atl: null, fallosDeAtl: [] }

    const leidos = []
    const fallados = []
    for (const archivo of atls) {
      try { leidos.push({ nombre: archivo.name, atl: parseATL(archivo.text) }) }
      catch (error) { fallados.push({ archivo: archivo.name, mensaje: error?.message || String(error) }) }
    }
    return {
      atl: leidos.length > 0 ? enrichWithAtl(base.integraciones, base.cadenas, leidos) : null,
      fallosDeAtl: fallados,
    }
  }, [base, atls])

  // Qué integraciones están metidas en un choque, para poder filtrar por ellas.
  const enConflicto = useMemo(() => (atl ? conConflicto(atl.conflictos) : null), [atl])

  // Cuántas tienen un script pre/post-load con contenido. Cuenta dataflows y no tareas, como v9:
  // todos los dataflows de un mismo job comparten sus scripts. Sin ninguna, el interruptor no se
  // dibuja y el filtro no aplica aunque hubiera quedado encendido.
  const conScript = useMemo(() => integraciones.filter(tieneScripts).length, [integraciones])
  const filtrarPorScript = soloConScript && conScript > 0

  // Cuántas tienen algún transform con «Select Distinct Rows». Igual que el de scripts: sin ninguna,
  // el interruptor no se dibuja y el filtro no aplica.
  const conDistinct = useMemo(() => integraciones.filter(tieneSelectDistinct).length, [integraciones])
  const filtrarPorDistinct = soloConDistinct && conDistinct > 0
  const filtrarPorConflictos = soloConflictos && Boolean(enConflicto) && atl.conflictos.length > 0

  const filtros = useMemo(
    () => ({
      planAreas, srcDS, dstDS, soloTransportadas, transportadas: marcaTransportadas,
      soloConScript: filtrarPorScript,
      soloConDistinct: filtrarPorDistinct,
    }),
    [planAreas, srcDS, dstDS, soloTransportadas, marcaTransportadas, filtrarPorScript, filtrarPorDistinct],
  )

  /** Los filtros de la barra que no son de texto: ATL y IBP. Los demás van dentro de `filtros`. */
  const pasaLosDeLaBarra = (lista) => {
    let pasan = lista
    if (filtrarPorConflictos) pasan = pasan.filter((una) => enConflicto.has(una._idx))
    if (soloEnIbp && marcaDeJobs) pasan = pasan.filter((una) => claveDeTarea(una.jobName) in marcaDeJobs)
    return pasan
  }

  const visibles = useMemo(
    () => pasaLosDeLaBarra(filtrarIntegraciones(integraciones, base?.indices, texto, filtros)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pasaLosDeLaBarra se rehace en cada dibujo
    [integraciones, base, texto, filtros, filtrarPorConflictos, enConflicto, soloEnIbp, marcaDeJobs],
  )

  // Las dimensiones filtran SOLO por la clave que se escribe, no por el texto de las integraciones:
  // si no, el texto se aplicaba dos veces y una búsqueda legítima dejaba la lista vacía.
  const visiblesSinTexto = useMemo(
    () => pasaLosDeLaBarra(filtrarIntegraciones(integraciones, base?.indices, '', filtros)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pasaLosDeLaBarra se rehace en cada dibujo
    [integraciones, base, filtros, filtrarPorConflictos, enConflicto, soloEnIbp, marcaDeJobs],
  )

  const esDeDimension = dimension !== 'integracion' && dimension !== 'atl-proceso'

  const entradas = useMemo(
    () => (!esDeDimension
      ? []
      : entradasDeDimension(base?.indices, dimension, texto, new Set(visiblesSinTexto.map((una) => una._idx)))),
    [base, dimension, texto, visiblesSinTexto, esDeDimension],
  )

  const totalDeClaves = useMemo(() => {
    const definicion = dimensionPorId(dimension)
    return definicion.indice ? Object.keys(base?.indices?.[definicion.indice] ?? {}).length : 0
  }, [base, dimension])

  const areas = useMemo(() => planAreaOptions(integraciones), [integraciones])
  const datastores = useMemo(() => datastoreOptions(integraciones), [integraciones])

  // El aviso flotante («toast») de v9: abajo al centro, 2,2 s.
  const relojDelAviso = useRef(null)
  useEffect(() => () => clearTimeout(relojDelAviso.current), [])
  function avisar(textoDelAviso, esError = false) {
    setAviso({ texto: textoDelAviso, esError })
    clearTimeout(relojDelAviso.current)
    relojDelAviso.current = setTimeout(() => setAviso(null), 2200)
  }

  /** Copia al portapapeles un listado de tareas y avisa como v9. Devuelve si salió. */
  async function copiarTsv(tsv, cuantos) {
    const salio = await copyText(tsv)
    if (salio) avisar(`✓ ${unidades(cuantos, 'tarea copiada', 'tareas copiadas')} al portapapeles`)
    else avisar('No se pudo copiar al portapapeles', true)
    return salio
  }

  /** El «Copiar» de la cabecera de la lista: lo que se está viendo, tal cual. */
  async function copiarLaLista() {
    if (esDeDimension) {
      if (entradas.length === 0) { avisar('No hay tareas para copiar', true); return false }
      return copiarTsv(dimensionATsv(dimension, entradas), entradas.length)
    }
    if (visibles.length === 0) { avisar('No hay tareas para copiar', true); return false }
    return copiarTsv(tareasATsv(visibles), visibles.length)
  }

  async function explorar() {
    setAnalizando(true)
    // Se limpia lo que dependía del proyecto anterior: la selección y los filtros.
    setPila([])
    setClave(null)
    setTexto('')
    setDimension('integracion')
    setVista('lista')
    setPlanAreas(new Set())
    setSrcDS(new Set())
    setDstDS(new Set())
    setSoloTransportadas(false)
    setSoloConflictos(false)
    setSoloEnIbp(false)
    setSoloConScript(false)
    setSoloConDistinct(false)

    try {
      setBase(await analyzeProject(archivos))
      // Como v9: al terminar de analizar se pliega el panel de carga y los resultados quedan a la vista.
      setCargaAbierta(false)
    } finally {
      setAnalizando(false)
    }
  }

  /**
   * Empezar a mirar una integración desde cero: la pila arranca de nuevo.
   *
   * Como `goToIntegration` de v9: limpia la búsqueda y vuelve a la dimensión Integración, para que
   * la integración elegida se vea en la lista. La vista por proceso (ATL) se conserva, porque también
   * es una lista de integraciones: sacar de ahí a quien la recorre le haría perder el sitio.
   */
  function irA(idx) {
    setPila([idx])
    setVista('lista')
    setClave(null)
    if (esDeDimension) { setDimension('integracion'); setTexto('') }
  }

  /** Saltar a una vecina sin perder de dónde se venía. */
  function saltarA(idx) {
    setPila((previa) => (previa[previa.length - 1] === idx ? previa : [...previa, idx]))
  }

  function cambiarDimension(id) {
    setDimension(id)
    setClave(null)
    setPila([])
    if (id !== 'integracion') setVista('lista')
  }

  // Si la integración que se estaba mirando deja de pasar los filtros, el detalle vuelve al mensaje
  // inicial (`applySearchIntegration` de v9) en vez de enseñar algo que la lista ya no tiene. Se
  // deriva y no se borra la pila: si el filtro se afloja, vuelve a verse donde se estaba.
  const idxDelTope = pila.length > 0 ? pila[pila.length - 1] : null
  const topeVisible = idxDelTope !== null && (esDeDimension || visibles.some((una) => una._idx === idxDelTope))
  const elegida = topeVisible ? integraciones[idxDelTope] : null
  const entradaElegida = entradas.find((una) => una.clave === clave) ?? null

  // Los textos de la cabecera de la lista y del contador, como en v9.
  const definicion = dimensionPorId(dimension)
  const tituloDeLaLista = dimension === 'integracion'
    ? `Tareas (${visibles.length})`
    : dimension === 'atl-proceso'
      ? `${definicion.icono} ${definicion.label} (${atl?.procesos.length ?? 0})`
      : `${definicion.icono} ${definicion.label} (${entradas.length})`
  const hayDatosEnLaLista = esDeDimension ? entradas.length > 0 : visibles.length > 0

  let contador
  if (esDeDimension) {
    contador = entradas.length === totalDeClaves
      ? `${totalDeClaves} ${definicion.plural}`
      : `${entradas.length} / ${totalDeClaves} ${definicion.plural}`
  } else {
    contador = visibles.length === integraciones.length
      ? unidades(integraciones.length, 'integración', 'integraciones')
      : `${visibles.length} / ${integraciones.length}`
  }

  // La barra de estado del ATL: cuántos procesos, cuántos dataflows emparejados, cuántos faltan.
  const estadoDelAtl = useMemo(() => {
    if (!atl) return null
    const declarados = atl.procesos.reduce((suma, una) => suma + una.declarados, 0)
    const emparejados = atl.procesos.reduce((suma, una) => suma + una.emparejados, 0)
    const faltan = atl.procesos.reduce((suma, una) => suma + una.faltantes.length, 0)
    return {
      procesos: atl.procesos.length,
      emparejados,
      declarados,
      faltan,
      sueltas: atl.huerfanas.length,
      conflictos: atl.conflictos.length,
    }
  }, [atl])

  const destinoElegido = destinos.find((uno) => uno.id === destinoCids) ?? null
  const tenantElegido = tenants.find((uno) => uno.id === tenantIbp) ?? null
  const repositorio = destinoElegido?.production ? 'Productivo' : 'Sandbox'

  const errores = [...(base?.errores ?? []), ...fallosDeAtl]

  return (
    <div className="exp-page">
      {/* ── El banner de la pestaña, como en v9 ────────────────────────────────────────────── */}
      <div className="tab-info-banner">
        <span className="tab-info-icon">🔎</span>
        <div className="tab-info-content">
          <div className="tab-info-desc">
            Explora visualmente las integraciones CI-DS. Sube ZIPs, navega mappings/filtros/lookups y
            detecta cadenas consecutivas entre dataflows.
          </div>
        </div>
      </div>

      {/* ── El panel de carga: sigue visible mientras se explora y se pliega con su título ──── */}
      <div className="card exp-upload">
        <button
          type="button"
          className="exp-panel-titulo"
          onClick={() => setCargaAbierta((previo) => !previo)}
          aria-expanded={cargaAbierta}
        >
          <span>📦 ZIPs de integraciones CI-DS</span>
          <span className="exp-arrow">{cargaAbierta ? '▼' : '▶'}</span>
        </button>

        {cargaAbierta && (
          <>
            <FileDropzone
              archivos={archivos}
              onCambiar={setArchivos}
              accept=".zip"
              titulo="Arrastra los ZIP aquí o haz click para seleccionar"
              ayuda="Múltiples archivos permitidos · Se reutiliza el parser de Doc Generator"
              iconoDeArchivo="📦"
            />

            {/* ATL opcional: enriquece con la orquestación real (proceso, grupos, orden). */}
            <div className="exp-atl-upload">
              <div className="exp-atl-upload-titulo">📄 Archivos ATL de procesos CI-DS (opcional)</div>
              <p className="exp-atl-upload-desc">
                Enriquece el análisis con la orquestación real: proceso, grupos paralelos/secuenciales
                y orden de ejecución. Se asocian por GUID o nombre del dataflow.
              </p>
              <FileDropzone
                archivos={atls}
                onCambiar={setAtls}
                accept=".atl,.txt"
                como="texto"
                icono="📄"
                titulo="Arrastra archivos ATL aquí o haz click"
                ayuda="Formato .atl o .txt  ·  Múltiples archivos permitidos"
                iconoDeArchivo="📄"
                conTamano={false}
              />
            </div>

            <div className="exp-upload-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={archivos.length === 0 || analizando}
                onClick={explorar}
              >
                {analizando ? '⏳ Analizando...' : '🔬 Explorar integraciones'}
              </button>

              <div className="exp-conn-barras">
                {destinos.length > 0 && (
                  <div className="exp-conn-grupo">
                    {destinoElegido ? (
                      <>
                        <span className="exp-conn-pildora es-cids">
                          CI-DS: {destinoElegido.name} · {repositorio} ·{' '}
                          {marcaTransportadas
                            ? unidades(marcaTransportadas.size, 'tarea', 'tareas')
                            : 'cargando...'}
                        </span>
                        <button
                          type="button"
                          className="exp-conn-desconectar"
                          onClick={() => { setDestinoCids(''); setTransportadas(null); setSoloTransportadas(false) }}
                        >
                          Desconectar
                        </button>
                      </>
                    ) : (
                      <SelectorDeLista
                        className="exp-conn-conectar es-cids"
                        value=""
                        onChange={setDestinoCids}
                        ariaLabel="Conectar SAP CI-DS"
                        titulo="Conectar SAP CI-DS"
                        placeholder="Conectar SAP CI-DS"
                        options={[
                          { value: '', label: 'Conectar SAP CI-DS', disabled: true },
                          ...destinos.map((uno) => ({ value: uno.id, label: uno.label })),
                        ]}
                      />
                    )}
                    <Ayuda cual="cids" />
                  </div>
                )}

                {tenants.length > 0 && (
                  <div className="exp-conn-grupo">
                    {tenantElegido ? (
                      <>
                        <span className="exp-conn-pildora es-ibp">
                          SAP IBP: {tenantElegido.name} ·{' '}
                          {marcaDeJobs
                            ? unidades(Object.keys(marcaDeJobs).length, 'tarea localizada', 'tareas localizadas')
                            : 'cargando...'}
                        </span>
                        <button
                          type="button"
                          className="exp-conn-desconectar"
                          onClick={() => {
                            setTenantIbp(''); setIndiceDeJobs(null); setSoloEnIbp(false); setFalloDeMarcas('')
                          }}
                        >
                          Desconectar
                        </button>
                      </>
                    ) : (
                      <SelectorDeLista
                        className="exp-conn-conectar es-ibp"
                        value=""
                        onChange={setTenantIbp}
                        ariaLabel="Conectar SAP IBP"
                        titulo="Conectar SAP IBP"
                        placeholder="Conectar SAP IBP"
                        options={[
                          { value: '', label: 'Conectar SAP IBP', disabled: true },
                          ...tenants.map((uno) => ({ value: uno.id, label: uno.name })),
                        ]}
                      />
                    )}
                    <Ayuda cual="ibp" />
                  </div>
                )}
              </div>
            </div>

            {falloDeMarcas && (
              <div className="notice notice-info">
                No se pudo leer el índice de trabajos de IBP ({falloDeMarcas}). El explorador funciona
                igual, sin esa marca.
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Los resultados ─────────────────────────────────────────────────────────────────── */}
      {base && (
        <div className="card exp-resultados a-pantalla-completa" ref={lienzo}>
          {errores.length > 0 && (
            <div className="notice notice-error">
              ✕ No se pudieron leer {errores.length === 1 ? 'un archivo' : 'algunos archivos'}:
              {' '}
              {errores.map((uno) => `${uno.archivo} (${uno.mensaje})`).join(', ')}
            </div>
          )}

          <div className="exp-toolbar">
            <div className="exp-dims">
              {DIMENSIONES.filter((una) => !una.soloConAtl || atl).map((una) => (
                <button
                  key={una.id}
                  type="button"
                  className={`exp-dim-btn${dimension === una.id ? ' active' : ''}`}
                  onClick={() => cambiarDimension(una.id)}
                >
                  {una.icono} {una.label}
                </button>
              ))}
            </div>

            <div className="exp-toolbar-row">
              <input
                className="input input-sm exp-search"
                placeholder="🔍 Buscar..."
                value={texto}
                onChange={(evento) => { setTexto(evento.target.value); setClave(null) }}
              />

              {dimension === 'integracion' && (
                <div className="exp-modo">
                  <button
                    type="button"
                    className={`exp-modo-btn${vista === 'lista' ? ' active' : ''}`}
                    onClick={() => setVista('lista')}
                  >
                    📋 Lista
                  </button>
                  <button
                    type="button"
                    className={`exp-modo-btn${vista === 'grafo' ? ' active' : ''}`}
                    onClick={() => setVista('grafo')}
                  >
                    🕸️ Grafo
                  </button>
                </div>
              )}

              <span className="exp-counter">{contador}</span>

              {/* No estaba en v9, que no tenía pantalla completa del explorador: se conserva. */}
              <BotonPantallaCompleta {...pantalla} que="el explorador" />
            </div>

            {marcaTransportadas && (
              <div className="exp-filtro-fila">
                <Interruptor
                  activo={soloTransportadas}
                  onCambiar={setSoloTransportadas}
                  titulo={`Mostrar solo integraciones en CI-DS ${repositorio}`}
                >
                  Promovido a producción
                </Interruptor>
              </div>
            )}

            {marcaDeJobs && (
              <div className="exp-filtro-fila">
                <Interruptor
                  activo={soloEnIbp}
                  onCambiar={setSoloEnIbp}
                  titulo="Mostrar solo integraciones presentes en algún job de SAP IBP"
                >
                  Solo tareas en jobs IBP
                </Interruptor>
              </div>
            )}

            {estadoDelAtl && (
              <div className="exp-filtro-fila">
                <span
                  className="exp-atl-pildora"
                  title="Procesos CI-DS emparejados desde los archivos ATL (grupos, orden y paralelismo)."
                >
                  ATL: {[
                    unidades(estadoDelAtl.procesos, 'proceso', 'procesos'),
                    `${estadoDelAtl.emparejados}/${estadoDelAtl.declarados} dataflows`,
                    ...(estadoDelAtl.faltan ? [`${estadoDelAtl.faltan} faltan en ZIP`] : []),
                    ...(estadoDelAtl.sueltas ? [`${estadoDelAtl.sueltas} sin proceso`] : []),
                  ].join(' · ')}
                </span>
                {estadoDelAtl.conflictos > 0 && (
                  <>
                    <span
                      className="exp-atl-conflicto-pildora"
                      title="Posible conflicto entre la cadena de datos detectada y el orden de ejecución declarado en el ATL."
                    >
                      ⚠ {unidades(estadoDelAtl.conflictos, 'conflicto de orden', 'conflictos de orden')}
                    </span>
                    <Interruptor
                      activo={soloConflictos}
                      onCambiar={setSoloConflictos}
                      titulo="Mostrar solo integraciones con conflicto de orden ATL"
                    >
                      Solo conflictos
                    </Interruptor>
                  </>
                )}
              </div>
            )}

            {conScript > 0 && (
              <div className="exp-filtro-fila">
                <Interruptor
                  activo={soloConScript}
                  onCambiar={setSoloConScript}
                  titulo="Mostrar solo integraciones cuyo job tiene un script pre/post-load con contenido"
                >
                  📜 Solo con script <span className="exp-script-count">{conScript}</span>
                </Interruptor>
              </div>
            )}

            {conDistinct > 0 && (
              <div className="exp-filtro-fila">
                <Interruptor
                  activo={soloConDistinct}
                  onCambiar={setSoloConDistinct}
                  titulo="Mostrar solo integraciones con algún transform que tenga «Select Distinct Rows»"
                >
                  Solo con Select Distinct Rows <span className="exp-distinct-count">{conDistinct}</span>
                </Interruptor>
              </div>
            )}

            <FiltroDeChips
              titulo="PA:"
              opciones={areas}
              elegidas={planAreas}
              onAlternar={(valor) => setPlanAreas((previo) => alternar(previo, valor))}
              textoDelVacio="Sin PA"
            />
            <FiltroDeChips
              titulo="Origen:"
              opciones={datastores.origen}
              elegidas={srcDS}
              onAlternar={(valor) => setSrcDS((previo) => alternar(previo, valor))}
              textoDelVacio="(sin DS)"
            />
            <FiltroDeChips
              titulo="Destino:"
              opciones={datastores.destino}
              elegidas={dstDS}
              onAlternar={(valor) => setDstDS((previo) => alternar(previo, valor))}
              textoDelVacio="(sin DS)"
            />
          </div>

          {vista === 'grafo' && dimension === 'integracion' ? (
            <Suspense fallback={<div className="page-hint">Cargando el grafo…</div>}>
              <ChainGraph integraciones={visibles} cadenas={base.cadenas} onElegir={irA} />
            </Suspense>
          ) : (
            <div
              className={`exp-split${arrastrando ? ' arrastrando' : ''}`}
              ref={contenedorRef}
              style={{ gridTemplateColumns: `${ancho}px 6px minmax(0, 1fr)` }}
            >
              <div className="exp-master-col">
                {hayDatosEnLaLista && (
                  <div className="exp-pane-head">
                    <span className="exp-pane-title">{tituloDeLaLista}</span>
                    <BotonCopiar titulo="Copiar listado (formato tabla)" onCopiar={copiarLaLista} />
                  </div>
                )}
                <div className="exp-master">
                  {dimension === 'atl-proceso' ? (
                    <AtlProcessMaster
                      atl={atl}
                      integraciones={integraciones}
                      visibles={visibles}
                      cadenas={base.cadenas}
                      enConflicto={enConflicto}
                      soloConflictos={filtrarPorConflictos}
                      seleccion={elegida?._idx ?? null}
                      onElegir={irA}
                    />
                  ) : (
                    <ExplorerMaster
                      dimension={dimension}
                      integraciones={visibles}
                      entradas={entradas}
                      cadenas={base.cadenas}
                      transportadas={marcaTransportadas}
                      indiceDeJobs={marcaDeJobs}
                      enConflicto={enConflicto}
                      seleccion={elegida?._idx ?? null}
                      claveElegida={clave}
                      onElegirIntegracion={irA}
                      onElegirClave={setClave}
                    />
                  )}
                </div>
              </div>

              {/* El borde entre las dos columnas: se arrastra, o se mueve con las flechas. */}
              <div className="exp-resizer" {...propiedadesDelBorde} />

              <div className="exp-detail-pane">
                {!esDeDimension
                  ? (elegida
                    ? (
                      <IntegrationDetail
                        key={elegida._idx}
                        integracion={elegida}
                        integraciones={integraciones}
                        cadenas={base.cadenas}
                        transportadas={marcaTransportadas}
                        atl={atl}
                        indiceDeJobs={marcaDeJobs}
                        puedeVolver={pila.length > 1}
                        onVolver={() => setPila((previa) => previa.slice(0, -1))}
                        onInicio={() => setPila((previa) => previa.slice(0, 1))}
                        onIr={saltarA}
                      />
                    )
                    : <p className="exp-empty">Selecciona una integración a la izquierda para explorar sus campos</p>)
                  : (
                    <DimensionDetail
                      dimension={dimension}
                      entrada={entradaElegida}
                      integraciones={integraciones}
                      onIrAIntegracion={irA}
                      onCopiarTareas={() => {
                        const lista = integracionesDeLaEntrada(entradaElegida, integraciones)
                        if (lista.length === 0) { avisar('No hay tareas para copiar', true); return false }
                        return copiarTsv(tareasATsv(lista), lista.length)
                      }}
                    />
                  )}
              </div>
            </div>
          )}
        </div>
      )}

      {aviso && <div className={`exp-toast${aviso.esError ? ' es-error' : ''}`} role="status">{aviso.texto}</div>}
    </div>
  )
}
