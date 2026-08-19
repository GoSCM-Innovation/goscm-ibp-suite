// El cruce del analizador de red, contra IndexedDB de verdad.
//
// Lo que se prueba aquí: que el grafo de cada producto se arme de las tablas correctas, que el
// «consumo local» salga de cruzar la planta de la receta con la planta que produce —el cruce que
// distingue un semiterminado sano de uno roto—, y que el universo incluya lo que se mueve sin estar
// en el maestro.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

import { analizarRedes, grafoDe, hechosDeRed, indicesDeRed } from './network-analyze.js'
import { contar, guardar, leerTramo, olvidarBase } from './explorer-db.js'

/**
 * TERM se fabrica en P1, va a CD y de ahí a un cliente: red sana.
 * ROTO se fabrica en P2, va a BODEGA, y de BODEGA no sale nada: callejón.
 * SEMI se fabrica en P1 y una receta de P1 lo consume: semiterminado local.
 * FANTASMA se mueve en la red y no existe en el maestro de productos.
 */
async function sembrar() {
  await guardar('bom_prd', [
    { PRDID: 'TERM', PRDDESCR: 'Terminado', MATTYPEID: 'FERT' },
    { PRDID: 'ROTO', PRDDESCR: 'Terminado roto', MATTYPEID: 'FERT' },
    { PRDID: 'SEMI', PRDDESCR: 'Semielaborado', MATTYPEID: 'HALB' },
  ])

  await guardar('sn_plant', [
    { SOURCEID: 'S1', PRDID: 'TERM', LOCID: 'P1', PLEADTIME: '2' },
    { SOURCEID: 'S2', PRDID: 'ROTO', LOCID: 'P2', PLEADTIME: '0' },
    { SOURCEID: 'S3', PRDID: 'SEMI', LOCID: 'P1', PLEADTIME: '1' },
  ])

  // La receta S1 (que vive en P1) consume SEMI: consumo local para SEMI.
  await guardar('sn_psi', [{ SOURCEID: 'S1', PRDID: 'SEMI', COMPONENTCOEFFICIENT: '2' }])

  await guardar('sn_loc', [
    { LOCFR: 'P1', LOCID: 'CD', PRDID: 'TERM', TLEADTIME: '1' },
    { LOCFR: 'P2', LOCID: 'BODEGA', PRDID: 'ROTO', TLEADTIME: '1' },
    { LOCFR: 'X', LOCID: 'Y', PRDID: 'FANTASMA', TLEADTIME: '1' },
  ])

  await guardar('sn_cust', [{ LOCID: 'CD', CUSTID: 'CLI1', PRDID: 'TERM', CLEADTIME: '2' }])

  await guardar('sn_loc_prod', [
    { LOCID: 'P1', PRDID: 'TERM' }, { LOCID: 'CD', PRDID: 'TERM' },
    { LOCID: 'P2', PRDID: 'ROTO' }, { LOCID: 'P1', PRDID: 'SEMI' },
  ])
  await guardar('sn_cust_prod', [{ CUSTID: 'CLI1', PRDID: 'TERM' }])
}

const CONFIG = {
  FERT: { excluido: false, categorias: ['finished'] },
  HALB: { excluido: false, categorias: ['semi'] },
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  olvidarBase()
  await sembrar()
})

afterEach(() => { olvidarBase() })

describe('indicesDeRed', () => {
  it('agrupa las plantas por producto, con su plazo', async () => {
    const indices = await indicesDeRed()
    expect(indices.plantasDe.get('TERM')).toEqual(['P1'])
    expect(indices.plazoDePlantaDe.get('TERM|P1')).toBe('2')
  })

  it('agrupa los arcos y los clientes por producto', async () => {
    const indices = await indicesDeRed()
    expect(indices.arcosDe.get('TERM')).toEqual([{ desde: 'P1', hasta: 'CD', plazo: '1' }])
    expect(indices.clientesDe.get('TERM')).toEqual([{ desde: 'CD', cliente: 'CLI1', plazo: '2' }])
  })

  // El cruce que distingue un semiterminado sano de uno roto.
  it('el consumo se anota en la planta de la RECETA que lo consume', async () => {
    const indices = await indicesDeRed()
    expect(indices.consumeEn.get('SEMI')).toEqual(['P1'])
  })

  it('la cobertura sale de sus dos tablas', async () => {
    const indices = await indicesDeRed()
    expect(indices.enLocProduct.has('TERM')).toBe(true)
    expect(indices.enCustProduct.has('TERM')).toBe(true)
    expect(indices.enCustProduct.has('ROTO')).toBe(false)
  })

  it('avisa de cada paso', async () => {
    const pasos = []
    await indicesDeRed({ onAvance: (uno) => pasos.push(uno.paso) })
    expect(pasos).toEqual(['recetas', 'componentes', 'arcos', 'clientes', 'cobertura'])
  })
})

describe('grafoDe', () => {
  it('el grafo lleva la planta, el arco y el cliente', async () => {
    const indices = await indicesDeRed()
    const grafo = grafoDe('TERM', indices)

    expect(grafo.plantas).toEqual(['P1'])
    expect(grafo.ubicaciones.sort()).toEqual(['CD', 'P1'])
    expect(grafo.arcos).toEqual({ P1: ['CD'] })
    expect(grafo.arcosACliente).toEqual({ CD: ['CLI1'] })
  })

  it('los plazos viajan con el arco al que pertenecen', async () => {
    const indices = await indicesDeRed()
    const grafo = grafoDe('TERM', indices)
    expect(grafo.plazoDeArco['P1|CD']).toBe('1')
    expect(grafo.plazoDeCliente['CD|CLI1']).toBe('2')
    expect(grafo.plazoDePlanta.P1).toBe('2')
  })

  it('un arco repetido no se duplica en el grafo', async () => {
    await guardar('sn_loc', [{ LOCFR: 'P1', LOCID: 'CD', PRDID: 'TERM', TLEADTIME: '1' }])
    const indices = await indicesDeRed()
    expect(grafoDe('TERM', indices).arcos.P1).toEqual(['CD'])
  })

  it('un producto sin nada da un grafo vacío', async () => {
    const indices = await indicesDeRed()
    expect(grafoDe('NOEXISTE', indices)).toMatchObject({ plantas: [], ubicaciones: [] })
  })
})

describe('hechosDeRed', () => {
  it('un semiterminado que se consume en su propia planta lo dice', async () => {
    const indices = await indicesDeRed()
    const maestro = new Map([['SEMI', { PRDID: 'SEMI', MATTYPEID: 'HALB' }]])
    expect(hechosDeRed('SEMI', indices, maestro)).toMatchObject({
      enPSH: true, enPSI: true, consumeLocal: true,
    })
  })

  it('lo que solo está en el maestro se marca como huérfano', async () => {
    const indices = await indicesDeRed()
    const maestro = new Map([['SOLO', { PRDID: 'SOLO', MATTYPEID: 'FERT' }]])
    expect(hechosDeRed('SOLO', indices, maestro).soloMaestro).toBe(true)
  })

  it('un producto de la red que no está en el maestro no es huérfano', async () => {
    const indices = await indicesDeRed()
    expect(hechosDeRed('FANTASMA', indices, new Map()).soloMaestro).toBe(false)
  })
})

describe('analizarRedes', () => {
  it('analiza el maestro Y lo que se mueve sin estar en él', async () => {
    const salida = await analizarRedes(CONFIG)
    expect(salida.analizados).toBe(4)

    const filas = await leerTramo('sn_product_web', { desde: 0, cuantos: 20 })
    expect(filas.map((una) => una.c[3]).sort()).toEqual(['FANTASMA', 'ROTO', 'SEMI', 'TERM'])
  })

  it('la red sana sale completa y limpia', async () => {
    await analizarRedes(CONFIG)
    const filas = await leerTramo('sn_product_web', { desde: 0, cuantos: 20 })
    const term = filas.find((una) => una.c[3] === 'TERM')

    expect(term.c[1]).toBe('Red completa')
    expect(term.s).toBe('ok')
  })

  // El hallazgo del analizador: el producto entra en la bodega y no puede salir a ningún cliente.
  it('encuentra el producto que llega a una bodega sin salida', async () => {
    await analizarRedes(CONFIG)
    const filas = await leerTramo('sn_product_web', { desde: 0, cuantos: 20 })
    const roto = filas.find((una) => una.c[3] === 'ROTO')

    expect(roto.s).toBe('red')
    expect(roto.c[2]).toContain('BODEGA')
    expect(roto.c[10]).toBe('1')
  })

  it('el semiterminado consumido en su planta se da por bueno', async () => {
    await analizarRedes(CONFIG)
    const filas = await leerTramo('sn_product_web', { desde: 0, cuantos: 20 })
    const semi = filas.find((una) => una.c[3] === 'SEMI')

    expect(semi.c[1]).toBe('Semiterminado local')
    expect(semi.s).toBe('ok')
  })

  it('el resumen cuenta severidades y estados', async () => {
    const { resumen } = await analizarRedes(CONFIG)
    expect(resumen.total).toBe(4)
    expect(resumen.porSeveridad.red).toBeGreaterThan(0)
    expect(resumen.porEstado.length).toBeGreaterThan(1)
  })

  it('un tipo excluido no se analiza', async () => {
    const salida = await analizarRedes({ ...CONFIG, HALB: { excluido: true, categorias: [] } })
    expect(salida.analizados).toBe(3)
    expect(salida.excluidos).toEqual(['HALB'])
  })

  it('volver a analizar reemplaza el informe', async () => {
    await analizarRedes(CONFIG)
    await analizarRedes(CONFIG)
    expect(await contar('sn_product_web')).toBe(4)
  })

  it('avisa del avance', async () => {
    const pasos = new Set()
    await analizarRedes(CONFIG, { onAvance: (uno) => pasos.add(uno.paso) })
    expect(pasos.has('analizando')).toBe(true)
    expect(pasos.has('guardando')).toBe(true)
  })
})
