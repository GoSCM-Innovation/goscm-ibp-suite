// La barra que dice contra qué tenant corre una aplicación de Data Tools, y deja cambiarlo.
//
// Antes el estado de la conexión vivía arriba del menú lateral, común a toda la suite, como en v7.
// Pero la conexión a SAP IBP es cosa de Data Tools —IBP Tools y CI-DS Tools eligen su propio
// destino—, así que mostrarla siempre, en cualquier módulo, prometía algo que esos módulos no usan.
// Ahora cada aplicación de Data Tools lleva su barra: se ve contra qué tenant, área y versión va a
// ejecutar, y se cambia ahí mismo.
//
// El cambio abre el asistente de v7 de siempre (conexión → área → versión). Lo elegido queda como
// «lo último elegido» y lo heredan las demás aplicaciones al abrirse, que pueden cambiarlo otra vez:
// elegir una vez y navegar libre es la forma de v7, y esto la conserva.

import { VERSION_BASE } from '../../lib/version-elegida.js'
import { estaConectado, useConexionActiva, verAsistente } from '../../lib/conexion-activa.js'

export default function BarraDeTenant() {
  const conexion = useConexionActiva()
  const conectado = estaConectado(conexion)

  return (
    <div className="tenant-bar">
      <span className={`status-dot ${conectado ? 'on' : 'off'}`} />
      <div className="tenant-bar-texto">
        {conectado ? (
          <>
            <span className="tenant-bar-label">Tenant</span>
            <strong>{conexion.nombre}</strong>
            {conexion.esProduccion && <span className="tag tag-accent">Productivo</span>}
            <span className="tenant-bar-sep">·</span>
            <span className="tenant-bar-label">Planning Area</span>
            <strong>{conexion.planningArea}</strong>
            <span className="tenant-bar-sep">·</span>
            <span className="tenant-bar-label">Versión</span>
            <strong>{conexion.version === VERSION_BASE ? 'Versión base' : conexion.version}</strong>
          </>
        ) : (
          <span>Sin tenant seleccionado</span>
        )}
      </div>
      <button
        type="button"
        className={`btn btn-sm ${conectado ? 'btn-ghost' : 'btn-primary'}`}
        onClick={() => verAsistente(true)}
      >
        🔗 {conectado ? 'Cambiar tenant' : 'Conectar SAP IBP'}
      </button>
    </div>
  )
}
