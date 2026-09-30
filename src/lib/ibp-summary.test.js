import { describe, expect, it } from 'vitest'

import {
  colorDeEstado,
  filtrarPorPlanificada,
  fmtDuration,
  nombreParaEje,
  resumenDeConexion,
  resumenGlobal,
  resumirParaGlobal,
  tieneAcuerdoDeJobs,
} from './ibp-summary.js'

/** Una fila de `JobHeaderSet` como la manda SAP: las fechas con su fracción de 7 dígitos. */
const fila = (JobStatus, extra = {}) => ({
  JobStatus,
  JobText: 'Carga diaria',
  JobCreatedBy: 'CB9980000001',
  JobPlannedStartDateTime: '20260930120000.0000000',
  ...extra,
})

describe('filtrarPorPlanificada', () => {
  const desde = '20260929000000'
  const hasta = '20261001000000'

  it('deja las que caen dentro, bordes incluidos, y descarta las de fuera', () => {
    const filas = [
      fila('F', { JobPlannedStartDateTime: '20260929000000.0000000' }),
      fila('F', { JobPlannedStartDateTime: '20261001000000.0000000' }),
      fila('F', { JobPlannedStartDateTime: '20260928235959.0000000' }),
      fila('F', { JobPlannedStartDateTime: '20261001000001.0000000' }),
    ]
    expect(filtrarPorPlanificada(filas, desde, hasta).map(r => r.JobPlannedStartDateTime)).toEqual([
      '20260929000000.0000000', '20261001000000.0000000',
    ])
  })

  // v8: una fila sin fecha planificada no se puede situar en el período, y se queda.
  it('conserva siempre las filas sin fecha planificada', () => {
    const sinFecha = fila('S', { JobPlannedStartDateTime: '' })
    expect(filtrarPorPlanificada([sinFecha], desde, hasta)).toEqual([sinFecha])
  })

  it('con un límite ilegible solo quedan las filas sin fecha', () => {
    const sinFecha = fila('S', { JobPlannedStartDateTime: '' })
    expect(filtrarPorPlanificada([fila('F'), sinFecha], '', hasta)).toEqual([sinFecha])
  })
})

describe('resumenDeConexion — las reglas de v8', () => {
  it('cuenta como v8: En ejecución = R, Programados = S+P+Y, Finalizados = F, Fallidos = A', () => {
    const r = resumenDeConexion([
      fila('R'), fila('S'), fila('P'), fila('Y'), fila('F'), fila('W'), fila('A'), fila('U'), fila('C'),
    ])
    expect(r).toMatchObject({ total: 9, running: 1, scheduled: 3, finished: 1, failed: 1 })
  })

  // La tasa solo mira lo que acabó: (F+W) / (F+W+A+U), redondeada.
  it('la tasa de éxito es (F+W) / (F+W+A+U)', () => {
    const r = resumenDeConexion([fila('F'), fila('W'), fila('A'), fila('R'), fila('S')])
    expect(r.successRate).toBe(67)
  })

  it('sin nada acabado la tasa es 0 %', () => {
    expect(resumenDeConexion([fila('R'), fila('S')]).successRate).toBe(0)
    expect(resumenDeConexion([]).successRate).toBe(0)
  })

  it('la torta va de mayor a menor con el nombre que se le pase y el código crudo', () => {
    const labels = { F: 'Finished' }
    const r = resumenDeConexion([fila('A'), fila('F'), fila('F')], { statusLabel: c => labels[c] || c })
    expect(r.donutData).toEqual([
      { name: 'Finished', value: 2, code: 'F' },
      { name: 'A', value: 1, code: 'A' },
    ])
  })

  it('barras por día: Finalizados = F+W, Fallidos = A+U, Otros el resto', () => {
    const r = resumenDeConexion([fila('F'), fila('W'), fila('A'), fila('U'), fila('R')], { tzMode: 'utc' })
    expect(r.barData).toEqual([{ day: '30/09', finished: 2, failed: 2, others: 1 }])
  })

  // v8 ordenaba por el texto «DD/MM» y al cruzar de mes el 01/10 quedaba antes del 29/09. Aquí se
  // ordena por la fecha.
  it('las barras se ordenan por la fecha, también al cruzar de mes', () => {
    const r = resumenDeConexion([
      fila('F', { JobPlannedStartDateTime: '20260930080000.0000000' }),
      fila('F', { JobPlannedStartDateTime: '20260929080000.0000000' }),
      fila('F', { JobPlannedStartDateTime: '20261001080000.0000000' }),
    ], { tzMode: 'utc' })
    expect(r.barData.map(d => d.day)).toEqual(['29/09', '30/09', '01/10'])
  })

  it('las barras son solo los últimos 14 días', () => {
    const filas = Array.from({ length: 20 }, (_, i) => fila('F', {
      JobPlannedStartDateTime: `202609${String(i + 1).padStart(2, '0')}120000.0000000`,
    }))
    const r = resumenDeConexion(filas, { tzMode: 'utc' })
    expect(r.barData).toHaveLength(14)
    expect(r.barData[0].day).toBe('07/09')
    expect(r.barData.at(-1).day).toBe('20/09')
  })

  it('top jobs por JobText (o «—»), top usuarios por el nombre formateado, 5 como mucho', () => {
    const r = resumenDeConexion([
      fila('F', { JobText: 'B', JobCreatedByFormattedName: 'Ana' }),
      fila('F', { JobText: 'B', JobCreatedByFormattedName: 'Ana' }),
      fila('F', { JobText: '', JobCreatedByFormattedName: '' }),
      ...['C', 'D', 'E', 'G', 'H'].map(t => fila('F', { JobText: t })),
    ])
    expect(r.topTemplates[0]).toEqual(['B', 2])
    expect(r.topTemplates).toHaveLength(5)
    expect(r.topTemplates.map(([n]) => n)).toContain('—')
    expect(r.topUsers[0]).toEqual(['CB9980000001', 6])
    expect(r.topUsers[1]).toEqual(['Ana', 2])
  })

  it('los más lentos promedian solo F/W con inicio y fin, de más a menos', () => {
    const r = resumenDeConexion([
      fila('F', { JobText: 'Lento', JobStartDateTime: '20260930100000', JobEndDateTime: '20260930110000' }),
      fila('W', { JobText: 'Lento', JobStartDateTime: '20260930100000', JobEndDateTime: '20260930103000' }),
      fila('F', { JobText: 'Rápido', JobStartDateTime: '20260930100000', JobEndDateTime: '20260930100045' }),
      // Fallado, sin fin, o con fin antes del inicio: no cuentan.
      fila('A', { JobText: 'Fallado', JobStartDateTime: '20260930100000', JobEndDateTime: '20260930230000' }),
      fila('F', { JobText: 'SinFin', JobStartDateTime: '20260930100000', JobEndDateTime: '' }),
      fila('F', { JobText: 'Revés', JobStartDateTime: '20260930110000', JobEndDateTime: '20260930100000' }),
    ])
    expect(r.topDuration).toEqual([
      { name: 'Lento', avg: 45 },
      { name: 'Rápido', avg: 0.75 },
    ])
  })

  it('últimos fallidos: A y U, el más reciente primero, 5 como mucho', () => {
    const filas = ['01', '02', '03', '04', '05', '06'].map(h => fila('A', {
      JobPlannedStartDateTime: `20260930${h}0000.0000000`,
    }))
    const r = resumenDeConexion([...filas, fila('U', { JobPlannedStartDateTime: '20260930070000.0000000' }), fila('C')])
    expect(r.recentFailed).toHaveLength(5)
    expect(r.recentFailed[0].JobStatus).toBe('U')
    expect(r.recentFailed.map(f => f.JobPlannedStartDateTime.slice(8, 10))).toEqual(['07', '06', '05', '04', '03'])
  })
})

describe('fmtDuration', () => {
  it('escribe las duraciones como v8', () => {
    expect(fmtDuration(0.75)).toBe('45s')
    expect(fmtDuration(12.4)).toBe('12 min')
    expect(fmtDuration(65)).toBe('1h 5m')
    expect(fmtDuration(120)).toBe('2h')
  })
})

describe('colorDeEstado', () => {
  it('usa la paleta de los resúmenes de v8 y el gris de respaldo', () => {
    expect(colorDeEstado('F')).toBe('#34d399')
    expect(colorDeEstado('A')).toBe('#ff6b6b')
    expect(colorDeEstado('c')).toBe('#9ca3af')
    expect(colorDeEstado('Z')).toBe('#6b7280')
  })
})

describe('resumen global', () => {
  const con = (id, extra = {}) => ({ id, name: `Tenant ${id}`, isProduction: false, agreements: ['SAP_COM_0326'], ...extra })

  it('tieneAcuerdoDeJobs mira SAP_COM_0326', () => {
    expect(tieneAcuerdoDeJobs(con('a'))).toBe(true)
    expect(tieneAcuerdoDeJobs(con('a', { agreements: ['SAP_COM_0720'] }))).toBe(false)
    expect(tieneAcuerdoDeJobs({})).toBe(false)
  })

  // La del global es otra regla que la de una conexión: (F+W) sobre TODAS las filas.
  it('la tasa de una conexión en el global es (F+W) / total, y Fallidos = A+U', () => {
    expect(resumirParaGlobal([fila('F'), fila('W'), fila('A'), fila('U'), fila('S')])).toMatchObject({
      total: 5, finished: 1, warned: 1, failed: 2, scheduled: 1, successRate: 40,
    })
  })

  it('distingue sin acuerdo, cargando y error, y solo suma las que contestaron', () => {
    const connections = [con('ok'), con('sin', { agreements: [] }), con('mal'), con('espera')]
    const connData = {
      ok: { rows: [fila('F'), fila('A'), fila('R')], error: '', loading: false },
      sin: { rows: [], error: '', loading: false, noAgreement: true },
      mal: { rows: [], error: 'HTTP 500', loading: false },
    }
    const g = resumenGlobal(connections, connData, { desde: '20260929000000', hasta: '20261001000000' })

    expect(g.connSummaries.map(c => [c.conn.id, !!c.noAgreement, c.loading, c.error])).toEqual([
      ['ok', false, false, ''],
      ['sin', true, false, ''],
      ['mal', false, false, 'HTTP 500'],
      ['espera', false, true, ''],
    ])
    expect(g).toMatchObject({ gTotal: 3, gFinished: 1, gFailed: 1, gRunning: 1, gSuccessRate: 33 })
    // El gráfico por conexión deja fuera las que fallaron y las que no tienen acuerdo.
    // «Tenant espera (Calidad)» pasa de 20 caracteres: en el eje se corta.
    expect(g.connBarData.map(b => b.name)).toEqual(['Tenant ok (Calidad)', 'Tenant espera (Cal…'])
    expect(g.connBarData[0]).toEqual({ name: 'Tenant ok (Calidad)', finished: 1, failed: 1, others: 1 })
  })

  it('la torta global usa los nombres fijos de v8 y el código cuando no lo conoce', () => {
    const g = resumenGlobal([con('a')], { a: { rows: [fila('F'), fila('F'), fila('k')], error: '' } }, {
      desde: '20260929000000', hasta: '20261001000000',
    })
    expect(g.donutData).toEqual([
      { name: 'Finalizado', value: 2, code: 'F' },
      { name: 'k', value: 1, code: 'k' },
    ])
  })

  it('los últimos fallidos juntan todas las conexiones, con su nombre, 8 como mucho', () => {
    const muchos = h => fila('U', { JobPlannedStartDateTime: `20260930${h}0000.0000000` })
    const g = resumenGlobal([con('a'), con('b', { isProduction: true })], {
      a: { rows: ['01', '02', '03', '04', '05'].map(muchos), error: '' },
      b: { rows: ['06', '07', '08', '09'].map(muchos), error: '' },
    }, { desde: '20260929000000', hasta: '20261001000000' })

    expect(g.recentFailures).toHaveLength(8)
    expect(g.recentFailures[0]._connName).toBe('Tenant b (Producción)')
    expect(g.recentFailures.at(-1).JobPlannedStartDateTime.slice(8, 10)).toBe('02')
  })

  it('en el eje, un nombre de más de 20 caracteres se corta a 18 y «…»', () => {
    expect(nombreParaEje({ name: 'Nombre bastante largo', isProduction: true })).toBe('Nombre bastante la…')
    expect(nombreParaEje({ name: 'Corto (QA)' })).toBe('Corto (QA)')
  })
})
