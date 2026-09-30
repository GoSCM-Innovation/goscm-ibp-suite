// El módulo IBP Tools: la vista de un sistema de v8, con sus pestañas, sus nombres, su orden y su
// condición.
//
// Portado de `System/SystemView.jsx` y de la navegación de `App.jsx` de v8, sin lo que la Fase 1 ya
// reemplazó: el diálogo para identificarse contra SAP y la pantalla de conexiones.
//
// Lo que se conserva de v8, tal cual:
//
//   - LA CABECERA de la conexión, de lado a lado, y debajo LA BARRA DE PESTAÑAS. Nada entre las dos.
//   - LOS NOMBRES Y EL ORDEN de las pestañas: «Resumen», «Job Templates», «Job Monitor»,
//     «Orquestador», «Resource Stats», «Telemetría», «Migración», «Ver Dato Maestro», «Ver Dato
//     Transaccional».
//   - LA CONDICIÓN. Una pestaña solo existe si la conexión tiene su acuerdo de comunicación. Sin
//     ninguno, el aviso de v8 en lugar de pestañas.
//   - LOS VISORES SE QUEDAN MONTADOS una vez abiertos, así que ir a otra pestaña y volver conserva
//     sus pestañas, la página cargada y los cambios sin guardar.
//   - CADA CONEXIÓN EMPIEZA DE CERO. v8 montaba la vista del sistema con la conexión como clave.
//
// Lo que cambia, y por qué: en v8 los tenants colgaban del menú lateral, junto a «Conexiones» y
// «📊 Resumen». Aquí el menú lista los módulos de la suite, así que los tenants van en la TIRA de
// conexiones de v9 y el «📊 Resumen» global va como la primera pestaña fija de esa tira: sigue
// estando al lado de las conexiones y fuera de cualquiera de ellas, como en v8.

import { lazy, Suspense, useEffect, useState } from 'react'

import { readStoredTzMode } from '../../lib/dates.js'
import { puedeSalir } from '../../lib/guarda-de-salida.js'
import { listIbpConnections } from '../../lib/ibp.js'
import { lectorDeIbp } from '../../lib/run-logs.js'
import { abrir, abrirLasGuardadas, cerrar, guardarAbiertas } from '../../lib/pestanas-de-conexion.js'
import { useIsMobile } from '../../lib/useIsMobile.js'
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
const VisorConPestanas = lazy(() => import('./VisorConPestanas.jsx'))

// La pantalla de orquestaciones es la MISMA que la de CI-DS: encadenar tareas y encadenar trabajos
// son la misma cosa por dentro, y lo único que cambia es de dónde salen los pasos.
const Orchestrations = lazy(() => import('../cids/orchestrations/Orchestrations.jsx'))
const JobPalette = lazy(() => import('./JobPalette.jsx'))

/** Las pestañas de v8, en su orden y con el acuerdo que cada una necesita. */
const APPS = [
  { id: 'resumen', label: 'Resumen', acuerdo: 'SAP_COM_0326' },
  { id: 'jobs', label: 'Job Templates', acuerdo: 'SAP_COM_0326' },
  { id: 'monitor', label: 'Job Monitor', acuerdo: 'SAP_COM_0326' },
  { id: 'orquestador', label: 'Orquestador', acuerdo: 'SAP_COM_0326' },
  { id: 'stats', label: 'Resource Stats', acuerdo: 'SAP_COM_0068' },
  { id: 'metering', label: 'Telemetría', acuerdo: 'SAP_COM_0924' },
  { id: 'migration', label: 'Migración', acuerdo: 'SAP_COM_0720' },
  { id: 'viewMaster', label: 'Ver Dato Maestro', acuerdo: 'SAP_COM_0720' },
  { id: 'viewTrans', label: 'Ver Dato Transaccional', acuerdo: 'SAP_COM_0720' },
]

const cargando = texto => (
  <div style={{ padding: 48, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>{texto}</div>
)

/** La vista de UNA conexión: su cabecera, sus pestañas y lo que hay en cada una. */
function SystemView({ connection }) {
  const isMobile = useIsMobile()
  const acuerdos = new Set(connection.agreements ?? [])
  const apps = APPS.filter(app => acuerdos.has(app.acuerdo))

  const [activeApp, setActiveApp] = useState(apps[0]?.id || null)
  // Los visores de datos se quedan montados una vez visitados: al volver conservan lo suyo.
  const [visited, setVisited] = useState(() => (activeApp ? { [activeApp]: true } : {}))

  // Salir de la migración corta la copia en marcha: se confirma antes. Ver `guarda-de-salida.js`.
  function selectApp(id) {
    if (id === activeApp) return
    if (!puedeSalir()) return
    setVisited(v => (v[id] ? v : { ...v, [id]: true }))
    setActiveApp(id)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <CabeceraDeConexion conexion={connection} />

      {apps.length > 0 && (
        <div className="tab-bar" style={{
          display: 'flex', gap: 0, borderBottom: '1px solid var(--border)',
          background: 'var(--bg2)', padding: isMobile ? '0 12px' : '0 24px', flexShrink: 0,
        }}>
          {apps.map(app => (
            <button key={app.id} type="button" onClick={() => selectApp(app.id)} style={{
              padding: isMobile ? '10px 14px' : '10px 20px',
              fontSize: 12, background: 'none', border: 'none',
              borderBottom: activeApp === app.id ? '2px solid var(--accent)' : '2px solid transparent',
              color: activeApp === app.id ? 'var(--text)' : 'var(--text2)',
              fontWeight: activeApp === app.id ? 600 : 400,
              cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap', flexShrink: 0,
            }}>{app.label}</button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {apps.length === 0 && (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
            Esta conexión no tiene acuerdos de comunicación configurados.<br />
            Ve a Administración → Conexiones para agregar SAP_COM_0326 o SAP_COM_0068.
          </div>
        )}
        <Suspense fallback={cargando('Cargando…')}>
          {activeApp === 'resumen' && <Resumen connection={connection} />}
          {activeApp === 'jobs' && <JobTemplates connection={connection} conexionId={connection.id} zona={readStoredTzMode()} />}
          {activeApp === 'monitor' && <JobMonitor connection={connection} conexionId={connection.id} />}
          {activeApp === 'orquestador' && (
            // Un tenant de IBP no tiene dos repositorios como CI-DS: `production` va fijo en falso.
            <Orchestrations
              destino={{ connectionId: connection.id, production: false }}
              Paleta={JobPalette}
              leerRegistro={lectorDeIbp(connection.id)}
            />
          )}
          {activeApp === 'stats' && <ResourceStats connection={connection} conexionId={connection.id} />}
          {activeApp === 'metering' && <Metering connection={connection} conexionId={connection.id} />}
          {activeApp === 'migration' && <MigrationTabs connection={connection} />}
          {/* Los visores: cada uno lleva su propia tira de pestañas y se quedan montados una vez
              visitados, así que sus pestañas y los datos cargados sobreviven a cambiar de pestaña. */}
          {visited.viewMaster && (
            <div style={{ display: activeApp === 'viewMaster' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <VisorConPestanas
                connectionId={connection.id}
                kind="master"
                renderTab={(tab, p) => (
                  <MasterDataViewer connectionId={connection.id} initial={tab.def} {...p} />
                )}
              />
            </div>
          )}
          {visited.viewTrans && (
            <div style={{ display: activeApp === 'viewTrans' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <VisorConPestanas
                connectionId={connection.id}
                kind="trans"
                renderTab={(tab, p) => (
                  <PlanningDataViewer connection={connection} connectionId={connection.id} initial={tab.def} {...p} />
                )}
              />
            </div>
          )}
        </Suspense>
      </div>
    </div>
  )
}

export default function IbpTools() {
  const [conexiones, setConexiones] = useState(null)
  const [abiertas, setAbiertas] = useState([])
  const [elegida, setElegida] = useState('')
  const [global, setGlobal] = useState(false)
  const [error, setError] = useState('')

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
    setGlobal(false)
  }

  function cerrarPestana(id) {
    if (!puedeSalir()) return
    const salida = cerrar(abiertas, elegida, id)
    guardarAbiertas('ibp', salida.abiertas)
    setAbiertas(salida.abiertas)
    setElegida(salida.activa)
  }

  function verResumenGlobal() {
    if (global || !puedeSalir()) return
    setGlobal(true)
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

  return (
    <div className="module-page ibp-tools">
      <ConnectionTabs
        conexiones={conexiones}
        abiertas={abiertas}
        activa={elegida}
        onElegir={elegir}
        onCerrar={cerrarPestana}
        inicio={{ icono: '📊', nombre: 'Resumen', activa: global, onElegir: verResumenGlobal }}
      />

      {global && (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <Suspense fallback={cargando('Cargando…')}>
            <GlobalSummary connections={conexiones} />
          </Suspense>
        </div>
      )}
      {!global && conexion && <SystemView key={conexion.id} connection={conexion} />}
    </div>
  )
}
