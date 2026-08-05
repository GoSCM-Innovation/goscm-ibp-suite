// Los registros de una ejecución: monitor, trace y error.
//
// Portado del visor de v9. Los tres se piden en una sola llamada —así lo hacía v9 y así lo admite
// la operación— y las pestañas solo cambian cuál se muestra, sin volver a consultar.
//
// El descifrado de las líneas vive en `core/soap/operations.js`: SAP las manda en base64, una por
// una pero varias dentro del mismo elemento. Aquí llegan ya en texto.

import { useEffect, useState } from 'react'
import { cidsCall } from '../../lib/cids.js'
import { copyText } from '../../lib/clipboard.js'
import Modal from '../ui/Modal.jsx'

const PESTANIAS = [
  { key: 'monitorLog', label: 'Monitor' },
  { key: 'traceLog', label: 'Trace' },
  { key: 'errorLog', label: 'Error' },
]

export default function TaskLogsModal({ connectionId, run, onClose }) {
  const [activa, setActiva] = useState('monitorLog')
  const [registros, setRegistros] = useState(null)
  const [error, setError] = useState('')
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    let abandonado = false
    cidsCall(connectionId, 'getTaskLogs', {
      runId: run.runId,
      traceLog: { getLog: true },
      monitorLog: { getLog: true },
      errorLog: { getLog: true },
    })
      .then((datos) => { if (!abandonado) setRegistros(datos) })
      .catch((fallo) => { if (!abandonado) setError(fallo.message) })
    return () => { abandonado = true }
  }, [connectionId, run.runId])

  const registro = registros?.[activa]
  const lineas = registro?.messageLines ?? []
  const texto = lineas.join('\n')

  // SAP pagina los registros y aquí se pide la primera página, igual que v9. Si hay más, se dice:
  // callarlo haría que alguien leyera medio registro de error creyendo que lo leyó entero.
  const paginas = Number.parseInt(registro?.maxPage, 10) || 1

  async function copiar() {
    if (await copyText(texto)) {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    }
  }

  return (
    <Modal
      wide
      title="Registros de la ejecución"
      subtitle={`${run.taskName ?? '—'} · RunID ${run.runId}`}
      onClose={onClose}
      footer={
        <>
          <div className="modal-foot-info">
            {paginas > 1 && `SAP devolvió ${paginas} páginas de este registro; se muestra la primera.`}
          </div>
          <button type="button" className="btn btn-sm" onClick={copiar} disabled={lineas.length === 0}>
            {copiado ? '✓ Copiado' : '⧉ Copiar'}
          </button>
        </>
      }
    >
      <div className="modal-tabs">
        {PESTANIAS.map((pestania) => (
          <button
            key={pestania.key}
            type="button"
            className={`modal-tab${activa === pestania.key ? ' active' : ''}`}
            onClick={() => setActiva(pestania.key)}
            aria-pressed={activa === pestania.key}
          >
            {pestania.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="notice notice-error">✕ {error}</div>
      ) : registros === null ? (
        <div className="page-hint">Cargando registros…</div>
      ) : lineas.length === 0 ? (
        <div className="page-hint">Este registro vino vacío.</div>
      ) : (
        <pre className="log-pre">{texto}</pre>
      )}
    </Modal>
  )
}
