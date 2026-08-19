// El cruce de datos del analizador, contra IndexedDB de verdad.
//
// Lo que se prueba aquí y no en el núcleo: que cada hecho salga de la tabla que de verdad lo dice.
// Confundir «lo consume alguien» con «tiene componentes», o tomar la planta del componente en vez de
// la de su receta, da un informe entero equivocado y ninguna prueba del núcleo lo vería.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

import { analizar, hechosDe, juntarHechos, tiposDeMaterial } from './production-analyze.js'
import { guardar, leerTramo, olvidarBase, contar } from './explorer-db.js'

/**
 * TERM (FERT) se fabrica en P1 con la receta S1, lleva SEMI y CAJA.
 * SEMI (HALB) se fabrica en P1 con S2 y lleva MAT.
 * MAT (ROH) se compra: llega un arco a P1.
 * CAJA (ROH) se compra pero NO llega arco a P1 — el problema a encontrar.
 * HUERFANO (FERT) no tiene nada.
 */
async function sembrar() {
  await guardar('bom_prd', [
    { PRDID: 'TERM', PRDDESCR: 'Producto terminado', MATTYPEID: 'FERT' },
    { PRDID: 'SEMI', PRDDESCR: 'Semielaborado', MATTYPEID: 'HALB' },
    { PRDID: 'MAT', PRDDESCR: 'Materia prima', MATTYPEID: 'ROH' },
    { PRDID: 'CAJA', PRDDESCR: 'Caja de carton', MATTYPEID: 'ROH' },
    { PRDID: 'HUERFANO', PRDDESCR: 'Sin nada', MATTYPEID: 'FERT' },
  ])

  await guardar('bom_psh', [
    { SOURCEID: 'S1', PRDID: 'TERM', LOCID: 'P1', SOURCETYPE: 'P', PLEADTIME: '2', OUTPUTCOEFFICIENT: '1' },
    { SOURCEID: 'S2', PRDID: 'SEMI', LOCID: 'P1', SOURCETYPE: 'P', PLEADTIME: '0', OUTPUTCOEFFICIENT: '1' },
    { SOURCEID: 'S2', PRDID: 'RESIDUO', LOCID: 'P1', SOURCETYPE: 'C', OUTPUTCOEFFICIENT: '0.1' },
  ])

  await guardar('bom_psi', [
    { SOURCEID: 'S1', PRDID: 'SEMI', COMPONENTCOEFFICIENT: '2' },
    { SOURCEID: 'S1', PRDID: 'CAJA', COMPONENTCOEFFICIENT: '1' },
    { SOURCEID: 'S2', PRDID: 'MAT', COMPONENTCOEFFICIENT: '5' },
  ])

  await guardar('bom_psr', [{ SOURCEID: 'S1', RESID: 'LINEA_A' }])

  await guardar('sn_loc', [
    { LOCFR: 'PROV', LOCID: 'P1', PRDID: 'MAT', TLEADTIME: '5' },
    { LOCFR: 'P1', LOCID: 'CD', PRDID: 'TERM', TLEADTIME: '1' },
  ])

  await guardar('sn_loc_prod', [
    { LOCID: 'P1', PRDID: 'TERM' },
    { LOCID: 'P1', PRDID: 'SEMI' },
    { LOCID: 'P1', PRDID: 'MAT' },
    { LOCID: 'P1', PRDID: 'CAJA' },
  ])
}

const CONFIG = {
  FERT: { excluido: false, categorias: ['finished'] },
  HALB: { excluido: false, categorias: ['semi'] },
  ROH: { excluido: false, categorias: ['rawmat'] },
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

describe('juntarHechos y hechosDe', () => {
  it('las recetas y sus plantas salen de la cabecera', async () => {
    const indices = await juntarHechos()
    const term = hechosDe('TERM', indices)
    expect(term).toMatchObject({ recetas: ['S1'], plantas: ['P1'], componentes: 2 })
  })

  it('los recursos se suman de todas las recetas del producto', async () => {
    const indices = await juntarHechos()
    expect(hechosDe('TERM', indices).recursos).toEqual(['LINEA_A'])
    expect(hechosDe('SEMI', indices).recursos).toEqual([])
  })

  // La planta la dice la RECETA, no el componente: es el cruce que más fácil se hace mal.
  it('la planta que consume un material sale de la receta que lo lleva', async () => {
    const indices = await juntarHechos()
    expect(hechosDe('MAT', indices).plantasQueLoConsumen).toEqual(['P1'])
    expect(hechosDe('CAJA', indices).plantasQueLoConsumen).toEqual(['P1'])
  })

  it('«lo consume alguien» no es lo mismo que «tiene componentes»', async () => {
    const indices = await juntarHechos()
    expect(hechosDe('MAT', indices).loConsumeAlguien).toBe(true)
    expect(hechosDe('MAT', indices).componentes).toBe(0)
    expect(hechosDe('TERM', indices).loConsumeAlguien).toBe(false)
  })

  it('a qué plantas llega un arco sale de la red', async () => {
    const indices = await juntarHechos()
    expect(hechosDe('MAT', indices).plantasConArcoDeEntrada).toEqual(['P1'])
    expect(hechosDe('CAJA', indices).plantasConArcoDeEntrada).toEqual([])
  })

  // Un producto que solo sale como coproducto no tiene receta propia.
  it('detecta lo que solo existe como coproducto', async () => {
    const indices = await juntarHechos()
    expect(hechosDe('RESIDUO', indices).soloCoproducto).toBe(true)
    expect(hechosDe('SEMI', indices).soloCoproducto).toBe(false)
  })

  // Un cero se guarda como cero y no como «sin dato»: es la diferencia que la comprobación necesita
  // poder decir, aunque las dos acaben marcando.
  it('el plazo sale de la cabecera, y un cero es un cero', async () => {
    const indices = await juntarHechos()
    expect(hechosDe('TERM', indices).plazoDeProduccion).toBe('2')
    expect(hechosDe('SEMI', indices).plazoDeProduccion).toBe('0')
    expect(hechosDe('HUERFANO', indices).plazoDeProduccion).toBe('')
  })

  it('la cobertura en Location Product sale de su tabla', async () => {
    const indices = await juntarHechos()
    expect(hechosDe('TERM', indices).enLocProduct).toBe(true)
    expect(hechosDe('HUERFANO', indices).enLocProduct).toBe(false)
  })

  it('un producto sin nada devuelve todo vacío, no undefined', async () => {
    const indices = await juntarHechos()
    expect(hechosDe('HUERFANO', indices)).toMatchObject({
      recetas: [], plantas: [], componentes: 0, recursos: [], tieneArcosEnRed: false,
    })
  })

  it('avisa de cada paso del recorrido', async () => {
    const pasos = []
    await juntarHechos({ onAvance: (uno) => pasos.push(uno.paso) })
    expect(pasos).toEqual(['productos', 'recetas', 'componentes', 'recursos', 'red', 'cobertura'])
  })
})

describe('analizar', () => {
  it('guarda una fila por producto en la tabla de vista', async () => {
    const salida = await analizar(CONFIG)
    expect(salida.analizados).toBe(5)
    expect(await contar('pa_product_web')).toBe(5)
  })

  // El problema que este analizador existe para encontrar.
  it('encuentra la caja sin arco de abastecimiento', async () => {
    await analizar(CONFIG)
    const filas = await leerTramo('pa_product_web', { desde: 0, cuantos: 50 })
    const caja = filas.find((una) => una.c[2] === 'CAJA')

    expect(caja.s).toBe('red')
    expect(caja.c[1]).toContain('arco de abastecimiento')
  })

  it('la materia prima que sí tiene arco sale limpia', async () => {
    await analizar(CONFIG)
    const filas = await leerTramo('pa_product_web', { desde: 0, cuantos: 50 })
    expect(filas.find((una) => una.c[2] === 'MAT').s).toBe('ok')
  })

  it('el semiterminado sin recurso y con plazo en cero se marca', async () => {
    await analizar(CONFIG)
    const filas = await leerTramo('pa_product_web', { desde: 0, cuantos: 50 })
    const semi = filas.find((una) => una.c[2] === 'SEMI')

    expect(semi.s).toBe('red')
    expect(semi.c[1]).toContain('recurso')
  })

  it('el producto sin nada sale en rojo', async () => {
    await analizar(CONFIG)
    const filas = await leerTramo('pa_product_web', { desde: 0, cuantos: 50 })
    expect(filas.find((una) => una.c[2] === 'HUERFANO').s).toBe('red')
  })

  it('el resumen cuenta por severidad y dice qué falla más', async () => {
    const { resumen } = await analizar(CONFIG)
    expect(resumen.total).toBe(5)
    expect(resumen.porSeveridad.red).toBeGreaterThan(0)
    expect(resumen.masFrecuentes[0].texto).toBeTruthy()
  })

  it('un tipo excluido no se analiza ni se guarda', async () => {
    const salida = await analizar({ ...CONFIG, ROH: { excluido: true, categorias: [] } })
    expect(salida.analizados).toBe(3)
    expect(salida.excluidos).toEqual(['ROH'])
  })

  // Analizar dos veces no acumula: el informe es del último análisis, no de todos.
  it('volver a analizar reemplaza el informe', async () => {
    await analizar(CONFIG)
    await analizar(CONFIG)
    expect(await contar('pa_product_web')).toBe(5)
  })

  it('avisa del avance mientras analiza', async () => {
    const pasos = new Set()
    await analizar(CONFIG, { onAvance: (uno) => pasos.add(uno.paso) })
    expect(pasos.has('analizando')).toBe(true)
    expect(pasos.has('guardando')).toBe(true)
  })
})
