// El informe PDF de una migración de dato transaccional (key figures) terminada.
//
// Portado tal cual de `utils/kfReportPdf.js` de v8: las mismas secciones —resumen de la corrida,
// configuración, key figures migradas, resultados por key figure, tiempos por fase y mensajes de SAP
// por key figure—, el mismo pie «SAP IBP Control Tower» y el mismo nombre de archivo `migracion-kf_…`.
//
// `jspdf` y `jspdf-autotable` se cargan con un import DINÁMICO: son unos cientos de kilobytes y solo
// hacen falta cuando alguien pulsa «⬇ Exportar PDF».
//
// AVISO DE CARACTERES: la Helvetica que trae jsPDF solo cubre WinAnsi (cp1252). Los acentos y la ñ
// entran; las flechas y los símbolos (→ ← ≠ ∅ ∈ ✓ ⚠) NO. Por eso aquí se escribe `->` / `<-` en ASCII
// y los filtros se rehacen desde sus partes en vez de reutilizar las fichas de la pantalla.

import { nombreDelInforme } from '../../core/ibp/kf-migration-plan.js'

const M = 40                     // margen de página (pt; A4 = 595,28 × 841,89)
const PAGE_W = 595.28
const FOOT_Y = 820
const ACCENT = [235, 137, 8]     // el acento de la aplicación (naranja)
const STATUS_COLOR = {
  ok: [27, 142, 74], warning: [193, 132, 16], processing: [193, 132, 16],
  error: [198, 44, 44], cancelled: [110, 110, 110], skipped: [110, 110, 110],
}

const fmtDate = iso => (iso ? new Date(iso).toLocaleString() : '—')

// Dónde puede empezar el bloque siguiente (debajo de la última tabla).
const nextY = doc => (doc.lastAutoTable ? doc.lastAutoTable.finalY : M) + 18

function sectionTitle(doc, text) {
  let y = nextY(doc)
  if (y > 760) { doc.addPage(); y = M + 10 }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(40)
  doc.text(text, M, y)
  return y + 8
}

/** Arma el informe y devuelve el documento de jsPDF (aparte de la descarga, para poder probarlo). */
export async function buildKfReport({ snap, results, t, fmtDuration, statusLabel, phaseShort, timedPhases }) {
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  // Bloque de dos columnas clave / valor (sencillo, como los resúmenes de la pantalla).
  const kvTable = (doc, startY, rows, opts = {}) => autoTable(doc, {
    startY, margin: { left: M, right: M, bottom: 36 },
    theme: 'plain', body: rows,
    styles: { fontSize: 8.5, cellPadding: { top: 3, bottom: 3, left: 0, right: 8 }, textColor: [55, 55, 55], overflow: 'linebreak' },
    columnStyles: { 0: { cellWidth: 150, fontStyle: 'bold', textColor: [115, 115, 115] } },
    ...opts,
  })

  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const ver = v => v || t('pdf.verBase')
  const kfLbl = r => (r.srcKf && r.srcKf !== r.kf) ? `${r.srcKf} -> ${r.kf}` : r.kf

  // ── Cabecera ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(25)
  doc.text(t('pdf.title'), M, M + 4)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(130)
  doc.text(t('pdf.generated', { d: new Date().toLocaleString() }), M, M + 18)
  doc.setDrawColor(...ACCENT); doc.setLineWidth(1.2)
  doc.line(M, M + 26, PAGE_W - M, M + 26)

  // ── Resumen de la corrida ──
  kvTable(doc, M + 36, [
    [t('pdf.status'), statusLabel(snap.status)],
    [t('pdf.startedAt'), fmtDate(snap.startedAt)],
    [t('pdf.finishedAt'), fmtDate(snap.finishedAt)],
    [t('pdf.duration'), fmtDuration(snap.durationMs)],
    [t('pdf.totalRows'), (snap.totalRows || 0).toLocaleString()],
  ], {
    didParseCell: d => {
      if (d.row.index === 0 && d.column.index === 1) {
        d.cell.styles.textColor = STATUS_COLOR[snap.status] || [55, 55, 55]
        d.cell.styles.fontStyle = 'bold'
      }
    },
  })

  // ── Configuración ──
  let y = sectionTitle(doc, t('pdf.secConfig'))
  const remapped = (snap.attrSources || []).filter(a => a.src && a.src !== a.dst)
  const filterLines = []
  for (const c of (snap.conds || [])) {
    if (!c.field) continue
    if (c.op === 'nb') filterLines.push(`${c.field}: ${t('flt.opNb')}`)
    else if (c.op === 'sw' && c.value) filterLines.push(`${c.field} ${t('flt.opSw')} '${c.value}'`)
    else if (c.value) filterLines.push(`${c.field} ${t('flt.opIn')}: ${c.value}`)
  }
  if (snap.dateFrom || snap.dateTo) {
    filterLines.push(`${t('pdf.dateRange', { time: snap.timeLabel })}: ${snap.dateFrom || '...'} -> ${snap.dateTo || '...'}`)
  }
  const cfg = [
    [t('pdf.src'), `${snap.srcConn} — ${t('pdf.areaVer', { pa: snap.srcPa, v: ver(snap.srcVersion) })}`],
    [t('pdf.dst'), `${snap.dstConn} — ${t('pdf.areaVer', { pa: snap.dstPa, v: ver(snap.dstVersion) })}`],
    [t('pdf.txName'), snap.txName || '—'],
    [t('pdf.level'), [...(snap.levelAttrs || []), snap.timeLabel].join(' × ')],
    [t('pdf.attrSources'), remapped.length ? remapped.map(m => `${m.dst} <- ${m.src}`).join('     ') : t('pdf.sameNames')],
    [t('pdf.filters'), filterLines.length ? filterLines.join('\n') : t('pdf.none')],
  ]
  if (snap.filterStr) cfg.push([t('pdf.odataFilter'), snap.filterStr])
  if (snap.uom) cfg.push([t('pdf.uom'), snap.uom])
  if (snap.curr) cfg.push([t('pdf.curr'), snap.curr])
  kvTable(doc, y, cfg)

  // ── Key figures (en el orden de los pasos) ──
  y = sectionTitle(doc, t('pdf.secSteps', { n: (snap.steps || []).length }))
  autoTable(doc, {
    startY: y, margin: { left: M, right: M, bottom: 36 },
    head: [[t('pdf.colN'), t('pdf.colSrcKf'), t('pdf.colDstKf')]],
    body: (snap.steps || []).map((s, i) => [String(i + 1), s.src || '?', s.dst]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: ACCENT, textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 26, halign: 'right' } },
    theme: 'striped',
  })

  // ── Resultados por key figure ──
  y = sectionTitle(doc, t('pdf.secResults'))
  autoTable(doc, {
    startY: y, margin: { left: M, right: M, bottom: 36 },
    head: [[t('kfm.colKf'), t('kfm.colStatus'), t('kfm.colTotal'), t('kfm.colErrors'), t('mig.colTime'), t('kfm.colTx')]],
    body: results.map(r => [
      kfLbl(r), statusLabel(r.status), (r.total || 0).toLocaleString(),
      `${r.errors || 0}${r.errorMsg ? `\n${String(r.errorMsg).slice(0, 220)}` : ''}`,
      fmtDuration(r.durationMs), r.txId || '—',
    ]),
    styles: { fontSize: 7.5, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [60, 60, 60], textColor: 255 },
    columnStyles: { 0: { cellWidth: 145 }, 2: { halign: 'right', cellWidth: 52 }, 3: { cellWidth: 105 }, 5: { cellWidth: 92, fontSize: 6.3 } },
    didParseCell: d => {
      if (d.section === 'body' && d.column.index === 1) {
        d.cell.styles.textColor = STATUS_COLOR[results[d.row.index]?.status] || [55, 55, 55]
        d.cell.styles.fontStyle = 'bold'
      }
    },
    theme: 'striped',
  })

  // ── Tiempos por fase (fila de totales + una por key figure) ──
  y = sectionTitle(doc, t('pdf.secTimes'))
  const seen = new Set(); const totals = {}
  let slowest = null
  for (const r of results) {
    const k = r.txId || r.kf
    if (seen.has(k)) continue
    seen.add(k)
    Object.entries(r.phaseTimes || {}).forEach(([p, ms]) => { totals[p] = (totals[p] || 0) + ms })
    if ((r.durationMs || 0) > (slowest?.durationMs || 0)) slowest = r
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(70)
  doc.text(
    t('mig.summaryTotal', { dur: fmtDuration(snap.durationMs) }) + (slowest ? `   ·   ${t('mig.summarySlowest', { name: slowest.kf, dur: fmtDuration(slowest.durationMs) })}` : ''),
    M, y + 4,
  )
  autoTable(doc, {
    startY: y + 12, margin: { left: M, right: M, bottom: 36 },
    head: [['', ...timedPhases.map(p => phaseShort[p] || p)]],
    body: [
      [t('pdf.rowTotals'), ...timedPhases.map(p => totals[p] ? fmtDuration(totals[p]) : '—')],
      ...results.map(r => [kfLbl(r), ...timedPhases.map(p => r.phaseTimes?.[p] ? fmtDuration(r.phaseTimes[p]) : '—')]),
    ],
    styles: { fontSize: 7.5, cellPadding: 3 },
    headStyles: { fillColor: [60, 60, 60], textColor: 255 },
    columnStyles: { 0: { cellWidth: 145 } },
    didParseCell: d => { if (d.section === 'body' && d.row.index === 0) d.cell.styles.fontStyle = 'bold' },
    theme: 'striped',
  })
  doc.setFontSize(7); doc.setTextColor(140)
  doc.text(t('pdf.timesNote'), M, nextY(doc) - 8, { maxWidth: PAGE_W - 2 * M })

  // ── Mensajes de SAP (solo las key figures que tuvieron) ──
  const withMsgs = results.filter(r => (r.messages || []).length > 0)
  if (withMsgs.length > 0) {
    let y2 = sectionTitle(doc, t('pdf.secMessages'))
    for (const r of withMsgs) {
      if (y2 > 740) { doc.addPage(); y2 = M + 10 }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(60)
      doc.text(t('pdf.msgsOf', { kf: r.kf, n: r.messages.length }), M, y2)
      const msgs = r.messages.slice(0, 30)
      autoTable(doc, {
        startY: y2 + 6, margin: { left: M, right: M, bottom: 36 },
        head: [['ID', t('pdf.colMsg')]],
        body: [
          ...msgs.map(m => [String(m.ExceptionId || m.MessageId || ''), String(m.MsgText || m.Text || '').slice(0, 400)]),
          ...(r.messages.length > 30 ? [['', t('pdf.more', { n: r.messages.length - 30 })]] : []),
        ],
        styles: { fontSize: 7, cellPadding: 3, overflow: 'linebreak' },
        headStyles: { fillColor: [198, 44, 44], textColor: 255 },
        columnStyles: { 0: { cellWidth: 60 } },
        theme: 'striped',
      })
      y2 = nextY(doc)
    }
  }

  // ── Pie en cada página ──
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(150)
    doc.text('SAP IBP Control Tower', M, FOOT_Y)
    doc.text(t('pdf.page', { a: i, b: pages }), PAGE_W - M, FOOT_Y, { align: 'right' })
  }
  return doc
}

/** Arma el informe Y lo descarga. Devuelve el nombre del archivo. */
export async function downloadKfReport(args) {
  const doc = await buildKfReport(args)
  const name = nombreDelInforme(args.snap.dstConn, args.snap.finishedAt ? new Date(args.snap.finishedAt) : new Date())
  doc.save(name)
  return name
}
