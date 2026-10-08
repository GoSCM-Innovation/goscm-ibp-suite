// La tabla paginada de los visores de datos. Portada tal cual de `DataViewer/DataGrid.jsx` de v8.
//
// Es solo presentación: dibuja las filas y columnas que recibe y le pasa a quien la usa el orden,
// la página, el tamaño de página y las ediciones. Quien la usa lee de SAP una página por vez, así
// que esta tabla nunca tiene más de `pageSize` filas.
//
// Lo que trae, igual que en v8:
//
//   - Barra de arriba: las notas, «🗑 Eliminar (n)», «Guardar (n)» y «Descartar», «✎ Editar»,
//     «⬇ Exportar CSV» (con su avance y «Cancelar») y «⛶ Pantalla completa».
//   - Cabecera: clic ordena, arrastrar la cabecera reordena, arrastrar su borde fija el ancho y
//     doble clic lo ajusta al contenido. Debajo de cada nombre, un filtro que actúa SOLO sobre las
//     filas de esta página y por prefijo — el filtro que consulta a SAP es el de arriba.
//   - Edición: en modo edición, un clic en una celda editable la convierte en un campo. Los cambios
//     viven en quien usa la tabla, para que sobrevivan a pasar de página.
//   - Casillas por fila para borrar, y el «marcar todas las de esta página».
//   - Paginación: «N registros en total», anterior/siguiente, «Ir a» y «Filas por página».

import { useRef, useState } from 'react'

import { valorLegible } from '../../../core/ibp/master-data-model.js'
import { anchoAjustado, anchoArrastrado, estiloDeAncho } from '../../lib/ancho-de-columna.js'

const THCELL = {
  textAlign: 'left', padding: '6px 10px 5px', borderBottom: '1px solid var(--border)',
  background: 'var(--bg2)', position: 'sticky', top: 0, zIndex: 1, verticalAlign: 'top',
}
const THNAME = {
  color: 'var(--text2)', fontWeight: 700, fontSize: 10, textTransform: 'uppercase',
  letterSpacing: '.05em', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none',
  display: 'flex', alignItems: 'center', gap: 4,
}
const COLFILTER = {
  marginTop: 5, width: '100%', boxSizing: 'border-box',
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5,
  color: 'var(--text)', fontSize: 11, padding: '3px 6px', outline: 'none',
  fontFamily: 'var(--mono)', fontWeight: 400, textTransform: 'none', letterSpacing: 0,
}
const TD = {
  padding: '5px 10px', borderBottom: '1px solid var(--border)', fontSize: 12,
  whiteSpace: 'nowrap', color: 'var(--text)',
  overflow: 'hidden', textOverflow: 'ellipsis',
}
const navBtn = disabled => ({
  background: 'none', border: '1px solid var(--border2)', borderRadius: 6,
  color: disabled ? 'var(--text3)' : 'var(--text2)', fontSize: 11, fontWeight: 600,
  padding: '5px 11px', cursor: disabled ? 'not-allowed' : 'pointer',
})
const inputSm = {
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text)', fontSize: 11, padding: '4px 7px', outline: 'none',
}
const topBtn = {
  background: 'none', border: '1px solid var(--border2)', borderRadius: 6,
  color: 'var(--text2)', fontSize: 11, fontWeight: 600, padding: '4px 10px', cursor: 'pointer',
}
const primaryBtn = {
  background: 'var(--accent)', border: 'none', borderRadius: 6,
  color: 'var(--text-on-accent)', fontSize: 11, fontWeight: 700, padding: '4px 12px', cursor: 'pointer',
}
const dangerBtn = {
  background: 'none', border: '1px solid var(--red)', borderRadius: 6,
  color: 'var(--red)', fontSize: 11, fontWeight: 700, padding: '4px 12px', cursor: 'pointer',
}
const SELCELL = { padding: '0 6px', borderBottom: '1px solid var(--border)', textAlign: 'center', width: 34, minWidth: 34 }
const DIRTY_BG = 'color-mix(in srgb, var(--accent) 16%, transparent)'

const EDIT_HINT = 'Modo edición: clic en una celda para editarla. Claves y campos de solo lectura están bloqueados.'

// `c` es la columna: un periodo de IBP se enseña como IBP lo guarda (UTC), no en la zona del navegador.
const cellText = (v, c) => (v == null ? '' : valorLegible(v, c))
const num = n => Number(n ?? 0).toLocaleString()

export default function DataGrid({
  columns, rows, keyNames = [], loading, error,
  sort, onSort, onReorder,
  page, pageCount, pageSize, total, pageSizeOptions = [50, 100, 200, 500],
  onPageChange, onPageSizeChange,
  // Edición (opcional: sin esto la tabla es de solo lectura).
  editMode = false, editableCols = [], edits = {}, editCount = 0, editHint,
  onToggleEdit, onCellEdit, onSaveEdits, onDiscardEdits,
  // Casillas para borrar (opcional: sin `onToggleRow` no hay casillas).
  selectedKeys = {}, selCount = 0, onToggleRow, onToggleAllPage, onDeleteSelected,
  // La pantalla completa la lleva el envoltorio de pestañas. Sin `onToggleFullscreen` no hay botón.
  fullscreen = false, onToggleFullscreen,
  // Exportar (opcional). La lectura de todas las páginas la hace quien usa la tabla.
  onExport, exporting = false, exportProgress = null, onCancelExport,
}) {
  const keySet = new Set(keyNames)
  const editableSet = new Set(editableCols)
  const editHintText = editHint || EDIT_HINT
  const [gotoVal, setGotoVal] = useState('')
  const [colFilters, setColFilters] = useState({})   // { [columna]: texto } — por prefijo, solo esta página
  const [colWidths, setColWidths] = useState({})     // { [columna]: px } — sin entrada, se ajusta sola
  const [dragOverCol, setDragOverCol] = useState(null)
  const [editing, setEditing] = useState(null)       // { rk, field } de la celda que se está escribiendo
  const [draft, setDraft] = useState('')

  const tableRef   = useRef(null)
  const measureRef = useRef(null)   // el lienzo con que se mide el texto, reutilizado
  const dragColRef = useRef(null)   // la columna que se está arrastrando

  const sortIndicator = c => (!sort || sort.field !== c) ? '' : (sort.dir === 'desc' ? ' ▼' : ' ▲')

  // Arrastrar el borde derecho de una cabecera. Se escucha en la ventana: el ratón se sale del
  // borde en cuanto se mueve rápido.
  const startResize = (e, c) => {
    e.preventDefault(); e.stopPropagation()
    const th = e.target.closest('th')
    const startW = th ? th.offsetWidth : (colWidths[c] || 120)
    const startX = e.clientX
    const onMove = ev => setColWidths(p => ({ ...p, [c]: anchoArrastrado(startW, ev.clientX - startX) }))
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  // Doble clic en el borde: el ancho de lo más ancho entre la cabecera y las celdas a la vista.
  const autoFit = (e, c) => {
    e.preventDefault(); e.stopPropagation()
    const canvas = measureRef.current || (measureRef.current = document.createElement('canvas'))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const sample = tableRef.current?.querySelector('tbody td') || tableRef.current?.querySelector('th')
    const font = sample ? getComputedStyle(sample).font : ''
    ctx.font = font && font.trim() ? font : '12px monospace'
    const width = anchoAjustado(c, visibleRows.map(r => cellText(r[c], c)), t => ctx.measureText(t).width, { esClave: keySet.has(c) })
    setColWidths(p => ({ ...p, [c]: width }))
  }

  // Soltar una cabecera sobre otra: `from` queda delante de `to`.
  const reorderTo = to => {
    const from = dragColRef.current
    if (!from || from === to || !onReorder) return
    const next = columns.slice()
    next.splice(next.indexOf(from), 1)
    next.splice(next.indexOf(to), 0, from)
    onReorder(next)
  }

  // Solo cuentan los filtros de columnas que se están viendo.
  const colSet = new Set(columns)
  const active = Object.entries(colFilters).filter(([c, v]) => v && v.trim() && colSet.has(c))
  const visibleRows = active.length === 0 ? rows : rows.filter(r =>
    active.every(([c, v]) => cellText(r[c], c).toLowerCase().startsWith(v.trim().toLowerCase())))

  const rowKeyOf = r => keyNames.map(k => String(r[k] ?? '')).join('')
  const beginEdit = (rk, field, current) => { setEditing({ rk, field }); setDraft(current == null ? '' : String(current)) }
  const commitEdit = (rk, field, row) => { onCellEdit?.(rk, field, draft, row); setEditing(null) }

  const selectable  = !!onToggleRow
  const allChecked  = selectable && visibleRows.length > 0 && visibleRows.every(r => selectedKeys[rowKeyOf(r)])
  const someChecked = selectable && visibleRows.some(r => selectedKeys[rowKeyOf(r)])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Barra de arriba: notas + edición + exportar + pantalla completa */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 2px 6px', flexShrink: 0, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>ⓘ El filtro por columna actúa solo sobre los registros de esta página (empieza con).</span>
        {!editMode && <span style={{ fontSize: 11, color: 'var(--text3)' }}>ⓘ Arrastra cabeceras para reordenar; arrastra su borde para ajustar el ancho (doble clic = autoajuste).</span>}
        {editMode && <span style={{ fontSize: 11, color: 'var(--accent)' }}>✎ {editHintText}</span>}
        {active.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--accent)' }}>
            Mostrando {num(visibleRows.length)} de {num(rows.length)} de esta página
          </span>
        )}
        <span style={{ flex: 1 }} />
        {selCount > 0 && (
          <button type="button" style={dangerBtn} onClick={() => onDeleteSelected?.()}>🗑 Eliminar ({selCount})</button>
        )}
        {editMode && editCount > 0 && (
          <>
            <button type="button" style={primaryBtn} onClick={() => onSaveEdits?.()}>Guardar ({editCount})</button>
            <button type="button" style={topBtn} onClick={() => onDiscardEdits?.()}>Descartar</button>
          </>
        )}
        {onToggleEdit && (
          <button
            type="button"
            style={{ ...topBtn, ...(editMode ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}) }}
            onClick={() => { setEditing(null); onToggleEdit() }}
            title={editHintText}
          >
            ✎ {editMode ? 'Editando' : 'Editar'}
          </button>
        )}
        {onExport && (
          exporting ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                ⏳ Exportando… {num(exportProgress?.loaded)} / {num(exportProgress?.total)}
              </span>
              <button type="button" style={dangerBtn} onClick={() => onCancelExport?.()}>Cancelar</button>
            </span>
          ) : (
            <button type="button" style={topBtn} onClick={() => onExport()} title="Descargar como CSV todas las filas del filtro actual (todas las páginas)">
              ⬇ Exportar CSV
            </button>
          )
        )}
        {onToggleFullscreen && (
          <button
            type="button"
            style={topBtn}
            onClick={onToggleFullscreen}
            title={fullscreen ? 'Salir de pantalla completa (Esc)' : 'Maximizar la tabla a pantalla completa'}
          >
            {fullscreen ? '⤡ Salir' : '⛶ Pantalla completa'}
          </button>
        )}
      </div>

      <div style={{
        flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8,
        position: 'relative', background: 'var(--bg)',
      }}>
        {error && <div style={{ padding: 16, color: 'var(--red)', fontSize: 12 }}>{error}</div>}

        {!error && columns.length > 0 && (
          <table ref={tableRef} style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'auto', fontFamily: 'var(--mono)' }}>
            <thead>
              <tr>
                {selectable && (
                  <th style={{ ...THCELL, width: 34, minWidth: 34, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={el => { if (el) el.indeterminate = someChecked && !allChecked }}
                      onChange={e => onToggleAllPage?.(visibleRows.map(r => ({ rk: rowKeyOf(r), row: r })), e.target.checked)}
                      title="Seleccionar / quitar todas las de esta página"
                    />
                  </th>
                )}
                {columns.map(c => (
                  <th
                    key={c}
                    style={{ ...THCELL, ...estiloDeAncho(colWidths[c]), boxShadow: dragOverCol === c ? 'inset 2px 0 0 0 var(--accent)' : undefined }}
                    onDragOver={e => { if (onReorder && dragColRef.current && dragColRef.current !== c) { e.preventDefault(); setDragOverCol(c) } }}
                    onDragLeave={() => setDragOverCol(o => (o === c ? null : o))}
                    onDrop={e => { e.preventDefault(); reorderTo(c); setDragOverCol(null) }}
                  >
                    <div
                      style={{ ...THNAME, cursor: onReorder ? 'grab' : 'pointer' }}
                      onClick={() => onSort?.(c)}
                      title={onReorder ? `${c} · clic: ordenar · arrastra la cabecera: reordenar` : c}
                      draggable={!!onReorder}
                      onDragStart={e => { dragColRef.current = c; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', c) } catch { /* navegador viejo */ } }}
                      onDragEnd={() => { dragColRef.current = null; setDragOverCol(null) }}
                    >
                      {keySet.has(c) && <span style={{ color: 'var(--accent)', flex: '0 0 auto' }}>🔑</span>}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                        {c}{sortIndicator(c)}
                      </span>
                    </div>
                    <input
                      value={colFilters[c] || ''}
                      onChange={e => setColFilters(p => ({ ...p, [c]: e.target.value }))}
                      onClick={e => e.stopPropagation()}
                      placeholder="filtrar…"
                      style={COLFILTER}
                    />
                    {/* El tirador del borde: arrastrar fija el ancho, doble clic lo ajusta. */}
                    <div
                      onMouseDown={e => startResize(e, c)}
                      onDoubleClick={e => autoFit(e, c)}
                      onClick={e => e.stopPropagation()}
                      title="Arrastra para ajustar el ancho · doble clic para autoajustar al contenido"
                      style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 7, cursor: 'col-resize', userSelect: 'none', borderRight: '1px solid var(--border)' }}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(r => {
                const rk = rowKeyOf(r)
                const changes = edits[rk]?.changes
                return (
                  <tr key={rk}>
                    {selectable && (
                      <td style={SELCELL}>
                        <input type="checkbox" checked={!!selectedKeys[rk]} onChange={() => onToggleRow?.(rk, r)} />
                      </td>
                    )}
                    {columns.map(c => {
                      const isDirty = changes && Object.prototype.hasOwnProperty.call(changes, c)
                      const rawVal  = isDirty ? changes[c] : r[c]
                      const txt     = cellText(rawVal, c)
                      const canEdit = editMode && editableSet.has(c)
                      const isEditing = editMode && editing && editing.rk === rk && editing.field === c
                      if (isEditing) {
                        return (
                          <td key={c} style={{ ...TD, ...estiloDeAncho(colWidths[c]), padding: '2px 4px' }}>
                            <input
                              autoFocus
                              value={draft}
                              onChange={e => setDraft(e.target.value)}
                              onBlur={() => commitEdit(rk, c, r)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') commitEdit(rk, c, r)
                                else if (e.key === 'Escape') setEditing(null)
                              }}
                              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--text)', fontSize: 12, fontFamily: 'var(--mono)', padding: '3px 5px', outline: 'none' }}
                            />
                          </td>
                        )
                      }
                      return (
                        <td
                          key={c}
                          style={{ ...TD, ...estiloDeAncho(colWidths[c]), cursor: canEdit ? 'pointer' : 'default', background: isDirty ? DIRTY_BG : undefined }}
                          title={canEdit ? 'Clic para editar' : txt}
                          onClick={canEdit ? () => beginEdit(rk, c, rawVal) : undefined}
                        >
                          {txt}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {!error && !loading && rows.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
            Sin filas para mostrar.
          </div>
        )}
        {!error && !loading && rows.length > 0 && visibleRows.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
            Ninguna fila de esta página coincide con el filtro de columna.
          </div>
        )}

        {loading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'color-mix(in srgb, var(--bg) 55%, transparent)', fontSize: 12, color: 'var(--text2)',
          }}>
            Cargando…
          </div>
        )}
      </div>

      {/* Paginación */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 2px', flexShrink: 0, flexWrap: 'wrap' }}>
        {total != null && (
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
            {num(total)} registros en total
          </span>
        )}
        <button type="button" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)} style={navBtn(loading || page <= 1)}>
          ‹ Anterior
        </button>
        <span style={{ fontSize: 11, color: 'var(--text2)' }}>Página {page} de {pageCount}</span>
        <button type="button" disabled={loading || page >= pageCount} onClick={() => onPageChange(page + 1)} style={navBtn(loading || page >= pageCount)}>
          Siguiente ›
        </button>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>Ir a</span>
          <input
            value={gotoVal}
            onChange={e => setGotoVal(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={e => {
              if (e.key === 'Enter' && gotoVal) {
                const p = Math.min(pageCount, Math.max(1, parseInt(gotoVal, 10)))
                onPageChange(p); setGotoVal('')
              }
            }}
            placeholder="#"
            style={{ width: 52, ...inputSm }}
          />
        </span>
        <span style={{ flex: 1 }} />
        <label style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 6 }}>
          Filas por página
          {/* select-fijo: lista cerrada y corta, no crece con los datos */}
          <select value={pageSize} onChange={e => onPageSizeChange(parseInt(e.target.value, 10))} style={inputSm}>
            {pageSizeOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      </div>
    </div>
  )
}
