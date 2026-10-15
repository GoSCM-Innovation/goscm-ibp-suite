import { describe, expect, it } from 'vitest'
import { aFechaDelCalendario, deFechaDelCalendario, esCampoDeFecha, esFechaAAAAMMDD } from './fechas.js'

describe('esFechaAAAAMMDD', () => {
  it.each(['20261005', '20270412', '20240229', '19991231'])('%s es una fecha', (valor) => {
    expect(esFechaAAAAMMDD(valor)).toBe(true)
  })

  it.each(['', '2026100', '202610055', '2026-10-05', '20261301', '20260230', '20230229', '20261032', '{{FECHA}}', 'abcdefgh', undefined, null])(
    '%j no lo es', (valor) => { expect(esFechaAAAAMMDD(valor)).toBe(false) },
  )
})

describe('del body al calendario y de vuelta', () => {
  it('AAAAMMDD <-> AAAA-MM-DD', () => {
    expect(aFechaDelCalendario('20261005')).toBe('2026-10-05')
    expect(deFechaDelCalendario('2026-10-05')).toBe('20261005')
  })

  it('lo que no es una fecha queda vacío, en los dos sentidos', () => {
    expect(aFechaDelCalendario('{{DESDE}}')).toBe('')
    expect(aFechaDelCalendario('')).toBe('')
    expect(deFechaDelCalendario('')).toBe('')
    expect(deFechaDelCalendario('2026-13-01')).toBe('')
    expect(deFechaDelCalendario('05/10/2026')).toBe('')
  })

  it('es reversible para cualquier fecha real', () => {
    for (const fecha of ['20260101', '20261231', '20240229']) expect(deFechaDelCalendario(aFechaDelCalendario(fecha))).toBe(fecha)
  })
})

describe('esCampoDeFecha', () => {
  it('es KEYFIGUREDATE, sin distinguir mayúsculas ni espacios', () => {
    expect(esCampoDeFecha('KEYFIGUREDATE')).toBe(true)
    expect(esCampoDeFecha(' keyfiguredate ')).toBe(true)
    expect(esCampoDeFecha('MATTYPEID')).toBe(false)
    expect(esCampoDeFecha(undefined)).toBe(false)
  })
})
