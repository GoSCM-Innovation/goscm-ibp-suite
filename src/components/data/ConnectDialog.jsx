// El asistente de conexión de v7: elegir destino UNA vez y después navegar libre.
//
// Portado de `openConnectDialog` / `showConnStep` / `doConnStep1..3` de `main.js` de v7 y del diálogo
// `#connectDialog` de su `index.html`. Los tres pasos, el indicador de progreso y el panel de
// «conexión activa» son los suyos.
//
// POR QUÉ UN ASISTENTE Y NO TRES DESPLEGABLES EN UNA BARRA. Los tres desplegables obligaban a
// reelegir en cada pantalla y no dejaban ver de un vistazo qué falta para poder trabajar. El
// asistente hace lo contrario: bloquea hasta que el destino está completo, y una vez completo
// desaparece. Las seis aplicaciones quedan abiertas sin volver a preguntar nada.
//
// LA ÚNICA DIFERENCIA DELIBERADA CON v7 está en el paso ①. Allí se escribían la dirección, el usuario
// y la contraseña del tenant; aquí se elige entre las conexiones que el administrador dio de alta.
// No es una simplificación: las credenciales de SAP viven cifradas en Postgres y no pueden llegar al
// navegador —v8 las guardaba en `localStorage` en texto plano y ese es justamente el error que esta
// plataforma existe para no repetir—.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'

import Modal from '../ui/Modal.jsx'
import { conectar, estaConectado, useConexionActiva } from '../../lib/conexion-activa.js'
import { listIbpConnections } from '../../lib/ibp.js'
import { etiquetaDeConexion } from '../../lib/nombre-de-conexion.js'
import { fetchMasterCatalog } from '../../lib/ibp-master-data.js'
import { VERSION_BASE, versionEfectiva } from '../../lib/version-elegida.js'

/** Los tres pasos, con el nombre que llevan en el indicador de progreso. */
const PASOS = [
  { n: 1, label: 'Conexión' },
  { n: 2, label: 'Planning Area' },
  { n: 3, label: 'Versión' },
]

/** Elige sola solo si hay UNA opción. Con varias, la cadena vacía obliga a elegir. */
const unicaOpcion = (opciones) => (opciones.length === 1 ? opciones[0] : '')

/** El indicador de progreso: círculos numerados unidos por una línea que se pone verde al pasar. */
function Stepper({ paso }) {
  return (
    <div className="conn-wizard-stepper modal-stepper">
      {PASOS.map(({ n, label }, indice) => (
        <Fragment key={n}>
          <div className={`stepper-step${n === paso ? ' active' : ''}${n < paso ? ' completed' : ''}`}>
            <div className="step-circle">{n}</div>
            <span className="step-label">{label}</span>
          </div>
          {indice < PASOS.length - 1 && (
            <div className={`stepper-connector${n < paso ? ' completed' : ''}`} />
          )}
        </Fragment>
      ))}
    </div>
  )
}

export default function ConnectDialog({ onClose }) {
  const activa = useConexionActiva()

  // Paso 0 = panel de conexión activa; 1, 2 y 3 = los del asistente. Igual que `showConnStep` de v7:
  // quien ya está conectado ve lo que tiene, no un formulario en blanco.
  const [paso, setPaso] = useState(() => (estaConectado(activa) ? 0 : 1))

  const [conexiones, setConexiones] = useState(null)
  const [error, setError] = useState('')
  const [estado, setEstado] = useState('')

  const [conexionId, setConexionId] = useState(activa.connectionId)
  const [catalogo, setCatalogo] = useState(null)
  const [leyendo, setLeyendo] = useState(false)
  const [area, setArea] = useState(activa.planningArea)
  const [versionId, setVersionId] = useState(activa.version)

  useEffect(() => {
    let abandonado = false
    listIbpConnections()
      .then((lista) => {
        if (abandonado) return
        setConexiones(lista)
        // Con una sola conexión no hay nada que elegir; con varias no se adivina. Elegir el tenant
        // equivocado no da un error: da un análisis creíble de otro sistema.
        setConexionId((actual) => actual || unicaOpcion(lista.map((una) => una.id)))
      })
      .catch((fallo) => {
        if (abandonado) return
        setError(fallo.message)
        setConexiones([])
      })
    return () => { abandonado = true }
  }, [])

  const conexion = useMemo(
    () => conexiones?.find((una) => una.id === conexionId) ?? null,
    [conexiones, conexionId],
  )

  const versiones = useMemo(() => catalogo?.[area]?.versions ?? [], [catalogo, area])
  const version = versionEfectiva(versionId, versiones)

  /** Paso ①: se lee el catálogo del tenant, que es lo que trae las áreas y sus versiones. */
  const doPaso1 = useCallback(() => {
    if (!conexionId) return
    setError('')
    setLeyendo(true)
    setEstado('Leyendo las áreas de planificación del tenant…')
    fetchMasterCatalog(conexionId)
      .then((leido) => {
        setCatalogo(leido.catalogo)
        const areas = Object.keys(leido.catalogo)
        setArea((actual) => (areas.includes(actual) ? actual : unicaOpcion(areas)))
        setEstado(areas.length === 1
          ? '1 área de planificación'
          : `${areas.length} áreas de planificación`)
        setPaso(2)
      })
      .catch((fallo) => { setError(fallo.message); setEstado('') })
      .finally(() => setLeyendo(false))
  }, [conexionId])

  /** Paso ③: queda fijado el destino y el diálogo pasa a enseñar lo que hay. */
  function doPaso3() {
    conectar({
      connectionId: conexionId,
      nombre: conexion?.name ?? '',
      baseUrl: conexion?.baseUrl ?? '',
      planningArea: area,
      version,
      esProduccion: Boolean(conexion?.isProduction),
    })
    setEstado('')
    setPaso(0)
  }

  return (
    <Modal title="Conexión a SAP IBP" onClose={onClose} wide>
      {paso > 0 && <Stepper paso={paso} />}

      {error && <div className="notice notice-error">✕ {error}</div>}

      {/* ── Paso ①: la conexión ─────────────────────────────────────────────────────────────── */}
      {paso === 1 && (
        <div className="conn-step active">
          {conexiones === null && <div className="page-hint">Cargando conexiones…</div>}

          {conexiones?.length === 0 && (
            <div className="notice notice-info">
              No hay ninguna conexión a SAP IBP configurada para tu empresa. Pídele a quien administra
              la cuenta que la dé de alta en Administración → Conexiones.
            </div>
          )}

          {conexiones !== null && conexiones.length > 0 && (
            <>
              <div className="form-group" style={{ maxWidth: 520 }}>
                <label htmlFor="connSel">Conexión</label>
                <select
                  id="connSel"
                  className="conn-select"
                  value={conexionId}
                  onChange={(evento) => {
                    setConexionId(evento.target.value)
                    setCatalogo(null)
                    setArea('')
                    setVersionId('')
                  }}
                >
                  <option value="">Elige una conexión…</option>
                  {conexiones.map((una) => (
                    <option key={una.id} value={una.id}>{etiquetaDeConexion(una)}</option>
                  ))}
                </select>
                {conexion?.isProduction && (
                  <p style={{ fontSize: 11, color: 'var(--accent)', margin: '6px 0 0' }}>
                    ⚠ Es un tenant productivo.
                  </p>
                )}
              </div>

              <p style={{ fontSize: 11, color: 'var(--text3)', margin: '10px 0 0', maxWidth: 520 }}>
                La dirección, el usuario y la contraseña del tenant las guarda cifradas el servidor:
                nunca llegan al navegador. Se dan de alta en Administración → Conexiones.
              </p>

              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={doPaso1}
                  disabled={!conexionId || leyendo}
                >
                  {leyendo ? 'Leyendo…' : 'Continuar →'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Paso ②: el área de planificación ────────────────────────────────────────────────── */}
      {paso === 2 && (
        <div className="conn-step active">
          <div className="form-group" style={{ maxWidth: 420 }}>
            <label htmlFor="paSel">Planning Area</label>
            <select
              id="paSel"
              className="conn-select"
              value={area}
              onChange={(evento) => { setArea(evento.target.value); setVersionId('') }}
            >
              <option value="">Elige un área…</option>
              {Object.entries(catalogo ?? {}).map(([id, una]) => (
                <option key={id} value={id}>{una.desc === id ? id : `${id} — ${una.desc}`}</option>
              ))}
            </select>
          </div>

          <div className="btn-row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setPaso(3)}
              disabled={!area}
            >
              Continuar →
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setPaso(1)}>← Volver</button>
          </div>
        </div>
      )}

      {/* ── Paso ③: la versión ──────────────────────────────────────────────────────────────── */}
      {paso === 3 && (
        <div className="conn-step active">
          <div className="form-group" style={{ maxWidth: 420 }}>
            <label htmlFor="verSel">Versión</label>
            <select
              id="verSel"
              className="conn-select"
              value={version}
              onChange={(evento) => setVersionId(evento.target.value)}
            >
              <option value="">Elige una versión…</option>
              <option value={VERSION_BASE}>Versión base — el dato maestro del área</option>
              {versiones.map((una) => (
                <option key={una.id} value={una.id}>
                  {una.name === una.id ? una.id : `${una.id} — ${una.name}`}
                </option>
              ))}
            </select>
            <p style={{ fontSize: 11, color: 'var(--text3)', margin: '6px 0 0' }}>
              La versión base ejecuta sin filtro de versión: es el dato maestro del área.
            </p>
          </div>

          <div className="btn-row">
            <button type="button" className="btn btn-primary" onClick={doPaso3} disabled={!version}>
              Conectar
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setPaso(2)}>← Volver</button>
          </div>
        </div>
      )}

      {/* ── Panel de conexión activa ────────────────────────────────────────────────────────── */}
      {paso === 0 && (
        <div className="conn-step active">
          <div className="conn-active-status">
            <span className="status-dot on" style={{ width: 10, height: 10 }} />
            <span>Conexión activa</span>
          </div>

          <div className="conn-active-grid">
            {activa.baseUrl && (
              <div className="conn-active-row">
                <span className="conn-active-label">URL</span>
                <span className="conn-active-value">{activa.baseUrl}</span>
              </div>
            )}
            <div className="conn-active-row">
              <span className="conn-active-label">Conexión</span>
              <span className="conn-active-value">
                {activa.nombre}
                {activa.esProduccion && <span className="tag tag-accent" style={{ marginLeft: 8 }}>Productivo</span>}
              </span>
            </div>
            <div className="conn-active-row">
              <span className="conn-active-label">Planning Area</span>
              <span className="conn-active-value">{activa.planningArea}</span>
            </div>
            <div className="conn-active-row">
              <span className="conn-active-label">Versión</span>
              <span className="conn-active-value">
                {activa.version === VERSION_BASE ? 'Versión base' : activa.version}
              </span>
            </div>
          </div>

          <div className="btn-row">
            <button type="button" className="btn btn-primary" onClick={onClose}>Cerrar</button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => { setCatalogo(null); setEstado(''); setPaso(1) }}
            >
              Nueva conexión
            </button>
          </div>
        </div>
      )}

      {estado && <div className="page-hint" style={{ marginTop: 12 }}>{estado}</div>}
    </Modal>
  )
}
