import { describe, it, expect } from 'vitest'

import {
  CATEGORIAS,
  IDS_DE_CATEGORIA,
  MATRIZ,
  SEVERIDADES,
  TEXTOS,
  configuracionInicial,
  laMasPermisiva,
  reglasDe,
  repartirTipos,
  sinClasificar,
} from './production-rules.js'

describe('la matriz', () => {
  it('están las cuatro categorías, en el orden de la matriz', () => {
    expect(IDS_DE_CATEGORIA).toEqual(['finished', 'semi', 'rawmat', 'trading'])
  })

  it('cada comprobación tiene una severidad por categoría', () => {
    for (const [comprobacion, porCategoria] of Object.entries(MATRIZ)) {
      expect(porCategoria, comprobacion).toHaveLength(4)
      for (const una of porCategoria) expect(SEVERIDADES, comprobacion).toContain(una)
    }
  })

  it('cada comprobación tiene un texto que se pueda leer', () => {
    for (const comprobacion of Object.keys(MATRIZ)) {
      expect(TEXTOS[comprobacion], comprobacion).toBeTruthy()
    }
  })

  it('cada categoría dice qué es y qué exige', () => {
    for (const una of CATEGORIAS) {
      expect(una.etiqueta).toBeTruthy()
      expect(una.descripcion).toBeTruthy()
      expect(una.exige.length).toBeGreaterThan(2)
    }
  })
})

describe('laMasPermisiva', () => {
  it('entre rojo y aviso gana el aviso', () => {
    expect(laMasPermisiva(['red', 'yel'])).toBe('yel')
  })

  it('si alguna categoría no lo pide, no se pide', () => {
    expect(laMasPermisiva(['red', 'none'])).toBe('none')
  })

  it('con una sola, esa', () => {
    expect(laMasPermisiva(['red'])).toBe('red')
  })

  it('sin nada, lo más grave: no se ha dicho que se pueda relajar', () => {
    expect(laMasPermisiva([])).toBe('red')
  })
})

describe('reglasDe', () => {
  // El caso que da sentido a todo: no exigirle una receta a una materia prima.
  it('a una materia prima no se le pide receta', () => {
    const reglas = reglasDe(['rawmat'])
    expect(reglas.requiresPSH).toBe('none')
    expect(reglas.requiresPSI).toBe('none')
    expect(reglas.requiresPSR).toBe('none')
  })

  it('a una materia prima SÍ se le pide de dónde llega', () => {
    expect(reglasDe(['rawmat']).requiresVendorArc).toBe('red')
  })

  it('a un producto terminado se le pide la receta en rojo', () => {
    const reglas = reglasDe(['finished'])
    expect(reglas.requiresPSH).toBe('red')
    expect(reglas.requiresPSR).toBe('red')
    expect(reglas.requiresPlantAsOrigin).toBe('red')
  })

  // La diferencia entre terminado y semiterminado que más importa en la práctica.
  it('el plazo en cero es rojo en un terminado y aviso en un semiterminado', () => {
    expect(reglasDe(['finished']).pleadtimeZero).toBe('red')
    expect(reglasDe(['semi']).pleadtimeZero).toBe('yel')
  })

  it('a la mercadería se le piden arcos, no recetas', () => {
    const reglas = reglasDe(['trading'])
    expect(reglas.requiresPSH).toBe('none')
    expect(reglas.requiresAnyOriginDest).toBe('red')
    expect(reglas.hasPSHUnexpected).toBe('yel')
  })

  // Lo que se le pide a todos, sin excepción.
  it('la cobertura en Location Product se pide siempre', () => {
    for (const cat of [...IDS_DE_CATEGORIA, 'inventada']) {
      expect(reglasDe([cat]).requiresLocPrd, cat).toBe('red')
    }
    expect(reglasDe([]).requiresLocPrd).toBe('red')
  })

  // Un tipo en dos categorías: gana la exigencia más suave, para no llenar el informe de ruido.
  it('con dos categorías manda la más permisiva', () => {
    expect(reglasDe(['finished', 'rawmat']).requiresPSH).toBe('none')
    expect(reglasDe(['finished', 'semi']).pleadtimeZero).toBe('yel')
  })

  // Un tipo sin clasificar no se calla ni se marca en rojo: nadie ha dicho todavía qué es.
  it('sin categoría, todo lo exigible pasa a aviso', () => {
    const reglas = reglasDe([])
    expect(reglas.requiresPSH).toBe('yel')
    expect(reglas.requiresVendorArc).toBe('yel')
    expect(reglas.pleadtimeZero).toBe('yel')
  })

  it('sin categoría, lo que nadie exige sigue sin exigirse', () => {
    const soloNone = Object.entries(MATRIZ).find(([, valores]) => valores.every((una) => una === 'none'))
    if (soloNone) expect(reglasDe([])[soloNone[0]]).toBe('none')
  })

  it('una categoría inventada se ignora, no rompe', () => {
    expect(reglasDe(['loquesea']).requiresPSH).toBe('yel')
  })

  it('sin argumento tampoco rompe', () => {
    expect(reglasDe().requiresLocPrd).toBe('red')
  })
})

describe('configuracionInicial', () => {
  // Excluir o clasificar es una decisión del consultor: tomarla por él es justo el error a evitar.
  it('arranca con todo incluido y sin clasificar', () => {
    const config = configuracionInicial({ FERT: 120, ROH: 900 })
    expect(config.FERT).toEqual({ excluido: false, categorias: [], productos: 120 })
  })

  it('descarta el tipo vacío', () => {
    expect(Object.keys(configuracionInicial({ '': 5, FERT: 1 }))).toEqual(['FERT'])
  })

  it('sin tipos no revienta', () => {
    expect(configuracionInicial()).toEqual({})
  })
})

describe('repartirTipos y sinClasificar', () => {
  const config = {
    FERT: { excluido: false, categorias: ['finished'] },
    ROH: { excluido: false, categorias: [] },
    ZEMP: { excluido: true, categorias: [] },
  }

  it('separa los que se analizan de los que se dejaron fuera', () => {
    expect(repartirTipos(config)).toEqual({ dentro: ['FERT', 'ROH'], fuera: ['ZEMP'] })
  })

  // Es lo primero que hay que saber antes de leer un informe.
  it('dice qué tipos quedaron sin clasificar, sin contar los excluidos', () => {
    expect(sinClasificar(config)).toEqual(['ROH'])
  })

  it('sin configuración no revienta', () => {
    expect(repartirTipos()).toEqual({ dentro: [], fuera: [] })
    expect(sinClasificar()).toEqual([])
  })
})
