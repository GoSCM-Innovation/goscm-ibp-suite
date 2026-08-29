import { describe, expect, it } from 'vitest'

import {
  ANCHO_MAXIMO_AJUSTADO,
  ANCHO_MAXIMO_AUTOMATICO,
  ANCHO_MINIMO,
  anchoAjustado,
  anchoArrastrado,
  estiloDeAncho,
} from './ancho-de-columna.js'

/** Una regla de mentira: ocho píxeles por carácter, que es el orden de una fuente monoespaciada. */
const ANCHO_DE_CARACTER = 8
const medir = (texto) => texto.length * ANCHO_DE_CARACTER

describe('estiloDeAncho', () => {
  it('sin ancho fijado deja crecer hasta el tope', () => {
    // Sin tope, UNA descripción larga empuja el resto de las columnas fuera de la pantalla.
    expect(estiloDeAncho(null)).toEqual({ maxWidth: ANCHO_MAXIMO_AUTOMATICO })
    expect(estiloDeAncho(0)).toEqual({ maxWidth: ANCHO_MAXIMO_AUTOMATICO })
  })

  it('con ancho fijado lo clava por los tres lados', () => {
    // Los tres, o la tabla lo ignora: `width` sola no manda en una tabla que se autoajusta.
    expect(estiloDeAncho(180)).toEqual({ width: 180, minWidth: 180, maxWidth: 180 })
  })
})

describe('anchoArrastrado', () => {
  it('suma lo que se movió el ratón', () => {
    expect(anchoArrastrado(200, 45)).toBe(245)
  })

  it('encoger funciona', () => {
    expect(anchoArrastrado(200, -60)).toBe(140)
  })

  it('no baja del mínimo, por mucho que se arrastre', () => {
    // Una columna de cero píxeles no se puede volver a agarrar para deshacerlo.
    expect(anchoArrastrado(200, -500)).toBe(ANCHO_MINIMO)
  })
})

describe('anchoAjustado', () => {
  it('se queda con lo más ancho de la columna', () => {
    // «descripción larga» son 17 caracteres; el nombre y la otra celda, menos.
    expect(anchoAjustado('PRD', ['x', 'descripción larga'], medir)).toBe(17 * ANCHO_DE_CARACTER + 28)
  })

  it('cuenta también el nombre de la columna, no solo las celdas', () => {
    expect(anchoAjustado('UNA_COLUMNA_LARGUISIMA', ['x'], medir)).toBe(22 * ANCHO_DE_CARACTER + 28)
  })

  it('a una columna clave le deja sitio para su icono', () => {
    const sinClave = anchoAjustado('PRDIDLARGO', [], medir)
    expect(anchoAjustado('PRDIDLARGO', [], medir, { esClave: true })).toBe(sinClave + 22)
  })

  it('nunca pasa del tope: una celda de mil caracteres no se lleva la pantalla', () => {
    expect(anchoAjustado('X', ['a'.repeat(5000)], medir)).toBe(ANCHO_MAXIMO_AJUSTADO)
  })

  it('nunca baja del mínimo, aunque la columna esté vacía', () => {
    expect(anchoAjustado('', [], medir)).toBe(ANCHO_MINIMO)
  })

  it('los nulos se miden como vacío, no revientan', () => {
    expect(anchoAjustado('AB', [null, undefined, 'abcde'], medir)).toBe(5 * ANCHO_DE_CARACTER + 28)
  })

  it('sin celdas se ajusta al nombre', () => {
    expect(anchoAjustado('ABCDEFGHIJ', undefined, medir)).toBe(10 * ANCHO_DE_CARACTER + 28)
  })
})
