// Las primitivas con las que se arma la hoja «Estadísticas» de los analizadores de v7.
//
// Portadas de `statsSheet.js` de v7 (`banner`, `header`, `row`, `table`, `renderFrequency`,
// `renderCrosstab`, `renderExtraFields`…), donde eran funciones de módulo que escribían sobre una hoja
// de `StreamingXlsx`. Aquí reciben la hoja del informe (`crearHojaLibre`, de `analisis-hojas.js`) y son
// las MISMAS para el Production Analyzer y el Network Analyzer: la hoja de cada uno cambia en qué
// cuenta, no en cómo lo dibuja.
//
// Sin dependencias del navegador.

import { COLORES } from './analisis-hojas.js'

const FILL_GRAY = COLORES.NA_FILL

/** Un valor de SAP como texto limpio (`str` de `utils.js`). */
const str = (v) => (v === null || v === undefined ? '' : String(v).trim())

/**
 * Las primitivas de dibujo y de cuenta sobre una hoja Estadísticas.
 *
 * `extras` son los campos adicionales del paso ④ por entidad (`{ product: ['CAMPO'], … }`): los cruces
 * del final de la hoja salen de ellos.
 */
export function primitivasDeEstadisticas(ws, extras = {}) {
  const blank = () => ws.agregar([])
  const title = (text) => ws.agregar([text])
  const row = (cells, argb) => ws.agregar(cells, argb || null)
  const banner = (text) => ws.agregar([text], FILL_GRAY)
  const header = (cells) => ws.agregar(cells, FILL_GRAY)
  const table = (opts) => {
    if (opts.banner) banner(opts.banner)
    if (opts.headers) header(opts.headers)
    ;(opts.rows || []).forEach((rw) => { row(rw, rw && rw._fill) })
    blank()
  }
  const pctStr = (n, total) => `${total > 0 ? Math.round((n / total) * 100) : 0}%`
  const nkeys = (o) => (o ? Object.keys(o).length : 0)
  const avg1 = (sum, n) => (n > 0 ? Math.round((sum / n) * 10) / 10 : 0)
  const objVals = (o) => Object.keys(o || {}).map((k) => o[k])
  const grayTotal = (arr) => { arr._fill = FILL_GRAY; return arr }

  const valueCounts = (recs, field) => {
    const out = {}
    recs.forEach((r) => {
      let v = str(r && r[field] != null ? r[field] : '')
      if (v === '') v = '(vacío)'
      out[v] = (out[v] || 0) + 1
    })
    return out
  }

  const renderFrequency = (recs, field, maxRows) => {
    const counts = valueCounts(recs, field)
    const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a])
    const total = recs.length
    banner(`Distribución de ${field}`)
    header([field, 'Registros', '% del total'])
    keys.slice(0, maxRows).forEach((k) => { row([k, counts[k], pctStr(counts[k], total)]) })
    if (keys.length > maxRows) {
      let restN = 0
      keys.slice(maxRows).forEach((k) => { restN += counts[k] })
      row([`Otros (${keys.length - maxRows})`, restN, pctStr(restN, total)])
    }
    blank()
  }

  const renderCrosstab = (recs, dimFn, dimLabel, field, maxRows = 30, maxCols = 15) => {
    const fieldTot = {}; const dimTot = {}; const cell = {}
    recs.forEach((r) => {
      let fv = str(r && r[field] != null ? r[field] : ''); if (fv === '') fv = '(vacío)'
      const dv = dimFn(r)
      fieldTot[fv] = (fieldTot[fv] || 0) + 1
      dimTot[dv] = (dimTot[dv] || 0) + 1
      const k = `${fv}\u0001${dv}`
      cell[k] = (cell[k] || 0) + 1
    })

    const dimKeys = Object.keys(dimTot).sort((a, b) => dimTot[b] - dimTot[a])
    const dimShown = dimKeys.slice(0, maxCols); const dimRest = dimKeys.slice(maxCols)
    const hasDimRest = dimRest.length > 0
    const fieldKeys = Object.keys(fieldTot).sort((a, b) => fieldTot[b] - fieldTot[a])
    const fieldShown = fieldKeys.slice(0, maxRows); const fieldRest = fieldKeys.slice(maxRows)
    const hasFieldRest = fieldRest.length > 0

    const cnt = (fv, dv) => cell[`${fv}\u0001${dv}`] || 0

    banner(`${field} × ${dimLabel}`)
    const hdr = [field].concat(dimShown)
    if (hasDimRest) hdr.push('Otros')
    hdr.push('Total')
    header(hdr)

    const colTot = {}; let otrosCol = 0; let grand = 0
    dimShown.forEach((dv) => { colTot[dv] = 0 })

    const emitRow = (label, fvs) => {
      const arr = [label]; let rt = 0
      dimShown.forEach((dv) => {
        let c = 0; fvs.forEach((fv) => { c += cnt(fv, dv) })
        arr.push(c); colTot[dv] += c; rt += c
      })
      if (hasDimRest) {
        let co = 0; fvs.forEach((fv) => { dimRest.forEach((dv) => { co += cnt(fv, dv) }) })
        arr.push(co); otrosCol += co; rt += co
      }
      arr.push(rt); grand += rt
      row(arr)
    }

    fieldShown.forEach((fv) => { emitRow(fv, [fv]) })
    if (hasFieldRest) emitRow(`Otros (${fieldRest.length})`, fieldRest)

    const totArr = ['Total']
    dimShown.forEach((dv) => { totArr.push(colTot[dv]) })
    if (hasDimRest) totArr.push(otrosCol)
    totArr.push(grand)
    row(totArr, FILL_GRAY)
    blank()
  }

  const renderExtraFields = (entity, recs, dimFn, dimLabel) => {
    const extra = extras[entity] ?? []
    if (!extra.length) return 0
    extra.forEach((f) => {
      if (dimFn) renderCrosstab(recs, dimFn, dimLabel, f)
      else renderFrequency(recs, f, 25)
    })
    return extra.length
  }

  return {
    blank, title, row, banner, header, table, pctStr, nkeys, avg1, objVals, grayTotal,
    renderFrequency, renderCrosstab, renderExtraFields,
  }
}
