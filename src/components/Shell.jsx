// El armazón: barra superior (solo la marca), menú lateral con la sesión y el contenido del módulo activo.
//
// El menú es el de v7, con un nivel más. En v7 las seis aplicaciones colgaban directamente del menú
// lateral porque v7 ERA un solo producto; aquí conviven tres, así que las aplicaciones cuelgan de su
// módulo y se despliegan cuando está abierto. El resto —los iconos, el candado a la derecha y los
// requisitos técnicos en el pie— es suyo, tal cual.
//
// El estado de la conexión a SAP IBP NO está aquí: en v7 iba arriba del menú porque todo era Data
// Tools, pero aquí es cosa de ese módulo y vive en `data/BarraDeTenant.jsx`, dentro de cada aplicación.
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

/** La pestaña de Requisitos técnicos que corresponde a cada módulo. Data Tools abre en «Conexión». */
const PESTANA_DE_MODULO = { cids: 'cids', jobs: 'ibp' }

/** Logo y «Suite»: el patrón de la cabecera de v8. El logo ya dice GoSCM, así que al lado va solo «Suite». */
function Marca({ className = '' }) {
  return (
    <div className={`header-brand ${className}`.trim()}>
      <img src="/logo-goscm.png" alt="GoSCM" className="header-logo" />
      <div className="header-sep" />
      <span className="marca-texto">Suite</span>
    </div>
  )
}

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

  // Las aplicaciones de un módulo se pliegan como un árbol (pedido el 2026-10-05). Se recuerda qué
  // módulos están plegados, por la misma razón que el menú minimizado. Con el menú minimizado se
  // ignora: ahí las aplicaciones son los únicos iconos con los que llegar a ellas.
  const [plegados, setPlegados] = useState(() => {
    try {
      const guardado = JSON.parse(localStorage.getItem('menu_plegados') ?? '[]')
      return new Set(Array.isArray(guardado) ? guardado : [])
    } catch {
      return new Set()
    }
  })

  function ponerPlegado(id, plegar) {
    setPlegados((previo) => {
      const siguiente = new Set(previo)
      if (plegar) siguiente.add(id)
      else siguiente.delete(id)
      try {
        localStorage.setItem('menu_plegados', JSON.stringify([...siguiente]))
      } catch {
        // Sin espacio o en modo privado: se pliega igual, solo no se recuerda.
      }
      return siguiente
    })
  }

  return (
    <>
      {/* En pantallas anchas la marca vive arriba del menú lateral y el contenido sube hasta el borde
          (pedido el 2026-10-06: la barra entera gastaba altura para dos palabras). Solo en móvil, donde
          el menú pasa abajo, la marca sigue arriba. */}
      <header className="header header-movil">
        <Marca />
      </header>

      <div className="layout">
        <nav className={`sidebar${minimizado ? ' minimizado' : ''}`}>
          <div className="sidebar-cabecera">
            <Marca className="sidebar-marca" />
            <button
              type="button"
              className="sidebar-minimizar"
              onClick={alternarMenu}
              title={minimizado ? 'Expandir' : 'Minimizar'}
              aria-label={minimizado ? 'Expandir el menú' : 'Minimizar el menú'}
            >
              {minimizado ? '»' : '«'}
            </button>
          </div>

          <div className="sidebar-nav">
            <span className="sidebar-label">Módulos</span>
            {MODULES.map((module) => {
              const bloqueado = !contratados.has(module.id)
              const abierto = moduleId === module.id && !bloqueado
              const plegable = Boolean(module.apps?.length) && !bloqueado
              const plegado = plegable && plegados.has(module.id) && !minimizado
              // Las aplicaciones se ven según la flecha, estés o no dentro del módulo. Minimizado no
              // hay flecha y cada aplicación es un icono: ahí solo las del módulo abierto, o el menú
              // se llenaría de iconos sueltos.
              const verApps = !bloqueado && (minimizado ? abierto : !plegado)
              return (
                <Fragment key={module.id}>
                  <div className={plegable ? 'nav-rama' : undefined}>
                    <button
                      className={`nav-item${moduleId === module.id ? ' active' : ''}${bloqueado ? ' locked' : ''}`}
                      onClick={() => {
                        // Pulsar el módulo lo abre; si estaba plegado, además lo despliega.
                        if (plegable) ponerPlegado(module.id, false)
                        onNavigate(module.id)
                      }}
                    >
                      <span className="nav-icon">{module.icon}</span>
                      <span className="nav-label">{module.name}</span>
                      {bloqueado && <span className="nav-lock" title="No contratado">🔒</span>}
                    </button>
                    {plegable && (
                      <button
                        type="button"
                        className="nav-plegar"
                        onClick={() => ponerPlegado(module.id, !plegado)}
                        title={plegado ? 'Desplegar' : 'Plegar'}
                        aria-label={`${plegado ? 'Desplegar' : 'Plegar'} ${module.name}`}
                        aria-expanded={!plegado}
                      >
                        {plegado ? '▸' : '▾'}
                      </button>
                    )}
                  </div>

                  {/* Las aplicaciones del módulo desplegado. El candado de cada una NO dice «no
                      contratada» —el módulo entero ya lo está— sino «hace falta conectarse»: es el
                      `req-conn` de v7. */}
                  {verApps && module.apps?.map((app) => {
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

            {/* La sesión va a continuación de Gestión y no en la cabecera (pedido el 2026-10-06). */}
            <div className="sidebar-divider" />
            <div className="sidebar-usuario">
              <span className="sidebar-usuario-nombre">{user.name || user.email}</span>
              {user.isPlatformAdmin && <span className="tag tag-accent">Plataforma</span>}
            </div>
            <button
              className="nav-item"
              onClick={onToggleTheme}
              title={theme === 'dark' ? 'Cambiar a claro' : 'Cambiar a oscuro'}
            >
              <span className="nav-icon">{theme === 'dark' ? '☀️' : '🌙'}</span>
              <span className="nav-label">{theme === 'dark' ? 'Tema claro' : 'Tema oscuro'}</span>
            </button>
            <button className="nav-item" onClick={onSignOut} title="Cerrar sesión">
              <span className="nav-icon">🚪</span>
              <span className="nav-label">Salir</span>
            </button>
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
      {/* Abre en la pestaña del módulo en el que se está: desde CI-DS Tools, la de CI-DS. */}
      {abrirRequisitos && (
        <TechReqDialog pestanaInicial={PESTANA_DE_MODULO[moduleId]} onClose={() => setAbrirRequisitos(false)} />
      )}
    </>
  )
}
