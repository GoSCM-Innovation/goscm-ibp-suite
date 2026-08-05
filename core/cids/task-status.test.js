import { describe, it, expect } from 'vitest'
import {
  CANCELABLE_STATUSES,
  TASK_STATUS,
  TERMINAL_STATUSES,
  formatDuration,
  isCancelable,
  isTerminal,
  statusMeta,
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
  it('devuelve la etiqueta del estado', () => {
    expect(statusMeta('SUCCESS').label).toBe('Correcta')
  })

  it.each([undefined, null, '', 'INVENTADO'])('un estado que no conoce (%s) cae en desconocido', (code) => {
    expect(statusMeta(code)).toBe(TASK_STATUS.UNKNOWN)
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
