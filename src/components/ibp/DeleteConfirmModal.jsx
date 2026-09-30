// Confirmar antes de borrar dato maestro. Portado tal cual de `DataViewer/DeleteConfirmModal.jsx`
// de v8.
//
// Borrar en SAP IBP es IRREVERSIBLE, así que el diálogo lo dice sin rodeos, lista los registros
// exactos que se van a borrar —por su clave de negocio— y pide confirmarlo a propósito. Mientras
// borra lo dice, y después enseña el resultado. El borrado lo hace quien abre el diálogo.

import { valorLegible } from '../../../core/ibp/master-data-model.js'

const MAX_SHOWN = 300

const backdrop = {
  position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,.5)',
  backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
}
const card = {
  background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 12,
  boxShadow: 'var(--shadow-lg)', width: 'min(640px, 100%)', maxHeight: '85vh',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
}
const TD = { padding: '4px 10px', fontSize: 12, borderBottom: '1px solid var(--border)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
const btnSec = { background: 'none', border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--text2)', fontSize: 12, fontWeight: 600, padding: '8px 16px', cursor: 'pointer' }
const btnDanger = { background: 'var(--red)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 700, padding: '8px 18px', cursor: 'pointer' }

const cellText = v => (v == null ? '' : valorLegible(v))
const num = n => Number(n ?? 0).toLocaleString()

export default function DeleteConfirmModal({ open, rows, keyNames = [], onConfirm, onClose, deleting, result }) {
  if (!open) return null

  const keys = (rows || []).map(r => keyNames.map(k => cellText(r[k])).join(' · ') || '—')
  const shown = keys.slice(0, MAX_SHOWN)
  const extra = keys.length - shown.length
  const statusColor = s => s === 'ok' ? 'var(--green)' : s === 'warning' ? 'var(--yellow, #e6a817)' : 'var(--red)'

  return (
    <div style={backdrop} onClick={deleting ? undefined : onClose}>
      <div style={card} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Eliminar registros de SAP IBP</div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
          {result ? (
            <div style={{ fontSize: 13 }}>
              <div style={{ color: statusColor(result.status), fontWeight: 700, marginBottom: 8 }}>
                {result.status === 'ok' && `${num(result.count)} registro(s) eliminado(s) correctamente.`}
                {result.status === 'warning' && `SAP rechazó ${num(result.errors?.length)} registro(s). Revisa los mensajes.`}
                {result.status === 'error' && `No se pudo eliminar: ${result.message || ''}`}
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
            <>
              <div style={{
                background: 'color-mix(in srgb, var(--red) 12%, transparent)', border: '1px solid var(--red)',
                borderRadius: 8, padding: '10px 12px', color: 'var(--red)', fontSize: 12, marginBottom: 14,
              }}>
                ⚠ Esta acción elimina los registros seleccionados en SAP IBP de forma permanente. No se puede deshacer.
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>
                Se eliminarán {num(keys.length)} registro(s) (identificados por su clave):
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <tbody>
                    {shown.map((k, i) => (
                      <tr key={i}><td style={{ ...TD, color: 'var(--text)' }} title={k}>{k}</td></tr>
                    ))}
                  </tbody>
                </table>
                {extra > 0 && <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text3)' }}>+{extra} más</div>}
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center' }}>
          {deleting && <span style={{ fontSize: 12, color: 'var(--text2)', marginRight: 'auto' }}>Eliminando en SAP…</span>}
          {result ? (
            <button type="button" style={btnSec} onClick={onClose}>Cerrar</button>
          ) : (
            <>
              <button type="button" style={btnSec} onClick={onClose} disabled={deleting}>Cancelar</button>
              <button type="button" style={{ ...btnDanger, opacity: deleting ? 0.6 : 1, cursor: deleting ? 'wait' : 'pointer' }} onClick={onConfirm} disabled={deleting}>
                Eliminar definitivamente
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
