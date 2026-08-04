import { describe, it, expect } from 'vitest'
import {
  andFilters,
  assertNoSilentPredicate,
  buildConditionFilter,
  escapeText,
  literal,
  nonZero,
  notBlank,
  splitValues,
} from './filter.js'

describe('literal', () => {
  it('pone el texto entre comillas simples', () => {
    expect(literal('ABC')).toBe("'ABC'")
  })

  it('duplica la comilla simple, que es como se escapa en OData', () => {
    expect(literal("O'Brien")).toBe("'O''Brien'")
  })

  it('convierte una fecha de SAP en su forma propia, no en texto', () => {
    // Comparar una fecha como texto hace que SAP responda "Invalid parametertype".
    expect(literal('/Date(1753734272000+0000)/')).toBe("datetimeoffset'2025-07-28T20:24:32Z'")
  })

  it('acepta la fecha sin desplazamiento', () => {
    expect(literal('/Date(1753734272000)/')).toBe("datetimeoffset'2025-07-28T20:24:32Z'")
  })
})

describe('escapeText y splitValues', () => {
  it('escapa comillas', () => {
    expect(escapeText("a'b")).toBe("a''b")
  })

  it('parte una lista separada por comas y limpia los espacios', () => {
    expect(splitValues(' A , B ,, C ')).toEqual(['A', 'B', 'C'])
  })

  it.each([undefined, null, ''])('devuelve lista vacía con %s', (value) => {
    expect(splitValues(value)).toEqual([])
  })
})

describe('nonZero', () => {
  it('pide mayor o menor que cero, porque "ne 0" SAP lo ignora en silencio', () => {
    expect(nonZero('CONSENSUSDEMANDQTY')).toBe('(CONSENSUSDEMANDQTY gt 0 or CONSENSUSDEMANDQTY lt 0)')
  })

  it('exige el nombre de la cifra clave', () => {
    expect(() => nonZero('')).toThrow(/cifra clave/)
  })
})

describe('notBlank', () => {
  it('usa "gt \'\'", que es la forma que sí funciona', () => {
    expect(notBlank('MARCA')).toBe("MARCA gt ''")
  })
})

describe('assertNoSilentPredicate', () => {
  it('rechaza "ne 0" y explica qué usar en su lugar', () => {
    expect(() => assertNoSilentPredicate('KF ne 0')).toThrow(/nonZero/)
  })

  it('rechaza "ne \'\'"', () => {
    expect(() => assertNoSilentPredicate("MARCA ne ''")).toThrow(/notBlank/)
  })

  it('rechaza "ne null", que SAP devuelve con error', () => {
    expect(() => assertNoSilentPredicate('MARCA ne null')).toThrow(/notBlank/)
  })

  it('deja pasar un filtro correcto y lo devuelve', () => {
    const filtro = "PRDID eq 'X' and (KF gt 0 or KF lt 0)"
    expect(assertNoSilentPredicate(filtro)).toBe(filtro)
  })

  it('no confunde un campo cuyo nombre acaba en "ne"', () => {
    expect(() => assertNoSilentPredicate("PLANE eq 'X'")).not.toThrow()
  })
})

describe('buildConditionFilter', () => {
  it('un solo valor se compara con eq', () => {
    expect(buildConditionFilter([{ field: 'PRDID', op: 'in', value: 'A' }])).toBe("PRDID eq 'A'")
  })

  it('varios valores se encadenan con or entre paréntesis', () => {
    expect(buildConditionFilter([{ field: 'PRDID', op: 'in', value: 'A,B' }]))
      .toBe("(PRDID eq 'A' or PRDID eq 'B')")
  })

  it('traduce "empieza por"', () => {
    expect(buildConditionFilter([{ field: 'PRDID', op: 'sw', value: 'AB' }]))
      .toBe("startswith(PRDID,'AB')")
  })

  it('traduce "no vacío", que no lleva valor', () => {
    expect(buildConditionFilter([{ field: 'MARCA', op: 'nb' }])).toBe("MARCA gt ''")
  })

  it('une varias condiciones con and', () => {
    const filtro = buildConditionFilter([
      { field: 'PRDID', op: 'in', value: 'A,B' },
      { field: 'MARCA', op: 'nb' },
    ])
    expect(filtro).toBe("(PRDID eq 'A' or PRDID eq 'B') and MARCA gt ''")
  })

  it('ignora las condiciones incompletas', () => {
    expect(buildConditionFilter([{ op: 'in', value: 'A' }, { field: 'X', op: 'in', value: '' }])).toBe('')
  })

  it.each([undefined, null, []])('devuelve cadena vacía con %s', (conds) => {
    expect(buildConditionFilter(conds)).toBe('')
  })

  it('no ofrece exclusión: no existe un operador para "distinto de"', () => {
    // Se quitó a propósito: cualquier condición sobre un campo descarta las filas donde ese
    // campo está vacío, así que "excluir X" perdía los blancos sin avisar.
    expect(buildConditionFilter([{ field: 'MARCA', op: 'ne', value: 'X' }])).toBe("MARCA eq 'X'")
  })
})

describe('andFilters', () => {
  it('descarta los trozos vacíos', () => {
    expect(andFilters('', "A eq '1'", null, undefined)).toBe("A eq '1'")
  })

  it('envuelve en paréntesis lo que lleva or, para no cambiar el significado', () => {
    expect(andFilters("A eq '1'", "B eq '2' or B eq '3'"))
      .toBe("A eq '1' and (B eq '2' or B eq '3')")
  })

  it('no vuelve a envolver lo que ya viene envuelto', () => {
    expect(andFilters("A eq '1'", '(B gt 0 or B lt 0)')).toBe("A eq '1' and (B gt 0 or B lt 0)")
  })

  it('sin nada devuelve cadena vacía', () => {
    expect(andFilters()).toBe('')
  })
})
