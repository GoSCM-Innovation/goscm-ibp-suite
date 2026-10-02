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
  it('usa las claves de v7 para no perder lo que ya había elegido quien migre', () => {
    guardarCamposAdicionales('pa', 'product', 'SAP4', ['ZGRUPO'])
    expect(JSON.parse(localStorage.getItem('ef_sel_pa_product_SAP4'))).toEqual(['ZGRUPO'])
  })

  it('lee todas las entidades, vacías si no hay nada', () => {
    guardarCamposAdicionales('pa', 'psh', 'SAP4', ['ZPRIO'])
    const leido = leerCamposAdicionales('pa', ENTIDADES, 'SAP4')
    expect(leido.psh).toEqual(['ZPRIO'])
    expect(leido.product).toEqual([])
    expect(Object.keys(leido).sort()).toEqual([...ENTIDADES].sort())
  })

  it('cada área tiene lo suyo', () => {
    guardarCamposAdicionales('pa', 'product', 'A1', ['X'])
    expect(leerCamposAdicionales('pa', ['product'], 'A2').product).toEqual([])
  })

  it('lo ilegible o de otra forma se ignora en vez de romper', () => {
    localStorage.setItem('ef_sel_pa_product_SAP4', '{no es json')
    localStorage.setItem('ef_sel_pa_location_SAP4', JSON.stringify({ no: 'lista' }))
    const leido = leerCamposAdicionales('pa', ['product', 'location'], 'SAP4')
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
