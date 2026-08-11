// Copiar cifras clave de un tenant a otro.
//
// Portada de `KeyFigureMigration.jsx` de v8, con las cuentas y las reglas movidas al núcleo.
//
// Lo que esta pantalla insiste en dejar claro es el NIVEL, porque es donde se equivoca cualquiera: una
// cifra clave no tiene filas propias. Existe a la vez por producto, por producto y ubicación, por
// producto y semana… y lo que se elija decide qué se lee Y qué se escribe. Elegir mal no da un error:
// da un número creíble y equivocado, casi siempre más chico, porque SAP suma sin avisar.
//
// El caso peligroso —un nivel SIN periodo, que aplasta todo el horizonte en un valor por combinación—
// se avisa con todas las letras y no se impide, porque hay cifras que de verdad no llevan tiempo.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { NIVELES_DE_TIEMPO, esCampoDeTiempo } from '../../../core/ibp/kf-migration-plan.js'
import { listIbpConnections } from '../../lib/ibp.js'
import { fetchConversions, fetchPlanningCatalog } from '../../lib/ibp-planning-data.js'
import { contarCifras, copiarSegmentoDeCifras, revisarMigracionDeCifras } from '../../lib/ibp-kf-migration.js'
import Modal from '../ui/Modal.jsx'

const numero = (valor) => Number(valor ?? 0).toLocaleString('es')

/** Un lado de la copia: tenant, área y versión, todo elegido a mano. */
function Lado({ titulo, conexiones, valor, onCambiar, catalogo, cargando }) {
  return (
    <div className="card">
      <div className="card-label">{titulo}</div>

      <select
        className="select input-sm"
        value={valor.connectionId}
        onChange={(evento) => onCambiar({ connectionId: evento.target.value, area: '', versionId: '' })}
        aria-label={`Tenant de ${titulo}`}
      >
        <option value="">Elegí un tenant…</option>
        {conexiones.map((una) => <option key={una.id} value={una.id}>{una.name}</option>)}
      </select>

      {cargando && <div className="exp-sub">Leyendo el área… tarda unos segundos.</div>}

      {catalogo && (
        <>
          <select
            className="select input-sm"
            value={valor.area}
            onChange={(evento) => onCambiar({ ...valor, area: evento.target.value })}
            aria-label={`Área de ${titulo}`}
          >
            <option value="">Elegí un área…</option>
            {catalogo.areas.map((una) => <option key={una} value={una}>{una}</option>)}
          </select>

          <select
            className="select input-sm"
            value={valor.versionId}
            onChange={(evento) => onCambiar({ ...valor, versionId: evento.target.value })}
            aria-label={`Versión de ${titulo}`}
          >
            <option value="">Versión base</option>
            {catalogo.versiones.map((una) => (
              <option key={una.id} value={una.id}>{una.name === una.id ? una.id : `${una.id} — ${una.name}`}</option>
            ))}
          </select>
        </>
      )}
    </div>
  )
}

/** Lee el catálogo del área de planificación de un tenant. */
function useCatalogoDePlanificacion(connectionId) {
  const [catalogo, setCatalogo] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!connectionId) return undefined
    let abandonado = false

    const id = setTimeout(() => {
      setCargando(true)
      setCatalogo(null)
      fetchPlanningCatalog(connectionId)
        .then((leido) => { if (!abandonado) { setCatalogo(leido); setError('') } })
        .catch((fallo) => { if (!abandonado) setError(fallo.message) })
        .finally(() => { if (!abandonado) setCargando(false) })
    }, 0)

    return () => { abandonado = true; clearTimeout(id) }
  }, [connectionId])

  return { catalogo, cargando, error }
}

export default function KfMigration() {
  const [conexiones, setConexiones] = useState([])
  const [origen, setOrigen] = useState({ connectionId: '', area: '', versionId: '' })
  const [destino, setDestino] = useState({ connectionId: '', area: '', versionId: '' })

  const [cifras, setCifras] = useState([])
  const [nivel, setNivel] = useState([])
  const [busquedaCifra, setBusquedaCifra] = useState('')
  const [busquedaNivel, setBusquedaNivel] = useState('')

  const [pedidas, setPedidas] = useState([])
  const [conversiones, setConversiones] = useState({})
  const [revision, setRevision] = useState(null)
  const [plan, setPlan] = useState(null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const [confirmando, setConfirmando] = useState(false)
  const [escrito, setEscrito] = useState('')
  const [avance, setAvance] = useState(null)
  const [salida, setSalida] = useState(null)
  const cancelar = useRef(false)

  useEffect(() => {
    listIbpConnections().then(setConexiones).catch((fallo) => setError(fallo.message))
  }, [])

  const deOrigen = useCatalogoDePlanificacion(origen.connectionId)
  const deDestino = useCatalogoDePlanificacion(destino.connectionId)

  const listo = Boolean(origen.connectionId && origen.area && destino.connectionId && destino.area)

  const cifrasVisibles = useMemo(() => {
    const todas = deOrigen.catalogo?.cifras ?? []
    const texto = busquedaCifra.trim().toUpperCase()
    return (texto ? todas.filter((una) => una.includes(texto)) : todas).slice(0, 200)
  }, [deOrigen.catalogo, busquedaCifra])

  const dimsVisibles = useMemo(() => {
    const todas = deOrigen.catalogo?.dims ?? []
    const texto = busquedaNivel.trim().toUpperCase()
    return (texto ? todas.filter((una) => una.includes(texto)) : todas).slice(0, 200)
  }, [deOrigen.catalogo, busquedaNivel])

  /**
   * Hay cifras que EXIGEN un atributo de conversión —la unidad o la moneda de destino— y sin él SAP
   * rechaza hasta el conteo con un 400. El mensaje nombra el atributo pero no dice qué poner, así que
   * se detecta al elegir la cifra y se pide. Es el mismo mecanismo que el visor de cifras clave.
   */
  useEffect(() => {
    if (cifras.length === 0 || !origen.connectionId || !origen.area) return undefined
    let abandonado = false

    const id = setTimeout(async () => {
      try {
        const porCifra = await Promise.all(cifras.map((una) => fetchConversions(origen.connectionId, {
          area: origen.area, cifra: una,
        })))
        // La unión: basta que UNA de las cifras elegidas lo exija para que haya que ponerlo.
        if (!abandonado) setPedidas([...new Set(porCifra.flat())])
      } catch (fallo) {
        if (!abandonado) setError(fallo.message)
      }
    }, 0)

    return () => { abandonado = true; clearTimeout(id) }
  }, [cifras, origen.connectionId, origen.area])

  const faltaConversion = pedidas.find((campo) => !conversiones[campo])

  const peticion = useMemo(
    () => ({ origen: { ...origen, conversiones }, destino, cifras, dimensiones: nivel }),
    [origen, conversiones, destino, cifras, nivel],
  )

  const revisar = useCallback(async () => {
    setOcupado(true)
    setPlan(null)
    setSalida(null)
    try {
      setRevision(await revisarMigracionDeCifras(peticion))
      setError('')
    } catch (fallo) {
      setError(fallo.message)
    } finally {
      setOcupado(false)
    }
  }, [peticion])

  async function contar() {
    setOcupado(true)
    try {
      setPlan(await contarCifras(peticion))
      setError('')
    } catch (fallo) {
      setError(fallo.message)
    } finally {
      setOcupado(false)
    }
  }

  /**
   * Copia encadenando segmentos.
   *
   * Se para al agotar la cifra, al cancelar, o si SAP dice que la cifra es CALCULADA: eso último no
   * mejora en el segmento siguiente, así que insistir solo hace perder tiempo.
   */
  async function copiar() {
    setConfirmando(false)
    cancelar.current = false
    setSalida(null)

    let desde = 0
    let copiadas = 0
    const mensajes = []

    for (;;) {
      if (cancelar.current) break
      setAvance({ desde, copiadas })

      let segmento
      try {
        segmento = await copiarSegmentoDeCifras({ ...peticion, desde, cuantas: 5000 })
      } catch (fallo) {
        setSalida({ copiadas, error: fallo.message })
        setAvance(null)
        return
      }

      if (!segmento.ok) {
        setSalida({ copiadas, error: segmento.error, cifraCalculada: segmento.cifraCalculada })
        setAvance(null)
        return
      }

      copiadas += segmento.filas
      mensajes.push(...(segmento.mensajes ?? []))
      if (segmento.agotado) break
      desde += segmento.filas
    }

    setSalida({ copiadas, mensajes, cancelado: cancelar.current })
    setAvance(null)
  }

  const tenantDestino = conexiones.find((una) => una.id === destino.connectionId)
  const sinPeriodo = nivel.length > 0 && !nivel.some(esCampoDeTiempo)

  return (
    <div className="module-body">
      <div className="notice notice-info">
        Una cifra clave no tiene filas propias: existe a la vez a varios niveles, y el que elijas
        decide qué se lee <b>y</b> qué se escribe. Elegir mal no da un error — da un número creíble y
        equivocado, porque SAP suma sin avisar.
      </div>

      {(error || deOrigen.error || deDestino.error) && (
        <div className="notice notice-error">✕ {error || deOrigen.error || deDestino.error}</div>
      )}

      <div className="grid-charts">
        <Lado
          titulo="origen"
          conexiones={conexiones}
          valor={origen}
          onCambiar={(nuevo) => { setOrigen(nuevo); setCifras([]); setNivel([]); setRevision(null); setPlan(null); setPedidas([]); setConversiones({}) }}
          catalogo={deOrigen.catalogo}
          cargando={deOrigen.cargando}
        />
        <Lado
          titulo="destino"
          conexiones={conexiones}
          valor={destino}
          onCambiar={(nuevo) => { setDestino(nuevo); setRevision(null); setPlan(null) }}
          catalogo={deDestino.catalogo}
          cargando={deDestino.cargando}
        />
      </div>

      {deOrigen.catalogo && (
        <div className="grid-charts">
          <div className="card">
            <div className="card-label">
              Cifras clave a copiar ({cifras.length} de {numero(deOrigen.catalogo.cifras.length)})
            </div>
            <input
              className="input input-sm"
              value={busquedaCifra}
              onChange={(evento) => setBusquedaCifra(evento.target.value)}
              placeholder="Buscar una cifra"
            />
            <div className="columnas">
              {cifrasVisibles.map((una) => (
                <label key={una} className={`columna${cifras.includes(una) ? ' columna-clave' : ''}`}>
                  <input
                    type="checkbox"
                    checked={cifras.includes(una)}
                    onChange={() => setCifras((previas) => (previas.includes(una)
                      ? previas.filter((otra) => otra !== una)
                      : [...previas, una]))}
                  />
                  {una}
                </label>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-label">Nivel ({nivel.length} atributos)</div>

            {/* Los niveles de tiempo aparte y primero: es la decisión que más cambia el resultado. */}
            <div className="exp-sub">Periodo</div>
            <div className="seg">
              {NIVELES_DE_TIEMPO.filter((uno) => (deOrigen.catalogo.dims ?? []).includes(uno.campo)).map((uno) => (
                <button
                  key={uno.campo}
                  type="button"
                  className={`seg-btn${nivel.includes(uno.campo) ? ' active' : ''}`}
                  onClick={() => setNivel((previos) => {
                    // Un solo nivel de tiempo: dos periodos a la vez no significan nada.
                    const sinTiempo = previos.filter((otro) => !esCampoDeTiempo(otro))
                    return previos.includes(uno.campo) ? sinTiempo : [...sinTiempo, uno.campo]
                  })}
                  aria-pressed={nivel.includes(uno.campo)}
                >
                  {uno.etiqueta}
                </button>
              ))}
            </div>

            <input
              className="input input-sm"
              value={busquedaNivel}
              onChange={(evento) => setBusquedaNivel(evento.target.value)}
              placeholder="Buscar un atributo"
            />
            <div className="columnas">
              {dimsVisibles.filter((una) => !esCampoDeTiempo(una)).map((una) => (
                <label key={una} className={`columna${nivel.includes(una) ? ' columna-clave' : ''}`}>
                  <input
                    type="checkbox"
                    checked={nivel.includes(una)}
                    onChange={() => setNivel((previos) => (previos.includes(una)
                      ? previos.filter((otro) => otro !== una)
                      : [...previos, una]))}
                  />
                  {una}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {pedidas.length > 0 && (
        <div className="card">
          <div className="card-label">Estas cifras exigen una conversión</div>
          <p className="exp-sub">
            SAP no las deja leer sin estos atributos en el filtro, ni para contar. Si el resultado sale
            vacío, probá con otra unidad: en el tenant de pruebas «KG» tiene datos y «EA» no.
          </p>
          <div className="condicion">
            {pedidas.map((campo) => (
              <label key={campo} className="exp-enriq">
                <span className="exp-k">{campo}</span>
                <input
                  className="input input-sm"
                  value={conversiones[campo] ?? ''}
                  onChange={(evento) => setConversiones((previas) => ({
                    ...previas, [campo]: evento.target.value.toUpperCase(),
                  }))}
                  placeholder={campo === 'UOMTOID' ? 'KG' : 'USD'}
                />
              </label>
            ))}
          </div>
          {faltaConversion && (
            <div className="exp-sub" style={{ color: 'var(--accent)' }}>
              Falta {faltaConversion} para poder seguir.
            </div>
          )}
        </div>
      )}

      {sinPeriodo && (
        <div className="notice notice-info">
          ⚠ El nivel no incluye ningún periodo. SAP va a sumar <b>todo el horizonte</b> en un solo
          valor por combinación, y eso es lo que se escribiría. Si no es lo que querés, elegí un periodo.
        </div>
      )}

      <div className="monitor-bar">
        <button type="button" className="btn btn-sm" onClick={revisar} disabled={!listo || ocupado || Boolean(faltaConversion)}>
          {ocupado ? 'Revisando…' : 'Revisar'}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={contar}
          disabled={!revision?.revision?.sePuede || ocupado || Boolean(faltaConversion)}
        >
          Contar filas
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => { setEscrito(''); setConfirmando(true) }}
          disabled={!revision?.revision?.sePuede || Boolean(avance) || Boolean(faltaConversion)}
        >
          ▶ Copiar
        </button>

        {avance && (
          <>
            <button type="button" className="btn btn-sm" onClick={() => { cancelar.current = true }}>Cancelar</button>
            <span className="page-hint">Copiadas {numero(avance.copiadas)} filas…</span>
          </>
        )}
        {plan && !avance && (
          <span className="page-hint">
            {numero(plan.total)} filas · {plan.segmentos} {plan.segmentos === 1 ? 'segmento' : 'segmentos'}
            {plan.partirPorTiempo && ' · conviene partir por periodo'}
          </span>
        )}
      </div>

      {revision?.revision?.impedimentos.map((uno) => (
        <div className="notice notice-error" key={uno}>✕ {uno}</div>
      ))}
      {revision?.revision?.avisos.map((uno) => (
        <div className="notice notice-info" key={uno}>{uno}</div>
      ))}

      {salida && (
        <div className={`notice notice-${salida.error ? 'error' : 'ok'}`}>
          {salida.error ? '✕ ' : '✓ '}
          Se copiaron {numero(salida.copiadas)} filas
          {salida.cifraCalculada && ` · la cifra ${salida.cifraCalculada} es calculada y no se puede escribir`}
          {salida.error && !salida.cifraCalculada && ` · ${salida.error}`}
          {salida.cancelado && ' · cancelado'}
          {salida.mensajes?.length > 0 && ` · SAP rechazó ${numero(salida.mensajes.length)} filas`}.
        </div>
      )}

      {confirmando && (
        <Modal
          title="Copiar cifras clave"
          subtitle={`${cifras.length} ${cifras.length === 1 ? 'cifra' : 'cifras'} · nivel de ${revision.revision.nivel.length} atributos`}
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
            Se van a <b>escribir cifras clave</b> en <b>{tenantDestino?.name}</b>, área{' '}
            <b>{destino.area}</b>, versión <b>{destino.versionId || 'base'}</b>, al nivel{' '}
            <b>{revision.revision.nivel.join(' · ')}</b>.
          </p>

          {revision.destinoEsProductivo && (
            <div className="notice notice-error">⚠ Ese tenant está marcado como <b>productivo</b>.</div>
          )}

          {!revision.revision.nivelDeTiempo && (
            <div className="notice notice-error">
              ⚠ El nivel no lleva periodo: se va a escribir <b>un solo valor por combinación</b> con
              todo el horizonte sumado.
            </div>
          )}

          <p className="exp-sub">
            Los valores que ya existan en esas combinaciones se <b>sobrescriben</b>. Nada se borra.
          </p>

          <label className="exp-enriq">
            <span className="exp-k">Escribí «copiar» para confirmar</span>
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
