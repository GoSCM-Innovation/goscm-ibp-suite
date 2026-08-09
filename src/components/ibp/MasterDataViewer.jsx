// Mirar el dato maestro de un tenant: elegir área, versión y tabla, y recorrer las filas.
//
// Portado de `DataViewer/MasterDataViewer.jsx` de v8, de solo lectura. Editar y borrar cambian el
// tenant y van en su propia pantalla, con su confirmación.
//
// Dos decisiones que vienen de v8 y se conservan porque están ganadas contra tenants reales:
//
//   - Las columnas y el filtro se editan sin consultar; hay que pulsar «Mostrar datos». Una tabla de
//     ocho mil filas y sesenta columnas no se puede releer con cada tecla.
//   - Al paginar se ordena por las claves de negocio. Sin un orden estable, dos ventanas sobre una
//     tabla que alguien está tocando se solapan y dejan huecos.

import { useCallback, useEffect, useMemo, useState } from 'react'

import { columnasPorOmision, etiquetaDeCondicion, OPERADORES, valorLegible } from '../../../core/ibp/master-data-model.js'
import {
  fetchMasterCatalog, fetchMasterCount, fetchMasterRows, fetchMasterSchema, fetchMasterValues,
} from '../../lib/ibp-master-data.js'

const numero = (valor) => Number(valor ?? 0).toLocaleString('es')

/** La versión base no tiene identificador propio en SAP; se elige con la cadena vacía. */
const VERSION_BASE = ''

function Condicion({ condicion, columnas, valores, onCambiar, onQuitar, onPedirValores }) {
  const operador = OPERADORES.find((uno) => uno.id === condicion.op) ?? OPERADORES[0]

  return (
    <div className="condicion">
      <select
        className="select input-sm"
        value={condicion.field}
        onChange={(evento) => onCambiar({ ...condicion, field: evento.target.value, value: '' })}
        aria-label="Campo"
      >
        <option value="">Elegí un campo…</option>
        {columnas.map((columna) => <option key={columna} value={columna}>{columna}</option>)}
      </select>

      <select
        className="select input-sm"
        value={condicion.op}
        onChange={(evento) => onCambiar({ ...condicion, op: evento.target.value })}
        aria-label="Operador"
      >
        {OPERADORES.map((uno) => <option key={uno.id} value={uno.id}>{uno.label}</option>)}
      </select>

      {operador.id === 'nb'
        ? <span className="exp-sub condicion-ayuda">{operador.ayuda}</span>
        : (
          <>
            <input
              className="input input-sm"
              value={condicion.value}
              onChange={(evento) => onCambiar({ ...condicion, value: evento.target.value })}
              placeholder={operador.ayuda}
              list={`valores-${condicion.id}`}
            />
            <datalist id={`valores-${condicion.id}`}>
              {(valores ?? []).map((uno) => <option key={uno} value={uno} />)}
            </datalist>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => onPedirValores(condicion.field)}
              disabled={!condicion.field}
              title="Traer los valores que existen en la tabla"
            >
              ⌄
            </button>
          </>
        )}

      <button type="button" className="btn btn-sm" onClick={onQuitar} aria-label="Quitar la condición">✕</button>
    </div>
  )
}

export default function MasterDataViewer({ conexionId }) {
  const [catalogo, setCatalogo] = useState(null)
  const [importables, setImportables] = useState([])
  const [error, setError] = useState('')

  const [area, setArea] = useState('')
  const [versionPedida, setVersionPedida] = useState(VERSION_BASE)
  const [tabla, setTabla] = useState('')
  const [busqueda, setBusqueda] = useState('')

  const [esquema, setEsquema] = useState(null)
  const [cargandoEsquema, setCargandoEsquema] = useState(false)
  const [columnas, setColumnas] = useState([])
  const [condiciones, setCondiciones] = useState([])
  const [valoresDe, setValoresDe] = useState({})
  const [prueba, setPrueba] = useState(null)

  const [consulta, setConsulta] = useState(null)
  const [filas, setFilas] = useState([])
  const [pagina, setPagina] = useState(0)
  const [cargandoFilas, setCargandoFilas] = useState(false)

  useEffect(() => {
    let abandonado = false
    fetchMasterCatalog(conexionId)
      .then((respuesta) => {
        if (abandonado) return
        setCatalogo(respuesta.catalogo)
        setImportables(respuesta.importables)
        const primera = Object.keys(respuesta.catalogo)[0]
        if (primera) setArea(primera)
      })
      .catch((fallo) => {
        if (abandonado) return
        setError(fallo.message)
        setCatalogo({})
      })
    return () => { abandonado = true }
  }, [conexionId])

  const versiones = useMemo(() => catalogo?.[area]?.versions ?? [], [catalogo, area])

  // La versión que se está mirando se DERIVA, no se guarda aparte: al cambiar de área, la que estaba
  // puesta casi nunca existe en la nueva, y dejarla dejaba la lista de tablas vacía sin explicar por
  // qué. Cayendo a la primera del área, el selector siempre muestra algo que existe.
  const version = versiones.some((una) => una.id === versionPedida)
    ? versionPedida
    : versiones[0]?.id ?? VERSION_BASE

  const tablas = useMemo(() => {
    const dela = versiones.find((una) => una.id === version)?.mdts ?? []
    const texto = busqueda.trim().toUpperCase()
    return texto ? dela.filter((una) => una.includes(texto)) : dela
  }, [versiones, version, busqueda])

  /** Cambiar de tabla, de área o de versión invalida todo lo que se estaba mirando. */
  const olvidarLoMirado = useCallback(() => {
    setEsquema(null)
    setColumnas([])
    setCondiciones([])
    setValoresDe({})
    setPrueba(null)
    setConsulta(null)
    setFilas([])
    setPagina(0)
  }, [])

  useEffect(() => {
    if (!tabla) return undefined
    let abandonado = false

    // Diferido para no encadenar renders: pedir y marcar «cargando» en el cuerpo del efecto hace
    // que React vuelva a dibujar antes de terminar el que está haciendo.
    const id = setTimeout(() => {
      setCargandoEsquema(true)
      fetchMasterSchema(conexionId, { entidad: tabla, planningArea: area, versionId: version })
        .then((leido) => {
          if (abandonado) return
          setEsquema(leido)
          setColumnas(columnasPorOmision(leido.columnas, leido.claves))
          setError('')
        })
        .catch((fallo) => { if (!abandonado) setError(fallo.message) })
        .finally(() => { if (!abandonado) setCargandoEsquema(false) })
    }, 0)

    return () => { abandonado = true; clearTimeout(id) }
  }, [conexionId, tabla, area, version])

  const cargarPagina = useCallback((cual) => {
    if (!consulta) return
    setCargandoFilas(true)

    fetchMasterRows(conexionId, {
      ...consulta,
      skip: cual * consulta.top,
    })
      .then((leidas) => { setFilas(leidas); setPagina(cual); setError('') })
      .catch((fallo) => setError(fallo.message))
      .finally(() => setCargandoFilas(false))
  }, [conexionId, consulta])

  // Una consulta nueva empieza por su primera página. Diferido por lo mismo que el esquema.
  useEffect(() => {
    if (!consulta) return undefined
    const id = setTimeout(() => cargarPagina(0), 0)
    return () => clearTimeout(id)
  }, [consulta, cargarPagina])

  function mostrarDatos() {
    if (!esquema) return
    setConsulta({
      entidad: tabla,
      planningArea: area,
      versionId: version,
      condiciones: condiciones.filter((una) => una.field),
      select: columnas,
      orderby: esquema.claves,
      top: Math.min(esquema.filasPorPagina, 500),
    })
  }

  async function probarFiltro() {
    const usadas = condiciones.filter((una) => una.field)
    setPrueba({ cargando: true })
    try {
      const total = await fetchMasterCount(conexionId, {
        entidad: tabla, planningArea: area, versionId: version, condiciones: usadas,
      })
      // Se guarda CON las condiciones que se contaron. Si después se cambia el filtro y se muestran
      // datos sin volver a contar, la cuenta vieja ya no vale y el número de páginas mentiría.
      setPrueba({ total, para: JSON.stringify(usadas) })
    } catch (fallo) {
      setPrueba({ error: fallo.message })
    }
  }

  async function pedirValores(campo) {
    if (!campo || valoresDe[campo]) return
    try {
      const valores = await fetchMasterValues(conexionId, {
        entidad: tabla, campo, planningArea: area, versionId: version,
      })
      setValoresDe((previos) => ({ ...previos, [campo]: valores }))
    } catch {
      // Traer los valores es una comodidad: si el campo no se deja proyectar, se escribe a mano.
      setValoresDe((previos) => ({ ...previos, [campo]: [] }))
    }
  }

  if (catalogo === null) return <div className="page-hint">Cargando el catálogo del tenant…</div>

  if (Object.keys(catalogo).length === 0) {
    return (
      <div className="module-body">
        {error
          ? <div className="notice notice-error">✕ {error}</div>
          : (
            <div className="notice notice-info">
              Este tenant no expone tipos de dato maestro específicos de versión, o el acuerdo
              SAP_COM_0720 no está configurado para esta conexión.
            </div>
          )}
      </div>
    )
  }

  // Cuántas páginas hay solo se sabe si se contó ESTA consulta. Sin filtro vale la cuenta de la
  // tabla; con un filtro sin contar, no se dice un número inventado.
  const totalDeLaConsulta = consulta
    ? (consulta.condiciones.length === 0
      ? esquema?.total
      : (prueba?.para === JSON.stringify(consulta.condiciones) ? prueba.total : null))
    : null
  const paginas = totalDeLaConsulta && consulta ? Math.ceil(totalDeLaConsulta / consulta.top) : 0

  return (
    <div className="module-body">
      <div className="monitor-bar">
        <select
          className="select input-sm"
          value={area}
          onChange={(evento) => { setArea(evento.target.value); setTabla(''); olvidarLoMirado() }}
          aria-label="Área de planificación"
        >
          {Object.entries(catalogo).map(([id, una]) => (
            <option key={id} value={id}>{una.desc === id ? id : `${id} — ${una.desc}`}</option>
          ))}
        </select>

        <select
          className="select input-sm"
          value={version}
          onChange={(evento) => { setVersionPedida(evento.target.value); setTabla(''); olvidarLoMirado() }}
          aria-label="Versión"
        >
          {versiones.map((una) => (
            <option key={una.id} value={una.id}>{una.name === una.id ? una.id : `${una.id} — ${una.name}`}</option>
          ))}
        </select>

        <input
          className="input input-sm"
          value={busqueda}
          onChange={(evento) => setBusqueda(evento.target.value)}
          placeholder={`Buscar entre ${numero(versiones.find((una) => una.id === version)?.mdts.length ?? 0)} tablas`}
        />

        <select
          className="select input-sm"
          value={tabla}
          onChange={(evento) => { olvidarLoMirado(); setTabla(evento.target.value) }}
          aria-label="Tabla"
        >
          <option value="">Elegí una tabla…</option>
          {tablas.map((una) => (
            <option key={una} value={una}>{una}{importables.includes(una) ? ' ·' : ''}</option>
          ))}
        </select>
      </div>

      {error && <div className="notice notice-error">✕ {error}</div>}
      {cargandoEsquema && <div className="page-hint">Leyendo la tabla…</div>}

      {esquema?.vacia && (
        <div className="notice notice-info">
          {tabla} no tiene ninguna fila en {area}{version ? ` · ${version}` : ''}. Sin una fila de
          muestra no se pueden deducir sus columnas.
        </div>
      )}

      {esquema && !esquema.vacia && (
        <>
          <div className="tablero">
            <div className="card">
              <div className="card-label">
                {tabla} · {numero(esquema.total)} filas · {esquema.columnas.length} columnas
                {esquema.claves.length > 0 && <span className="exp-sub"> · clave: {esquema.claves.join(', ')}</span>}
              </div>

              <div className="exp-sub">Columnas ({columnas.length} de {esquema.columnas.length})</div>
              <div className="columnas">
                {esquema.columnas.map((columna) => {
                  const esClave = esquema.claves.includes(columna)
                  return (
                    <label key={columna} className={`columna${esClave ? ' columna-clave' : ''}`}>
                      <input
                        type="checkbox"
                        checked={columnas.includes(columna)}
                        onChange={(evento) => setColumnas((previas) => (evento.target.checked
                          ? esquema.columnas.filter((una) => previas.includes(una) || una === columna)
                          : previas.filter((una) => una !== columna)))}
                      />
                      {columna}
                    </label>
                  )
                })}
              </div>

              <div className="monitor-bar">
                <button type="button" className="btn btn-sm" onClick={() => setColumnas(esquema.columnas)}>Todas</button>
                <button type="button" className="btn btn-sm" onClick={() => setColumnas(columnasPorOmision(esquema.columnas, esquema.claves))}>Las de siempre</button>
                <button type="button" className="btn btn-sm" onClick={() => setColumnas(esquema.claves)} disabled={esquema.claves.length === 0}>Solo las claves</button>
              </div>
            </div>

            <div className="card">
              <div className="card-label">
                Filtro
                {condiciones.map(etiquetaDeCondicion).filter(Boolean).map((chip) => (
                  <span className="tag" key={chip}>{chip}</span>
                ))}
              </div>

              {/* Solo operadores de inclusión: se trae exactamente lo que nombran. «Distinto de» no
                  existe a propósito — en SAP también descarta las filas con el campo vacío. */}
              {condiciones.map((una) => (
                <Condicion
                  key={una.id}
                  condicion={una}
                  columnas={esquema.columnas}
                  valores={valoresDe[una.field]}
                  onPedirValores={pedirValores}
                  onCambiar={(cambiada) => setCondiciones((previas) => previas.map((otra) => (otra.id === una.id ? cambiada : otra)))}
                  onQuitar={() => setCondiciones((previas) => previas.filter((otra) => otra.id !== una.id))}
                />
              ))}

              <div className="monitor-bar">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setCondiciones((previas) => [...previas, { id: `c${previas.length}${Date.now()}`, field: '', op: 'in', value: '' }])}
                >
                  + Condición
                </button>
                <button type="button" className="btn btn-sm" onClick={probarFiltro} disabled={prueba?.cargando}>
                  {prueba?.cargando ? 'Contando…' : 'Probar el filtro'}
                </button>
                {prueba?.total !== undefined && (
                  <span className="page-hint">{numero(prueba.total)} de {numero(esquema.total)} filas</span>
                )}
                {prueba?.error && <span className="page-hint" style={{ color: 'var(--red)' }}>{prueba.error}</span>}
              </div>
            </div>
          </div>

          <div className="monitor-bar">
            <button type="button" className="btn btn-sm btn-primary" onClick={mostrarDatos} disabled={columnas.length === 0}>
              Mostrar datos
            </button>
            {consulta && (
              <>
                <button type="button" className="btn btn-sm" onClick={() => cargarPagina(pagina - 1)} disabled={pagina === 0 || cargandoFilas}>‹ Anterior</button>
                <span className="page-hint">
                  Página {pagina + 1}{paginas > 0 ? ` de ${numero(paginas)}` : ''} · {numero(filas.length)} filas
                </span>
                <button type="button" className="btn btn-sm" onClick={() => cargarPagina(pagina + 1)} disabled={filas.length < consulta.top || cargandoFilas}>Siguiente ›</button>
              </>
            )}
            {esquema.claves.length === 0 && consulta && (
              <span className="page-hint" style={{ color: 'var(--accent)' }}>
                Sin claves no hay orden estable: al pasar de página puede haber solapes.
              </span>
            )}
          </div>

          {consulta && (
            <div className="table-scroll table-alta">
              <table className="table-dense">
                <thead>
                  <tr>{consulta.select.map((columna) => <th key={columna}>{columna}</th>)}</tr>
                </thead>
                <tbody>
                  {filas.map((fila, indice) => (
                    <tr key={esquema.claves.map((clave) => fila[clave]).join('|') || indice}>
                      {consulta.select.map((columna) => <td key={columna}>{valorLegible(fila[columna])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!cargandoFilas && filas.length === 0 && <div className="sin-datos">Ninguna fila cumple el filtro</div>}
              {cargandoFilas && <div className="sin-datos">Consultando…</div>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
