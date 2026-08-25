// El módulo IBP Tools: elegir el tenant y moverse entre sus herramientas.
//
// Equivale a `SystemView.jsx` de v8, sin lo que la Fase 1 ya reemplazó: el diálogo para
// identificarse contra SAP, la barra lateral y la pantalla de conexiones.
//
// En v8 las pestañas aparecían según qué acuerdo de comunicación tuviera configurada la conexión.
// Esa idea se conserva —una pestaña que no puede funcionar es peor que una pestaña ausente— pero se
// resolverá cuando estén portadas las que faltan. Las de trabajos usan `SAP_COM_0326` y Recursos
// `SAP_COM_0068`, que son acuerdos distintos con su propio usuario de SAP.

import { lazy, Suspense, useEffect, useState } from 'react'

import { readStoredTzMode } from '../../lib/dates.js'
import { puedeSalir } from '../../lib/guarda-de-salida.js'
import { listIbpConnections } from '../../lib/ibp.js'
import { etiquetaDeConexion } from '../../lib/nombre-de-conexion.js'
import { lectorDeIbp } from '../../lib/run-logs.js'

const GlobalSummary = lazy(() => import('./GlobalSummary.jsx'))
const Resumen = lazy(() => import('./Resumen.jsx'))
const JobMonitor = lazy(() => import('./JobMonitor.jsx'))
const JobTemplates = lazy(() => import('./JobTemplates.jsx'))
const ResourceStats = lazy(() => import('./ResourceStats.jsx'))
const Metering = lazy(() => import('./Metering.jsx'))
const MasterDataViewer = lazy(() => import('./MasterDataViewer.jsx'))
const PlanningDataViewer = lazy(() => import('./PlanningDataViewer.jsx'))
const MigrationPlan = lazy(() => import('./MigrationPlan.jsx'))
const KfMigration = lazy(() => import('./KfMigration.jsx'))

// La pantalla de orquestaciones es la MISMA que la de CI-DS: encadenar tareas y encadenar trabajos
// son la misma cosa por dentro, y lo único que cambia es de dónde salen los pasos. Por eso se le
// pasa la paleta y no se escribe otra pantalla.
const Orchestrations = lazy(() => import('../cids/orchestrations/Orchestrations.jsx'))
const JobPalette = lazy(() => import('./JobPalette.jsx'))

const HERRAMIENTAS = [
  // El tablero global mira TODOS los tenants, así que el selector no le aplica. Con uno solo
  // repetiría el tablero de al lado, y por eso solo aparece cuando hay varios.
  { id: 'global', label: 'Global', soloConVarios: true },
  { id: 'resumen', label: 'Resumen' },
  { id: 'monitor', label: 'Monitor de trabajos' },
  { id: 'plantillas', label: 'Trabajos' },
  { id: 'recursos', label: 'Recursos' },
  { id: 'consumo', label: 'Consumo' },
  { id: 'datos', label: 'Dato maestro' },
  { id: 'cifras', label: 'Cifras clave' },
  // La migración mira DOS tenants a la vez, asi que el selector de arriba no le aplica.
  { id: 'migracion', label: 'Migración', sinTenant: true },
  // Tambien mira DOS tenants a la vez.
  { id: 'cifras-mig', label: 'Migrar cifras', sinTenant: true },
  { id: 'orquestaciones', label: 'Orquestaciones' },
]

export default function IbpTools() {
  const [conexiones, setConexiones] = useState(null)
  const [elegida, setElegida] = useState('')
  const [error, setError] = useState('')
  const [herramienta, setHerramienta] = useState('resumen')

  useEffect(() => {
    let abandonado = false
    listIbpConnections()
      .then((lista) => {
        if (abandonado) return
        setConexiones(lista)
        if (lista.length > 0) setElegida(lista[0].id)
      })
      .catch((fallo) => {
        if (abandonado) return
        setError(fallo.message)
        setConexiones([])
      })
    return () => { abandonado = true }
  }, [])

  if (conexiones === null) return <div className="page-hint">Cargando conexiones…</div>
  if (error) return <div className="notice notice-error">✕ {error}</div>

  if (conexiones.length === 0) {
    return (
      <div className="notice notice-info">
        No hay ninguna conexión a SAP IBP configurada para tu empresa. Pedile a quien administra la
        cuenta que la dé de alta en Administración → Conexiones.
      </div>
    )
  }

  const conexion = conexiones.find((una) => una.id === elegida) ?? null

  return (
    <div className="module-page">
      <div className="module-head">
        <div>
          <div className="page-title">IBP Tools</div>
          <div className="page-hint">
            {herramienta === 'global' ? 'Todos los tenants de IBP a la vez.'
              : herramienta === 'recursos' ? 'Cuánta CPU y memoria consume el tenant elegido.'
                : herramienta === 'consumo' ? 'Quién usa el tenant elegido, con qué y cuánto.'
                  : herramienta === 'datos' ? 'El dato maestro del tenant elegido: mirarlo y, si hace falta, corregirlo.'
                    : herramienta === 'cifras' ? 'Las cifras clave del tenant elegido, de solo lectura.'
                      : herramienta === 'migracion' ? 'Que se copiaria de un tenant a otro, antes de copiar nada.'
                        : herramienta === 'cifras-mig' ? 'Copiar cifras clave de un tenant a otro.'
                        : herramienta === 'orquestaciones' ? 'Encadenar trabajos del tenant elegido con sus dependencias.'
                : 'Los Application Jobs del tenant elegido.'}
          </div>
        </div>

        {herramienta !== 'global' && !HERRAMIENTAS.find((una) => una.id === herramienta)?.sinTenant && (
        <div className="monitor-bar">
          <select
            className="select input-sm"
            value={elegida}
            onChange={(evento) => setElegida(evento.target.value)}
            aria-label="Tenant de IBP"
          >
            {conexiones.map((una) => (
              <option key={una.id} value={una.id}>{etiquetaDeConexion(una)}</option>
            ))}
          </select>
          {conexion?.isProduction && <span className="tag tag-accent">Productivo</span>}
        </div>
        )}
      </div>

      {/* Cambiar de pestaña corta una copia en marcha, porque la cadena de segmentos la lleva esta
          pantalla y no el servidor. Ver `guarda-de-salida.js`. */}
      <div className="tabs">
        {HERRAMIENTAS.filter((una) => !una.soloConVarios || conexiones.length > 1).map((una) => (
          <button
            key={una.id}
            type="button"
            className={`tab${herramienta === una.id ? ' active' : ''}`}
            onClick={() => { if (puedeSalir()) setHerramienta(una.id) }}
            aria-pressed={herramienta === una.id}
          >
            {una.label}
          </button>
        ))}
      </div>

      {/* La clave fuerza a empezar de cero al cambiar de tenant: el rango, los filtros y la fila
          elegida son del tenant que se estaba mirando. */}
      {herramienta === 'global' && (
        <Suspense fallback={<div className="page-hint">Cargando el tablero…</div>}>
          <GlobalSummary />
        </Suspense>
      )}
      {herramienta === 'resumen' && conexion && (
        <Suspense fallback={<div className="page-hint">Cargando el tablero…</div>}>
          <Resumen key={conexion.id} conexionId={conexion.id} />
        </Suspense>
      )}
      {herramienta === 'monitor' && conexion && (
        <Suspense fallback={<div className="page-hint">Cargando el monitor…</div>}>
          <JobMonitor key={conexion.id} conexionId={conexion.id} />
        </Suspense>
      )}
      {herramienta === 'recursos' && conexion && (
        <Suspense fallback={<div className="page-hint">Cargando el consumo…</div>}>
          <ResourceStats key={conexion.id} conexionId={conexion.id} />
        </Suspense>
      )}
      {herramienta === 'consumo' && conexion && (
        <Suspense fallback={<div className="page-hint">Cargando el consumo…</div>}>
          <Metering key={conexion.id} conexionId={conexion.id} />
        </Suspense>
      )}
      {herramienta === 'datos' && conexion && (
        <Suspense fallback={<div className="page-hint">Cargando el visor…</div>}>
          {/* El nombre y la marca de productivo bajan a la pantalla porque desde ahí se escribe: la
              confirmación tiene que decir en qué tenant se va a escribir, no solo qué tabla. */}
          <MasterDataViewer
            key={conexion.id}
            conexionId={conexion.id}
            tenant={conexion.name}
            productivo={Boolean(conexion.isProduction)}
          />
        </Suspense>
      )}
      {herramienta === 'cifras' && conexion && (
        <Suspense fallback={<div className="page-hint">Cargando el visor…</div>}>
          <PlanningDataViewer key={conexion.id} conexionId={conexion.id} />
        </Suspense>
      )}
      {herramienta === 'migracion' && (
        <Suspense fallback={<div className="page-hint">Cargando la migracion…</div>}>
          <MigrationPlan />
        </Suspense>
      )}
      {herramienta === 'orquestaciones' && conexion && (
        <Suspense fallback={<div className="page-hint">Cargando las orquestaciones…</div>}>
          {/* Un tenant de IBP no tiene dos repositorios como CI-DS, asi que `production` va fijo en
              falso: es una sola cosa y no hay nada que elegir. */}
          <Orchestrations
            key={conexion.id}
            destino={{ connectionId: conexion.id, production: false }}
            Paleta={JobPalette}
            leerRegistro={lectorDeIbp(conexion.id)}
          />
        </Suspense>
      )}
      {herramienta === 'cifras-mig' && (
        <Suspense fallback={<div className="page-hint">Cargando…</div>}>
          <KfMigration />
        </Suspense>
      )}
      {herramienta === 'plantillas' && conexion && (
        <Suspense fallback={<div className="page-hint">Cargando las plantillas…</div>}>
          <JobTemplates key={conexion.id} conexionId={conexion.id} zona={readStoredTzMode()} />
        </Suspense>
      )}
    </div>
  )
}
