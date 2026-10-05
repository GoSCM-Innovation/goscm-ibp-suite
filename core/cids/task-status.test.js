import { describe, it, expect } from 'vitest'
import {
  CANCELABLE_STATUSES,
  FAILED_STATUSES,
  QUEUED_STATUSES,
  TASK_STATUS,
  TERMINAL_STATUSES,
  WARNING_STATUSES,
  formatDuration,
  isCancelable,
  isFailed,
  isQueued,
  isTerminal,
  isWarning,
  statusMeta,
  successRate,
} from './task-status.js'

describe('la tabla de estados', () => {
  it('todo estado terminal existe en la tabla', () => {
    for (const code of TERMINAL_STATUSES) expect(TASK_STATUS[code]).toBeDefined()
  })

  it('todo estado cancelable existe en la tabla', () => {
    for (const code of CANCELABLE_STATUSES) expect(TASK_STATUS[code]).toBeDefined()
  })

  it('ningún estado es a la vez terminal y cancelable', () => {
    // Si lo fuera, el monitor ofrecería cancelar algo que ya terminó.
    const solapados = TERMINAL_STATUSES.filter((code) => CANCELABLE_STATUSES.includes(code))
    expect(solapados).toEqual([])
  })

  it('cada estado tiene etiqueta y color', () => {
    for (const [code, meta] of Object.entries(TASK_STATUS)) {
      expect(meta.label, code).toBeTruthy()
      expect(meta.color, code).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})

describe('statusMeta', () => {
  // Las etiquetas son las de v9, en inglés (`constants/status.js`).
  it('devuelve la etiqueta del estado, la de v9', () => {
    expect(statusMeta('SUCCESS').label).toBe('Success')
    expect(statusMeta('RUNNING').label).toBe('Running')
    expect(statusMeta('SUCCESS_WITH_ERRORS_D').label).toBe('Success w/ errors D')
    expect(statusMeta('TERMINATION_FAILED').label).toBe('Termination failed')
  })

  it('la torta usa la etiqueta corta (`chartLabel`)', () => {
    expect(statusMeta('SUCCESS_WITH_ERRORS_D').chartLabel).toBe('Success w/err D')
    expect(statusMeta('SUCCESS_WITH_ERRORS_E').chartLabel).toBe('Success w/err E')
    expect(statusMeta('ERROR').chartLabel).toBe('Error')
  })

  it('la cancelación fallida ya no comparte color con «con errores E»', () => {
    expect(statusMeta('TERMINATION_FAILED').color).toBe('#ef4444')
    expect(statusMeta('TERMINATION_FAILED').color).not.toBe(statusMeta('SUCCESS_WITH_ERRORS_E').color)
  })

  it.each([undefined, null, ''])('un estado vacío (%s) cae en «Unknown»', (code) => {
    expect(statusMeta(code)).toEqual(TASK_STATUS.UNKNOWN)
    expect(statusMeta(code).label).toBe('Unknown')
  })

  // Dos códigos nuevos distintos no tienen que verse como dos porciones iguales de «Unknown».
  it('un código que no conoce conserva su texto original, con el color de desconocido', () => {
    const nuevo = statusMeta('INVENTADO')
    expect(nuevo.label).toBe('INVENTADO')
    expect(nuevo.chartLabel).toBe('INVENTADO')
    expect(nuevo.color).toBe(TASK_STATUS.UNKNOWN.color)
  })
})

describe('isTerminal e isCancelable', () => {
  it('una tarea en ejecución no ha terminado y se puede cancelar', () => {
    expect(isTerminal('RUNNING')).toBe(false)
    expect(isCancelable('RUNNING')).toBe(true)
  })

  it('una tarea correcta ha terminado y ya no se cancela', () => {
    expect(isTerminal('SUCCESS')).toBe(true)
    expect(isCancelable('SUCCESS')).toBe(false)
  })

  it('un estado desconocido no se da por terminado', () => {
    // Darlo por terminado dejaría de refrescarlo y se quedaría congelado en pantalla.
    expect(isTerminal('INVENTADO')).toBe(false)
  })
})

describe('formatDuration', () => {
  it.each([
    [12, '12s'],
    [296, '4m 56s'],
    [25_560, '7h 6m'],
    [60, '1m 0s'],
    [3600, '1h 0m'],
  ])('%s segundos son "%s"', (segundos, esperado) => {
    expect(formatDuration(segundos)).toBe(esperado)
  })

  it.each([null, undefined, 0, -5, 'x', NaN])('sin dato usable (%s) devuelve un guion', (valor) => {
    expect(formatDuration(valor)).toBe('—')
  })

  it('acepta un número en texto, que es como llega de SAP', () => {
    expect(formatDuration('296')).toBe('4m 56s')
  })
})

// Los tres grupos con los que cuenta un tablero. En v9 estaban a mano en los dos resúmenes y no
// coincidían entre sí.
describe('grupos de estado para los tableros', () => {
  it('en cola son los que esperan turno, sin incluir el que ya corre', () => {
    expect(QUEUED_STATUSES).toEqual(['QUEUEING', 'IMPORTED', 'FETCHED'])
    expect(isQueued('QUEUEING')).toBe(true)
    expect(isQueued('RUNNING')).toBe(false)
  })

  it('los avisos son las dos variantes de "correcta con errores"', () => {
    expect(isWarning('SUCCESS_WITH_ERRORS_D')).toBe(true)
    expect(isWarning('SUCCESS_WITH_ERRORS_E')).toBe(true)
    expect(isWarning('SUCCESS')).toBe(false)
  })

  // Es la corrección respecto de v9: una cancelación que no se pudo completar es un fallo.
  it('las falladas incluyen la cancelación fallida', () => {
    expect(isFailed('ERROR')).toBe(true)
    expect(isFailed('TERMINATION_FAILED')).toBe(true)
    expect(isFailed('TERMINATED')).toBe(false)
    expect(isFailed('SUCCESS')).toBe(false)
  })

  it('los tres grupos no se pisan entre sí', () => {
    for (const codigo of [...QUEUED_STATUSES, ...WARNING_STATUSES, ...FAILED_STATUSES]) {
      const pertenencias = [isQueued(codigo), isWarning(codigo), isFailed(codigo)].filter(Boolean)
      expect(pertenencias).toHaveLength(1)
    }
  })

  it('todos los códigos de los grupos existen en la tabla', () => {
    for (const codigo of [...QUEUED_STATUSES, ...WARNING_STATUSES, ...FAILED_STATUSES]) {
      expect(TASK_STATUS).toHaveProperty(codigo)
    }
  })
})

describe('successRate', () => {
  it('cuenta como éxito la correcta con errores: terminó y dejó el dato', () => {
    expect(successRate(['SUCCESS', 'SUCCESS_WITH_ERRORS_D'])).toBe(100)
  })

  // Los dos topes son la razón de que esta función exista.
  it('NO redondea a 100 si hay aunque sea una que no salió bien', () => {
    const cuatrocientasBien = Array(400).fill('SUCCESS')
    expect(successRate([...cuatrocientasBien, 'ERROR'])).toBe(99)
  })

  it('NO redondea a 0 si hay aunque sea una que sí salió bien', () => {
    const cuatrocientasMal = Array(400).fill('ERROR')
    expect(successRate([...cuatrocientasMal, 'SUCCESS'])).toBe(1)
  })

  it('da 100 solo cuando de verdad salieron todas bien', () => {
    expect(successRate(['SUCCESS', 'SUCCESS'])).toBe(100)
  })

  it('da 0 solo cuando de verdad no salió ninguna', () => {
    expect(successRate(['ERROR', 'TERMINATED'])).toBe(0)
  })

  it('redondea normal en el medio', () => {
    expect(successRate(['SUCCESS', 'SUCCESS', 'SUCCESS', 'ERROR'])).toBe(75)
  })

  // null y no 0: sin ejecuciones no hay tasa que mostrar, y 0% diría que todo falló.
  it('sin ejecuciones devuelve null, no cero', () => {
    expect(successRate([])).toBeNull()
  })

  it('una en ejecución todavía no es un éxito', () => {
    expect(successRate(['SUCCESS', 'RUNNING'])).toBe(50)
  })
})
