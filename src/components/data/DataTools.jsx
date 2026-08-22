// El módulo Data Tools: elegir contra QUÉ tenant, área y versión se trabaja, y moverse entre sus
// herramientas.
//
// Reemplaza la pantalla de conexión de v7, que trabajaba contra un solo tenant escrito en un
// formulario. Aquí hay N tenants dados de alta y la elección es EXPLÍCITA: se auto-elige solo cuando
// hay exactamente una opción, y con varias no se adivina nunca.
//
// Eso no es celo: en el explorador de integraciones de CI-DS la conexión de enriquecimiento se
// elegía a ciegas —se quedaba con la primera de la lista— y nadie veía contra qué tenant estaba
// trabajando. Un análisis de calidad de datos leído contra el tenant equivocado es peor que no
// tenerlo, porque parece correcto.

import { lazy, Suspense, useEffect, useMemo, useState } from 'react'

import { listIbpConnections } from '../../lib/ibp.js'
import { fetchMasterCatalog } from '../../lib/ibp-master-data.js'
import { VERSION_BASE, versionEfectiva, versionParaSap } from '../../lib/version-elegida.js'

const ExplorerSetup = lazy(() => import('./ExplorerSetup.jsx'))
const ExplorerExtract = lazy(() => import('./ExplorerExtract.jsx'))
const BomTree = lazy(() => import('./BomTree.jsx'))
const SupplyNetwork = lazy(() => import('./SupplyNetwork.jsx'))
const ProductionAnalyzer = lazy(() => import('./ProductionAnalyzer.jsx'))
const PlanningAreaDoc = lazy(() => import('./PlanningAreaDoc.jsx'))
const Glosario = lazy(() => import('./Glosario.jsx'))

const HERRAMIENTAS = [
  { id: 'origen', label: 'Origen de los datos' },
  { id: 'descarga', label: 'Descargar' },
  { id: 'arbol', label: 'Árbol de materiales' },
  { id: 'red', label: 'Red de suministro' },
  { id: 'calidad', label: 'Calidad de datos' },
  { id: 'documentar', label: 'Documentar el área' },
  { id: 'glosario', label: 'Cómo se lee' },
]

/** Elige sola solo si hay UNA opción. Con varias, la cadena vacía obliga a elegir. */
const unicaOpcion = (opciones) => (opciones.length === 1 ? opciones[0] : '')


export default function DataTools() {
  const [conexiones, setConexiones] = useState(null)
  const [error, setError] = useState('')
  const [herramienta, setHerramienta] = useState('origen')

  const [conexionId, setConexionId] = useState('')
  const [catalogo, setCatalogo] = useState(null)
  const [cargandoCatalogo, setCargandoCatalogo] = useState(false)
  const [area, setArea] = useState('')
  const [versionId, setVersionId] = useState('')

  useEffect(() => {
    let abandonado = false
    listIbpConnections()
      .then((lista) => {
        if (abandonado) return
        setConexiones(lista)
        setConexionId(unicaOpcion(lista.map((una) => una.id)))
      })
      .catch((fallo) => {
        if (abandonado) return
        setError(fallo.message)
        setConexiones([])
      })
    return () => { abandonado = true }
  }, [])

  useEffect(() => {
    if (!conexionId) return undefined
    let abandonado = false

    const id = setTimeout(() => {
      setCargandoCatalogo(true)
      setCatalogo(null)
      fetchMasterCatalog(conexionId)
        .then((leido) => {
          if (abandonado) return
          setCatalogo(leido.catalogo)
          setArea(unicaOpcion(Object.keys(leido.catalogo)))
          setError('')
        })
        .catch((fallo) => { if (!abandonado) setError(fallo.message) })
        .finally(() => { if (!abandonado) setCargandoCatalogo(false) })
    }, 0)

    return () => { abandonado = true; clearTimeout(id) }
  }, [conexionId])

  const versiones = useMemo(() => catalogo?.[area]?.versions ?? [], [catalogo, area])

  // La versión se DERIVA, y la base cuenta como una elección válida. La regla está en
  // `src/lib/version-elegida.js`, con sus pruebas: que la base quedara fuera de alcance dejó las
  // cinco pantallas de este módulo inservibles para el caso más común.
  const version = versionEfectiva(versionId, versiones)

  const conexion = conexiones?.find((una) => una.id === conexionId) ?? null
  const listo = Boolean(conexionId && area && version)

  if (conexiones === null) return <div className="page-hint">Cargando conexiones…</div>

  if (conexiones.length === 0) {
    return (
      <div className="notice notice-info">
        No hay ninguna conexión a SAP IBP configurada para tu empresa. Pedile a quien administra la
        cuenta que la dé de alta en Administración → Conexiones.
      </div>
    )
  }

  return (
    <div className="module-page">
      <div className="module-head">
        <div>
          <div className="page-title">Data Tools</div>
          <div className="page-hint">Jerarquía de producción, red logística y calidad de datos.</div>
        </div>

        {/* La procedencia va arriba y siempre visible: un número sin ella se lee como si fuera del
            tenant equivocado. */}
        <div className="monitor-bar">
          <select
            className="select input-sm"
            value={conexionId}
            onChange={(evento) => { setConexionId(evento.target.value); setArea(''); setVersionId('') }}
            aria-label="Tenant de IBP"
          >
            <option value="">Elegí un tenant…</option>
            {conexiones.map((una) => <option key={una.id} value={una.id}>{una.name}</option>)}
          </select>

          {catalogo && (
            <>
              <select
                className="select input-sm"
                value={area}
                onChange={(evento) => { setArea(evento.target.value); setVersionId('') }}
                aria-label="Área de planificación"
              >
                <option value="">Elegí un área…</option>
                {Object.entries(catalogo).map(([id, una]) => (
                  <option key={id} value={id}>{una.desc === id ? id : `${id} — ${una.desc}`}</option>
                ))}
              </select>

              <select
                className="select input-sm"
                value={version}
                onChange={(evento) => setVersionId(evento.target.value)}
                aria-label="Versión"
              >
                <option value="">Elegí una versión…</option>
                <option value={VERSION_BASE}>Versión base — el dato maestro del área</option>
                {versiones.map((una) => (
                  <option key={una.id} value={una.id}>{una.name === una.id ? una.id : `${una.id} — ${una.name}`}</option>
                ))}
              </select>
            </>
          )}

          {conexion?.isProduction && <span className="tag tag-accent">Productivo</span>}
        </div>
      </div>

      <div className="tabs">
        {HERRAMIENTAS.map((una) => (
          <button
            key={una.id}
            type="button"
            className={`tab${herramienta === una.id ? ' active' : ''}`}
            onClick={() => setHerramienta(una.id)}
            aria-pressed={herramienta === una.id}
          >
            {una.label}
          </button>
        ))}
      </div>

      {error && <div className="notice notice-error">✕ {error}</div>}
      {cargandoCatalogo && <div className="page-hint">Leyendo las áreas del tenant…</div>}

      {!listo && !cargandoCatalogo && (
        <div className="notice notice-info">
          Elegí el tenant, el área de planificación y la versión. Nada se elige solo cuando hay más de
          una opción: contra cuál de tus tenants corre un análisis no es algo que deba adivinarse.
        </div>
      )}

      {/* La clave fuerza a empezar de cero al cambiar de destino: lo detectado y lo corregido son de
          ese tenant, esa área y esa versión. */}
      {listo && herramienta === 'origen' && (
        <Suspense fallback={<div className="page-hint">Cargando…</div>}>
          <ExplorerSetup
            key={`${conexionId}|${area}|${version}`}
            destino={{ connectionId: conexionId, planningArea: area, versionId: versionParaSap(version) }}
          />
        </Suspense>
      )}
      {listo && herramienta === 'descarga' && (
        <Suspense fallback={<div className="page-hint">Cargando…</div>}>
          <ExplorerExtract
            key={`${conexionId}|${area}|${version}`}
            destino={{ connectionId: conexionId, planningArea: area, versionId: versionParaSap(version) }}
          />
        </Suspense>
      )}
      {/* El árbol trabaja sobre lo DESCARGADO, no contra SAP: no necesita el destino, solo la clave
          para empezar de cero si se cambió de tenant. */}
      {listo && herramienta === 'arbol' && (
        <Suspense fallback={<div className="page-hint">Cargando el árbol…</div>}>
          <BomTree key={`${conexionId}|${area}|${version}`} />
        </Suspense>
      )}
      {listo && herramienta === 'red' && (
        <Suspense fallback={<div className="page-hint">Cargando la red…</div>}>
          <SupplyNetwork
            key={`${conexionId}|${area}|${version}`}
            destino={{ connectionId: conexionId, planningArea: area, versionId: versionParaSap(version) }}
          />
        </Suspense>
      )}
      {/* La clasificación de tipos se guarda por área, así que el área baja como prop. */}
      {/* El documentador NO trabaja sobre lo descargado: recibe los CSV de la configuración del área,
          que SAP no expone por API. Lo único que lee en vivo son los trabajos del tenant. */}
      {/* El glosario no depende del tenant ni de lo descargado: explica los informes. */}
      {listo && herramienta === 'glosario' && (
        <Suspense fallback={<div className="page-hint">Cargando…</div>}>
          <Glosario />
        </Suspense>
      )}
      {listo && herramienta === 'documentar' && (
        <Suspense fallback={<div className="page-hint">Cargando el documentador…</div>}>
          <PlanningAreaDoc
            key={`${conexionId}|${area}|${version}`}
            conexionId={conexionId}
            tenant={conexion?.name ?? ''}
            area={area}
          />
        </Suspense>
      )}
      {listo && herramienta === 'calidad' && (
        <Suspense fallback={<div className="page-hint">Cargando el analizador…</div>}>
          <ProductionAnalyzer key={`${conexionId}|${area}|${version}`} area={area} />
        </Suspense>
      )}
    </div>
  )
}
