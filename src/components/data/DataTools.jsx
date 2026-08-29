// Data Tools: las seis aplicaciones de v7, cada una en su sitio.
//
// Este archivo ya no elige el tenant: eso lo hace UNA vez el asistente de conexión, y lo que elige
// vive en `conexion-activa.js` mientras dure la sesión. Es la forma de v7 y la razón de volver a
// ella: se elige destino al entrar y después se navega libre entre las seis aplicaciones. Los tres
// desplegables que había aquí obligaban a reelegir en cada pantalla.
//
// Lo que queda es el despacho: la cinta que presenta cada aplicación, el candado de las que no pueden
// hacer nada sin conexión, y montar la que toque. El menú lateral es de `Shell.jsx`.

import { lazy, Suspense } from 'react'

import { APPS_EXPLORER } from '../../lib/modules.js'
import { destinoDe, estaConectado, useConexionActiva, verAsistente } from '../../lib/conexion-activa.js'

const ProductionVisualizer = lazy(() => import('./ProductionVisualizer.jsx'))
const ProductionAnalyzer = lazy(() => import('./ProductionAnalyzer.jsx'))
const NetworkVisualizer = lazy(() => import('./NetworkVisualizer.jsx'))
const NetworkAnalyzer = lazy(() => import('./NetworkAnalyzer.jsx'))
const Glosario = lazy(() => import('./Glosario.jsx'))
const PlanningAreaDoc = lazy(() => import('./PlanningAreaDoc.jsx'))

export default function DataTools({ appId }) {
  const conexion = useConexionActiva()
  const conectado = estaConectado(conexion)
  const destino = destinoDe(conexion)

  const app = APPS_EXPLORER.find((una) => una.id === appId) ?? APPS_EXPLORER[0]

  // La clave fuerza a empezar de cero al cambiar de destino: lo detectado, lo descargado y lo
  // corregido son de ESE tenant, esa área y esa versión.
  const clave = `${conexion.connectionId}|${conexion.planningArea}|${conexion.version}`

  function contenido() {
    if (app.requiereConexion && !conectado) {
      return (
        <div className="locked-message empty-state" style={{ marginTop: 40 }}>
          <div className="icon" style={{ fontSize: 48, opacity: .8, marginBottom: 16 }}>🔒</div>
          <strong style={{ fontSize: 16, color: 'var(--text)' }}>Módulo restringido</strong>
          <p style={{
            fontSize: 13,
            color: 'var(--text2)',
            marginTop: 8,
            maxWidth: 400,
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
          >
            {app.bloqueado}
          </p>
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: 20 }}
            onClick={() => verAsistente(true)}
          >
            🔗 Conectar a SAP IBP
          </button>
        </div>
      )
    }

    switch (app.id) {
      case 'bom':
        return <ProductionVisualizer key={clave} destino={destino} />
      case 'pa':
        return <ProductionAnalyzer key={clave} area={conexion.planningArea} destino={destino} />
      case 'visualizer':
        return <NetworkVisualizer key={clave} destino={destino} />
      case 'network':
        return <NetworkAnalyzer key={clave} area={conexion.planningArea} destino={destino} />
      case 'glosario':
        // No depende del tenant ni de lo descargado: explica los informes.
        return <Glosario />
      case 'padoc':
        // No trabaja sobre lo descargado: recibe los CSV de la configuración del área, que SAP no
        // expone por API. Lo único que lee en vivo son los trabajos del tenant.
        return (
          <PlanningAreaDoc
            key={clave}
            conexionId={conexion.connectionId}
            tenant={conexion.nombre}
            area={conexion.planningArea}
          />
        )
      default:
        return null
    }
  }

  return (
    <div className="module-page">
      {/* La cinta de presentación de cada aplicación, como en v7. */}
      <div className="tab-info-banner">
        <span className="tab-info-icon">{app.icon}</span>
        <div className="tab-info-content">
          <div className="page-title" style={{ fontSize: 15, marginBottom: 4 }}>{app.name}</div>
          <div className="tab-info-desc">{app.banner}</div>
        </div>
      </div>

      <Suspense fallback={<div className="page-hint">Cargando…</div>}>{contenido()}</Suspense>
    </div>
  )
}
