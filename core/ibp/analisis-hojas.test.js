import { describe, expect, it } from 'vitest'

import {
  COLORES,
  ETIQUETA_DE_SEVERIDAD,
  codigos,
  crearHojaDeTabla,
  crearHojaLibre,
  etiquetaDeRelleno,
  limpiarXml,
  porcentajeOk,
  rellenoDeSeveridad,
  severidadDeRelleno,
} from './analisis-hojas.js'

describe('limpiarXml (cleanXml de v7)', () => {
  it('recorta los espacios que SAP deja en los campos CHAR', () => {
    expect(limpiarXml('  P001   ')).toBe('P001')
  })

  it('un texto que queda vacío es una celda vacía', () => {
    expect(limpiarXml('   ')).toBeNull()
    expect(limpiarXml('')).toBeNull()
  })

  it('quita los caracteres que XML 1.0 no admite', () => {
    expect(limpiarXml('a\u0000b\u0007c')).toBe('abc')
    expect(limpiarXml('tab\tok')).toBe('tab\tok')
  })

  it('no toca lo que no es texto', () => {
    expect(limpiarXml(0)).toBe(0)
    expect(limpiarXml(12.5)).toBe(12.5)
    expect(limpiarXml(null)).toBeNull()
    expect(limpiarXml(undefined)).toBeUndefined()
  })
})

describe('severidades y rellenos', () => {
  it('el relleno decide la severidad y viceversa', () => {
    expect(severidadDeRelleno(COLORES.C_RED)).toBe('red')
    expect(severidadDeRelleno(COLORES.C_YEL)).toBe('yel')
    expect(severidadDeRelleno(null)).toBe('ok')
    expect(rellenoDeSeveridad('red')).toBe(COLORES.C_RED)
    expect(rellenoDeSeveridad('yel')).toBe(COLORES.C_YEL)
    expect(rellenoDeSeveridad('ok')).toBeNull()
  })

  it('las etiquetas son las de v7, sin «Nota»', () => {
    expect(ETIQUETA_DE_SEVERIDAD).toEqual({ red: '⛔ Alerta', yel: '⚠ Advertencia', ok: '✅ OK' })
    expect(etiquetaDeRelleno(COLORES.C_RED)).toBe('⛔ Alerta')
    expect(etiquetaDeRelleno(COLORES.C_YEL)).toBe('⚠ Advertencia')
    expect(etiquetaDeRelleno(null)).toBe('✅ OK')
  })
})

describe('crearHojaDeTabla', () => {
  const nueva = () => crearHojaDeTabla({
    nombre: 'Product',
    color: 'FF29ABE2',
    encabezados: ['Estado', 'Observación'],
    notas: ['n1'],
    grupos: ['control'],
  })

  it('cuenta las filas por severidad al agregarlas', () => {
    const h = nueva()
    h.agregar(['⛔ Alerta', 'a'], COLORES.C_RED)
    h.agregar(['⚠ Advertencia', 'b'], COLORES.C_YEL)
    h.agregar(['✅ OK', 'c'], null)
    h.agregar(['✅ OK', 'd'])
    expect({ t: h.total, r: h.red, y: h.yel, o: h.ok }).toEqual({ t: 4, r: 1, y: 1, o: 2 })
    expect(h.filas.map((f) => f.s)).toEqual(['red', 'yel', 'ok', 'ok'])
  })

  it('limpia las celdas al agregar', () => {
    const h = nueva()
    h.agregar(['  x  ', '   '], null)
    expect(h.filas[0].c).toEqual(['x', null])
  })

  it('devuelve la severidad de la fila agregada', () => {
    expect(nueva().agregar(['a', 'b'], COLORES.C_YEL)).toBe('yel')
  })

  it('no comparte los arreglos con quien la creó', () => {
    const encabezados = ['A']
    const h = crearHojaDeTabla({ nombre: 'X', color: 'FF000000', encabezados })
    encabezados.push('B')
    expect(h.encabezados).toEqual(['A'])
  })

  it('las filas libres van aparte y no cuentan', () => {
    const h = nueva()
    h.agregarLibre(['INFORMACION'], COLORES.NA_FILL)
    h.agregarLibre([])
    expect(h.total).toBe(0)
    expect(h.extras).toEqual([{ celdas: ['INFORMACION'], relleno: COLORES.NA_FILL }, { celdas: [], relleno: null }])
  })

  it('por omisión la primera columna es el Estado', () => {
    expect(nueva().conEstado).toBe(true)
    expect(crearHojaDeTabla({ nombre: 'X', color: 'F', encabezados: [], conEstado: false }).conEstado).toBe(false)
  })
})

describe('crearHojaLibre', () => {
  it('guarda las filas tal cual y avisa a quien captura, en texto', () => {
    const capturadas = []
    const h = crearHojaLibre({ nombre: 'Estadísticas', color: 'FF29ABE2', capturar: (f) => capturadas.push(f) })
    h.agregar(['Título'])
    h.agregar(['a', 2, null], COLORES.NA_FILL)
    h.agregar([])
    expect(h.filas).toEqual([
      { celdas: ['Título'], relleno: null },
      { celdas: ['a', 2, null], relleno: COLORES.NA_FILL },
      { celdas: [], relleno: null },
    ])
    expect(capturadas).toEqual([['Título'], ['a', '2', ''], []])
  })

  it('funciona sin captura', () => {
    const h = crearHojaLibre({ nombre: 'X', color: 'F' })
    h.agregar(['a'])
    expect(h.filas).toHaveLength(1)
  })
})

describe('utilidades', () => {
  it('codigos ordena y une con coma', () => {
    expect(codigos(new Set(['P2', 'P1', 'A']))).toBe('A, P1, P2')
    expect(codigos(['b', 'a'])).toBe('a, b')
    expect(codigos(null)).toBe('')
  })

  it('porcentajeOk redondea y, sin filas, vale 100', () => {
    expect(porcentajeOk(3, 1)).toBe(33)
    expect(porcentajeOk(5, 2)).toBe(40)
    expect(porcentajeOk(0, 0)).toBe(100)
  })
})
