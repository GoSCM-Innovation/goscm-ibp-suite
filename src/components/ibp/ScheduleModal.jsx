// Lanzar una plantilla de trabajo, viendo antes con qué va a correr.
//
// Portado de `ScheduleModal.jsx` de v8. Los parámetros se MUESTRAN, no se editan: un Application Job
// se configura en IBP y desde aquí solo se dispara con lo que ya tiene guardado. Un formulario que
// dejara cambiarlos aquí duplicaría esa configuración y las dos versiones se irían separando.
//
// Lo que sí se puede poner es el nombre de la ejecución, que es lo que después se lee en el monitor.

import { useEffect, useState } from 'react'

import { nombreBase, tieneValor } from '../../../core/ibp/job-params.js'
import { fetchTemplateDetail, scheduleJob } from '../../lib/ibp-jobs.js'
import { nombreDeJob } from '../../lib/ibp.js'
import Modal from '../ui/Modal.jsx'

/** Los valores de un parámetro, listos para leer. */
function Valor({ parametro, valores }) {
  const suyos = valores[nombreBase(parametro.name)] ?? []

  if (parametro.isCheckbox) {
    const marcado = suyos.includes('X')
    return <span style={{ color: marcado ? 'var(--green)' : 'var(--text3)' }}>{marcado ? '☑ sí' : '☐ no'}</span>
  }

  if (suyos.length === 0) return <span className="exp-muted">sin valor</span>
  return <span>{suyos.join(', ')}</span>
}

/** Un paso de la plantilla: primero lo que tiene valor, después lo demás. */
function Paso({ paso, abiertoPorOmision }) {
  const [abierto, setAbierto] = useState(abiertoPorOmision)

  const conValor = paso.params.filter((uno) => tieneValor(uno, paso.valores))
  const sinValor = paso.params.filter((uno) => !tieneValor(uno, paso.valores))

  return (
    <div className="exp-section">
      <button type="button" className="exp-section-head" onClick={() => setAbierto((previo) => !previo)}>
        <span className="job-step-title">
          <span className="job-step-num">{paso.posicion}</span>
          {paso.nombre || paso.titulo}
          {conValor.length > 0 && <span className="exp-count">{conValor.length}</span>}
        </span>
        <span className="exp-arrow">{abierto ? '▼' : '▶'}</span>
      </button>

      {abierto && (
        <div className="exp-section-body">
          {paso.nombre && paso.titulo !== paso.nombre && <div className="exp-sub">{paso.titulo}</div>}

          {paso.params.length === 0 && <p className="exp-empty">Este paso no tiene parámetros.</p>}

          {conValor.length > 0 && (
            <div className="table-scroll">
              <table className="table-dense">
                <thead><tr><th>Parámetro</th><th>Valor</th></tr></thead>
                <tbody>
                  {conValor.map((uno) => (
                    <tr key={uno.name}>
                      <td>
                        {uno.label}
                        {uno.group && <div className="exp-sub">{uno.group}</div>}
                      </td>
                      <td><Valor parametro={uno} valores={paso.valores} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {sinValor.length > 0 && (
            <div className="exp-sub">
              Sin configurar: {sinValor.map((uno) => uno.label).join(' · ')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ScheduleModal({ conexionId, plantilla, onClose, onLanzada }) {
  const nombreDeLaPlantilla = nombreDeJob(plantilla)

  const [detalle, setDetalle] = useState(null)
  const [error, setError] = useState('')
  const [texto, setTexto] = useState(nombreDeLaPlantilla)
  const [lanzando, setLanzando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [resultado, setResultado] = useState(null)

  useEffect(() => {
    let abandonado = false
    fetchTemplateDetail(conexionId, plantilla.JobTemplateName)
      .then((leido) => { if (!abandonado) setDetalle(leido) })
      .catch((fallo) => { if (!abandonado) { setError(fallo.message); setDetalle({ pasos: [] }) } })
    return () => { abandonado = true }
  }, [conexionId, plantilla.JobTemplateName])

  async function lanzar() {
    setLanzando(true)
    setError('')
    try {
      const salida = await scheduleJob(conexionId, {
        templateName: plantilla.JobTemplateName,
        jobText: texto.trim() || nombreDeLaPlantilla,
      })
      setResultado(salida)
      onLanzada?.()
    } catch (fallo) {
      setError(fallo.message)
      setConfirmando(false)
    } finally {
      setLanzando(false)
    }
  }

  if (resultado) {
    return (
      <Modal title="Lanzada" subtitle={nombreDeLaPlantilla} onClose={onClose}
        footer={<button type="button" className="btn btn-sm btn-primary" onClick={onClose}>Cerrar</button>}
      >
        <div className="notice notice-ok">
          ✓ SAP aceptó la ejecución{resultado.jobRunCount ? ` (${resultado.jobRunCount})` : ''}.
        </div>
        <p>Va a aparecer en el monitor de trabajos en cuanto SAP la tome.</p>
      </Modal>
    )
  }

  return (
    <Modal
      wide
      title={confirmando ? 'Confirmar' : nombreDeLaPlantilla}
      subtitle={plantilla.JobTemplateName}
      onClose={onClose}
      footer={confirmando
        ? (
          <>
            <button type="button" className="btn btn-sm" onClick={() => setConfirmando(false)} disabled={lanzando}>
              Volver
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={lanzar} disabled={lanzando}>
              {lanzando ? 'Lanzando…' : 'Sí, lanzarla'}
            </button>
          </>
        )
        : (
          <>
            <button type="button" className="btn btn-sm" onClick={onClose}>Cancelar</button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setConfirmando(true)}
              disabled={detalle === null}
            >
              ▶ Lanzar
            </button>
          </>
        )}
    >
      {error && <div className="notice notice-error">✕ {error}</div>}

      {confirmando
        ? (
          <>
            <p>
              Se va a ejecutar <b>{nombreDeLaPlantilla}</b> en el tenant, con los parámetros que tiene
              configurados en IBP. Si es un trabajo de integración, va a mover datos de verdad.
            </p>
            <p className="exp-sub">Aparecerá en el monitor como «{texto.trim() || nombreDeLaPlantilla}».</p>
          </>
        )
        : (
          <>
            <label className="exp-enriq">
              <span className="exp-k">Nombre de la ejecución</span>
              <input
                className="input input-sm"
                value={texto}
                onChange={(evento) => setTexto(evento.target.value)}
                placeholder={nombreDeLaPlantilla}
              />
            </label>

            {detalle === null && <div className="page-hint">Leyendo la plantilla…</div>}

            {detalle?.completo === false && detalle.pasos.length > 0 && (
              <div className="notice notice-info">
                SAP no deja leer el detalle completo de esta plantilla, así que los parámetros salen
                sin repartir por paso. Los valores son los mismos.
              </div>
            )}

            {detalle?.pasos.length === 0 && (
              <p className="exp-empty">
                SAP no devolvió los parámetros de esta plantilla. Se puede lanzar igual: correrá con lo
                que tenga configurado.
              </p>
            )}

            <div className="job-steps">
              {(detalle?.pasos ?? []).map((paso) => (
                <Paso key={paso.posicion} paso={paso} abiertoPorOmision={detalle.pasos.length === 1} />
              ))}
            </div>
          </>
        )}
    </Modal>
  )
}
