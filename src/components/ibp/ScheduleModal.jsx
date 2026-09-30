// «Ejecutar job»: lanzar una plantilla viendo antes con qué valores va a correr.
//
// Portado TAL CUAL de `Jobs/ScheduleModal.jsx` de v8: su propio diálogo de 560 px, el campo
// «Nombre del run», los pasos en acordeón —uno abierto a la vez— con sus parámetros de solo lectura,
// y «▶ Ejecutar», que lanza directamente: v8 no pedía una segunda confirmación ni mostraba un
// diálogo de resultado, cerraba y dejaba marcada la fila con «✓ Enviado».
//
// Los parámetros se MUESTRAN, no se editan: un Application Job se configura en IBP y desde aquí solo
// se dispara con lo que ya tiene guardado.
//
// Lo que cambia, y por qué: v8 leía la plantilla desde el navegador y armaba los pasos aquí. Aquí los
// arma el servidor (`core/ibp/job-schedule.js`), con las mismas lecturas y el mismo respaldo, porque
// las credenciales de SAP no llegan al navegador. El usuario con el que SAP corre el trabajo también
// lo pone el servidor: el de comunicación de la conexión.

import { useEffect, useState } from 'react'

import { nombreBase, tieneValor } from '../../../core/ibp/job-params.js'
import { fetchTemplateDetail, scheduleJob } from '../../lib/ibp-jobs.js'

/** El aviso rojo de v8. */
const ERROR_BOX = {
  background: 'color-mix(in srgb, var(--red) 12%, transparent)',
  border: '1px solid color-mix(in srgb, var(--red) 35%, transparent)',
  color: 'var(--red)',
}

// ── Un parámetro (solo lectura) ────────────────────────────────────────────────
function ParamRow({ p, values, dim = false }) {
  const lows = values[nombreBase(p.name)] ?? []
  const hasValue = lows.length > 0
  const baseOpacity = dim ? 0.45 : 1

  if (p.isCheckbox) {
    const checked = lows.includes('X')
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: baseOpacity }}>
        <span style={{ fontSize: 13, flexShrink: 0, color: checked ? '#22c55e' : 'var(--text3)' }}>
          {checked ? '☑' : '☐'}
        </span>
        <span style={{ fontSize: 11, color: checked ? 'var(--text)' : 'var(--text3)', fontWeight: 500 }}>
          {p.label}
        </span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, minWidth: 0, opacity: baseOpacity }}>
      <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 500, flexShrink: 0, whiteSpace: 'nowrap' }}>
        {p.label}
      </span>
      {hasValue ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end' }}>
          {lows.map((low, i) => (
            <span key={i} style={{
              fontSize: 11, color: 'var(--text)', fontFamily: 'var(--mono)',
              background: 'var(--bg2)', border: '1px solid var(--border)',
              borderRadius: 4, padding: '1px 7px', wordBreak: 'break-all',
            }}>
              {low}
            </span>
          ))}
        </div>
      ) : (
        <span style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>—</span>
      )}
    </div>
  )
}

// ── Contenido desplegado de un paso ────────────────────────────────────────────
function StepContent({ step }) {
  if (step.params.length === 0) {
    return (
      <div style={{ padding: '14px', fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>
        Sin parámetros configurados para este paso.
      </div>
    )
  }

  const checkboxes = step.params.filter(p => p.isCheckbox)
  const rest = step.params.filter(p => !p.isCheckbox)

  // Primero lo configurado, después lo vacío, cada grupo en su orden original.
  const restConfigured = rest.filter(p => tieneValor(p, step.valores))
  const restEmpty = rest.filter(p => !tieneValor(p, step.valores))
  const cbConfigured = checkboxes.filter(p => tieneValor(p, step.valores))
  const cbEmpty = checkboxes.filter(p => !tieneValor(p, step.valores))

  return (
    <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {restConfigured.map(p => <ParamRow key={p.name} p={p} values={step.valores} />)}
      {restEmpty.map(p => <ParamRow key={p.name} p={p} values={step.valores} dim />)}
      {checkboxes.length > 0 && rest.length > 0 && (
        <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
      )}
      {checkboxes.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
          {cbConfigured.map(p => <ParamRow key={p.name} p={p} values={step.valores} />)}
          {cbEmpty.map(p => <ParamRow key={p.name} p={p} values={step.valores} dim />)}
        </div>
      )}
    </div>
  )
}

export default function ScheduleModal({ row, connection, onClose, onSuccess }) {
  const templateLabel = row.JobTemplateText || row.JobTemplateName
  const connectionId = connection.id
  const templateName = row.JobTemplateName

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [steps, setSteps] = useState([])
  const [expandedStep, setExpandedStep] = useState(null)
  const [jobText, setJobText] = useState(templateLabel)
  const [executing, setExecuting] = useState(false)
  const [execError, setExecError] = useState('')

  // ── Carga ──────────────────────────────────────────────────────────────────
  // El diálogo se monta de nuevo para cada plantilla, así que el estado inicial ya es el limpio.
  useEffect(() => {
    let abandonado = false
    fetchTemplateDetail(connectionId, templateName)
      .then((detalle) => {
        if (abandonado) return
        const pasos = detalle?.pasos ?? []
        setSteps(pasos)
        setLoading(false)
        if (pasos.length === 1) setExpandedStep(1)
      })
      .catch((e) => {
        if (abandonado) return
        setLoadError(e.message)
        setLoading(false)
      })
    return () => { abandonado = true }
  }, [connectionId, templateName])

  // ── Ejecutar con los valores configurados en la plantilla ──────────────────
  async function handleExecute() {
    setExecuting(true)
    setExecError('')
    try {
      await scheduleJob(connectionId, { templateName, jobText: jobText || templateLabel })
      onSuccess?.()
      onClose()
    } catch (e) {
      setExecError(e.message)
      setExecuting(false)
    }
  }

  // ── Render principal ───────────────────────────────────────────────────────
  return (
    <>
      <div
        onClick={executing ? undefined : onClose}
        style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', zIndex: 500, backdropFilter: 'blur(2px)' }}
      />

      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 'min(560px, 95vw)', maxHeight: '88vh',
        background: 'var(--bg)', border: '1px solid var(--border2)',
        borderRadius: 12, zIndex: 501,
        display: 'flex', flexDirection: 'column',
        boxShadow: 'var(--shadow-lg)',
        animation: 'scheduleModalIn .18s ease-out',
      }}>

        {/* ── Cabecera ── */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Ejecutar job</div>
              <div style={{ fontSize: 11, color: 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{templateLabel}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 2 }}>{row.JobTemplateName}</div>
            </div>
            <button
              type="button"
              onClick={executing ? undefined : onClose}
              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text2)', fontSize: 13, cursor: 'pointer', padding: '4px 10px', lineHeight: 1, flexShrink: 0 }}
            >✕</button>
          </div>

          {!loading && !loadError && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
                Nombre del run
              </div>
              <input
                type="text" value={jobText}
                onChange={e => setJobText(e.target.value)}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'var(--bg2)', border: '1px solid var(--border)',
                  borderRadius: 6, color: 'var(--text)', fontSize: 11,
                  padding: '7px 10px', outline: 'none',
                }}
              />
            </div>
          )}

          {!loading && !loadError && (
            <div style={{ marginTop: 10, fontSize: 10, color: 'var(--text3)', fontStyle: 'italic' }}>
              Los parámetros se ejecutan con los valores configurados en SAP IBP. Para modificarlos, edita el template directamente en el sistema.
            </div>
          )}
        </div>

        {/* ── Cuerpo: los pasos ── */}
        <div style={{ flex: 1, overflow: 'auto', padding: '14px 20px' }}>

          {loading && (
            <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text2)', fontSize: 12 }}>
              Cargando pasos…
            </div>
          )}

          {loadError && (
            <div style={{ ...ERROR_BOX, borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
              ✕ {loadError}
            </div>
          )}

          {!loading && !loadError && steps.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text2)', fontSize: 12 }}>
              Este template no tiene pasos configurados.
            </div>
          )}

          {!loading && !loadError && steps.map(step => {
            const isOpen = expandedStep === step.posicion

            // Parámetros con valor de verdad, con el mismo criterio que el cuerpo.
            const configured = step.params.filter(p => tieneValor(p, step.valores)).length
            const total = step.params.length

            // Título: el nombre que le puso el usuario en IBP, o el tipo de paso; con P_OPNAME si lo hay.
            const opName = ((step.valores.P_OPNAME ?? [])[0] ?? '').trim()
            const titleBase = step.nombre ?? step.titulo
            const stepTitle = opName ? `${titleBase}: ${opName}` : titleBase
            const showCatalogSubtitle = !!step.nombre

            return (
              <div key={step.posicion} style={{
                marginBottom: 8, borderRadius: 8, overflow: 'hidden',
                border: `1px solid ${isOpen ? 'var(--border2)' : 'var(--border)'}`,
                background: isOpen ? 'var(--bg2)' : 'transparent',
                transition: 'border-color .15s',
              }}>

                <div
                  onClick={() => setExpandedStep(prev => prev === step.posicion ? null : step.posicion)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', cursor: 'pointer', userSelect: 'none' }}
                >
                  <span style={{
                    width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700,
                    background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)',
                  }}>{step.posicion}</span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {stepTitle}
                    </div>
                    {showCatalogSubtitle && (
                      <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {step.titulo}
                      </div>
                    )}
                    {!showCatalogSubtitle && step.titulo !== step.catalogo && step.catalogo && (
                      <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 1 }}>
                        {step.catalogo}
                      </div>
                    )}
                  </div>

                  {total > 0 && (
                    <span style={{ fontSize: 9, color: 'var(--text3)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 3, padding: '2px 6px', flexShrink: 0, whiteSpace: 'nowrap' }}>
                      {configured}/{total}
                    </span>
                  )}

                  <span style={{ color: 'var(--text3)', fontSize: 10, flexShrink: 0, marginLeft: 2 }}>
                    {isOpen ? '▲' : '▼'}
                  </span>
                </div>

                {isOpen && (
                  <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg3)' }}>
                    <StepContent step={step} />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── Pie ── */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          {execError && (
            <div style={{ ...ERROR_BOX, borderRadius: 6, padding: '8px 12px', fontSize: 11, marginBottom: 12, wordBreak: 'break-word' }}>
              ✕ {execError}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
            {!loading && steps.length > 0 && (
              <span style={{ fontSize: 10, color: 'var(--text3)', marginRight: 'auto' }}>
                {steps.length === 1 ? '1 paso' : `${steps.length} pasos`}
              </span>
            )}
            <button
              type="button"
              onClick={executing ? undefined : onClose} disabled={executing}
              style={{ padding: '7px 18px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', fontSize: 12, cursor: executing ? 'default' : 'pointer' }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleExecute} disabled={executing || loading}
              style={{ padding: '7px 18px', borderRadius: 6, border: '1px solid color-mix(in srgb, var(--green) 40%, transparent)', background: 'color-mix(in srgb, var(--green) 15%, transparent)', color: 'var(--green)', fontSize: 12, fontWeight: 600, cursor: (executing || loading) ? 'default' : 'pointer', opacity: (executing || loading) ? 0.6 : 1 }}
            >
              {executing ? 'Ejecutando…' : '▶ Ejecutar'}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes scheduleModalIn {
          from { opacity: 0; transform: translate(-50%, calc(-50% + 12px)); }
          to   { opacity: 1; transform: translate(-50%, -50%); }
        }
      `}</style>
    </>
  )
}
