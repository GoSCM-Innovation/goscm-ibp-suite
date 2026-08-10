// Las últimas llamadas que hizo la aplicación, plegado hasta que alguien lo abre.
//
// Portado de `TechLogs.jsx`, que estaba escrito dos veces —v8 y v9— con la misma idea. Uno solo, y lo
// usan los dos módulos: es fontanería de diagnóstico, no funcionalidad de negocio.
//
// No registra nada: lee lo que `api.js` anota. Ver `lib/tech-logs.js` para por qué está así.
//
// Para qué sirve: cuando alguien dice "no carga", esto contesta si la llamada salió, con qué estado y
// cuánto tardó, sin pedirle que abra las herramientas del navegador.

import { useEffect, useState } from 'react'

import { agrupar, limpiarLlamadas, llamadas, suscribir } from '../../lib/tech-logs.js'

/** El color de un estado: verde si salió, rojo si no, ámbar si no hubo respuesta. */
function colorDe(estado) {
  if (estado === 0) return 'var(--accent)'
  return estado >= 200 && estado < 400 ? 'var(--green)' : 'var(--red)'
}

const hora = (cuando) => new Date(cuando).toLocaleTimeString('es', { hour12: false })

export default function TechLogs() {
  const [abierto, setAbierto] = useState(false)
  const [registro, setRegistro] = useState(llamadas)

  // El registro vive fuera de React, así que hay que enterarse de los cambios. Se suscribe siempre,
  // no solo estando abierto: el contador del botón tiene que subir aunque el panel esté plegado.
  useEffect(() => suscribir(() => setRegistro(llamadas())), [])

  const grupos = agrupar(registro)
  const fallidas = registro.filter((una) => una.estado === 0 || una.estado >= 400).length

  return (
    <div className="tech-logs">
      <button type="button" className="btn btn-sm" onClick={() => setAbierto((previo) => !previo)}>
        {abierto ? '▾' : '▸'} Llamadas técnicas
        {registro.length > 0 && <span className="exp-count">{registro.length}</span>}
        {fallidas > 0 && <span className="exp-count" style={{ color: 'var(--red)' }}>{fallidas} con fallo</span>}
      </button>

      {abierto && (
        <div className="tech-logs-cuerpo">
          {registro.length === 0
            ? <div className="exp-sub tech-logs-fila">Todavía no hubo ninguna llamada.</div>
            : (
              <>
                {grupos.map((grupo) => (
                  <div className="tech-logs-fila" key={`${grupo.clave}|${grupo.llamada.cuando}`}>
                    {grupo.veces > 1 && <span className="exp-count">×{grupo.veces}</span>}
                    <span className="mono" style={{ color: colorDe(grupo.llamada.estado) }}>
                      {grupo.llamada.estado === 0 ? 'sin respuesta' : grupo.llamada.estado}
                    </span>
                    <span className="mono">{grupo.llamada.metodo} {grupo.llamada.ruta}</span>
                    <span className="exp-sub">{grupo.llamada.ms} ms · {hora(grupo.llamada.cuando)}</span>
                    {grupo.llamada.detalle && (
                      <span className="exp-sub tech-logs-detalle">{grupo.llamada.detalle}</span>
                    )}
                  </div>
                ))}

                <div className="tech-logs-fila">
                  <button type="button" className="btn btn-sm" onClick={limpiarLlamadas}>Limpiar</button>
                  <span className="exp-sub">
                    Se guardan en memoria y se pierden al recargar. No salen del navegador.
                  </span>
                </div>
              </>
            )}
        </div>
      )}
    </div>
  )
}
