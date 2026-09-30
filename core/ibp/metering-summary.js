// Las cuentas de la pestaña «Telemetría» de v8, tal cual las hacía `Metering.jsx`.
//
// v8 las hacía dentro de cada pestaña, en el render. Aquí están aparte para poder probarlas, pero son
// las mismas: los mismos campos, los mismos conteos, los mismos cortes (los 10 primeros, los 15, los
// 20) y los mismos respaldos cuando un campo viene vacío. Las usa la pantalla sobre las filas que
// devuelve el servidor (`core/ibp/metering.js`), así que cambiar de usuario o de área es instantáneo,
// como en v8.
//
// Sin dependencias fuera de `metering-rows.js`, que tampoco tiene: lo importa el navegador.

import { dayKey } from './metering-rows.js'

export { dayKey }

/** SAP mete la actividad del complemento de Excel entre las aplicaciones Fiori, con este prefijo. */
export const EXCEL_ADDIN_PREFIX = 'tl.ibp.excel.addin.'

// ─── Las ayudas de v8 ────────────────────────────────────────────────────────────

export function groupBy(arr, keyFn) {
  const fn = typeof keyFn === 'string' ? (r => r[keyFn] ?? '?') : keyFn
  return arr.reduce((acc, row) => {
    const k = fn(row)
    ;(acc[k] = acc[k] || []).push(row)
    return acc
  }, {})
}

export function sumField(arr, key) {
  return arr.reduce((a, r) => a + (Number(r[key]) || 0), 0)
}

export function avgField(arr, key) {
  return arr.length ? sumField(arr, key) / arr.length : 0
}

/** Los segundos de una duración: el complemento de Excel las manda en milisegundos. */
export function toSecs(val, unit = '') {
  const n = Number(val) || 0
  const u = (unit || '').toLowerCase()
  return u.includes('ms') ? n / 1000 : n
}

/** «<1s», «23.4s», «5m 12s». */
export function formatDuration(val, unit = '') {
  const s = toSecs(val, unit)
  if (s < 1) return '<1s'
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60), r = Math.round(s % 60)
  return `${m}m ${r}s`
}

export function uniqueUsers(arr) {
  return new Set(arr.map(r => r.UserID).filter(Boolean)).size
}

/**
 * La ventana de cada botón de período: «Hoy» es de 00:00 a 23:59:59 de hoy; los demás, desde la
 * medianoche de hace N días hasta ahora. En la hora del navegador, como en v8.
 */
export function presetDates(id, now = new Date()) {
  const start = new Date(now)
  if (id === 'today') {
    start.setHours(0, 0, 0, 0)
    const end = new Date(now); end.setHours(23, 59, 59, 999)
    return [start, end]
  }
  const days = id === '7d' ? 7 : id === '30d' ? 30 : 90
  start.setDate(start.getDate() - days); start.setHours(0, 0, 0, 0)
  return [start, new Date(now)]
}

/** Las aplicaciones Fiori sin la actividad del complemento de Excel, que va aparte. */
export function otherFioriApps(fiori) {
  return fiori.filter(r => !r.FioriProjectID?.startsWith(EXCEL_ADDIN_PREFIX))
}

// ─── Lo común a las tres pestañas ────────────────────────────────────────────────

/** El nombre de cada usuario: `FullName`, si no nombre y apellido, si no su identificador. */
export function buildUserMap(users) {
  return Object.fromEntries(
    (users ?? []).map(u => [u.UserID, u.FullName || [u.FirstName, u.LastName].filter(Boolean).join(' ') || u.UserID]),
  )
}

export function buildComponentMap(components) {
  return Object.fromEntries((components ?? []).map(c => [c.MeteringComponent, c.MeteringComponentText]).filter(([k]) => k))
}

/** Las áreas que se pueden elegir como contexto: las que aparecen en la actividad del período. */
export function listPlanningAreas(data) {
  if (!data) return []
  const all = [...data.overview, ...data.planningViews, ...data.fiori, ...data.dashboards]
  return [...new Set(all.map(r => r.PlanningAreaID).filter(Boolean))].sort()
}

/**
 * Los datos vistos desde un usuario o un área. Los catálogos (usuarios y componentes) no se filtran.
 * Un conjunto que no tiene `PlanningAreaID` queda vacío al mirar un área, como en v8.
 */
export function filterByContext(data, contextMode, contextValue) {
  if (!data || contextMode === 'all') return data
  const filterFn = contextMode === 'user'
    ? r => r.UserID === contextValue
    : r => r.PlanningAreaID === contextValue
  return {
    ...data,
    overview:      data.overview.filter(filterFn),
    planningViews: data.planningViews.filter(filterFn),
    logons:        data.logons.filter(filterFn),
    fiori:         data.fiori.filter(filterFn),
    dashboards:    data.dashboards.filter(filterFn),
    stories:       data.stories.filter(filterFn),
    alerts:        data.alerts.filter(filterFn),
    chgKeyFig:     data.chgKeyFig.filter(filterFn),
    users:         data.users,
    components:    data.components,
  }
}

/** La tasa de éxito de las vistas de Excel, o `null` si no hubo ninguna. */
function excelSuccessRate(planningViews) {
  return planningViews.length
    ? Math.round(planningViews.filter(r => r.SuccessfullyCompleted).length / planningViews.length * 100)
    : null
}

// ─── Visión General ───────────────────────────────────────────────────────────

export function generalView({ overview, planningViews, fiori, dashboards, stories, alerts, users, userMap, componentMap }) {
  const activeUserIds = new Set(overview.map(r => r.UserID).filter(Boolean))

  const dauByDay = {}
  overview.forEach(row => {
    const d = dayKey(row.TimestampStart)
    if (!dauByDay[d]) dauByDay[d] = new Set()
    if (row.UserID) dauByDay[d].add(row.UserID)
  })
  const dauData = Object.entries(dauByDay)
    .map(([day, s]) => ({ day, users: s.size }))
    .sort((a, b) => a.day.localeCompare(b.day))

  const compByDay = {}
  overview.forEach(row => {
    const d = dayKey(row.TimestampStart)
    if (!compByDay[d]) compByDay[d] = {}
    const comp = componentMap[row.MeteringComponent] || row.MeteringComponent
    if (!comp) return
    compByDay[d][comp] = (compByDay[d][comp] || 0) + (Number(row.NumberOfActions) || 1)
  })
  const componentChartData = Object.entries(compByDay)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, comps]) => ({ day, ...comps }))

  const names = new Set()
  componentChartData.forEach(d => Object.keys(d).forEach(k => { if (k !== 'day') names.add(k) }))
  const componentNames = [...names]

  const fioriByApp = groupBy(otherFioriApps(fiori), r => r.FioriProjectTitle || r.FioriProjectID)
  const featureRows = []
  if (planningViews.length)
    featureRows.push({ name: 'Excel Add-In', users: uniqueUsers(planningViews), sessions: planningViews.length })
  Object.entries(fioriByApp).forEach(([name, rs]) =>
    featureRows.push({ name, users: uniqueUsers(rs), sessions: rs.length }))
  if (dashboards.length)
    featureRows.push({ name: 'Dashboards', users: uniqueUsers(dashboards), sessions: dashboards.length })
  if (stories.length)
    featureRows.push({ name: 'Analytics Stories', users: uniqueUsers(stories), sessions: stories.length })
  if (alerts.length)
    featureRows.push({ name: 'Alert Monitor', users: uniqueUsers(alerts), sessions: alerts.length })
  featureRows.sort((a, b) => b.users - a.users)

  const topActiveUsers = Object.entries(groupBy(overview, 'UserID'))
    .filter(([uid]) => uid && uid !== '?')
    .map(([uid, rows]) => {
      const last = rows.map(r => r.TimestampStart).filter(Boolean).sort().reverse()[0]
      const pas  = [...new Set(rows.map(r => r.PlanningAreaID).filter(Boolean))]
      return { uid, name: userMap[uid] || uid, acts: rows.length, last: last ? last.slice(0, 10) : '—', pas: pas.slice(0, 3).join(', ') || '—' }
    })
    .sort((a, b) => b.acts - a.acts)
    .slice(0, 15)

  // Ordenados por ID; la búsqueda se aplica aparte (`filterInactiveUsers`).
  const inactiveUsers = users
    .filter(u => u.UserID && !activeUserIds.has(u.UserID))
    .map(u => ({ uid: u.UserID, name: userMap[u.UserID] || [u.FirstName, u.LastName].filter(Boolean).join(' ') || u.UserID }))
    .sort((a, b) => a.uid.localeCompare(b.uid))

  // Lo que merece una mirada: licencias sin uso y áreas donde Excel falla más del 30 % (con 5
  // operaciones o más). El texto lo pone la pantalla.
  const attention = []
  const ic = users.filter(u => u.UserID && !activeUserIds.has(u.UserID)).length
  if (ic > 0) attention.push({ type: 'warn', n: ic })
  Object.entries(groupBy(planningViews.filter(r => r.PlanningAreaID), 'PlanningAreaID')).forEach(([pa, rows]) => {
    const errRate = rows.filter(r => !r.SuccessfullyCompleted).length / rows.length * 100
    if (errRate > 30 && rows.length >= 5) attention.push({ type: 'error', pa, rate: Math.round(errRate), count: rows.length })
  })

  const totalLicensed = users.length
  const totalActive   = activeUserIds.size
  const adoptionRate  = totalLicensed > 0 ? Math.round(totalActive / totalLicensed * 100) : 0

  return {
    dauData, componentChartData, componentNames, featureRows, topActiveUsers, inactiveUsers, attention,
    totalLicensed,
    totalActive,
    adoptionRate,
    uniquePAs:     new Set(overview.map(r => r.PlanningAreaID).filter(Boolean)).size,
    inactiveCount: totalLicensed - totalActive,
  }
}

/** El buscador de «Sin actividad en el período»: por ID o por nombre. */
export function filterInactiveUsers(inactiveUsers, search) {
  const q = String(search ?? '').toLowerCase()
  return inactiveUsers.filter(u => !q || u.uid.toLowerCase().includes(q) || u.name.toLowerCase().includes(q))
}

// ─── Perfil de un usuario ────────────────────────────────────────────────────────

export function userProfileView({ uid, overview, planningViews, logons, fiori, dashboards, stories, alerts, userMap }) {
  const name = userMap[uid] || uid

  const byDay = {}
  overview.forEach(r => {
    const d = dayKey(r.TimestampStart)
    byDay[d] = (byDay[d] || 0) + 1
  })
  const actByDay = Object.entries(byDay).map(([day, n]) => ({ day, windows: n })).sort((a, b) => a.day.localeCompare(b.day))

  const uniquePAs = [...new Set(overview.map(r => r.PlanningAreaID).filter(Boolean))].sort()

  const toolsUsed = []
  if (planningViews.length) toolsUsed.push({ name: 'Excel Add-In', count: planningViews.length })
  Object.entries(groupBy(otherFioriApps(fiori), r => r.FioriProjectTitle || r.FioriProjectID))
    .forEach(([n, rs]) => toolsUsed.push({ name: n, count: rs.length }))
  if (dashboards.length) toolsUsed.push({ name: 'Dashboards', count: dashboards.length })
  if (stories.length)    toolsUsed.push({ name: 'Analytics Stories', count: stories.length })
  if (alerts.length)     toolsUsed.push({ name: 'Alert Monitor', count: alerts.length })
  if (logons.length)     toolsUsed.push({ name: 'Logon Excel', count: logons.length })
  toolsUsed.sort((a, b) => b.count - a.count)

  const dates = overview.map(r => r.TimestampStart).filter(Boolean).sort()

  return {
    name,
    actByDay,
    uniquePAs,
    toolsUsed,
    firstSeen: dates[0]?.slice(0, 10) || '—',
    lastSeen:  dates.slice(-1)[0]?.slice(0, 10) || '—',
    unit:      planningViews[0]?.DurationUnit || 's',
    excelRate: excelSuccessRate(planningViews),
    avgDur:    avgField(planningViews, 'TotalDuration'),
  }
}

// ─── Perfil de un área ───────────────────────────────────────────────────────────

export function paProfileView({ overview, planningViews, fiori, dashboards, userMap }) {
  // Aquí v8 cuenta TODA la actividad Fiori, también la del complemento de Excel.
  const combined = [...overview, ...planningViews, ...fiori, ...dashboards]
  const activeUsers = [...new Set(combined.map(r => r.UserID).filter(Boolean))]

  const topUsers = Object.entries(groupBy(combined, 'UserID'))
    .filter(([uid]) => uid && uid !== '?')
    .map(([uid, rows]) => ({ uid, name: userMap[uid] || uid, acts: rows.length }))
    .sort((a, b) => b.acts - a.acts)
    .slice(0, 15)

  const excelByDay = Object.entries(groupBy(planningViews, r => dayKey(r.Timestamp || r.TimestampStart)))
    .map(([day, rows]) => {
      const ok = rows.filter(r => r.SuccessfullyCompleted).length
      return { day, ops: rows.length, successPct: Math.round(ok / rows.length * 100) }
    })
    .sort((a, b) => a.day.localeCompare(b.day))

  return {
    activeUsers,
    topUsers,
    excelByDay,
    unit:      planningViews[0]?.DurationUnit || 's',
    excelRate: excelSuccessRate(planningViews),
    avgDur:    avgField(planningViews, 'TotalDuration'),
  }
}

// ─── Excel Add-In ─────────────────────────────────────────────────────────────

export function excelView({ planningViews, logons, chgKeyFig }) {
  const total   = planningViews.length
  const success = planningViews.filter(r => r.SuccessfullyCompleted).length
  const unit    = planningViews[0]?.DurationUnit || 's'

  const actTypeData = !total ? [] : Object.entries(groupBy(planningViews, 'ActivityType'))
    .map(([type, rows]) => ({
      tipo: type.replace(/^XLS_/, '').replace(/_/g, ' '),
      count: rows.length,
      pct: Math.round(rows.length / total * 100),
    }))
    .sort((a, b) => b.count - a.count)

  const trendData = Object.entries(groupBy(planningViews, r => dayKey(r.Timestamp || r.TimestampStart)))
    .map(([day, rows]) => {
      const ok  = rows.filter(r => r.SuccessfullyCompleted).length
      const avg = toSecs(avgField(rows, 'TotalDuration'), unit)
      return { day, successPct: Math.round(ok / rows.length * 100), durationS: parseFloat(avg.toFixed(1)) }
    })
    .sort((a, b) => a.day.localeCompare(b.day))

  const paPerf = Object.entries(groupBy(planningViews.filter(r => r.PlanningAreaID), 'PlanningAreaID'))
    .map(([pa, rows]) => {
      const ok = rows.filter(r => r.SuccessfullyCompleted).length
      return { pa, total: rows.length, rate: Math.round(ok / rows.length * 100), avgDur: parseFloat(toSecs(avgField(rows, 'TotalDuration'), unit).toFixed(1)) }
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)

  // «Usuario» en esta tabla son los usuarios DISTINTOS que tocaron la cifra.
  const topChgKF = Object.entries(groupBy(chgKeyFig, 'KeyFigureID'))
    .map(([kf, rows]) => ({
      kf,
      cambios: sumField(rows, 'KeyFigureCount') || rows.length,
      usuarios: uniqueUsers(rows),
    }))
    .sort((a, b) => b.cambios - a.cambios)
    .slice(0, 15)

  return {
    total,
    success,
    failed:      total - success,
    rate:        total ? Math.round(success / total * 100) : 0,
    unit,
    avgDur:      avgField(planningViews, 'TotalDuration'),
    cells:       sumField(planningViews, 'PlanningViewCells'),
    logonUnit:   logons[0]?.DurationUnit || 's',
    avgLogonDur: avgField(logons, 'TotalDuration'),
    actTypeData,
    trendData,
    paPerf,
    topChgKF,
    slowRows: [...planningViews].sort((a, b) => Number(b.TotalDuration) - Number(a.TotalDuration)).slice(0, 20),
    // En el orden en que llegan, que es de la más lenta a la más rápida (`TotalDuration desc`).
    failRows: planningViews.filter(r => !r.SuccessfullyCompleted).slice(0, 20),
  }
}

/** El nombre de la plantilla de una vista de Excel, con los respaldos de v8. */
export function templateName(r) {
  return r.TemplateName || r.FavoriteName || r.WorksheetName || '—'
}

// ─── Herramientas ─────────────────────────────────────────────────────────────

export function appsView({ fiori, dashboards, stories, alerts, userMap }) {
  const fioriOtros = otherFioriApps(fiori)

  const fioriApps = Object.entries(groupBy(fioriOtros, r => r.FioriProjectTitle || r.FioriProjectID))
    .map(([name, rows]) => ({ name, usuarios: uniqueUsers(rows), usos: rows.length }))
    .sort((a, b) => b.usos - a.usos)

  const dashPorUsuario = Object.entries(groupBy(dashboards, 'UserID'))
    .map(([uid, rows]) => {
      const pas = [...new Set(rows.map(r => r.PlanningAreaID).filter(Boolean))]
      return { usuario: userMap[uid] || uid, pa: pas.slice(0, 3).join(', ') || '—', sesiones: rows.length }
    })
    .sort((a, b) => b.sesiones - a.sesiones)
    .slice(0, 15)

  const alertPorUsuario = Object.entries(groupBy(alerts, 'UserID'))
    .map(([uid, rows]) => {
      const last = rows.map(r => r.Timestamp).filter(Boolean).sort().reverse()[0]
      return { usuario: userMap[uid] || uid, aperturas: rows.length, ultima: last ? last.slice(0, 10) : '—' }
    })
    .sort((a, b) => b.aperturas - a.aperturas)
    .slice(0, 15)

  const storyRows = Object.entries(groupBy(stories, r => r.StoryName || r.StoryID || '?'))
    .map(([name, rows]) => ({ name, usuarios: uniqueUsers(rows), vistas: rows.length }))
    .sort((a, b) => b.vistas - a.vistas)
    .slice(0, 10)

  return {
    fioriApps, dashPorUsuario, alertPorUsuario, storyRows,
    noData: !fioriOtros.length && !dashboards.length && !alerts.length && !stories.length,
  }
}
