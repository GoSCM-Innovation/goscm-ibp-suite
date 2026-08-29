// @vitest-environment jsdom
//
// La clasificación se guarda en `localStorage`, así que estas pruebas necesitan un navegador de
// mentira. El resto del módulo es puro y correría igual sin él.

import { beforeEach, describe, expect, it } from 'vitest'

import {
  claveGuardada,
  guardarClasificacion,
  leerGuardada,
  mezclarClasificacion,
  restablecer,
  resumenDeCategorias,
  resumenDeExclusion,
  resumenDeExtras,
} from './clasificacion-de-tipos.js'

describe('claveGuardada', () => {
  it('es por área: los tipos y lo que significan son de cada una', () => {
    expect(claveGuardada('SAP4')).toBe('mattype_SAP4')
  })

  it('sin área cae en una clave propia en vez de en `mattype_`', () => {
    expect(claveGuardada('')).toBe('mattype_default')
  })
})

describe('leerGuardada y guardarClasificacion', () => {
  beforeEach(() => { localStorage.clear() })

  it('vuelve lo que se guardó', () => {
    guardarClasificacion('A', { FERT: { excluido: false, categorias: ['terminado'] } })
    expect(leerGuardada('A')).toEqual({ FERT: { excluido: false, categorias: ['terminado'] } })
  })

  it('sin nada guardado devuelve null, no un objeto vacío', () => {
    // La diferencia importa: null es «nadie clasificó todavía», y {} sería «clasificó y no marcó nada».
    expect(leerGuardada('A')).toBeNull()
  })

  it('con basura guardada devuelve null en vez de reventar la pantalla', () => {
    localStorage.setItem(claveGuardada('A'), '{roto')
    expect(leerGuardada('A')).toBeNull()
  })
})

describe('mezclarClasificacion', () => {
  const inicial = {
    FERT: { excluido: false, categorias: [] },
    ROH: { excluido: false, categorias: [] },
  }

  it('lo guardado manda sobre lo detectado', () => {
    const salida = mezclarClasificacion(inicial, { ROH: { excluido: true, categorias: ['materia'] } })
    expect(salida.ROH).toMatchObject({ excluido: true, categorias: ['materia'] })
  })

  it('un tipo que ya no existe en el tenant NO reaparece por estar guardado', () => {
    // Reaparecería con cero productos, y quien lea el informe creería que se dejó de usar cuando en
    // realidad se renombró.
    const salida = mezclarClasificacion(inicial, { VIEJO: { excluido: true, categorias: [] } })
    expect(salida.VIEJO).toBeUndefined()
    expect(Object.keys(salida).sort()).toEqual(['FERT', 'ROH'])
  })

  it('sin nada guardado devuelve lo detectado tal cual', () => {
    expect(mezclarClasificacion(inicial, null)).toEqual(inicial)
  })
})

describe('restablecer', () => {
  const puesta = {
    FERT: { excluido: true, categorias: ['terminado'] },
    ROH: { excluido: false, categorias: ['materia'] },
  }

  it('vuelve todo a dentro y sin categorizar', () => {
    const salida = restablecer(puesta)
    expect(salida.FERT).toMatchObject({ excluido: false, categorias: [] })
    expect(salida.ROH).toMatchObject({ excluido: false, categorias: [] })
  })

  it('el paso ② restablece exclusiones sin tocar las categorías', () => {
    const salida = restablecer(puesta, { excluidos: true, categorias: false })
    expect(salida.FERT).toMatchObject({ excluido: false, categorias: ['terminado'] })
  })

  it('el paso ③ restablece categorías sin volver a meter lo excluido', () => {
    const salida = restablecer(puesta, { excluidos: false, categorias: true })
    expect(salida.FERT).toMatchObject({ excluido: true, categorias: [] })
  })
})

describe('los resúmenes de una línea', () => {
  it('el del paso ② dice el texto de v7 cuando nadie tocó nada', () => {
    expect(resumenDeExclusion({ FERT: { excluido: false } }))
      .toBe('Todos los tipos incluidos — sin configurar')
  })

  it('el del paso ② cuenta los excluidos, en singular y en plural', () => {
    expect(resumenDeExclusion({ A: { excluido: true }, B: { excluido: false } })).toBe('1 tipo excluido')
    expect(resumenDeExclusion({ A: { excluido: true }, B: { excluido: true } })).toBe('2 tipos excluidos')
  })

  it('el del paso ③ dice el texto de v7 cuando nadie categorizó', () => {
    expect(resumenDeCategorias({ A: { excluido: false, categorias: [] } }))
      .toBe('Sin categorización — análisis estándar')
  })

  it('el del paso ③ no cuenta los tipos que están excluidos', () => {
    const config = { A: { excluido: true, categorias: [] }, B: { excluido: false, categorias: ['x'] } }
    expect(resumenDeCategorias(config)).toBe('Todos los tipos categorizados')
  })

  it('el del paso ④ cuenta campos de todas las tablas juntas', () => {
    expect(resumenDeExtras({})).toBe('Solo los campos que el análisis necesita')
    expect(resumenDeExtras({ bom_prd: ['A'] })).toBe('1 campo adicional')
    expect(resumenDeExtras({ bom_prd: ['A'], bom_loc: ['B', 'C'] })).toBe('3 campos adicionales')
  })
})
