// Punto de entrada de la interfaz: decide si hay sesión y qué se muestra.
//
// La navegación va en la dirección del navegador (después de la almohadilla) para que al
// recargar se siga en el mismo sitio y los botones de atrás y adelante funcionen. No hace
// falta una librería de rutas para tres módulos y un panel.

import { useCallback, useEffect, useState } from 'react'
import { api } from './lib/api.js'
import { puedeSalir } from './lib/guarda-de-salida.js'
import { applyTheme, readStoredTheme } from './lib/theme.js'
import { desconectar } from './lib/conexion-activa.js'
import { MODULES, moduleById, partirRuta } from './lib/modules.js'
import Login from './components/Login.jsx'
import Shell from './components/Shell.jsx'
import ModuleLocked from './components/ModuleLocked.jsx'
import ModulePlaceholder from './components/ModulePlaceholder.jsx'
import CidsTools from './components/cids/CidsTools.jsx'
import IbpTools from './components/ibp/IbpTools.jsx'
import DataTools from './components/data/DataTools.jsx'
import AdminPanel from './components/admin/AdminPanel.jsx'

const RUTAS_VALIDAS = new Set([...MODULES.map((m) => m.id), 'admin'])

/**
 * La sección abierta, leída de la dirección.
 *
 * Una dirección puede llevar aplicación (`explorer/bom`), porque Data Tools tiene seis. Se valida
 * solo la primera mitad: la segunda la resuelve `partirRuta`, que cae en la primera aplicación del
 * módulo cuando el identificador no existe.
 */
function rutaActual() {
  const hash = window.location.hash.replace(/^#\/?/, '')
  const [moduleId] = hash.split('/')
  return RUTAS_VALIDAS.has(moduleId) ? hash : null
}

export default function App() {
  const [session, setSession] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [theme, setTheme] = useState(readStoredTheme)
  const [route, setRoute] = useState(rutaActual)

  useEffect(() => { applyTheme(theme) }, [theme])

  // Relee quién soy y qué tengo contratado. Se llama al cambiar de sección y al volver a la
  // pestaña: si un administrador vence un módulo, el menú tiene que enterarse sin obligar a
  // recargar. El backend ya rechazaría las llamadas de todas formas — esto es para que la
  // interfaz no prometa algo que el servidor va a negar.
  const refrescarSesion = useCallback(() => {
    api.get('/api/auth/session').then(setSession).catch(() => setSession(null))
  }, [])

  useEffect(() => {
    const alCambiarRuta = () => { setRoute(rutaActual()); refrescarSesion() }
    const alVolver = () => { if (document.visibilityState === 'visible') refrescarSesion() }
    window.addEventListener('hashchange', alCambiarRuta)
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      window.removeEventListener('hashchange', alCambiarRuta)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [refrescarSesion])

  // ¿Hay una sesión abierta de antes? La cookie la manda el navegador sola.
  useEffect(() => {
    api.get('/api/auth/session')
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setCargando(false))
  }, [])

  // Navegar corta una copia en marcha, porque la cadena de segmentos la lleva el navegador. Cambiar de
  // módulo no dispara `beforeunload`, así que hay que preguntar aquí. Ver `guarda-de-salida.js`.
  const navegar = useCallback((destino) => {
    if (!puedeSalir()) return
    window.location.hash = `#/${destino}`
    setRoute(destino)
    refrescarSesion()
  }, [refrescarSesion])

  async function salir() {
    if (!puedeSalir()) return
    await api.post('/api/auth/logout').catch(() => {})
    // La conexión vive fuera de React para sobrevivir a los cambios de módulo, así que cerrarla no
    // ocurre solo: sin esto, quien entre después con otra cuenta hereda el tenant del anterior.
    desconectar()
    setSession(null)
    window.location.hash = ''
  }

  if (cargando) {
    return (
      <div className="login-screen">
        <span style={{ color: 'var(--text3)' }}>Cargando…</span>
      </div>
    )
  }

  if (!session) {
    return <Login onSignedIn={(datos) => { setSession(datos); setRoute(rutaActual()) }} />
  }

  const { user, modules } = session
  const esAdmin = user.isAdmin || user.isPlatformAdmin

  // Sin ruta en la dirección, se abre el primer módulo contratado SEGÚN EL ORDEN DEL MENÚ, no
  // según el orden en que los devuelva el servidor. Quien no tenga ninguno y sea administrador
  // entra directo a la gestión, que es lo único que puede hacer.
  const rutaPorDefecto = MODULES.find((m) => modules.includes(m.id))?.id
    ?? (esAdmin ? 'admin' : MODULES[0].id)
  const activa = route ?? rutaPorDefecto

  const { moduleId, appId } = partirRuta(activa)

  function contenido() {
    if (activa === 'admin') {
      if (!esAdmin) return <div className="notice notice-error">No tienes acceso a la administración.</div>
      return <AdminPanel user={user} />
    }
    const module = moduleById(moduleId) ?? MODULES[0]
    if (!modules.includes(module.id)) return <ModuleLocked module={module} />
    // Los módulos que ya están escritos se montan; el resto sigue con su presentación.
    if (module.id === 'cids') return <CidsTools />
    if (module.id === 'jobs') return <IbpTools />
    if (module.id === 'explorer') return <DataTools appId={appId} />
    return <ModulePlaceholder module={module} />
  }

  return (
    <Shell
      user={user}
      modules={modules}
      theme={theme}
      onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      onSignOut={salir}
      route={activa}
      onNavigate={navegar}
    >
      {contenido()}
    </Shell>
  )
}
