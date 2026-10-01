// La pestaña «Orquestador» de IBP: encadenar Application Jobs en secuencia, con condiciones de error
// y grupos en paralelo. Portada tal cual de `Orchestrations/Orchestrations.jsx` de v8 —la lista
// plegable de la izquierda, el editor o la ejecución a la derecha, y sus ventanas de crear, borrar e
// importar—, con `OrchBuilder`, `StepCard`, `TemplatePalette` y `RunView` al lado.
//
// Lo que cambia por dentro, por decisión de arquitectura de esta plataforma y sin que se note en la
// pantalla:
//
//   - Las orquestaciones se guardan en la base, por cliente y conexión, y no en el `localStorage`
//     del navegador (ver `useOrchStorage.js`). Cada cambio se guarda solo, como en v8.
//   - Las ejecuta el motor del servidor con las reglas de v8 (ver `useOrchRun.js`). El navegador no
//     habla con SAP ni ve credenciales.
//
// No es la pantalla de orquestaciones de CI-DS (el lienzo de v9): la de IBP era otra en v8 y se
// porta la suya. Solo comparten el motor.

import { useRef, useState } from 'react'

import { readOrchestrationFile, toV8File, v8FileName } from '../../../lib/ibp-orchestration.js'
import { downloadFile } from '../../../lib/orchestration-file.js'
import { useIsMobile } from '../../../lib/useIsMobile.js'
import OrchBuilder from './OrchBuilder.jsx'
import RunView from './RunView.jsx'
import { useOrchRun } from './useOrchRun.js'
import { useOrchStorage } from './useOrchStorage.js'

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es', { day: '2-digit', month: 'short', year: '2-digit' })
}

const recortado = (nombre) => nombre.slice(0, 20) + (nombre.length > 20 ? '…' : '')

export default function IbpOrchestrations({ connection }) {
  const storage = useOrchStorage(connection.id)
  const orchs = storage.orchs ?? []
  const {
    run, runOrchId, isRunning, error: runError, start, cancel, reset, adoptIfRunning, setRunName,
  } = useOrchRun(connection)

  // Como v8: al entrar, si quedó una ejecución abierta, se abre su orquestación en la vista de
  // ejecución.
  const [selectedId, setSelectedId]     = useState(() => runOrchId)
  const [mode, setMode]                 = useState(() => (runOrchId ? 'run' : 'build'))
  const [importError, setImportError]   = useState('')
  const [importSuccess, setImportSuccess] = useState('')
  const [showImportModal, setShowImportModal] = useState(false)
  const [importParsed, setImportParsed] = useState(null)
  const [replaceMode, setReplaceMode]   = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [fullscreen, setFullscreen]     = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newOrchName, setNewOrchName]         = useState('')
  const [deleteTargetId, setDeleteTargetId]   = useState(null)
  const [mobileView, setMobileView]           = useState('list')
  const fileRef = useRef(null)
  const isMobile = useIsMobile()

  const selected = orchs.find(o => o.id === selectedId) || null

  // Los errores de la base y del motor se dicen donde v8 decía los de importar.
  const errorVisible = importError || runError || storage.error || ''

  function seleccionar(id) {
    setSelectedId(id)
    if (!id) { setFullscreen(false); setMobileView('list') }
  }

  function handleCreate() {
    setNewOrchName('')
    setShowCreateModal(true)
  }

  async function confirmCreate() {
    const name = newOrchName.trim()
    if (!name) return
    try {
      const orch = await storage.create(name)
      seleccionar(orch.id)
      setMode('build')
      setMobileView('builder')
      reset()
      setShowCreateModal(false)
      setNewOrchName('')
    } catch (e) {
      storage.setError(e.message)
      setShowCreateModal(false)
    }
  }

  function handleDelete(id) {
    setDeleteTargetId(id)
  }

  async function handleDuplicate(id) {
    try {
      const copy = await storage.duplicate(id)
      seleccionar(copy.id)
      setMode('build')
      setMobileView('builder')
      reset()
    } catch (e) {
      storage.setError(e.message)
    }
  }

  async function confirmDelete() {
    const id = deleteTargetId
    setDeleteTargetId(null)
    try {
      await storage.remove(id)
      if (selectedId === id) { seleccionar(null); setMode('build'); setMobileView('list'); reset() }
    } catch (e) {
      storage.setError(e.message)
    }
  }

  /** Abrir una orquestación de la lista. Si se está ejecutando en otro lado, se abre su ejecución. */
  async function abrir(orch) {
    if (isRunning) return
    seleccionar(orch.id)
    setMode('build')
    setMobileView('builder')
    if (selectedId !== orch.id) reset()
    if (await adoptIfRunning(orch)) setMode('run')
  }

  async function handleRun() {
    if (!selected) return
    // Lo que se ve es lo que corre: se guarda lo pendiente antes de arrancar y, si venía dibujada
    // en el lienzo, se guarda como la lista que se está enseñando.
    if (selected.isList === false) await storage.saveAsList(selected)
    else await storage.flush(selected.id)
    reset()
    if (await start(selected)) setMode('run')
  }

  function handleCancelRun() { cancel() }
  function handleCloseRun()  { reset(); setMode('build') }

  async function handleExport() {
    if (!orchs.length) return
    await storage.flush()
    downloadFile(toV8File(orchs, connection.name), v8FileName(connection.name))
  }

  async function handleExportSingle() {
    if (!selected) return
    await storage.flush(selected.id)
    downloadFile(toV8File([selected], connection.name), v8FileName(connection.name))
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target.result)
        if (!parsed.orchestrations || !Array.isArray(parsed.orchestrations)) {
          throw new Error('Formato de archivo inválido (falta "orchestrations")')
        }
        setImportParsed(parsed)
        setShowImportModal(true)
        setImportError('')
      } catch (err) {
        setImportError(err.message)
      }
    }
    reader.readAsText(file)
  }

  async function confirmImport() {
    if (!importParsed) return
    const parsed = importParsed
    setShowImportModal(false)
    setImportParsed(null)
    try {
      const { added, replaced, skipped } = await storage.importOrchs(readOrchestrationFile(parsed), replaceMode)
      setImportSuccess(`Importadas: ${added} nuevas, ${replaced} reemplazadas, ${skipped} omitidas.`)
      setTimeout(() => setImportSuccess(''), 4000)
    } catch (err) {
      setImportError(err.message)
    }
  }

  const showEmpty   = orchs.length === 0
  // Si la ejecución abierta ya no existe en el servidor, el gancho la olvida y se vuelve al editor.
  const modoReal    = mode === 'run' && runOrchId ? 'run' : 'build'
  const showBuilder = !showEmpty && selectedId && selected && modoReal === 'build'
  const showRun     = !showEmpty && selectedId && selected && modoReal === 'run'
  const enPantallaCompleta = fullscreen && showBuilder

  const builderEl = showBuilder ? (
    <OrchBuilder
      key={`${selected.id}-${enPantallaCompleta ? 'completa' : 'panel'}`}
      orch={selected}
      connection={connection}
      onUpdate={updatedOrch => {
        storage.update(updatedOrch)
        setRunName(updatedOrch.name)
      }}
      onRun={handleRun}
      disabled={isRunning}
      fullscreen={enPantallaCompleta}
      onToggleFullscreen={() => setFullscreen(f => !f)}
    />
  ) : null

  return (
    <>
      <div style={{ display: 'flex', flex: 1, minHeight: 0, height: '100%', overflow: 'hidden' }}>
        {/* ── Lista de la izquierda ── */}
        <div
          style={{
            width: isMobile ? '100%' : (sidebarCollapsed ? 36 : 240),
            flexShrink: 0,
            borderRight: isMobile ? 'none' : '1px solid var(--border)',
            display: isMobile && mobileView === 'builder' ? 'none' : 'flex',
            flexDirection: 'column',
            background: 'var(--bg2)',
            transition: 'width .2s ease',
            overflow: 'hidden',
          }}
          className="orch-sidebar"
        >
          {/* Cabecera de la lista */}
          <div style={{
            padding: sidebarCollapsed ? '14px 0' : '14px 12px 10px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: sidebarCollapsed ? 'center' : 'space-between',
            gap: 6,
          }}>
            {!sidebarCollapsed && (
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Orquestaciones
              </div>
            )}
            <button
              type="button"
              onClick={() => setSidebarCollapsed(c => !c)}
              title={sidebarCollapsed ? 'Expandir panel' : 'Colapsar panel'}
              style={{
                background: 'none', border: '1px solid var(--border)', borderRadius: 5,
                color: 'var(--text3)', fontSize: 11, cursor: 'pointer',
                padding: '3px 6px', lineHeight: 1, flexShrink: 0,
                transition: 'color .12s, border-color .12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.borderColor = 'var(--text2)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border)' }}
            >
              {sidebarCollapsed ? '▶' : '◀'}
            </button>
          </div>

          {/* Desplegada */}
          {!sidebarCollapsed && (
            <>
              <div style={{ padding: '10px 12px 6px', flexShrink: 0 }}>
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={handleCreate}
                  style={{
                    width: '100%', padding: '7px 0', borderRadius: 6,
                    border: '1px solid rgba(34,197,94,.35)', background: 'rgba(34,197,94,.07)',
                    color: isRunning ? 'var(--text3)' : '#22c55e',
                    fontSize: 11, fontWeight: 700,
                    cursor: isRunning ? 'default' : 'pointer',
                    opacity: isRunning ? 0.45 : 1,
                  }}
                >
                  + Nueva orquestación
                </button>
              </div>

              {/* La lista */}
              <div style={{ flex: 1, overflow: 'auto' }}>
                {storage.orchs !== null && orchs.length === 0 && (
                  <div style={{ padding: '16px 12px', fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>
                    Sin orquestaciones. Crea la primera.
                  </div>
                )}
                {orchs.map(orch => {
                  const isActive = orch.id === selectedId
                  const stepCount = (orch.steps || []).length
                  return (
                    <div
                      key={orch.id}
                      onClick={() => abrir(orch)}
                      style={{
                        padding: '10px 12px',
                        borderBottom: '1px solid var(--border)',
                        background: isActive ? 'rgba(59,130,246,.08)' : 'transparent',
                        borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                        cursor: isRunning ? 'default' : 'pointer',
                        display: 'flex', alignItems: 'flex-start', gap: 6,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {isRunning && isActive && (
                            <span style={{ flexShrink: 0, fontSize: 8, color: '#22c55e', animation: 'orchRunPulse 1.2s ease-in-out infinite' }}>●</span>
                          )}
                          <span style={{
                            fontSize: 12, fontWeight: isActive ? 700 : 500,
                            color: isActive ? '#fff' : 'var(--text)',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {orch.name}
                          </span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                          {stepCount === 1 ? '1 paso' : `${stepCount} pasos`}
                          {' · '}{formatDate(orch.createdAt)}
                        </div>
                      </div>
                      {!isRunning && (
                        <>
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); handleDuplicate(orch.id) }}
                            title="Duplicar"
                            style={{
                              background: 'none', border: 'none', color: 'var(--text3)',
                              fontSize: 12, cursor: 'pointer', padding: '2px 4px', lineHeight: 1,
                              flexShrink: 0, opacity: 0.5,
                              transition: 'opacity .12s, color .12s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.color = '#22c55e' }}
                            onMouseLeave={e => { e.currentTarget.style.opacity = 0.5; e.currentTarget.style.color = 'var(--text3)' }}
                          >⧉</button>
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); handleDelete(orch.id) }}
                            title="Eliminar"
                            style={{
                              background: 'none', border: 'none', color: 'var(--text3)',
                              fontSize: 11, cursor: 'pointer', padding: '2px 4px', lineHeight: 1,
                              flexShrink: 0, opacity: 0.5,
                              transition: 'opacity .12s, color .12s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.color = 'var(--red)' }}
                            onMouseLeave={e => { e.currentTarget.style.opacity = 0.5; e.currentTarget.style.color = 'var(--text3)' }}
                          >✕</button>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Pie: exportar e importar */}
              <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {importSuccess && (
                  <div style={{ fontSize: 10, color: '#22c55e', marginBottom: 2 }}>{importSuccess}</div>
                )}
                {errorVisible && (
                  <div style={{ fontSize: 10, color: 'var(--red)', marginBottom: 2 }}>✕ {errorVisible}</div>
                )}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    disabled={orchs.length === 0}
                    onClick={handleExport}
                    title="↓ Exportar"
                    style={{
                      flex: 1, padding: '5px 0', borderRadius: 5,
                      border: '1px solid var(--border)', background: 'transparent',
                      color: 'var(--text2)', fontSize: 10, cursor: orchs.length > 0 ? 'pointer' : 'default',
                      opacity: orchs.length > 0 ? 1 : 0.4,
                    }}
                  >↓ Exportar</button>
                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={() => !isRunning && fileRef.current?.click()}
                    style={{
                      flex: 1, padding: '5px 0', borderRadius: 5,
                      border: '1px solid var(--border)', background: 'transparent',
                      color: isRunning ? 'var(--text3)' : 'var(--text2)',
                      fontSize: 10, cursor: isRunning ? 'default' : 'pointer',
                      opacity: isRunning ? 0.45 : 1,
                    }}
                  >↑ Importar</button>
                </div>
                {selected && (
                  <button
                    type="button"
                    onClick={handleExportSingle}
                    title={`↓ Exportar "${recortado(selected.name)}"`}
                    style={{
                      padding: '5px 0', borderRadius: 5,
                      border: '1px solid var(--border)', background: 'transparent',
                      color: 'var(--text3)', fontSize: 10, cursor: 'pointer',
                    }}
                  >{`↓ Exportar "${recortado(selected.name)}"`}</button>
                )}
              </div>
            </>
          )}

          {/* Plegada: solo las iniciales */}
          {sidebarCollapsed && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '10px 0' }}>
              <button
                type="button"
                onClick={handleCreate}
                disabled={isRunning}
                title="+ Nueva orquestación"
                style={{
                  background: 'rgba(34,197,94,.1)', border: '1px solid rgba(34,197,94,.3)',
                  borderRadius: 5, color: '#22c55e', fontSize: 14, cursor: isRunning ? 'default' : 'pointer',
                  width: 26, height: 26, padding: 0, lineHeight: 1,
                  opacity: isRunning ? 0.45 : 1,
                }}
              >+</button>
              {orchs.map(orch => {
                const isActive = orch.id === selectedId
                return (
                  <div
                    key={orch.id}
                    onClick={() => abrir(orch)}
                    title={orch.name}
                    style={{
                      position: 'relative',
                      width: 26, height: 26, borderRadius: 5, cursor: isRunning ? 'default' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 700,
                      background: isActive ? 'var(--accent-bg-soft)' : 'var(--surface-glass)',
                      border: isActive ? '1px solid var(--accent)' : '1px solid var(--border)',
                      color: isActive ? 'var(--accent)' : 'var(--text3)',
                    }}
                  >
                    {orch.name.slice(0, 1).toUpperCase()}
                    {isRunning && isActive && (
                      <span style={{
                        position: 'absolute', top: -3, right: -3,
                        width: 7, height: 7, borderRadius: '50%',
                        background: 'var(--green)',
                        animation: 'orchRunPulse 1.2s ease-in-out infinite',
                      }} />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Panel de la derecha ── */}
        <div style={{
          flex: 1, overflow: 'hidden',
          display: isMobile && mobileView === 'list' ? 'none' : 'flex',
          flexDirection: 'column',
        }}>
          {/* Barra para volver, en el teléfono */}
          {isMobile && (
            <div style={{
              padding: '8px 12px', background: 'var(--bg2)',
              borderBottom: '1px solid var(--border)', flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <button
                type="button"
                onClick={() => setMobileView('list')}
                style={{
                  background: 'none', border: '1px solid var(--border)',
                  borderRadius: 6, color: 'var(--text2)', fontSize: 12,
                  padding: '5px 12px', cursor: 'pointer',
                }}
              >← Volver</button>
              {selected && (
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selected.name}
                </span>
              )}
            </div>
          )}

          {/* v8 miraba solo si había una elegida; aquí también si sigue existiendo, porque la
              pudieron borrar desde otro equipo. */}
          {!selected && (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 14,
            }}>
              <div style={{ fontSize: 40, opacity: 0.15 }}>⊞</div>
              <div style={{ fontSize: 14, color: 'var(--text2)', fontWeight: 600 }}>Orquestador de Jobs</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', maxWidth: 320 }}>
                Crea una orquestación para encadenar jobs en secuencia, definir condiciones de error y agrupar jobs en paralelo.
              </div>
              <button
                type="button"
                onClick={handleCreate}
                style={{
                  marginTop: 4, padding: '8px 22px', borderRadius: 7,
                  border: '1px solid rgba(34,197,94,.35)',
                  background: 'rgba(34,197,94,.08)',
                  color: '#22c55e', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}
              >+ Nueva orquestación</button>
            </div>
          )}

          {!enPantallaCompleta && builderEl}

          {showRun && (
            <RunView
              run={run}
              orch={selected}
              onCancel={handleCancelRun}
              onClose={isRunning ? undefined : handleCloseRun}
              connection={connection}
            />
          )}
        </div>
      </div>

      {/* ── Pantalla completa ── */}
      {enPantallaCompleta && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'var(--bg)',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {builderEl}
        </div>
      )}

      {/* ── Importar ── */}
      {showImportModal && importParsed && (
        <>
          <div
            onClick={() => setShowImportModal(false)}
            style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', zIndex: 500, backdropFilter: 'blur(2px)' }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 'min(440px, 95vw)',
            background: 'var(--bg)', border: '1px solid var(--border2)',
            borderRadius: 12, zIndex: 501, padding: '24px',
            boxShadow: 'var(--shadow-lg)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
              Importar orquestaciones
            </div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 16 }}>
              {`Se encontraron ${importParsed.orchestrations.length} orquestación(es) en el archivo.`}
              {importParsed.sourceConnection && (
                <span style={{ color: 'var(--text3)' }}> ({importParsed.sourceConnection})</span>
              )}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 20 }}>
              <input
                type="checkbox"
                checked={replaceMode}
                onChange={e => setReplaceMode(e.target.checked)}
                style={{ width: 15, height: 15 }}
              />
              <span style={{ fontSize: 12, color: 'var(--text)' }}>
                Reemplazar orquestaciones existentes con el mismo nombre
              </span>
            </label>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => { setShowImportModal(false); setImportParsed(null) }}
                style={{
                  padding: '7px 16px', borderRadius: 6,
                  border: '1px solid var(--border)', background: 'transparent',
                  color: 'var(--text2)', fontSize: 12, cursor: 'pointer',
                }}
              >Cancelar</button>
              <button
                type="button"
                onClick={confirmImport}
                style={{
                  padding: '7px 16px', borderRadius: 6,
                  border: '1px solid rgba(34,197,94,.35)',
                  background: 'rgba(34,197,94,.1)',
                  color: '#22c55e', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}
              >↑ Importar</button>
            </div>
          </div>
        </>
      )}

      <input ref={fileRef} type="file" accept=".json" onChange={handleFileChange} style={{ display: 'none' }} />

      {/* ── Crear ── */}
      {showCreateModal && (
        <>
          <div
            onClick={() => setShowCreateModal(false)}
            style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', zIndex: 500, backdropFilter: 'blur(2px)' }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 'min(400px, 92vw)',
            background: 'var(--bg2)', border: '1px solid var(--border2)',
            borderRadius: 12, zIndex: 501, padding: 24,
            boxShadow: 'var(--shadow-lg)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>
              Nueva orquestación
            </div>
            <input
              autoFocus
              value={newOrchName}
              onChange={e => setNewOrchName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmCreate(); if (e.key === 'Escape') setShowCreateModal(false) }}
              placeholder="Nombre de la orquestación…"
              style={{
                width: '100%', background: 'var(--bg)', border: '1px solid var(--border2)',
                borderRadius: 7, color: 'var(--text)', fontSize: 13, fontWeight: 500,
                padding: '9px 12px', outline: 'none', marginBottom: 18,
              }}
              onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
              onBlur={e => { e.target.style.borderColor = 'var(--border2)' }}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                style={{
                  padding: '7px 16px', borderRadius: 6,
                  border: '1px solid var(--border)', background: 'transparent',
                  color: 'var(--text2)', fontSize: 12, cursor: 'pointer',
                }}
              >Cancelar</button>
              <button
                type="button"
                onClick={confirmCreate}
                disabled={!newOrchName.trim()}
                style={{
                  padding: '7px 18px', borderRadius: 6,
                  border: '1px solid rgba(34,197,94,.4)',
                  background: newOrchName.trim() ? 'rgba(34,197,94,.12)' : 'transparent',
                  color: newOrchName.trim() ? '#22c55e' : 'var(--text3)',
                  fontSize: 12, fontWeight: 700,
                  cursor: newOrchName.trim() ? 'pointer' : 'default',
                }}
              >Crear</button>
            </div>
          </div>
        </>
      )}

      {/* ── Eliminar ── */}
      {deleteTargetId && (
        <>
          <div
            onClick={() => setDeleteTargetId(null)}
            style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', zIndex: 500, backdropFilter: 'blur(2px)' }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 'min(380px, 92vw)',
            background: 'var(--bg2)', border: '1px solid var(--border2)',
            borderRadius: 12, zIndex: 501, padding: 24,
            boxShadow: 'var(--shadow-lg)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Eliminar orquestación</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 20 }}>
              Esta acción no se puede deshacer. ¿Confirmas?
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setDeleteTargetId(null)}
                style={{
                  padding: '7px 16px', borderRadius: 6,
                  border: '1px solid var(--border)', background: 'transparent',
                  color: 'var(--text2)', fontSize: 12, cursor: 'pointer',
                }}
              >Cancelar</button>
              <button
                type="button"
                onClick={confirmDelete}
                style={{
                  padding: '7px 18px', borderRadius: 6,
                  border: '1px solid rgba(255,107,107,.4)',
                  background: 'rgba(255,107,107,.12)',
                  color: 'var(--red)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}
              >Eliminar</button>
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes orchRunPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.45; transform: scale(0.75); }
        }
      `}</style>
    </>
  )
}
