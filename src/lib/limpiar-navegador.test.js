// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import { abrirBase, anotarOrigen, contar, guardar, olvidarBase } from './explorer-db.js'
import {
  PREFIJOS_DE_DATOS,
  limpiarNavegador,
  olvidarAjustesAntiguos,
  olvidarDatosGuardados,
} from './limpiar-navegador.js'

beforeEach(() => {
  localStorage.clear()
  globalThis.indexedDB = new IDBFactory()
  olvidarBase()
})

/** Una clave de ejemplo por cada prefijo de datos. */
const clavesDeDatos = () => PREFIJOS_DE_DATOS.map((prefijo) => `${prefijo}c-1:SAP4`)

describe('olvidarAjustesAntiguos', () => {
  it('quita las claves de antes de separar por tenant y deja lo demás', () => {
    localStorage.setItem('mattype_SAP4', '{}')
    localStorage.setItem('ef_sel_pa_product_SAP4', '[]')
    localStorage.setItem('mattype:c-1:SAP4', '{}')
    localStorage.setItem('ibp.theme', 'dark')

    expect(olvidarAjustesAntiguos()).toBe(2)
    expect(localStorage.getItem('mattype_SAP4')).toBeNull()
    expect(localStorage.getItem('ef_sel_pa_product_SAP4')).toBeNull()
    expect(localStorage.getItem('mattype:c-1:SAP4')).toBe('{}')
    expect(localStorage.getItem('ibp.theme')).toBe('dark')
  })
})

describe('olvidarDatosGuardados', () => {
  it('borra todo lo que son datos de un tenant', () => {
    for (const clave of clavesDeDatos()) localStorage.setItem(clave, '1')
    olvidarDatosGuardados()
    expect(localStorage.length).toBe(0)
  })

  it('conserva las preferencias: tema, menú, fechas, página y lo propio de cada conexión', () => {
    const preferencias = [
      'ibp.theme', 'menu_minimizado', 'menu_plegados', 'ibp.tz', 'ibp_tz_mode', 'ibp:viewer:pagesize',
      'ibp:viewer:cols:master:c-1:PRODUCT', 'ibp:viewer:presets:master:c-1', 'ibp:viewer:tabs:master:c-1',
      'ibp.cids.pins.c-1', 'ibp.cids.orq-favoritas.c-1', 'ibp_orch_run_c-1',
    ]
    for (const clave of preferencias) localStorage.setItem(clave, '1')
    for (const clave of clavesDeDatos()) localStorage.setItem(clave, '1')

    olvidarDatosGuardados()

    for (const clave of preferencias) expect(localStorage.getItem(clave), clave).toBe('1')
    expect(localStorage.length).toBe(preferencias.length)
  })
})

describe('limpiarNavegador', () => {
  it('borra el localStorage de datos Y la base local', async () => {
    localStorage.setItem('ibp:vsmt:c-1', '{}')
    localStorage.setItem('ibp.theme', 'dark')
    await anotarOrigen({ connectionId: 'c-1', planningArea: 'PA', versionId: 'V1' })
    await guardar('bom_prd', [{ PRDID: 'A' }])
    await expect(contar('bom_prd')).resolves.toBe(1)

    await limpiarNavegador()

    expect(localStorage.getItem('ibp:vsmt:c-1')).toBeNull()
    expect(localStorage.getItem('ibp.theme')).toBe('dark')
    // La base se vuelve a crear vacía al abrirla: lo guardado ya no está.
    await abrirBase()
    await expect(contar('bom_prd')).resolves.toBe(0)
  })

  it('sin base que borrar no falla', async () => {
    await expect(limpiarNavegador()).resolves.toBeUndefined()
  })
})
