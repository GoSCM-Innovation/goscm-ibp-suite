import { describe, it, expect } from 'vitest'

import { cifrasCambiadas, filasDeEdicionDeCifras, resultadoDeEdicion } from './planning-data-edit.js'

const T = 'PERIODID4_TSTAMP'
const fila = (prd, kfa, kfb) => ({ PRDID: prd, LOCID: 'L1', [T]: '/Date(1767225600000)/', KFA: kfa, KFB: kfb })

describe('cifrasCambiadas', () => {
  it('las key figures tocadas, en el orden del nivel aplicado', () => {
    const edits = {
      a: { fila: fila('P1', '1', '2'), cambios: { KFB: '5' } },
      b: { fila: fila('P2', '1', '2'), cambios: { KFA: '7' } },
    }
    expect(cifrasCambiadas(edits, ['KFA', 'KFB'])).toEqual(['KFA', 'KFB'])
  })

  // Dimensiones y tiempo son la identidad de la fila: un cambio sobre ellos no se manda nunca.
  it('un cambio sobre algo que no es key figure del nivel se ignora', () => {
    const edits = { a: { fila: fila('P1', '1', '2'), cambios: { PRDID: 'OTRO' } } }
    expect(cifrasCambiadas(edits, ['KFA'])).toEqual([])
  })
})

describe('filasDeEdicionDeCifras', () => {
  const edits = {
    a: { fila: fila('P1', '1.000000', '2.000000'), cambios: { KFB: '5' } },
    b: { fila: fila('P2', '3.000000', '4.000000'), cambios: { KFA: '7' } },
  }

  it('los campos son dimensiones, key figures cambiadas y tiempo, en ese orden', () => {
    const { campos } = filasDeEdicionDeCifras({ edits, atributos: ['PRDID', 'LOCID'], tiempo: T, cifras: ['KFA', 'KFB', 'KFC'] })
    expect(campos).toEqual(['PRDID', 'LOCID', 'KFA', 'KFB', T])
  })

  // Todas las filas llevan las mismas columnas: la que no cambió en esa fila va con su valor original.
  it('cada fila lleva el nivel, el periodo en ISO y las key figures', () => {
    const { filas, cifras } = filasDeEdicionDeCifras({ edits, atributos: ['PRDID', 'LOCID'], tiempo: T, cifras: ['KFA', 'KFB'] })
    expect(cifras).toEqual(['KFA', 'KFB'])
    expect(filas).toEqual([
      { PRDID: 'P1', LOCID: 'L1', [T]: '2026-01-01T00:00:00', KFA: '1.000000', KFB: '5' },
      { PRDID: 'P2', LOCID: 'L1', [T]: '2026-01-01T00:00:00', KFA: '7', KFB: '4.000000' },
    ])
  })

  it('una key figure sin valor original va como cero, como en v8', () => {
    const suyos = { a: { fila: { PRDID: 'P1', [T]: 'x' }, cambios: { KFB: '5' } }, b: { fila: { PRDID: 'P2', [T]: 'x' }, cambios: { KFA: '1' } } }
    const { filas } = filasDeEdicionDeCifras({ edits: suyos, atributos: ['PRDID'], tiempo: T, cifras: ['KFA', 'KFB'] })
    expect(filas[0].KFA).toBe('0')
  })

  it('sin key figures cambiadas no hay nada que mandar', () => {
    expect(filasDeEdicionDeCifras({ edits: {}, atributos: ['PRDID'], tiempo: T, cifras: ['KFA'] }))
      .toEqual({ campos: [], cifras: [], filas: [] })
  })
})

describe('resultadoDeEdicion', () => {
  it('sin mensajes de rechazo y procesada, bien', () => {
    expect(resultadoDeEdicion({ estado: 'PROCESADA', mensajes: [{ Severity: 'I' }] }, 3))
      .toEqual({ status: 'ok', count: 3, errors: [], message: '' })
  })

  it('un mensaje de gravedad E o A es un registro rechazado', () => {
    const salida = { estado: 'PROCESADA', mensajes: [{ Severity: 'E', Message: 'x' }, { Severity: 'A' }, { Severity: 'W' }] }
    const resultado = resultadoDeEdicion(salida, 3)
    expect(resultado.status).toBe('warning')
    expect(resultado.errors).toHaveLength(2)
  })

  it('una transacción marcada con error es un fallo, con el texto de v8', () => {
    expect(resultadoDeEdicion({ estado: 'CON_ERROR', mensajes: [] }, 1))
      .toMatchObject({ status: 'error', message: 'SAP marcó la transacción con error al procesar.' })
  })
})
