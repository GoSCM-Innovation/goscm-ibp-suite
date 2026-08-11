import { describe, it, expect } from 'vitest'

import {
  anotarCambio, cambiosParaRevisar, claveDeFila, filasParaBorrar, filasParaModificar, resumirCambios,
} from './master-data-edit.js'

const edits = {
  'P1': {
    fila: { PRDID: 'P1', BRAND: 'ACME', PRDDESCR: 'viejo', PlanningAreaID: 'PA' },
    cambios: { BRAND: 'NUEVA', PRDDESCR: 'nuevo' },
  },
  'P2': {
    fila: { PRDID: 'P2', BRAND: 'OTRA' },
    cambios: { BRAND: 'CAMBIADA' },
  },
}

describe('claveDeFila', () => {
  it('junta las claves de negocio', () => {
    expect(claveDeFila({ A: '1', B: '2', C: '3' }, ['A', 'B'])).toBe('1|2')
  })

  // La posicion en la pagina no identifica nada en cuanto se pasa de pagina.
  it('la misma fila da la misma clave venga de donde venga', () => {
    expect(claveDeFila({ LOCID: '00AA', LOCDESCR: 'x' }, ['LOCID']))
      .toBe(claveDeFila({ LOCID: '00AA', LOCDESCR: 'y' }, ['LOCID']))
  })

  it('sin claves no inventa una', () => {
    expect(claveDeFila({ A: '1' }, [])).toBe('')
  })
})

describe('anotarCambio', () => {
  const fila = { LOCID: '00AA', LOCDESCR: 'Agro America', ZINVALIDO: '' }
  const claves = ['LOCID']

  it('guarda el cambio junto a la fila original', () => {
    const puestos = anotarCambio({}, { fila, campo: 'LOCDESCR', valor: 'otro', claves })

    expect(puestos['00AA'].cambios).toEqual({ LOCDESCR: 'otro' })
    expect(puestos['00AA'].fila).toBe(fila)
  })

  it('acumula varios campos de la misma fila', () => {
    let puestos = anotarCambio({}, { fila, campo: 'LOCDESCR', valor: 'otro', claves })
    puestos = anotarCambio(puestos, { fila, campo: 'ZINVALIDO', valor: 'X', claves })

    expect(puestos['00AA'].cambios).toEqual({ LOCDESCR: 'otro', ZINVALIDO: 'X' })
  })

  // Esto es lo que evita que SAP reescriba lo mismo y que la revision enseñe «ACME → ACME».
  it('volver al valor original quita el cambio', () => {
    let puestos = anotarCambio({}, { fila, campo: 'LOCDESCR', valor: 'otro', claves })
    puestos = anotarCambio(puestos, { fila, campo: 'LOCDESCR', valor: 'Agro America', claves })

    expect(puestos).toEqual({})
  })

  it('volver al original en un campo deja los demas cambios de la fila', () => {
    let puestos = anotarCambio({}, { fila, campo: 'LOCDESCR', valor: 'otro', claves })
    puestos = anotarCambio(puestos, { fila, campo: 'ZINVALIDO', valor: 'X', claves })
    puestos = anotarCambio(puestos, { fila, campo: 'LOCDESCR', valor: 'Agro America', claves })

    expect(puestos['00AA'].cambios).toEqual({ ZINVALIDO: 'X' })
  })

  // Un campo vacio en SAP llega como '' o sin llegar; escribir '' encima no es tocarlo.
  it('dejar vacio un campo que ya estaba vacio no es un cambio', () => {
    expect(anotarCambio({}, { fila, campo: 'ZINVALIDO', valor: '', claves })).toEqual({})
    expect(anotarCambio({}, { fila, campo: 'SINVALOR', valor: '', claves })).toEqual({})
  })

  it('no toca los cambios de las otras filas', () => {
    const otra = { LOCID: '00AB', LOCDESCR: 'Agro Europa' }
    let puestos = anotarCambio({}, { fila, campo: 'LOCDESCR', valor: 'uno', claves })
    puestos = anotarCambio(puestos, { fila: otra, campo: 'LOCDESCR', valor: 'dos', claves })

    expect(Object.keys(puestos)).toEqual(['00AA', '00AB'])
  })

  it('no muta lo que recibe', () => {
    const antes = anotarCambio({}, { fila, campo: 'LOCDESCR', valor: 'otro', claves })
    anotarCambio(antes, { fila, campo: 'ZINVALIDO', valor: 'X', claves })

    expect(antes['00AA'].cambios).toEqual({ LOCDESCR: 'otro' })
  })
})

describe('cambiosParaRevisar', () => {
  // Una fila con tres campos cambiados son tres cosas que comprobar, no una.
  it('aplana a una fila por CAMPO, con el antes y el después', () => {
    const revisar = cambiosParaRevisar(edits, ['PRDID'])

    expect(revisar).toHaveLength(3)
    expect(revisar[0]).toEqual({ identidad: 'P1', campo: 'BRAND', antes: 'ACME', despues: 'NUEVA' })
    expect(revisar[2]).toEqual({ identidad: 'P2', campo: 'BRAND', antes: 'OTRA', despues: 'CAMBIADA' })
  })

  it('la identidad junta todas las claves de negocio', () => {
    const dos = { k: { fila: { A: '1', B: '2' }, cambios: { C: 'x' } } }
    expect(cambiosParaRevisar(dos, ['A', 'B'])[0].identidad).toBe('1 · 2')
  })

  it('sin claves conocidas no deja la fila sin identificar', () => {
    expect(cambiosParaRevisar({ k: { fila: { A: '1' }, cambios: { A: '2' } } }, [])[0].identidad).toBe('1')
  })

  it('un campo que no estaba en la fila se muestra vacío, no undefined', () => {
    const nuevo = { k: { fila: { PRDID: 'P1' }, cambios: { BRAND: 'X' } } }
    expect(cambiosParaRevisar(nuevo, ['PRDID'])[0].antes).toBe('')
  })

  it('sin cambios no hay nada que revisar', () => {
    expect(cambiosParaRevisar({}, ['PRDID'])).toEqual([])
    expect(cambiosParaRevisar(undefined, [])).toEqual([])
  })
})

describe('resumirCambios', () => {
  it('cuenta filas y campos por separado', () => {
    expect(resumirCambios(edits)).toEqual({ filas: 2, campos: 3 })
  })

  it('sin cambios cuenta cero', () => {
    expect(resumirCambios(undefined)).toEqual({ filas: 0, campos: 0 })
  })
})

describe('filasParaModificar', () => {
  // Sin la clave, un cambio de un campo se leería como un registro nuevo con casi todo vacío.
  it('la clave va siempre, aunque no se haya tocado', () => {
    const filas = filasParaModificar(edits, ['PRDID'])
    expect(filas[0]).toMatchObject({ PRDID: 'P1', BRAND: 'NUEVA', PRDDESCR: 'nuevo' })
  })

  it('no manda lo que no se cambió', () => {
    expect(filasParaModificar(edits, ['PRDID'])[1]).toEqual({ PRDID: 'P2', BRAND: 'CAMBIADA' })
  })

  // SAP rechazaría el envío entero por una celda.
  it('un campo de solo lectura no se manda ni aunque lo hayan tocado', () => {
    const tocado = { k: { fila: { PRDID: 'P1' }, cambios: { BRAND: 'X', PlanningAreaID: 'OTRA' } } }
    expect(filasParaModificar(tocado, ['PRDID'])[0]).toEqual({ PRDID: 'P1', BRAND: 'X' })
  })

  it('sin cambios no hay filas', () => {
    expect(filasParaModificar({}, ['PRDID'])).toEqual([])
  })
})

describe('filasParaBorrar', () => {
  // SAP borra por clave; el resto de los campos solo agranda el envío.
  it('manda SOLO las claves', () => {
    const filas = [{ PRDID: 'P1', BRAND: 'ACME', PRDDESCR: 'algo' }]
    expect(filasParaBorrar(filas, ['PRDID'])).toEqual([{ PRDID: 'P1' }])
  })

  it('con clave compuesta manda todas sus partes', () => {
    expect(filasParaBorrar([{ A: '1', B: '2', C: '3' }], ['A', 'B'])).toEqual([{ A: '1', B: '2' }])
  })

  it('sin filas no revienta', () => {
    expect(filasParaBorrar(undefined, ['PRDID'])).toEqual([])
  })
})
