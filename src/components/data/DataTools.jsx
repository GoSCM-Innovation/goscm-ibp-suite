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

const ExplorerSetup = lazy(() => import('./ExplorerSetup.jsx'))

const HERRAMIENTAS = [
  { id: 'origen', label: 'Origen de los datos' },
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

  // La versión se DERIVA: al cambiar de área, la que estaba puesta casi nunca existe en la nueva.
  // Solo se auto-elige si el área tiene una sola.
  const version = versiones.some((una) => una.id === versionId)
    ? versionId
    : unicaOpcion(versiones.map((una) => una.id))

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
                disabled={versiones.length === 0}
              >
                <option value="">Elegí una versión…</option>
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
            destino={{ connectionId: conexionId, planningArea: area, versionId: version }}
          />
        </Suspense>
      )}
    </div>
  )
}
