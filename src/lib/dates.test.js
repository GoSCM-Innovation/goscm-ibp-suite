import { describe, it, expect } from 'vitest'
import {
  dayLabelEpochMs,
  daysBetween,
  formatEpochMs,
  formatSapTimestamp,
  fromInputValue,
  parseSapTimestamp,
  toInputValue,
  tzOffsetHours,
} from './dates.js'

// 4 de agosto de 2026, 12:30:00 UTC. Elegido a propósito: en UTC-4 cae el mismo día a las 8:30,
// así que un error de signo se ve en la hora sin cambiar la fecha.
const SAP_TS = '20260804123000'
const EPOCH_MS = Date.UTC(2026, 7, 4, 12, 30, 0)

describe('parseSapTimestamp', () => {
  it('interpreta la marca de SAP en UTC', () => {
    expect(parseSapTimestamp(SAP_TS).toISOString()).toBe('2026-08-04T12:30:00.000Z')
  })

  it('ignora los dígitos de más de las fracciones de segundo', () => {
    // Así llega desde el servidor: a la marca se le quitaron los separadores y quedaron 21.
    expect(parseSapTimestamp('202608041230000000000').toISOString()).toBe('2026-08-04T12:30:00.000Z')
  })

  it('devuelve null cuando no hay ni fecha', () => {
    expect(parseSapTimestamp('2026')).toBeNull()
    expect(parseSapTimestamp('')).toBeNull()
    expect(parseSapTimestamp(null)).toBeNull()
  })
})

describe('formatSapTimestamp', () => {
  it('muestra la hora de UTC tal cual viene', () => {
    expect(formatSapTimestamp(SAP_TS, 'utc')).toBe('04/08/2026 12:30:00')
  })

  // Es el punto de todo el módulo: la misma marca se lee distinto según la zona elegida, y el
  // resultado NO depende de la zona del equipo donde corre el navegador.
  it('corre la hora cuatro horas atrás en UTC-4', () => {
    expect(formatSapTimestamp(SAP_TS, 'utc-4')).toBe('04/08/2026 08:30:00')
  })

  it('devuelve un guion cuando la marca está incompleta', () => {
    expect(formatSapTimestamp('20260804', 'utc')).toBe('—')
    expect(formatSapTimestamp('', 'utc')).toBe('—')
    expect(formatSapTimestamp(null, 'utc')).toBe('—')
  })
})

describe('formatEpochMs', () => {
  it('muestra los milisegundos desde 1970 en la zona elegida', () => {
    expect(formatEpochMs(EPOCH_MS, 'utc')).toBe('04/08/2026 12:30:00')
    expect(formatEpochMs(EPOCH_MS, 'utc-4')).toBe('04/08/2026 08:30:00')
  })

  it('acepta el número como texto, que es como llega de SAP', () => {
    expect(formatEpochMs(String(EPOCH_MS), 'utc')).toBe('04/08/2026 12:30:00')
  })

  it('devuelve un guion sin dato', () => {
    expect(formatEpochMs(null, 'utc')).toBe('—')
    expect(formatEpochMs('', 'utc')).toBe('—')
    expect(formatEpochMs('no es un número', 'utc')).toBe('—')
  })
})

describe('dayLabelEpochMs', () => {
  it('da el dia y el mes de la zona elegida', () => {
    expect(dayLabelEpochMs(EPOCH_MS, 'utc')).toBe('04/08')
  })

  // El mismo instante puede caer en otro dia segun la zona: 02:00 UTC del dia 5 es el dia 4 en UTC-4.
  it('cambia de dia cuando la zona lo cambia', () => {
    const madrugada = Date.UTC(2026, 7, 5, 2, 0, 0)
    expect(dayLabelEpochMs(madrugada, 'utc')).toBe('05/08')
    expect(dayLabelEpochMs(madrugada, 'utc-4')).toBe('04/08')
  })

  it('sin dato devuelve un interrogante, no revienta el eje del grafico', () => {
    expect(dayLabelEpochMs(null, 'utc')).toBe('?')
    expect(dayLabelEpochMs('no es un numero', 'utc')).toBe('?')
  })
})

describe('campos de fecha', () => {
  it('muestra la hora de la zona elegida, no la de UTC', () => {
    const fecha = new Date(EPOCH_MS)
    expect(toInputValue(fecha, 'utc')).toBe('2026-08-04T12:30')
    expect(toInputValue(fecha, 'utc-4')).toBe('2026-08-04T08:30')
  })

  it('lee lo escrito como hora de la zona y devuelve UTC', () => {
    expect(fromInputValue('2026-08-04T08:30', 'utc-4').toISOString()).toBe('2026-08-04T12:30:00.000Z')
    expect(fromInputValue('2026-08-04T12:30', 'utc').toISOString()).toBe('2026-08-04T12:30:00.000Z')
  })

  it('ida y vuelta deja la misma fecha en las dos zonas', () => {
    for (const zona of ['utc', 'utc-4', 'local']) {
      const texto = toInputValue(new Date(EPOCH_MS), zona)
      expect(fromInputValue(texto, zona).getTime()).toBe(EPOCH_MS)
    }
  })

  it('sin valor no inventa una fecha', () => {
    expect(fromInputValue('', 'utc')).toBeNull()
    expect(fromInputValue(null, 'utc')).toBeNull()
    expect(fromInputValue('cualquier cosa', 'utc')).toBeNull()
  })
})

describe('daysBetween', () => {
  it('cuenta los días del rango', () => {
    expect(daysBetween('2026-08-01T00:00', '2026-08-04T00:00', 'utc')).toBe(3)
  })

  it('no depende de la zona, porque el rango se mide en las dos puntas igual', () => {
    expect(daysBetween('2026-08-01T00:00', '2026-11-01T00:00', 'utc-4'))
      .toBe(daysBetween('2026-08-01T00:00', '2026-11-01T00:00', 'utc'))
  })

  it('devuelve null si falta una punta', () => {
    expect(daysBetween('', '2026-08-04T00:00', 'utc')).toBeNull()
    expect(daysBetween('2026-08-01T00:00', '', 'utc')).toBeNull()
  })
})

describe('tzOffsetHours', () => {
  it('conoce las zonas fijas', () => {
    expect(tzOffsetHours('utc')).toBe(0)
    expect(tzOffsetHours('utc-4')).toBe(-4)
  })

  it('ante una zona desconocida se queda en UTC en vez de reventar', () => {
    expect(tzOffsetHours('marte')).toBe(0)
  })
})
