import { describe, it, expect } from 'vitest'

import { compactRows, dayKey, expandRows } from './metering-rows.js'

describe('dayKey', () => {
  it('de una marca ISO se queda con los diez primeros caracteres, como v8', () => {
    expect(dayKey('2026-08-01T23:59:59Z')).toBe('2026-08-01')
  })

  it('de una fecha de OData v2 saca el día UTC', () => {
    expect(dayKey('/Date(1785628800000+0000)/')).toBe('2026-08-02')
  })

  it('sin marca devuelve «?»', () => {
    expect(dayKey(null)).toBe('?')
    expect(dayKey('')).toBe('?')
  })
})

describe('compactRows / expandRows', () => {
  const campos = ['UserID', 'PlanningAreaID', 'Timestamp', 'TotalDuration', 'SuccessfullyCompleted']

  it('ida y vuelta devuelve las mismas filas, con los tipos de SAP', () => {
    const filas = [
      { UserID: 'U1', PlanningAreaID: 'A1', Timestamp: '2026-08-01T10:00:00Z', TotalDuration: 12.5, SuccessfullyCompleted: true },
      { UserID: 'U2', PlanningAreaID: null, Timestamp: '2026-08-02T11:00:00Z', TotalDuration: 0, SuccessfullyCompleted: false },
    ]
    expect(expandRows(compactRows(filas, campos))).toEqual(filas)
  })

  // v8 solo usaba el día de cada marca; mandar la hora sería pagar por nada.
  it('recorta al día solo los campos pedidos', () => {
    const [fila] = expandRows(compactRows(
      [{ UserID: 'U1', Timestamp: '2026-08-01T10:00:00Z' }],
      ['UserID', 'Timestamp'],
      { soloElDia: ['Timestamp'] },
    ))
    expect(fila).toEqual({ UserID: 'U1', Timestamp: '2026-08-01' })
  })

  // v8 descartaba las marcas vacías con `filter(Boolean)`; «?» no se descartaría.
  it('una marca vacía sigue vacía', () => {
    const filas = expandRows(compactRows([{ Timestamp: '' }, { Timestamp: null }], ['Timestamp'], { soloElDia: ['Timestamp'] }))
    expect(filas.map(f => f.Timestamp)).toEqual(['', null])
  })

  it('cada valor viaja una sola vez y las filas repetidas llevan su cuenta', () => {
    const fila = { UserID: 'U1', PlanningAreaID: 'A1' }
    const compacto = compactRows([fila, { ...fila }, { UserID: 'U2', PlanningAreaID: 'A1' }, { ...fila }], ['UserID', 'PlanningAreaID'])
    expect(compacto.valores).toEqual([['U1', 'U2'], ['A1']])
    expect(compacto.filas).toEqual([[0, 0, 3], [1, 0, 1]])
    expect(expandRows(compacto)).toHaveLength(4)
  })

  // v8 muestra las áreas de un usuario en el orden en que aparecen: agrupar no puede cambiarlo.
  it('conserva el orden de la primera aparición de cada valor', () => {
    const filas = [
      { UserID: 'U1', PlanningAreaID: 'B' },
      { UserID: 'U1', PlanningAreaID: 'A' },
      { UserID: 'U1', PlanningAreaID: 'B' },
      { UserID: 'U1', PlanningAreaID: 'C' },
    ]
    const areas = expandRows(compactRows(filas, ['UserID', 'PlanningAreaID'])).map(f => f.PlanningAreaID)
    expect([...new Set(areas)]).toEqual(['B', 'A', 'C'])
    expect(areas).toHaveLength(4)
  })

  it('un campo que la fila no trae viaja como null', () => {
    expect(expandRows(compactRows([{ UserID: 'U1' }], ['UserID', 'PlanningAreaID']))).toEqual([{ UserID: 'U1', PlanningAreaID: null }])
  })

  // Un campo que el servicio no declara no se pide, y queda `undefined` como en v8.
  it('solo lleva los campos pedidos', () => {
    const [fila] = expandRows(compactRows([{ UserID: 'U1', Otro: 'x' }], ['UserID']))
    expect(fila).toEqual({ UserID: 'U1' })
    expect(fila.PlanningAreaID).toBeUndefined()
  })

  it('distingue un número de su texto', () => {
    const filas = expandRows(compactRows([{ X: 1 }, { X: '1' }], ['X']))
    expect(filas.map(f => f.X)).toEqual([1, '1'])
  })

  it('sin filas ni forma no revienta', () => {
    expect(expandRows(compactRows([], campos))).toEqual([])
    expect(expandRows(undefined)).toEqual([])
  })
})
