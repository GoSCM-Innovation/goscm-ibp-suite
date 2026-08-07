// El explorador de integraciones: abrir los exports de un proyecto de CI-DS y recorrerlos.
//
// Portado de `explorer.js` de v9, que eran 2.900 líneas de manipulación directa del DOM. Lo que
// desaparece respecto de aquel: el diálogo para conectarse a CI-DS —la conexión ya está elegida
// arriba, en el módulo— y la carga de vis-network y JSZip desde un CDN.
//
// Todo pasa en el navegador. El único dato que viene del servidor es qué tareas ya están en el
// repositorio productivo, y es una marca de más: si falla, el explorador funciona igual.

import { Suspense, lazy, useMemo, useState } from 'react'

import { conConflicto, enrichWithAtl } from '../../../lib/atl-enrich.js'
import { parseATL } from '../../../lib/cids-atl.js'
import { analyzeProject } from '../../../lib/integration-index.js'
import {
  DIMENSIONES,
  datastoreOptions,
  entradasDeDimension,
  filtrarIntegraciones,
  planAreaOptions,
} from '../../../lib/integration-view.js'
import DimensionDetail from './DimensionDetail.jsx'
import ExplorerMaster from './ExplorerMaster.jsx'
import IntegrationDetail from './IntegrationDetail.jsx'
import ProjectDropzone from './ProjectDropzone.jsx'

const ChainGraph = lazy(() => import('./ChainGraph.jsx'))

/** Marca o desmarca un valor en un conjunto de filtro, sin tocar el original. */
function alternar(conjunto, valor) {
  const nuevo = new Set(conjunto)
  if (nuevo.has(valor)) nuevo.delete(valor)
  else nuevo.add(valor)
  return nuevo
}

/** Un grupo de chips de filtro. Nada marcado significa "todos". */
function Filtro({ titulo, opciones, elegidas, onAlternar }) {
  if (opciones.length < 2) return null

  return (
    <div className="exp-filter-group">
      <span className="exp-filter-title">{titulo}</span>
      <div className="chips">
        {opciones.map((una) => (
          <button
            key={una}
            type="button"
            className={`chip${elegidas.has(una) ? ' active' : ''}`}
            onClick={() => onAlternar(una)}
          >
            {una}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function IntegrationExplorer({ transportadas }) {
  const [archivos, setArchivos] = useState([])
  const [atls, setAtls] = useState([])
  const [analisis, setAnalisis] = useState(null)
  const [analizando, setAnalizando] = useState(false)

  const [dimension, setDimension] = useState('integracion')
  const [texto, setTexto] = useState('')
  const [vista, setVista] = useState('lista')

  // La pila de navegación: el tope es lo que se está viendo y el fondo es desde dónde se empezó.
  // Es lo que permite saltar de una integración a la que la alimenta y poder volver.
  const [pila, setPila] = useState([])
  const [clave, setClave] = useState(null)

  const [planAreas, setPlanAreas] = useState(new Set())
  const [srcDS, setSrcDS] = useState(new Set())
  const [dstDS, setDstDS] = useState(new Set())
  const [soloTransportadas, setSoloTransportadas] = useState(false)
  const [soloConflictos, setSoloConflictos] = useState(false)

  // La lista vacía va en un `useMemo` para que sea la misma referencia entre repintados: si no,
  // todos los cálculos de abajo se rehacen en cada tecla mientras no hay proyecto cargado.
  const integraciones = useMemo(() => analisis?.integraciones ?? [], [analisis])

  const atl = analisis?.atl ?? null

  // Qué integraciones están metidas en un choque, para poder filtrar por ellas.
  const enConflicto = useMemo(() => (atl ? conConflicto(atl.conflictos) : null), [atl])

  const filtros = useMemo(
    () => ({ planAreas, srcDS, dstDS, soloTransportadas, transportadas }),
    [planAreas, srcDS, dstDS, soloTransportadas, transportadas],
  )

  const visibles = useMemo(() => {
    const pasan = filtrarIntegraciones(integraciones, analisis?.indices, texto, filtros)
    return soloConflictos && enConflicto ? pasan.filter((una) => enConflicto.has(una._idx)) : pasan
  }, [integraciones, analisis, texto, filtros, soloConflictos, enConflicto])

  const entradas = useMemo(
    () => (dimension === 'integracion'
      ? []
      : entradasDeDimension(analisis?.indices, dimension, texto, new Set(visibles.map((una) => una._idx)))),
    [analisis, dimension, texto, visibles],
  )

  const areas = useMemo(() => planAreaOptions(integraciones), [integraciones])
  const datastores = useMemo(() => datastoreOptions(integraciones), [integraciones])

  async function explorar() {
    setAnalizando(true)
    // Se limpia todo: los filtros y la selección son del proyecto anterior.
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

    try {
      const resultado = await analyzeProject(archivos)

      // El ATL es opcional: sin él el explorador funciona igual, solo que sin poder contrastar el
      // orden real de ejecución. Uno que no se pueda leer se salta con su aviso.
      const leidos = []
      const fallados = []
      for (const archivo of atls) {
        try { leidos.push({ nombre: archivo.name, atl: parseATL(archivo.text) }) }
        catch (error) { fallados.push({ archivo: archivo.name, mensaje: error?.message || String(error) }) }
      }

      setAnalisis({
        ...resultado,
        errores: [...resultado.errores, ...fallados],
        atl: leidos.length > 0
          ? enrichWithAtl(resultado.integraciones, resultado.cadenas, leidos)
          : null,
      })
    } finally {
      setAnalizando(false)
    }
  }

  /** Empezar a mirar una integración desde cero: la pila arranca de nuevo. */
  function irA(idx) {
    setPila([idx])
    setDimension('integracion')
    setVista('lista')
    setClave(null)
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

  const elegida = pila.length > 0 ? integraciones[pila[pila.length - 1]] : null
  const entradaElegida = entradas.find((una) => una.clave === clave) ?? null

  if (!analisis) {
    return (
      <div className="exp-page">
        <ProjectDropzone
          archivos={archivos}
          onCambiar={setArchivos}
          atls={atls}
          onAtls={setAtls}
          onExplorar={explorar}
          analizando={analizando}
        />
      </div>
    )
  }

  return (
    <div className="exp-page">
      {analisis.errores.length > 0 && (
        <div className="notice notice-error">
          ✕ No se pudieron leer {analisis.errores.length === 1 ? 'un archivo' : 'algunos archivos'}:
          {' '}
          {analisis.errores.map((uno) => `${uno.archivo} (${uno.mensaje})`).join(', ')}
        </div>
      )}

      <div className="exp-toolbar">
        <div className="exp-dims">
          {DIMENSIONES.map((una) => (
            <button
              key={una.id}
              type="button"
              className={`chip${dimension === una.id ? ' active' : ''}`}
              onClick={() => cambiarDimension(una.id)}
            >
              {una.icono} {una.label}
            </button>
          ))}
        </div>

        <div className="exp-toolbar-row">
          <input
            className="input input-sm exp-search"
            placeholder="🔍 Buscar en tareas, campos, filtros y lookups…"
            value={texto}
            onChange={(evento) => { setTexto(evento.target.value); setClave(null) }}
          />

          {dimension === 'integracion' && (
            <div className="tabs tabs-inline">
              <button
                type="button"
                className={`tab${vista === 'lista' ? ' active' : ''}`}
                onClick={() => setVista('lista')}
              >
                📋 Lista
              </button>
              <button
                type="button"
                className={`tab${vista === 'grafo' ? ' active' : ''}`}
                onClick={() => setVista('grafo')}
              >
                🕸️ Grafo
              </button>
            </div>
          )}

          <span className="exp-counter">
            {dimension === 'integracion'
              ? `${visibles.length} de ${integraciones.length} dataflows`
              : `${entradas.length} ${entradas.length === 1 ? 'resultado' : 'resultados'}`}
            {' · '}
            {analisis.cadenas.length} {analisis.cadenas.length === 1 ? 'cadena' : 'cadenas'}
          </span>

          <button type="button" className="btn btn-sm" onClick={() => setAnalisis(null)}>
            Cargar otro proyecto
          </button>
        </div>

        <Filtro
          titulo="Área"
          opciones={areas}
          elegidas={planAreas}
          onAlternar={(valor) => setPlanAreas((previo) => alternar(previo, valor))}
        />
        <Filtro
          titulo="Origen"
          opciones={datastores.origen}
          elegidas={srcDS}
          onAlternar={(valor) => setSrcDS((previo) => alternar(previo, valor))}
        />
        <Filtro
          titulo="Destino"
          opciones={datastores.destino}
          elegidas={dstDS}
          onAlternar={(valor) => setDstDS((previo) => alternar(previo, valor))}
        />

        {transportadas && (
          <label className="exp-check">
            <input
              type="checkbox"
              checked={soloTransportadas}
              onChange={(evento) => setSoloTransportadas(evento.target.checked)}
            />
            Solo las tareas que ya están en el repositorio productivo
          </label>
        )}

        {atl && (
          <div className="exp-atl-bar">
            <span className="page-hint">
              {atl.procesos.length} {atl.procesos.length === 1 ? 'proceso' : 'procesos'} de CI-DS
              {' · '}{atl.huerfanas.length} sin ubicar
              {atl.conflictos.length > 0 && ` · ${atl.conflictos.length} en choque con el orden real`}
            </span>
            {atl.conflictos.length > 0 && (
              <label className="exp-check">
                <input
                  type="checkbox"
                  checked={soloConflictos}
                  onChange={(evento) => setSoloConflictos(evento.target.checked)}
                />
                Solo las que chocan con el orden de ejecución
              </label>
            )}
          </div>
        )}
      </div>

      {vista === 'grafo' && dimension === 'integracion' ? (
        <Suspense fallback={<div className="page-hint">Cargando el grafo…</div>}>
          <ChainGraph integraciones={visibles} cadenas={analisis.cadenas} onElegir={irA} />
        </Suspense>
      ) : (
        <div className="exp-split">
          <div className="exp-master">
            <ExplorerMaster
              dimension={dimension}
              integraciones={visibles}
              entradas={entradas}
              cadenas={analisis.cadenas}
              transportadas={transportadas}
              enConflicto={enConflicto}
              seleccion={elegida?._idx ?? null}
              claveElegida={clave}
              onElegirIntegracion={irA}
              onElegirClave={setClave}
            />
          </div>

          <div className="exp-detail-pane">
            {dimension === 'integracion'
              ? (elegida
                ? (
                  <IntegrationDetail
                    key={elegida._idx}
                    integracion={elegida}
                    integraciones={integraciones}
                    cadenas={analisis.cadenas}
                    transportadas={transportadas}
                    atl={atl}
                    puedeVolver={pila.length > 1}
                    onVolver={() => setPila((previa) => previa.slice(0, -1))}
                    onInicio={() => setPila((previa) => previa.slice(0, 1))}
                    onIr={saltarA}
                  />
                )
                : <p className="exp-empty">Elegí una integración de la lista para ver sus campos.</p>)
              : (
                <DimensionDetail
                  dimension={dimension}
                  entrada={entradaElegida}
                  integraciones={integraciones}
                  onIrAIntegracion={irA}
                />
              )}
          </div>
        </div>
      )}
    </div>
  )
}
