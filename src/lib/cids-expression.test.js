import { describe, it, expect } from 'vitest'
import {
  analizarCampo,
  esAtomica,
  expandirExpresion,
  quitarParentesisExterior,
} from './cids-expression.js'

/** Un juego de transformaciones encadenadas, como las que trae un dataflow real. */
const transformaciones = {
  Transform1: { fields: [{ name: 'CAMPO_A', proj: 'MARA.MATNR' }] },
  Transform2: {
    fields: [
      { name: 'SUMA', proj: 'MARA.PRECIO + MARA.IMPUESTO' },
      { name: 'DIRECTO', proj: 'Transform1.CAMPO_A' },
      { name: 'CONSTANTE', proj: "'FIJO'" },
      { name: 'SIN_PROY', proj: '' },
    ],
  },
}

describe('esAtomica', () => {
  it.each([
    ['una referencia', 'MARA.MATNR'],
    ['un identificador', 'CAMPO'],
    ['un número', '42'],
    ['un negativo con decimales', '-3.14'],
    ['un literal', "'texto'"],
    ['una referencia entrecomillada', '"/BI0/PSALES_OFF".SALES_OFF'],
    ['una llamada a función completa', 'gen_uuid()'],
    ['una función con argumentos', 'substr(MARA.MATNR, 1, 3)'],
    ['una función anidada', 'upper(trim(MARA.MATNR))'],
    ['vacío', ''],
  ])('%s es atómica', (_, expresion) => {
    expect(esAtomica(expresion)).toBe(true)
  })

  // El motivo de que exista: sustituir `A+B` dentro de otra cuenta sin paréntesis la cambia.
  it.each([
    ['una suma', 'MARA.PRECIO + MARA.IMPUESTO'],
    ['dos funciones sumadas', 'f(a) + g(b)'],
    ['dos grupos seguidos', '(a) + (b)'],
    ['algo antes del paréntesis', 'MARA.X * (a + b)'],
  ])('%s NO es atómica', (_, expresion) => {
    expect(esAtomica(expresion)).toBe(false)
  })
})

describe('quitarParentesisExterior', () => {
  it('quita el que envuelve todo', () => {
    expect(quitarParentesisExterior('(a + b)')).toBe('a + b')
  })

  it('quita varios anidados', () => {
    expect(quitarParentesisExterior('(((a)))')).toBe('a')
  })

  // Acá el paréntesis NO envuelve todo: quitarlo daría `a) + (b`.
  it('no toca dos grupos seguidos', () => {
    expect(quitarParentesisExterior('(a) + (b)')).toBe('(a) + (b)')
  })

  it('no toca una llamada a función', () => {
    expect(quitarParentesisExterior('f(a + b)')).toBe('f(a + b)')
  })

  // Un paréntesis dentro de un texto no cuenta como paréntesis.
  it('respeta los que están dentro de comillas', () => {
    expect(quitarParentesisExterior("('(' + a)")).toBe("'(' + a")
  })

  it('deja en paz lo que no empieza y termina con paréntesis', () => {
    expect(quitarParentesisExterior('a + b')).toBe('a + b')
  })
})

describe('expandirExpresion', () => {
  it('sigue la cadena hasta la tabla real', () => {
    expect(expandirExpresion('Transform1.CAMPO_A', transformaciones)).toBe('MARA.MATNR')
  })

  it('sigue varios saltos', () => {
    expect(expandirExpresion('Transform2.DIRECTO', transformaciones)).toBe('MARA.MATNR')
  })

  it('deja las tablas reales como están', () => {
    expect(expandirExpresion('MARA.MATNR', transformaciones)).toBe('MARA.MATNR')
  })

  // Sin los paréntesis, esto daría `10 * MARA.PRECIO + MARA.IMPUESTO`, que es otra cuenta.
  it('envuelve en paréntesis lo que no es atómico al sustituirlo', () => {
    expect(expandirExpresion('10 * Transform2.SUMA', transformaciones))
      .toBe('10 * (MARA.PRECIO + MARA.IMPUESTO)')
  })

  it('en el nivel de arriba no deja paréntesis de más', () => {
    expect(expandirExpresion('Transform2.SUMA', transformaciones)).toBe('MARA.PRECIO + MARA.IMPUESTO')
  })

  it('un campo sin proyección se deja como estaba', () => {
    expect(expandirExpresion('Transform2.SIN_PROY', transformaciones)).toBe('Transform2.SIN_PROY')
  })

  it('un campo que no existe en la transformación se deja como estaba', () => {
    expect(expandirExpresion('Transform1.NO_EXISTE', transformaciones)).toBe('Transform1.NO_EXISTE')
  })

  // Es el caso que costó una sesión de depuración en v9: sin la regla del "/", el operador de la
  // división se tragaba la referencia siguiente y la expresión quedaba a medio expandir.
  it('una división sin espacios expande las dos referencias', () => {
    expect(expandirExpresion('Transform1.CAMPO_A/Transform1.CAMPO_A', transformaciones))
      .toBe('MARA.MATNR/MARA.MATNR')
  })

  it('los nombres con barra vienen entrecomillados y se respetan', () => {
    const conBarra = { T: { fields: [{ name: 'X', proj: '"/BI0/PSALES_OFF".SALES_OFF' }] } }
    expect(expandirExpresion('T.X', conBarra)).toBe('"/BI0/PSALES_OFF".SALES_OFF')
  })

  // Referencia de tres partes de una llamada RFC: se conserva TABLA.CAMPO y se tira el nombre de la
  // transformación, que no le dice nada a quien lee la documentación.
  it('en una referencia RFC de tres partes deja la tabla y el campo', () => {
    const rfc = {
      Transform3: { fields: [{ name: 'ID', proj: 'ET_BACKORDER.ID' }] },
      Transform4: { fields: [{ name: 'X', proj: 'Transform3.ET_BACKORDER.ID' }] },
    }
    expect(expandirExpresion('Transform4.X', rfc)).toBe('ET_BACKORDER.ID')
  })

  it('una cadena circular no cuelga el navegador', () => {
    const circular = {
      A: { fields: [{ name: 'X', proj: 'B.X' }] },
      B: { fields: [{ name: 'X', proj: 'A.X' }] },
    }
    expect(() => expandirExpresion('A.X', circular)).not.toThrow()
  })

  it('sin expresión no inventa nada', () => {
    expect(expandirExpresion('', transformaciones)).toBe('')
    expect(expandirExpresion(null, transformaciones)).toBe('')
  })
})

describe('analizarCampo', () => {
  const mapaDeEsquemas = { MARA: { table: 'MARA', ds: 'ERP' }, KNA1: { table: 'KNA1', ds: 'CRM' } }

  it('un campo copiado tal cual no tiene operaciones', () => {
    expect(analizarCampo('Transform1.CAMPO_A', transformaciones, mapaDeEsquemas)).toEqual({
      srcDS: 'ERP',
      srcTable: 'MARA',
      srcField: 'MATNR',
      ops: '',
    })
  })

  // Si todas las filas mostraran la expresión, la columna no distinguiría nada.
  it('un campo con cuentas sí las muestra', () => {
    const resultado = analizarCampo('Transform2.SUMA', transformaciones, mapaDeEsquemas)
    expect(resultado.srcField).toBe('PRECIO, IMPUESTO')
    expect(resultado.ops).toBe('MARA.PRECIO + MARA.IMPUESTO')
  })

  it('con varias tablas, cada campo se muestra con la suya delante', () => {
    const dos = { T: { fields: [{ name: 'X', proj: 'MARA.MATNR + KNA1.KUNNR' }] } }
    const resultado = analizarCampo('T.X', dos, mapaDeEsquemas)
    expect(resultado.srcTable).toBe('MARA, KNA1')
    expect(resultado.srcField).toBe('MARA.MATNR, KNA1.KUNNR')
    expect(resultado.srcDS).toBe('ERP, CRM')
  })

  // Un mismo campo puede aparecer varias veces dentro de un ifthenelse.
  it('no repite un campo que aparece dos veces', () => {
    const repetido = { T: { fields: [{ name: 'X', proj: 'ifthenelse(MARA.MATNR = 1, MARA.MATNR, 0)' }] } }
    expect(analizarCampo('T.X', repetido, mapaDeEsquemas).srcField).toBe('MATNR')
  })

  it('una constante se muestra como su propia expresión, sin tabla', () => {
    expect(analizarCampo("'FIJO'", transformaciones, mapaDeEsquemas)).toEqual({
      srcDS: '',
      srcTable: '',
      srcField: "'FIJO'",
      ops: '',
    })
  })

  it('una función sin referencias tampoco tiene tabla', () => {
    const resultado = analizarCampo('gen_uuid()', transformaciones, mapaDeEsquemas)
    expect(resultado.srcTable).toBe('')
    expect(resultado.srcField).toBe('gen_uuid()')
  })

  it('una tabla sin datastore conocido no inventa uno', () => {
    expect(analizarCampo('OTRA.CAMPO', transformaciones, mapaDeEsquemas).srcDS).toBe('')
  })

  it('sin proyección devuelve todo vacío', () => {
    expect(analizarCampo('', transformaciones, mapaDeEsquemas))
      .toEqual({ srcDS: '', srcTable: '', srcField: '', ops: '' })
  })
})
