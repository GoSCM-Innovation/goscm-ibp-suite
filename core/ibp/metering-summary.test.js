import { describe, it, expect } from 'vitest'

import {
  appsView, buildComponentMap, buildUserMap, excelView, filterByContext, filterInactiveUsers,
  formatDuration, generalView, groupBy, listPlanningAreas, paProfileView, presetDates, templateName,
  toSecs, userProfileView,
} from './metering-summary.js'

const vacio = { overview: [], planningViews: [], logons: [], fiori: [], dashboards: [], stories: [], alerts: [], chgKeyFig: [], users: [], components: [] }

describe('las ayudas de v8', () => {
  it('formatDuration escribe como v8', () => {
    expect(formatDuration(0.4)).toBe('<1s')
    expect(formatDuration(23.44)).toBe('23.4s')
    expect(formatDuration(312)).toBe('5m 12s')
  })

  // El complemento de Excel manda milisegundos: sin mirar la unidad, 23 s serían seis horas.
  it('toSecs mira la unidad', () => {
    expect(toSecs(23400, 'MS')).toBe(23.4)
    expect(toSecs(23, 's')).toBe(23)
    expect(formatDuration(23400, 'ms')).toBe('23.4s')
  })

  it('groupBy manda lo vacío a «?»', () => {
    expect(Object.keys(groupBy([{ a: 'x' }, { a: null }], 'a'))).toEqual(['x', '?'])
  })

  it('templateName usa los respaldos de v8', () => {
    expect(templateName({ TemplateName: 'T' })).toBe('T')
    expect(templateName({ FavoriteName: 'F', WorksheetName: 'W' })).toBe('F')
    expect(templateName({ WorksheetName: 'W' })).toBe('W')
    expect(templateName({})).toBe('—')
  })
})

describe('presetDates', () => {
  const ahora = new Date(2026, 8, 30, 15, 20, 0)

  it('«Hoy» va de 00:00 a 23:59:59 de hoy', () => {
    const [s, e] = presetDates('today', ahora)
    expect([s.getHours(), s.getMinutes()]).toEqual([0, 0])
    expect([e.getDate(), e.getHours(), e.getMinutes(), e.getSeconds()]).toEqual([30, 23, 59, 59])
  })

  it('«7 días» va desde la medianoche de hace siete días hasta ahora', () => {
    const [s, e] = presetDates('7d', ahora)
    expect([s.getMonth(), s.getDate(), s.getHours()]).toEqual([8, 23, 0])
    expect(e.getTime()).toBe(ahora.getTime())
  })

  it('«90 días» cruza meses', () => {
    const [s] = presetDates('90d', ahora)
    expect([s.getMonth(), s.getDate()]).toEqual([6, 2])
  })
})

describe('lo común', () => {
  it('el nombre de un usuario: FullName, nombre y apellido, o su ID', () => {
    expect(buildUserMap([
      { UserID: 'U1', FullName: 'Ana Pérez' },
      { UserID: 'U2', FirstName: 'Luis', LastName: 'Soto' },
      { UserID: 'U3' },
    ])).toEqual({ U1: 'Ana Pérez', U2: 'Luis Soto', U3: 'U3' })
  })

  it('los componentes sin código no entran', () => {
    expect(buildComponentMap([{ MeteringComponent: 'C1', MeteringComponentText: 'Uno' }, { MeteringComponent: '' }])).toEqual({ C1: 'Uno' })
  })

  it('las áreas del contexto salen de sesiones, Excel, Fiori y tableros, ordenadas', () => {
    expect(listPlanningAreas({
      ...vacio,
      overview: [{ PlanningAreaID: 'B' }],
      planningViews: [{ PlanningAreaID: 'A' }],
      fiori: [{ PlanningAreaID: 'B' }],
      dashboards: [{ PlanningAreaID: null }],
      alerts: [{ PlanningAreaID: 'Z' }],
    })).toEqual(['A', 'B'])
  })

  it('el contexto filtra la actividad pero no los catálogos', () => {
    const data = { ...vacio, overview: [{ UserID: 'U1' }, { UserID: 'U2' }], users: [{ UserID: 'U1' }, { UserID: 'U2' }] }
    const vista = filterByContext(data, 'user', 'U1')
    expect(vista.overview).toEqual([{ UserID: 'U1' }])
    expect(vista.users).toHaveLength(2)
    expect(filterByContext(data, 'all', '')).toBe(data)
  })

  // Como en v8: un conjunto sin área queda vacío al mirar un área.
  it('mirar un área deja fuera lo que no tiene área', () => {
    const vista = filterByContext({ ...vacio, logons: [{ UserID: 'U1' }] }, 'pa', 'A1')
    expect(vista.logons).toEqual([])
  })
})

describe('generalView', () => {
  const users = [{ UserID: 'U1', FullName: 'Ana' }, { UserID: 'U2' }, { UserID: 'U3', FirstName: 'Luis', LastName: 'Soto' }]
  const userMap = buildUserMap(users)
  const base = { ...vacio, users, userMap, componentMap: { C1: 'Excel' } }

  it('la adopción: activos son los que abrieron alguna ventana', () => {
    const v = generalView({ ...base, overview: [{ UserID: 'U1', PlanningAreaID: 'A', TimestampStart: '2026-08-01' }] })
    expect(v).toMatchObject({ totalActive: 1, totalLicensed: 3, adoptionRate: 33, inactiveCount: 2, uniquePAs: 1 })
  })

  it('los inactivos, por ID, con el nombre de v8', () => {
    const v = generalView({ ...base, overview: [{ UserID: 'U1' }] })
    expect(v.inactiveUsers).toEqual([{ uid: 'U2', name: 'U2' }, { uid: 'U3', name: 'Luis Soto' }])
    expect(filterInactiveUsers(v.inactiveUsers, 'soto')).toEqual([{ uid: 'U3', name: 'Luis Soto' }])
  })

  it('avisa de los licenciados sin actividad y de un área con más del 30 % de errores', () => {
    const pv = (ok) => ({ UserID: 'U1', PlanningAreaID: 'A1', SuccessfullyCompleted: ok })
    const v = generalView({ ...base, overview: [{ UserID: 'U1' }], planningViews: [pv(false), pv(false), pv(true), pv(true), pv(true)] })
    expect(v.attention).toEqual([{ type: 'warn', n: 2 }, { type: 'error', pa: 'A1', rate: 40, count: 5 }])
  })

  // Con menos de cinco operaciones la tasa no dice nada y v8 no avisaba.
  it('no avisa de un área con pocas operaciones', () => {
    const v = generalView({ ...base, overview: users.map(u => ({ UserID: u.UserID })), planningViews: [{ PlanningAreaID: 'A1', SuccessfullyCompleted: false }] })
    expect(v.attention).toEqual([])
  })

  it('usuarios únicos por día y acciones por componente', () => {
    const v = generalView({
      ...base,
      overview: [
        { UserID: 'U1', TimestampStart: '2026-08-02', MeteringComponent: 'C1', NumberOfActions: 4 },
        { UserID: 'U2', TimestampStart: '2026-08-01', MeteringComponent: 'C2' },
        { UserID: 'U1', TimestampStart: '2026-08-01', MeteringComponent: 'C1', NumberOfActions: 0 },
      ],
    })
    expect(v.dauData).toEqual([{ day: '2026-08-01', users: 2 }, { day: '2026-08-02', users: 1 }])
    // Una sesión sin acciones cuenta como una, y el componente se nombra por su texto.
    expect(v.componentChartData).toEqual([{ day: '2026-08-01', C2: 1, Excel: 1 }, { day: '2026-08-02', Excel: 4 }])
    expect(v.componentNames).toEqual(['C2', 'Excel'])
  })

  it('la adopción por herramienta: Excel, cada app Fiori sin el complemento, y el resto', () => {
    const v = generalView({
      ...base,
      planningViews: [{ UserID: 'U1' }, { UserID: 'U1' }],
      fiori: [
        { UserID: 'U1', FioriProjectID: 'tl.ibp.excel.addin.x' },
        { UserID: 'U2', FioriProjectID: 'app1', FioriProjectTitle: 'Mi app' },
        { UserID: 'U3', FioriProjectID: 'app1', FioriProjectTitle: 'Mi app' },
      ],
      alerts: [{ UserID: 'U3' }],
    })
    expect(v.featureRows).toEqual([
      { name: 'Mi app', users: 2, sessions: 2 },
      { name: 'Excel Add-In', users: 1, sessions: 2 },
      { name: 'Alert Monitor', users: 1, sessions: 1 },
    ])
  })

  it('los más activos: ventanas, último día y hasta tres áreas', () => {
    const v = generalView({
      ...base,
      overview: [
        { UserID: 'U1', PlanningAreaID: 'D', TimestampStart: '2026-08-01' },
        { UserID: 'U1', PlanningAreaID: 'C', TimestampStart: '2026-08-03' },
        { UserID: 'U1', PlanningAreaID: 'B', TimestampStart: '2026-08-02' },
        { UserID: 'U1', PlanningAreaID: 'A', TimestampStart: '2026-08-02' },
        { UserID: 'U2', TimestampStart: '2026-08-02' },
        { UserID: null },
      ],
    })
    expect(v.topActiveUsers).toEqual([
      { uid: 'U1', name: 'Ana', acts: 4, last: '2026-08-03', pas: 'D, C, B' },
      { uid: 'U2', name: 'U2', acts: 1, last: '2026-08-02', pas: '—' },
    ])
  })

  it('corta los más activos en 15', () => {
    const overview = Array.from({ length: 20 }, (_, i) => ({ UserID: `X${i}` }))
    expect(generalView({ ...base, overview }).topActiveUsers).toHaveLength(15)
  })
})

describe('userProfileView', () => {
  it('lo que muestra el perfil de un usuario', () => {
    const v = userProfileView({
      ...vacio,
      uid: 'U1',
      userMap: { U1: 'Ana' },
      overview: [
        { UserID: 'U1', PlanningAreaID: 'B', TimestampStart: '2026-08-02' },
        { UserID: 'U1', PlanningAreaID: 'A', TimestampStart: '2026-08-01' },
      ],
      planningViews: [
        { SuccessfullyCompleted: true, TotalDuration: 10000, DurationUnit: 'ms' },
        { SuccessfullyCompleted: false, TotalDuration: 20000, DurationUnit: 'ms' },
      ],
      fiori: [{ FioriProjectID: 'tl.ibp.excel.addin.x' }, { FioriProjectID: 'app1' }],
      logons: [{}, {}, {}],
    })
    expect(v).toMatchObject({
      name: 'Ana', uniquePAs: ['A', 'B'], firstSeen: '2026-08-01', lastSeen: '2026-08-02',
      unit: 'ms', excelRate: 50, avgDur: 15000,
    })
    expect(v.actByDay).toEqual([{ day: '2026-08-01', windows: 1 }, { day: '2026-08-02', windows: 1 }])
    expect(v.toolsUsed).toEqual([
      { name: 'Logon Excel', count: 3 },
      { name: 'Excel Add-In', count: 2 },
      { name: 'app1', count: 1 },
    ])
  })

  it('sin Excel no hay tasa', () => {
    const v = userProfileView({ ...vacio, uid: 'U9', userMap: {} })
    expect(v).toMatchObject({ name: 'U9', excelRate: null, firstSeen: '—', lastSeen: '—', unit: 's' })
  })
})

describe('paProfileView', () => {
  // Aquí v8 cuenta toda la actividad Fiori, también la del complemento de Excel.
  it('usuarios activos y los que más hicieron en el área', () => {
    const v = paProfileView({
      overview: [{ UserID: 'U1' }],
      planningViews: [{ UserID: 'U2', Timestamp: '2026-08-01', SuccessfullyCompleted: true }],
      fiori: [{ UserID: 'U2', FioriProjectID: 'tl.ibp.excel.addin.x' }],
      dashboards: [{ UserID: null }],
      userMap: { U2: 'Beto' },
    })
    expect(v.activeUsers).toEqual(['U1', 'U2'])
    expect(v.topUsers).toEqual([{ uid: 'U2', name: 'Beto', acts: 2 }, { uid: 'U1', name: 'U1', acts: 1 }])
    expect(v.excelByDay).toEqual([{ day: '2026-08-01', ops: 1, successPct: 100 }])
    expect(v.excelRate).toBe(100)
  })
})

describe('excelView', () => {
  const pv = (extra) => ({ UserID: 'U1', PlanningAreaID: 'A1', DurationUnit: 'ms', SuccessfullyCompleted: true, ...extra })

  it('los KPI de Excel', () => {
    const v = excelView({
      planningViews: [
        pv({ TotalDuration: 130000, PlanningViewCells: 100, Timestamp: '2026-08-01' }),
        pv({ TotalDuration: 10000, PlanningViewCells: 50, SuccessfullyCompleted: false, Timestamp: '2026-08-01' }),
      ],
      logons: [{ TotalDuration: 4, DurationUnit: 's' }, { TotalDuration: 6, DurationUnit: 's' }],
      chgKeyFig: [],
    })
    expect(v).toMatchObject({ total: 2, success: 1, failed: 1, rate: 50, unit: 'ms', avgDur: 70000, cells: 150, logonUnit: 's', avgLogonDur: 5 })
    expect(v.trendData).toEqual([{ day: '2026-08-01', successPct: 50, durationS: 70 }])
  })

  it('los tipos de operación sin el prefijo de SAP', () => {
    const v = excelView({ planningViews: [pv({ ActivityType: 'XLS_REFRESH_DATA' }), pv({ ActivityType: 'XLS_REFRESH_DATA' }), pv({ ActivityType: 'XLS_SAVE' })], logons: [], chgKeyFig: [] })
    expect(v.actTypeData).toEqual([{ tipo: 'REFRESH DATA', count: 2, pct: 67 }, { tipo: 'SAVE', count: 1, pct: 33 }])
  })

  it('el rendimiento por área, de más a menos operaciones, hasta diez', () => {
    const planningViews = Array.from({ length: 12 }, (_, i) => Array.from({ length: i + 1 }, () => pv({ PlanningAreaID: `A${i}`, TotalDuration: 2000 }))).flat()
    const v = excelView({ planningViews, logons: [], chgKeyFig: [] })
    expect(v.paPerf).toHaveLength(10)
    expect(v.paPerf[0]).toEqual({ pa: 'A11', total: 12, rate: 100, avgDur: 2 })
  })

  // «Usuario» en esta tabla son los usuarios distintos, y sin `KeyFigureCount` cuenta las filas.
  it('las cifras más cambiadas', () => {
    const v = excelView({
      planningViews: [],
      logons: [],
      chgKeyFig: [
        { KeyFigureID: 'KF1', KeyFigureCount: 5, UserID: 'U1' },
        { KeyFigureID: 'KF1', KeyFigureCount: 3, UserID: 'U2' },
        { KeyFigureID: 'KF2', UserID: 'U1' },
        { KeyFigureID: 'KF2', UserID: 'U1' },
      ],
    })
    expect(v.topChgKF).toEqual([{ kf: 'KF1', cambios: 8, usuarios: 2 }, { kf: 'KF2', cambios: 2, usuarios: 1 }])
  })

  it('las más lentas y los errores, hasta veinte', () => {
    const planningViews = Array.from({ length: 30 }, (_, i) => pv({ TotalDuration: i, SuccessfullyCompleted: i % 2 === 0 }))
    const v = excelView({ planningViews, logons: [], chgKeyFig: [] })
    expect(v.slowRows).toHaveLength(20)
    expect(v.slowRows[0].TotalDuration).toBe(29)
    // Los errores van en el orden en que llegan de SAP (de la más lenta a la más rápida).
    expect(v.failRows.map(r => r.TotalDuration)).toEqual(planningViews.filter(r => !r.SuccessfullyCompleted).map(r => r.TotalDuration))
    expect(v.failRows).toHaveLength(15)
  })
})

describe('appsView', () => {
  it('las cuatro tablas de Herramientas', () => {
    const v = appsView({
      fiori: [
        { UserID: 'U1', FioriProjectID: 'tl.ibp.excel.addin.x' },
        { UserID: 'U1', FioriProjectID: 'app1', FioriProjectTitle: 'Mi app' },
        { UserID: 'U2', FioriProjectID: 'app1', FioriProjectTitle: 'Mi app' },
      ],
      dashboards: [{ UserID: 'U1', PlanningAreaID: 'A' }, { UserID: 'U1', PlanningAreaID: 'B' }, { UserID: 'U2' }],
      alerts: [{ UserID: 'U1', Timestamp: '2026-08-01' }, { UserID: 'U1', Timestamp: '2026-08-03' }],
      stories: [{ UserID: 'U1', StoryID: 'S1' }, { UserID: 'U2', StoryName: 'Ventas', StoryID: 'S2' }],
      userMap: { U1: 'Ana' },
    })
    expect(v.fioriApps).toEqual([{ name: 'Mi app', usuarios: 2, usos: 2 }])
    expect(v.dashPorUsuario).toEqual([{ usuario: 'Ana', pa: 'A, B', sesiones: 2 }, { usuario: 'U2', pa: '—', sesiones: 1 }])
    expect(v.alertPorUsuario).toEqual([{ usuario: 'Ana', aperturas: 2, ultima: '2026-08-03' }])
    expect(v.storyRows).toEqual([{ name: 'S1', usuarios: 1, vistas: 1 }, { name: 'Ventas', usuarios: 1, vistas: 1 }])
    expect(v.noData).toBe(false)
  })

  // Solo la actividad del complemento de Excel no llena la pestaña de Herramientas.
  it('sin nada más que Excel, la pestaña queda vacía', () => {
    const v = appsView({ fiori: [{ FioriProjectID: 'tl.ibp.excel.addin.x' }], dashboards: [], alerts: [], stories: [], userMap: {} })
    expect(v.noData).toBe(true)
  })
})
