// El cruce de datos del informe de recursos, contra IndexedDB de verdad.
//
// Lo que se prueba aquí y no en el núcleo: que el universo de recursos sea la UNIÓN de las tres tablas
// y no el maestro. Recorrer solo el maestro perdería el caso que más importa —un recurso que una
// receta usa y que no está en el maestro— y el informe diría que todo está bien.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

import { analizar, hechosDe, juntarHechos } from './resource-analyze.js'
import { ESTADOS } from '../../core/ibp/resource-analysis.js'
import { guardar, leerTramo, olvidarBase, contar } from './explorer-db.js'

/**
 * LINEA_A: en el maestro, usada por S1, asignada a P1. Correcta.
 * LINEA_B: en el maestro, asignada a P1, ninguna receta la usa. Aviso.
 * LINEA_C: en el maestro, usada por S3, sin planta asignada. Error.
 * LINEA_Z: solo en el maestro. Huérfano.
 * LINEA_X: NO está en el maestro y S2 la usa. Es la que se perdería recorriendo solo el maestro.
 */
async function sembrar() {
  await guardar('bom_res', [
    { RESID: 'LINEA_A', RESDESCR: 'Linea A' },
    { RESID: 'LINEA_B', RESDESCR: 'Linea B' },
    { RESID: 'LINEA_C', RESDESCR: 'Linea C' },
    { RESID: 'LINEA_Z', RESDESCR: 'Linea sin nada' },
  ])

  await guardar('bom_psh', [
    { SOURCEID: 'S1', PRDID: 'TERM', LOCID: 'P1' },
    { SOURCEID: 'S2', PRDID: 'SEMI', LOCID: 'P1' },
    { SOURCEID: 'S3', PRDID: 'OTRO', LOCID: 'P2' },
  ])

  await guardar('bom_psr', [
    { SOURCEID: 'S1', RESID: 'LINEA_A' },
    { SOURCEID: 'S2', RESID: 'LINEA_X' },
    { SOURCEID: 'S3', RESID: 'LINEA_C' },
  ])

  await guardar('bom_resloc', [
    { RESID: 'LINEA_A', LOCID: 'P1', RESOURCETYPE: 'CAPACITY' },
    { RESID: 'LINEA_B', LOCID: 'P1' },
  ])
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  olvidarBase()
  await sembrar()
})

afterEach(() => { olvidarBase() })

describe('lo que se sabe de un recurso', () => {
  it('las plantas salen de Resource Location y las recetas de PSR', async () => {
    const indices = await juntarHechos()
    expect(hechosDe('LINEA_A', indices)).toMatchObject({
      descripcion: 'Linea A',
      tipo: 'CAPACITY',
      plantas: ['P1'],
      recetas: ['S1'],
    })
  })

  // Comprobado contra dos tenants reales: el maestro de recursos NO tiene el tipo. Está en Resource
  // Location, porque en IBP el mismo recurso puede ser de un tipo distinto en cada planta.
  it('el tipo sale de Resource Location, no del maestro', async () => {
    const indices = await juntarHechos()
    expect(hechosDe('LINEA_A', indices).tipo).toBe('CAPACITY')
    // LINEA_B está asignada a P1 sin tipo: se queda vacío, no se inventa.
    expect(hechosDe('LINEA_B', indices).tipo).toBe('')
    // LINEA_C no está en Resource Location: tampoco tiene de dónde sacarlo.
    expect(hechosDe('LINEA_C', indices).tipo).toBe('')
  })

  // El código de receta no le dice nada a nadie; el producto que sale de ella, sí.
  it('el producto se deduce de la cabecera de la receta que lo usa', async () => {
    const indices = await juntarHechos()
    expect(hechosDe('LINEA_A', indices).productos).toEqual(['TERM'])
    expect(hechosDe('LINEA_C', indices).productos).toEqual(['OTRO'])
  })

  it('un recurso sin nada llega con las listas vacías, no roto', async () => {
    const indices = await juntarHechos()
    expect(hechosDe('LINEA_Z', indices)).toMatchObject({ plantas: [], recetas: [], productos: [] })
  })
})

describe('analizar de punta a punta', () => {
  it('el universo es la unión de las tres tablas, no el maestro', async () => {
    const { analizados } = await analizar()
    // Los cuatro del maestro más LINEA_X, que solo está en PSR.
    expect(analizados).toBe(5)
    expect(await contar('pa_resource_web')).toBe(5)
  })

  it('el recurso que solo está en PSR aparece, y sin planta asignada', async () => {
    await analizar()
    const filas = await leerTramo('pa_resource_web', 0, 100)
    const x = filas.find((una) => una.c[2] === 'LINEA_X')

    expect(x).toBeDefined()
    expect(x.s).toBe('red')
    expect(x.c[1]).toBe(ESTADOS.sinPlanta)
    // No está en el maestro, así que no tiene descripción. Se enseña igual: el hueco es el hallazgo.
    expect(x.c[3]).toBe('')
  })

  it('cada uno sale con el estado que le toca', async () => {
    const { resumen } = await analizar()
    const filas = await leerTramo('pa_resource_web', 0, 100)
    const de = (id) => filas.find((una) => una.c[2] === id)

    expect(de('LINEA_A').s).toBe('ok')
    expect(de('LINEA_B').c[1]).toBe(ESTADOS.sinUso)
    expect(de('LINEA_C').c[1]).toBe(ESTADOS.sinPlanta)
    expect(de('LINEA_Z').c[1]).toBe(ESTADOS.huerfano)

    expect(resumen.porSeveridad).toEqual({ red: 3, yel: 1, info: 0, ok: 1 })
  })

  it('vacía la tabla antes de volver a analizar, para no duplicar', async () => {
    await analizar()
    await analizar()
    expect(await contar('pa_resource_web')).toBe(5)
  })
})
