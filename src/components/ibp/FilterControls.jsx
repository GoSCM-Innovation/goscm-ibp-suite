// Los dos controles de filtro de v8, portados tal cual de `Migration/FilterControls.jsx`.
//
//   - SearchSelect: un desplegable con BUSCADOR, para listas largas (tablas, campos, key figures,
//     unidades) donde un <select> nativo no se deja recorrer. Enter elige la primera coincidencia;
//     Escape o un clic fuera lo cierran.
//   - MultiValueSelect: los valores elegidos como fichas, un campo para escribir más, y un
//     desplegable con los valores REALES del origen que se pide la primera vez que se abre. Pegar
//     una lista (una columna de Excel, o separada por tabulador, punto y coma o coma) la convierte
//     en fichas de una vez: es la forma de filtrar por treinta materiales sin escribirlos.
//
// Los usan los dos visores de datos y las dos migraciones: en v8 eran los mismos, y aquí también.

import { useEffect, useRef, useState } from 'react'

import { partirValores, valorLegible } from '../../../core/ibp/master-data-model.js'

export function SearchSelect({ value, options, onChange, placeholder, searchPlaceholder, invalid, style, btnStyle, mono = true }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const boxRef = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const h = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  const sel = options.find(o => o.value === value)
  const ql = q.toLowerCase()
  const filtered = !q ? options : options.filter(o =>
    String(o.value).toLowerCase().includes(ql) || String(o.label || '').toLowerCase().includes(ql))
  const pick = v => { onChange(v); setOpen(false); setQ('') }
  return (
    <div ref={boxRef} style={{ position: 'relative', ...style }}>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setQ('') }}
        style={{
          background: 'var(--bg)', border: `1px solid ${invalid ? 'var(--red)' : 'var(--border)'}`, borderRadius: 6,
          color: sel ? 'var(--text)' : 'var(--text3)', fontSize: 12, padding: '7px 10px', width: '100%',
          textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
          fontFamily: mono ? 'var(--mono)' : 'inherit', ...btnStyle,
        }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sel ? sel.label : (placeholder || '—')}
        </span>
        <span style={{ color: 'var(--text3)', fontSize: 9, flexShrink: 0 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 60, marginTop: 3,
          background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8,
          boxShadow: 'var(--shadow-lg)', overflow: 'hidden',
        }}>
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') setOpen(false)
              if (e.key === 'Enter' && filtered.length > 0) pick(filtered[0].value)
            }}
            placeholder={searchPlaceholder || '…'}
            style={{
              background: 'var(--bg)', border: 'none', borderBottom: '1px solid var(--border)',
              color: 'var(--text)', fontSize: 12, padding: '8px 10px', width: '100%', outline: 'none', boxSizing: 'border-box',
            }}
          />
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {filtered.length === 0 && <div style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text3)' }}>—</div>}
            {filtered.map(o => (
              <div
                key={o.value}
                onClick={() => pick(o.value)}
                style={{
                  padding: '6px 10px', fontSize: 11, cursor: 'pointer',
                  fontFamily: mono ? 'var(--mono)' : 'inherit',
                  color: o.value === value ? 'var(--accent)' : 'var(--text)',
                  background: o.value === value ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 16%, transparent)' }}
                onMouseLeave={e => { e.currentTarget.style.background = o.value === value ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent' }}
              >
                {o.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * `value` es la lista separada por comas, tal cual se guarda. Las fichas enseñan el valor LEGIBLE
 * (una fecha de OData se ve como fecha), pero lo guardado sigue siendo el valor crudo.
 */
export function MultiValueSelect({ value, onChange, loadValues, placeholder, disabled }) {
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(false)
  const [all, setAll]         = useState(null)   // null = todavía no se pidió
  const [q, setQ]             = useState('')
  const [typed, setTyped]     = useState('')     // lo que se está escribiendo (entra con Enter o coma)
  const boxRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const h = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const openDropdown = () => {
    setOpen(o => !o)
    if (all == null && !loading) {
      setLoading(true); setError(false)
      Promise.resolve()
        .then(() => loadValues())
        .then(vals => setAll(vals || []))
        .catch(() => { setError(true); setAll([]) })
        .finally(() => setLoading(false))
    }
  }

  const selectedArr = partirValores(value)
  const selected = new Set(selectedArr)
  const toggle = v => {
    const next = new Set(selected)
    if (next.has(v)) next.delete(v); else next.add(v)
    onChange([...next].join(','))
  }
  const removeToken = tok => onChange(selectedArr.filter(t => t !== tok).join(','))
  const commitTyped = () => {
    const toks = partirValores(typed)
    setTyped('')
    if (!toks.length) return
    const merged = [...selectedArr]
    for (const tk of toks) if (!merged.includes(tk)) merged.push(tk)
    onChange(merged.join(','))
  }
  const ql = q.toLowerCase()
  // Se busca en el valor crudo y en el legible: «28/7» encuentra una fecha guardada como /Date(...)/.
  const filtered = (all || []).filter(v =>
    !q || v.toLowerCase().includes(ql) || valorLegible(v).toLowerCase().includes(ql))

  return (
    <div ref={boxRef} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
        <div
          style={{
            background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
            flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center',
            gap: 4, padding: '3px 6px', opacity: disabled ? 0.6 : 1,
          }}
        >
          {selectedArr.map(tok => (
            <span
              key={tok}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%',
                background: 'color-mix(in srgb, var(--accent) 16%, transparent)', color: 'var(--text)',
                borderRadius: 4, padding: '2px 4px 2px 6px', fontSize: 11, fontFamily: 'var(--mono)',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{valorLegible(tok)}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeToken(tok)}
                  title="Quitar condición"
                  style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0, flexShrink: 0 }}
                >×</button>
              )}
            </span>
          ))}
          <input
            value={typed}
            disabled={disabled}
            onChange={e => setTyped(e.target.value)}
            onBlur={commitTyped}
            onPaste={e => {
              // Pegar una lista la convierte en fichas de una vez. Un solo valor se pega normal.
              const text = e.clipboardData?.getData('text') ?? ''
              if (!/[\r\n\t;,]/.test(text)) return
              e.preventDefault()
              const toks = text.split(/[\r\n\t;,]+/).map(s => s.trim().replace(/^["']+|["']+$/g, '')).filter(Boolean)
              if (toks.length === 0) return
              const merged = [...selectedArr]
              for (const tk of toks) if (!merged.includes(tk)) merged.push(tk)
              onChange(merged.join(','))
              setTyped('')
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commitTyped() }
              else if (e.key === 'Backspace' && !typed && selectedArr.length) { e.preventDefault(); removeToken(selectedArr[selectedArr.length - 1]) }
            }}
            placeholder={selectedArr.length ? '' : placeholder}
            style={{
              background: 'none', border: 'none', color: 'var(--text)', fontSize: 11,
              padding: '1px 2px', flex: 1, minWidth: 60, outline: 'none', fontFamily: 'var(--mono)',
            }}
          />
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={openDropdown}
          title="Ver valores del origen"
          style={{
            background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
            color: 'var(--text2)', fontSize: 10, padding: '4px 7px', cursor: 'pointer', flexShrink: 0,
          }}
        >▾</button>
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 60, marginTop: 3,
          background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8,
          boxShadow: 'var(--shadow-lg)', overflow: 'hidden',
        }}>
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
            placeholder="Buscar valor…"
            style={{
              background: 'var(--bg)', border: 'none', borderBottom: '1px solid var(--border)',
              color: 'var(--text)', fontSize: 11, padding: '7px 10px', width: '100%',
              outline: 'none', boxSizing: 'border-box',
            }}
          />
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {loading && <div style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text3)' }}>Cargando valores reales…</div>}
            {!loading && error && <div style={{ padding: '8px 10px', fontSize: 11, color: 'var(--yellow, #e6a817)' }}>No se pudieron cargar los valores — escribe manualmente</div>}
            {!loading && !error && all != null && all.length === 0 && (
              <div style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text3)' }}>Sin valores disponibles — escribe manualmente</div>
            )}
            {/* Los valores se leen con un tope de 5.000 filas: un maestro más grande da una lista
                RECORTADA. Se dice, en vez de dejar que pase por completa. */}
            {!loading && !error && all != null && all.length >= 5000 && (
              <div style={{ padding: '6px 10px', fontSize: 10, color: 'var(--yellow, #e6a817)', borderBottom: '1px solid var(--border)' }}>
                ⚠ Lista posiblemente incompleta (tope de 5.000 registros del maestro): escribe o pega los valores que falten.
              </div>
            )}
            {!loading && filtered.map(v => (
              <label
                key={v}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7, padding: '4px 10px',
                  fontSize: 11, fontFamily: 'var(--mono)', cursor: 'pointer',
                  color: selected.has(v) ? 'var(--accent)' : 'var(--text)',
                  background: selected.has(v) ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
                }}
              >
                <input type="checkbox" checked={selected.has(v)} onChange={() => toggle(v)} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{valorLegible(v)}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
