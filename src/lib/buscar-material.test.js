// El buscador de material: solo con texto, por código y por descripción, hasta 40, por relevancia.

import { describe, expect, it } from 'vitest'

import { MAXIMO_DE_SUGERENCIAS, buscarMateriales } from './buscar-material.js'

const catalogo = [
  { prdid: '100', descripcion: 'Tornillo' },
  { prdid: 'ABC-1', descripcion: 'Caja 100 unidades' },
  { prdid: 'ZZ100', descripcion: '100 litros de aceite' },
  { prdid: 'ABC-2', descripcion: 'Cinta' },
]

describe('buscarMateriales', () => {
  it('sin texto no ofrece nada', () => {
    expect(buscarMateriales(catalogo, '')).toEqual([])
    expect(buscarMateriales(catalogo, '   ')).toEqual([])
    expect(buscarMateriales(catalogo, undefined)).toEqual([])
  })

  it('sin catálogo tampoco', () => {
    expect(buscarMateriales(null, 'abc')).toEqual([])
  })

  it('busca por código y por descripción, sin distinguir mayúsculas', () => {
    expect(buscarMateriales(catalogo, 'abc').map((uno) => uno.prdid)).toEqual(['ABC-1', 'ABC-2'])
    expect(buscarMateriales(catalogo, 'CINTA').map((uno) => uno.prdid)).toEqual(['ABC-2'])
  })

  // Primero los que EMPIEZAN por lo escrito (código), luego los que empiezan por la descripción, y al
  // final los que lo contienen en cualquiera de las dos.
  it('ordena por relevancia', () => {
    expect(buscarMateriales(catalogo, '100').map((uno) => uno.prdid)).toEqual(['100', 'ZZ100', 'ABC-1'])
  })

  it('una descripción que empieza por el texto va antes que una que solo lo contiene', () => {
    const lista = [
      { prdid: 'A', descripcion: 'Sin el texto xx adentro' },
      { prdid: 'B', descripcion: 'xx al principio' },
    ]
    expect(buscarMateriales(lista, 'xx').map((uno) => uno.prdid)).toEqual(['B', 'A'])
  })

  it('ofrece 40 como máximo', () => {
    const muchos = Array.from({ length: 100 }, (_, i) => ({ prdid: `M${i}`, descripcion: '' }))
    expect(buscarMateriales(muchos, 'm')).toHaveLength(MAXIMO_DE_SUGERENCIAS)
    expect(MAXIMO_DE_SUGERENCIAS).toBe(40)
  })

  it('un material sin descripción no revienta', () => {
    expect(buscarMateriales([{ prdid: 'X1' }], 'x')).toEqual([{ prdid: 'X1' }])
  })
})
