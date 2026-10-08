// Revisar los cambios antes de mandarlos a SAP. Portado tal cual de `DataViewer/EditReviewModal.jsx`
// de v8.
//
// Enseña cada cambio pendiente —registro, campo, antes y después— para que se confirme exactamente lo
// que se va a escribir. Mientras se escribe dice «Enviando a SAP…» y después el resultado (bien,
// rechazos de SAP o error) antes de cerrar. La escritura la hace quien abre el diálogo.
//
// Lo usan los dos visores: en v8 era el mismo diálogo para dato maestro y para key figures.

import { valorLegible } from '../../../core/ibp/master-data-model.js'

const MAX_SHOWN = 200   // más de doscientas filas no se leen: el resto se resume

const backdrop = {
  position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,.5)',
  backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
}
const card = {
  background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 12,
  boxShadow: 'var(--shadow-lg)', width: 'min(720px, 100%)', maxHeight: '85vh',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
}
const TH = { textAlign: 'left', padding: '5px 10px', fontSize: 10, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg2)' }
const TD = { padding: '5px 10px', fontSize: 12, borderBottom: '1px solid var(--border)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }
const btnSec = { background: 'none', border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--text2)', fontSize: 12, fontWeight: 600, padding: '8px 16px', cursor: 'pointer' }
const btnPri = { background: 'var(--accent)', border: 'none', borderRadius: 6, color: 'var(--text-on-accent)', fontSize: 12, fontWeight: 700, padding: '8px 18px', cursor: 'pointer' }

const cellText = (v, c) => (v == null ? '' : valorLegible(v, c))
const num = n => Number(n ?? 0).toLocaleString()

/**
 * `edits` es `{ [clave]: { row, changes } }`. `result`, cuando ya se escribió, es
 * `{ status: 'ok' | 'warning' | 'error', count, errors, message }`.
 */
export default function EditReviewModal({ open, edits, keyNames = [], onConfirm, onClose, saving, result }) {
  if (!open) return null

  // Una fila de la tabla por campo cambiado.
  const changeRows = []
  for (const { row, changes } of Object.values(edits)) {
    const key = keyNames.map(k => cellText(row[k], k)).join(' · ') || '—'
    for (const [field, val] of Object.entries(changes)) {
      changeRows.push({ key, field, before: cellText(row[field], field), after: cellText(val, field) })
    }
  }
  const rowCount = Object.keys(edits).length
  const shown = changeRows.slice(0, MAX_SHOWN)
  const extra = changeRows.length - shown.length

  const statusColor = s => s === 'ok' ? 'var(--green)' : s === 'warning' ? 'var(--yellow, #e6a817)' : 'var(--red)'

  return (
    <div style={backdrop} onClick={saving ? undefined : onClose}>
      <div style={card} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Revisar cambios antes de enviar a SAP</div>
          {!result && (
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
              {num(rowCount)} fila(s) con {num(changeRows.length)} cambio(s). Se enviarán a SAP como actualización (upsert).
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: result ? 18 : 0 }}>
          {result ? (
            <div style={{ fontSize: 13 }}>
              <div style={{ color: statusColor(result.status), fontWeight: 700, marginBottom: 8 }}>
                {result.status === 'ok' && `${num(result.count)} fila(s) actualizada(s) correctamente.`}
                {result.status === 'warning' && `Enviado, pero SAP rechazó ${num(result.errors?.length)} registro(s). Revisa los mensajes.`}
                {result.status === 'error' && `No se pudo guardar: ${result.message || ''}`}
              </div>
              {result.errors?.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text2)', fontSize: 12 }}>
                  {result.errors.slice(0, 50).map((m, i) => (
                    <li key={i} style={{ marginBottom: 3 }}>{m.Message || m.message || JSON.stringify(m)}</li>
                  ))}
                  {result.errors.length > 50 && <li>+{result.errors.length - 50} más</li>}
                </ul>
              )}
            </div>
          ) : (
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={TH}>Registro (clave)</th>
                  <th style={TH}>Campo</th>
                  <th style={TH}>Antes</th>
                  <th style={TH}>Después</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c, i) => (
                  <tr key={i}>
                    <td style={{ ...TD, color: 'var(--text2)' }} title={c.key}>{c.key}</td>
                    <td style={TD} title={c.field}>{c.field}</td>
                    <td style={{ ...TD, color: 'var(--text3)' }} title={c.before}>{c.before || '∅'}</td>
                    <td style={{ ...TD, color: 'var(--accent)' }} title={c.after}>{c.after || '∅'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!result && extra > 0 && (
            <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text3)' }}>+{extra} más</div>
          )}
        </div>

        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center' }}>
          {saving && <span style={{ fontSize: 12, color: 'var(--text2)', marginRight: 'auto' }}>Enviando a SAP…</span>}
          {result ? (
            <button type="button" style={btnPri} onClick={onClose}>Cerrar</button>
          ) : (
            <>
              <button type="button" style={btnSec} onClick={onClose} disabled={saving}>Cancelar</button>
              <button type="button" style={{ ...btnPri, opacity: saving ? 0.6 : 1, cursor: saving ? 'wait' : 'pointer' }} onClick={onConfirm} disabled={saving}>
                Confirmar y enviar a SAP
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
