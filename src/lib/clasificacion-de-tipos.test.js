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
  // v7 la guardaba solo por área, y dos tenants con un área del mismo nombre compartían la clasificación.
  it('es por tenant y por área: los tipos y lo que significan son de cada uno', () => {
    expect(claveGuardada('c-1', 'SAP4')).toBe('mattype:c-1:SAP4')
    expect(claveGuardada('c-2', 'SAP4')).not.toBe(claveGuardada('c-1', 'SAP4'))
    expect(claveGuardada('c-1', 'OTRA')).not.toBe(claveGuardada('c-1', 'SAP4'))
  })

  // Una clave sin tenant sería justo la que se comparte entre tenants: mejor ninguna.
  it('sin conexión o sin área no hay clave', () => {
    expect(claveGuardada('', 'SAP4')).toBeNull()
    expect(claveGuardada('c-1', '')).toBeNull()
  })
})

describe('leerGuardada y guardarClasificacion', () => {
  beforeEach(() => { localStorage.clear() })

  it('vuelve lo que se guardó', () => {
    guardarClasificacion('c-1', 'A', { FERT: { excluido: false, categorias: ['terminado'] } })
    expect(leerGuardada('c-1', 'A')).toEqual({ FERT: { excluido: false, categorias: ['terminado'] } })
  })

  // El caso que motivó el cambio: la misma área y el mismo código de tipo en DOS tenants.
  it('lo que se guarda en un tenant no se ve en otro, aunque el área se llame igual', () => {
    guardarClasificacion('c-1', 'A', { ZVER: { excluido: true, categorias: ['semi'] } })
    expect(leerGuardada('c-2', 'A')).toBeNull()
  })

  it('sin conexión no guarda ni lee nada', () => {
    guardarClasificacion('', 'A', { FERT: { excluido: true, categorias: [] } })
    expect(localStorage.length).toBe(0)
    expect(leerGuardada('', 'A')).toBeNull()
  })

  it('sin nada guardado devuelve null, no un objeto vacío', () => {
    // La diferencia importa: null es «nadie clasificó todavía», y {} sería «clasificó y no marcó nada».
    expect(leerGuardada('c-1', 'A')).toBeNull()
  })

  it('con basura guardada devuelve null en vez de reventar la pantalla', () => {
    localStorage.setItem(claveGuardada('c-1', 'A'), '{roto')
    expect(leerGuardada('c-1', 'A')).toBeNull()
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
