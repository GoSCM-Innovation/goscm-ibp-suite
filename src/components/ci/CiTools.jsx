// El módulo CI Tools: integraciones de Cloud Integration (CPI) que cargan datos a SAP IBP.
//
// Reemplaza a Postman para esto: las mismas peticiones (el body de cada integración), guardadas en el servidor
// por cliente, ejecutables desde aquí y encadenables en orquestaciones.
//
// Cada conexión es UN ambiente (desarrollo, calidad, producción) con su endpoint y su biblioteca. Se elige con
// la tira de pestañas de arriba, la misma de IBP Tools y CI-DS Tools, y cada pantalla que ejecuta algo dice
// contra cuál: elegir el tenant equivocado no da un error, da una carga en otro sistema.
//
// Las vistas se quedan montadas una vez abiertas: una orquestación avanza mientras su pantalla está montada, y
// cambiar de pestaña no debe cortarla.
//
// Las pestañas de vista (Integraciones, Orquestaciones, Historial) van en la misma fila que las de conexión, a su
// derecha: una fila menos arriba del contenido.

import { useEffect, useState } from 'react'
import { puedeSalir } from '../../lib/guarda-de-salida.js'
import { listCiConnections } from '../../lib/ci.js'
import { nombreConAmbiente } from '../../lib/nombre-de-conexion.js'
import ConnectionTabs from '../ui/ConnectionTabs.jsx'
import Historial from './Historial.jsx'
import Integraciones from './Integraciones.jsx'
import OrquestacionesCi from './OrquestacionesCi.jsx'
import './ci.css'

const VISTAS = [
  { id: 'integraciones', etiqueta: 'Integraciones' },
  { id: 'orquestaciones', etiqueta: 'Orquestaciones' },
  { id: 'historial', etiqueta: 'Historial' },
]

/** Lo que lleva la pestaña activa de la tira: el nombre con su ambiente y la dirección del endpoint. */
const detalleDeCi = (conexion) => ({
  titulo: nombreConAmbiente(conexion),
  filas: [['Endpoint', conexion.baseUrl]].filter(([, valor]) => valor),
  enlace: null,
})

/** Las tres pestañas de vista. */
function PestanasDeVistas({ activa, onElegir }) {
  return (
    <div className="tabs ci-vistas" role="tablist">
      {VISTAS.map((vista) => (
        <button
          key={vista.id}
          type="button"
          role="tab"
          aria-selected={activa === vista.id}
          className={`tab${activa === vista.id ? ' active' : ''}`}
          onClick={() => onElegir(vista.id)}
        >
          {vista.etiqueta}
        </button>
      ))}
    </div>
  )
}

/** La vista de UNA conexión: la pestaña activa, y las ya visitadas siguen montadas. */
function SistemaCi({ connection, activa, visitadas }) {
  const visible = (id) => ({ display: activa === id ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 })

  return (
    <div className="ci-sistema">
      <div className="ci-vista">
        {visitadas.integraciones && <div style={visible('integraciones')}><Integraciones connection={connection} /></div>}
        {visitadas.orquestaciones && (
          <div style={visible('orquestaciones')}>
            <OrquestacionesCi connection={connection} visible={activa === 'orquestaciones'} />
          </div>
        )}
        {/* El historial se monta de nuevo cada vez: siempre se quiere lo último. */}
        {activa === 'historial' && <Historial connection={connection} />}
      </div>
    </div>
  )
}

export default function CiTools() {
  const [conexiones, setConexiones] = useState(null)
  const [elegida, setElegida] = useState('')
  const [error, setError] = useState('')
  // La pestaña de vista abierta y cuáles ya se visitaron. Cambiar de conexión empieza de cero.
  const [vista, setVista] = useState('integraciones')
  const [visitadas, setVisitadas] = useState({ integraciones: true })

  useEffect(() => {
    let abandonado = false
    listCiConnections()
      .then((lista) => {
        if (abandonado) return
        setConexiones(lista)
        setElegida(lista[0]?.id ?? '')
      })
      .catch((fallo) => {
        if (abandonado) return
        setError(fallo.message)
        setConexiones([])
      })
    return () => { abandonado = true }
  }, [])

  function elegir(id) {
    if (id === elegida) return
    if (!puedeSalir()) return
    setElegida(id)
    setVista('integraciones')
    setVisitadas({ integraciones: true })
  }

  function elegirVista(id) {
    if (id === vista) return
    // Salir de una orquestación en marcha corta la ejecución: se confirma antes. Ver `guarda-de-salida.js`.
    if (!puedeSalir()) return
    setVisitadas((previas) => (previas[id] ? previas : { ...previas, [id]: true }))
    setVista(id)
  }

  if (conexiones === null) return <div className="page-hint">Cargando conexiones…</div>
  if (error) return <div className="notice notice-error">✕ {error}</div>

  if (conexiones.length === 0) {
    return (
      <div className="notice notice-info">
        No hay ninguna conexión a Cloud Integration configurada para tu empresa. Pídele a quien administra la
        cuenta que la dé de alta en Administración → Conexiones, con el tipo «Cloud Integration».
      </div>
    )
  }

  const conexion = conexiones.find((una) => una.id === elegida) ?? null

  return (
    <div className="module-page ci-tools">
      <ConnectionTabs
        conexiones={conexiones}
        activa={elegida}
        onElegir={elegir}
        detalleDe={detalleDeCi}
        derecha={<PestanasDeVistas activa={vista} onElegir={elegirVista} />}
      />
      {/* La clave es la conexión: cada una empieza de cero, sin heredar lo abierto en la anterior. */}
      {conexion && <SistemaCi key={conexion.id} connection={conexion} activa={vista} visitadas={visitadas} />}
    </div>
  )
}
