// Los pasos de una ejecución, y los registros que dejó cada uno.
//
// Portado de `StepsPanel.jsx` de v8. Los registros se piden solo al abrir un paso y solo si lo
// merece: SAP dice de antemano cuántos tiene (`NrOfLogs`), así que un paso sin ninguno no genera
// consulta. v8 hacía lo mismo y es lo que evita una ráfaga de peticiones al abrir el panel.

import { useEffect, useState } from 'react'

import { formatSapTimestamp } from '../../lib/dates.js'
import { fetchLogMessages, fetchRunSteps, fetchStepLogs, nombreDeEjecucion } from '../../lib/ibp-jobs.js'
import { isProblemMessage, jobStatusMeta, messageTypeMeta } from '../../../core/ibp/job-status.js'
import Modal from '../ui/Modal.jsx'

/** El nombre legible de un paso. El técnico (`/IBP/HCI_DI`) es el respaldo. */
const nombreDePaso = (paso) => paso.JobCatalogEntryText || paso.JobCatalogEntryName || `Paso ${paso.StepNumber}`

/**
 * El texto de una línea de registro.
 *
 * Cuando SAP no manda el texto ya compuesto, lo que queda es el identificador del mensaje y sus
 * cuatro variables. Mostrar eso es feo, pero es lo único que hay y esconderlo dejaría la línea en
 * blanco justo cuando alguien busca por qué falló algo.
 */
function textoDeLinea(linea) {
  if (linea.MsgText) return linea.MsgText

  const variables = [linea.MsgV1, linea.MsgV2, linea.MsgV3, linea.MsgV4].filter(Boolean)
  const identificador = [linea.MsgId, linea.MsgNo].filter(Boolean).join(' ')
  return [identificador, variables.join(' · ')].filter(Boolean).join(' — ') || '—'
}

/** Cuántos mensajes de cada clase trae un registro, sin nombrar los que están a cero. */
function resumenDeSeveridad(registro) {
  const partes = [
    [registro.MsgCntE, 'error', 'errores'],
    [registro.MsgCntA, 'interrupción', 'interrupciones'],
    [registro.MsgCntW, 'aviso', 'avisos'],
    [registro.MsgCntS, 'correcto', 'correctos'],
    [registro.MsgCntI, 'informativo', 'informativos'],
  ]
    .filter(([cuantos]) => Number(cuantos) > 0)
    .map(([cuantos, singular, plural]) => `${cuantos} ${Number(cuantos) === 1 ? singular : plural}`)

  return partes.length > 0 ? partes.join(' · ') : `${registro.MsgCntAll ?? 0} mensajes`
}

/** Los registros de un paso: se piden al abrirlo, no antes. */
function RegistrosDelPaso({ conexionId, ejecucion, paso }) {
  const [estado, setEstado] = useState({ cargando: true })

  useEffect(() => {
    let abandonado = false
    const guardar = (valor) => { if (!abandonado) setEstado(valor) }

    fetchStepLogs(conexionId, {
      jobName: ejecucion.JobName,
      runCount: ejecucion.JobRunCount,
      stepNumber: paso.StepNumber,
    })
      .then(async (registros) => {
        if (registros.length === 0) return guardar({ registros: [], lineas: [] })

        // El primero es el que interesa casi siempre; los demás quedan listados.
        const lineas = await fetchLogMessages(conexionId, {
          jobName: ejecucion.JobName,
          runCount: ejecucion.JobRunCount,
          stepNumber: paso.StepNumber,
          logHandle: registros[0].LogHandle,
        })
        guardar({ registros, lineas })
      })
      .catch((fallo) => guardar({ error: fallo.message }))

    return () => { abandonado = true }
  }, [conexionId, ejecucion, paso])

  if (estado.cargando) return <div className="page-hint">Buscando los registros…</div>
  if (estado.error) return <div className="notice notice-error">✕ {estado.error}</div>
  if (estado.lineas.length === 0) return <p className="exp-empty">Este paso no dejó ninguna línea de registro.</p>

  const primero = estado.registros[0]

  return (
    <>
      <div className="exp-sub">
        {resumenDeSeveridad(primero)}
        {estado.registros.length > 1 && ` · el paso dejó ${estado.registros.length} registros y se muestra el primero`}
      </div>

      <div className="table-scroll job-log">
        <table className="table-dense">
          <thead><tr><th className="job-log-tipo">Tipo</th><th>Mensaje</th></tr></thead>
          <tbody>
            {estado.lineas.map((linea, i) => {
              const meta = messageTypeMeta(linea.MsgType)
              return (
                <tr key={`${linea.MsgNumber ?? i}`}>
                  <td>
                    <span
                      className="badge"
                      style={{ background: `${meta.color}26`, borderColor: `${meta.color}4d`, color: meta.color }}
                    >
                      {meta.label}
                    </span>
                  </td>
                  <td className={isProblemMessage(linea.MsgType) ? 'job-log-problema' : undefined}>
                    {textoDeLinea(linea)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** Un paso, plegable. Solo al abrirlo se piden sus registros. */
function Paso({ conexionId, ejecucion, paso, zona }) {
  const [abierto, setAbierto] = useState(false)
  const meta = jobStatusMeta(paso.StepStatus)
  const registros = Number(paso.NrOfLogs) || 0
  // Un código de retorno distinto de cero es un fallo aunque el estado no lo diga.
  const conError = paso.StepAppRC != null && Number(paso.StepAppRC) !== 0

  return (
    <div className="exp-section">
      <button type="button" className="exp-section-head" onClick={() => setAbierto((previo) => !previo)}>
        <span className="job-step-title">
          <span className="job-step-num">{paso.StepNumber}</span>
          <span className="badge" style={{ background: `${meta.color}26`, borderColor: `${meta.color}4d`, color: meta.color }}>
            {meta.label}
          </span>
          {nombreDePaso(paso)}
          {conError && <span className="tag tag-muted">RC {paso.StepAppRC}</span>}
          {registros > 0 && <span className="exp-count">{registros}</span>}
        </span>
        <span className="exp-arrow">{abierto ? '▼' : '▶'}</span>
      </button>

      {abierto && (
        <div className="exp-section-body">
          <div className="exp-atl-datos">
            <div><span className="exp-k">Empezó</span> {formatSapTimestamp(paso.StepStartDateTime, zona)}</div>
            <div><span className="exp-k">Tipo</span> <span className="mono">{paso.JobCatalogEntryName || '—'}</span></div>
            <div><span className="exp-k">Código de retorno</span> {paso.StepAppRC ?? '—'}</div>
            {paso.StepHasResults && <div><span className="exp-k">Resultados</span> el paso dejó resultados en IBP</div>}
          </div>

          {registros > 0
            ? <RegistrosDelPaso conexionId={conexionId} ejecucion={ejecucion} paso={paso} />
            : <p className="exp-empty">SAP no registró líneas para este paso.</p>}
        </div>
      )}
    </div>
  )
}

export default function JobStepsPanel({ conexionId, ejecucion, zona, onClose }) {
  const [estado, setEstado] = useState({ cargando: true })

  useEffect(() => {
    let abandonado = false
    const guardar = (valor) => { if (!abandonado) setEstado(valor) }

    fetchRunSteps(conexionId, { jobName: ejecucion.JobName, runCount: ejecucion.JobRunCount })
      .then((pasos) => guardar({ pasos }))
      .catch((fallo) => guardar({ error: fallo.message }))

    return () => { abandonado = true }
  }, [conexionId, ejecucion])

  return (
    <Modal
      wide
      title={nombreDeEjecucion(ejecucion)}
      subtitle={`${ejecucion.JobStepCount ?? 0} pasos · ejecución ${ejecucion.JobRunCount}`}
      onClose={onClose}
    >
      {estado.cargando && <div className="page-hint">Cargando los pasos…</div>}
      {estado.error && <div className="notice notice-error">✕ {estado.error}</div>}

      {estado.pasos?.length === 0 && <p className="exp-empty">Esta ejecución no tiene pasos.</p>}

      <div className="job-steps">
        {(estado.pasos ?? []).map((paso) => (
          <Paso
            key={paso.StepNumber}
            conexionId={conexionId}
            ejecucion={ejecucion}
            paso={paso}
            zona={zona}
          />
        ))}
      </div>
    </Modal>
  )
}
