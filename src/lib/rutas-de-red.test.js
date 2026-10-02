// El texto del panel «Rutas»: resumen, filtro, rótulos, traza y CSV, con las palabras de v7.

import { describe, expect, it } from 'vitest'

import { FINALES } from '../../core/ibp/supply-network.js'
import {
  TOPE_DE_FILAS, csvDeRutas, filtrarRutas, nombreDelCsv, notaDeTope, resumenDeRutas, rotuloDeRuta,
  rutaComoTexto, saltosDe, terminaEn, trazaDeRuta,
} from './rutas-de-red.js'

const buena = { planta: 'P1', nodos: ['P1', 'CD'], cliente: 'C1', llegaACliente: true, final: null, ultimo: 'CD' }
const muerta = { planta: 'P1', nodos: ['P1', 'A'], cliente: null, llegaACliente: false, final: FINALES.sinSalida, ultimo: 'A' }
const ciclo = { planta: 'P2', nodos: ['P2', 'X', 'Y'], cliente: null, llegaACliente: false, final: FINALES.ciclo, ultimo: 'Y' }

describe('resumenDeRutas', () => {
  it('«N con llegada a cliente» cuando todas llegan', () => {
    expect(resumenDeRutas({ rutas: [buena, buena] })).toBe('2 con llegada a cliente')
  })

  it('suma las que no llegan, con su causa en singular o plural', () => {
    expect(resumenDeRutas({ rutas: [buena, muerta, ciclo] }))
      .toBe('1 con llegada a cliente · 2 sin llegada a cliente (1 dead-end, 1 ciclo)')
    expect(resumenDeRutas({ rutas: [muerta, muerta, ciclo, ciclo, ciclo] }))
      .toBe('0 con llegada a cliente · 5 sin llegada a cliente (2 dead-ends, 3 ciclos)')
  })

  it('nombra las plantas huérfanas, en singular y en plural', () => {
    expect(resumenDeRutas({ rutas: [muerta], plantasHuerfanas: ['P1'] }))
      .toBe('0 con llegada a cliente · 1 sin llegada a cliente (1 dead-end) · ⚠ 1 planta huérfana: P1')
    expect(resumenDeRutas({ rutas: [muerta, ciclo], plantasHuerfanas: ['P1', 'P2'] }))
      .toContain(' · ⚠ 2 plantas huérfanas: P1, P2')
  })

  it('avisa cuando la lista se recortó', () => {
    expect(resumenDeRutas({ rutas: [buena], truncado: true }))
      .toBe('1 con llegada a cliente (truncadas a 50.000)')
  })

  it('sin rutas dice cero', () => {
    expect(resumenDeRutas({ rutas: [] })).toBe('0 con llegada a cliente')
  })
})

describe('filtrarRutas', () => {
  const rutas = [buena, muerta, ciclo]

  it('sin filtro devuelve todas, con su posición', () => {
    expect(filtrarRutas(rutas).map((una) => una.indice)).toEqual([0, 1, 2])
  })

  it('«Con llegada a cliente» y «Sin llegada a cliente»', () => {
    expect(filtrarRutas(rutas, { tipo: 'cliente' }).map((una) => una.ruta)).toEqual([buena])
    expect(filtrarRutas(rutas, { tipo: 'sinCliente' }).map((una) => una.ruta)).toEqual([muerta, ciclo])
  })

  it('la causa solo cuenta dentro de «Sin llegada»', () => {
    expect(filtrarRutas(rutas, { tipo: 'sinCliente', final: FINALES.ciclo }).map((una) => una.ruta)).toEqual([ciclo])
    expect(filtrarRutas(rutas, { tipo: 'sinCliente', final: FINALES.sinSalida }).map((una) => una.ruta)).toEqual([muerta])
    // Fuera de «Sin llegada», la causa se ignora.
    expect(filtrarRutas(rutas, { tipo: 'todas', final: FINALES.ciclo })).toHaveLength(3)
  })

  it('busca en la planta, los nodos, el cliente y el último nodo, sin distinguir mayúsculas', () => {
    expect(filtrarRutas(rutas, { q: 'c1' }).map((una) => una.ruta)).toEqual([buena])
    expect(filtrarRutas(rutas, { q: ' p2 ' }).map((una) => una.ruta)).toEqual([ciclo])
    expect(filtrarRutas(rutas, { q: 'y' }).map((una) => una.ruta)).toEqual([ciclo])
    expect(filtrarRutas(rutas, { q: 'nadie' })).toEqual([])
  })

  // La tabla enseña la lista filtrada pero la ruta se resalta buscándola en la completa.
  it('conserva la posición en la lista COMPLETA', () => {
    expect(filtrarRutas(rutas, { tipo: 'sinCliente' }).map((una) => una.indice)).toEqual([1, 2])
  })
})

describe('lo que dice cada fila', () => {
  it('la ruta se lee con flechas y termina en el cliente', () => {
    expect(rutaComoTexto(buena)).toBe('P1 → CD → C1')
    expect(rutaComoTexto(muerta)).toBe('P1 → A')
  })

  it('los saltos son un arco menos que nodos, y uno más si entrega', () => {
    expect(saltosDe(buena)).toBe(2)
    expect(saltosDe(muerta)).toBe(1)
    expect(saltosDe(ciclo)).toBe(2)
  })

  it('termina en el cliente, o en el último nodo si no llegó a ninguno', () => {
    expect(terminaEn(buena)).toBe('C1')
    expect(terminaEn(muerta)).toBe('A')
  })

  it('los rótulos son los de v7', () => {
    expect(rotuloDeRuta(buena).texto).toBe('✓ Con llegada a cliente')
    expect(rotuloDeRuta(ciclo).texto).toBe('↻ Sin llegada · Ciclo')
    expect(rotuloDeRuta(muerta).texto).toBe('⚠ Sin llegada · Dead-end')
  })
})

describe('el tope de filas', () => {
  it('son 500', () => { expect(TOPE_DE_FILAS).toBe(500) })

  it('sin pasarse no hay nota', () => {
    expect(notaDeTope(500)).toBe('')
  })

  it('pasándose dice cuántas se ven y manda al CSV', () => {
    expect(notaDeTope(1234)).toBe('Mostrando 500 de 1234 rutas — exporta el CSV para verlas todas.')
  })
})

describe('trazaDeRuta', () => {
  it('lista los nodos, el cliente incluido, y los pares de cada arco', () => {
    expect(trazaDeRuta(buena)).toEqual({
      nodos: ['P1', 'CD', 'C1'],
      pares: [['P1', 'CD'], ['CD', 'C1']],
    })
  })

  it('una ruta sin cliente no tiene el último par', () => {
    expect(trazaDeRuta(ciclo)).toEqual({
      nodos: ['P2', 'X', 'Y'],
      pares: [['P2', 'X'], ['X', 'Y']],
    })
  })

  it('una planta que entrega directo tiene solo el par a cliente', () => {
    const directa = { planta: 'P1', nodos: ['P1'], cliente: 'C1', llegaACliente: true, ultimo: 'P1' }
    expect(trazaDeRuta(directa)).toEqual({ nodos: ['P1', 'C1'], pares: [['P1', 'C1']] })
  })
})

describe('csvDeRutas', () => {
  const lineas = csvDeRutas([buena, muerta, ciclo]).split('\n')

  it('lleva las columnas de v7', () => {
    expect(lineas[0]).toBe('"#","Tipo","Causa","Planta","Ruta","Termina en","Cliente","# Saltos"')
  })

  it('una ruta con cliente: sin causa, con la ruta entre comillas y con «->»', () => {
    expect(lineas[1]).toBe('1,Con llegada a cliente,,P1,"P1 -> CD -> C1",C1,C1,2')
  })

  it('una sin llegada dice su causa y no tiene cliente', () => {
    expect(lineas[2]).toBe('2,Sin llegada a cliente,Dead-end,P1,"P1 -> A",A,,1')
    expect(lineas[3]).toBe('3,Sin llegada a cliente,Ciclo,P2,"P2 -> X -> Y",Y,,2')
  })

  it('separa con coma y con salto de línea, sin marca de codificación', () => {
    const texto = csvDeRutas([buena])
    expect(texto.includes('\r')).toBe(false)
    expect(texto.charCodeAt(0)).toBe('"'.charCodeAt(0))
    expect(texto.split('\n')).toHaveLength(2)
  })

  it('sin rutas solo lleva la cabecera', () => {
    expect(csvDeRutas([])).toBe(lineas[0])
  })

  it('el archivo se llama Rutas_{producto}.csv', () => {
    expect(nombreDelCsv('30000574')).toBe('Rutas_30000574.csv')
    expect(nombreDelCsv('')).toBe('Rutas_producto.csv')
  })
})
