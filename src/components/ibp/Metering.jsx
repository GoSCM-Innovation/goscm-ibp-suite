// Quién usa el tenant, con qué y cuánto.
//
// Portado de `Metering.jsx` de v8, con las cuentas movidas al servidor: allí el componente se traía
// las 15.623 filas de actividad y las sumaba en el navegador —y como se quedaba con las primeras
// 1.000, el ranking de aplicaciones estaba mal sin decirlo—. Aquí llegan los rankings ya hechos, y
// cuando la lectura se corta, la pantalla lo dice.

import { useCallback, useEffect, useMemo, useState } from 'react'

import { escribirDuracion, RANGOS_DE_CONSUMO } from '../../../core/ibp/metering-summary.js'
import { fetchMetering } from '../../lib/ibp-resources.js'
import { SinDatos } from '../ui/StatusCharts.jsx'

function Kpi({ etiqueta, valor, detalle }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{etiqueta}</div>
      <div className="kpi-valor">{valor}</div>
      {detalle && <div className="kpi-detalle">{detalle}</div>}
    </div>
  )
}

/** Un ranking con barra proporcional: con 300 aplicaciones lo que importa es qué está arriba. */
function Ranking({ titulo, filas, escribir = (total) => total.toLocaleString('es') }) {
  const mayor = filas[0]?.total || 1

  return (
    <div className="card">
      <div className="card-label">{titulo}</div>
      {filas.length === 0
        ? <SinDatos />
        : filas.map((una) => (
          <div className="lista-fila agente" key={una.nombre}>
            <span className="lista-nombre" title={una.nombre}>
              <div className="lista-titulo">{una.nombre}</div>
              <div className="barra-fondo">
                <div className="barra-relleno" style={{ width: `${Math.max(2, (una.total / mayor) * 100)}%` }} />
              </div>
            </span>
            <span className="agente-estado">{escribir(una.total)}</span>
          </div>
        ))}
    </div>
  )
}

export default function Metering({ conexionId }) {
  const [dias, setDias] = useState(30)
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(() => {
    let abandonado = false
    setCargando(true)

    fetchMetering(conexionId, dias)
      .then((respuesta) => {
        if (abandonado) return
        setDatos(respuesta)
        setError('')
        setCargando(false)
      })
      .catch((fallo) => {
        if (abandonado) return
        setError(fallo.message)
        setCargando(false)
      })

    return () => { abandonado = true }
  }, [conexionId, dias])

  useEffect(() => {
    const id = setTimeout(cargar, 0)
    return () => clearTimeout(id)
  }, [cargar])

  const kpis = datos?.kpis ?? null
  const porDia = useMemo(() => datos?.porDia ?? [], [datos])
  const maximoDelDia = useMemo(() => Math.max(1, ...porDia.map((uno) => uno.total)), [porDia])

  return (
    <div className="module-body">
      <div className="monitor-bar">
        <div className="seg">
          {RANGOS_DE_CONSUMO.map((rango) => (
            <button
              key={rango.dias}
              type="button"
              className={`seg-btn${dias === rango.dias ? ' active' : ''}`}
              onClick={() => setDias(rango.dias)}
              aria-pressed={dias === rango.dias}
            >
              {rango.label}
            </button>
          ))}
        </div>

        <button type="button" className="btn btn-sm" onClick={cargar} disabled={cargando}>↺ Actualizar</button>

        <span className="page-hint">
          {cargando ? 'Consultando… puede tardar unos segundos' : `${kpis?.usuariosActivos ?? 0} usuarios activos en el período`}
        </span>
      </div>

      {error && <div className="notice notice-error">✕ {error}</div>}
      {(datos?.avisos ?? []).map((aviso) => (
        <div className="notice notice-info" key={aviso}>{aviso}</div>
      ))}

      {kpis && (
        <div className="tablero">
          <div className="grid-kpi">
            <Kpi
              etiqueta="Usuarios activos"
              valor={kpis.usuariosActivos}
              detalle={`de ${kpis.usuariosDelTenant} dados de alta`}
            />
            <Kpi etiqueta="Sesiones" valor={kpis.sesiones.toLocaleString('es')} detalle={`${kpis.areasUsadas} áreas usadas`} />
            <Kpi
              etiqueta="Vistas de planificación"
              valor={kpis.vistasDePlanificacion.toLocaleString('es')}
              detalle={kpis.duracionMediaDeVista === null ? '' : `${escribirDuracion(kpis.duracionMediaDeVista)} de media`}
            />
            <Kpi
              etiqueta="Tiempo en vistas"
              valor={escribirDuracion(kpis.segundosEnVistas)}
              detalle={`${kpis.entradasAExcel} entradas a Excel`}
            />
            <Kpi
              etiqueta="Acciones en aplicaciones"
              valor={kpis.accionesEnAplicaciones.toLocaleString('es')}
              detalle={`${datos.accionesDelComplemento.toLocaleString('es')} del complemento de Excel`}
            />
          </div>

          <div className="card">
            <div className="card-label">Actividad por día</div>
            {porDia.length === 0
              ? <SinDatos />
              : (
                // Barras a mano y no un gráfico: son hasta noventa columnas de una sola serie, y el
                // eje y la leyenda de recharts ocuparían más que los datos.
                <div className="barras-dia">
                  {porDia.map((uno) => (
                    <div className="barra-dia" key={uno.dia} title={`${uno.dia}: ${uno.total}`}>
                      <div className="barra-dia-relleno" style={{ height: `${(uno.total / maximoDelDia) * 100}%` }} />
                    </div>
                  ))}
                </div>
              )}
            {porDia.length > 0 && (
              <div className="exp-sub barras-dia-pie">
                <span>{porDia[0].dia}</span>
                <span>máximo {maximoDelDia}</span>
                <span>{porDia[porDia.length - 1].dia}</span>
              </div>
            )}
          </div>

          <div className="grid-stats">
            <Ranking titulo="Usuarios más activos" filas={datos.porUsuario} />
            <Ranking titulo="Aplicaciones más usadas" filas={datos.porAplicacion} />
            <Ranking titulo="Áreas de planificación" filas={datos.porArea} />
            <Ranking titulo="Componentes de facturación" filas={datos.porComponente} />
            <Ranking titulo="Cifras clave modificadas" filas={datos.porCifraClave} />

            <div className="card">
              <div className="card-label">Vistas más lentas</div>
              {datos.vistasMasLentas.length === 0
                ? <SinDatos />
                : (
                  <div className="table-scroll">
                    <table className="table-dense">
                      <thead>
                        <tr><th>Vista</th><th>Área</th><th>Celdas</th><th>Duración</th></tr>
                      </thead>
                      <tbody>
                        {datos.vistasMasLentas.map((una, indice) => (
                          <tr key={`${una.plantilla}|${una.usuario}|${indice}`}>
                            <td>
                              {una.plantilla}
                              <div className="exp-sub">{una.usuario}</div>
                            </td>
                            <td>{una.area}</td>
                            <td>{una.celdas.toLocaleString('es')}</td>
                            <td>{escribirDuracion(una.segundos)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
