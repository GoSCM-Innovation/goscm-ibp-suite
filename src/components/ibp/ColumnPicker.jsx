// Qué columnas se ven, con preselecciones. Portado tal cual de `DataViewer/ColumnPicker.jsx` de v8.
//
// Un botón «▦ Columnas n/total» que abre un panel con tres preselecciones fijas —«Solo claves»,
// «Claves + descripciones» y «Todas»—, las que cada persona guardó con un nombre, un buscador que
// mira el nombre técnico y la descripción, y una casilla por columna.
//
// Las preselecciones propias se guardan por CONEXIÓN en este navegador, como en v8: son una
// preferencia de trabajo de quien mira, no un dato del cliente. Al aplicarlas se quedan solo las
// columnas que existen en la tabla abierta.

import { useEffect, useRef, useState } from 'react'

const PRESET_KEY = connId => `ibp:viewer:presets:master:${connId}`

function loadPresets(connId) {
  try { return JSON.parse(localStorage.getItem(PRESET_KEY(connId))) || {} } catch { return {} }
}
function savePresets(connId, obj) {
  try { localStorage.setItem(PRESET_KEY(connId), JSON.stringify(obj)) } catch { /* sin espacio */ }
}

const btn = {
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text)', fontSize: 12, fontWeight: 600, padding: '7px 12px',
  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
}
const panel = {
  position: 'absolute', top: '100%', left: 0, zIndex: 60, marginTop: 4, width: 320,
  background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8,
  boxShadow: 'var(--shadow-lg)', overflow: 'hidden',
}
const chip = {
  background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 5,
  color: 'var(--text2)', fontSize: 11, fontWeight: 600, padding: '4px 9px', cursor: 'pointer',
}
const linkBtn = {
  background: 'none', border: 'none', color: 'var(--accent)', fontSize: 11,
  fontWeight: 600, padding: 0, cursor: 'pointer',
}
const search = {
  background: 'var(--bg)', border: 'none', borderBottom: '1px solid var(--border)',
  color: 'var(--text)', fontSize: 12, padding: '8px 10px', width: '100%', outline: 'none', boxSizing: 'border-box',
}
const item = sel => ({
  display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
  fontSize: 11, fontFamily: 'var(--mono)', cursor: 'pointer',
  color: sel ? 'var(--accent)' : 'var(--text)',
  background: sel ? 'color-mix(in srgb, var(--accent) 9%, transparent)' : 'transparent',
})

const isDesc = c => /DESCR/i.test(c)

export default function ColumnPicker({ allColumns, keyNames = [], selected, onChange, connId, labels = {} }) {
  const [open, setOpen]       = useState(false)
  const [q, setQ]             = useState('')
  const [presets, setPresets] = useState(() => loadPresets(connId))
  const boxRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const h = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const selSet   = new Set(selected)
  const hasDesc  = allColumns.some(isDesc)
  const keySet   = new Set(keyNames)

  // Las preselecciones conservan el orden de la tabla.
  const applyKeys     = () => onChange(allColumns.filter(c => keySet.has(c)))
  const applyKeysDesc = () => onChange(allColumns.filter(c => keySet.has(c) || isDesc(c)))
  const applyAll      = () => onChange([...allColumns])

  // Se conserva el ORDEN de quien mira: quitar deja las demás donde están y agregar pone al final,
  // así un reordenado a mano no se pierde con cada casilla.
  const toggle = c => {
    if (selSet.has(c)) onChange(selected.filter(x => x !== c))
    else               onChange([...selected, c])
  }

  const saveCurrent = () => {
    const name = window.prompt('Nombre de la preselección de columnas:')
    if (!name || !name.trim()) return
    const next = { ...presets, [name.trim()]: [...selected] }
    setPresets(next); savePresets(connId, next)
  }
  const applyCustom  = name => onChange(allColumns.filter(c => (presets[name] || []).includes(c)))
  const deleteCustom = name => {
    const next = { ...presets }; delete next[name]
    setPresets(next); savePresets(connId, next)
  }

  const ql = q.toLowerCase()
  const filtered = allColumns.filter(c => !q || c.toLowerCase().includes(ql) || String(labels[c] || '').toLowerCase().includes(ql))
  const customNames = Object.keys(presets)

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)} style={btn}>
        ▦ Columnas
        <span style={{ color: 'var(--text3)', fontWeight: 400 }}>
          {selected.length}/{allColumns.length}
        </span>
      </button>
      {open && (
        <div style={panel}>
          <div style={{ padding: 10, borderBottom: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button type="button" style={chip} onClick={applyKeys}>Solo claves</button>
            {hasDesc && <button type="button" style={chip} onClick={applyKeysDesc}>Claves + descripciones</button>}
            <button type="button" style={chip} onClick={applyAll}>Todas</button>
            <span style={{ flex: 1 }} />
            <button type="button" style={linkBtn} onClick={saveCurrent}>Guardar selección…</button>
          </div>

          {customNames.length > 0 && (
            <div style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
                Mis preselecciones
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {customNames.map(name => (
                  <span key={name} style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <button type="button" style={{ ...chip, borderRadius: '5px 0 0 5px' }} onClick={() => applyCustom(name)}>{name}</button>
                    <button
                      type="button"
                      title="Eliminar preselección"
                      onClick={() => deleteCustom(name)}
                      style={{ ...chip, borderLeft: 'none', borderRadius: '0 5px 5px 0', color: 'var(--red)', padding: '4px 7px' }}
                    >×</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar columna…" style={search} />

          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {filtered.map(c => (
              <label key={c} style={item(selSet.has(c))} title={labels[c] && labels[c] !== c ? `${c} — ${labels[c]}` : c}>
                <input type="checkbox" checked={selSet.has(c)} onChange={() => toggle(c)} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c}{labels[c] && labels[c] !== c ? <span style={{ color: 'var(--text3)' }}> — {labels[c]}</span> : null}
                </span>
                {keySet.has(c) && <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--accent)', flexShrink: 0 }}>clave</span>}
              </label>
            ))}
            {filtered.length === 0 && <div style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text3)' }}>—</div>}
          </div>
        </div>
      )}
    </div>
  )
}
