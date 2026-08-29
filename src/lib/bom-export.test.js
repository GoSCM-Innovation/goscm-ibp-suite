import { describe, expect, it } from 'vitest'

import {
  COLUMNAS, aplanarArbol, hojaDeIndice, hojaDeJerarquia, leerLista, nombreDeArchivo,
} from './bom-export.js'

/** Un nodo del árbol con lo mínimo que el volcado mira. */
const nodo = (extra) => ({
  nivel: 1,
  planta: 'P1',
  receta: 'S1',
  prdid: 'A',
  descripcion: '',
  coeficienteDeEntrada: '',
  coeficienteDeSalida: '',
  unidad: '',
  tipoDeMaterial: '',
  tipoDeReceta: '',
  recursos: [],
  coproductos: [],
  hijos: [],
  ...extra,
})

describe('aplanarArbol', () => {
  it('recorre en el mismo orden en que se lee el árbol', () => {
    const raiz = nodo({
      prdid: 'TERMINADO',
      hijos: [
        nodo({ prdid: 'COMP1', nivel: 2, receta: '', hijos: [] }),
        nodo({
          prdid: 'SEMI',
          nivel: 2,
          receta: 'S2',
          hijos: [nodo({ prdid: 'MP', nivel: 3, receta: '', hijos: [] })],
        }),
      ],
    })

    expect(aplanarArbol([raiz]).map((una) => una.prdid))
      .toEqual(['TERMINADO', 'COMP1', 'SEMI', 'MP'])
  })

  it('cuelga cada fila de su padre, y todas de la raíz', () => {
    const raiz = nodo({
      prdid: 'TERMINADO',
      hijos: [nodo({
        prdid: 'SEMI',
        nivel: 2,
        hijos: [nodo({ prdid: 'MP', nivel: 3, hijos: [] })],
      })],
    })

    const filas = aplanarArbol([raiz])
    expect(filas.map((una) => [una.prdid, una.padre, una.raiz])).toEqual([
      ['TERMINADO', '', 'TERMINADO'],
      ['SEMI', 'TERMINADO', 'TERMINADO'],
      ['MP', 'SEMI', 'TERMINADO'],
    ])
  })

  it('pone el co-producto en el MISMO nivel que su receta, no debajo', () => {
    // La receta produce las dos cosas a la vez: bajarlo un nivel diría que sale del otro.
    const raiz = nodo({
      prdid: 'TERMINADO',
      coproductos: [{ prdid: 'TERMINADO' }, { prdid: 'ASERRIN', coeficiente: '0.3' }],
    })

    const filas = aplanarArbol([raiz])
    expect(filas).toHaveLength(2)
    expect(filas[1]).toMatchObject({
      prdid: 'ASERRIN', nivel: 1, padre: 'TERMINADO', esCoproducto: true, coefSalida: '0.3',
    })
  })

  it('no repite el producto principal como co-producto de sí mismo', () => {
    const raiz = nodo({ prdid: 'A', coproductos: [{ prdid: 'A' }] })
    expect(aplanarArbol([raiz]).map((una) => una.prdid)).toEqual(['A'])
  })

  it('marca el componente alternativo con la X que espera la plantilla', () => {
    const raiz = nodo({
      hijos: [nodo({ prdid: 'ALT', nivel: 2, esAlternativo: 'X', hijos: [] })],
    })
    expect(aplanarArbol([raiz])[1].reemplazante).toBe('X')
  })

  it('junta los recursos de la receta en una sola celda', () => {
    expect(aplanarArbol([nodo({ recursos: ['R1', 'R2'] })])[0].recursos).toBe('R1, R2')
  })

  it('con un bosque vacío devuelve una lista vacía, no revienta', () => {
    expect(aplanarArbol([])).toEqual([])
    expect(aplanarArbol(undefined)).toEqual([])
  })
})

describe('hojaDeJerarquia', () => {
  it('encabeza con las columnas de v7, en su orden', () => {
    const hoja = hojaDeJerarquia([])
    expect(hoja.rows[0].map((una) => una.v)).toEqual([...COLUMNAS])
  })

  it('escribe una fila por nodo, debajo del encabezado', () => {
    const hoja = hojaDeJerarquia(aplanarArbol([nodo({ prdid: 'A', hijos: [nodo({ prdid: 'B', nivel: 2 })] })]))
    expect(hoja.rows).toHaveLength(3)
    expect(hoja.rows[1][5].v).toBe('A')
    expect(hoja.rows[2][5].v).toBe('B')
  })
})

describe('hojaDeIndice', () => {
  it('numera desde 1 y dice qué pasó con cada material', () => {
    const hoja = hojaDeIndice([
      { prdid: 'A', estado: 'Listo', filas: 12, plantas: ['P1', 'P2'] },
      { prdid: 'B', estado: 'Sin jerarquía', filas: 0, plantas: [] },
    ])

    expect(hoja.rows[1].map((una) => una.v)).toEqual([1, 'A', 'Listo', 12, 'P1, P2'])
    expect(hoja.rows[2].map((una) => una.v)).toEqual([2, 'B', 'Sin jerarquía', 0, ''])
  })
})

describe('leerLista', () => {
  it('acepta una por línea, por coma, por punto y coma o por espacios', () => {
    expect(leerLista('A\nB, C;D E')).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('respeta el orden en que se pegaron y quita los repetidos', () => {
    // Quien pega una columna de Excel espera poder comparar las dos columnas fila por fila.
    expect(leerLista('C\nA\nC\nB')).toEqual(['C', 'A', 'B'])
  })

  it('sube a mayúsculas, que es como están las claves de SAP', () => {
    expect(leerLista('abc')).toEqual(['ABC'])
  })

  it('con vacío no devuelve nada', () => {
    expect(leerLista('')).toEqual([])
    expect(leerLista('   \n  ')).toEqual([])
    expect(leerLista(null)).toEqual([])
  })
})

describe('nombreDeArchivo', () => {
  it('lleva el material y la fecha', () => {
    expect(nombreDeArchivo('30000574', '2026-08-28')).toBe('Jerarquia_30000574_2026-08-28.xlsx')
  })

  it('reemplaza lo que no puede ir en un nombre de archivo', () => {
    expect(nombreDeArchivo('A/B:C', '2026-08-28')).toBe('Jerarquia_A_B_C_2026-08-28.xlsx')
  })
})
