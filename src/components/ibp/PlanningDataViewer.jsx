// Mirar las cifras clave de un tenant: elegir una, el nivel al que se quiere ver y recorrer las filas.
//
// Portado de `DataViewer/TransactionalDataViewer.jsx` de v8, de solo lectura.
//
// La pantalla insiste en una cosa que en v8 había que saber de antemano: los atributos elegidos NO
// son columnas, son el NIVEL DE AGREGACIÓN. Con la misma cifra y el mismo filtro, en el tenant de
// pruebas salen 1.594 filas por producto, 90.713 añadiendo el periodo y 106.996 añadiendo también la
// ubicación. Son los mismos datos con tres lupas distintas, y quien no lo sepa lee mal el resultado.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { usePantallaCompleta } from '../../lib/usePantallaCompleta.js'
import BotonPantallaCompleta from '../ui/BotonPantallaCompleta.jsx'

import { cifraLegible, periodoLegible } from '../../../core/ibp/planning-data-model.js'
import { OPERADORES } from '../../../core/ibp/master-data-model.js'
import { TOPES, revisarVolumen } from '../../../core/ibp/export-csv.js'
import {
  fetchConversions, fetchPlanningCatalog, fetchPlanningCount, fetchPlanningRows,
} from '../../lib/ibp-planning-data.js'
import { volcarACsv } from '../../lib/descargar-csv.js'
import { SinDatos } from '../ui/StatusCharts.jsx'

const numero = (valor) => Number(valor ?? 0).toLocaleString('es')

/**
 * La huella de una consulta, para saber si una cuenta sigue valiendo.
 *
 * Contar tarda unos segundos, así que se guarda; pero si después se cambia la cifra, el nivel o el
 * filtro, ese número ya no es de lo que se está mirando y decir «de N páginas» sería mentir.
 */
const huella = (definicion) => JSON.stringify(definicion)

/** Los atributos que casi siempre se quieren, para que la primera consulta no salga en blanco. */
const NIVEL_HABITUAL = ['PRDID', 'LOCID', 'CUSTID', 'PERIODID4_TSTAMP']

/** Una lista larga con buscador: hay 222 dimensiones y 1.137 cifras. */
function Buscable({ etiqueta, opciones, elegidas, etiquetas, onAlternar, unaSola, altura = 170 }) {
  const [busqueda, setBusqueda] = useState('')

  const visibles = useMemo(() => {
    const texto = busqueda.trim().toUpperCase()
    if (!texto) return opciones.slice(0, 300)
    return opciones.filter((una) => una.toUpperCase().includes(texto)
      || (etiquetas?.[una] ?? '').toUpperCase().includes(texto)).slice(0, 300)
  }, [opciones, busqueda, etiquetas])

  return (
    <div className="card">
      <div className="card-label">{etiqueta} ({numero(opciones.length)})</div>
      <input
        className="input input-sm"
        value={busqueda}
        onChange={(evento) => setBusqueda(evento.target.value)}
        placeholder="Buscar por nombre o etiqueta"
      />
      <div className="columnas" style={{ maxHeight: altura }}>
        {visibles.map((una) => (
          <label key={una} className={`columna${elegidas.includes(una) ? ' columna-clave' : ''}`} title={etiquetas?.[una]}>
            <input
              type={unaSola ? 'radio' : 'checkbox'}
              name={unaSola ? etiqueta : undefined}
              checked={elegidas.includes(una)}
              onChange={() => onAlternar(una)}
            />
            {una}
          </label>
        ))}
        {visibles.length === 0 && <span className="exp-sub">Nada coincide con «{busqueda}».</span>}
        {opciones.length > visibles.length && !busqueda && (
          <span className="exp-sub">y {numero(opciones.length - visibles.length)} más; busca para verlas.</span>
        )}
      </div>
    </div>
  )
}

export default function PlanningDataViewer({ conexionId }) {
  const [catalogo, setCatalogo] = useState(null)
  const [error, setError] = useState('')

  const [cifra, setCifra] = useState('')
  const [dimensiones, setDimensiones] = useState([])
  const [condiciones, setCondiciones] = useState([])
  const [conversiones, setConversiones] = useState({})
  const [pedidas, setPedidas] = useState([])
  const [soloConValor, setSoloConValor] = useState(true)

  const [prueba, setPrueba] = useState(null)
  const [consulta, setConsulta] = useState(null)
  const [filas, setFilas] = useState([])
  const [descartadas, setDescartadas] = useState(0)
  const [pagina, setPagina] = useState(0)
  const [cargando, setCargando] = useState(false)

  const [volcado, setVolcado] = useState(null)
  const cortarVolcado = useRef(null)
  const lienzo = useRef(null)
  const pantalla = usePantallaCompleta(lienzo)

  useEffect(() => {
    let abandonado = false
    fetchPlanningCatalog(conexionId)
      .then((leido) => {
        if (abandonado) return
        setCatalogo(leido)
        setDimensiones(NIVEL_HABITUAL.filter((una) => leido.dims.includes(una)))
      })
      .catch((fallo) => {
        if (abandonado) return
        setError(fallo.message)
        setCatalogo({ dims: [], cifras: [], etiquetas: {}, versiones: [], areas: [] })
      })
    return () => { abandonado = true }
  }, [conexionId])

  // Al elegir una cifra hay que preguntarle a SAP qué conversiones exige: sin ellas no deja leerla,
  // y el mensaje que devuelve —"Add property UOMTOID to a filter condition"— no dice qué poner.
  useEffect(() => {
    if (!cifra || !catalogo?.area) return undefined
    let abandonado = false

    const id = setTimeout(() => {
      setPedidas([])
      fetchConversions(conexionId, { area: catalogo.area, cifra })
        .then((leidas) => { if (!abandonado) { setPedidas(leidas); setError('') } })
        .catch((fallo) => { if (!abandonado) setError(fallo.message) })
    }, 0)

    return () => { abandonado = true; clearTimeout(id) }
  }, [conexionId, catalogo?.area, cifra])

  const laConsulta = useMemo(() => ({
    area: catalogo?.area,
    cifra,
    dimensiones,
    condiciones: condiciones.filter((una) => una.field),
    conversiones,
    soloConValor,
  }), [catalogo?.area, cifra, dimensiones, condiciones, conversiones, soloConValor])

  const faltaConversion = pedidas.find((campo) => !conversiones[campo])

  const cargarPagina = useCallback((cual) => {
    if (!consulta) return
    setCargando(true)

    fetchPlanningRows(conexionId, consulta.definicion, { skip: cual * consulta.top, top: consulta.top })
      .then((respuesta) => {
        setFilas(respuesta.filas)
        setDescartadas(respuesta.descartadas)
        setPagina(cual)
        setError('')
      })
      .catch((fallo) => setError(fallo.message))
      .finally(() => setCargando(false))
  }, [conexionId, consulta])

  useEffect(() => {
    if (!consulta) return undefined
    const id = setTimeout(() => cargarPagina(0), 0)
    return () => clearTimeout(id)
  }, [consulta, cargarPagina])

  async function contar() {
    const definicion = laConsulta
    setPrueba({ cargando: true })
    try {
      const total = await fetchPlanningCount(conexionId, definicion)
      setPrueba({ total, para: huella(definicion) })
    } catch (fallo) {
      setPrueba({ error: fallo.message })
    }
  }

  /**
   * Vuelca a un archivo TODAS las filas de la consulta, no la página que se ve.
   *
   * Las celdas se escriben con las MISMAS funciones que la tabla —un periodo como `2026-08-01`, la
   * cifra con tres decimales—, porque un archivo que no dice lo mismo que la pantalla no sirve para
   * comprobar nada.
   */
  async function volcar(total, columnasDelArchivo, definicion) {
    const revision = revisarVolumen(total, TOPES.cifras)
    if (revision.estado === 'bloqueado') { setVolcado({ error: revision.mensaje }); return }
    if (revision.estado === 'aviso' && !window.confirm(revision.mensaje)) return

    const corte = new AbortController()
    cortarVolcado.current = corte
    setVolcado({ leidas: 0, total })

    try {
      const salida = await volcarACsv({
        columnas: columnasDelArchivo,
        comoSeLee: (valor, columna) =>
          (columna === definicion.cifra ? cifraLegible(valor) : periodoLegible(valor)),
        leerPagina: async ({ skip, top, signal }) => {
          const respuesta = await fetchPlanningRows(conexionId, definicion, { skip, top, signal })
          return respuesta.filas
        },
        nombre: [definicion.area, definicion.cifra || 'sin-cifra'],
        total,
        tope: TOPES.cifras.maximo,
        signal: corte.signal,
        onAvance: (avance) => setVolcado(avance),
      })
      setVolcado(salida ? { hecho: salida.filas, cortado: salida.cortado } : null)
    } catch (fallo) {
      setVolcado(fallo.name === 'AbortError' ? null : { error: fallo.message })
    } finally {
      if (cortarVolcado.current === corte) cortarVolcado.current = null
    }
  }

  function mostrarDatos() {
    // La definición va aparte del tamaño de página para poder comparar la huella con la de la
    // cuenta sin que el `top` estorbe.
    setVolcado(null)
    setConsulta({ definicion: laConsulta, top: 500 })
  }

  if (catalogo === null) return <div className="page-hint">Leyendo el catálogo del área… tarda unos segundos.</div>
  if (error && catalogo.cifras.length === 0) return <div className="notice notice-error">✕ {error}</div>

  const mostrada = consulta?.definicion
  const columnas = mostrada ? [...mostrada.dimensiones, ...(mostrada.cifra ? [mostrada.cifra] : [])] : []

  // Cuántas páginas hay solo se sabe si se contó ESTA consulta; si no, no se dice ningún número.
  const contadas = mostrada && prueba?.para === huella(mostrada) ? prueba.total : null
  const paginas = contadas ? Math.ceil(contadas / consulta.top) : 0

  return (
    <div className="module-body a-pantalla-completa" ref={lienzo}>
      <div className="monitor-bar">
        <BotonPantallaCompleta {...pantalla} que="la tabla" />
        <span className="tag tag-accent">{catalogo.area}</span>
        <span className="page-hint">
          {numero(catalogo.dims.length)} atributos · {numero(catalogo.cifras.length)} cifras clave
          {catalogo.versiones.length > 0 && ` · ${catalogo.versiones.length} versiones`}
        </span>
      </div>

      {error && <div className="notice notice-error">✕ {error}</div>}

      <div className="grid-charts">
        <Buscable
          etiqueta="Cifra clave"
          opciones={catalogo.cifras}
          elegidas={cifra ? [cifra] : []}
          etiquetas={catalogo.etiquetas}
          onAlternar={(una) => setCifra(una === cifra ? '' : una)}
          unaSola
        />

        <Buscable
          etiqueta="Nivel de agregación"
          opciones={catalogo.dims}
          elegidas={dimensiones}
          etiquetas={catalogo.etiquetas}
          onAlternar={(una) => setDimensiones((previas) => (previas.includes(una)
            ? previas.filter((otra) => otra !== una)
            : [...previas, una]))}
        />
      </div>

      {/* La trampa silenciosa de este servicio: quitar un atributo no quita una columna, sube el
          nivel al que SAP suma. Mismos datos, otros números. */}
      <div className="notice notice-info">
        SAP suma al nivel que se le pida: los atributos elegidos no son columnas, son el detalle.
        Con menos atributos salen menos filas con valores más grandes — y no avisa.
        {dimensiones.length > 0 && <> Ahora mismo: <b>{dimensiones.join(' · ')}</b>.</>}
        {dimensiones.length === 0 && <> Ahora mismo no hay ninguno: el total del área en una sola fila.</>}
      </div>

      {pedidas.length > 0 && (
        <div className="card">
          <div className="card-label">Esta cifra exige una conversión</div>
          <p className="exp-sub">
            SAP no la deja leer sin estos atributos en el filtro. En el tenant de pruebas, por
            ejemplo, «KG» tiene datos y «EA» no: si sale vacío, prueba con otra unidad.
          </p>
          <div className="condicion">
            {pedidas.map((campo) => (
              <label key={campo} className="exp-enriq">
                <span className="exp-k">{campo}</span>
                <input
                  className="input input-sm"
                  value={conversiones[campo] ?? ''}
                  onChange={(evento) => setConversiones((previas) => ({ ...previas, [campo]: evento.target.value.toUpperCase() }))}
                  placeholder={campo === 'UOMTOID' ? 'KG' : 'USD'}
                />
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-label">Filtro</div>

        {condiciones.map((una) => (
          <div className="condicion" key={una.id}>
            <select
              className="select input-sm"
              value={una.field}
              onChange={(evento) => setCondiciones((previas) => previas.map((otra) => (otra.id === una.id ? { ...otra, field: evento.target.value } : otra)))}
              aria-label="Atributo"
            >
              <option value="">Elige un atributo…</option>
              {catalogo.dims.map((dim) => <option key={dim} value={dim}>{dim}</option>)}
            </select>

            <select
              className="select input-sm"
              value={una.op}
              onChange={(evento) => setCondiciones((previas) => previas.map((otra) => (otra.id === una.id ? { ...otra, op: evento.target.value } : otra)))}
              aria-label="Operador"
            >
              {OPERADORES.map((uno) => <option key={uno.id} value={uno.id}>{uno.label}</option>)}
            </select>

            {una.op !== 'nb' && (
              <input
                className="input input-sm"
                value={una.value}
                onChange={(evento) => setCondiciones((previas) => previas.map((otra) => (otra.id === una.id ? { ...otra, value: evento.target.value } : otra)))}
                placeholder={OPERADORES.find((uno) => uno.id === una.op)?.ayuda}
              />
            )}

            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setCondiciones((previas) => previas.filter((otra) => otra.id !== una.id))}
              aria-label="Quitar la condición"
            >
              ✕
            </button>
          </div>
        ))}

        <div className="monitor-bar">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setCondiciones((previas) => [...previas, { id: `c${previas.length}${Date.now()}`, field: '', op: 'in', value: '' }])}
          >
            + Condición
          </button>

          {/* Se pide con `gt 0 or lt 0`, no con `ne 0`: SAP ignora ese en silencio y devuelve todo. */}
          <label className="columna">
            <input type="checkbox" checked={soloConValor} onChange={(evento) => setSoloConValor(evento.target.checked)} />
            Solo filas con valor
          </label>

          <button type="button" className="btn btn-sm" onClick={contar} disabled={prueba?.cargando || !!faltaConversion}>
            {prueba?.cargando ? 'Contando…' : 'Contar filas'}
          </button>

          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={mostrarDatos}
            disabled={(!cifra && dimensiones.length === 0) || !!faltaConversion}
          >
            Mostrar datos
          </button>

          {prueba?.total !== undefined && !prueba.cargando && <span className="page-hint">{numero(prueba.total)} filas</span>}
          {prueba?.error && <span className="page-hint" style={{ color: 'var(--red)' }}>{prueba.error}</span>}
        </div>

        {faltaConversion && (
          <div className="exp-sub" style={{ color: 'var(--accent)' }}>
            Falta {faltaConversion} para poder leer esta cifra.
          </div>
        )}
      </div>

      {consulta && (
        <>
          <div className="monitor-bar">
            <button type="button" className="btn btn-sm" onClick={() => cargarPagina(pagina - 1)} disabled={pagina === 0 || cargando}>‹ Anterior</button>
            <span className="page-hint">
              Página {pagina + 1}{paginas > 0 ? ` de ${numero(paginas)}` : ''} · {numero(filas.length)} filas
              {descartadas > 0 && ` · ${numero(descartadas)} en cero descartadas`}
            </span>
            <button type="button" className="btn btn-sm" onClick={() => cargarPagina(pagina + 1)} disabled={filas.length === 0 || cargando}>Siguiente ›</button>
          </div>

          {/* El volcado se lleva TODAS las filas de la consulta. Con cifras son muchas más que en
              dato maestro, así que el tope es más alto y se puede cortar a mitad. */}
          <div className="monitor-bar">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => volcar(contadas ?? 0, columnas, mostrada)}
              disabled={volcado?.leidas !== undefined}
            >
              Descargar CSV
            </button>

            {volcado?.leidas !== undefined && (
              <>
                <span className="page-hint">
                  {numero(volcado.leidas)}
                  {volcado.total > 0 ? ` de ${numero(volcado.total)}` : ''} filas leídas…
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={() => cortarVolcado.current?.abort()}
                >
                  Cortar
                </button>
              </>
            )}

            {volcado?.hecho !== undefined && (
              <span className="page-hint">
                ✓ {numero(volcado.hecho)} filas en el archivo
                {volcado.cortado && ` · se cortó en el tope de ${numero(TOPES.cifras.maximo)}`}
              </span>
            )}

            {volcado?.error && (
              <span className="page-hint" style={{ color: 'var(--red)' }}>{volcado.error}</span>
            )}

            {contadas === null && (
              <span className="exp-sub">
                Sin contar la consulta no se sabe cuántas filas son; el volcado corta en{' '}
                {numero(TOPES.cifras.maximo)}.
              </span>
            )}
          </div>

          <div className="table-scroll table-alta">
            <table className="table-dense">
              <thead>
                <tr>{columnas.map((columna) => <th key={columna} title={catalogo.etiquetas[columna]}>{columna}</th>)}</tr>
              </thead>
              <tbody>
                {filas.map((fila, indice) => (
                  <tr key={columnas.map((columna) => fila[columna]).join('|') || indice}>
                    {columnas.map((columna) => (
                      <td key={columna}>
                        {columna === mostrada.cifra ? cifraLegible(fila[columna]) : periodoLegible(fila[columna])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!cargando && filas.length === 0 && <SinDatos />}
            {cargando && <div className="sin-datos">Consultando…</div>}
          </div>
        </>
      )}
    </div>
  )
}
