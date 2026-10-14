import { describe, expect, it } from 'vitest'
import {
  BODY_MAX_BYTES,
  VariableError,
  aplicarVariables,
  esNombreDeVariable,
  extraerMplId,
  leerBody,
  motivoDeValorInvalido,
  normalizarBody,
  resumenDeBody,
  variablesDeBody,
} from './body.js'

// Un body de cifras clave como los que se pegan en Postman (con otro nombre de área).
const KEYFIGURE = {
  KEYFIGURE: {
    BatchCommand: 'REPLACE',
    BatchName: 'PRODCONF_ABIERTAS',
    BatchKey: 'PRODCONF',
    DataSource: 'ZIBP_PRODCONF_KF',
    FieldMapping: 'PRDID:PRDID,KFVALUE:CONFIRMEDPRODUCTION',
    TypeOfData: 'KEYFIGURES',
    PlanningArea: 'AREA_DEMO',
    PlanningAreaVersion: 'PVSMD',
    MaxPackageSize: '104857600',
    FilterForTheDataSource: "AUTYP EQ '40',KEYFIGUREDATE BT '{{FECHA_DESDE}}' '{{FECHA_HASTA}}'",
  },
}
const texto = (objeto) => JSON.stringify(objeto, null, 2)

describe('leerBody', () => {
  it('lee un bloque y dice cómo se llama', () => {
    const leido = leerBody(texto(KEYFIGURE))
    expect(leido.ok).toBe(true)
    expect(leido.clave).toBe('KEYFIGURE')
    expect(leido.bloque.PlanningArea).toBe('AREA_DEMO')
  })

  it.each([
    ['vacío', '', /vacío/],
    ['solo espacios', '   \n ', /vacío/],
    ['JSON roto', '{ "A": ', /JSON válido/],
    ['una lista', '[1,2]', /objeto/],
    ['un número', '3', /objeto/],
    ['un objeto vacío', '{}', /ningún bloque/],
    ['un bloque que no es objeto', '{ "A": "x" }', /tiene que ser un objeto/],
    ['un bloque que es lista', '{ "A": [] }', /tiene que ser un objeto/],
  ])('rechaza %s', (_nombre, entrada, mensaje) => {
    const leido = leerBody(entrada)
    expect(leido.ok).toBe(false)
    expect(leido.error).toMatch(mensaje)
  })

  // Decisión del usuario: varios bloques se hacen encadenando integraciones en una orquestación.
  it('rechaza más de un bloque y manda a la orquestación', () => {
    const leido = leerBody(texto({ A: { X: '1' }, B: { Y: '2' } }))
    expect(leido.ok).toBe(false)
    expect(leido.error).toMatch(/2 bloques \(A, B\)/)
    expect(leido.error).toMatch(/orquestación/)
  })

  it('rechaza un body que pasa del tope', () => {
    const grande = texto({ A: { X: 'x'.repeat(BODY_MAX_BYTES) } })
    expect(leerBody(grande).error).toMatch(/pesa más/)
  })

  it('cuenta los bytes y no los caracteres', () => {
    // 'ñ' ocupa dos bytes: una cadena de pocos caracteres puede pasar del tope.
    const casi = texto({ A: { X: 'ñ'.repeat(BODY_MAX_BYTES / 2 + 10) } })
    expect(leerBody(casi).ok).toBe(false)
  })
})

describe('normalizarBody', () => {
  it('conserva el orden de las claves', () => {
    const original = '{"B":{"Z":"1","A":"2","M":"3"}}'
    const normal = normalizarBody(original)
    expect(Object.keys(JSON.parse(normal).B)).toEqual(['Z', 'A', 'M'])
  })

  it('lanza con un mensaje legible si no vale', () => {
    expect(() => normalizarBody('{ no')).toThrow(/JSON válido/)
  })
})

describe('variablesDeBody', () => {
  it('encuentra las variables de los valores, sin repetir y en orden', () => {
    expect(variablesDeBody(texto(KEYFIGURE))).toEqual(['FECHA_DESDE', 'FECHA_HASTA'])
  })

  it('tolera espacios dentro de las llaves', () => {
    expect(variablesDeBody(texto({ A: { X: '{{ UNA }} y {{OTRA}}' } }))).toEqual(['OTRA', 'UNA'])
  })

  // Las claves no se sustituyen: dejarlo así evita que un valor pueda crear campos nuevos.
  it('no mira las claves', () => {
    expect(variablesDeBody(texto({ A: { '{{CLAVE}}': 'x' } }))).toEqual([])
  })

  it('un body ilegible no tiene variables', () => {
    expect(variablesDeBody('{ roto')).toEqual([])
  })

  it('ignora lo que se parece a una variable pero no lo es', () => {
    expect(variablesDeBody(texto({ A: { X: '{{1MALA}} {FALTA} {{}}' } }))).toEqual([])
  })
})

describe('aplicarVariables', () => {
  const valores = { FECHA_DESDE: '20261005', FECHA_HASTA: '20270412' }

  it('reemplaza dentro de un texto más largo y devuelve JSON compacto', () => {
    const enviado = aplicarVariables(texto(KEYFIGURE), valores)
    expect(enviado).not.toContain('\n')
    expect(JSON.parse(enviado).KEYFIGURE.FilterForTheDataSource)
      .toBe("AUTYP EQ '40',KEYFIGUREDATE BT '20261005' '20270412'")
  })

  it('reemplaza todas las apariciones', () => {
    const enviado = aplicarVariables(texto({ A: { X: '{{V}}-{{V}}', Y: '{{V}}' } }), { V: 'k' })
    expect(JSON.parse(enviado)).toEqual({ A: { X: 'k-k', Y: 'k' } })
  })

  it('un body sin variables se envía igual', () => {
    const sin = texto({ A: { X: '1' } })
    expect(JSON.parse(aplicarVariables(sin, {}))).toEqual({ A: { X: '1' } })
  })

  it('ignora los valores que este body no usa', () => {
    expect(JSON.parse(aplicarVariables(texto({ A: { X: '1' } }), { OTRA: 'z' }))).toEqual({ A: { X: '1' } })
  })

  // Lo que NUNCA debe pasar: mandar «{{FECHA_DESDE}}» tal cual al iFlow como si fuera una fecha.
  it('revienta si falta un valor y dice cuáles', () => {
    expect.assertions(3)
    try {
      aplicarVariables(texto(KEYFIGURE), { FECHA_DESDE: '20261005' })
    } catch (fallo) {
      expect(fallo).toBeInstanceOf(VariableError)
      expect(fallo.message).toMatch(/\{\{FECHA_HASTA\}\}/)
      expect(fallo.faltan).toEqual(['FECHA_HASTA'])
    }
  })

  it('un valor vacío cuenta como faltante', () => {
    expect(() => aplicarVariables(texto(KEYFIGURE), { FECHA_DESDE: '', FECHA_HASTA: '1' })).toThrow(/FECHA_DESDE/)
  })

  it('no hereda valores de Object.prototype', () => {
    expect(() => aplicarVariables(texto({ A: { X: '{{constructor}}' } }), {})).toThrow(/constructor/)
  })

  // El valor se sustituye en el texto ya leído: no puede cerrar la cadena ni abrir otro campo.
  it('un valor con comillas no entra', () => {
    expect(() => aplicarVariables(texto(KEYFIGURE), { FECHA_DESDE: "1' ,FKART EQ 'X", FECHA_HASTA: '2' }))
      .toThrow(/comillas/)
  })

  it('no vuelve a leer lo que acaba de sustituir', () => {
    const enviado = aplicarVariables(texto({ A: { X: '{{A1}}' } }), { A1: '{{OTRA}}' })
    expect(JSON.parse(enviado).A.X).toBe('{{OTRA}}')
  })

  it('respeta lo que no es texto', () => {
    const enviado = aplicarVariables(texto({ A: { N: 5, B: true, L: ['{{V}}'] } }), { V: 'k' })
    expect(JSON.parse(enviado)).toEqual({ A: { N: 5, B: true, L: ['k'] } })
  })
})

describe('motivoDeValorInvalido', () => {
  it.each([
    ['20261005', null],
    ['SB', null],
    ['', 'está vacío'],
    ["a'b", 'comillas'],
    ['a"b', 'comillas'],
    ['a\\b', 'comillas'],
    ['a\nb', 'control'],
    ['x'.repeat(201), '200'],
  ])('%j', (valor, motivo) => {
    const resultado = motivoDeValorInvalido(valor)
    if (motivo === null) expect(resultado).toBeNull()
    else expect(resultado).toContain(motivo)
  })

  it('un valor que no es texto no vale', () => {
    expect(motivoDeValorInvalido(20261005)).toMatch(/texto/)
  })
})

describe('esNombreDeVariable', () => {
  it.each([['FECHA_DESDE', true], ['_x', true], ['a1', true], ['1a', false], ['a-b', false], ['', false], ['a b', false]])(
    '%j', (nombre, esperado) => { expect(esNombreDeVariable(nombre)).toBe(esperado) },
  )
})

describe('resumenDeBody', () => {
  it('saca lo que una lista enseña', () => {
    expect(resumenDeBody(texto(KEYFIGURE))).toMatchObject({
      valido: true,
      clave: 'KEYFIGURE',
      tipo: 'KEYFIGURES',
      comando: 'REPLACE',
      areaDePlanificacion: 'AREA_DEMO',
      version: 'PVSMD',
      nombreDeLote: 'PRODCONF_ABIERTAS',
      variables: ['FECHA_DESDE', 'FECHA_HASTA'],
    })
  })

  it('un body roto dice por qué', () => {
    expect(resumenDeBody('{ no')).toMatchObject({ valido: false })
  })
})

describe('extraerMplId', () => {
  it('lo saca del mensaje real de CPI', () => {
    expect(extraerMplId('An internal server error occured: The MPL ID for the failed message is : AGrOoIkGv-d7sJej0DVu0bhXLV8K'))
      .toBe('AGrOoIkGv-d7sJej0DVu0bhXLV8K')
  })

  it('sin identificador, null', () => {
    expect(extraerMplId('Todo bien')).toBeNull()
    expect(extraerMplId(null)).toBeNull()
  })
})
