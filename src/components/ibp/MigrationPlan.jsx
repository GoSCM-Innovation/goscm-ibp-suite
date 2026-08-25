// Qué se copiaría de un tenant a otro, antes de copiar nada.
//
// Portado de la fase de análisis de `Migration.jsx` de v8. La carga en sí todavía no está: escribir
// en un tenant no es algo que se estrene sin nadie delante.
//
// Lo que esta pantalla responde, y que en v8 solo se veía dentro del diálogo de confirmación justo
// antes de cargar, es: con qué tabla del destino se emparejó cada una, qué columnas se van a perder
// por el camino y cuántas filas hay de verdad.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'

import { revisarEntrada, sePuedeCopiar } from '../../../core/ibp/migration-plan.js'
import { listIbpConnections } from '../../lib/ibp.js'
import { fetchMasterCatalog } from '../../lib/ibp-master-data.js'
import { useGuardaDeSalida } from '../../lib/guarda-de-salida.js'
import { fetchMigrationPlan, runMigrationSegment } from '../../lib/ibp-migration.js'
import FiltroDeTabla from './FiltroDeTabla.jsx'
import Modal from '../ui/Modal.jsx'

const numero = (valor) => (valor === null || valor === undefined ? '—' : Number(valor).toLocaleString('es'))

/** El color y la etiqueta de cada estado. Los dos primeros impiden copiar; el resto avisa. */
const ESTADOS = {
  'sin-pareja': { label: 'Sin pareja', color: 'var(--red)' },
  'sin-campos': { label: 'Sin columnas en común', color: 'var(--red)' },
  'a-ciegas': { label: 'No se pudo comparar', color: 'var(--accent)' },
  'con-perdida': { label: 'Se pierden columnas', color: 'var(--accent)' },
  vacia: { label: 'Vacía', color: 'var(--text3)' },
  ok: { label: 'Lista', color: 'var(--green)' },
}

/** El selector de un lado: conexión, área y versión. */
function Lado({ titulo, conexiones, valor, onCambiar, catalogo, cargando }) {
  const versiones = catalogo?.[valor.planningArea]?.versions ?? []

  return (
    <div className="card">
      <div className="card-label">{titulo}</div>

      <select
        className="select input-sm"
        value={valor.connectionId}
        onChange={(evento) => onCambiar({ connectionId: evento.target.value, planningArea: '', versionId: '' })}
        aria-label={`Tenant de ${titulo}`}
      >
        <option value="">Elige un tenant…</option>
        {conexiones.map((una) => <option key={una.id} value={una.id}>{una.name}</option>)}
      </select>

      {cargando && <div className="exp-sub">Leyendo el catálogo…</div>}

      {catalogo && (
        <>
          <select
            className="select input-sm"
            value={valor.planningArea}
            onChange={(evento) => onCambiar({ ...valor, planningArea: evento.target.value, versionId: '' })}
            aria-label={`Área de ${titulo}`}
          >
            <option value="">Elige un área…</option>
            {Object.entries(catalogo).map(([id, una]) => (
              <option key={id} value={id}>{una.desc === id ? id : `${id} — ${una.desc}`}</option>
            ))}
          </select>

          <select
            className="select input-sm"
            value={valor.versionId}
            onChange={(evento) => onCambiar({ ...valor, versionId: evento.target.value })}
            aria-label={`Versión de ${titulo}`}
            disabled={versiones.length === 0}
          >
            <option value="">Elige una versión…</option>
            {versiones.map((una) => (
              <option key={una.id} value={una.id}>{una.name === una.id ? una.id : `${una.id} — ${una.name}`}</option>
            ))}
          </select>
        </>
      )}
    </div>
  )
}

/** Lee el catálogo de un tenant cuando cambia la conexión elegida. */
function useCatalogo(connectionId) {
  const [catalogo, setCatalogo] = useState(null)
  const [tablas, setTablas] = useState([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!connectionId) return undefined
    let abandonado = false

    const id = setTimeout(() => {
      setCargando(true)
      setCatalogo(null)
      fetchMasterCatalog(connectionId)
        .then((leido) => {
          if (abandonado) return
          setCatalogo(leido.catalogo)
          setTablas(leido.importables)
          setError('')
        })
        .catch((fallo) => { if (!abandonado) setError(fallo.message) })
        .finally(() => { if (!abandonado) setCargando(false) })
    }, 0)

    return () => { abandonado = true; clearTimeout(id) }
  }, [connectionId])

  return { catalogo, tablas, cargando, error }
}

export default function MigrationPlan() {
  const [conexiones, setConexiones] = useState([])
  const [origen, setOrigen] = useState({ connectionId: '', planningArea: '', versionId: '' })
  const [destino, setDestino] = useState({ connectionId: '', planningArea: '', versionId: '' })
  const [elegidas, setElegidas] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [plan, setPlan] = useState(null)
  const [calculando, setCalculando] = useState(false)
  const [error, setError] = useState('')

  // Las condiciones son POR TABLA. Se guardan aparte del plan porque sobreviven a recalcularlo: uno
  // ajusta el filtro y vuelve a analizar varias veces antes de copiar.
  const [condicionesPorTabla, setCondicionesPorTabla] = useState({})
  const [filtrando, setFiltrando] = useState(null)

  const [confirmando, setConfirmando] = useState(false)
  const [escrito, setEscrito] = useState('')
  const [carga, setCarga] = useState(null)

  // La cadena de segmentos la lleva esta pantalla, así que salir la corta. Ver `guarda-de-salida.js`.
  useGuardaDeSalida(Boolean(carga?.enCurso), 'Hay una carga de dato maestro en marcha. Si sales, se corta ahí: lo que ya se confirmó en SAP se queda, y el resto no se copia. ¿Salir igual?')

  useEffect(() => {
    listIbpConnections().then(setConexiones).catch((fallo) => setError(fallo.message))
  }, [])

  const deOrigen = useCatalogo(origen.connectionId)
  const deDestino = useCatalogo(destino.connectionId)

  // Las tablas que se pueden elegir son las del ÁREA Y VERSIÓN del origen, no todas las del tenant:
  // un tipo de dato maestro existe por versión, y ofrecer los de otra llevaría a un plan vacío.
  const delOrigen = useMemo(() => {
    const version = deOrigen.catalogo?.[origen.planningArea]?.versions
      ?.find((una) => una.id === origen.versionId)
    return version?.mdts ?? []
  }, [deOrigen.catalogo, origen.planningArea, origen.versionId])

  const visibles = useMemo(() => {
    const texto = busqueda.trim().toUpperCase()
    return texto ? delOrigen.filter((una) => una.includes(texto)) : delOrigen
  }, [delOrigen, busqueda])

  const listo = origen.versionId && destino.versionId && elegidas.length > 0

  const tenantDestino = conexiones.find((una) => una.id === destino.connectionId)
  const copiables = useMemo(() => (plan?.entradas ?? []).filter(sePuedeCopiar), [plan])

  /**
   * Copia tabla por tabla, encadenando segmentos.
   *
   * Los segmentos van de a uno porque una tabla grande no cabe en el tiempo de una función, y
   * porque cada uno es ya una transacción de SAP. Una tabla que falla NO detiene a las demás: se
   * anota y se sigue, que es lo que uno querría después de esperar veinte minutos.
   */
  const copiar = useCallback(async () => {
    setConfirmando(false)
    setCarga({ enCurso: true, hechas: [], mirando: '' })

    const hechas = []

    for (const entrada of copiables) {
      let desde = 0
      let copiadas = 0
      let fallo = null
      const mensajes = []

      for (;;) {
        setCarga({ enCurso: true, hechas: [...hechas], mirando: `${entrada.origen} · ${copiadas} filas` })

        let segmento
        try {
          segmento = await runMigrationSegment({
            origen,
            destino,
            entidad: entrada.origen,
            entidadDestino: entrada.destino,
            columnas: entrada.comunes ?? [],
            claves: entrada.claves ?? [],
            condiciones: (condicionesPorTabla[entrada.origen] ?? []).filter((una) => una.field),
            desde,
            cuantas: 5000,
            nombre: `GoSCM · ${entrada.origen}`,
          })
        } catch (fallaDeRed) {
          fallo = fallaDeRed.message
          break
        }

        if (!segmento.ok) { fallo = segmento.error; break }

        copiadas += segmento.filas
        mensajes.push(...(segmento.mensajes ?? []))
        if (segmento.agotado) break
        desde += segmento.filas
      }

      hechas.push({ tabla: entrada.origen, destino: entrada.destino, copiadas, fallo, mensajes })
    }

    setCarga({ enCurso: false, hechas, mirando: '' })
  }, [copiables, origen, destino, condicionesPorTabla])

  const calcular = useCallback(async () => {
    setCalculando(true)
    setPlan(null)
    try {
      const leido = await fetchMigrationPlan({
        origen,
        destino,
        tablas: elegidas,
        tablasDelDestino: deDestino.tablas,
        condicionesPorTabla,
      })
      setPlan(leido)
      setError('')
    } catch (fallo) {
      setError(fallo.message)
    } finally {
      setCalculando(false)
    }
  }, [origen, destino, elegidas, deDestino.tablas, condicionesPorTabla])

  return (
    <div className="module-body">
      <div className="notice notice-info">
        Primero se <b>analiza</b>: qué se copiaría y qué se perdería por el camino. Copiar de verdad
        es un segundo paso, con su confirmación, y solo alcanza a las tablas que el análisis dio por
        buenas.
      </div>

      {(error || deOrigen.error || deDestino.error) && (
        <div className="notice notice-error">✕ {error || deOrigen.error || deDestino.error}</div>
      )}

      <div className="grid-charts">
        <Lado
          titulo="origen"
          conexiones={conexiones}
          valor={origen}
          onCambiar={(nuevo) => { setOrigen(nuevo); setElegidas([]); setPlan(null) }}
          catalogo={deOrigen.catalogo}
          cargando={deOrigen.cargando}
        />
        <Lado
          titulo="destino"
          conexiones={conexiones}
          valor={destino}
          onCambiar={(nuevo) => { setDestino(nuevo); setPlan(null) }}
          catalogo={deDestino.catalogo}
          cargando={deDestino.cargando}
        />
      </div>

      {delOrigen.length > 0 && (
        <div className="card">
          <div className="card-label">
            Qué copiar ({elegidas.length} de {numero(delOrigen.length)})
          </div>

          <div className="monitor-bar">
            <input
              className="input input-sm"
              value={busqueda}
              onChange={(evento) => setBusqueda(evento.target.value)}
              placeholder="Buscar una tabla"
            />
            <button type="button" className="btn btn-sm" onClick={() => setElegidas(visibles)}>
              Elegir las {visibles.length} visibles
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setElegidas([])}>Ninguna</button>
          </div>

          <div className="columnas" style={{ maxHeight: 160 }}>
            {visibles.map((una) => (
              <label key={una} className={`columna${elegidas.includes(una) ? ' columna-clave' : ''}`}>
                <input
                  type="checkbox"
                  checked={elegidas.includes(una)}
                  onChange={() => setElegidas((previas) => (previas.includes(una)
                    ? previas.filter((otra) => otra !== una)
                    : [...previas, una]))}
                />
                {una}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="monitor-bar">
        <button type="button" className="btn btn-sm btn-primary" onClick={calcular} disabled={!listo || calculando}>
          {calculando ? 'Analizando…' : 'Analizar qué se copiaría'}
        </button>
        <span className="page-hint">
          {calculando
            ? 'Se leen las dos tablas de cada par y se cuentan las filas; tarda unos segundos por tabla.'
            : listo ? `${elegidas.length} tablas por analizar` : 'Elige origen, destino y al menos una tabla.'}
        </span>
      </div>

      {plan && (
        <>
          <div className="grid-kpi">
            <div className="kpi">
              <div className="kpi-label">Tablas analizadas</div>
              <div className="kpi-valor">{numero(plan.resumen.tablas)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Se copiarían</div>
              <div className="kpi-valor" style={{ color: 'var(--green)' }}>{numero(plan.resumen.copiables)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Filas</div>
              <div className="kpi-valor">{numero(plan.resumen.filas)}</div>
              <div className="kpi-detalle">solo de las que se copiarían</div>
            </div>
          </div>

          {plan.resumen.hayQueMirar && (
            <div className="notice notice-info">
              Hay tablas que no van a copiarse enteras. La columna «Estado» dice por qué.
            </div>
          )}

          <div className="monitor-bar">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => { setEscrito(''); setConfirmando(true) }}
              disabled={copiables.length === 0 || carga?.enCurso}
            >
              ▶ Copiar {copiables.length} {copiables.length === 1 ? 'tabla' : 'tablas'}
            </button>
            {carga?.enCurso && <span className="page-hint">Copiando {carga.mirando}…</span>}
            {tenantDestino?.isProduction && <span className="tag tag-accent">El destino es productivo</span>}
          </div>

          {carga && !carga.enCurso && carga.hechas.length > 0 && (
            <div className="card">
              <div className="card-label">Resultado de la copia</div>
              <div className="table-scroll">
                <table className="table-dense">
                  <thead>
                    <tr><th>Tabla</th><th>Copiadas</th><th>Resultado</th></tr>
                  </thead>
                  <tbody>
                    {carga.hechas.map((una) => (
                      <tr key={una.tabla}>
                        <td>{una.tabla} <span className="exp-sub">→ {una.destino}</span></td>
                        <td>{numero(una.copiadas)}</td>
                        <td>
                          {una.fallo
                            ? <span style={{ color: 'var(--red)' }}>✕ {una.fallo}</span>
                            : <span style={{ color: 'var(--green)' }}>✓ Copiada</span>}
                          {una.mensajes.length > 0 && (
                            <div className="exp-sub" style={{ color: 'var(--accent)' }}>
                              SAP rechazó {una.mensajes.length} {una.mensajes.length === 1 ? 'fila' : 'filas'}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="table-scroll table-alta">
            <table className="table-dense">
              <thead>
                <tr>
                  <th>Origen</th><th>Destino</th><th>Filas</th><th>Columnas</th><th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {plan.entradas.map((entrada) => {
                  const revision = revisarEntrada(entrada)
                  const meta = ESTADOS[revision.estado] ?? ESTADOS.ok

                  return (
                    <Fragment key={entrada.origen}>
                    <tr>
                      <td>{entrada.origen}</td>
                      <td>
                        {entrada.destino ?? <span className="exp-sub">ninguna</span>}
                        {entrada.destino && entrada.destino !== entrada.origen && (
                          <div className="exp-sub">emparejada por la raíz del nombre</div>
                        )}
                      </td>
                      <td>
                        {numero(entrada.filas)}
                        {entrada.filtrada && <div className="exp-sub">con el filtro puesto</div>}
                      </td>
                      <td>
                        {entrada.verificable
                          ? (
                            <>
                              {entrada.comunes.length} en común
                              {entrada.soloEnOrigen.length > 0 && (
                                <div className="exp-sub" style={{ color: 'var(--accent)' }} title={entrada.soloEnOrigen.join(', ')}>
                                  no se copian: {entrada.soloEnOrigen.slice(0, 4).join(', ')}
                                  {entrada.soloEnOrigen.length > 4 && ` y ${entrada.soloEnOrigen.length - 4} más`}
                                </div>
                              )}
                              {entrada.soloEnDestino.length > 0 && (
                                <div className="exp-sub" title={entrada.soloEnDestino.join(', ')}>
                                  quedan como estén: {entrada.soloEnDestino.length}
                                </div>
                              )}
                            </>
                          )
                          : <span className="exp-sub">sin comparar</span>}
                      </td>
                      <td>
                        <span className="badge" style={{ background: `${meta.color}26`, borderColor: `${meta.color}4d`, color: meta.color }}>
                          {meta.label}
                        </span>
                        {revision.mensaje && <div className="exp-sub">{revision.mensaje}</div>}

                        {/* Filtrar solo se ofrece donde se sabe qué columnas hay: sin el análisis no
                            habría de dónde sacar la lista de campos. */}
                        {entrada.verificable && entrada.comunes.length > 0 && (
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => setFiltrando((actual) => (actual === entrada.origen ? null : entrada.origen))}
                          >
                            {(condicionesPorTabla[entrada.origen] ?? []).length > 0 ? 'Filtro puesto' : 'Filtrar'}
                          </button>
                        )}
                      </td>
                    </tr>

                    {/* El editor va en su propia fila y a todo el ancho: con cinco columnas no cabe un
                        filtro de tres controles sin que quede ilegible. */}
                    {filtrando === entrada.origen && (
                      <tr>
                        <td colSpan={5}>
                          <div className="exp-sub">
                            Copiar solo las filas de <b>{entrada.origen}</b> que cumplan esto. Las
                            demás tablas no se tocan.
                          </div>
                          <FiltroDeTabla
                            tabla={entrada.origen}
                            campos={entrada.comunes ?? []}
                            condiciones={condicionesPorTabla[entrada.origen] ?? []}
                            onCambiar={(suyas) => setCondicionesPorTabla((previas) => {
                              const salida = { ...previas }
                              if (suyas.length === 0) delete salida[entrada.origen]
                              else salida[entrada.origen] = suyas
                              return salida
                            })}
                          />
                          <div className="exp-sub">
                            Vuelve a analizar para ver cuántas filas quedan con el filtro puesto.
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {confirmando && (
        <Modal
          title="Copiar de verdad"
          subtitle={`${copiables.length} ${copiables.length === 1 ? 'tabla' : 'tablas'} · ${numero(plan.resumen.filas)} filas`}
          onClose={() => setConfirmando(false)}
          footer={(
            <>
              <button type="button" className="btn btn-sm" onClick={() => setConfirmando(false)}>Cancelar</button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={copiar}
                disabled={escrito.trim().toLowerCase() !== 'copiar'}
              >
                Sí, copiar
              </button>
            </>
          )}
        >
          <p>
            Se van a <b>escribir {numero(plan.resumen.filas)} filas</b> en{' '}
            <b>{tenantDestino?.name}</b>, área <b>{destino.planningArea}</b>, versión{' '}
            <b>{destino.versionId}</b>.
          </p>

          {tenantDestino?.isProduction && (
            <div className="notice notice-error">
              ⚠ Ese tenant está marcado como <b>productivo</b>.
            </div>
          )}

          <p className="exp-sub">
            Las filas que ya existan con la misma clave se <b>sobrescriben</b>. Las que no, se crean.
            Nada se borra. Las columnas que el destino no tiene no se copian, y las que tiene de más
            se quedan como estén.
          </p>

          {/* Escribir la palabra, y no solo pulsar: es la unica operacion de la aplicacion que
              modifica dato maestro, y conviene que cueste un segundo más que un clic distraído. */}
          <label className="exp-enriq">
            <span className="exp-k">Escribe «copiar» para confirmar</span>
            <input
              className="input input-sm"
              value={escrito}
              onChange={(evento) => setEscrito(evento.target.value)}
              placeholder="copiar"
            />
          </label>
        </Modal>
      )}
    </div>
  )
}
