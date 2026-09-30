// «Pasos del job»: el panel lateral del monitor con lo que hizo cada paso de una ejecución.
//
// Portado TAL CUAL de `Jobs/StepsPanel.jsx` de v8: el cajón de 600 px a la derecha, la cabecera con el
// estado y los recuentos, y una fila por paso —número, nombre, inicio, estado, código de retorno,
// duración y el resumen de mensajes— que se despliega, un paso a la vez, en «Detalle del paso»,
// «Log de aplicación», «Parámetros» (plegable, por secciones) y «Mensajes».
//
// Lee lo mismo que v8 y en el mismo momento:
//
//   - Al abrir: los pasos (`JobStepSet`), los nombres que el usuario les puso en IBP
//     (`JobTemplateSequenceSet`), los parámetros de la ejecución (`JobParamValuesStructGet`), los
//     registros de CADA paso que tiene registros (`JobStepLogInfoSet`) y, por cada tipo de paso, qué
//     parámetros se muestran y cómo (`JobTemplateRead`, `JobTemplateParameterSet`,
//     `JobTemplateParamGroupSet`).
//   - Al desplegar un paso: las líneas de TODOS sus registros (`JobLogMessageSet`, una por registro).
//
// Lo que cambia es solo por dónde pasan las llamadas: v8 le pedía a SAP desde el navegador y aquí
// todo va por `/api/ibp/job-runs`, porque las credenciales no salen del servidor.

import { useCallback, useEffect, useState } from 'react'

import {
  OPERADOR_DE_SELECCION,
  ORDEN_DE_SECCIONES,
  etiquetaDeParametroDePaso,
  metaSinDatos,
} from '../../../core/ibp/job-params.js'
import { formatSapTs, parseSapTs } from '../../lib/fechas-v8.js'
import {
  fetchCatalogMeta,
  fetchLogMessages,
  fetchRunParams,
  fetchRunSteps,
  fetchStepLogs,
  fetchTemplateSequences,
} from '../../lib/ibp-jobs.js'

const MSG_STYLE = {
  A: { label: 'Abort', color: '#ff6b6b', bg: 'rgba(255,107,107,.08)' },
  E: { label: 'Error', color: '#ff6b6b', bg: 'rgba(255,107,107,.08)' },
  W: { label: 'Warning', color: '#fbbf24', bg: 'rgba(251,191,36,.08)' },
  I: { label: 'Info', color: '#3b82f6', bg: 'rgba(59,130,246,.08)' },
  S: { label: 'Success', color: '#22c55e', bg: 'rgba(34,197,94,.08)' },
}

const SEV_STYLE = {
  S: { color: '#22c55e', bg: 'rgba(34,197,94,.12)', border: 'rgba(34,197,94,.3)' },
  W: { color: '#fbbf24', bg: 'rgba(251,191,36,.12)', border: 'rgba(251,191,36,.3)' },
  E: { color: '#ff6b6b', bg: 'rgba(255,107,107,.12)', border: 'rgba(255,107,107,.3)' },
  A: { color: '#ff6b6b', bg: 'rgba(255,107,107,.12)', border: 'rgba(255,107,107,.3)' },
  I: { color: '#3b82f6', bg: 'rgba(59,130,246,.12)', border: 'rgba(59,130,246,.3)' },
}

const STEP_STATUS_FALLBACK = {
  F: { bg: 'rgba(34,197,94,.12)', color: '#22c55e', border: 'rgba(34,197,94,.3)', text: 'Finished' },
  W: { bg: 'rgba(251,191,36,.12)', color: '#fbbf24', border: 'rgba(251,191,36,.3)', text: 'Warning' },
  A: { bg: 'rgba(255,107,107,.12)', color: '#ff6b6b', border: 'rgba(255,107,107,.3)', text: 'Aborted' },
  E: { bg: 'rgba(255,107,107,.12)', color: '#ff6b6b', border: 'rgba(255,107,107,.3)', text: 'Error' },
  U: { bg: 'rgba(255,107,107,.12)', color: '#ff6b6b', border: 'rgba(255,107,107,.3)', text: 'User Error' },
  R: { bg: 'rgba(34,197,94,.08)', color: '#22c55e', border: 'rgba(34,197,94,.2)', text: 'Running' },
  S: { bg: 'rgba(156,163,175,.15)', color: '#9ca3af', border: 'rgba(156,163,175,.3)', text: 'Scheduled' },
  C: { bg: 'rgba(148,163,184,.12)', color: '#94a3b8', border: 'rgba(148,163,184,.3)', text: 'Canceled' },
  P: { bg: 'rgba(99,102,241,.12)', color: '#818cf8', border: 'rgba(99,102,241,.3)', text: 'Released' },
}

const SECTION_TITLE = { fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }

function fmtDuration(ms) {
  if (ms == null || ms < 0 || isNaN(ms)) return null
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const s = secs % 60
  if (mins < 60) return `${mins}m ${s > 0 ? ` ${s}s` : ''}`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}h ${m > 0 ? ` ${m}m` : ''}`
}

/** Lo que duró un paso: hasta que empezó el siguiente, o hasta que acabó el job si es el último. */
function calcDuration(step, stepsArr, jobEnd) {
  const start = parseSapTs(step.StepStartDateTime)
  if (!start) return null
  const sorted = [...stepsArr].sort((a, b) => Number(a.StepNumber) - Number(b.StepNumber))
  const idx = sorted.findIndex(s => Number(s.StepNumber) === Number(step.StepNumber))
  const endTs = sorted[idx + 1]?.StepStartDateTime ?? jobEnd
  const end = parseSapTs(endTs)
  if (!end) return null
  return fmtDuration(end - start)
}

/** Lo que se sabe de un tipo de paso ya recibido, con los visibles como conjunto. */
const metaRecibida = (meta) => ({
  loading: false,
  ...meta,
  visibleParams: meta?.visibleParams ? new Set(meta.visibleParams) : null,
})

function DetailRow({ label, value }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--text)' }}>{value}</span>
    </div>
  )
}

export default function JobStepsPanel({ job, connection, statuses, tzMode, onClose, inline = false }) {
  const connectionId = connection.id
  const [steps, setSteps] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(null)
  // logInfos: { [stepNumber]: { loading, records[], error } } — se piden todos al abrir
  const [logInfos, setLogInfos] = useState({})
  // messages: { [stepNumber]: { loading, data[], error } } — al desplegar el paso
  const [messages, setMessages] = useState({})
  // params: los parámetros de la ejecución (JobParamValuesStructGet), en paralelo con los pasos
  const [params, setParams] = useState({ loading: true, data: [], error: '' })
  // paramsExpanded: qué pasos tienen abierta la sección de parámetros
  const [paramsExpanded, setParamsExpanded] = useState({})
  // templateMeta: { [JobCatalogEntryName]: { loading, hasData, visibleParams, paramOrder, groupMap, labelMap } }
  const [templateMeta, setTemplateMeta] = useState({})
  // seqNames: { [posición]: JobSequenceText } — el nombre que el usuario le puso al paso en IBP
  const [seqNames, setSeqNames] = useState({})

  // Los parámetros de la ejecución
  useEffect(() => {
    let cancelled = false
    fetchRunParams(connectionId, { jobName: job.JobName, runCount: job.JobRunCount })
      .then((data) => { if (!cancelled) setParams({ loading: false, data: data ?? [], error: '' }) })
      .catch((e) => { if (!cancelled) setParams({ loading: false, data: [], error: e.message }) })
    return () => { cancelled = true }
  }, [connectionId, job.JobName, job.JobRunCount])

  // Fase 1: los pasos y los nombres de secuencia de la plantilla; después, en paralelo, los
  // registros de cada paso y lo que se sabe de cada tipo de paso.
  useEffect(() => {
    let cancelled = false

    // Fase 2: los registros de todos los pasos que tienen, en paralelo.
    function loadAllLogInfos(stepsArr) {
      const withLogs = stepsArr.filter(s => Number(s.NrOfLogs) > 0)
      if (!withLogs.length) return
      const init = {}
      withLogs.forEach(s => { init[Number(s.StepNumber)] = { loading: true, records: [], error: '' } })
      setLogInfos(init)
      withLogs.forEach(async (step) => {
        const n = Number(step.StepNumber)
        try {
          const records = await fetchStepLogs(connectionId, {
            jobName: step.JobName ?? job.JobName,
            runCount: step.JobRunCount ?? job.JobRunCount,
            stepNumber: n,
          })
          if (!cancelled) setLogInfos(p => ({ ...p, [n]: { loading: false, records: records ?? [], error: '' } }))
        } catch (e) {
          if (!cancelled) setLogInfos(p => ({ ...p, [n]: { loading: false, records: [], error: e.message } }))
        }
      })
    }

    // Qué parámetros se muestran de cada tipo de paso, en qué orden y en qué sección.
    function loadAllTemplateMeta(stepsArr) {
      const catalogs = [...new Set(stepsArr.map(s => s.JobCatalogEntryName).filter(Boolean))]
      if (!catalogs.length) return
      const init = {}
      catalogs.forEach(c => { init[c] = { ...metaSinDatos(), loading: true, groupMap: {} } })
      setTemplateMeta(init)
      catalogs.forEach(async (catalog) => {
        let meta
        try {
          meta = metaRecibida(await fetchCatalogMeta(connectionId, catalog))
        } catch {
          meta = metaRecibida(metaSinDatos())
        }
        if (!cancelled) setTemplateMeta(prev => ({ ...prev, [catalog]: meta }))
      })
    }

    async function load() {
      try {
        const [stepsData, seqData] = await Promise.all([
          fetchRunSteps(connectionId, { jobName: job.JobName, runCount: job.JobRunCount }),
          job.JobTemplateName
            ? fetchTemplateSequences(connectionId, job.JobTemplateName).catch(() => null)
            : Promise.resolve(null),
        ])
        if (cancelled) return
        const results = [...(stepsData ?? [])]
          .sort((a, b) => (Number(a.StepNumber) || 0) - (Number(b.StepNumber) || 0))
        setSteps(results)
        if (seqData) {
          const names = {}
          seqData.forEach(s => {
            if (s.JobSequenceText) names[s.JobSequencePosition] = s.JobSequenceText
          })
          setSeqNames(names)
        }
        loadAllLogInfos(results)
        loadAllTemplateMeta(results)
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [connectionId, job.JobName, job.JobRunCount, job.JobTemplateName])

  // Fase 3: al desplegar un paso con sus registros ya leídos, las líneas de TODOS ellos.
  const loadMessages = useCallback(async (n, records) => {
    setMessages(p => ({ ...p, [n]: { loading: true, data: [], error: '' } }))
    try {
      const allMsgs = []
      for (const info of records) {
        const lineas = await fetchLogMessages(connectionId, {
          jobName: info.JobName,
          runCount: info.JobRunCount,
          stepNumber: Number(info.StepNumber),
          logHandle: info.LogHandle,
        })
        allMsgs.push(...(lineas ?? []))
      }
      setMessages(p => ({ ...p, [n]: { loading: false, data: allMsgs, error: '' } }))
    } catch (e) {
      setMessages(p => ({ ...p, [n]: { loading: false, data: [], error: e.message } }))
    }
  }, [connectionId])

  // Los mensajes se piden cuando el paso está desplegado Y sus registros ya llegaron, sea cual sea
  // lo que pase primero.
  useEffect(() => {
    if (expanded === null) return undefined
    const li = logInfos[expanded]
    if (!li || li.loading || !li.records.length) return undefined
    if (messages[expanded]) return undefined
    const id = setTimeout(() => loadMessages(expanded, li.records), 0)
    return () => clearTimeout(id)
  }, [expanded, logInfos, messages, loadMessages])

  function toggleExpand(step) {
    setExpanded(prev => prev === Number(step.StepNumber) ? null : Number(step.StepNumber))
  }

  function statusStyle(code) {
    const s = (statuses || []).find(x => x.JobStatus === code)
    const fb = STEP_STATUS_FALLBACK[code] ?? { bg: 'rgba(156,163,175,.15)', color: '#9ca3af', border: 'rgba(156,163,175,.3)', text: code || '—' }
    const c = s?.color ?? fb
    return { ...c, text: s?.JobStatusText || fb.text }
  }

  // La suma de los recuentos de mensajes de un paso, juntando todos sus registros.
  function counts(n) {
    const recs = logInfos[n]?.records ?? []
    const sum = k => recs.reduce((s, r) => s + (Number(r[k]) || 0), 0)
    return { A: sum('MsgCntA'), E: sum('MsgCntE'), W: sum('MsgCntW'), I: sum('MsgCntI'), S: sum('MsgCntS'), all: sum('MsgCntAll') }
  }

  const jobSt = statusStyle(job.JobStatus)
  const failedCount = steps.filter(s => ['A', 'U'].includes(s.StepStatus)).length

  return (
    <>
      {!inline && <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', zIndex: 400 }} />}

      <div style={inline ? {
        display: 'flex', flexDirection: 'column', background: 'var(--bg2)',
      } : {
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(600px, 95vw)',
        background: 'var(--bg)', borderLeft: '1px solid var(--border2)',
        zIndex: 401, display: 'flex', flexDirection: 'column',
        boxShadow: 'var(--shadow-lg)', animation: 'stepsPanelSlide .2s ease-out',
      }}>

        {/* ── Cabecera del panel ── */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Pasos del job</div>
              <div style={{ fontSize: 11, color: 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {job.JobText || job.JobName}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 2 }}>
                {job.JobName} · Run {job.JobRunCount}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: jobSt.bg, color: jobSt.color, border: `1px solid ${jobSt.border}` }}>
                {jobSt.text}
              </span>
              {!inline && <button type="button" onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text2)', fontSize: 13, cursor: 'pointer', padding: '4px 10px', lineHeight: 1 }}>✕</button>}
            </div>
          </div>
          {!loading && steps.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', gap: 14, fontSize: 10, color: 'var(--text3)' }}>
              <span>{steps.length === 1 ? '1 paso' : `${steps.length} pasos`}</span>
              <span>{steps.filter(s => s.StepStatus === 'F').length} finalizados</span>
              {failedCount > 0 && <span style={{ color: '#ff6b6b', fontWeight: 700 }}>{failedCount === 1 ? '1 fallido' : `${failedCount} fallidos`}</span>}
            </div>
          )}
        </div>

        {/* ── Los pasos ── */}
        <div style={{ flex: 1, overflow: 'auto', padding: '14px 20px' }}>

          {loading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--text2)', fontSize: 12 }}>Cargando pasos…</div>}
          {error && <div style={{ background: 'rgba(255,107,107,.1)', border: '1px solid rgba(255,107,107,.3)', borderRadius: 8, padding: '12px 16px', color: 'var(--red)', fontSize: 12 }}>✕ {error}</div>}
          {!loading && !error && steps.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text2)', fontSize: 12 }}>Sin pasos registrados para este job.</div>
          )}

          {steps.map(step => {
            const n = Number(step.StepNumber)
            const isOpen = expanded === n
            const st = statusStyle(step.StepStatus)
            const rcErr = step.StepAppRC != null && Number(step.StepAppRC) !== 0
            const nrLogs = Number(step.NrOfLogs) || 0
            const li = logInfos[n]
            const cnt = counts(n)
            const dur = calcDuration(step, steps, job.JobEndDateTime)

            // El primer registro del paso (casi siempre hay uno solo)
            const liRec = li?.records?.[0]

            // Nombre del paso: el que le puso el usuario en IBP, o el tipo de paso; con P_OPNAME si lo hay
            const opName = params.data.find(p => String(p.StepNr) === String(step.StepNumber) && p.JobParameterName === 'P_OPNAME')?.Low
            const stepName = seqNames[n] ?? null
            const titleBase = stepName ?? step.JobCatalogEntryText ?? step.JobCatalogEntryName ?? `Paso ${n}`
            const stepTitle = opName ? `${titleBase}: ${opName}` : titleBase
            const showCatalogSubtitle = !!stepName

            return (
              <div key={n} style={{
                marginBottom: 8, borderRadius: 8, overflow: 'hidden',
                border: `1px solid ${isOpen ? 'var(--border2)' : 'var(--border)'}`,
                background: isOpen ? 'var(--bg2)' : 'transparent',
              }}>

                {/* ── Fila del paso ── */}
                <div onClick={() => toggleExpand(step)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer' }}>

                  {/* Número */}
                  <span style={{
                    width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                    background: 'var(--bg3)', border: '1px solid var(--border)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700, color: 'var(--text2)',
                  }}>{n}</span>

                  {/* Nombre e inicio */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {stepTitle}
                    </div>
                    {showCatalogSubtitle && (
                      <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {step.JobCatalogEntryText || step.JobCatalogEntryName}
                      </div>
                    )}
                    {step.StepStartDateTime && (
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>
                        Inicio: {formatSapTs(step.StepStartDateTime, tzMode)}
                      </div>
                    )}
                  </div>

                  {/* Estado */}
                  <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, flexShrink: 0, background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>
                    {st.text}
                  </span>

                  {/* Código de retorno con error */}
                  {rcErr && (
                    <span style={{ fontSize: 10, fontWeight: 700, flexShrink: 0, color: '#ff6b6b', background: 'rgba(255,107,107,.1)', border: '1px solid rgba(255,107,107,.3)', borderRadius: 4, padding: '2px 6px' }}>
                      RC {step.StepAppRC}
                    </span>
                  )}

                  {/* Duración */}
                  {dur && (
                    <span style={{ fontSize: 10, color: 'var(--text3)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px', flexShrink: 0 }}>
                      ⏱ {dur}
                    </span>
                  )}

                  {/* Recuento de mensajes por tipo (solo si ya llegó y hay registros) */}
                  {nrLogs > 0 && li && !li.loading && (
                    <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                      {(cnt.A + cnt.E) > 0 && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: '#ff6b6b', background: 'rgba(255,107,107,.12)', border: '1px solid rgba(255,107,107,.3)', borderRadius: 3, padding: '1px 5px' }}>
                          E {cnt.A + cnt.E}
                        </span>
                      )}
                      {cnt.W > 0 && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: '#fbbf24', background: 'rgba(251,191,36,.12)', border: '1px solid rgba(251,191,36,.3)', borderRadius: 3, padding: '1px 5px' }}>
                          W {cnt.W}
                        </span>
                      )}
                      {(cnt.A + cnt.E + cnt.W) === 0 && cnt.all > 0 && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: '#22c55e', background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.3)', borderRadius: 3, padding: '1px 5px' }}>
                          ✓ {cnt.all}
                        </span>
                      )}
                    </div>
                  )}
                  {nrLogs > 0 && li?.loading && (
                    <span style={{ fontSize: 9, color: 'var(--text3)' }}>…</span>
                  )}

                  <span style={{ color: 'var(--text3)', fontSize: 10, flexShrink: 0, marginLeft: 2 }}>{isOpen ? '▲' : '▼'}</span>
                </div>

                {/* ── Detalle desplegado ── */}
                {isOpen && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '14px 14px', background: 'var(--bg3)' }}>

                    {/* Los datos técnicos del paso */}
                    <div style={{ marginBottom: 14 }}>
                      <div style={SECTION_TITLE}>Detalle del paso</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px' }}>
                        <DetailRow label="Catálogo" value={<span style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>{step.JobCatalogEntryName || '—'}</span>} />
                        <DetailRow label="Return Code" value={
                          <span style={{ fontWeight: 700, color: rcErr ? '#ff6b6b' : '#22c55e' }}>{step.StepAppRC ?? '—'}</span>
                        } />
                        <DetailRow label="Inicio" value={formatSapTs(step.StepStartDateTime, tzMode)} />
                        {dur && <DetailRow label="Duración" value={dur} />}
                        <DetailRow label="Resultados" value={step.StepHasResults ? '✓ Sí' : '—'} />
                      </div>
                    </div>

                    {/* El registro del paso */}
                    {nrLogs > 0 && liRec && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={SECTION_TITLE}>Log de aplicación</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px', marginBottom: 10 }}>
                          <DetailRow label="Severidad" value={
                            (() => {
                              const sv = SEV_STYLE[liRec.Severity] ?? SEV_STYLE.I
                              return (
                                <span style={{ padding: '1px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700, background: sv.bg, color: sv.color, border: `1px solid ${sv.border}` }}>
                                  {liRec.SeverityText || liRec.Severity || '—'}
                                </span>
                              )
                            })()
                          } />
                          <DetailRow label="Completado" value={formatSapTs(liRec.CreaDateTime, tzMode)} />
                          <DetailRow label="Ejecutado por" value={liRec.CreaUserLong || liRec.CreaUser || '—'} />
                          <DetailRow label="Nº de log" value={<span style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>{liRec.LogNumber?.replace(/^0+/, '') || '—'}</span>} />
                        </div>
                        {/* Desglose de los recuentos por tipo */}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {[
                            { key: 'A', label: 'Abort', v: cnt.A, c: MSG_STYLE.A },
                            { key: 'E', label: 'Error', v: cnt.E, c: MSG_STYLE.E },
                            { key: 'W', label: 'Warning', v: cnt.W, c: MSG_STYLE.W },
                            { key: 'I', label: 'Info', v: cnt.I, c: MSG_STYLE.I },
                            { key: 'S', label: 'Success', v: cnt.S, c: MSG_STYLE.S },
                          ].map(({ key, label, v, c }) => (
                            <span key={key} style={{
                              fontSize: 10, fontWeight: 600,
                              color: v > 0 ? c.color : 'var(--text3)',
                              background: v > 0 ? c.bg : 'transparent',
                              border: `1px solid ${v > 0 ? c.color + '44' : 'var(--border)'}`,
                              borderRadius: 4, padding: '2px 7px',
                            }}>
                              {label}: {v}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Los parámetros del paso: plegables y por secciones */}
                    <ParamsSection
                      step={step}
                      params={params}
                      meta={templateMeta[step.JobCatalogEntryName] ?? metaRecibida(metaSinDatos())}
                      isPOpen={!!paramsExpanded[n]}
                      onToggle={() => setParamsExpanded(p => ({ ...p, [n]: !p[n] }))}
                    />

                    {/* Los mensajes */}
                    <div>
                      <div style={SECTION_TITLE}>
                        Mensajes {cnt.all > 0 ? `(${cnt.all})` : ''}
                      </div>

                      {nrLogs === 0 && <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>Sin mensajes de log.</div>}
                      {li?.loading && <div style={{ fontSize: 11, color: 'var(--text2)' }}>Cargando info de log…</div>}
                      {li?.error && <div style={{ fontSize: 11, color: 'var(--red)' }}>✕ {li.error}</div>}
                      {messages[n]?.loading && <div style={{ fontSize: 11, color: 'var(--text2)' }}>Cargando mensajes…</div>}
                      {messages[n]?.error && <div style={{ fontSize: 11, color: 'var(--red)' }}>✕ {messages[n].error}</div>}

                      {messages[n]?.data?.length === 0 && !messages[n]?.loading && !messages[n]?.error && nrLogs > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>Sin mensajes disponibles.</div>
                      )}

                      {messages[n]?.data?.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {messages[n].data.map((msg, mi) => {
                            const m = MSG_STYLE[msg.MsgType] ?? { label: msg.MsgType || '·', color: 'var(--text2)', bg: 'transparent' }
                            const text = msg.MsgText || [msg.MsgId, msg.MsgNo, msg.MsgV1, msg.MsgV2, msg.MsgV3, msg.MsgV4].filter(Boolean).join(' ')
                            const code = msg.MsgId && msg.MsgNo ? `${msg.MsgId}/${msg.MsgNo}` : null
                            return (
                              <div key={mi} style={{ display: 'flex', gap: 8, padding: '5px 8px', borderRadius: 4, background: m.bg, alignItems: 'flex-start' }}>
                                {/* Tipo */}
                                <span style={{ fontSize: 9, fontWeight: 700, flexShrink: 0, lineHeight: 1.4, marginTop: 1, color: m.color, background: `${m.color}22`, border: `1px solid ${m.color}44`, borderRadius: 3, padding: '1px 5px' }}>
                                  {m.label}
                                </span>
                                {/* Texto */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.5, wordBreak: 'break-word' }}>
                                    {text || '—'}
                                  </div>
                                  {code && (
                                    <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 2 }}>
                                      {code}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>

                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <style>{`
        @keyframes stepsPanelSlide {
          from { transform: translateX(40px); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </>
  )
}

/**
 * La sección «Parámetros» de un paso: plegable, filtrada y ordenada según su tipo de paso, y
 * repartida en las secciones de SAP IBP.
 */
function ParamsSection({ step, params, meta, isPOpen, onToggle }) {
  const rawSp = params.data.filter(p => String(p.StepNr) === String(step.StepNumber))
  const isAuthErr = params.error && (params.error.includes('APJ_RT/028') || params.error.includes('not authorized'))
  if (!params.loading && !params.error && rawSp.length === 0) return null

  // Sin los ocultos, solo si SAP describió este tipo de paso
  const sp = meta.hasData && meta.visibleParams
    ? rawSp.filter(p => meta.visibleParams.has(p.JobParameterName))
    : rawSp

  // En el orden de la plantilla
  const sorted = meta.paramOrder.length
    ? [...sp].sort((a, b) => {
      const ia = meta.paramOrder.indexOf(a.JobParameterName)
      const ib = meta.paramOrder.indexOf(b.JobParameterName)
      if (ia === -1 && ib === -1) return 0
      if (ia === -1) return 1
      if (ib === -1) return -1
      return ia - ib
    })
    : sp

  // Si SAP filtró y no quedó ninguno visible, no hay sección
  if (!params.loading && !params.error && !meta.loading && meta.hasData && sorted.length === 0) return null

  // Por secciones
  const secMap = meta.groupMap
  const grouped = {}
  const ungrouped = []
  sorted.forEach(p => {
    const sec = secMap[p.JobParameterName]
    if (sec) { if (!grouped[sec]) grouped[sec] = []; grouped[sec].push(p) }
    else ungrouped.push(p)
  })
  const orderedSecs = [
    ...ORDEN_DE_SECCIONES.filter(s => grouped[s]),
    ...Object.keys(grouped).filter(s => !ORDEN_DE_SECCIONES.includes(s)),
  ]
  if (ungrouped.length) orderedSecs.push(null) // null = sin sección

  return (
    <div style={{ marginBottom: 14, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
      {/* Cabecera plegable */}
      <div
        onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', cursor: 'pointer', background: isPOpen ? 'var(--surface-glass-soft)' : 'transparent', userSelect: 'none' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Parámetros</span>
          {(params.loading || meta.loading) && <span style={{ fontSize: 9, color: 'var(--text3)' }}>…</span>}
          {!params.loading && !meta.loading && !params.error && sorted.length > 0 && (
            <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--text3)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: '1px 6px' }}>
              {sorted.length}{meta.hasData && rawSp.length > sorted.length ? ` / ${rawSp.length}` : ''}
            </span>
          )}
          {params.error && !params.loading && (
            <span style={{ fontSize: 9, color: isAuthErr ? '#fbbf24' : '#ff6b6b' }}>{isAuthErr ? '⚠ sin acceso' : '✕ error'}</span>
          )}
        </div>
        <span style={{ fontSize: 10, color: 'var(--text3)' }}>{isPOpen ? '▲' : '▼'}</span>
      </div>

      {/* Contenido */}
      {isPOpen && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 10px' }}>
          {params.loading && <div style={{ fontSize: 11, color: 'var(--text2)' }}>Cargando…</div>}
          {params.error && isAuthErr && (
            <div style={{ fontSize: 11, color: '#fbbf24', lineHeight: 1.5 }}>
              ⚠ Sin acceso — se requiere el rol <code style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>SAP_BCG_APPLICATION_JOB_DISP</code> para leer parámetros de jobs de otros usuarios.
            </div>
          )}
          {params.error && !isAuthErr && <div style={{ fontSize: 11, color: 'var(--red)' }}>✕ {params.error}</div>}

          {sp.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {orderedSecs.map(sec => {
                const list = sec ? grouped[sec] : ungrouped
                if (!list?.length) return null
                return (
                  <div key={sec ?? '__ungrouped'}>
                    {/* Encabezado de sección */}
                    {sec && (
                      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid var(--border)' }}>
                        {sec}
                      </div>
                    )}
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <tbody>
                        {list.map((p, i) => {
                          const label = meta.labelMap?.[p.JobParameterName] ?? etiquetaDeParametroDePaso(p.JobParameterName)
                          const op = OPERADOR_DE_SELECCION[p.Option] ?? p.Option ?? '='
                          const isEq = !p.Option || p.Option === 'EQ'
                          const value = p.High && p.High !== p.Low
                            ? `${p.Low} → ${p.High}`
                            : (p.Low ?? '')
                          return (
                            <tr key={i} style={{ borderBottom: i < list.length - 1 ? '1px solid var(--border)' : 'none' }}>
                              <td style={{ padding: '4px 10px 4px 0', verticalAlign: 'top', width: '42%' }}>
                                <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 500 }}>{label}</span>
                              </td>
                              {!isEq && (
                                <td style={{ padding: '4px 8px 4px 0', fontSize: 11, color: 'var(--text3)', verticalAlign: 'top', whiteSpace: 'nowrap' }}>{op}</td>
                              )}
                              <td style={{ padding: '4px 0', fontSize: 11, color: value ? 'var(--text2)' : 'var(--text3)', fontStyle: value ? 'normal' : 'italic', fontFamily: 'var(--mono)', wordBreak: 'break-all', verticalAlign: 'top' }}>
                                {value || '—'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
