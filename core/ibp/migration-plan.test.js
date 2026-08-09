import { describe, it, expect } from 'vitest'

import {
  compararCampos,
  emparejarTabla,
  emparejarTablas,
  raicesDe,
  resumirPlan,
  revisarEntrada,
  sePuedeCopiar,
} from './migration-plan.js'

describe('raicesDe', () => {
  it('devuelve el nombre entero y lo que queda al quitar prefijos', () => {
    expect(raicesDe('AS1PRODUCT')).toEqual(['AS1PRODUCT', 'S1PRODUCT', '1PRODUCT', 'PRODUCT', 'RODUCT'])
  })

  // Sin un mínimo, cualquier par de nombres compartiría una letra y todo emparejaría con todo.
  it('no baja de cuatro caracteres', () => {
    expect(raicesDe('GIDLAG')).toEqual(['GIDLAG', 'IDLAG', 'DLAG'])
  })

  it('un nombre corto es su única raíz', () => {
    expect(raicesDe('ABCD')).toEqual(['ABCD'])
    expect(raicesDe('AB')).toEqual([])
  })
})

describe('emparejarTabla', () => {
  const destino = ['AS1PRODUCT', 'AS1LOCATION', 'AS1CUSTOMER']

  // Cada tenant le pone su prefijo al mismo tipo: emparejar por nombre exacto no encontraría nada.
  it('empareja por la raíz compartida más larga', () => {
    expect(emparejarTabla('GIDPRODUCT', destino)).toBe('AS1PRODUCT')
    expect(emparejarTabla('GIDLOCATION', destino)).toBe('AS1LOCATION')
  })

  it('el nombre idéntico gana', () => {
    expect(emparejarTabla('AS1PRODUCT', ['ZPRODUCT', 'AS1PRODUCT'])).toBe('AS1PRODUCT')
  })

  it('sin nada parecido devuelve null', () => {
    expect(emparejarTabla('GIDSHELFLIFE', destino)).toBeNull()
  })

  it('sin candidatas no revienta', () => {
    expect(emparejarTabla('GIDPRODUCT', undefined)).toBeNull()
  })

  // `PRODUCTTO` comparte `PRODUCT` con `AS1PRODUCT`, pero su pareja de verdad comparte más.
  it('elige la raíz más larga cuando hay varias parecidas', () => {
    expect(emparejarTabla('GIDPRODUCTTO', ['AS1PRODUCT', 'AS1PRODUCTTO'])).toBe('AS1PRODUCTTO')
  })
})

describe('emparejarTablas', () => {
  it('empareja todas y deja en null las que no encuentran', () => {
    expect(emparejarTablas(['GIDPRODUCT', 'GIDRARO'], ['AS1PRODUCT'])).toEqual([
      { origen: 'GIDPRODUCT', destino: 'AS1PRODUCT' },
      { origen: 'GIDRARO', destino: null },
    ])
  })
})

describe('compararCampos', () => {
  it('separa lo común de lo que sobra a cada lado', () => {
    expect(compararCampos(['A', 'B', 'C'], ['B', 'C', 'D'])).toEqual({
      verificable: true,
      comunes: ['B', 'C'],
      soloEnOrigen: ['A'],
      soloEnDestino: ['D'],
    })
  })

  it('ignora los campos que se le digan', () => {
    expect(compararCampos(['A', 'PlanningAreaID'], ['A'], { ignorar: ['PlanningAreaID'] }))
      .toMatchObject({ comunes: ['A'], soloEnOrigen: [] })
  })

  // Una tabla vacía no tiene fila de muestra de la que deducir columnas.
  it('sin esquema de un lado, la comparación no es verificable', () => {
    expect(compararCampos(null, ['A'])).toMatchObject({ verificable: false, comunes: null })
    expect(compararCampos(['A'], null)).toMatchObject({ verificable: false, comunes: null })
  })
})

describe('revisarEntrada', () => {
  const buena = { destino: 'AS1PRODUCT', verificable: true, comunes: ['A'], soloEnOrigen: [], soloEnDestino: [], filas: 10 }

  it('una tabla emparejada, con columnas y con filas está bien', () => {
    expect(revisarEntrada(buena).estado).toBe('ok')
  })

  it('sin pareja no se puede copiar', () => {
    expect(revisarEntrada({ ...buena, destino: null }).estado).toBe('sin-pareja')
  })

  it('sin columnas comunes tampoco', () => {
    expect(revisarEntrada({ ...buena, comunes: [] }).estado).toBe('sin-campos')
  })

  it('sin poder comparar, se avisa de que se mandaría todo', () => {
    expect(revisarEntrada({ ...buena, verificable: false }).estado).toBe('a-ciegas')
  })

  // Si no hay filas no va a pasar nada, y eso se lee antes que la pérdida de columnas.
  it('una tabla vacía se marca vacía aunque le falten columnas', () => {
    expect(revisarEntrada({ ...buena, filas: 0, soloEnOrigen: ['X'] }).estado).toBe('vacia')
  })

  it('las columnas que se pierden se avisan, en singular y en plural', () => {
    expect(revisarEntrada({ ...buena, soloEnOrigen: ['X'] }).mensaje).toMatch(/1 columna del origen no existe/)
    expect(revisarEntrada({ ...buena, soloEnOrigen: ['X', 'Y'] }).mensaje).toMatch(/2 columnas del origen no existen/)
  })

  // Que el destino tenga columnas de más no impide nada: se quedan como estén.
  it('las columnas de más del destino no son un problema', () => {
    expect(revisarEntrada({ ...buena, soloEnDestino: ['Z'] }).estado).toBe('ok')
  })
})

describe('sePuedeCopiar', () => {
  const buena = { destino: 'D', verificable: true, comunes: ['A'], soloEnOrigen: [], soloEnDestino: [], filas: 10 }

  it('se puede copiar aunque se pierdan columnas', () => {
    expect(sePuedeCopiar({ ...buena, soloEnOrigen: ['X'] })).toBe(true)
  })

  it('no se puede sin pareja, sin columnas ni sin filas', () => {
    expect(sePuedeCopiar({ ...buena, destino: null })).toBe(false)
    expect(sePuedeCopiar({ ...buena, comunes: [] })).toBe(false)
    expect(sePuedeCopiar({ ...buena, filas: 0 })).toBe(false)
  })
})

describe('resumirPlan', () => {
  const entradas = [
    { origen: 'A', destino: 'A2', verificable: true, comunes: ['X'], soloEnOrigen: [], soloEnDestino: [], filas: 100 },
    { origen: 'B', destino: 'B2', verificable: true, comunes: ['X'], soloEnOrigen: ['Y'], soloEnDestino: [], filas: 50 },
    { origen: 'C', destino: null, verificable: false, comunes: null, soloEnOrigen: [], soloEnDestino: [], filas: 999 },
  ]

  // Contar las filas de una tabla que no se va a copiar daría una cifra que no se corresponde con
  // lo que va a pasar.
  it('solo suma las filas de lo que se puede copiar', () => {
    expect(resumirPlan(entradas)).toMatchObject({ tablas: 3, copiables: 2, filas: 150 })
  })

  it('cuenta por estado y marca si hay algo que mirar', () => {
    const resumen = resumirPlan(entradas)
    expect(resumen.porEstado).toEqual({ ok: 1, 'con-perdida': 1, 'sin-pareja': 1 })
    expect(resumen.hayQueMirar).toBe(true)
  })

  it('un plan sin sorpresas no pide que se mire nada', () => {
    expect(resumirPlan([entradas[0]]).hayQueMirar).toBe(false)
  })

  it('un plan vacío no revienta', () => {
    expect(resumirPlan(undefined)).toMatchObject({ tablas: 0, copiables: 0, filas: 0 })
  })
})
