// Pruebas de la matriz de reglas por categoría de v7 (`mattypeGetRules`) y de los resúmenes de los pasos
// ② ③ ⑤. Los valores se leen de `mattype-config.js` de v7, línea a línea.

import { describe, expect, it } from 'vitest'

import {
  categoriasDe,
  desdeClasificacion,
  estaExcluido,
  iniciarTipos,
  reglasDeCategorias,
  resumenDeCategoriasV7,
  resumenDeEjecucionV7,
  resumenDeExclusionV7,
} from './mattype-config.js'

describe('reglasDeCategorias', () => {
  it('terminado: exige receta completa, planta como origen y lead time', () => {
    expect(reglasDeCategorias(['finished'])).toEqual({
      requiresPSH: 'red',
      requiresPSI: 'red',
      requiresPSR: 'red',
      requiresLocPrd: 'red',
      requiresPlantAsOrigin: 'red',
      requiresVendorArc: 'none',
      requiresAnyOriginDest: 'none',
      pleadtimeZero: 'red',
      outputCoeffZero: 'red',
      isCoproductOnly: 'yellow',
      hasPSHUnexpected: 'none',
      notConsumedInBOM: 'none',
      tleadtimeZero: 'yellow',
    })
  })

  it('semiterminado: el lead time en cero y no ser consumido son advertencias', () => {
    const r = reglasDeCategorias(['semi'])
    expect(r.requiresPSH).toBe('red')
    expect(r.requiresPlantAsOrigin).toBe('none')
    expect(r.pleadtimeZero).toBe('yellow')
    expect(r.notConsumedInBOM).toBe('yellow')
  })

  it('materia prima: exige arco de proveedor y se avisa si tiene receta', () => {
    const r = reglasDeCategorias(['rawmat'])
    expect(r.requiresPSH).toBe('none')
    expect(r.requiresVendorArc).toBe('red')
    expect(r.hasPSHUnexpected).toBe('yellow')
  })

  it('mercadería: exige algún arco y se avisa si tiene receta', () => {
    const r = reglasDeCategorias(['trading'])
    expect(r.requiresAnyOriginDest).toBe('red')
    expect(r.hasPSHUnexpected).toBe('yellow')
    expect(r.notConsumedInBOM).toBe('none')
  })

  it('con varias categorías gana la lectura MÁS permisiva de cada regla', () => {
    const r = reglasDeCategorias(['finished', 'rawmat'])
    expect(r.requiresPSH).toBe('none')
    expect(r.requiresVendorArc).toBe('none')
    expect(r.pleadtimeZero).toBe('none')
    expect(r.isCoproductOnly).toBe('none')
    expect(r.tleadtimeZero).toBe('yellow')
    // La ubicación en Location Product se exige siempre.
    expect(r.requiresLocPrd).toBe('red')
  })

  it('sin categoría, todo lo que alguien pediría pasa a advertencia', () => {
    const r = reglasDeCategorias(['uncategorized'])
    expect(r.requiresPSH).toBe('yellow')
    expect(r.requiresVendorArc).toBe('yellow')
    expect(r.hasPSHUnexpected).toBe('yellow')
    expect(r.tleadtimeZero).toBe('yellow')
    expect(r.requiresLocPrd).toBe('red')
  })

  it('un tipo excluido no exige nada salvo Location Product', () => {
    const r = reglasDeCategorias(['excluded'])
    expect(Object.entries(r).filter(([, v]) => v !== 'none')).toEqual([['requiresLocPrd', 'red']])
  })
})

describe('configuración de tipos', () => {
  it('categoriasDe distingue tipo desconocido, excluido, sin categoría y categorizado', () => {
    const cfg = desdeClasificacion({
      A: { excluido: true, categorias: ['finished'] },
      B: { excluido: false, categorias: [] },
      C: { excluido: false, categorias: ['semi', 'rawmat'] },
    })
    expect(categoriasDe(cfg, 'NOEXISTE')).toEqual(['uncategorized'])
    expect(categoriasDe(cfg, 'A')).toEqual(['excluded'])
    expect(categoriasDe(cfg, 'B')).toEqual(['uncategorized'])
    expect(categoriasDe(cfg, 'C')).toEqual(['semi', 'rawmat'])
    expect(estaExcluido(cfg, 'A')).toBe(true)
    expect(estaExcluido(cfg, 'NOEXISTE')).toBe(false)
  })

  it('desdeClasificacion descarta las categorías que v7 no conoce', () => {
    const cfg = desdeClasificacion({ A: { excluido: false, categorias: ['finished', 'inventada'] } })
    expect([...cfg.A.categories]).toEqual(['finished'])
  })

  it('iniciarTipos acepta objeto, Map o lista y no cuenta los productos sin tipo', () => {
    const lista = [{ MATTYPEID: 'FERT' }, { MATTYPEID: 'FERT ' }, { MATTYPEID: '' }, {}]
    expect(iniciarTipos(lista).FERT.count).toBe(2)
    expect(iniciarTipos(new Map([['a', { MATTYPEID: 'ROH' }]])).ROH.count).toBe(1)
    expect(iniciarTipos({ a: { MATTYPEID: 'HALB' } }).HALB.count).toBe(1)
  })
})

describe('resúmenes de una línea', () => {
  const cfg = desdeClasificacion({
    FERT: { excluido: false, categorias: ['finished'] },
    HALB: { excluido: false, categorias: [] },
    VERP: { excluido: true, categorias: [] },
  }, { FERT: 10, HALB: 5, VERP: 3 })

  it('paso ②', () => {
    expect(resumenDeExclusionV7({})).toBe('Todos los tipos incluidos — sin configurar')
    expect(resumenDeExclusionV7(cfg)).toBe('1 tipo(s) excluido(s) · 3 producto(s) omitidos del análisis principal')
  })

  it('paso ③', () => {
    expect(resumenDeCategoriasV7({})).toBe('Sin categorización — análisis estándar para todos los tipos')
    expect(resumenDeCategoriasV7(cfg)).toBe('1 tipo(s) categorizado(s) · 1 sin categoría (reglas 🟡)')
  })

  it('paso ⑤', () => {
    expect(resumenDeEjecucionV7({})).toBe('Configuración por defecto — análisis estándar')
    expect(resumenDeEjecucionV7(cfg)).toBe(
      '15 productos incluidos en 2 tipo(s) · 3 productos excluidos (VERP) · 1 tipo(s) categorizados',
    )
  })
})
