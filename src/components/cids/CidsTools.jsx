// El módulo CI-DS Tools: elegir el destino y moverse entre sus herramientas.
//
// Equivale a `SystemView.jsx` de v9, sin dos cosas que allí ocupaban la mitad del archivo: el
// diálogo para identificarse contra SAP y el aviso de "sesión vencida". Las dos desaparecen porque
// la sesión vive en el servidor y se renueva sola cuando SAP la rechaza.
//
// Lo que se elige no es una conexión, es un DESTINO: una conexión y uno de sus dos repositorios. En
// CI-DS la misma conexión da acceso al de pruebas y al productivo —lo decide una bandera del logon—,
// así que dar de alta una conexión ya habilita los dos y no hay nada que configurar por separado.

import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { cidsTargets, fetchPromotedTaskNames, listCidsConnections, promotedForTarget } from '../../lib/cids.js'
import TaskMonitor from './TaskMonitor.jsx'
import TaskLauncher from './TaskLauncher.jsx'
import { lectorDeCids } from '../../lib/run-logs.js'
import ConnectionTabs from '../ui/ConnectionTabs.jsx'

// Los tableros se cargan aparte, solo al abrir su pestaña. Son los únicos que usan la librería de
// gráficos, y esa librería pesa más que todo el resto de la aplicación junta: dejarla en el paquete
// principal se la haría descargar hasta a quien solo entra a ver el monitor.
const Summary = lazy(() => import('./Summary.jsx'))
const GlobalSummary = lazy(() => import('./GlobalSummary.jsx'))

// El explorador trabaja sobre archivos del equipo, no contra SAP. Se carga aparte porque arrastra el
// lector de ZIP, que no hace falta para nada más.
// Perezoso como sus hermanos, y no por simetría: `IbpTools` ya lo cargaba así, y tenerlo aquí como
// import directo anulaba ese perezoso —lo avisaba el build en cada compilación— y metía el módulo
// de orquestaciones en el paquete principal de TODOS, incluido quien solo tiene IBP contratado.
const Orchestrations = lazy(() => import('./orchestrations/Orchestrations.jsx'))
const IntegrationExplorer = lazy(() => import('./explorer/IntegrationExplorer.jsx'))
const MappingDocumenter = lazy(() => import('./documenter/MappingDocumenter.jsx'))

// Los nombres y el orden son los de v9, tal cual: «Projects & Tasks» antes que «Task Monitor», y
// «Integration Explorer» y «Mapping Dataflow Generator» con su nombre. Se habían traducido y
// reordenado; son los nombres que el cliente lleva años viendo.
//
// Las dos últimas eran entradas del menú lateral en v9 y no pestañas de una conexión, porque no miran
// ningún repositorio: leen los ZIP del equipo. Aquí el menú lateral es de módulos, así que van como
// pestañas.
//
// El tablero global mira TODOS los destinos, así que el selector no le aplica. Solo aparece cuando
// hay más de uno, que con CI-DS es siempre —cada conexión rinde pruebas y productivo—, pero la
// condición queda escrita para que se lea el motivo.
const HERRAMIENTAS = [
  { id: 'global', label: 'Resumen Global', soloConVarios: true },
  { id: 'resumen', label: 'Resumen' },
  { id: 'tareas', label: 'Projects & Tasks' },
  { id: 'monitor', label: 'Task Monitor' },
  { id: 'orquestaciones', label: 'Orquestaciones' },
  // El orden del menú lateral de v9: primero el Mapping Dataflow Generator y después el Integration Explorer.
  { id: 'documentador', label: 'Mapping Dataflow Generator' },
  { id: 'explorador', label: 'Integration Explorer' },
]

/**
 * Lo que lleva la pestaña activa: lo que v9 pintaba en la franja bajo la tira, dirección,
 * organización y ambiente.
 */
function detalleDeCids(pestana) {
  return {
    titulo: pestana.avatar,
    filas: [
      ['Dirección', pestana.baseUrl],
      ['Organización', pestana.organization],
      ['Ambiente', pestana.isProduction ? 'Producción' : 'Sandbox'],
    ].filter(([, valor]) => valor),
    enlace: null,
  }
}

export default function CidsTools() {
  const [conexiones, setConexiones] = useState(null)
  const [elegido, setElegido] = useState('')
  const [error, setError] = useState('')
  const [herramienta, setHerramienta] = useState('resumen')
  // El explorador y el documentador se montan la primera vez que se visitan y desde entonces solo se
  // esconden, como hacía v9 con sus iframes: lo cargado (el ZIP, el análisis, lo generado) sobrevive
  // a mirar otra pestaña, y un documento a medio generar no se interrumpe.
  const [montadas, setMontadas] = useState({ explorador: false, documentador: false })

  // La búsqueda del monitor vive aquí arriba y no dentro del monitor. Es lo que permite que al
  // lanzar una tarea se salte al monitor ya filtrado por ella —lo que hacía v9— sin que el monitor
  // tenga que enterarse de que existe el lanzador.
  const [busqueda, setBusqueda] = useState('')

  // Qué tareas del repositorio de pruebas ya están en el productivo. Se pide una vez por destino y se
  // comparte entre las herramientas que la usan: armarla le cuesta al productivo una consulta por
  // proyecto, así que pedirla por pantalla sería pagarla dos veces.
  //
  // Se guarda junto al destino del que salió, no suelta. Así al cambiar de destino no hay que
  // limpiarla —basta con no usarla— y nunca aparece ni un instante la marca del destino anterior.
  const [transportadas, setTransportadas] = useState(null)

  useEffect(() => {
    listCidsConnections()
      .then((lista) => {
        setConexiones(lista)
        // El primer destino es el repositorio de pruebas de la primera conexión: es donde se trabaja,
        // y entrar por producción sin haberlo pedido sería la peor opción por omisión posible.
        setElegido(lista.length > 0 ? `${lista[0].id}:sandbox` : '')
      })
      .catch((fallo) => { setError(fallo.message); setConexiones([]) })
  }, [])

  // Los destinos se calculan una vez: las pantallas reciben el objeto y lo usan como dependencia de
  // sus efectos, así que tiene que ser la misma referencia entre repintados o recargarían sin parar.
  const destinos = useMemo(() => cidsTargets(conexiones ?? []), [conexiones])
  const destino = destinos.find((uno) => uno.id === elegido) ?? null

  useEffect(() => {
    if (!destino) return undefined
    let abandonado = false
    const guardar = (nombres) => { if (!abandonado) setTransportadas({ destinoId: destino.id, nombres }) }
    fetchPromotedTaskNames(destino)
      .then(guardar)
      // Que falle no rompe nada: es una marca de más, no un dato del que dependa una decisión.
      .catch(() => guardar(null))
    return () => { abandonado = true }
  }, [destino])

  if (conexiones === null) return <div className="page-hint">Cargando conexiones…</div>
  if (error) return <div className="notice notice-error">✕ {error}</div>

  if (conexiones.length === 0) {
    return (
      <div className="notice notice-info">
        No hay ninguna conexión a CI-DS configurada para tu empresa. Pídele a quien administra la
        cuenta que la dé de alta en Administración → Conexiones.
      </div>
    )
  }

  // La regla de qué marca aplica a qué destino vive en la librería y tiene tests: escrita aquí como
  // expresión suelta tenía un caso que reventaba la pantalla entera en el primer pintado.
  const transportadasDelDestino = promotedForTarget(transportadas, destino)

  /**
   * Cambiar de destino suelta la búsqueda del monitor: era del repositorio que se dejó. Desde el
   * tablero global, que no mira ninguno en particular, elegir una pestaña lleva a su Resumen.
   */
  function elegirDestino(id) {
    setBusqueda('')
    setElegido(id)
    if (herramienta === 'global') setHerramienta('resumen')
  }

  /** Salir del monitor también la suelta, como v9, donde vivía dentro del propio monitor. */
  function elegirHerramienta(id) {
    if (herramienta === 'monitor' && id !== 'monitor') setBusqueda('')
    if (id in montadas && !montadas[id]) setMontadas((previas) => ({ ...previas, [id]: true }))
    setHerramienta(id)
  }

  function verEnMonitor(taskName) {
    setBusqueda(taskName)
    setHerramienta('monitor')
  }

  /** Los destinos con la forma que espera la tira: es un repositorio por pestaña, no una conexión. */
  const comoPestanas = destinos.map((uno) => (
    {
      id: uno.id,
      name: uno.label,
      avatar: uno.name,
      isProduction: uno.production,
      baseUrl: uno.baseUrl,
      organization: uno.organization,
    }
  ))

  return (
    <div className="module-page">
      {/* La tira de pestañas de v9: siempre a la vista, también sobre el tablero global y los dos
          módulos que leen ZIP, como allí. */}
      <ConnectionTabs
        conexiones={comoPestanas}
        activa={elegido}
        onElegir={elegirDestino}
        detalleDe={detalleDeCids}
      />

      <div className="module-head">
        <div>
          <div className="page-title">
            {HERRAMIENTAS.find((una) => una.id === herramienta)?.label ?? 'CI-DS Tools'}
          </div>
        </div>

      </div>

      <div className="tabs">
        {HERRAMIENTAS.filter((una) => !una.soloConVarios || destinos.length > 1).map((una) => (
          <button
            key={una.id}
            type="button"
            className={`tab${herramienta === una.id ? ' active' : ''}`}
            onClick={() => elegirHerramienta(una.id)}
            aria-pressed={herramienta === una.id}
          >
            {una.label}
          </button>
        ))}
      </div>

      {/* La clave fuerza a empezar de cero al cambiar de destino: fechas, filtros y proyectos
          abiertos son del repositorio que se estaba mirando, no del usuario.

          Cada herramienta se monta y se desmonta al cambiar de pestaña, igual que en v9. La
          alternativa —dejarlas montadas y solo esconderlas— haría que el monitor y el resumen
          siguieran consultando a SAP en sus relojes mientras miras otra cosa. */}
      {herramienta === 'global' && (
        <Suspense fallback={<div className="page-hint">Cargando el tablero…</div>}>
          <GlobalSummary destinos={destinos} />
        </Suspense>
      )}
      {herramienta === 'resumen' && destino && (
        <Suspense fallback={<div className="page-hint">Cargando el tablero…</div>}>
          <Summary key={`resumen-${destino.id}`} destino={destino} />
        </Suspense>
      )}
      {herramienta === 'monitor' && destino && (
        <TaskMonitor
          key={`monitor-${destino.id}`}
          destino={destino}
          busqueda={busqueda}
          onBuscar={setBusqueda}
          transportadas={transportadasDelDestino}
        />
      )}
      {herramienta === 'orquestaciones' && destino && (
        <Suspense fallback={<div className="page-hint">Cargando las orquestaciones…</div>}>
          <Orchestrations
            key={`orq-${destino.id}`}
            destino={destino}
            leerRegistro={lectorDeCids(destino)}
            transportadas={transportadasDelDestino}
          />
        </Suspense>
      )}
      {/* `display: contents` deja al envoltorio invisible para el diseño cuando se ve; escondido, no
          pinta nada pero el componente sigue vivo con todo su estado. */}
      {montadas.explorador && (
        <div style={{ display: herramienta === 'explorador' ? 'contents' : 'none' }}>
          <Suspense fallback={<div className="page-hint">Cargando el explorador…</div>}>
            <IntegrationExplorer />
          </Suspense>
        </div>
      )}
      {montadas.documentador && (
        <div style={{ display: herramienta === 'documentador' ? 'contents' : 'none' }}>
          <Suspense fallback={<div className="page-hint">Cargando el documentador…</div>}>
            <MappingDocumenter />
          </Suspense>
        </div>
      )}
      {herramienta === 'tareas' && destino && (
        <TaskLauncher
          key={`tareas-${destino.id}`}
          destino={destino}
          onTaskLanzada={verEnMonitor}
          transportadas={transportadasDelDestino}
        />
      )}
    </div>
  )
}
