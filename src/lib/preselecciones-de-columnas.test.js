// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import {
  borrarPreseleccion, claveDePreselecciones, guardarPreseleccion, leerPreselecciones,
} from './preselecciones-de-columnas.js'

beforeEach(() => { localStorage.clear() })

describe('leerPreselecciones', () => {
  it('sin nada guardado devuelve una lista vacía', () => {
    expect(leerPreselecciones('GIDPRODUCT')).toEqual([])
  })

  it('con basura guardada devuelve vacío en vez de reventar la pantalla', () => {
    localStorage.setItem(claveDePreselecciones('GIDPRODUCT'), '{roto')
    expect(leerPreselecciones('GIDPRODUCT')).toEqual([])
  })

  it('descarta las entradas mal formadas', () => {
    localStorage.setItem(claveDePreselecciones('T'), JSON.stringify([
      { nombre: 'buena', columnas: ['A'] },
      { nombre: 'sin columnas' },
      { columnas: ['B'] },
    ]))
    expect(leerPreselecciones('T')).toEqual([{ nombre: 'buena', columnas: ['A'] }])
  })
})

describe('guardarPreseleccion', () => {
  it('guarda y devuelve la lista', () => {
    expect(guardarPreseleccion('T', 'Las mías', ['PRDID', 'PRDDESCR']))
      .toEqual([{ nombre: 'Las mías', columnas: ['PRDID', 'PRDDESCR'] }])
  })

  it('un nombre repetido REEMPLAZA al anterior, no lo duplica', () => {
    // Quien vuelve a guardar con el mismo nombre está corrigiendo la de antes.
    guardarPreseleccion('T', 'Las mías', ['A'])
    const lista = guardarPreseleccion('T', 'Las mías', ['A', 'B'])
    expect(lista).toEqual([{ nombre: 'Las mías', columnas: ['A', 'B'] }])
  })

  it('las ordena por nombre', () => {
    guardarPreseleccion('T', 'Zeta', ['A'])
    const lista = guardarPreseleccion('T', 'Alfa', ['B'])
    expect(lista.map((una) => una.nombre)).toEqual(['Alfa', 'Zeta'])
  })

  it('un nombre vacío no guarda nada', () => {
    expect(guardarPreseleccion('T', '   ', ['A'])).toEqual([])
  })

  it('cada tabla tiene las suyas: las columnas de una no significan nada en otra', () => {
    guardarPreseleccion('GIDPRODUCT', 'p', ['PRDID'])
    guardarPreseleccion('GIDLOCATION', 'l', ['LOCID'])
    expect(leerPreselecciones('GIDPRODUCT')).toEqual([{ nombre: 'p', columnas: ['PRDID'] }])
    expect(leerPreselecciones('GIDLOCATION')).toEqual([{ nombre: 'l', columnas: ['LOCID'] }])
  })

  it('se guarda una copia: cambiar la lista de después no toca lo guardado', () => {
    const columnas = ['A']
    guardarPreseleccion('T', 'x', columnas)
    columnas.push('B')
    expect(leerPreselecciones('T')[0].columnas).toEqual(['A'])
  })
})

describe('borrarPreseleccion', () => {
  it('quita solo la que se nombra', () => {
    guardarPreseleccion('T', 'a', ['A'])
    guardarPreseleccion('T', 'b', ['B'])
    expect(borrarPreseleccion('T', 'a')).toEqual([{ nombre: 'b', columnas: ['B'] }])
  })

  it('borrar una que no existe no rompe nada', () => {
    guardarPreseleccion('T', 'a', ['A'])
    expect(borrarPreseleccion('T', 'inventada')).toEqual([{ nombre: 'a', columnas: ['A'] }])
  })
})
