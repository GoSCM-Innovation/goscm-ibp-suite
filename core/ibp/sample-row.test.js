import { describe, it, expect } from 'vitest'

import { formatIbpExample } from './sample-row.js'

describe('formatIbpExample', () => {
  it('una fecha de OData V2 se muestra legible', () => {
    expect(formatIbpExample('/Date(1735689600000)/')).toBe('2025-01-01')
  })

  it('un texto se muestra tal cual', () => {
    expect(formatIbpExample('FG-100')).toBe('FG-100')
  })

  it('un número se pasa a texto', () => {
    expect(formatIbpExample(42)).toBe('42')
    expect(formatIbpExample(0)).toBe('0')
  })

  // Una propiedad de navegación viene como objeto y no es un dato que mostrar.
  it('un objeto no se muestra', () => {
    expect(formatIbpExample({ __deferred: {} })).toBe('')
  })

  it('sin valor no muestra nada', () => {
    expect(formatIbpExample(null)).toBe('')
    expect(formatIbpExample(undefined)).toBe('')
  })
})
