import { describe, it, expect } from 'vitest'
import { statusMeta } from '../../core/cids/task-status.js'
import {
  DIAS_EN_GRAFICO,
  latestFailed,
  latestWarnings,
  perDayBreakdown,
  statusBreakdown,
  topTasks,
} from './cids-stats.js'

const enDia = (dia, hora = 12) => Date.UTC(2026, 7, dia, hora, 0, 0)

const ejecucion = (statusCode, { taskName = 'CARGA', dia = 4, hora = 12, runId = 'r' } = {}) => ({
  statusCode,
  taskName,
  runId,
  startDate: String(enDia(dia, hora)),
})

describe('statusBreakdown', () => {
  it('cuenta por estado y ordena de más a menos', () => {
    const filas = [
      ejecucion('ERROR'), ejecucion('SUCCESS'), ejecucion('SUCCESS'), ejecucion('SUCCESS'),
    ]

    const resultado = statusBreakdown(filas, statusMeta)

    expect(resultado.map((r) => [r.code, r.value])).toEqual([['SUCCESS', 3], ['ERROR', 1]])
  })

  // La etiqueta y el color vienen de la tabla de la capa transversal, no de aquí.
  it('trae la etiqueta en español y el color del estado', () => {
    const [primero] = statusBreakdown([ejecucion('ERROR')], statusMeta)
    expect(primero.name).toBe('Error')
    expect(primero.color).toBe(statusMeta('ERROR').color)
  })

  it('sin ejecuciones devuelve una lista vacía', () => {
    expect(statusBreakdown([], statusMeta)).toEqual([])
  })
})

describe('perDayBreakdown', () => {
  it('agrupa por día en tres pilas', () => {
    const filas = [
      ejecucion('SUCCESS', { dia: 4 }),
      ejecucion('SUCCESS', { dia: 4 }),
      ejecucion('ERROR', { dia: 4 }),
      ejecucion('RUNNING', { dia: 5 }),
    ]

    expect(perDayBreakdown(filas, 'utc')).toEqual([
      { dia: '04/08', Correctas: 2, Falladas: 1, Otras: 0 },
      { dia: '05/08', Correctas: 0, Falladas: 0, Otras: 1 },
    ])
  })

  // La cancelación fallida es un fallo, igual que en el resto de la aplicación.
  it('la cancelación fallida cuenta como fallada', () => {
    const [dia] = perDayBreakdown([ejecucion('TERMINATION_FAILED')], 'utc')
    expect(dia.Falladas).toBe(1)
  })

  it('lo que no es ni correcta ni fallada va a "Otras"', () => {
    const filas = [ejecucion('RUNNING'), ejecucion('QUEUEING'), ejecucion('TERMINATED')]
    const [dia] = perDayBreakdown(filas, 'utc')
    expect(dia).toMatchObject({ Correctas: 0, Falladas: 0, Otras: 3 })
  })

  // El gráfico tiene que coincidir con lo que dice la tabla, y la tabla muestra la zona elegida.
  it('el día se calcula en la zona elegida', () => {
    const madrugada = [ejecucion('SUCCESS', { dia: 5, hora: 2 })]
    expect(perDayBreakdown(madrugada, 'utc')[0].dia).toBe('05/08')
    expect(perDayBreakdown(madrugada, 'utc-4')[0].dia).toBe('04/08')
  })

  it('se queda con los últimos días y no dibuja un eje interminable', () => {
    const muchos = Array.from({ length: 30 }, (_, i) => ejecucion('SUCCESS', { dia: 1 + i }))
    const resultado = perDayBreakdown(muchos, 'utc')
    expect(resultado).toHaveLength(DIAS_EN_GRAFICO)
    // Los últimos, no los primeros.
    expect(resultado.at(-1).dia).toBe('30/08')
  })
})

describe('topTasks', () => {
  it('cuenta por nombre y ordena de más a menos', () => {
    const filas = [
      ejecucion('SUCCESS', { taskName: 'A' }),
      ejecucion('SUCCESS', { taskName: 'B' }),
      ejecucion('SUCCESS', { taskName: 'B' }),
    ]

    expect(topTasks(filas).map((t) => [t.taskName, t.veces])).toEqual([['B', 2], ['A', 1]])
  })

  // En el tablero global la misma tarea en dos tenants son dos filas, no una: es lo que hacía v9.
  it('separa la misma tarea cuando viene de tenants distintos', () => {
    const filas = [
      { ...ejecucion('SUCCESS', { taskName: 'CARGA' }), tenant: 'prd' },
      { ...ejecucion('SUCCESS', { taskName: 'CARGA' }), tenant: 'qa' },
    ]

    const resultado = topTasks(filas, { claveExtra: (fila) => fila.tenant })

    expect(resultado).toHaveLength(2)
    expect(resultado.every((t) => t.veces === 1)).toBe(true)
  })

  it('sin la clave extra, la misma tarea se suma', () => {
    const filas = [ejecucion('SUCCESS', { taskName: 'CARGA' }), ejecucion('ERROR', { taskName: 'CARGA' })]
    expect(topTasks(filas)).toHaveLength(1)
    expect(topTasks(filas)[0].veces).toBe(2)
  })

  it('una tarea sin nombre no rompe la lista', () => {
    expect(topTasks([{ statusCode: 'SUCCESS', startDate: '1' }])[0].taskName).toBe('—')
  })

  it('respeta el límite', () => {
    const filas = Array.from({ length: 20 }, (_, i) => ejecucion('SUCCESS', { taskName: `T${i}` }))
    expect(topTasks(filas, { limite: 3 })).toHaveLength(3)
  })
})

describe('latestFailed y latestWarnings', () => {
  it('devuelve las falladas con la más reciente arriba', () => {
    const filas = [
      ejecucion('ERROR', { runId: 'vieja', dia: 1 }),
      ejecucion('SUCCESS', { runId: 'ok', dia: 9 }),
      ejecucion('TERMINATION_FAILED', { runId: 'nueva', dia: 8 }),
    ]

    expect(latestFailed(filas).map((f) => f.runId)).toEqual(['nueva', 'vieja'])
  })

  it('los avisos son solo las correctas con errores', () => {
    const filas = [
      ejecucion('SUCCESS_WITH_ERRORS_E', { runId: 'aviso' }),
      ejecucion('SUCCESS', { runId: 'ok' }),
      ejecucion('ERROR', { runId: 'mal' }),
    ]

    expect(latestWarnings(filas).map((f) => f.runId)).toEqual(['aviso'])
  })

  it('respeta el límite', () => {
    const filas = Array.from({ length: 10 }, (_, i) => ejecucion('ERROR', { runId: `r${i}`, dia: 1 + i }))
    expect(latestFailed(filas, 3)).toHaveLength(3)
  })

  it('sin nada que listar devuelve vacío', () => {
    expect(latestFailed([ejecucion('SUCCESS')])).toEqual([])
    expect(latestWarnings([])).toEqual([])
  })
})
