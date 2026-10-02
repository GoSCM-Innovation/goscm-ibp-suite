// Data Tools: las seis aplicaciones de v7, cada una en su sitio.
//
// Este archivo ya no elige el tenant: eso lo hace UNA vez el asistente de conexión, y lo que elige
// vive en `conexion-activa.js` mientras dure la sesión. Es la forma de v7 y la razón de volver a
// ella: se elige destino al entrar y después se navega libre entre las seis aplicaciones. Los tres
// desplegables que había aquí obligaban a reelegir en cada pantalla.
//
// Cada aplicación lleva su barra de tenant (`BarraDeTenant`), salvo el glosario, que no usa ninguno.
//
// Lo que queda es el despacho: la cinta que presenta cada aplicación, el candado de las que no pueden
// hacer nada sin conexión, y montar la que toque. El menú lateral es de `Shell.jsx`.

import { lazy, Suspense, useMemo } from 'react'

import { APPS_EXPLORER } from '../../lib/modules.js'
import { destinoDe, estaConectado, useConexionActiva, verAsistente } from '../../lib/conexion-activa.js'
import BarraDeTenant from './BarraDeTenant.jsx'

const ProductionVisualizer = lazy(() => import('./ProductionVisualizer.jsx'))
const ProductionAnalyzer = lazy(() => import('./ProductionAnalyzer.jsx'))
const NetworkVisualizer = lazy(() => import('./NetworkVisualizer.jsx'))
const NetworkAnalyzer = lazy(() => import('./NetworkAnalyzer.jsx'))
const Glosario = lazy(() => import('./Glosario.jsx'))
const PlanningAreaDoc = lazy(() => import('./PlanningAreaDoc.jsx'))

export default function DataTools({ appId }) {
  const conexion = useConexionActiva()
  const conectado = estaConectado(conexion)
  // El destino es un objeto nuevo cada vez que se calcula, y las pantallas de abajo lo usan como
  // dependencia de sus lecturas. Si cambiara de identidad en cada dibujo, cada relectura de la sesión
  // —que ocurre al volver a esta pestaña del navegador o al cambiar de sección— haría creer que el
  // destino cambió: el mapeo se vaciaba y volvía a pedir las tablas a SAP, y se veía como un parpadeo
  // «cada cierto tiempo». Solo cambia cuando cambian de verdad el tenant, el área o la versión.
  const { connectionId, planningArea, version } = conexion
  const destino = useMemo(
    () => destinoDe({ connectionId, planningArea, version }),
    [connectionId, planningArea, version],
  )

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
      case 'padoc':
        // No trabaja sobre lo descargado: recibe los CSV de la configuración del área, que SAP no
        // expone por API. Sin `key` a propósito: los CSV no son de un tenant, y cambiar de tenant no
        // debe tirar lo cargado (en v7 tampoco lo hacía). La pantalla lee la conexión ella misma.
        return <PlanningAreaDoc />
      default:
        return null
    }
  }

  // El glosario va de lado a lado y sin cinta: en v7 era así, y no depende de ningún tenant.
  if (app.id === 'glosario') {
    return <Suspense fallback={<div className="page-hint">Cargando…</div>}><Glosario /></Suspense>
  }

  return (
    <div className="module-page">
      {/* La cinta de presentación de cada aplicación, como en v7. */}
      <div className="tab-info-banner">
        <span className="tab-info-icon">{app.icon}</span>
        <div className="tab-info-content">
          <div className="page-title" style={{ fontSize: 15, marginBottom: 4 }}>{app.name}</div>
          <div className="tab-info-desc">
            {app.banner.split('**').map((trozo, i) => (
              // Lo que va entre ** es negrita: los pares impares son los trozos marcados.
              i % 2 === 1 ? <b key={i}>{trozo}</b> : trozo
            ))}
          </div>
        </div>
      </div>

      {/* Contra qué tenant se ejecuta esta aplicación, y el cambio de tenant. */}
      <BarraDeTenant />

      <Suspense fallback={<div className="page-hint">Cargando…</div>}>{contenido()}</Suspense>
    </div>
  )
}
