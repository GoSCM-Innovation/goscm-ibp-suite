// Quién usa el tenant, con qué y cuánto.
//
// Portado de `Metering.jsx` de v8, con dos cambios de fondo:
//
//   - Las cuentas se hacen en el servidor. Allí el componente se traía las 15.623 filas de actividad
//     y las sumaba en el navegador —y como se quedaba con las primeras 1.000, el ranking de
//     aplicaciones estaba mal sin decirlo—. Aquí llegan hechas, y si la lectura se corta se avisa.
//
//   - Mirar a una persona o a un área vuelve a preguntar acotando EN SAP, no filtra lo ya traído.
//     Baja de 15.623 filas a 4.397 en el tenant de pruebas, y de paso el perfil sale del mismo
//     código que el resumen en vez de una pantalla aparte.

import { useCallback, useEffect, useMemo, useState } from 'react'

import { escribirDuracion, RANGOS_DE_CONSUMO } from '../../../core/ibp/metering-summary.js'
import { fetchMetering } from '../../lib/ibp-resources.js'
import { SinDatos } from '../ui/StatusCharts.jsx'

const PESTANAS = [
  { id: 'general', label: 'General' },
  { id: 'excel', label: 'Excel' },
  { id: 'aplicaciones', label: 'Aplicaciones' },
]

const numero = (valor) => Number(valor ?? 0).toLocaleString('es')

/** El color de una tasa de adopción o de éxito: verde si va bien, ámbar si preocupa, rojo si no. */
function colorDeTasa(tasa, { bien = 70, regular = 40 } = {}) {
  if (tasa === null || tasa === undefined) return undefined
  if (tasa >= bien) return 'var(--green)'
  return tasa >= regular ? 'var(--accent)' : 'var(--red)'
}

function Kpi({ etiqueta, valor, detalle, color }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{etiqueta}</div>
      <div className="kpi-valor" style={color ? { color } : undefined}>{valor}</div>
      {detalle && <div className="kpi-detalle">{detalle}</div>}
    </div>
  )
}

/** Un ranking con barra proporcional: con 300 aplicaciones lo que importa es qué está arriba. */
function Ranking({ titulo, filas, escribir = numero, alPulsar }) {
  const mayor = filas[0]?.total || 1

  return (
    <div className="card">
      <div className="card-label">{titulo}</div>
      {filas.length === 0
        ? <SinDatos />
        : filas.map((una) => {
          const contenido = (
            <>
              <span className="lista-nombre" title={una.nombre}>
                <div className="lista-titulo">{una.nombre}</div>
                <div className="barra-fondo">
                  <div className="barra-relleno" style={{ width: `${Math.max(2, (una.total / mayor) * 100)}%` }} />
                </div>
              </span>
              <span className="agente-estado">{escribir(una.total)}</span>
            </>
          )

          return alPulsar
            ? (
              <button type="button" className="lista-fila agente lista-pulsable" key={una.nombre} onClick={() => alPulsar(una)}>
                {contenido}
              </button>
            )
            : <div className="lista-fila agente" key={una.nombre}>{contenido}</div>
        })}
    </div>
  )
}

/** Barras a mano: son hasta noventa columnas de una sola serie y un gráfico pesaría más que los datos. */
function BarrasPorDia({ porDia }) {
  const mayor = Math.max(1, ...porDia.map((uno) => uno.total))

  return (
    <div className="card">
      <div className="card-label">Actividad por día</div>
      {porDia.length === 0
        ? <SinDatos />
        : (
          <>
            <div className="barras-dia">
              {porDia.map((uno) => (
                <div className="barra-dia" key={uno.dia} title={`${uno.dia}: ${uno.total}`}>
                  <div className="barra-dia-relleno" style={{ height: `${(uno.total / mayor) * 100}%` }} />
                </div>
              ))}
            </div>
            <div className="exp-sub barras-dia-pie">
              <span>{porDia[0].dia}</span>
              <span>máximo {mayor}</span>
              <span>{porDia[porDia.length - 1].dia}</span>
            </div>
          </>
        )}
    </div>
  )
}

function General({ datos, alElegirUsuario, alElegirArea }) {
  const [busqueda, setBusqueda] = useState('')

  const inactivos = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()
    if (!texto) return datos.inactivos
    return datos.inactivos.filter((uno) => `${uno.nombre} ${uno.id}`.toLowerCase().includes(texto))
  }, [datos.inactivos, busqueda])

  // Con un filtro puesto el servidor no manda la adopción, porque no significa nada mirando a una
  // sola persona. En su lugar, lo que sí dice algo de ella: cuándo fue la última vez que entró.
  const ultimaVez = datos.usuarios[0]?.ultima ?? '—'

  return (
    <>
      {datos.atencion.map((aviso) => (
        <div className={`notice notice-${aviso.tipo === 'error' ? 'error' : 'info'}`} key={aviso.mensaje}>
          {aviso.tipo === 'error' ? '⚠ ' : '○ '}{aviso.mensaje}
        </div>
      ))}

      <div className="grid-kpi">
        {datos.adopcion
          ? (
            <Kpi
              etiqueta="Adopción"
              valor={datos.adopcion.tasa === null ? '—' : `${datos.adopcion.tasa}%`}
              detalle={`${datos.adopcion.activos} de ${datos.adopcion.licenciados} usuarios`}
              color={colorDeTasa(datos.adopcion.tasa)}
            />
          )
          : (
            <Kpi
              etiqueta="Última actividad"
              valor={ultimaVez}
              detalle={`${datos.kpis.usuariosActivos} ${datos.kpis.usuariosActivos === 1 ? 'usuario' : 'usuarios'} en el filtro`}
            />
          )}
        <Kpi etiqueta="Sesiones" valor={numero(datos.kpis.sesiones)} detalle={`${datos.kpis.areasUsadas} áreas usadas`} />
        <Kpi
          etiqueta="Vistas de planificación"
          valor={numero(datos.kpis.vistasDePlanificacion)}
          detalle={datos.kpis.duracionMediaDeVista === null ? '' : `${escribirDuracion(datos.kpis.duracionMediaDeVista)} de media`}
        />
        <Kpi
          etiqueta="Tiempo en vistas"
          valor={escribirDuracion(datos.kpis.segundosEnVistas)}
          detalle={`${datos.kpis.entradasAExcel} entradas a Excel`}
        />
        <Kpi
          etiqueta="Acciones en aplicaciones"
          valor={numero(datos.kpis.accionesEnAplicaciones)}
          detalle={`${numero(datos.accionesDelComplemento)} del complemento de Excel`}
        />
      </div>

      <BarrasPorDia porDia={datos.porDia} />

      <div className="grid-stats">
        <div className="card">
          <div className="card-label">Adopción por herramienta</div>
          {datos.herramientas.length === 0
            ? <SinDatos />
            : (
              <div className="table-scroll">
                <table className="table-dense">
                  <thead>
                    <tr><th>Herramienta</th><th>Usuarios</th><th>% de activos</th><th>Eventos</th></tr>
                  </thead>
                  <tbody>
                    {datos.herramientas.map((una) => (
                      <tr key={una.nombre}>
                        <td>{una.nombre}</td>
                        <td>{una.usuarios}</td>
                        <td style={{ color: colorDeTasa(una.tasa, { bien: 50, regular: 20 }) }}>
                          {una.tasa === null ? '—' : `${una.tasa}%`}
                        </td>
                        <td>{numero(una.eventos)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>

        <div className="card">
          <div className="card-label">Usuarios activos</div>
          {datos.usuarios.length === 0
            ? <SinDatos />
            : (
              <div className="table-scroll">
                <table className="table-dense">
                  <thead>
                    <tr><th>Usuario</th><th>Eventos</th><th>Última vez</th><th>Áreas</th></tr>
                  </thead>
                  <tbody>
                    {datos.usuarios.map((uno) => (
                      <tr key={uno.id}>
                        <td>
                          <button type="button" className="enlace" onClick={() => alElegirUsuario(uno)}>
                            {uno.nombre}
                          </button>
                          <div className="exp-sub">{uno.id}</div>
                        </td>
                        <td>{numero(uno.eventos)}</td>
                        <td>{uno.ultima}</td>
                        <td className="exp-sub">{uno.areas.join(', ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>

        <Ranking titulo="Áreas de planificación" filas={datos.porArea} alPulsar={alElegirArea} />
        <Ranking titulo="Componentes de facturación" filas={datos.porComponente} />

        {/* Con un filtro puesto no hay lista de inactivos: sería "todos menos este". */}
        {datos.adopcion && (
        <div className="card">
          <div className="card-label">Sin actividad en el período ({datos.inactivos.length})</div>
          {datos.inactivos.length === 0
            ? <p className="todo-bien">✓ Todos los usuarios dados de alta usaron el tenant</p>
            : (
              <>
                <input
                  className="input input-sm"
                  value={busqueda}
                  onChange={(evento) => setBusqueda(evento.target.value)}
                  placeholder="Buscar por nombre o identificador"
                />
                {inactivos.slice(0, 30).map((uno) => (
                  <div className="lista-fila agente" key={uno.id}>
                    <span className="lista-nombre">{uno.nombre}</span>
                    <span className="agente-estado exp-sub">{uno.id}</span>
                  </div>
                ))}
                {inactivos.length > 30 && (
                  <div className="exp-sub">y {inactivos.length - 30} más; afiná la búsqueda para verlos.</div>
                )}
              </>
            )}
        </div>
        )}
      </div>
    </>
  )
}

function Excel({ datos, alElegirArea }) {
  const { excel } = datos

  return (
    <>
      <div className="grid-kpi">
        <Kpi
          etiqueta="Vistas correctas"
          valor={excel.tasa === null ? '—' : `${excel.tasa}%`}
          detalle={`${numero(excel.fallidas)} fallidas de ${numero(excel.total)}`}
          color={colorDeTasa(excel.tasa, { bien: 90, regular: 70 })}
        />
        <Kpi
          etiqueta="Duración media"
          valor={excel.segundosMedios === null ? '—' : escribirDuracion(excel.segundosMedios)}
          detalle="por vista de planificación"
          color={excel.segundosMedios === null ? undefined : colorDeTasa(excel.segundosMedios > 120 ? 0 : excel.segundosMedios > 60 ? 50 : 100)}
        />
        <Kpi etiqueta="Celdas leídas" valor={numero(excel.celdas)} detalle={`${numero(excel.total)} vistas`} />
        <Kpi
          etiqueta="Entrada a Excel"
          valor={excel.segundosMediosDeEntrada === null ? '—' : escribirDuracion(excel.segundosMediosDeEntrada)}
          detalle={`${numero(datos.kpis.entradasAExcel)} entradas`}
        />
      </div>

      <div className="grid-stats">
        <Ranking titulo="Qué se hace en Excel" filas={excel.porTipo} />
        <Ranking titulo="Cifras clave modificadas" filas={datos.porCifraClave} />

        <div className="card">
          <div className="card-label">Rendimiento por área</div>
          {excel.porArea.length === 0
            ? <SinDatos />
            : (
              <div className="table-scroll">
                <table className="table-dense">
                  <thead>
                    <tr><th>Área</th><th>Vistas</th><th>Fallidas</th><th>Media</th></tr>
                  </thead>
                  <tbody>
                    {excel.porArea.map((una) => (
                      <tr key={una.nombre}>
                        <td>
                          <button type="button" className="enlace" onClick={() => alElegirArea({ nombre: una.nombre })}>
                            {una.nombre}
                          </button>
                        </td>
                        <td>{numero(una.vistas)}</td>
                        <td style={{ color: una.tasaDeError > 30 ? 'var(--red)' : undefined }}>
                          {una.fallidas} ({una.tasaDeError}%)
                        </td>
                        <td>{escribirDuracion(una.segundosMedios)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>

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
                        <td>{numero(una.celdas)}</td>
                        <td>{escribirDuracion(una.segundos)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </div>
    </>
  )
}

function Aplicaciones({ datos }) {
  return (
    <>
      <div className="grid-kpi">
        <Kpi
          etiqueta="Acciones en aplicaciones"
          valor={numero(datos.kpis.accionesEnAplicaciones)}
          detalle="sin contar el complemento de Excel"
        />
        <Kpi
          etiqueta="Acciones del complemento"
          valor={numero(datos.accionesDelComplemento)}
          detalle="SAP las mide en el mismo sitio"
        />
        <Kpi etiqueta="Alertas" valor={numero(datos.kpis.alertas)} detalle="en el monitor de alertas" />
      </div>

      <div className="grid-stats">
        <Ranking titulo="Aplicaciones más usadas" filas={datos.porAplicacion} />
        <Ranking titulo="Usuarios más activos" filas={datos.porUsuario} />
      </div>
    </>
  )
}

export default function Metering({ conexionId }) {
  const [dias, setDias] = useState(30)
  const [contexto, setContexto] = useState(null)
  const [pestana, setPestana] = useState('general')
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(() => {
    let abandonado = false
    setCargando(true)

    fetchMetering(conexionId, {
      dias,
      usuario: contexto?.tipo === 'usuario' ? contexto.id : '',
      area: contexto?.tipo === 'area' ? contexto.id : '',
    })
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
  }, [conexionId, dias, contexto])

  useEffect(() => {
    const id = setTimeout(cargar, 0)
    return () => clearTimeout(id)
  }, [cargar])

  const elegirUsuario = useCallback((uno) => setContexto({ tipo: 'usuario', id: uno.id, nombre: uno.nombre }), [])
  const elegirArea = useCallback((una) => setContexto({ tipo: 'area', id: una.nombre, nombre: una.nombre }), [])

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

        {contexto && (
          <button type="button" className="tag tag-accent" onClick={() => setContexto(null)}>
            {contexto.tipo === 'usuario' ? '👤' : '▦'} {contexto.nombre} ✕
          </button>
        )}

        <span className="page-hint">
          {cargando
            ? 'Consultando… puede tardar unos segundos'
            : contexto
              ? `Solo ${contexto.tipo === 'usuario' ? 'esta persona' : 'esta área'}; pulsá la etiqueta para volver al tenant entero`
              : `${datos?.adopcion?.activos ?? 0} de ${datos?.adopcion?.licenciados ?? 0} usuarios activos en el período`}
        </span>
      </div>

      {error && <div className="notice notice-error">✕ {error}</div>}
      {(datos?.avisos ?? []).map((aviso) => (
        <div className="notice notice-info" key={aviso}>{aviso}</div>
      ))}

      {datos && (
        <>
          <div className="tabs tabs-sub">
            {PESTANAS.map((una) => (
              <button
                key={una.id}
                type="button"
                className={`tab${pestana === una.id ? ' active' : ''}`}
                onClick={() => setPestana(una.id)}
                aria-pressed={pestana === una.id}
              >
                {una.label}
              </button>
            ))}
          </div>

          <div className="tablero">
            {pestana === 'general' && (
              <General datos={datos} alElegirUsuario={elegirUsuario} alElegirArea={elegirArea} />
            )}
            {pestana === 'excel' && <Excel datos={datos} alElegirArea={elegirArea} />}
            {pestana === 'aplicaciones' && <Aplicaciones datos={datos} />}
          </div>
        </>
      )}
    </div>
  )
}
