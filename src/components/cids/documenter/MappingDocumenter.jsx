// El documentador de mapeos: de los ZIP de un proyecto a un Excel que se entrega al cliente.
//
// Portado de `mapping-dataflow.html` y `docs.js` de v9, con los tres modos de aquel reducidos a dos,
// que es lo que de verdad eran:
//
//   - **Proyecto**: los dataflows del export, opcionalmente ordenados por los ATL.
//   - **Trabajos de IBP**: además, en el orden en que IBP los corre, con su job y su paso.
//
// (v9 tenía "ZIP", "ZIP+Jobs" y "Jobs"; los dos últimos hacían lo mismo y se diferenciaban solo en
// qué archivos pedían primero.)
//
// El tenant de IBP es opcional en el modo Proyecto: aporta la etiqueta de cada campo, su tipo de
// dato y un valor de ejemplo real. Sin él esas columnas quedan vacías y el resto sale igual.

import { useEffect, useMemo, useState } from 'react'

import { matchATLtoIntegrations, parseATL } from '../../../lib/cids-atl.js'
import { buildWorkbook, scanForDocument } from '../../../lib/cids-doc.js'
import { enrichAll } from '../../../lib/ibp-enrich.js'
import { ordenarPorJobs } from '../../../lib/ibp-jobs-order.js'
import { fetchCatalog, fetchJobSteps, fetchSampleRow, nombreDeJob, plantillaDe } from '../../../lib/ibp.js'
import FileDropzone from '../../ui/FileDropzone.jsx'
import IbpPanel from './IbpPanel.jsx'

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

/** El nombre del archivo lleva la fecha: se generan varios y hay que poder distinguirlos. */
const nombreDelArchivo = () => `Documentacion_integraciones_${new Date().toISOString().slice(0, 10)}.xlsx`

const MODOS = [
  { id: 'proyecto', label: '📦 Por proyecto' },
  { id: 'jobs', label: '⚙️ Por trabajos de IBP' },
]

export default function MappingDocumenter() {
  const [modo, setModo] = useState('proyecto')

  const [zips, setZips] = useState([])
  const [atls, setAtls] = useState([])

  const [conexionId, setConexionId] = useState('')
  const [planArea, setPlanArea] = useState('')
  // El catálogo se guarda junto al tenant del que salió, no suelto: así al cambiar de conexión no
  // hay que limpiarlo —basta con no usarlo— y nunca se ve ni un instante el del tenant anterior.
  const [leido, setLeido] = useState(null)
  const [jobsElegidos, setJobsElegidos] = useState([])

  const [entradas, setEntradas] = useState(null)
  const [errores, setErrores] = useState([])
  const [avisos, setAvisos] = useState([])
  const [analizando, setAnalizando] = useState(false)
  const [generando, setGenerando] = useState(false)
  const [paso, setPaso] = useState('')
  const [fallo, setFallo] = useState('')

  const [elegidas, setElegidas] = useState(new Set())
  const [texto, setTexto] = useState('')

  // El catálogo se pide una vez por tenant. Es la consulta más cara de todas —el `$metadata` de
  // dato maestro pesa unos 4,8 MB— y no cambia mientras se trabaja.
  useEffect(() => {
    if (!conexionId || leido?.conexionId === conexionId) return undefined

    let abandonado = false
    const guardar = (resultado) => { if (!abandonado) setLeido({ conexionId, ...resultado }) }

    fetchCatalog(conexionId)
      .then((catalogo) => guardar({ catalogo, error: '' }))
      .catch((error) => guardar({ catalogo: null, error: error.message }))

    return () => { abandonado = true }
  }, [conexionId, leido])

  const delTenant = leido?.conexionId === conexionId ? leido : null
  const catalogo = delTenant?.catalogo ?? null
  const errorCatalogo = delTenant?.error ?? ''
  const cargandoCatalogo = Boolean(conexionId) && !delTenant

  const visibles = useMemo(() => {
    if (!entradas) return []
    const buscado = texto.trim().toLowerCase()
    if (!buscado) return entradas
    return entradas.filter((una) => (
      `${una.paramRow.jobName} ${una.paramRow.dataflowName} ${una.parsed?.targetTable ?? ''} ${una.ibpStepName ?? ''}`
        .toLowerCase()
        .includes(buscado)
    ))
  }, [entradas, texto])

  async function analizar() {
    setAnalizando(true)
    setFallo('')
    setTexto('')
    setAvisos([])

    try {
      const { entradas: leidas, errores: fallos } = await scanForDocument(zips)
      const atlsLeidos = atls.map((uno) => parseATL(uno.text))
      const nuevosAvisos = []

      let resultado = leidas

      if (modo === 'jobs') {
        if (jobsElegidos.length === 0) throw new Error('Elegí al menos un trabajo de IBP.')

        setPaso('Leyendo los pasos de los trabajos…')
        const { pasos, avisoDeTaskId } = await fetchJobSteps(conexionId, jobsElegidos.map(plantillaDe))
        if (avisoDeTaskId) {
          nuevosAvisos.push(
            `No se pudo leer el identificador técnico de las tareas (${avisoDeTaskId}). `
            + 'Los pasos se emparejan por su texto, que es menos fiable.',
          )
        }

        const { filas, avisos: propios } = ordenarPorJobs({
          atls: atlsLeidos,
          entradas: leidas,
          jobs: jobsElegidos.map((uno) => ({ nombre: nombreDeJob(uno) })),
          pasosPorJob: pasos,
        })
        resultado = filas
        nuevosAvisos.push(...propios)
      } else {
        // El ATL solo agrega el proceso y el grupo; si no empareja con nada, el documento sale igual.
        for (const leido of atlsLeidos) {
          const { ordenadas, ambiguas } = matchATLtoIntegrations(leido, resultado)
          resultado = ordenadas
          for (const nombre of ambiguas) {
            nuevosAvisos.push(`El ATL nombra "${nombre}", que existe más de una vez en el proyecto: queda sin grupo.`)
          }
        }
      }

      setEntradas(resultado)
      setErrores(fallos)
      setAvisos([...new Set(nuevosAvisos)])
      setElegidas(new Set(resultado.filter((una) => !una.isNonDI).map((una) => una.sheetName)))
    } catch (error) {
      setFallo(error?.message || String(error))
    } finally {
      setPaso('')
      setAnalizando(false)
    }
  }

  async function generar() {
    setGenerando(true)
    setFallo('')

    try {
      // Las filas informativas —pasos de IBP que no son de integración— entran siempre: existen para
      // que el orden del trabajo se lea completo, y no hay nada que elegir en ellas.
      const seleccionadas = entradas.filter((una) => una.isNonDI || elegidas.has(una.sheetName))

      let paraDocumentar = seleccionadas
      const nuevosAvisos = []

      if (catalogo) {
        setPaso('Consultando IBP…')
        const documentables = seleccionadas.filter((una) => !una.isNonDI)
        const { entradas: enriquecidas, avisos: propios } = await enrichAll(
          documentables,
          catalogo,
          (destino) => fetchSampleRow(conexionId, destino),
          planArea,
        )

        const porHoja = new Map(enriquecidas.map((una) => [una.sheetName, una]))
        paraDocumentar = seleccionadas.map((una) => porHoja.get(una.sheetName) ?? una)
        nuevosAvisos.push(...propios)
      }

      setPaso('Armando el Excel…')
      const conParametros = paraDocumentar.map((una) => ({
        ...una,
        paramRow: {
          ...una.paramRow,
          atlSession: una.atlSession ?? '',
          atlGroup: una.atlGroup ?? '',
          ibpJobName: una.ibpJobName ?? '',
          ibpStepName: una.ibpStepName ?? '',
          ibpStepType: una.ibpStepType ?? '',
        },
      }))

      descargar(await buildWorkbook(conParametros, { modoJobs: modo === 'jobs' }), nombreDelArchivo())
      if (nuevosAvisos.length > 0) setAvisos((previos) => [...new Set([...previos, ...nuevosAvisos])])
    } catch (error) {
      setFallo(error?.message || String(error))
    } finally {
      setPaso('')
      setGenerando(false)
    }
  }

  function alternar(sheetName) {
    setElegidas((previas) => {
      const nuevas = new Set(previas)
      if (nuevas.has(sheetName)) nuevas.delete(sheetName)
      else nuevas.add(sheetName)
      return nuevas
    })
  }

  /** Marca o desmarca solo lo que se está viendo, no todo el proyecto. */
  function marcarVisibles(marcar) {
    setElegidas((previas) => {
      const nuevas = new Set(previas)
      for (const una of visibles) {
        if (una.isNonDI) continue
        if (marcar) nuevas.add(una.sheetName)
        else nuevas.delete(una.sheetName)
      }
      return nuevas
    })
  }

  const panelDeIbp = (
    <IbpPanel
      conexionId={conexionId}
      onConexion={(id) => { setConexionId(id); setJobsElegidos([]); setPlanArea('') }}
      planArea={planArea}
      onPlanArea={setPlanArea}
      planAreas={catalogo?.planAreas ?? []}
      catalogo={catalogo}
      cargandoCatalogo={cargandoCatalogo}
      errorCatalogo={errorCatalogo}
      modoJobs={modo === 'jobs'}
      jobsElegidos={jobsElegidos}
      onJobsElegidos={setJobsElegidos}
    />
  )

  if (!entradas) {
    return (
      <div className="exp-page">
        <div className="tabs tabs-inline">
          {MODOS.map((uno) => (
            <button
              key={uno.id}
              type="button"
              className={`tab${modo === uno.id ? ' active' : ''}`}
              onClick={() => { setModo(uno.id); setJobsElegidos([]) }}
            >
              {uno.label}
            </button>
          ))}
        </div>

        {panelDeIbp}

        <div className="card exp-upload">
          <div className="card-title">📦 Exports de proyecto de CI-DS</div>
          <div className="card-hint">
            Todo se lee y se arma en tu navegador. Los ZIP no pasan por ningún servidor.
          </div>
          <FileDropzone
            archivos={zips}
            onCambiar={setZips}
            accept=".zip"
            titulo="Arrastrá los ZIP acá, o hacé clic para elegirlos"
            ayuda="Podés cargar varios proyectos a la vez"
          />
        </div>

        <div className="card exp-upload">
          <div className="card-title">📄 Archivos ATL {modo === 'jobs' ? '(recomendado)' : '(opcional)'}</div>
          <div className="card-hint">
            Agregan a qué proceso y a qué grupo pertenece cada dataflow, y si corren en paralelo. Es
            el orden real de ejecución, que el export del proyecto no trae.
            {modo === 'jobs' && ' Sin ellos solo se ubican las tareas que el trabajo llama directamente.'}
          </div>
          <FileDropzone
            archivos={atls}
            onCambiar={setAtls}
            accept=".atl,.txt"
            como="texto"
            icono="📄"
            titulo="Arrastrá los ATL acá, o hacé clic para elegirlos"
            ayuda="Se emparejan con los dataflows por su identificador"
          />
        </div>

        {fallo && <div className="notice notice-error">✕ {fallo}</div>}

        <div className="exp-upload-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={zips.length === 0 || analizando}
            onClick={analizar}
          >
            {analizando ? (paso || 'Analizando…') : '🔎 Analizar'}
          </button>
        </div>
      </div>
    )
  }

  const documentables = entradas.filter((una) => !una.isNonDI).length

  return (
    <div className="exp-page">
      {errores.length > 0 && (
        <div className="notice notice-error">
          ✕ No se pudieron leer: {errores.map((uno) => `${uno.archivo} (${uno.mensaje})`).join(', ')}
        </div>
      )}

      {avisos.length > 0 && (
        <div className="notice notice-info">
          <ul className="doc-avisos">
            {avisos.map((uno) => <li key={uno}>{uno}</li>)}
          </ul>
        </div>
      )}

      {fallo && <div className="notice notice-error">✕ {fallo}</div>}

      <div className="exp-toolbar">
        <div className="exp-toolbar-row">
          <input
            className="input input-sm exp-search"
            placeholder="🔍 Buscar por tarea, dataflow, tabla o paso…"
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
          />
          <button type="button" className="btn btn-sm" onClick={() => marcarVisibles(true)}>Marcar lo visible</button>
          <button type="button" className="btn btn-sm" onClick={() => marcarVisibles(false)}>Desmarcar</button>
          <span className="exp-counter">
            {elegidas.size} de {documentables} elegidas
            {visibles.length !== entradas.length && ` · ${visibles.length} a la vista`}
          </span>
        </div>

        <div className="exp-toolbar-row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={elegidas.size === 0 || generando}
            onClick={generar}
          >
            {generando ? (paso || 'Generando…') : '📗 Generar el Excel'}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setEntradas(null)}>
            Volver a empezar
          </button>
          {!catalogo && (
            <span className="page-hint">
              Sin tenant de IBP: las columnas de tipo de dato y ejemplo saldrán vacías.
            </span>
          )}
        </div>
      </div>

      <div className="table-scroll doc-list">
        <table className="table-dense">
          <thead>
            <tr>
              <th className="doc-check" />
              {modo === 'jobs' && <><th>Trabajo</th><th>Paso</th></>}
              <th>Tarea</th>
              <th>Dataflow</th>
              <th>Destino</th>
              {modo === 'proyecto' && <th>Proceso</th>}
              <th>Grupo</th>
              <th>Mapeos</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((una, i) => (
              <tr key={una.sheetName || `paso-${i}`} className={una.isNonDI ? 'doc-nondi' : undefined}>
                <td className="doc-check">
                  {una.isNonDI
                    ? <span className="exp-muted" title="Paso que no es de integración: no tiene dataflow que documentar">—</span>
                    : (
                      <input
                        type="checkbox"
                        checked={elegidas.has(una.sheetName)}
                        onChange={() => alternar(una.sheetName)}
                        aria-label={`Documentar ${una.paramRow.jobName}`}
                      />
                    )}
                </td>
                {modo === 'jobs' && (
                  <>
                    <td>{una.ibpJobName || <span className="exp-muted">—</span>}</td>
                    <td>
                      {una.ibpStepName || <span className="exp-muted">—</span>}
                      {una.isNonDI && <div className="exp-sub">{una.paramRow.tipoIntegracion}</div>}
                    </td>
                  </>
                )}
                <td>
                  {una.paramRow.jobName || <span className="exp-muted">—</span>}
                  {una.paramRow.jobDesc && <div className="exp-sub">{una.paramRow.jobDesc}</div>}
                </td>
                <td>{una.paramRow.dataflowName}</td>
                <td>{una.parsed?.targetTable ?? ''}</td>
                {modo === 'proyecto' && <td>{una.atlSession || <span className="exp-muted">—</span>}</td>}
                <td>
                  {una.atlGroup || <span className="exp-muted">—</span>}
                  {una.atlParallel && <span className="tag tag-muted">en paralelo</span>}
                </td>
                <td>{una.parsed?.mappings.length ?? ''}</td>
              </tr>
            ))}
            {visibles.length === 0 && (
              <tr><td colSpan={9} className="table-empty">No hay nada que coincida.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
