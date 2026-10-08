// Los dos controles de filtro de v8, portados de `Migration/FilterControls.jsx`.
//
//   - SearchSelect: un desplegable con BUSCADOR (Enter elige la primera coincidencia; Escape o un clic
//     fuera lo cierran). Desde el 2026-10-06, con más de 12 opciones se elige en la ventana con
//     buscador (`ui/VentanaDeSeleccion.jsx`) en vez de en este desplegable: ver `lib/lista-extensa.js`.
//   - MultiValueSelect: los valores elegidos como fichas, un campo para escribir más, y un botón ▾ que
//     abre la ventana con los valores REALES del origen, que se piden la primera vez que se abre.
//     Pegar una lista (una columna de Excel, o separada por tabulador, punto y coma o coma) la
//     convierte en fichas de una vez: es la forma de filtrar por treinta materiales sin escribirlos.
//
// Los usan los dos visores de datos y las dos migraciones: en v8 eran los mismos, y aquí también.

import { useEffect, useRef, useState } from 'react'

import { partirValores, valorLegible } from '../../../core/ibp/master-data-model.js'
import { esListaExtensa } from '../../lib/lista-extensa.js'
import VentanaDeSeleccion from '../ui/VentanaDeSeleccion.jsx'

export function SearchSelect({ value, options, onChange, placeholder, searchPlaceholder, invalid, style, btnStyle, mono = true, titulo }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const boxRef = useRef(null)
  // El criterio único (`lib/lista-extensa.js`): una lista extensa se elige en la ventana con buscador;
  // una corta conserva este desplegable.
  const extensa = esListaExtensa(options.length)
  useEffect(() => {
    if (!open || extensa) return undefined
    const h = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open, extensa])
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
      {open && extensa && (
        <VentanaDeSeleccion
          modo="unica"
          titulo={titulo || placeholder || 'Elegir de la lista'}
          opciones={options.map(o => o.value)}
          nombres={Object.fromEntries(options.map(o => [o.value, o.label || String(o.value)]))}
          valor={value}
          onElegir={pick}
          onCerrar={() => setOpen(false)}
        />
      )}
      {open && !extensa && (
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
export function MultiValueSelect({ value, onChange, loadValues, placeholder, disabled, titulo, campo }) {
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(false)
  const [all, setAll]         = useState(null)   // null = todavía no se pidió
  const [typed, setTyped]     = useState('')     // lo que se está escribiendo (entra con Enter o coma)

  // Los valores reales se piden la primera vez que se abre la ventana. Se abre SIEMPRE la ventana,
  // aunque al final haya pocos valores: cuántos son no se sabe hasta leerlos, y un control que saltara
  // de lista a ventana al terminar de cargar sería peor que uno predecible.
  const openDropdown = () => {
    setOpen(true)
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
  const removeToken = tok => onChange(selectedArr.filter(t => t !== tok).join(','))
  const commitTyped = () => {
    const toks = partirValores(typed)
    setTyped('')
    if (!toks.length) return
    const merged = [...selectedArr]
    for (const tk of toks) if (!merged.includes(tk)) merged.push(tk)
    onChange(merged.join(','))
  }
  // El texto legible de cada valor. La ventana busca en el valor crudo y en este: «28/7» encuentra una
  // fecha guardada como /Date(...)/.
  // `campo` es la columna filtrada: si es un periodo, se lee como IBP lo guarda (UTC).
  const nombres = Object.fromEntries((all || []).map(v => [v, valorLegible(v, campo)]))

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
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
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{valorLegible(tok, campo)}</span>
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
        <VentanaDeSeleccion
          titulo={titulo || 'Valores del origen'}
          opciones={all || []}
          nombres={nombres}
          // Lo que se escribió a mano y no está en la lista se conserva: la selección temporal parte de
          // TODO lo elegido, no solo de lo que la lista conoce.
          seleccion={selectedArr}
          sufijoDeConteo="valor(es) seleccionado(s)"
          cargando={loading}
          mensajeDeCarga="Cargando valores reales…"
          error={!loading && error ? 'No se pudieron cargar los valores. Escríbelos o pégalos en el campo.' : ''}
          textoVacio="Sin valores disponibles. Escríbelos o pégalos en el campo."
          // Los valores se leen con un tope de 5.000 filas: un maestro más grande da una lista
          // RECORTADA. Se dice, en vez de dejar que pase por completa.
          aviso={!loading && !error && all != null && all.length >= 5000
            ? 'Lista posiblemente incompleta (tope de 5.000 registros del maestro): escribe o pega los valores que falten.'
            : ''}
          onGuardar={sel => { onChange(sel.join(',')); setOpen(false) }}
          onCerrar={() => setOpen(false)}
        />
      )}
    </div>
  )
}
