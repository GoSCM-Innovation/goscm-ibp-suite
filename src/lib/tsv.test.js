import { describe, it, expect } from 'vitest'
import { toTsv } from './tsv.js'

describe('toTsv', () => {
  it('separa las columnas con tabuladores y las filas con saltos', () => {
    expect(toTsv([['Estado', 'Tarea'], ['Correcta', 'CARGA_DIARIA']]))
      .toBe('Estado\tTarea\nCorrecta\tCARGA_DIARIA')
  })

  // Si no se limpiaran, un tabulador dentro del nombre de una tarea correría la columna y la
  // tabla pegada saldría desalineada sin que nadie se dé cuenta.
  it('reemplaza tabuladores y saltos dentro de un dato', () => {
    expect(toTsv([['a\tb', 'c\nd', 'e\r\nf']])).toBe('a b\tc d\te f')
  })

  it('deja vacío lo que no hay, sin escribir "null" ni "undefined"', () => {
    expect(toTsv([[null, undefined, '']])).toBe('\t\t')
  })

  it('recorta los espacios de las puntas', () => {
    expect(toTsv([['  hola  ']])).toBe('hola')
  })

  it('acepta números', () => {
    expect(toTsv([[1, 2.5, 0]])).toBe('1\t2.5\t0')
  })

  it('sin filas devuelve texto vacío', () => {
    expect(toTsv([])).toBe('')
  })
})
