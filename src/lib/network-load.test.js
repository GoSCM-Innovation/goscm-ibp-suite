// La carga de la red contra IndexedDB de verdad (`fake-indexeddb`).
//
// Lo que se comprueba aquí y no en el núcleo: que cada tabla se pida por donde de verdad tiene índice
// —o por su clave, si no lo tiene— y que los componentes se busquen por RECETA y no por producto, que
// es de lo que depende la regla que filtra los arcos de proveedor.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

import { cargarRed, productosConRed } from './network-load.js'
import { guardar, olvidarBase } from './explorer-db.js'
import { CLASES, armarRed } from '../../core/ibp/supply-network.js'

/**
 * PROV1 (proveedor) ──trae MAT──▶ PLANTA1 ──fabrica──▶ EL_PRODUCTO
 * PLANTA1 ──▶ ALMACEN ──▶ CLI1
 * PROV2 trae AJENO, que no está en la receta: no debe salir.
 */
async function sembrar() {
  await guardar('sn_plant', [
    { SOURCEID: 'S1', PRDID: 'EL_PRODUCTO', LOCID: 'PLANTA1', PLEADTIME: '2' },
    { SOURCEID: 'S9', PRDID: 'OTRO_PRODUCTO', LOCID: 'PLANTA9', PLEADTIME: '4' },
  ])

  await guardar('sn_psi', [
    { SOURCEID: 'S1', PRDID: 'MAT', COMPONENTCOEFFICIENT: '3' },
    { SOURCEID: 'S9', PRDID: 'NADA_QUE_VER', COMPONENTCOEFFICIENT: '1' },
  ])

  await guardar('sn_loc', [
    // Arcos del producto terminado.
    { LOCFR: 'PLANTA1', LOCID: 'ALMACEN', PRDID: 'EL_PRODUCTO', TLEADTIME: '1' },
    // Arcos de sus materiales: de aquí salen los proveedores.
    { LOCFR: 'PROV1', LOCID: 'PLANTA1', PRDID: 'MAT', TLEADTIME: '5' },
    { LOCFR: 'PROV2', LOCID: 'PLANTA1', PRDID: 'NADA_QUE_VER', TLEADTIME: '9' },
    { LOCFR: 'X', LOCID: 'Y', PRDID: 'OTRO_PRODUCTO', TLEADTIME: '7' },
  ])

  await guardar('sn_cust', [
    { LOCID: 'ALMACEN', CUSTID: 'CLI1', PRDID: 'EL_PRODUCTO', CLEADTIME: '3' },
    { LOCID: 'ALMACEN', CUSTID: 'CLI9', PRDID: 'OTRO_PRODUCTO', CLEADTIME: '8' },
  ])

  await guardar('bom_loc', [
    { LOCID: 'PROV1', LOCDESCR: 'Proveedor del norte', LOCTYPE: 'V' },
    { LOCID: 'PROV2', LOCDESCR: 'Otro proveedor', LOCTYPE: 'V' },
    { LOCID: 'PLANTA1', LOCDESCR: 'Planta de Quito' },
    { LOCID: 'ALMACEN', LOCDESCR: 'Centro de distribución' },
  ])

  await guardar('sn_cust_master', [
    { CUSTID: 'CLI1', CUSTDESCR: 'Cadena de supermercados' },
    { CUSTID: 'CLI9', CUSTDESCR: 'Otro cliente' },
  ])

  await guardar('bom_prd', [{ PRDID: 'EL_PRODUCTO', PRDDESCR: 'Lo que se vende' }])
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  olvidarBase()
  await sembrar()
})

afterEach(() => { olvidarBase() })

describe('productosConRed', () => {
  // Los materiales también salen: cada uno tiene su propia red, y verla es una pregunta legítima
  // —«¿de dónde me llega este empaque?»—.
  it('lista todo lo que aparece en alguna tabla de la red, ordenado', async () => {
    const lista = await productosConRed()
    expect(lista.map((uno) => uno.prdid))
      .toEqual(['EL_PRODUCTO', 'MAT', 'NADA_QUE_VER', 'OTRO_PRODUCTO'])
  })

  it('cuenta por separado plantas, arcos y clientes', async () => {
    const lista = await productosConRed()
    expect(lista.find((uno) => uno.prdid === 'EL_PRODUCTO'))
      .toEqual({ prdid: 'EL_PRODUCTO', plantas: 1, arcos: 1, clientes: 1 })
  })
})

describe('cargarRed', () => {
  it('trae solo las filas de ESE producto', async () => {
    const datos = await cargarRed('EL_PRODUCTO')
    expect(datos.plantas).toHaveLength(1)
    expect(datos.arcos).toHaveLength(1)
    expect(datos.clientes).toHaveLength(1)
  })

  // Sin esta segunda lectura no hay proveedores en la red, que es media red.
  it('lee también los arcos de los MATERIALES, no solo los del producto', async () => {
    const datos = await cargarRed('EL_PRODUCTO')
    expect(datos.arcosDeComponentes.map((uno) => uno.LOCFR)).toEqual(['PROV1'])
  })

  // De esto depende la regla que filtra los arcos de proveedor: los componentes son de la RECETA.
  it('los componentes se buscan por receta, no por producto', async () => {
    const datos = await cargarRed('EL_PRODUCTO')
    expect(datos.componentes.map((uno) => uno.PRDID)).toEqual(['MAT'])
  })

  it('el plazo de fabricación de cada planta sale de la fila de la receta', async () => {
    const datos = await cargarRed('EL_PRODUCTO')
    expect(datos.plazoDePlanta).toEqual({ PLANTA1: '2' })
  })

  // El maestro se lee entero porque hace falta completo para saber quién es proveedor.
  it('el maestro de ubicaciones llega con LOCTYPE', async () => {
    const datos = await cargarRed('EL_PRODUCTO')
    expect(datos.ubicaciones.PROV1.LOCTYPE).toBe('V')
    expect(datos.ubicaciones.PLANTA1.LOCDESCR).toBe('Planta de Quito')
  })

  it('solo trae los clientes de este producto, no los del tenant', async () => {
    const datos = await cargarRed('EL_PRODUCTO')
    expect(Object.keys(datos.maestroDeClientes)).toEqual(['CLI1'])
    expect(datos.maestroDeClientes.CLI1.CUSTDESCR).toBe('Cadena de supermercados')
  })

  it('trae la descripción del producto', async () => {
    expect((await cargarRed('EL_PRODUCTO')).producto.PRDDESCR).toBe('Lo que se vende')
  })

  it('un producto sin nada en el maestro no rompe la carga', async () => {
    const datos = await cargarRed('FANTASMA')
    expect(datos.producto).toEqual({ PRDID: 'FANTASMA' })
    expect(datos.plantas).toEqual([])
  })

  // La prueba de que la carga y el armado encajan.
  it('lo cargado alcanza para armar la red, con la regla del proveedor aplicada', async () => {
    const red = armarRed('EL_PRODUCTO', await cargarRed('EL_PRODUCTO'))

    const porClase = Object.fromEntries(red.nodos.map((uno) => [uno.id, uno.clase]))
    expect(porClase.PROV1).toBe(CLASES.proveedor)
    expect(porClase.PLANTA1).toBe(CLASES.planta)
    expect(porClase.ALMACEN).toBe(CLASES.ubicacion)
    expect(porClase.CLI1).toBe(CLASES.cliente)

    // PROV2 trae NADA_QUE_VER, que no es material de la receta S1: no llega ni a leerse.
    expect(porClase.PROV2).toBeUndefined()
  })
})
