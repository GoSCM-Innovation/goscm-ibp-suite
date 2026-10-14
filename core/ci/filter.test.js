import { describe, expect, it } from 'vitest'
import { escribirFiltro, leerFiltro, motivoDeValorDeFiltroInvalido } from './filter.js'

// Los filtros reales de los bodies que el usuario mostró.
const FILTROS = [
  "MATTYPEID EQ 'ZFER',MATTYPEID EQ 'ZHAW',ZVIGENTE EQ 'S',ZMM_BUSINESSPLAN EQ 'IBP'",
  "ZKFID EQ 'ZFACTURASPOS',KEYFIGUREDATE BT '20230901' '20260831',FKART EQ 'ZFVN',FKART EQ 'ZFBG',FKART EQ 'ZFBN',FKART EQ 'ZFEX',FKART EQ 'ZFTG',MATTYPEID EQ 'ZFER',MATTYPEID EQ 'ZHAW',ZVIGENTE EQ 'S',ZMM_BUSINESSPLAN EQ 'IBP'",
  "AUTYP EQ '40',ZBORRADA EQ 'N',ZENTFINAL EQ 'N',ZSTATEXC EQ 'I0045',MATTYPEID EQ 'ZFER',MATTYPEID EQ 'ZHAW',ZVIGENTE EQ 'S',ZMM_BUSINESSPLAN EQ 'IBP',ZSRCVALID EQ 'S',KEYFIGUREDATE BT '20261005' '20270412'",
  "ZMAESTRO EQ 'RESLOCPRD',WERKS EQ '1001',WERKS EQ '1010',WERKS EQ '1100',MATTYPEID EQ 'ZHAL',MATTYPEID EQ 'ZHIB',MATTYPEID EQ 'ZLEE',MATTYPEID EQ 'ZPTS',MATTYPEID EQ 'ZROH',MATTYPEID EQ 'ZSUM',MATTYPEID EQ 'ZVER',ZVIGENTE EQ 'S'",
]

describe('leerFiltro y escribirFiltro', () => {
  // La garantía del archivo: leer y volver a escribir no cambia lo que se envía.
  it.each(FILTROS)('lo escribe de vuelta idéntico: %s', (filtro) => {
    expect(escribirFiltro(leerFiltro(filtro))).toBe(filtro)
  })

  it('junta los EQ seguidos del mismo campo en una fila', () => {
    const filas = leerFiltro(FILTROS[0])
    expect(filas).toMatchObject([
      { tipo: 'igual', campo: 'MATTYPEID', valores: ['ZFER', 'ZHAW'] },
      { tipo: 'igual', campo: 'ZVIGENTE', valores: ['S'] },
      { tipo: 'igual', campo: 'ZMM_BUSINESSPLAN', valores: ['IBP'] },
    ])
  })

  it('lee un rango como una fila «entre»', () => {
    const filas = leerFiltro(FILTROS[2])
    expect(filas.at(-1)).toMatchObject({ tipo: 'entre', campo: 'KEYFIGUREDATE', desde: '20261005', hasta: '20270412' })
  })

  // Reordenar el filtro cambiaría lo que se envía: solo se juntan las condiciones que ya estaban seguidas.
  it('no junta condiciones del mismo campo separadas por otra', () => {
    const filtro = "A EQ '1',B EQ '2',A EQ '3'"
    const filas = leerFiltro(filtro)
    expect(filas).toHaveLength(3)
    expect(escribirFiltro(filas)).toBe(filtro)
  })

  it('un operador que no se conoce se conserva como texto, sin tocarlo', () => {
    const filtro = "A EQ '1',B NE '2',C GT '5'"
    const filas = leerFiltro(filtro)
    expect(filas.map((fila) => fila.tipo)).toEqual(['igual', 'texto', 'texto'])
    expect(escribirFiltro(filas)).toBe(filtro)
  })

  it('un operador en minúsculas no se reescribe en mayúsculas', () => {
    const filas = leerFiltro("A eq '1'")
    expect(filas).toMatchObject([{ tipo: 'texto', texto: "A eq '1'" }])
    expect(escribirFiltro(filas)).toBe("A eq '1'")
  })

  it('un BT con un solo valor no se entiende y se conserva', () => {
    const filas = leerFiltro("F BT '1'")
    expect(filas[0].tipo).toBe('texto')
  })

  it('un EQ con dos valores no se entiende y se conserva', () => {
    expect(leerFiltro("F EQ '1' '2'")[0].tipo).toBe('texto')
  })

  it('una coma dentro de comillas no parte la condición', () => {
    const filtro = "A EQ 'x,y',B EQ '1'"
    const filas = leerFiltro(filtro)
    expect(filas[0]).toMatchObject({ tipo: 'igual', campo: 'A', valores: ['x,y'] })
    expect(escribirFiltro(filas)).toBe(filtro)
  })

  it('normaliza los espacios de más sin cambiar el sentido', () => {
    expect(escribirFiltro(leerFiltro("A   EQ   '1' , B EQ '2'"))).toBe("A EQ '1',B EQ '2'")
  })

  it('un filtro vacío no tiene filas y se escribe vacío', () => {
    expect(leerFiltro('')).toEqual([])
    expect(leerFiltro(undefined)).toEqual([])
    expect(escribirFiltro([])).toBe('')
  })

  it('ignora las comas dobles y finales', () => {
    expect(escribirFiltro(leerFiltro("A EQ '1',,B EQ '2',"))).toBe("A EQ '1',B EQ '2'")
  })

  it('al escribir, salta las filas incompletas', () => {
    expect(escribirFiltro([
      { tipo: 'igual', campo: '', valores: ['1'] },
      { tipo: 'igual', campo: 'A', valores: ['', '2'] },
      { tipo: 'entre', campo: 'D', desde: '1', hasta: '' },
      { tipo: 'texto', texto: '  ' },
    ])).toBe("A EQ '2'")
  })

  it('una fila «igual» con varios valores se escribe como varias condiciones', () => {
    expect(escribirFiltro([{ tipo: 'igual', campo: 'A', valores: ['1', '2', '3'] }]))
      .toBe("A EQ '1',A EQ '2',A EQ '3'")
  })
})

describe('motivoDeValorDeFiltroInvalido', () => {
  it('rechaza lo que rompería la sintaxis', () => {
    expect(motivoDeValorDeFiltroInvalido("a'b")).toMatch(/comillas/)
    expect(motivoDeValorDeFiltroInvalido('a,b')).toMatch(/comas/)
    expect(motivoDeValorDeFiltroInvalido('ZFER')).toBeNull()
    expect(motivoDeValorDeFiltroInvalido('')).toBeNull()
  })
})
