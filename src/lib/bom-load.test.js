// La carga del subárbol contra IndexedDB de verdad (`fake-indexeddb`), no contra un doble.
//
// Es lo que hay que probar aquí: los índices que usa el árbol se llenan leyendo tabla por tabla, y un
// doble de la base habría escondido justo lo que se rompe —pedir por un índice que no existe, o
// indexar los componentes antes que las cabeceras y perder la marca de planta—.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

import { MAX_NIVELES, cargarSubarbol, descripcionesDe, productosConReceta } from './bom-load.js'
import { guardar, olvidarBase } from './explorer-db.js'
import { raicesPorPlanta, armarHijos, armarNodo, TIPOS } from '../../core/ibp/bom-tree.js'

/**
 * PLANTA1: TERMINADO (S1) ← SEMI (S2) ← MATERIA (hoja). S2 saca además COPRODUCTO.
 * PLANTA2: SEMI tiene su propia receta (S3).
 * Y una rama que no toca el árbol de TERMINADO, para comprobar que no se arrastra.
 */
async function sembrar() {
  await guardar('bom_psh', [
    { PRDID: 'TERMINADO', SOURCEID: 'S1', LOCID: 'PLANTA1', SOURCETYPE: 'P', OUTPUTCOEFFICIENT: '1' },
    { PRDID: 'SEMI', SOURCEID: 'S2', LOCID: 'PLANTA1', SOURCETYPE: 'P', OUTPUTCOEFFICIENT: '1' },
    { PRDID: 'COPRODUCTO', SOURCEID: 'S2', LOCID: 'PLANTA1', SOURCETYPE: 'C', OUTPUTCOEFFICIENT: '0,3' },
    { PRDID: 'SEMI', SOURCEID: 'S3', LOCID: 'PLANTA2', SOURCETYPE: 'P', OUTPUTCOEFFICIENT: '1' },
    { PRDID: 'AJENO', SOURCEID: 'S9', LOCID: 'PLANTA1', SOURCETYPE: 'P', OUTPUTCOEFFICIENT: '1' },
  ])

  await guardar('bom_psi', [
    { SOURCEID: 'S1', PRDID: 'SEMI', COMPONENTCOEFFICIENT: '2' },
    { SOURCEID: 'S2', PRDID: 'MATERIA', COMPONENTCOEFFICIENT: '5' },
    { SOURCEID: 'S9', PRDID: 'OTRA_MATERIA', COMPONENTCOEFFICIENT: '1' },
  ])

  await guardar('bom_psr', [{ SOURCEID: 'S1', RESID: 'LINEA_A' }])
  await guardar('bom_psisub', [{ SOURCEID: 'S1', PRDFR: 'SEMI', SPRDFR: 'SEMI_ALT' }])
  await guardar('bom_psi_validity', [
    { SOURCEID: 'S1', PRDID: 'SEMI', COMPVALIDFR: '/Date(1700000000000)/', COMPVALIDTO: '/Date(1800000000000)/' },
  ])

  await guardar('bom_prd', [
    { PRDID: 'TERMINADO', PRDDESCR: 'Producto terminado', MATTYPEID: 'FERT', UOMID: 'CJ' },
    { PRDID: 'SEMI', PRDDESCR: 'Semielaborado', MATTYPEID: 'HALB', UOMID: 'KG' },
    { PRDID: 'MATERIA', PRDDESCR: 'Materia prima', MATTYPEID: 'ROH', UOMID: 'KG' },
    { PRDID: 'COPRODUCTO', PRDDESCR: 'Subproducto', MATTYPEID: 'HALB', UOMID: 'KG' },
    { PRDID: 'AJENO', PRDDESCR: 'Nada que ver', MATTYPEID: 'FERT', UOMID: 'UN' },
  ])

  await guardar('bom_loc', [
    { LOCID: 'PLANTA1', LOCDESCR: 'Planta de Quito' },
    { LOCID: 'PLANTA2', LOCDESCR: 'Planta de Guayaquil' },
  ])
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  olvidarBase()
  await sembrar()
})

afterEach(() => { olvidarBase() })

describe('cargarSubarbol', () => {
  it('indexa las cinco tablas de la receta', async () => {
    const { indices } = await cargarSubarbol('TERMINADO')

    expect(indices.hdrPorSid.S1.LOCID).toBe('PLANTA1')
    expect(indices.itemsPorSid.S1).toHaveLength(1)
    expect(indices.recursosPorSid.S1).toEqual(['LINEA_A'])
    expect(indices.subsPorSid.S1[0]).toMatchObject({ SPRDFR: 'SEMI_ALT' })
    expect(indices.validezPorSid.S1[0]).toMatchObject({ PRDID: 'SEMI' })
  })

  // Lo que se rompería si se indexaran los componentes antes que las cabeceras.
  it('la marca de «es componente en esta planta» queda puesta', async () => {
    const { indices } = await cargarSubarbol('TERMINADO')
    expect(indices.esComponenteEn['PLANTA1|SEMI']).toBe(true)
  })

  it('baja por los componentes hasta la materia prima', async () => {
    const { indices } = await cargarSubarbol('TERMINADO')
    expect(indices.productos.MATERIA?.PRDDESCR).toBe('Materia prima')
  })

  // El coproducto de una receta del camino también entra: es parte de lo que esa receta produce.
  it('trae los coproductos de las recetas que toca', async () => {
    const { indices } = await cargarSubarbol('TERMINADO')
    expect(indices.coprodPorSid.S2).toEqual([
      { prdid: 'COPRODUCTO', coeficiente: '0,3', tipo: 'C' },
    ])
  })

  // La razón de ser de todo esto: no cargar el tenant entero para ver un árbol.
  it('NO arrastra una rama que no tiene nada que ver', async () => {
    const { indices } = await cargarSubarbol('TERMINADO')
    expect(indices.hdrPorSid.S9).toBeUndefined()
    expect(indices.productos.AJENO).toBeUndefined()
  })

  // La receta de SEMI en la otra planta sí entra —SEMI aparece en el camino— pero no debe colarse en
  // el árbol de PLANTA1: de eso se encarga la regla de la planta al armar los hijos.
  it('trae la receta del mismo producto en otra planta, y el árbol no la usa', async () => {
    const { indices } = await cargarSubarbol('TERMINADO')
    expect(indices.hdrPorSid.S3.LOCID).toBe('PLANTA2')

    const raiz = armarNodo('S1', { indices })
    armarHijos(raiz, indices)
    expect(raiz.hijos.map((uno) => uno.receta)).toEqual(['S2'])
  })

  it('el maestro de plantas se lee entero: son pocas', async () => {
    const { indices } = await cargarSubarbol('TERMINADO')
    expect(indices.ubicaciones.PLANTA1.LOCDESCR).toBe('Planta de Quito')
    expect(indices.ubicaciones.PLANTA2.LOCDESCR).toBe('Planta de Guayaquil')
  })

  it('cuenta los niveles recorridos y los productos vistos', async () => {
    const salida = await cargarSubarbol('TERMINADO')
    expect(salida.nivelesRecorridos).toBeGreaterThan(1)
    expect(salida.productos).toBeGreaterThanOrEqual(4)
  })

  // En un árbol grande la espera se nota; sin avance parece que se colgó.
  it('avisa del avance nivel a nivel, y del maestro al final', async () => {
    const avances = []
    await cargarSubarbol('TERMINADO', { onAvance: (uno) => avances.push(uno.nivel) })

    expect(avances[0]).toBe(1)
    expect(avances.at(-1)).toBe('maestro')
  })

  it('sin validez pedida no la lee', async () => {
    const { indices } = await cargarSubarbol('TERMINADO', { conValidez: false })
    expect(indices.validezPorSid).toEqual({})
  })

  it('un producto que no existe da índices vacíos, no un fallo', async () => {
    const { indices } = await cargarSubarbol('NOEXISTE')
    expect(indices.hdrPorSid).toEqual({})
  })

  it('el tope de niveles existe y es holgado', () => {
    expect(MAX_NIVELES).toBeGreaterThan(10)
  })

  // La prueba de que la carga y el armado encajan: el árbol sale entero desde la base.
  it('lo cargado alcanza para armar el árbol de la planta', async () => {
    const { indices } = await cargarSubarbol('TERMINADO')
    const arbol = raicesPorPlanta(indices)

    const raiz = arbol.porPlanta.PLANTA1.find((uno) => uno.prdid === 'TERMINADO')
    armarHijos(raiz, indices)
    const semi = raiz.hijos[0]
    armarHijos(semi, indices)

    expect(semi.prdid).toBe('SEMI')
    expect(semi.hijos[0]).toMatchObject({ prdid: 'MATERIA', tipo: TIPOS.hoja })
  })
})

describe('productosConReceta', () => {
  it('lista cada producto una vez, con sus plantas y cuántas recetas tiene', async () => {
    const lista = await productosConReceta()
    const semi = lista.find((uno) => uno.prdid === 'SEMI')

    expect(semi).toEqual({ prdid: 'SEMI', plantas: ['PLANTA1', 'PLANTA2'], recetas: 2 })
  })

  it('vienen ordenados por identificador', async () => {
    const lista = await productosConReceta()
    expect(lista.map((uno) => uno.prdid)).toEqual([...lista.map((uno) => uno.prdid)].sort())
  })

  it('el límite corta la lista', async () => {
    expect(await productosConReceta({ limite: 2 })).toHaveLength(2)
  })

  it('un producto que solo es componente no aparece: no tiene receta', async () => {
    const lista = await productosConReceta()
    expect(lista.map((uno) => uno.prdid)).not.toContain('MATERIA')
  })
})

describe('descripcionesDe', () => {
  it('devuelve la descripción de cada uno', async () => {
    expect(await descripcionesDe(['SEMI', 'MATERIA'])).toEqual({
      SEMI: 'Semielaborado',
      MATERIA: 'Materia prima',
    })
  })

  it('lo que no está en el maestro simplemente no sale', async () => {
    expect(await descripcionesDe(['NOEXISTE'])).toEqual({})
  })

  it('sin lista no revienta', async () => {
    expect(await descripcionesDe()).toEqual({})
  })
})
