// El documentador de mapeos: de los ZIP de un proyecto a un Excel que se entrega al cliente.
//
// Portado de `mapping-dataflow.html` y `docs.js` de v9. Tres pasos: cargar, elegir qué documentar y
// descargar. El ATL es opcional y agrega a qué proceso y a qué grupo pertenece cada dataflow —el
// orden real de ejecución, que no está en el export.
//
// Lo que todavía NO hace, y en v9 sí: enriquecer con el tipo de dato y un valor de ejemplo traídos
// de IBP, y el modo que arma el documento a partir de los Application Jobs. Las dos cosas necesitan
// una conexión a IBP; las columnas quedan en el Excel, vacías.

import { useMemo, useState } from 'react'

import { matchATLtoIntegrations, parseATL } from '../../../lib/cids-atl.js'
import { buildWorkbook, scanForDocument } from '../../../lib/cids-doc.js'
import FileDropzone from '../../ui/FileDropzone.jsx'

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
function nombreDelArchivo() {
  const hoy = new Date().toISOString().slice(0, 10)
  return `Documentacion_integraciones_${hoy}.xlsx`
}

export default function MappingDocumenter() {
  const [zips, setZips] = useState([])
  const [atls, setAtls] = useState([])

  const [entradas, setEntradas] = useState(null)
  const [errores, setErrores] = useState([])
  const [ambiguas, setAmbiguas] = useState([])
  const [analizando, setAnalizando] = useState(false)
  const [generando, setGenerando] = useState(false)
  const [fallo, setFallo] = useState('')

  const [elegidas, setElegidas] = useState(new Set())
  const [texto, setTexto] = useState('')

  const visibles = useMemo(() => {
    const buscado = texto.trim().toLowerCase()
    if (!buscado || !entradas) return entradas ?? []
    return entradas.filter((una) => (
      `${una.paramRow.jobName} ${una.paramRow.dataflowName} ${una.parsed.targetTable}`
        .toLowerCase()
        .includes(buscado)
    ))
  }, [entradas, texto])

  async function analizar() {
    setAnalizando(true)
    setFallo('')
    setTexto('')

    try {
      const { entradas: leidas, errores: fallos } = await scanForDocument(zips)

      // El ATL solo agrega el proceso y el grupo; si no empareja con nada, el documento sale igual.
      const sinEmparejar = []
      let conAtl = leidas
      for (const archivo of atls) {
        const { ordenadas, ambiguas: dudosas } = matchATLtoIntegrations(parseATL(archivo.text), conAtl)
        conAtl = ordenadas
        sinEmparejar.push(...dudosas)
      }

      setEntradas(conAtl)
      setErrores(fallos)
      setAmbiguas([...new Set(sinEmparejar)])
      setElegidas(new Set(conAtl.map((una) => una.sheetName)))
    } catch (error) {
      setFallo(error?.message || String(error))
    } finally {
      setAnalizando(false)
    }
  }

  async function generar() {
    setGenerando(true)
    setFallo('')

    try {
      const seleccionadas = entradas
        .filter((una) => elegidas.has(una.sheetName))
        .map((una) => ({
          ...una,
          // Lo que aportó el ATL vive en la entrada; la hoja índice lo lee de `paramRow`.
          paramRow: { ...una.paramRow, atlSession: una.atlSession ?? '', atlGroup: una.atlGroup ?? '' },
        }))

      descargar(await buildWorkbook(seleccionadas), nombreDelArchivo())
    } catch (error) {
      setFallo(error?.message || String(error))
    } finally {
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
        if (marcar) nuevas.add(una.sheetName)
        else nuevas.delete(una.sheetName)
      }
      return nuevas
    })
  }

  if (!entradas) {
    return (
      <div className="exp-page">
        <div className="card exp-upload">
          <div className="card-title">📦 Exports de proyecto de CI-DS</div>
          <div className="card-hint">
            Todo se lee y se arma en tu navegador. Ni los ZIP ni el Excel pasan por ningún servidor.
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
          <div className="card-title">📄 Archivos ATL (opcional)</div>
          <div className="card-hint">
            Agregan a qué proceso y a qué grupo pertenece cada dataflow, y si corren en paralelo. Es
            el orden real de ejecución, que el export del proyecto no trae.
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
            {analizando ? 'Analizando…' : '🔎 Analizar los proyectos'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="exp-page">
      {errores.length > 0 && (
        <div className="notice notice-error">
          ✕ No se pudieron leer: {errores.map((uno) => `${uno.archivo} (${uno.mensaje})`).join(', ')}
        </div>
      )}

      {ambiguas.length > 0 && (
        <div className="notice notice-info">
          El ATL nombra {ambiguas.length === 1 ? 'un dataflow que existe' : 'dataflows que existen'} más
          de una vez en el proyecto ({ambiguas.join(', ')}). Como no se puede saber a cuál se refiere,
          {' '}{ambiguas.length === 1 ? 'esa integración queda' : 'esas integraciones quedan'} sin grupo.
        </div>
      )}

      {fallo && <div className="notice notice-error">✕ {fallo}</div>}

      <div className="exp-toolbar">
        <div className="exp-toolbar-row">
          <input
            className="input input-sm exp-search"
            placeholder="🔍 Buscar por tarea, dataflow o tabla destino…"
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
          />
          <button type="button" className="btn btn-sm" onClick={() => marcarVisibles(true)}>
            Marcar lo visible
          </button>
          <button type="button" className="btn btn-sm" onClick={() => marcarVisibles(false)}>
            Desmarcar lo visible
          </button>
          <span className="exp-counter">
            {elegidas.size} de {entradas.length} elegidas
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
            {generando ? 'Generando…' : '📗 Generar el Excel'}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setEntradas(null)}>
            Cargar otros proyectos
          </button>
        </div>
      </div>

      <div className="table-scroll doc-list">
        <table className="table-dense">
          <thead>
            <tr>
              <th className="doc-check" />
              <th>Tarea</th>
              <th>Dataflow</th>
              <th>Destino</th>
              <th>Proceso</th>
              <th>Grupo</th>
              <th>Mapeos</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((una) => (
              <tr key={una.sheetName}>
                <td className="doc-check">
                  <input
                    type="checkbox"
                    checked={elegidas.has(una.sheetName)}
                    onChange={() => alternar(una.sheetName)}
                    aria-label={`Documentar ${una.paramRow.jobName}`}
                  />
                </td>
                <td>
                  {una.paramRow.jobName}
                  {una.paramRow.jobDesc && <div className="exp-sub">{una.paramRow.jobDesc}</div>}
                </td>
                <td>{una.paramRow.dataflowName}</td>
                <td>{una.parsed.targetTable}</td>
                <td>{una.atlSession || <span className="exp-muted">—</span>}</td>
                <td>
                  {una.atlGroup || <span className="exp-muted">—</span>}
                  {una.atlParallel && <span className="tag tag-muted">en paralelo</span>}
                </td>
                <td>{una.parsed.mappings.length}</td>
              </tr>
            ))}
            {visibles.length === 0 && (
              <tr><td colSpan={7} className="table-empty">No hay nada que coincida.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
