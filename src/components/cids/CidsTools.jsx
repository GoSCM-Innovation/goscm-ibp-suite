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
import Orchestrations from './orchestrations/Orchestrations.jsx'
import { lectorDeCids } from '../../lib/run-logs.js'

// Los tableros se cargan aparte, solo al abrir su pestaña. Son los únicos que usan la librería de
// gráficos, y esa librería pesa más que todo el resto de la aplicación junta: dejarla en el paquete
// principal se la haría descargar hasta a quien solo entra a ver el monitor.
const Summary = lazy(() => import('./Summary.jsx'))
const GlobalSummary = lazy(() => import('./GlobalSummary.jsx'))

// El explorador trabaja sobre archivos del equipo, no contra SAP. Se carga aparte porque arrastra el
// lector de ZIP, que no hace falta para nada más.
const IntegrationExplorer = lazy(() => import('./explorer/IntegrationExplorer.jsx'))
const MappingDocumenter = lazy(() => import('./documenter/MappingDocumenter.jsx'))

// El orden es el de v9: se entra por el resumen, que es la pantalla que contesta "¿cómo venimos?"
// antes de que nadie tenga que buscar una ejecución concreta.
//
// El tablero global mira TODOS los destinos, así que el selector no le aplica y se esconde mientras
// está abierto. Solo aparece cuando hay más de uno, que con CI-DS es siempre —cada conexión rinde
// pruebas y productivo—, pero la condición queda escrita para que se lea el motivo.
const HERRAMIENTAS = [
  { id: 'global', label: 'Global', soloConVarios: true },
  { id: 'resumen', label: 'Resumen' },
  { id: 'monitor', label: 'Monitor de tareas' },
  { id: 'tareas', label: 'Proyectos y tareas' },
  { id: 'orquestaciones', label: 'Orquestaciones' },
  { id: 'explorador', label: 'Explorador de integraciones' },
  { id: 'documentador', label: 'Documentador de mapeos' },
]

// El explorador y el documentador leen los ZIP del equipo: no consultan ningún repositorio, así que
// el selector de destino no les dice nada. Lo único que el explorador toma de la conexión es qué
// tareas ya están en el productivo.
const SIN_DESTINO = new Set(['global', 'explorador', 'documentador'])

export default function CidsTools() {
  const [conexiones, setConexiones] = useState(null)
  const [elegido, setElegido] = useState('')
  const [error, setError] = useState('')
  const [herramienta, setHerramienta] = useState('resumen')

  // La búsqueda del monitor vive acá arriba y no dentro del monitor. Es lo que permite que al
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
        if (lista.length > 0) setElegido(`${lista[0].id}:sandbox`)
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
        No hay ninguna conexión a CI-DS configurada para tu empresa. Pedile a quien administra la
        cuenta que la dé de alta en Administración → Conexiones.
      </div>
    )
  }

  // La regla de qué marca aplica a qué destino vive en la librería y tiene tests: escrita aquí como
  // expresión suelta tenía un caso que reventaba la pantalla entera en el primer pintado.
  const transportadasDelDestino = promotedForTarget(transportadas, destino)

  function verEnMonitor(taskName) {
    setBusqueda(taskName)
    setHerramienta('monitor')
  }

  return (
    <div className="module-page">
      <div className="module-head">
        <div>
          <div className="page-title">CI-DS Tools</div>
          <div className="page-hint">
            {herramienta === 'global' && 'Todos los repositorios de CI-DS a la vez.'}
            {herramienta === 'explorador' && 'Los exports de tus proyectos, leídos en tu navegador.'}
            {herramienta === 'documentador' && 'De los exports de un proyecto a un Excel para entregar.'}
            {!SIN_DESTINO.has(herramienta) && 'Ejecuciones, tareas y orquestaciones del repositorio elegido.'}
          </div>
        </div>

        {/* Hay pantallas a las que elegir un destino no les dice nada: el tablero global los mira
            todos y el explorador no mira ninguno. */}
        {!SIN_DESTINO.has(herramienta) && (
          <div className="monitor-bar">
            <select
              className="select input-sm"
              value={elegido}
              onChange={(evento) => setElegido(evento.target.value)}
              aria-label="Repositorio de CI-DS"
            >
              {destinos.map((uno) => (
                <option key={uno.id} value={uno.id}>{uno.label}</option>
              ))}
            </select>
            {destino?.production && <span className="tag tag-accent">Productivo</span>}
          </div>
        )}
      </div>

      <div className="tabs">
        {HERRAMIENTAS.filter((una) => !una.soloConVarios || destinos.length > 1).map((una) => (
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

      {/* La clave fuerza a empezar de cero al cambiar de destino: fechas, filtros y proyectos
          abiertos son del repositorio que se estaba mirando, no del usuario.

          Cada herramienta se monta y se desmonta al cambiar de pestaña, igual que en v9. La
          alternativa —dejarlas montadas y solo esconderlas— haría que el monitor y el resumen
          siguieran consultando a SAP en sus relojes mientras mirás otra cosa. */}
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
        <Orchestrations
          key={`orq-${destino.id}`}
          destino={destino}
          leerRegistro={lectorDeCids(destino)}
        />
      )}
      {herramienta === 'explorador' && (
        <Suspense fallback={<div className="page-hint">Cargando el explorador…</div>}>
          <IntegrationExplorer />
        </Suspense>
      )}
      {herramienta === 'documentador' && (
        <Suspense fallback={<div className="page-hint">Cargando el documentador…</div>}>
          <MappingDocumenter />
        </Suspense>
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
