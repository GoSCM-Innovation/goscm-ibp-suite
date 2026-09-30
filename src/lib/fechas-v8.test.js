// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import {
  dayLabel, formatSapTs, formatSapTsShort, getTzLabel, getTzMode, inputDateToDate, parseSapTs,
  setTzMode, toInputDate,
} from './fechas-v8.js'

beforeEach(() => { localStorage.clear() })

describe('la zona de v8', () => {
  it('arranca en UTC y recuerda lo elegido con la clave de v8', () => {
    expect(getTzMode()).toBe('utc')
    setTzMode('local')
    expect(getTzMode()).toBe('local')
    expect(localStorage.getItem('ibp_tz_mode')).toBe('local')
  })

  it('el desfase se escribe como en v8', () => {
    const conDesfase = (minutos) => ({ getTimezoneOffset: () => minutos })
    expect(getTzLabel(conDesfase(180))).toBe('UTC-3')
    expect(getTzLabel(conDesfase(-330))).toBe('UTC+5:30')
    expect(getTzLabel(conDesfase(0))).toBe('UTC+0')
  })
})

describe('las horas de SAP', () => {
  it('se leen como UTC', () => {
    expect(parseSapTs('20260409143045.0000000').toISOString()).toBe('2026-04-09T14:30:45.000Z')
    expect(parseSapTs('')).toBeNull()
  })

  it('se muestran en UTC con y sin segundos', () => {
    expect(formatSapTs('20260409143045.0000000', 'utc')).toBe('09/04/2026 14:30:45')
    expect(formatSapTsShort('20260409143045.0000000', 'utc')).toBe('09/04/2026 14:30')
    expect(dayLabel('20260409143045.0000000', 'utc')).toBe('09/04')
  })

  it('sin hora, una raya', () => {
    expect(formatSapTs(null)).toBe('—')
    expect(formatSapTsShort('2026')).toBe('—')
  })
})

describe('los campos de fecha', () => {
  it('en UTC ida y vuelta dan lo mismo', () => {
    const d = new Date('2026-04-09T14:30:00.000Z')
    expect(toInputDate(d, 'utc')).toBe('2026-04-09T14:30')
    expect(inputDateToDate('2026-04-09T14:30', 'utc').toISOString()).toBe('2026-04-09T14:30:00.000Z')
  })
})
