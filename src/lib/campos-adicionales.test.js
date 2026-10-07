// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import {
  TABLA_DE_ENTIDAD,
  extrasPorTabla,
  guardarCamposAdicionales,
  leerCamposAdicionales,
  totalDeExtras,
} from './campos-adicionales.js'

const ENTIDADES = Object.keys(TABLA_DE_ENTIDAD)

beforeEach(() => { localStorage.clear() })

describe('guardar y leer', () => {
  // v7 las guardaba solo por área (`ef_sel_pa_<entidad>_<área>`); un campo que el otro tenant no tiene
  // hace que SAP rechace la consulta entera.
  it('la clave lleva la conexión, además del área', () => {
    guardarCamposAdicionales('pa', 'product', 'c-1', 'SAP4', ['ZGRUPO'])
    expect(JSON.parse(localStorage.getItem('ef_sel:pa:product:c-1:SAP4'))).toEqual(['ZGRUPO'])
  })

  it('lo elegido en un tenant no se ve en otro, aunque el área se llame igual', () => {
    guardarCamposAdicionales('pa', 'product', 'c-1', 'SAP4', ['ZGRUPO'])
    expect(leerCamposAdicionales('pa', ['product'], 'c-2', 'SAP4').product).toEqual([])
  })

  it('sin conexión no guarda ni lee nada', () => {
    guardarCamposAdicionales('pa', 'product', '', 'SAP4', ['ZGRUPO'])
    expect(localStorage.length).toBe(0)
    expect(leerCamposAdicionales('pa', ['product'], '', 'SAP4').product).toEqual([])
  })

  it('lee todas las entidades, vacías si no hay nada', () => {
    guardarCamposAdicionales('pa', 'psh', 'c-1', 'SAP4', ['ZPRIO'])
    const leido = leerCamposAdicionales('pa', ENTIDADES, 'c-1', 'SAP4')
    expect(leido.psh).toEqual(['ZPRIO'])
    expect(leido.product).toEqual([])
    expect(Object.keys(leido).sort()).toEqual([...ENTIDADES].sort())
  })

  it('cada área tiene lo suyo', () => {
    guardarCamposAdicionales('pa', 'product', 'c-1', 'A1', ['X'])
    expect(leerCamposAdicionales('pa', ['product'], 'c-1', 'A2').product).toEqual([])
  })

  it('lo ilegible o de otra forma se ignora en vez de romper', () => {
    localStorage.setItem('ef_sel:pa:product:c-1:SAP4', '{no es json')
    localStorage.setItem('ef_sel:pa:location:c-1:SAP4', JSON.stringify({ no: 'lista' }))
    const leido = leerCamposAdicionales('pa', ['product', 'location'], 'c-1', 'SAP4')
    expect(leido).toEqual({ product: [], location: [] })
  })
})

describe('para la descarga', () => {
  it('lo pasa de entidad a tabla del plan y omite lo vacío', () => {
    expect(extrasPorTabla({ product: ['A'], location: [], psh: ['B', 'C'] })).toEqual({
      bom_prd: ['A'],
      bom_psh: ['B', 'C'],
    })
  })

  it('cuenta el total', () => {
    expect(totalDeExtras({ product: ['A'], psh: ['B', 'C'] })).toBe(3)
    expect(totalDeExtras({})).toBe(0)
  })
})
