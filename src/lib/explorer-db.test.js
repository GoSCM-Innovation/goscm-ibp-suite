// Las pruebas de la base local corren contra `fake-indexeddb`, que implementa la misma norma.
// jsdom no trae IndexedDB, y esta capa es el cimiento de todo el explorador: dejarla sin probar
// significaba descubrir sus fallos dentro de un analizador de dos mil líneas.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

import {
  POR_LOTE,
  anotarOrigen,
  contar,
  guardar,
  leerPorIndice,
  leerTramo,
  leerUno,
  olvidarBase,
  origenGuardado,
  porCursor,
  prepararPara,
  vaciar,
  vaciarTodo,
} from './explorer-db.js'

const ORIGEN = { connectionId: 'c-1', planningArea: 'PA', versionId: 'V1' }

/** Cada prueba con una base nueva: si no, lo escrito por una se ve en la siguiente. */
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  olvidarBase()
})

afterEach(() => { olvidarBase() })

const fuente = (sourceid, extra = {}) => ({ SOURCEID: sourceid, ...extra })

describe('guardar y leer', () => {
  it('guarda y cuenta', async () => {
    await guardar('bom_psi', [fuente('S1'), fuente('S2')])
    await expect(contar('bom_psi')).resolves.toBe(2)
  })

  it('una tabla con clave propia guarda una fila por clave', async () => {
    await guardar('bom_prd', [{ PRDID: 'P1', PRDDESCR: 'viejo' }])
    await guardar('bom_prd', [{ PRDID: 'P1', PRDDESCR: 'nuevo' }])

    await expect(contar('bom_prd')).resolves.toBe(1)
    await expect(leerUno('bom_prd', 'P1')).resolves.toMatchObject({ PRDDESCR: 'nuevo' })
  })

  it('guardar nada no es un error', async () => {
    await expect(guardar('bom_psi', [])).resolves.toBe(0)
    await expect(guardar('bom_psi', undefined)).resolves.toBe(0)
  })

  // Una transacción con cientos de miles de `put` mantiene todo pendiente hasta el final.
  it('parte en lotes y no pierde ninguna fila', async () => {
    const muchas = Array.from({ length: POR_LOTE + 250 }, (_, i) => fuente(`S${i}`))
    await expect(guardar('bom_psi', muchas)).resolves.toBe(muchas.length)
    await expect(contar('bom_psi')).resolves.toBe(muchas.length)
  })

  // Abrir una transacción sobre una tabla inexistente da un error que no explica nada.
  it('una tabla que no existe se dice antes de tocar la base', async () => {
    await expect(guardar('inventada', [{ a: 1 }])).rejects.toThrow(/No existe la tabla local/)
  })
})

describe('leerPorIndice', () => {
  it('trae solo las filas de ese valor', async () => {
    await guardar('bom_psi', [fuente('S1', { PRDID: 'A' }), fuente('S1', { PRDID: 'B' }), fuente('S2')])
    const suyas = await leerPorIndice('bom_psi', 'by_sourceid', 'S1')
    expect(suyas.map((una) => una.PRDID).sort()).toEqual(['A', 'B'])
  })

  it('un valor sin filas devuelve una lista vacía', async () => {
    await expect(leerPorIndice('bom_psi', 'by_sourceid', 'NADA')).resolves.toEqual([])
  })

  it('cuenta por índice sin traer las filas', async () => {
    await guardar('sn_loc_prod', [{ PRDID: 'A', LOCID: '1' }, { PRDID: 'A', LOCID: '2' }, { PRDID: 'B', LOCID: '1' }])
    await expect(contar('sn_loc_prod', { indice: 'by_prdid', valor: 'A' })).resolves.toBe(2)
  })
})

describe('porCursor', () => {
  it('pasa cada fila sin acumularlas', async () => {
    await guardar('bom_psi', [fuente('S1'), fuente('S2'), fuente('S3')])

    const vistas = []
    const total = await porCursor('bom_psi', (fila) => { vistas.push(fila.SOURCEID) })
    expect(total).toBe(3)
    expect(vistas.sort()).toEqual(['S1', 'S2', 'S3'])
  })

  // Sirve para "busca el primero que cumpla" sin recorrer doscientas mil filas.
  it('devolver false corta el recorrido', async () => {
    await guardar('bom_psi', Array.from({ length: 50 }, (_, i) => fuente(`S${i}`)))

    let vistas = 0
    const total = await porCursor('bom_psi', () => { vistas += 1; return vistas < 5 })
    expect(vistas).toBe(5)
    expect(total).toBe(5)
  })

  it('recorre solo un valor del índice si se le pide', async () => {
    await guardar('bom_psi', [fuente('S1'), fuente('S1'), fuente('S2')])
    await expect(porCursor('bom_psi', () => {}, { indice: 'by_sourceid', valor: 'S1' })).resolves.toBe(2)
  })

  it('una tabla vacía recorre cero filas', async () => {
    await expect(porCursor('bom_psi', () => {})).resolves.toBe(0)
  })

  it('da la posición de cada fila', async () => {
    await guardar('bom_psi', [fuente('S1'), fuente('S2')])
    const posiciones = []
    await porCursor('bom_psi', (_, posicion) => { posiciones.push(posicion) })
    expect(posiciones).toEqual([0, 1])
  })
})

describe('leerTramo', () => {
  beforeEach(async () => {
    await guardar('pa_psi_web', Array.from({ length: 25 }, (_, i) => ({ c: [`fila ${i}`], s: i % 3 === 0 ? 'red' : 'ok' })))
  })

  it('trae la página pedida', async () => {
    const primera = await leerTramo('pa_psi_web', { desde: 0, cuantos: 10 })
    const segunda = await leerTramo('pa_psi_web', { desde: 10, cuantos: 10 })

    expect(primera).toHaveLength(10)
    expect(segunda).toHaveLength(10)
    expect(primera[0].c[0]).not.toBe(segunda[0].c[0])
  })

  it('la última página trae lo que queda, no un hueco', async () => {
    await expect(leerTramo('pa_psi_web', { desde: 20, cuantos: 10 })).resolves.toHaveLength(5)
  })

  it('pasado el final no devuelve nada', async () => {
    await expect(leerTramo('pa_psi_web', { desde: 100, cuantos: 10 })).resolves.toEqual([])
  })

  // Es para lo que existe el índice por severidad.
  it('puede paginar solo un valor del índice', async () => {
    const rojas = await leerTramo('pa_psi_web', { desde: 0, cuantos: 50, indice: 'by_severity', valor: 'red' })
    expect(rojas.length).toBeGreaterThan(0)
    expect(rojas.every((una) => una.s === 'red')).toBe(true)
  })
})

describe('vaciar', () => {
  it('deja la tabla en cero', async () => {
    await guardar('bom_psi', [fuente('S1')])
    await vaciar('bom_psi')
    await expect(contar('bom_psi')).resolves.toBe(0)
  })

  it('vaciarTodo alcanza a las de datos y a las de vista', async () => {
    await guardar('bom_psi', [fuente('S1')])
    await guardar('pa_psi_web', [{ c: ['x'], s: 'ok' }])

    await vaciarTodo()
    await expect(contar('bom_psi')).resolves.toBe(0)
    await expect(contar('pa_psi_web')).resolves.toBe(0)
  })
})

describe('marca de origen', () => {
  it('sin nada guardado no hay origen', async () => {
    await expect(origenGuardado()).resolves.toBeNull()
  })

  it('anota y recuerda de dónde salió lo guardado', async () => {
    await anotarOrigen(ORIGEN)
    await expect(origenGuardado()).resolves.toBe('c-1|PA|V1')
  })
})

describe('prepararPara', () => {
  it('con la base vacía no borra nada', async () => {
    await expect(prepararPara(ORIGEN)).resolves.toMatchObject({ seVacio: false })
    await expect(origenGuardado()).resolves.toBe('c-1|PA|V1')
  })

  it('con datos del mismo origen los conserva', async () => {
    await prepararPara(ORIGEN)
    await guardar('bom_psi', [fuente('S1')])

    await expect(prepararPara(ORIGEN)).resolves.toMatchObject({ seVacio: false })
    await expect(contar('bom_psi')).resolves.toBe(1)
  })

  // Mezclar los datos de dos tenants no se notaría hasta que alguien lea un número raro.
  it('al cambiar de tenant borra lo anterior', async () => {
    await prepararPara(ORIGEN)
    await guardar('bom_psi', [fuente('S1')])

    const salida = await prepararPara({ ...ORIGEN, connectionId: 'c-2' })
    expect(salida).toMatchObject({ seVacio: true, habiaOtro: 'c-1|PA|V1' })
    await expect(contar('bom_psi')).resolves.toBe(0)
    await expect(origenGuardado()).resolves.toBe('c-2|PA|V1')
  })

  it('cambiar de área o de versión también borra', async () => {
    await prepararPara(ORIGEN)
    await guardar('bom_psi', [fuente('S1')])
    await expect(prepararPara({ ...ORIGEN, planningArea: 'OTRA' })).resolves.toMatchObject({ seVacio: true })

    await guardar('bom_psi', [fuente('S1')])
    await expect(prepararPara({ ...ORIGEN, planningArea: 'OTRA', versionId: 'V9' }))
      .resolves.toMatchObject({ seVacio: true })
  })
})
