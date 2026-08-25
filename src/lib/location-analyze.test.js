// El cruce de datos del informe de ubicaciones, contra IndexedDB de verdad.
//
// Lo que se prueba aquí y no en el núcleo: que el ROL salga de la tabla correcta. La diferencia entre
// «proveedor» y «nodo de transferencia» depende de una pregunta cruzada —¿el destino del arco consume
// este producto en alguna receta SUYA?— y equivocarse en de dónde sale la planta de una receta
// convierte a todos los proveedores en nodos de transferencia sin que ninguna prueba del núcleo lo vea.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

import { analizar, hechosDe, juntarHechos } from './location-analyze.js'
import { ROLES } from '../../core/ibp/location-analysis.js'
import { guardar, leerTramo, olvidarBase, contar, vaciar } from './explorer-db.js'

/**
 * La red de prueba:
 *
 *   PROV --MAT, CAJA, PALLET--> P1  --TERM--> CD --SEMI--> P2
 *
 *   P1 fabrica TERM (receta S1: lleva SEMI y CAJA) y SEMI (receta S2: lleva MAT).
 *   P2 fabrica OTRO (receta S3: lleva MAT) y OTRO2 (receta S4: sin componentes).
 *   CD no fabrica nada. VIEJA está solo en el maestro.
 *
 * Cada caso está aislado a propósito:
 *
 *   - PROV manda MAT y CAJA, que P1 SÍ consume, y PALLET, que no: es proveedor Y transferencia.
 *   - CD manda SEMI a P2, que produce y no lo consume: transferencia a planta sin consumo.
 *   - P1 manda TERM a CD, que no produce: transferencia a nodo sin producción.
 *   - P2 consume MAT y ningún arco lo trae hasta P2: componente sin arco.
 *   - S4 no tiene componentes ni recurso; S2 no tiene recurso y su plazo es cero.
 */
async function sembrar() {
  await guardar('bom_loc', [
    { LOCID: 'P1', LOCDESCR: 'Planta de Quito' },
    { LOCID: 'P2', LOCDESCR: 'Planta de Guayaquil' },
    { LOCID: 'CD', LOCDESCR: 'Centro de distribucion' },
    { LOCID: 'PROV', LOCDESCR: 'Proveedor del norte', LOCTYPE: 'V' },
    { LOCID: 'VIEJA', LOCDESCR: 'Bodega cerrada' },
  ])

  await guardar('bom_prd', [
    { PRDID: 'TERM', MATTYPEID: 'FERT' },
    { PRDID: 'SEMI', MATTYPEID: 'HALB' },
    { PRDID: 'MAT', MATTYPEID: 'ROH' },
    { PRDID: 'CAJA', MATTYPEID: 'ROH' },
    { PRDID: 'PALLET', MATTYPEID: 'ROH' },
    { PRDID: 'OTRO', MATTYPEID: 'FERT' },
    { PRDID: 'OTRO2', MATTYPEID: 'FERT' },
  ])

  await guardar('bom_psh', [
    { SOURCEID: 'S1', PRDID: 'TERM', LOCID: 'P1', PLEADTIME: '2' },
    { SOURCEID: 'S2', PRDID: 'SEMI', LOCID: 'P1', PLEADTIME: '0' },
    { SOURCEID: 'S3', PRDID: 'OTRO', LOCID: 'P2', PLEADTIME: '3' },
    { SOURCEID: 'S4', PRDID: 'OTRO2', LOCID: 'P2', PLEADTIME: '5' },
  ])

  await guardar('bom_psi', [
    { SOURCEID: 'S1', PRDID: 'SEMI' },
    { SOURCEID: 'S1', PRDID: 'CAJA' },
    { SOURCEID: 'S2', PRDID: 'MAT' },
    // S3 consume MAT en P2 y ningún arco lo trae hasta ahí: el componente sin arco.
    { SOURCEID: 'S3', PRDID: 'MAT' },
    // S4 no tiene componentes: el otro error de P2.
  ])

  await guardar('bom_psr', [
    { SOURCEID: 'S1', RESID: 'LINEA_A' },
    { SOURCEID: 'S3', RESID: 'LINEA_C' },
    // S2 y S4 no tienen recurso.
  ])

  await guardar('bom_res', [
    { RESID: 'LINEA_A', RESDESCR: 'Linea A' },
    { RESID: 'LINEA_B', RESDESCR: 'Linea B' },
    { RESID: 'LINEA_C', RESDESCR: 'Linea C' },
    { RESID: 'LINEA_Z', RESDESCR: 'Linea sin nada' },
  ])

  await guardar('bom_resloc', [
    { RESID: 'LINEA_A', LOCID: 'P1', RESOURCETYPE: 'CAPACITY' },
    // LINEA_B esta asignada a P1 y ninguna receta la usa: capacidad ociosa.
    { RESID: 'LINEA_B', LOCID: 'P1' },
    // LINEA_C se usa en S3 pero NO esta asignada a ninguna planta.
  ])

  await guardar('sn_loc', [
    { LOCFR: 'PROV', LOCID: 'P1', PRDID: 'MAT' },
    { LOCFR: 'PROV', LOCID: 'P1', PRDID: 'CAJA' },
    { LOCFR: 'PROV', LOCID: 'P1', PRDID: 'PALLET' },
    { LOCFR: 'P1', LOCID: 'CD', PRDID: 'TERM' },
    { LOCFR: 'CD', LOCID: 'P2', PRDID: 'SEMI' },
  ])

  await guardar('sn_loc_prod', [
    { LOCID: 'P1', PRDID: 'TERM' },
    { LOCID: 'P1', PRDID: 'SEMI' },
    { LOCID: 'P1', PRDID: 'MAT' },
    { LOCID: 'P1', PRDID: 'CAJA' },
    // PALLET no tiene Location Product en P1, y TERM no lo tiene en CD.
    { LOCID: 'P2', PRDID: 'OTRO' },
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

describe('el rol sale de cruzar los arcos con las recetas del destino', () => {
  it('quien manda algo que el destino consume es proveedor', async () => {
    const indices = await juntarHechos({ configuracion: CONFIG })
    const prov = hechosDe('PROV', indices)
    // MAT lo consume S2 y CAJA la consume S1, las dos en P1: eso lo hace proveedor.
    expect(prov.mandaLoQueSeConsume).toBe(true)
    // PALLET le llega a P1 y ninguna receta de P1 lo consume: eso lo hace además transferencia.
    expect(prov.mandaLoQueNoSeConsume).toBe(true)
    expect(prov.transfiereAPlantaSinConsumo).toEqual(['PALLET'])
  })

  it('transferir a una planta que no lo usa se separa de transferir a una bodega', async () => {
    const indices = await juntarHechos({ configuracion: CONFIG })

    // CD manda SEMI a P2, que produce y no lo consume: es lo grave.
    expect(hechosDe('CD', indices).transfiereAPlantaSinConsumo).toEqual(['SEMI'])
    // P1 manda TERM a CD, que no produce nada: es el aviso.
    expect(hechosDe('P1', indices).transfiereANodoSinProduccion).toEqual(['TERM'])
  })

  it('la planta de una receta sale de su cabecera, no del componente', async () => {
    const indices = await juntarHechos({ configuracion: CONFIG })
    const p1 = hechosDe('P1', indices)
    expect(p1.recetas.sort()).toEqual(['S1', 'S2'])
    expect(p1.productos.sort()).toEqual(['SEMI', 'TERM'])
  })
})

describe('lo que se le exige a una planta', () => {
  it('encuentra la receta sin recurso y la de plazo cero', async () => {
    const indices = await juntarHechos({ configuracion: CONFIG })
    const p1 = hechosDe('P1', indices)
    expect(p1.recetasSinRecurso).toEqual(['S2'])
    expect(p1.recetasConPlazoCero).toEqual(['S2'])
  })

  it('encuentra la receta sin componentes y la deja separada de la que sí los tiene', async () => {
    const indices = await juntarHechos({ configuracion: CONFIG })
    const p2 = hechosDe('P2', indices)
    expect(p2.recetasSinComponentes).toEqual(['S4'])
    expect(p2.recetasSinRecurso).toEqual(['S4'])
  })

  // Es la comprobación más cara de hacer a mano: hay que cruzar el BOM con la red arco por arco.
  it('un componente que se fabrica aquí mismo NO cuenta como falta de arco', async () => {
    const indices = await juntarHechos({ configuracion: CONFIG })
    // S1 lleva SEMI y CAJA. SEMI se fabrica en P1, así que no necesita arco; CAJA llega por arco de
    // PROV, y MAT también. Así que a P1 no le falta ninguno.
    expect(hechosDe('P1', indices).componentesSinArco).toEqual([])
  })

  it('encuentra el componente que una receta consume y ningún arco trae', async () => {
    const indices = await juntarHechos({ configuracion: CONFIG })
    // S3 consume MAT en P2, y el único arco de MAT va de PROV a P1.
    expect(hechosDe('P2', indices).componentesSinArco).toEqual(['MAT'])
  })

  it('un recurso asignado que ninguna receta usa sale como ocioso', async () => {
    const indices = await juntarHechos({ configuracion: CONFIG })
    const p1 = hechosDe('P1', indices)
    expect(p1.recursosOciosos).toEqual(['LINEA_B'])
    expect(p1.recursos.sort()).toEqual(['LINEA_A', 'LINEA_B'])
  })

  it('un recurso usado en una receta cuenta aunque no esté asignado a la planta', async () => {
    const indices = await juntarHechos({ configuracion: CONFIG })
    // LINEA_C se usa en S3 (planta P2) y no está en bom_resloc: aparece igual en la planta.
    expect(hechosDe('P2', indices).recursos).toEqual(['LINEA_C'])
    expect(hechosDe('P2', indices).recursosOciosos).toEqual([])
  })
})

describe('la cobertura de Location Product', () => {
  it('lo que llega y no tiene Location Product en el destino se marca', async () => {
    const indices = await juntarHechos({ configuracion: CONFIG })
    // A P1 le llega PALLET y no está en sn_loc_prod de P1.
    expect(hechosDe('P1', indices).recibeSinCobertura).toEqual(['PALLET'])
    // A CD le llega TERM y tampoco.
    expect(hechosDe('CD', indices).recibeSinCobertura).toEqual(['TERM'])
  })

  it('un proveedor cuyo material sí está cubierto en el destino no se marca', async () => {
    const indices = await juntarHechos({ configuracion: CONFIG })
    // MAT y CAJA están los dos en sn_loc_prod de P1, así que los arcos de PROV son usables. PALLET no
    // se mira aquí: no lo consume nadie, así que sale por la vía de transferencia, no por la de proveedor.
    expect(hechosDe('PROV', indices).mandaSinCobertura).toEqual([])
  })

  it('un proveedor cuyo material NO está cubierto en el destino sí se marca', async () => {
    // Se quita la cobertura de MAT en P1: el arco de PROV deja de poder usarse.
    await vaciar('sn_loc_prod')
    await guardar('sn_loc_prod', [{ LOCID: 'P1', PRDID: 'TERM' }, { LOCID: 'P1', PRDID: 'SEMI' }])

    const indices = await juntarHechos({ configuracion: CONFIG })
    expect(hechosDe('PROV', indices).mandaSinCobertura.sort()).toEqual(['CAJA', 'MAT'])
  })
})

describe('la clasificación del consultor se respeta', () => {
  it('sin clasificar, no se acusa a nadie de fabricar lo que se compra', async () => {
    const indices = await juntarHechos({ configuracion: {} })
    expect(hechosDe('P1', indices).fabricaLoQueSeCompra).toEqual([])
  })

  it('con MAT clasificado como comprado, fabricarlo en P1 se marca', async () => {
    // Se cambia SEMI a materia prima: P1 lo fabrica, así que la clasificación y la receta se pelean.
    const indices = await juntarHechos({
      configuracion: { ...CONFIG, HALB: { excluido: false, categorias: ['rawmat'] } },
    })
    expect(hechosDe('P1', indices).fabricaLoQueSeCompra).toEqual(['SEMI'])
  })
})

// El caso que se encontró corriendo esto contra un tenant real: la tabla de arcos son millones de
// filas, las listas por ubicación se topan, y el informe escribía el tope como si fuera el total.
describe('cuando una lista se topa', () => {
  it('marca el campo topado y el informe dice «más de»', async () => {
    // 500 productos llegando a una bodega que no produce ni reenvía —un receptor puro—, por encima
    // del tope de 400.
    await guardar('sn_loc', Array.from({ length: 500 }, (_, i) => ({
      LOCFR: 'P1', LOCID: 'BODEGA', PRDID: `EXTRA${i}`,
    })))

    const indices = await juntarHechos({ configuracion: CONFIG })
    const bodega = hechosDe('BODEGA', indices)

    expect(bodega.topados).toContain('recibeSinCobertura')
    expect(bodega.recibeSinCobertura.length).toBe(400)

    await analizar(CONFIG)
    const filas = await leerTramo('pa_location_web', 0, 100)
    const suya = filas.find((una) => una.c[3] === 'BODEGA')

    expect(suya.c[1]).toBe(ROLES.receptor)
    expect(suya.c[2]).toContain('más de 400 materiales que recibe sin cobertura')
  })

  it('sin topar, no marca nada', async () => {
    const indices = await juntarHechos({ configuracion: CONFIG })
    for (const locid of ['P1', 'P2', 'CD', 'PROV']) {
      expect(hechosDe(locid, indices).topados, locid).toEqual([])
    }
  })
})

describe('analizar de punta a punta', () => {
  it('guarda una fila por ubicación en la tabla de vista', async () => {
    const { resumen, analizados } = await analizar(CONFIG)

    expect(analizados).toBe(5)
    expect(await contar('pa_location_web')).toBe(5)
    expect(resumen.total).toBe(5)
  })

  it('la ubicación que solo está en el maestro sale como nota', async () => {
    await analizar(CONFIG)
    const filas = await leerTramo('pa_location_web', 0, 100)
    const vieja = filas.find((una) => una.c[3] === 'VIEJA')

    expect(vieja.s).toBe('info')
    expect(vieja.c[1]).toBe(ROLES.sinActividad)
  })

  it('PROV sale con los dos roles a la vez', async () => {
    await analizar(CONFIG)
    const filas = await leerTramo('pa_location_web', 0, 100)
    const prov = filas.find((una) => una.c[3] === 'PROV')

    expect(prov.c[1]).toBe(`${ROLES.proveedor}, ${ROLES.transferencia}`)
  })

  // Una ubicación puede vivir solo en los arcos. No analizarla sería perder justo el dato de que le
  // falta la ficha en el maestro.
  it('analiza también una ubicación que solo aparece en los arcos', async () => {
    await guardar('sn_loc', [{ LOCFR: 'P1', LOCID: 'FANTASMA', PRDID: 'TERM' }])
    const { analizados } = await analizar(CONFIG)

    expect(analizados).toBe(6)
    const filas = await leerTramo('pa_location_web', 0, 100)
    expect(filas.some((una) => una.c[3] === 'FANTASMA')).toBe(true)
  })

  it('vacía la tabla antes de volver a analizar, para no duplicar', async () => {
    await analizar(CONFIG)
    await analizar(CONFIG)
    expect(await contar('pa_location_web')).toBe(5)
  })
})
