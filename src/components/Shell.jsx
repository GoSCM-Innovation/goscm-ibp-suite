// El armazón: barra superior, menú lateral y el contenido del módulo activo.
//
// Los módulos no contratados aparecen con candado en vez de desaparecer, siguiendo lo que
// hacía v7. Y son clicables a propósito: llevan a una pantalla que explica qué hace ese
// módulo. Un módulo escondido no se vende.

import { MODULES } from '../lib/modules.js'

export default function Shell({ user, modules, theme, onToggleTheme, onSignOut, route, onNavigate, children }) {
  const contratados = new Set(modules)
  const esAdmin = user.isAdmin || user.isPlatformAdmin

  return (
    <>
      <header className="header">
        {/* Logo, separador y título: el mismo patrón de la cabecera de v8. */}
        <div className="header-brand">
          <img src="/logo-goscm.png" alt="GoSCM" className="header-logo" />
          <div className="header-sep" />
          <span>Suite IBP</span>
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
        <nav className="sidebar">
          <span className="sidebar-label">Módulos</span>
          {MODULES.map((module) => {
            const bloqueado = !contratados.has(module.id)
            return (
              <button
                key={module.id}
                className={`nav-item${route === module.id ? ' active' : ''}${bloqueado ? ' locked' : ''}`}
                onClick={() => onNavigate(module.id)}
              >
                <span className="nav-icon">{module.icon}</span>
                <span className="nav-label">{module.name}</span>
                {bloqueado && <span className="nav-lock" title="No contratado">🔒</span>}
              </button>
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
        </nav>

        <main className="content">{children}</main>
      </div>
    </>
  )
}
