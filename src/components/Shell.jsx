// El armazón: barra superior, menú lateral y el contenido del módulo activo.
//
// El menú es el de v7, con un nivel más. En v7 las seis aplicaciones colgaban directamente del menú
// lateral porque v7 ERA un solo producto; aquí conviven tres, así que las aplicaciones cuelgan de su
// módulo y se despliegan cuando está abierto. El resto —los iconos, el candado a la derecha, el
// estado de la conexión arriba y los requisitos técnicos en el pie— es suyo, tal cual.
//
// Los módulos no contratados aparecen con candado en vez de desaparecer, siguiendo lo que
// hacía v7. Y son clicables a propósito: llevan a una pantalla que explica qué hace ese
// módulo. Un módulo escondido no se vende.

import { Fragment, useState } from 'react'

import { MODULES, partirRuta } from '../lib/modules.js'
import {
  estaConectado, useAsistenteAbierto, useConexionActiva, verAsistente,
} from '../lib/conexion-activa.js'
import ConnectDialog from './data/ConnectDialog.jsx'
import TechReqDialog from './data/TechReqDialog.jsx'
import TechLogs from './ui/TechLogs.jsx'

export default function Shell({ user, modules, theme, onToggleTheme, onSignOut, route, onNavigate, children }) {
  const contratados = new Set(modules)
  const esAdmin = user.isAdmin || user.isPlatformAdmin
  const { moduleId, appId } = partirRuta(route)

  const conexion = useConexionActiva()
  const conectado = estaConectado(conexion)
  // El asistente se abre también desde la pantalla de módulo restringido de cada aplicación, que no
  // está debajo de este componente. Por eso su estado vive fuera, igual que la conexión.
  const abrirConexion = useAsistenteAbierto()
  const [abrirRequisitos, setAbrirRequisitos] = useState(false)

  // El menú se minimiza a solo iconos, como en v8 y v9. Se recuerda: quien trabaja en un portátil lo
  // deja cerrado y no quiere volver a cerrarlo cada mañana.
  const [minimizado, setMinimizado] = useState(() => {
    try {
      return localStorage.getItem('menu_minimizado') === '1'
    } catch {
      return false
    }
  })

  function alternarMenu() {
    setMinimizado((previo) => {
      try {
        localStorage.setItem('menu_minimizado', previo ? '0' : '1')
      } catch {
        // Sin espacio o en modo privado: se minimiza igual, solo no se recuerda.
      }
      return !previo
    })
  }

  // El bloque de conexión es el de Data Tools. A quien no lo tenga contratado le sobra: ofrecerle
  // conectar a SAP IBP para algo que no puede abrir es prometer lo que el servidor va a negar.
  const tieneDataTools = contratados.has('explorer')

  return (
    <>
      <header className="header">
        {/* Logo, separador y título: el mismo patrón de la cabecera de v8. */}
        <div className="header-brand">
          <img src="/logo-goscm.png" alt="GoSCM" className="header-logo" />
          <div className="header-sep" />
          {/* El logo ya dice GoSCM, así que al lado va solo "Suite": junto se lee GoSCM Suite. */}
          <span>Suite</span>
        </div>
        <div className="header-sep" />
        <span className="header-context">{user.name || user.email}</span>
        {user.isPlatformAdmin && <span className="tag tag-accent">Plataforma</span>}

        <div style={{ flex: 1 }} />

        <button
          className="btn btn-ghost btn-sm"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Cambiar a claro' : 'Cambiar a oscuro'}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onSignOut}>Salir</button>
      </header>

      <div className="layout">
        <nav className={`sidebar${minimizado ? ' minimizado' : ''}`}>
          <button
            type="button"
            className="sidebar-minimizar"
            onClick={alternarMenu}
            title={minimizado ? 'Expandir' : 'Minimizar'}
            aria-label={minimizado ? 'Expandir el menú' : 'Minimizar el menú'}
          >
            {minimizado ? '»' : '«'}
          </button>

          {/* ── El estado de la conexión, arriba del todo como en v7 ────────────────────────── */}
          {tieneDataTools && (
            <div className="sidebar-conn">
              <div className="conn-status-row">
                <span className={`status-dot ${conectado ? 'on' : 'off'}`} />
                <span>
                  {conectado
                    ? `${conexion.planningArea} · ${conexion.nombre}`
                    : 'Desconectado'}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm sidebar-connect-btn"
                onClick={() => verAsistente(true)}
              >
                {/* El icono se queda con el menú minimizado; el texto no cabe. */}
                <span aria-hidden="true">🔗</span>
                <span className="nav-label">
                  {conectado ? ' Conexión activa' : ' Conectar SAP IBP'}
                </span>
              </button>
            </div>
          )}

          <div className="sidebar-nav">
            <span className="sidebar-label">Módulos</span>
            {MODULES.map((module) => {
              const bloqueado = !contratados.has(module.id)
              const abierto = moduleId === module.id && !bloqueado
              return (
                <Fragment key={module.id}>
                  <button
                    className={`nav-item${moduleId === module.id ? ' active' : ''}${bloqueado ? ' locked' : ''}`}
                    onClick={() => onNavigate(module.id)}
                  >
                    <span className="nav-icon">{module.icon}</span>
                    <span className="nav-label">{module.name}</span>
                    {bloqueado && <span className="nav-lock" title="No contratado">🔒</span>}
                  </button>

                  {/* Las aplicaciones del módulo abierto. El candado de cada una NO dice «no
                      contratada» —el módulo entero ya lo está— sino «hace falta conectarse»: es el
                      `req-conn` de v7. */}
                  {abierto && module.apps?.map((app) => {
                    const sinConexion = app.requiereConexion && !conectado
                    return (
                      <button
                        key={app.id}
                        className={`nav-item nav-app${appId === app.id ? ' active' : ''}${sinConexion ? ' locked' : ''}`}
                        onClick={() => onNavigate(`${module.id}/${app.id}`)}
                      >
                        <span className="nav-icon">{app.icon}</span>
                        <span className="nav-label">{app.name}</span>
                        {sinConexion && (
                          <span className="nav-lock-badge" title="Requiere conexión a SAP IBP">🔒</span>
                        )}
                      </button>
                    )
                  })}
                </Fragment>
              )
            })}

            {esAdmin && (
              <>
                <div className="sidebar-divider" />
                <span className="sidebar-label">Gestión</span>
                <button
                  className={`nav-item${route === 'admin' ? ' active' : ''}`}
                  onClick={() => onNavigate('admin')}
                >
                  <span className="nav-icon">🛠️</span>
                  <span className="nav-label">Administración</span>
                </button>
              </>
            )}
          </div>

          {/* ── El pie del menú, con los requisitos técnicos ────────────────────────────────
              Está siempre, no solo con Data Tools: los tres proyectos tenían su panel y ahora los
              tres están dentro, cada uno en su pestaña. */}
          <div className="sidebar-footer">
            <button className="nav-item" onClick={() => setAbrirRequisitos(true)}>
              <span className="nav-icon">⚙</span>
              <span className="nav-label">Requisitos técnicos</span>
            </button>
          </div>
        </nav>

        {/* El panel de diagnóstico va UNA vez aquí y no en cada módulo: lee todo el tráfico de la
            aplicación, así que ponerlo por módulo sería tres copias mostrando lo mismo. */}
        <main className="content">
          {children}
          <TechLogs />
        </main>
      </div>

      {abrirConexion && <ConnectDialog onClose={() => verAsistente(false)} />}
      {abrirRequisitos && <TechReqDialog onClose={() => setAbrirRequisitos(false)} />}
    </>
  )
}
