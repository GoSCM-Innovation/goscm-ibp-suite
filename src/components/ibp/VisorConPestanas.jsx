// El envoltorio de pestañas de los visores de datos (Ver Dato Maestro / Ver Dato Transaccional).
//
// Portado tal cual de `DataViewer/ViewerTabs.jsx` de v8: la misma tira, las mismas etiquetas de dos
// líneas, el mismo color por área, «⧉» para duplicar y «×» para cerrar en la pestaña, y el «+»
// punteado al final.
//
// El envoltorio lleva la lista de pestañas, cuál está activa y cuáles están MONTADAS; el visor de
// dentro (`renderTab`) lleva su propia selección y sus datos. Cuatro decisiones de v8 que lo hacen
// sostenible:
//
//   - MONTAJE PEREZOSO. Una pestaña restaurada no monta su visor hasta que se abre: restaurar ocho
//     pestañas no dispara ocho lecturas de esquema.
//   - UNA VEZ MONTADA, SE QUEDA. Cambiar de pestaña y volver no vuelve a leer nada.
//   - SOLO LA ACTIVA DIBUJA SU TABLA. El visor de una pestaña de atrás devuelve `null`: guarda su
//     página en memoria y no pone ni una fila en el DOM.
//   - SE GUARDA LA DEFINICIÓN, NO LOS DATOS. Los datos se piden al pulsar «Mostrar datos», nunca al
//     restaurar: el tráfico contra SAP es el mismo que con un visor solo.
//
// La pantalla completa la lleva el envoltorio, como en v8, para que la tira de pestañas siga arriba
// y se pueda saltar de tabla con la tabla maximizada. Escape sale.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'

import { useIsMobile } from '../../lib/useIsMobile.js'
import {
  areaColor, loadTabs, saveTabs, sortTabs, tabLabel, tabLabelParts, TAB_LIMIT,
} from '../../lib/pestanas-de-visor.js'

const newId = () => (globalThis.crypto?.randomUUID?.() || `t${Date.now()}_${Math.round(Math.random() * 1e9)}`)

function metaEqual(a, b) {
  const x = a || {}, y = b || {}
  return x.areaId === y.areaId && x.versionId === y.versionId && x.leafLabel === y.leafLabel && !!x.dirty === !!y.dirty
}

export default function VisorConPestanas({ connectionId, kind, renderTab }) {
  const isMobile = useIsMobile()
  const connId = connectionId

  // ── Pestañas y la activa (las guardadas, o una vacía) ──
  const [state, setState] = useState(() => {
    const saved = loadTabs(kind, connId)
    if (saved) {
      const activeId = saved.tabs.some(x => x.id === saved.activeId) ? saved.activeId : saved.tabs[0].id
      return { tabs: saved.tabs, activeId }
    }
    const id = newId()
    return { tabs: [{ id, def: null, meta: null }], activeId: id }
  })
  const { tabs, activeId } = state

  // Qué pestañas tienen su visor montado. Al restaurar, solo la activa.
  const [mounted, setMounted] = useState(() => ({ [state.activeId]: true }))

  useEffect(() => { saveTabs(kind, connId, { activeId, tabs }) }, [kind, connId, activeId, tabs])

  // ── Pantalla completa: la lleva el envoltorio para que la tira quede arriba y se pueda usar. ──
  const [fullscreen, setFullscreen] = useState(false)
  const toggleFullscreen = useCallback(() => setFullscreen(v => !v), [])
  useEffect(() => {
    if (!fullscreen) return undefined
    const onKey = e => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [fullscreen])

  const selectTab = useCallback(id => {
    setMounted(m => (m[id] ? m : { ...m, [id]: true }))
    setState(s => (s.activeId === id ? s : { ...s, activeId: id }))
  }, [])

  const addTab = useCallback(() => {
    setState(s => {
      if (s.tabs.length >= TAB_LIMIT) return s
      const id = newId()
      setMounted(m => ({ ...m, [id]: true }))
      return { tabs: [...s.tabs, { id, def: null, meta: null }], activeId: id }
    })
  }, [])

  // Duplicar: copia la definición entera —selección, filtros, columnas, nivel— en una pestaña
  // idéntica pero independiente. Se clona a fondo para que tocar una no toque la otra. Los datos NO
  // se copian: la copia arranca configurada y se pulsa «Mostrar datos».
  const duplicateTab = useCallback(id => {
    setState(s => {
      if (s.tabs.length >= TAB_LIMIT) return s
      const src = s.tabs.find(x => x.id === id)
      if (!src) return s
      const nid = newId()
      const def  = src.def ? JSON.parse(JSON.stringify(src.def)) : null
      const meta = src.meta ? { ...src.meta, dirty: false } : null
      setMounted(m => ({ ...m, [nid]: true }))
      return { tabs: [...s.tabs, { id: nid, def, meta }], activeId: nid }
    })
  }, [])

  const closeTab = useCallback(id => {
    // Solo una pestaña montada puede tener cambios en memoria; el `dirty` de una restaurada que no
    // se abrió es viejo, y no se pregunta por él.
    const tab = tabs.find(x => x.id === id)
    if (mounted[id] && tab?.meta?.dirty && !window.confirm('Esta pestaña tiene cambios sin guardar. ¿Cerrarla de todos modos?')) return
    setState(s => {
      const remaining = s.tabs.filter(x => x.id !== id)
      // Cerrar la última deja una vacía.
      if (!remaining.length) {
        const nid = newId()
        setMounted({ [nid]: true })
        return { tabs: [{ id: nid, def: null, meta: null }], activeId: nid }
      }
      let nextActive = s.activeId
      if (nextActive === id) {
        // Se pasa a la vecina en el orden que SE VE.
        const sorted = sortTabs(s.tabs)
        const si = sorted.findIndex(x => x.id === id)
        const neighbour = sorted[si + 1] || sorted[si - 1]
        nextActive = neighbour ? neighbour.id : remaining[0].id
        setMounted(m => (m[nextActive] ? m : { ...m, [nextActive]: true }))
      }
      return { tabs: remaining, activeId: nextActive }
    })
  }, [tabs, mounted])

  // El visor de dentro dice qué está mirando: con eso la pestaña se nombra y se guarda.
  const updateTab = useCallback((id, def, meta) => {
    setState(s => {
      const i = s.tabs.findIndex(x => x.id === id)
      if (i < 0) return s
      const cur = s.tabs[i]
      if (metaEqual(cur.meta, meta) && JSON.stringify(cur.def) === JSON.stringify(def)) return s
      const next = s.tabs.slice()
      next[i] = { ...cur, def, meta }
      return { ...s, tabs: next }
    })
  }, [])

  const sorted = useMemo(() => sortTabs(tabs), [tabs])
  const atLimit = tabs.length >= TAB_LIMIT

  // ── Estilos de v8 ──
  const strip = {
    display: 'flex', alignItems: 'stretch', gap: 0, flexShrink: 0,
    background: 'var(--bg)', borderBottom: '1px solid var(--border)',
    padding: isMobile ? '4px 8px' : '4px 12px', overflowX: 'auto', whiteSpace: 'nowrap',
  }
  function tabStyle(active, color) {
    return {
      display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, maxWidth: 230,
      padding: isMobile ? '6px 8px 6px 9px' : '6px 9px 6px 10px', margin: '4px 3px',
      borderRadius: 7, borderStyle: 'solid',
      borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderLeftWidth: 3,
      borderTopColor: active ? 'var(--border)' : 'transparent',
      borderRightColor: active ? 'var(--border)' : 'transparent',
      borderBottomColor: active ? 'var(--border)' : 'transparent',
      borderLeftColor: color,
      background: active ? 'var(--bg2)' : 'transparent',
      color: active ? 'var(--text)' : 'var(--text2)',
      fontSize: 12, fontWeight: active ? 600 : 400, cursor: 'pointer',
      transition: 'background .12s', userSelect: 'none',
    }
  }
  const closeBtn = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 16, height: 16, borderRadius: 4, border: 'none', background: 'none',
    color: 'var(--text3)', fontSize: 14, lineHeight: 1, cursor: 'pointer', flexShrink: 0,
  }
  // Duplicar solo aparece en la pestaña activa: las demás quedan limpias.
  const dupBtn = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 16, height: 16, borderRadius: 4, border: 'none', background: 'none',
    color: 'var(--text3)', fontSize: 11, lineHeight: 1,
    cursor: atLimit ? 'not-allowed' : 'pointer', flexShrink: 0,
  }
  const plusBtn = {
    flexShrink: 0, alignSelf: 'center', margin: '0 4px', width: 28, height: 28,
    borderRadius: 7, border: '1px dashed var(--border2)', background: 'none',
    color: atLimit ? 'var(--text3)' : 'var(--text2)', fontSize: 18, lineHeight: 1,
    cursor: atLimit ? 'not-allowed' : 'pointer',
  }
  // Salir de pantalla completa desde la tira: se puede salir aunque la pestaña no tenga tabla.
  const exitFsBtn = {
    flexShrink: 0, alignSelf: 'center', marginLeft: 'auto',
    padding: '5px 10px', borderRadius: 7, border: '1px solid var(--accent)',
    background: 'none', color: 'var(--accent)', fontSize: 11, fontWeight: 700,
    cursor: 'pointer', whiteSpace: 'nowrap',
  }
  const limitText = `Máximo de ${TAB_LIMIT} pestañas abiertas`

  return (
    <div style={fullscreen
      ? { display: 'flex', flexDirection: 'column', position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--bg)' }
      : { display: 'flex', flexDirection: 'column', flex: 1, height: '100%', minHeight: 0 }}>
      <div style={strip} className="viewer-tabstrip">
        {sorted.map((tab, i) => {
          const prevArea = i > 0 ? (sorted[i - 1].meta?.areaId || '') : null
          const newGroup = i > 0 && (tab.meta?.areaId || '') !== prevArea
          const color = areaColor(tab.meta?.areaId)
          const active = tab.id === activeId
          const label = tabLabel(tab.meta)
          const { primary, secondary } = tabLabelParts(tab.meta)
          return (
            <Fragment key={tab.id}>
              {newGroup && <div aria-hidden style={{ width: 1, background: 'var(--border)', margin: '7px 5px', flexShrink: 0 }} />}
              <div
                role="tab"
                aria-selected={active}
                onClick={() => selectTab(tab.id)}
                style={tabStyle(active, color)}
                title={label}
              >
                <span style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, lineHeight: 1.2 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--mono)', fontWeight: active ? 700 : 600 }}>
                    {primary}
                  </span>
                  {secondary && (
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10, color: 'var(--text3)' }}>
                      {secondary}
                    </span>
                  )}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                  {active && (
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); duplicateTab(tab.id) }}
                      disabled={atLimit}
                      style={dupBtn}
                      title={atLimit ? limitText : 'Duplicar pestaña (misma configuración, independiente)'}
                      onMouseEnter={e => { if (!atLimit) { e.currentTarget.style.background = 'var(--border)'; e.currentTarget.style.color = 'var(--accent)' } }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text3)' }}
                    >⧉</button>
                  )}
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); closeTab(tab.id) }}
                    style={closeBtn}
                    title="Cerrar pestaña"
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--border)'; e.currentTarget.style.color = 'var(--red)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text3)' }}
                  >×</button>
                </span>
              </div>
            </Fragment>
          )
        })}
        <button
          type="button"
          onClick={addTab}
          disabled={atLimit}
          style={plusBtn}
          title={atLimit ? limitText : 'Nueva pestaña'}
        >+</button>
        {fullscreen && (
          <button type="button" onClick={toggleFullscreen} style={exitFsBtn} title="Salir de pantalla completa (Esc)">
            ⤡ Salir
          </button>
        )}
      </div>

      {/* Toda pestaña MONTADA sigue en el árbol (conserva su estado); solo se ve la activa. */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {tabs.filter(tab => mounted[tab.id]).map(tab => {
          const active = tab.id === activeId
          return (
            <div key={tab.id} style={{ display: active ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              {renderTab(tab, {
                active,
                onMeta: (def, meta) => updateTab(tab.id, def, meta),
                fullscreen,
                onToggleFullscreen: toggleFullscreen,
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
