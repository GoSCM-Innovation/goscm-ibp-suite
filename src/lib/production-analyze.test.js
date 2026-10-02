// Los tipos de material del maestro descargado, contra IndexedDB de verdad.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

import { tiposDeMaterial } from './production-analyze.js'
import { guardar, olvidarBase } from './explorer-db.js'

/** Cinco productos de tres tipos: dos FERT, uno HALB y dos ROH. */
async function sembrar() {
  await guardar('bom_prd', [
    { PRDID: 'TERM', PRDDESCR: 'Producto terminado', MATTYPEID: 'FERT' },
    { PRDID: 'SEMI', PRDDESCR: 'Semielaborado', MATTYPEID: 'HALB' },
    { PRDID: 'MAT', PRDDESCR: 'Materia prima', MATTYPEID: 'ROH' },
    { PRDID: 'CAJA', PRDDESCR: 'Caja de carton', MATTYPEID: 'ROH' },
    { PRDID: 'HUERFANO', PRDDESCR: 'Sin nada', MATTYPEID: 'FERT' },
  ])
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  olvidarBase()
  await sembrar()
})

afterEach(() => { olvidarBase() })

describe('tiposDeMaterial', () => {
  it('cuenta los productos de cada tipo', async () => {
    const { cuenta } = await tiposDeMaterial()
    expect(cuenta).toEqual({ FERT: 2, HALB: 1, ROH: 2 })
  })

  it('devuelve la configuración inicial, sin decidir nada por el consultor', async () => {
    const { configuracion } = await tiposDeMaterial()
    expect(configuracion.FERT).toEqual({ excluido: false, categorias: [], productos: 2 })
  })
})
