// Mirar y editar el dato maestro de un tenant: elegir área, versión y tabla, recorrer las filas y —si
// hace falta— cambiar valores o borrar registros.
//
// Portado de `DataViewer/MasterDataViewer.jsx` de v8. Se lee de entrada y para escribir hay que
// entrar en modo edición: son las dos únicas operaciones de la aplicación que tocan filas que YA
// existen, y ninguna se dispara sin pasar por la revisión.
//
// Tres decisiones que vienen de v8 y se conservan porque están ganadas contra tenants reales:
//
//   - Las columnas y el filtro se editan sin consultar; hay que pulsar «Mostrar datos». Una tabla de
//     ocho mil filas y sesenta columnas no se puede releer con cada tecla.
//   - Al paginar se ordena por las claves de negocio. Sin un orden estable, dos ventanas sobre una
//     tabla que alguien está tocando se solapan y dejan huecos.
//   - Sin claves de negocio no se edita nada. No es una limitación de la pantalla: sin ellas no hay
//     con qué decirle a SAP cuál es la fila, y el cambio se leería como un registro nuevo.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { usePantallaCompleta } from '../../lib/usePantallaCompleta.js'
import BotonPantallaCompleta from '../ui/BotonPantallaCompleta.jsx'
import SeccionPlegable from '../ui/SeccionPlegable.jsx'
import SelectorDeColumnas from './SelectorDeColumnas.jsx'

import {
  CAMPOS_DE_SOLO_LECTURA, columnasPorOmision, etiquetaDeCondicion, OPERADORES, valorLegible,
} from '../../../core/ibp/master-data-model.js'
import { anotarCambio, claveDeFila, resumirCambios } from '../../../core/ibp/master-data-edit.js'
import { TOPES, revisarVolumen } from '../../../core/ibp/export-csv.js'
import {
  fetchMasterCatalog, fetchMasterCount, fetchMasterRows, fetchMasterSchema, fetchMasterValues,
} from '../../lib/ibp-master-data.js'
import { borrarDatoMaestro, guardarDatoMaestro } from '../../lib/ibp-master-data-edit.js'
import { volcarACsv } from '../../lib/descargar-csv.js'
import EdicionDeDatoMaestro from './EdicionDeDatoMaestro.jsx'

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
        <option value="">Elige un campo…</option>
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

export default function MasterDataViewer({
  conexionId,
  tenant = '',
  productivo = false,
  /** Dónde arranca esta pestaña: `{ area, version, tabla }`. Lo pone `VisorConPestanas`. */
  inicial = null,
  /** Si esta pestaña es la que se está mirando. Las de atrás no dibujan su tabla. */
  activa = true,
  /** Avisa de qué está mirando, para que la pestaña se ponga nombre. */
  onDefinicion = null,
}) {
  const [catalogo, setCatalogo] = useState(null)
  const [importables, setImportables] = useState([])
  const [error, setError] = useState('')

  const [area, setArea] = useState(inicial?.area ?? '')
  const [versionPedida, setVersionPedida] = useState(inicial?.version || VERSION_BASE)
  const [tabla, setTabla] = useState(inicial?.tabla ?? '')
  const [busqueda, setBusqueda] = useState('')

  const [esquema, setEsquema] = useState(null)
  const [cargandoEsquema, setCargandoEsquema] = useState(false)
  const [columnas, setColumnas] = useState([])

  // Las dos secciones de configuración se pliegan para dar aire a la tabla, como en v8. La de
  // selección se cierra sola al elegir tabla: ya cumplió, y lo que se quiere ver es la tabla.
  const [seleccionPlegada, setSeleccionPlegada] = useState(false)
  const [datosPlegada, setDatosPlegada] = useState(false)

  // Por qué columna se ordena. Portado de v8: pulsar una cabecera ordena por ella, y volver a
  // pulsarla invierte. Lo resuelve SAP, no el navegador — se ordena la tabla entera, no la página.
  const [orden, setOrden] = useState(null)

  // La pestaña se pone nombre con esto. Se avisa al cambiar de área, versión o tabla y no en cada
  // repintado: el envoltorio compara y descarta lo que no cambia, pero avisar de más igual encadena
  // trabajo por nada.
  useEffect(() => {
    onDefinicion?.({ area, version: versionPedida === VERSION_BASE ? '' : versionPedida, tabla })
    // `onDefinicion` se recrea en cada repintado del envoltorio y no debe volver a disparar esto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area, versionPedida, tabla])

  // El filtro por columna de v8. Actúa SOLO sobre las filas de esta página y por prefijo: es para
  // encontrar algo en lo que ya está a la vista, no para consultar. El filtro de verdad es el de
  // arriba, que lo resuelve SAP.
  const [filtrosDeColumna, setFiltrosDeColumna] = useState({})

  // La columna que se está arrastrando y sobre cuál está. Reordenar es solo visual.
  const [arrastrando, setArrastrando] = useState(null)
  const [encima, setEncima] = useState(null)
  const [condiciones, setCondiciones] = useState([])
  const [valoresDe, setValoresDe] = useState({})
  const [prueba, setPrueba] = useState(null)

  const [consulta, setConsulta] = useState(null)
  const [filas, setFilas] = useState([])
  const [pagina, setPagina] = useState(0)
  const [cargandoFilas, setCargandoFilas] = useState(false)

  const [modo, setModo] = useState('leer')
  // Los cambios y las filas marcadas se guardan por CLAVE DE NEGOCIO, con su fila original dentro.
  // Así sobreviven a pasar de página: el ciclo real es corregir tres valores aquí, dos allá, y
  // guardar una vez. Perderlos al avanzar obligaría a guardar página por página.
  const [edits, setEdits] = useState({})
  const [marcadas, setMarcadas] = useState({})
  const [revision, setRevision] = useState(null)
  // Si la escritura llegó a SAP hay que releer, y eso no es estado que se dibuje.
  const seEscribio = useRef(false)

  const [volcado, setVolcado] = useState(null)
  const cortarVolcado = useRef(null)
  const lienzo = useRef(null)
  const pantalla = usePantallaCompleta(lienzo)

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
    // Los cambios pendientes son de la tabla que se estaba mirando: sus claves no significan nada en
    // otra, y arrastrarlos escribiría en la tabla equivocada.
    setModo('leer')
    setEdits({})
    setMarcadas({})
    setVolcado(null)
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

  /**
   * El `$orderby` que se le manda a SAP.
   *
   * La columna elegida PRIMERO y las claves detrás. Las claves no son decoración: `$orderby` estable
   * es obligatorio al paginar o hay solapes y huecos entre páginas. v8 ordenaba solo por la columna
   * elegida, y con valores repetidos —que es lo normal en una descripción— dos páginas seguidas
   * pueden traer la misma fila y perder otra.
   */
  function ordenParaSap(cual, claves) {
    if (!cual?.campo) return claves
    const primero = `${cual.campo}${cual.dir === 'desc' ? ' desc' : ''}`
    return [primero, ...claves.filter((una) => una !== cual.campo)]
  }

  /** Pulsar una cabecera: ascendente, descendente, y a la tercera se quita el orden. */
  function ordenarPor(columna) {
    if (!consulta) return
    const siguiente = orden?.campo !== columna
      ? { campo: columna, dir: 'asc' }
      : (orden.dir === 'asc' ? { campo: columna, dir: 'desc' } : null)

    setOrden(siguiente)
    // Cambiar el orden reordena la tabla ENTERA en SAP, así que se vuelve a la primera página: la
    // página 7 del orden anterior no tiene nada que ver con la página 7 del nuevo.
    setConsulta((previa) => (previa
      ? { ...previa, orderby: ordenParaSap(siguiente, esquema?.claves ?? []) }
      : previa))
  }

  /** Suelta la columna arrastrada delante de `destino`. Solo cambia cómo se ve. */
  function reordenarColumnas(destino) {
    const desde = arrastrando
    if (!desde || desde === destino) return

    const mover = (lista) => {
      const sin = lista.filter((una) => una !== desde)
      const donde = sin.indexOf(destino)
      if (donde < 0) return lista
      return [...sin.slice(0, donde), desde, ...sin.slice(donde)]
    }

    setColumnas(mover)
    setConsulta((previa) => (previa ? { ...previa, select: mover(previa.select) } : previa))
  }

  /**
   * Las filas de ESTA página que pasan los filtros de columna.
   *
   * Por prefijo y sobre lo que ya se bajó, como en v8: es para encontrar algo en lo que se está
   * mirando, no para consultar. El filtro que le habla a SAP es el de arriba.
   */
  const filasVisibles = filas.filter((fila) => Object.entries(filtrosDeColumna).every(
    ([columna, texto]) => {
      const busca = String(texto ?? '').trim().toUpperCase()
      if (!busca) return true
      return valorLegible(fila[columna]).toUpperCase().startsWith(busca)
    },
  ))

  function mostrarDatos() {
    if (!esquema) return
    setConsulta({
      entidad: tabla,
      planningArea: area,
      versionId: version,
      condiciones: condiciones.filter((una) => una.field),
      select: columnas,
      orderby: ordenParaSap(orden, esquema.claves),
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

  /**
   * Vuelca a un archivo TODO lo que devuelve el filtro, no la página que se ve.
   *
   * Se leen páginas grandes —5.000 filas— porque en SAP el costo es por petición, no por fila: son
   * los mismos ~6 segundos traer 500 que 5.000.
   */
  async function volcar(total) {
    if (!consulta) return

    const revision = revisarVolumen(total, TOPES.maestro)
    if (revision.estado === 'bloqueado') { setVolcado({ error: revision.mensaje }); return }
    if (revision.estado === 'aviso' && !window.confirm(revision.mensaje)) return

    const corte = new AbortController()
    cortarVolcado.current = corte
    setVolcado({ leidas: 0, total })

    try {
      const salida = await volcarACsv({
        columnas: consulta.select,
        // Las claves van en el $select aunque no se estén mirando: sin un orden estable las páginas
        // se solapan. Al archivo llegan solo las columnas de la pantalla.
        leerPagina: ({ skip, top, signal }) => fetchMasterRows(conexionId, {
          ...consulta,
          select: [...new Set([...consulta.select, ...esquema.claves])],
          skip,
          top,
          signal,
        }),
        nombre: [consulta.entidad, consulta.planningArea, consulta.versionId || 'base'],
        total,
        tope: TOPES.maestro.maximo,
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

  /** La identidad de una fila con las claves de ESTA tabla. */
  const identidadDe = (fila) => claveDeFila(fila, esquema?.claves ?? [])

  const cambiarCelda = (fila, campo, valor) => setEdits((previos) =>
    anotarCambio(previos, { fila, campo, valor, claves: esquema?.claves ?? [] }))

  function marcar(fila, puesta) {
    const clave = identidadDe(fila)
    setMarcadas((previas) => {
      if (!puesta) {
        const { [clave]: _fuera, ...resto } = previas
        return resto
      }
      return { ...previas, [clave]: fila }
    })
  }

  const descartar = () => { setEdits({}); setMarcadas({}) }

  async function escribir() {
    const comun = {
      entidad: consulta.entidad,
      planningArea: consulta.planningArea,
      versionId: consulta.versionId,
      claves: esquema.claves,
    }

    const salida = revision.accion === 'borrar'
      ? await borrarDatoMaestro(conexionId, { ...comun, filas: Object.values(marcadas) })
      : await guardarDatoMaestro(conexionId, { ...comun, edits })

    // Llegó a SAP, con o sin rechazos: lo que se está mirando ya no es lo que hay.
    seEscribio.current = true
    return salida
  }

  function cerrarRevision() {
    setRevision(null)
    if (!seEscribio.current) return
    seEscribio.current = false
    descartar()
    cargarPagina(pagina)
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

  const pendientes = resumirCambios(edits)
  const cuantasMarcadas = Object.keys(marcadas).length
  const hayPendientes = pendientes.campos > 0 || cuantasMarcadas > 0

  // Para editar hacen falta las claves de negocio Y que estén entre las columnas traídas: son lo que
  // identifica la fila ante SAP, y sin ellas en la respuesta no hay nada que mandar.
  const clavesTraidas = Boolean(consulta) && esquema?.claves?.length > 0
    && esquema.claves.every((clave) => consulta.select.includes(clave))

  const editando = modo === 'editar' && clavesTraidas

  /** Una celda se puede escribir si no es clave, no es de solo lectura y no es una fecha. */
  const sePuedeEscribir = (fila, columna) => editando
    && !esquema.claves.includes(columna)
    && !CAMPOS_DE_SOLO_LECTURA.includes(columna)
    // Una fecha se muestra convertida a la hora local; dejar escribir encima mandaría a SAP el texto
    // que se lee, no el literal que entiende.
    && valorLegible(fila[columna]) === String(fila[columna] ?? '')

  return (
    <>
      <SeccionPlegable
        titulo="Selección"
        plegada={seleccionPlegada}
        onAlternar={() => setSeleccionPlegada((previa) => !previa)}
        resumen={[area, version, tabla].filter(Boolean).join(' · ')}
        acciones={<BotonPantallaCompleta {...pantalla} que="la tabla" />}
      >
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
          <option value="">Elige una tabla…</option>
          {tablas.map((una) => (
            <option key={una} value={una}>{una}{importables.includes(una) ? ' ·' : ''}</option>
          ))}
        </select>
      </div>
      </SeccionPlegable>

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
          <SeccionPlegable
            titulo="Columnas y filtros"
            plegada={datosPlegada}
            onAlternar={() => setDatosPlegada((previa) => !previa)}
            resumen={`${columnas.length}/${esquema.columnas.length} columnas`
              + (condiciones.length > 0 ? ` · ${condiciones.length} filtros` : '')}
            acciones={(
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={mostrarDatos}
                disabled={columnas.length === 0}
              >
                Mostrar datos
              </button>
            )}
          >
          <div className="tablero">
            <div className="card">
              <div className="card-label">
                {tabla} · {numero(esquema.total)} filas · {esquema.columnas.length} columnas
                {esquema.claves.length > 0 && <span className="exp-sub"> · clave: {esquema.claves.join(', ')}</span>}
              </div>

              <SelectorDeColumnas
                tabla={tabla}
                todas={esquema.columnas}
                claves={esquema.claves}
                porOmision={columnasPorOmision(esquema.columnas, esquema.claves)}
                elegidas={columnas}
                onCambiar={setColumnas}
              />
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
          </SeccionPlegable>

          <div className="monitor-bar">
            {consulta && (
              <>
                <button type="button" className="btn btn-sm" onClick={() => cargarPagina(pagina - 1)} disabled={pagina === 0 || cargandoFilas}>‹ Anterior</button>
                <span className="page-hint">
                  Página {pagina + 1}{paginas > 0 ? ` de ${numero(paginas)}` : ''} · {numero(filas.length)} filas
                </span>
                <button type="button" className="btn btn-sm" onClick={() => cargarPagina(pagina + 1)} disabled={filas.length < consulta.top || cargandoFilas}>Siguiente ›</button>
              </>
            )}
            {consulta && (
              <span className="page-hint">
                ⓘ El filtro de cada cabecera actúa solo sobre las filas de esta página (empieza con).
              </span>
            )}
            {esquema.claves.length === 0 && consulta && (
              <span className="page-hint" style={{ color: 'var(--accent)' }}>
                Sin claves no hay orden estable: al pasar de página puede haber solapes.
              </span>
            )}
          </div>

          {/* El volcado se lleva TODO lo que devuelve el filtro, no la página que se ve: es lo que se
              pide de un archivo. Por eso puede tardar, y por eso se puede cortar. */}
          {consulta && (
            <div className="monitor-bar">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => volcar(totalDeLaConsulta ?? esquema.total ?? 0)}
                disabled={Boolean(volcado?.leidas !== undefined)}
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
                  {volcado.cortado && ` · se cortó en el tope de ${numero(TOPES.maestro.maximo)}`}
                </span>
              )}

              {volcado?.error && (
                <span className="page-hint" style={{ color: 'var(--red)' }}>{volcado.error}</span>
              )}

              <span className="exp-sub">
                Se descargan las {columnas.length} columnas que se están mirando, con punto y coma,
                como las abre Excel en español.
              </span>
            </div>
          )}

          {/* Escribir en el tenant se pide aparte de mirarlo. En modo lectura no hay ni un botón que
              lo haga: hay que entrar en edición a propósito. */}
          {consulta && (
            <div className="monitor-bar">
              {!clavesTraidas
                ? (
                  <span className="page-hint">
                    {esquema.claves.length === 0
                      ? `${tabla} no declara claves de negocio: sin ellas no hay con qué decirle a SAP `
                        + 'cuál es la fila, así que esta tabla solo se puede mirar.'
                      : `Para editar hay que traer las claves (${esquema.claves.join(', ')}) entre las `
                        + 'columnas y volver a mostrar los datos.'}
                  </span>
                )
                : modo === 'leer'
                  ? (
                    <button type="button" className="btn btn-sm" onClick={() => setModo('editar')}>
                      Editar esta tabla
                    </button>
                  )
                  : (
                    <>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => { setModo('leer'); descartar() }}
                      >
                        {hayPendientes ? 'Descartar y salir' : 'Salir de edición'}
                      </button>

                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => setRevision({ accion: 'modificar' })}
                        disabled={pendientes.campos === 0}
                      >
                        Revisar y guardar
                        {pendientes.campos > 0 && ` (${numero(pendientes.campos)} en `
                          + `${numero(pendientes.filas)} ${pendientes.filas === 1 ? 'fila' : 'filas'})`}
                      </button>

                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => setRevision({ accion: 'borrar' })}
                        disabled={cuantasMarcadas === 0}
                      >
                        Borrar{cuantasMarcadas > 0 && ` ${numero(cuantasMarcadas)}`}…
                      </button>

                      <span className="page-hint">
                        Nada se escribe hasta confirmarlo. Los cambios se conservan al pasar de página.
                      </span>
                    </>
                  )}
            </div>
          )}

          {/* Los cambios pendientes no se tiran al cambiar la consulta, pero si las claves se quedaron
              fuera dejan de poder mandarse: hay que decirlo, no perderlos en silencio. */}
          {hayPendientes && !clavesTraidas && (
            <div className="notice notice-info">
              Hay {numero(pendientes.campos)} cambios y {numero(cuantasMarcadas)} filas marcadas sin
              escribir. Vuelve a incluir las claves entre las columnas para poder guardarlos.
            </div>
          )}

          {consulta && (
            activa && (
            <div className="table-scroll table-alta">
              <table className="table-dense">
                <thead>
                  <tr>
                    {editando && (
                      <th className="col-marca">
                        <input
                          type="checkbox"
                          aria-label="Marcar todas las filas de esta página"
                          checked={filas.length > 0 && filas.every((fila) => marcadas[identidadDe(fila)])}
                          onChange={(evento) => filas.forEach((fila) => marcar(fila, evento.target.checked))}
                        />
                      </th>
                    )}
                    {consulta.select.map((columna) => (
                      <th
                        key={columna}
                        className={encima === columna ? 'col-destino' : undefined}
                        onDragOver={(evento) => {
                          if (!arrastrando || arrastrando === columna) return
                          evento.preventDefault()
                          setEncima(columna)
                        }}
                        onDragLeave={() => setEncima((previa) => (previa === columna ? null : previa))}
                        onDrop={(evento) => {
                          evento.preventDefault()
                          reordenarColumnas(columna)
                          setEncima(null)
                        }}
                      >
                        <div
                          className="th-nombre"
                          role="button"
                          tabIndex={0}
                          title={`${columna} · clic: ordenar · arrastra la cabecera: reordenar`}
                          onClick={() => ordenarPor(columna)}
                          onKeyDown={(evento) => {
                            if (evento.key === 'Enter' || evento.key === ' ') {
                              evento.preventDefault()
                              ordenarPor(columna)
                            }
                          }}
                          draggable
                          onDragStart={() => setArrastrando(columna)}
                          onDragEnd={() => { setArrastrando(null); setEncima(null) }}
                        >
                          {esquema.claves.includes(columna) && <span className="th-clave">🔑</span>}
                          <span className="th-texto">{columna}</span>
                          {orden?.campo === columna && (
                            <span className="th-orden">{orden.dir === 'asc' ? '▲' : '▼'}</span>
                          )}
                        </div>
                        <input
                          className="th-filtro"
                          value={filtrosDeColumna[columna] ?? ''}
                          onChange={(evento) => setFiltrosDeColumna((previos) => (
                            { ...previos, [columna]: evento.target.value }
                          ))}
                          onClick={(evento) => evento.stopPropagation()}
                          placeholder="filtrar…"
                          aria-label={`Filtrar ${columna} en esta página`}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filasVisibles.map((fila, indice) => {
                    const clave = identidadDe(fila) || String(indice)
                    const cambios = edits[clave]?.cambios ?? {}
                    const porBorrar = Boolean(marcadas[clave])

                    return (
                      <tr key={clave} className={porBorrar ? 'fila-por-borrar' : undefined}>
                        {editando && (
                          <td className="col-marca">
                            <input
                              type="checkbox"
                              aria-label={`Marcar ${clave} para borrar`}
                              checked={porBorrar}
                              onChange={(evento) => marcar(fila, evento.target.checked)}
                            />
                          </td>
                        )}
                        {consulta.select.map((columna) => (sePuedeEscribir(fila, columna)
                          ? (
                            <td
                              key={columna}
                              className={`celda-editable${columna in cambios ? ' celda-tocada' : ''}`}
                            >
                              <input
                                value={cambios[columna] ?? String(fila[columna] ?? '')}
                                onChange={(evento) => cambiarCelda(fila, columna, evento.target.value)}
                                aria-label={`${columna} de ${clave}`}
                                title={columna in cambios ? `Antes: ${String(fila[columna] ?? '') || '(vacío)'}` : undefined}
                                disabled={porBorrar}
                              />
                            </td>
                          )
                          : <td key={columna}>{valorLegible(fila[columna])}</td>))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {!cargandoFilas && filas.length === 0 && <div className="sin-datos">Ninguna fila cumple el filtro</div>}
              {/* Que la página tenga filas y no se vea ninguna es de los sitios donde más fácil se
                  cree que el dato no está. Se dice cuál de los dos filtros la vació. */}
              {!cargandoFilas && filas.length > 0 && filasVisibles.length === 0 && (
                <div className="sin-datos">
                  Ninguna fila de esta página coincide con el filtro de columna.
                </div>
              )}
              {cargandoFilas && <div className="sin-datos">Consultando…</div>}
            </div>
            )
          )}
        </>
      )}

      {revision && (
        <EdicionDeDatoMaestro
          accion={revision.accion}
          entidad={consulta.entidad}
          claves={esquema.claves}
          edits={edits}
          filas={Object.values(marcadas)}
          destino={{
            tenant: tenant || conexionId,
            planningArea: consulta.planningArea,
            versionId: consulta.versionId,
            esProductivo: productivo,
          }}
          onEscribir={escribir}
          onCerrar={cerrarRevision}
        />
      )}
    </>
  )
}
