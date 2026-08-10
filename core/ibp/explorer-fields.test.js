import { describe, it, expect } from 'vitest'

import {
  NO_EXISTE,
  armarSelect,
  campoReal,
  decidir,
  describirCampo,
  hayDecision,
  normalizarFilas,
  olvidar,
  revisarCampos,
  revisarTodo,
  sugerirCampo,
} from './explorer-fields.js'

const ENTIDAD = 'GIDSOURCECUSTOMER'

describe('campoReal', () => {
  it('sin mapa devuelve el canónico', () => {
    expect(campoReal(undefined, ENTIDAD, 'CLEADTIME')).toBe('CLEADTIME')
    expect(campoReal({}, ENTIDAD, 'CLEADTIME')).toBe('CLEADTIME')
  })

  it('con mapeo devuelve el nombre de este tenant', () => {
    expect(campoReal({ [ENTIDAD]: { CLEADTIME: 'LEADTIME' } }, ENTIDAD, 'CLEADTIME')).toBe('LEADTIME')
  })

  it('un campo confirmado como inexistente devuelve null', () => {
    expect(campoReal({ [ENTIDAD]: { ISALTITEM: NO_EXISTE } }, ENTIDAD, 'ISALTITEM')).toBeNull()
  })

  it('el mapa de otra entidad no se aplica', () => {
    expect(campoReal({ OTRA: { CLEADTIME: 'LEADTIME' } }, ENTIDAD, 'CLEADTIME')).toBe('CLEADTIME')
  })
})

describe('hayDecision', () => {
  // `null` es una respuesta —alguien miró y confirmó que no está—; ausente es que nadie lo revisó.
  it('distingue "confirmado que no existe" de "sin revisar"', () => {
    expect(hayDecision({ [ENTIDAD]: { ISALTITEM: NO_EXISTE } }, ENTIDAD, 'ISALTITEM')).toBe(true)
    expect(hayDecision({ [ENTIDAD]: {} }, ENTIDAD, 'ISALTITEM')).toBe(false)
    expect(hayDecision(undefined, ENTIDAD, 'ISALTITEM')).toBe(false)
  })
})

describe('armarSelect', () => {
  it('sin mapa pide los canónicos', () => {
    expect(armarSelect({}, ENTIDAD, ['PRDID', 'CLEADTIME'])).toEqual(['PRDID', 'CLEADTIME'])
  })

  it('aplica los renombres', () => {
    expect(armarSelect({ [ENTIDAD]: { CLEADTIME: 'LEADTIME' } }, ENTIDAD, ['PRDID', 'CLEADTIME']))
      .toEqual(['PRDID', 'LEADTIME'])
  })

  // Pedir un campo inexistente hace que SAP rechace la consulta ENTERA, no que devuelva la columna
  // vacía. Omitirlo no es una comodidad.
  it('omite los que no existen', () => {
    expect(armarSelect({ [ENTIDAD]: { ISALTITEM: NO_EXISTE } }, ENTIDAD, ['PRDID', 'ISALTITEM']))
      .toEqual(['PRDID'])
  })

  // Dos canónicos pueden mapear al mismo campo real; SAP no quiere el nombre dos veces.
  it('no repite un campo', () => {
    expect(armarSelect({ [ENTIDAD]: { CLEADTIME: 'LEADTIME', TLEADTIME: 'LEADTIME' } }, ENTIDAD,
      ['CLEADTIME', 'TLEADTIME'])).toEqual(['LEADTIME'])
  })

  it('sin campos pedidos no pide nada', () => {
    expect(armarSelect({}, ENTIDAD, [])).toEqual([])
    expect(armarSelect({}, ENTIDAD, undefined)).toEqual([])
  })
})

describe('normalizarFilas', () => {
  // Es lo que evita que el mapeo ensucie las 5.600 líneas de los dos analizadores.
  it('agrega el nombre canónico junto al real', () => {
    const filas = [{ PRDID: 'P1', LEADTIME: 5 }]
    const salida = normalizarFilas({ [ENTIDAD]: { CLEADTIME: 'LEADTIME' } }, ENTIDAD, filas)

    expect(salida[0]).toMatchObject({ PRDID: 'P1', LEADTIME: 5, CLEADTIME: 5 })
  })

  it('sin renombres devuelve las filas tal cual', () => {
    const filas = [{ PRDID: 'P1' }]
    expect(normalizarFilas({}, ENTIDAD, filas)).toBe(filas)
    expect(normalizarFilas({ [ENTIDAD]: { ISALTITEM: NO_EXISTE } }, ENTIDAD, filas)).toBe(filas)
  })

  it('no modifica las filas originales', () => {
    const filas = [{ LEADTIME: 5 }]
    normalizarFilas({ [ENTIDAD]: { CLEADTIME: 'LEADTIME' } }, ENTIDAD, filas)
    expect(filas[0]).not.toHaveProperty('CLEADTIME')
  })

  it('sin filas no revienta', () => {
    expect(normalizarFilas({ [ENTIDAD]: { CLEADTIME: 'LEADTIME' } }, ENTIDAD, undefined)).toEqual([])
  })
})

describe('sugerirCampo', () => {
  it('el nombre exacto gana', () => {
    expect(sugerirCampo('CLEADTIME', ['CLEADTIME', 'LEADTIME'])).toBe('CLEADTIME')
  })

  // `CLEADTIME` y `TLEADTIME` son los dos el `LEADTIME` de algo.
  it('prueba sin el prefijo de tipo', () => {
    expect(sugerirCampo('CLEADTIME', ['PRDID', 'LEADTIME'])).toBe('LEADTIME')
    expect(sugerirCampo('TLEADTIME', ['PRDID', 'LEADTIME'])).toBe('LEADTIME')
  })

  it('después prueba que uno contenga al otro', () => {
    expect(sugerirCampo('LOCDESCR', ['LOCID', 'LOCDESCRIPTION'])).toBe('LOCDESCRIPTION')
  })

  it('sin nada parecido no sugiere', () => {
    expect(sugerirCampo('ISALTITEM', ['PRDID', 'LOCID'])).toBeNull()
    expect(sugerirCampo('ISALTITEM', undefined)).toBeNull()
  })
})

describe('describirCampo', () => {
  // "Mapeá CLEADTIME" no le dice nada a nadie.
  it('explica para qué sirve el campo', () => {
    expect(describirCampo('CLEADTIME')).toMatch(/entrega al cliente/)
  })

  it('un campo sin descripción se muestra por su nombre', () => {
    expect(describirCampo('ZRARO')).toBe('ZRARO')
  })
})

describe('revisarCampos', () => {
  const canonicos = ['PRDID', 'CLEADTIME', 'ISALTITEM']

  it('lo que está en la entidad no se pregunta', () => {
    const salida = revisarCampos({ entidad: ENTIDAD, canonicos, camposReales: canonicos, mapa: {} })
    expect(salida).toMatchObject({ listo: true, faltan: [] })
  })

  it('lo que falta se pregunta, con descripción y sugerencia', () => {
    const salida = revisarCampos({
      entidad: ENTIDAD, canonicos, camposReales: ['PRDID', 'LEADTIME'], mapa: {},
    })

    expect(salida.listo).toBe(false)
    expect(salida.faltan.map((uno) => uno.canonico)).toEqual(['CLEADTIME', 'ISALTITEM'])
    expect(salida.faltan[0]).toMatchObject({ sugerencia: 'LEADTIME' })
    expect(salida.faltan[0].descripcion).toMatch(/entrega al cliente/)
    expect(salida.faltan[1].sugerencia).toBeNull()
  })

  // Se muestra para que se vea que el análisis corre con un mapeo y no con los nombres de fábrica.
  it('lo ya decidido no se vuelve a preguntar y se informa', () => {
    const mapa = { [ENTIDAD]: { CLEADTIME: 'LEADTIME', ISALTITEM: NO_EXISTE } }
    const salida = revisarCampos({ entidad: ENTIDAD, canonicos, camposReales: ['PRDID', 'LEADTIME'], mapa })

    expect(salida).toMatchObject({ listo: true })
    expect(salida.decididas).toEqual([{ canonico: 'CLEADTIME', real: 'LEADTIME' }])
    expect(salida.perdidos).toEqual(['ISALTITEM'])
  })

  it('sin campos conocidos de la entidad, todo queda por preguntar', () => {
    const salida = revisarCampos({ entidad: ENTIDAD, canonicos, camposReales: [], mapa: {} })
    expect(salida.faltan).toHaveLength(3)
  })
})

describe('revisarTodo', () => {
  it('junta varias entidades y dice cuántos campos faltan', () => {
    const salida = revisarTodo([
      { entidad: 'A', canonicos: ['PRDID'], camposReales: ['PRDID'] },
      { entidad: 'B', canonicos: ['CLEADTIME'], camposReales: ['OTRO'] },
    ], {})

    expect(salida).toMatchObject({ listo: false, cuantosFaltan: 1 })
    expect(salida.porEntidad).toHaveLength(2)
  })

  it('todo resuelto queda listo', () => {
    expect(revisarTodo([{ entidad: 'A', canonicos: ['PRDID'], camposReales: ['PRDID'] }], {}))
      .toMatchObject({ listo: true, cuantosFaltan: 0 })
  })

  it('sin nada que revisar está listo', () => {
    expect(revisarTodo(undefined, {})).toMatchObject({ listo: true, cuantosFaltan: 0 })
  })
})

describe('decidir y olvidar', () => {
  it('guarda un renombre sin tocar el mapa recibido', () => {
    const antes = {}
    const despues = decidir(antes, ENTIDAD, 'CLEADTIME', 'LEADTIME')

    expect(despues[ENTIDAD].CLEADTIME).toBe('LEADTIME')
    expect(antes).toEqual({})
  })

  it('guarda que un campo no existe', () => {
    expect(decidir({}, ENTIDAD, 'ISALTITEM', NO_EXISTE)[ENTIDAD].ISALTITEM).toBeNull()
  })

  it('conserva las decisiones anteriores de la misma entidad', () => {
    const mapa = decidir(decidir({}, ENTIDAD, 'A', 'X'), ENTIDAD, 'B', 'Y')
    expect(mapa[ENTIDAD]).toEqual({ A: 'X', B: 'Y' })
  })

  it('olvidar deja el campo por preguntar de nuevo', () => {
    const mapa = decidir({}, ENTIDAD, 'CLEADTIME', 'LEADTIME')
    expect(hayDecision(olvidar(mapa, ENTIDAD, 'CLEADTIME'), ENTIDAD, 'CLEADTIME')).toBe(false)
  })

  // Una entidad sin ninguna decisión no tiene que quedar como una llave vacía.
  it('al olvidar la última decisión, la entidad desaparece del mapa', () => {
    const mapa = decidir({}, ENTIDAD, 'CLEADTIME', 'LEADTIME')
    expect(olvidar(mapa, ENTIDAD, 'CLEADTIME')).toEqual({})
  })

  it('olvidar lo que no está no rompe nada', () => {
    expect(olvidar({}, ENTIDAD, 'CLEADTIME')).toEqual({})
  })
})
