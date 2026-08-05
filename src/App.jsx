// Punto de entrada de la interfaz: decide si hay sesión y qué se muestra.
//
// La navegación va en la dirección del navegador (después de la almohadilla) para que al
// recargar se siga en el mismo sitio y los botones de atrás y adelante funcionen. No hace
// falta una librería de rutas para tres módulos y un panel.

import { useCallback, useEffect, useState } from 'react'
import { api } from './lib/api.js'
import { applyTheme, readStoredTheme } from './lib/theme.js'
import { MODULES, moduleById } from './lib/modules.js'
import Login from './components/Login.jsx'
import Shell from './components/Shell.jsx'
import ModuleLocked from './components/ModuleLocked.jsx'
import ModulePlaceholder from './components/ModulePlaceholder.jsx'
import AdminPanel from './components/admin/AdminPanel.jsx'

const RUTAS_VALIDAS = new Set([...MODULES.map((m) => m.id), 'admin'])

function rutaActual() {
  const hash = window.location.hash.replace(/^#\/?/, '')
  return RUTAS_VALIDAS.has(hash) ? hash : null
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

  const navegar = useCallback((destino) => {
    window.location.hash = `#/${destino}`
    setRoute(destino)
    refrescarSesion()
  }, [refrescarSesion])

  async function salir() {
    await api.post('/api/auth/logout').catch(() => {})
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

  function contenido() {
    if (activa === 'admin') {
      if (!esAdmin) return <div className="notice notice-error">No tienes acceso a la administración.</div>
      return <AdminPanel user={user} />
    }
    const module = moduleById(activa) ?? MODULES[0]
    return modules.includes(module.id)
      ? <ModulePlaceholder module={module} />
      : <ModuleLocked module={module} />
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
