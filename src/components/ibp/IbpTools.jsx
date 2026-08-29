// El módulo IBP Tools: las pestañas de v8, con sus nombres, su orden y su condición.
//
// Portado de `System/SystemView.jsx` de v8, sin lo que la Fase 1 ya reemplazó: el diálogo para
// identificarse contra SAP y la pantalla de conexiones.
//
// Tres cosas de v8 que estaban perdidas y vuelven:
//
//   - LOS NOMBRES Y EL ORDEN. «Job Templates», «Job Monitor», «Orquestador», «Resource Stats»,
//     «Telemetría», «Ver Dato Maestro», «Ver Dato Transaccional» — tal cual, y en su orden. Se habían
//     traducido y reordenado; son los nombres que el cliente lleva años viendo.
//   - LA CONDICIÓN. Una pestaña solo existe si la conexión tiene su acuerdo de comunicación. Sin
//     `SAP_COM_0068` no hay «Resource Stats». Una pestaña que al abrirse falla con un 403 es peor que
//     una pestaña ausente, porque parece un fallo de la herramienta.
//   - LA MIGRACIÓN ES UNA SOLA PESTAÑA con dos modos, no dos pestañas. Ver `MigrationTabs.jsx`.
//
// Y en vez del desplegable de un solo tenant, la TIRA DE PESTAÑAS de conexiones de v9: varios tenants
// abiertos a la vez. En v8 los tenants colgaban del menú lateral, que aquí lista los tres módulos de
// la suite; la tira es el sitio equivalente y es de donde v9 la sacaba.

import { lazy, Suspense, useEffect, useState } from 'react'

import { readStoredTzMode } from '../../lib/dates.js'
import { puedeSalir } from '../../lib/guarda-de-salida.js'
import { listIbpConnections } from '../../lib/ibp.js'
import { lectorDeIbp } from '../../lib/run-logs.js'
import { abrir, abrirLasGuardadas, cerrar, guardarAbiertas } from '../../lib/pestanas-de-conexion.js'
import ConnectionTabs from '../ui/ConnectionTabs.jsx'
import CabeceraDeConexion from '../ui/CabeceraDeConexion.jsx'

const GlobalSummary = lazy(() => import('./GlobalSummary.jsx'))
const Resumen = lazy(() => import('./Resumen.jsx'))
const JobMonitor = lazy(() => import('./JobMonitor.jsx'))
const JobTemplates = lazy(() => import('./JobTemplates.jsx'))
const ResourceStats = lazy(() => import('./ResourceStats.jsx'))
const Metering = lazy(() => import('./Metering.jsx'))
const MasterDataViewer = lazy(() => import('./MasterDataViewer.jsx'))
const PlanningDataViewer = lazy(() => import('./PlanningDataViewer.jsx'))
const MigrationTabs = lazy(() => import('./MigrationTabs.jsx'))

// La pantalla de orquestaciones es la MISMA que la de CI-DS: encadenar tareas y encadenar trabajos
// son la misma cosa por dentro, y lo único que cambia es de dónde salen los pasos. Por eso se le
// pasa la paleta y no se escribe otra pantalla.
const Orchestrations = lazy(() => import('../cids/orchestrations/Orchestrations.jsx'))
const JobPalette = lazy(() => import('./JobPalette.jsx'))

/**
 * Las pestañas de v8, en su orden y con el acuerdo que cada una necesita.
 *
 * `acuerdo` es el `SAP_COM_xxxx` sin el cual la pestaña no puede funcionar; `sinTenant` marca las que
 * no miran un tenant concreto.
 */
const HERRAMIENTAS = [
  // El tablero global mira TODOS los tenants. En v8 era una entrada del menú lateral («Resumen
  // Global»); aquí el menú es de módulos, así que va como primera pestaña. Con un solo tenant
  // repetiría el resumen de al lado, y por eso solo aparece cuando hay varios.
  { id: 'global', label: 'Resumen Global', soloConVarios: true, sinTenant: true },
  { id: 'resumen', label: 'Resumen', acuerdo: 'SAP_COM_0326' },
  { id: 'plantillas', label: 'Job Templates', acuerdo: 'SAP_COM_0326' },
  { id: 'monitor', label: 'Job Monitor', acuerdo: 'SAP_COM_0326' },
  { id: 'orquestaciones', label: 'Orquestador', acuerdo: 'SAP_COM_0326' },
  { id: 'recursos', label: 'Resource Stats', acuerdo: 'SAP_COM_0068' },
  { id: 'consumo', label: 'Telemetría', acuerdo: 'SAP_COM_0924' },
  // La migración mira DOS tenants a la vez: el de la pestaña y el que se elija como origen.
  { id: 'migracion', label: 'Migración', acuerdo: 'SAP_COM_0720' },
  { id: 'datos', label: 'Ver Dato Maestro', acuerdo: 'SAP_COM_0720' },
  { id: 'cifras', label: 'Ver Dato Transaccional', acuerdo: 'SAP_COM_0720' },
]

/** Qué se explica debajo del nombre de cada pestaña. */
const QUE_HACE = {
  global: 'Todos los tenants de IBP a la vez.',
  resumen: 'Cómo viene el tenant: trabajos del período, fallos y tendencia.',
  plantillas: 'Los Application Jobs configurados en el tenant.',
  monitor: 'Las ejecuciones de trabajos: seguirlas, cancelarlas y reiniciarlas.',
  orquestaciones: 'Encadenar trabajos del tenant con sus dependencias.',
  recursos: 'Cuánta CPU y memoria consume el tenant.',
  consumo: 'Quién usa el tenant, con qué y cuánto.',
  migracion: 'Copiar dato maestro o cifras clave de otro tenant a este.',
  datos: 'El dato maestro del tenant: mirarlo y, si hace falta, corregirlo.',
  cifras: 'Las cifras clave del tenant, de solo lectura.',
}

export default function IbpTools() {
  const [conexiones, setConexiones] = useState(null)
  const [abiertas, setAbiertas] = useState([])
  const [elegida, setElegida] = useState('')
  const [error, setError] = useState('')
  const [herramienta, setHerramienta] = useState('resumen')

  useEffect(() => {
    let abandonado = false
    listIbpConnections()
      .then((lista) => {
        if (abandonado) return
        setConexiones(lista)
        const iniciales = abrirLasGuardadas('ibp', lista)
        setAbiertas(iniciales)
        setElegida(iniciales[0] ?? '')
      })
      .catch((fallo) => {
        if (abandonado) return
        setError(fallo.message)
        setConexiones([])
      })
    return () => { abandonado = true }
  }, [])

  function elegir(id) {
    if (!puedeSalir()) return
    setAbiertas((previas) => {
      const siguientes = abrir(previas, id)
      guardarAbiertas('ibp', siguientes)
      return siguientes
    })
    setElegida(id)
  }

  function cerrarPestana(id) {
    if (!puedeSalir()) return
    const salida = cerrar(abiertas, elegida, id)
    guardarAbiertas('ibp', salida.abiertas)
    setAbiertas(salida.abiertas)
    setElegida(salida.activa)
  }

  if (conexiones === null) return <div className="page-hint">Cargando conexiones…</div>
  if (error) return <div className="notice notice-error">✕ {error}</div>

  if (conexiones.length === 0) {
    return (
      <div className="notice notice-info">
        No hay ninguna conexión a SAP IBP configurada para tu empresa. Pídele a quien administra la
        cuenta que la dé de alta en Administración → Conexiones.
      </div>
    )
  }

  const conexion = conexiones.find((una) => una.id === elegida) ?? null
  const acuerdos = new Set(conexion?.agreements ?? [])

  // La condición de v8: una pestaña existe si su acuerdo está configurado. Cuando la conexión no
  // declara ninguno —una alta a medias— se enseñan todas, que es mejor que dejar el módulo vacío.
  const sinAcuerdosDeclarados = acuerdos.size === 0
  const visibles = HERRAMIENTAS
    .filter((una) => !una.soloConVarios || conexiones.length > 1)
    .filter((una) => !una.acuerdo || sinAcuerdosDeclarados || acuerdos.has(una.acuerdo))

  // La pestaña abierta puede haber dejado de existir al cambiar de tenant.
  const activa = visibles.some((una) => una.id === herramienta) ? herramienta : visibles[0]?.id
  const suya = HERRAMIENTAS.find((una) => una.id === activa)

  return (
    <div className="module-page">
      {/* ── La tira de pestañas de conexiones, como en v9 ─────────────────────────────────────── */}
      <ConnectionTabs
        conexiones={conexiones}
        abiertas={abiertas}
        activa={elegida}
        onElegir={elegir}
        onCerrar={cerrarPestana}
      />

      {/* ── La cabecera de la conexión, como en v8 ───────────────────────────────────────────── */}
      {conexion && !suya?.sinTenant && <CabeceraDeConexion conexion={conexion} />}

      <div className="module-head">
        <div>
          <div className="page-title">{suya?.label ?? 'IBP Tools'}</div>
          <div className="page-hint">{QUE_HACE[activa] ?? ''}</div>
        </div>
      </div>

      {/* Cambiar de pestaña corta una copia en marcha, porque la cadena de segmentos la lleva esta
          pantalla y no el servidor. Ver `guarda-de-salida.js`. */}
      <div className="tabs">
        {visibles.map((una) => (
          <button
            key={una.id}
            type="button"
            className={`tab${activa === una.id ? ' active' : ''}`}
            onClick={() => { if (puedeSalir()) setHerramienta(una.id) }}
            aria-pressed={activa === una.id}
          >
            {una.label}
          </button>
        ))}
      </div>

      {visibles.length === 0 && (
        <div className="notice notice-info">
          Esta conexión no tiene acuerdos de comunicación configurados. Pídele a quien administra la
          cuenta que agregue al menos <b>SAP_COM_0326</b> o <b>SAP_COM_0720</b> en
          Administración → Conexiones.
        </div>
      )}

      {/* La clave fuerza a empezar de cero al cambiar de tenant: el rango, los filtros y la fila
          elegida son del tenant que se estaba mirando. */}
      {activa === 'global' && (
        <Suspense fallback={<div className="page-hint">Cargando el tablero…</div>}>
          <GlobalSummary />
        </Suspense>
      )}
      {activa === 'resumen' && conexion && (
        <Suspense fallback={<div className="page-hint">Cargando el tablero…</div>}>
          <Resumen key={conexion.id} conexionId={conexion.id} />
        </Suspense>
      )}
      {activa === 'plantillas' && conexion && (
        <Suspense fallback={<div className="page-hint">Cargando las plantillas…</div>}>
          <JobTemplates key={conexion.id} conexionId={conexion.id} zona={readStoredTzMode()} />
        </Suspense>
      )}
      {activa === 'monitor' && conexion && (
        <Suspense fallback={<div className="page-hint">Cargando el monitor…</div>}>
          <JobMonitor key={conexion.id} conexionId={conexion.id} />
        </Suspense>
      )}
      {activa === 'orquestaciones' && conexion && (
        <Suspense fallback={<div className="page-hint">Cargando las orquestaciones…</div>}>
          {/* Un tenant de IBP no tiene dos repositorios como CI-DS, así que `production` va fijo en
              falso: es una sola cosa y no hay nada que elegir. */}
          <Orchestrations
            key={conexion.id}
            destino={{ connectionId: conexion.id, production: false }}
            Paleta={JobPalette}
            leerRegistro={lectorDeIbp(conexion.id)}
          />
        </Suspense>
      )}
      {activa === 'recursos' && conexion && (
        <Suspense fallback={<div className="page-hint">Cargando el consumo…</div>}>
          <ResourceStats key={conexion.id} conexionId={conexion.id} />
        </Suspense>
      )}
      {activa === 'consumo' && conexion && (
        <Suspense fallback={<div className="page-hint">Cargando el consumo…</div>}>
          <Metering key={conexion.id} conexionId={conexion.id} />
        </Suspense>
      )}
      {activa === 'migracion' && (
        <Suspense fallback={<div className="page-hint">Cargando la migración…</div>}>
          <MigrationTabs />
        </Suspense>
      )}
      {activa === 'datos' && conexion && (
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
      {activa === 'cifras' && conexion && (
        <Suspense fallback={<div className="page-hint">Cargando el visor…</div>}>
          <PlanningDataViewer key={conexion.id} conexionId={conexion.id} />
        </Suspense>
      )}
    </div>
  )
}
