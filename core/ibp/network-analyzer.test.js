// Pruebas del Network Analyzer de v7.
//
// Los resultados esperados de `fixtures-red-v7.json` NO salen de este código: son lo que escribió el
// `analyzeAndStreamExcel` REAL de v7 (`analyzer.js` de `origin/master`) al correrlo sobre las mismas
// entradas, con las tablas de IndexedDB simuladas en memoria. Cuando una prueba de aquí falla, el
// algoritmo se desvió de v7, no al revés. Además de estos casos fijos se corrió el mismo cotejo contra
// trescientas redes generadas al azar (identificadores numéricos y alfanuméricos, ciclos, plazos vacíos,
// tipos excluidos, las cuatro categorías de material) sin una sola diferencia.
//
// Las pruebas de `snComputeHealthScore` y de los diccionarios sí están calculadas a mano, para que el
// criterio quede escrito además de comprobado.

import { describe, expect, it } from 'vitest'

import casos from './fixtures-red-v7.json'
import {
  CAMPOS_OBLIGATORIOS_RED,
  CAMPOS_OCULTOS_RED,
  ENTIDADES_CON_EXTRAS_RED,
  NOMBRES_DE_HOJA_RED,
  analizarRed,
  crearIndicesDeRed,
  snComputeHealthScore,
} from './network-analyzer.js'
import { HOJAS_DE_RED } from './network-analyzer-hojas.js'
import { COLORES } from './analisis-hojas.js'

const SEV_DE_RELLENO = { FFFFCCCC: 'red', FFFFFFCC: 'yel' }

/** Una `fuente` en memoria con la misma interfaz que la base local del navegador. */
function fuenteDe(tablas) {
  return {
    async recorrer(tabla, cb) { for (const fila of tablas[tabla] || []) cb(fila) },
    async filasDeProducto(tabla, prdid) { return (tablas[tabla] || []).filter((f) => f.PRDID === prdid) },
  }
}

/** Corre el análisis sobre una entrada del archivo de casos. */
async function correr(entrada, extra = {}) {
  const ci = crearIndicesDeRed()
  ci.arcos(entrada.tablas.sn_loc)
  ci.arcos(entrada.tablas.sn_cust)
  ci.productos(Object.values(entrada.prd))
  ci.cabeceras(entrada.tablas.sn_plant)
  ci.componentes(entrada.tablas.sn_psi)
  ci.ubicaciones(Object.values(entrada.loc))
  ci.clientes(Object.values(entrada.cust))

  const tipos = {}
  for (const [k, v] of Object.entries(entrada.tipos)) {
    tipos[k] = { excluded: !!v.excluded, categories: new Set(v.categories), count: v.count }
  }
  return analizarRed({
    idx: ci.idx,
    fuente: fuenteDe(entrada.tablas),
    tipos,
    extras: entrada.extras,
    hoy: '2026-10-02',
    conexion: { url: 'https://x', pa: 'PA1', pver: '' }, // la misma que usó el oráculo
    ejecucion: {
      generadoEl: new Date('2026-10-02T12:00:00Z'),
      filtro: "PlanningAreaID eq 'PA1'",
      entidades: JSON.parse(JSON.stringify(entrada.entidades)),
    },
    ...extra,
  })
}

describe('analizarRed — encabezados del Excel', () => {
  // `makeGroup` de v7 hace `ws.addRow(headers)` sin limpiar: «Alertas 🔴» queda «Alertas » en el Resumen.
  it('ninguna hoja pide limpiar los encabezados', async () => {
    const informe = await correr(casos.casos[0].entrada)
    const tablas = informe.hojas.filter((una) => una.tipo === 'tabla')
    expect(tablas.length).toBeGreaterThan(1)
    expect(tablas.some((una) => una.limpiarEncabezados)).toBe(false)
  })
})

describe('analizarRed — contra lo que escribe v7', () => {
  for (const caso of casos.casos) {
    describe(caso.nombre, () => {
      let informe
      const hojaDe = (nombre) => informe.hojas.find((h) => h.nombre === nombre)

      it('arma las siete hojas, en el orden del libro de v7', async () => {
        informe = await correr(caso.entrada)
        expect(informe.hojas.map((h) => h.nombre)).toEqual(
          ['Resumen', 'Estadísticas', 'Product', 'Location', 'Customer', 'Location Source', 'Customer Source'],
        )
        expect(informe.orden).toEqual(['Product', 'Location', 'Customer', 'Location Source', 'Customer Source'])
        expect(informe.archivo).toBe('SupplyNetworkAnalysis_2026-10-02.xlsx')
        expect(informe.titulo).toBe('Supply Network Analyzer — vista web')
      })

      for (const nombre of ['Product', 'Location', 'Customer', 'Location Source', 'Customer Source']) {
        it(`la hoja ${nombre}: encabezados, filas y colores son los de v7`, async () => {
          informe ??= await correr(caso.entrada)
          const esperado = caso.esperado.hojas[nombre]
          const hoja = hojaDe(nombre)
          expect(hoja.encabezados).toEqual(esperado[0].c)
          expect(hoja.filas.map((f) => f.c)).toEqual(esperado.slice(1).map((f) => f.c))
          expect(hoja.filas.map((f) => f.s)).toEqual(esperado.slice(1).map((f) => SEV_DE_RELLENO[f.f] ?? 'ok'))
          // Los contadores son los de la hoja, no recalculados aparte.
          expect(hoja.total).toBe(esperado.length - 1)
          expect(hoja.red + hoja.yel + hoja.ok).toBe(hoja.total)
        })
      }

      it('la hoja Resumen: tabla de totales y bloques de metadatos', async () => {
        informe ??= await correr(caso.entrada)
        const esperado = caso.esperado.hojas.Resumen
        const hoja = hojaDe('Resumen')
        expect(hoja.encabezados).toEqual(esperado[0].c)
        expect(hoja.filas.map((f) => f.c)).toEqual(esperado.slice(1, 6).map((f) => f.c))
        // Las filas libres de debajo, salvo «Generado el» (la hora local de quien corre) y «Archivo Excel»
        // (el oráculo se corrió otro día; el nombre del archivo se comprueba aparte).
        const libres = hoja.extras.map((f) => f.celdas)
        const deV7 = esperado.slice(6).map((f) => f.c.map((v) => (v === null ? '' : v)))
        const sinHora = (filas) => filas.filter((f) => f[0] !== 'Generado el' && f[0] !== 'Archivo Excel')
        expect(sinHora(libres.map((f) => f.map((v) => (v === null ? '' : v))))).toEqual(sinHora(deV7))
      })

      it('devuelve los totales y las tarjetas de la vista web de v7', async () => {
        informe ??= await correr(caso.entrada)
        expect(informe.totales).toEqual(caso.esperado.totales)
        expect(informe.resumen.map((r) => [r.nombre, r.total, r.red, r.yel, r.ok, r.pct]))
          .toEqual(caso.esperado.resumenWeb.map((r) => [r.name, r.total, r.red, r.yel, r.ok, r.pct]))
      })

      it('la hoja Estadísticas es la de buildSN', async () => {
        informe ??= await correr(caso.entrada)
        const esperado = caso.esperado.hojas['Estadísticas']
        // `Array.from`: las filas de totales llevan una marca `_fill` propia que el cotejo no debe ver.
        expect(hojaDe('Estadísticas').filas.map((f) => Array.from(f.celdas))).toEqual(esperado.map((f) => f.c))
      })
    })
  }
})

describe('analizarRed — reglas que conviene dejar escritas', () => {
  const base = casos.casos[0].entrada
  let informe
  const fila = (hoja, id) => informe.hojasWeb[hoja].filas.find((f) => f.c[2] === id)

  it('no analiza un tipo excluido ni un producto sin tipo, pero este cuenta en el total', async () => {
    informe = await correr(base)
    const productos = informe.hojasWeb.Product.filas.map((f) => f.c[2])
    expect(productos).not.toContain('E1') // tipo VERP, excluido
    expect(productos).not.toContain('N1') // sin MATTYPEID
    expect(informe.hojasWeb['Location Source'].filas.some((f) => f.c[2] === 'E1' || f.c[2] === 'N1')).toBe(false)
    // Siete productos en el universo: F1, S1, R1, T1, M1, E1 y N1.
    expect(informe.totales.totalProducts).toBe(7)
  })

  it('el estado de la red y el color dependen de la categoría del material', async () => {
    informe = await correr(base)
    expect(fila('Product', 'F1').c[12]).toBe('Red Completa')
    expect(fila('Product', 'S1').c[12]).toBe('Semiterminado con Transferencia')
    expect(fila('Product', 'R1').c[12]).toBe('Abastecimiento Completo')
    expect(fila('Product', 'T1').c[12]).toBe('Solo Distribución + Entrega')
    expect(fila('Product', 'M1').c[12]).toBe('Huérfano')
    expect(fila('Product', 'F1').s).toBe('red')
    expect(fila('Product', 'S1').s).toBe('ok')
    expect(fila('Product', 'M1').s).toBe('red')
  })

  it('un nodo sin salida útil es ghost y uno sin salida alguna es dead-end', async () => {
    informe = await correr(base)
    const obs = fila('Product', 'F1').c[1]
    expect(obs).toContain('Ghost node: GH')
    expect(obs).toContain('Dead-end: DE')
    expect(obs).toContain('Dead-end: GH2')
    expect(obs).toContain('Ciclo: DC1 → DC2 → DC1')
  })

  it('el Health Score de un terminado se calcula como dice el desglose (a mano)', async () => {
    informe = await correr(base)
    const f1 = fila('Product', 'F1').c
    // 5 rutas a 2 clientes desde 2 plantas, 1 ghost y 2 dead-ends, ningún cliente con una sola ruta:
    // +50 ruta, +15 clientes, +15 rutas, +20 plantas, -20 ghost, -15 dead ends = 65.
    expect(f1[20]).toBe(65)
    expect(f1[21]).toBe('Acceptable')
    expect(f1[22]).toBe(
      'Base: 0 | +50 ruta completa planta-cliente | +15 multiples clientes (2) | +15 multiples rutas (5) '
      + '| +20 multiples plantas (2) | -20 ghost nodes (1) | -15 dead ends (2) = 65',
    )
  })

  it('el promedio de salud divide por TODOS los productos del universo, no por los analizados', async () => {
    informe = await correr(base)
    const suma = informe.hojasWeb.Product.filas.reduce((s, f) => s + f.c[20], 0)
    expect(informe.totales.avgHealthScore).toBe(Math.round(suma / 7))
  })

  it('las etiquetas de estado son las de v7, sin «Nota»', async () => {
    informe = await correr(base)
    const etiquetas = new Set(Object.values(informe.hojasWeb).flatMap((h) => h.filas.map((f) => f.c[0])))
    expect([...etiquetas].sort()).toEqual(['✅ OK', '⚠ Advertencia', '⛔ Alerta'].sort())
  })

  it('lista los códigos en el orden de un objeto de JavaScript: los numéricos primero y de menor a mayor', async () => {
    // v7 lee `Object.keys(...)` de un objeto, y así salen «Orígenes (códigos)» y «Destinos (códigos)».
    const entrada = {
      tablas: {
        sn_loc: [
          { PRDID: 'P1', LOCFR: 'B', LOCID: '100', TLEADTIME: '1' },
          { PRDID: 'P1', LOCFR: '100', LOCID: '20', TLEADTIME: '1' },
          { PRDID: 'P1', LOCFR: 'A', LOCID: '3', TLEADTIME: '1' },
        ],
        sn_cust: [], sn_plant: [], sn_psi: [], sn_loc_prod: [], sn_cust_prod: [],
      },
      prd: { P1: { PRDID: 'P1', PRDDESCR: 'Uno', MATTYPEID: 'FERT' } },
      loc: {},
      cust: {},
      tipos: { FERT: { excluded: false, categories: [], count: 1 } },
      entidades: [],
    }
    informe = await correr(entrada)
    const p1 = informe.hojasWeb.Product.filas[0].c
    expect(p1[24]).toBe('100, B, A') // orígenes: B, 100 y A -> el numérico primero, luego en el orden en que llegaron
    expect(p1[26]).toBe('3, 20, 100') // destinos: 100, 20 y 3 -> de menor a mayor
  })

  it('un producto con un ciclo que no llega a nadie no cuelga el análisis', async () => {
    const entrada = {
      tablas: {
        sn_loc: [
          { PRDID: 'P1', LOCFR: 'A', LOCID: 'B', TLEADTIME: '1' },
          { PRDID: 'P1', LOCFR: 'B', LOCID: 'A', TLEADTIME: '1' },
        ],
        sn_cust: [], sn_plant: [{ SOURCEID: 'S', PRDID: 'P1', LOCID: 'A', PLEADTIME: '1', PRATIO: '1' }],
        sn_psi: [], sn_loc_prod: [], sn_cust_prod: [],
      },
      prd: { P1: { PRDID: 'P1', PRDDESCR: 'Uno', MATTYPEID: 'FERT' } },
      loc: {}, cust: {}, tipos: { FERT: { excluded: false, categories: [], count: 1 } }, entidades: [],
    }
    informe = await correr(entrada)
    expect(informe.hojasWeb.Product.filas[0].c[12]).toBe('Sin Entrega a Cliente')
    expect(informe.hojasWeb.Product.filas[0].c[1]).toContain('Ciclo: A → B → A')
  })
})

describe('snComputeHealthScore — las cuatro fórmulas, a mano', () => {
  const metrics = (extra) => ({ plants: 0, dcs: 0, customers: 0, paths: 0, ...extra })

  it('semiterminado: 30 producción + 40 consumo + 20 plantas (si hay más de una) + 10 transferencia', () => {
    const r = snComputeHealthScore(metrics({ plants: 2 }), [], [], [], { useSemiRules: true, inPSH: true, inPSI: true, inLS: true })
    expect(r.score).toBe(100)
    expect(r.category).toBe('Healthy')
    expect(r.detail).toBe('Base: 0 | +30 produccion configurada | +40 consumo PSI configurado | +20 multiples plantas (2) | +10 transferencia configurada = 100')
    const sin = snComputeHealthScore(metrics(), [], [], [], { useSemiRules: true })
    expect(sin.score).toBe(0)
    expect(sin.comments).toBe('Sin PSH; Sin consumo PSI')
  })

  it('materia prima: 60 arcos de suministro + 20 ubicaciones alcanzadas + 20 entrega directa', () => {
    const r = snComputeHealthScore(metrics({ dcs: 3 }), [], [], [], { useRawmatRules: true, inLS: true, inCS: false })
    expect(r.score).toBe(80)
    expect(r.detail).toBe('Base: 0 | +60 arcos de suministro configurados | +20 ubicaciones de consumo alcanzadas (3) = 80')
  })

  it('mercadería: 40 distribución + 40 entrega + 20 si hay más de un cliente', () => {
    const r = snComputeHealthScore(metrics({ customers: 2 }), [], [], [], { useTradingRules: true, inLS: true, inCS: true })
    expect(r.score).toBe(100)
    const solo = snComputeHealthScore(metrics(), [], [], [], { useTradingRules: true, inLS: true })
    expect(solo.score).toBe(40)
    expect(solo.comments).toBe('Sin Customer Source')
  })

  it('terminado: sin rutas no suma, una sola planta resta 15 y el piso es 0', () => {
    const r = snComputeHealthScore(metrics({ plants: 1 }), [], [], [], {})
    expect(r.score).toBe(0) // -15 se recorta a 0
    expect(r.category).toBe('Critical')
    expect(r.detail).toBe('Base: 0 | +0 sin rutas completas | -15 fuente unica de produccion = 0')
    expect(r.comments).toBe('Single production source; No valid plant-to-customer paths')
  })

  it('terminado con un cliente de una sola ruta resta 20', () => {
    const rutas = [{ customer: 'C1', nodes: ['P'] }]
    const r = snComputeHealthScore(metrics({ plants: 2, customers: 1, paths: 1 }), rutas, [], [], {})
    // +50 ruta, +20 plantas, -20 cliente con una sola ruta = 50
    expect(r.score).toBe(50)
    expect(r.category).toBe('Weak')
  })

  it('las categorías cortan en 80, 60 y 40', () => {
    const cat = (ctx) => snComputeHealthScore(metrics(), [], [], [], ctx)
    // Mercadería: distribución 40 + entrega 40.
    expect(cat({ useTradingRules: true, inLS: true, inCS: true })).toMatchObject({ score: 80, category: 'Healthy' })
    // Materia prima: 60 justo en el borde de Acceptable.
    expect(cat({ useRawmatRules: true, inLS: true })).toMatchObject({ score: 60, category: 'Acceptable' })
    // Semiterminado: 30 + 40 = 70, y 40 justo en el borde de Weak.
    expect(cat({ useSemiRules: true, inPSH: true, inPSI: true })).toMatchObject({ score: 70, category: 'Acceptable' })
    expect(cat({ useSemiRules: true, inPSI: true })).toMatchObject({ score: 40, category: 'Weak' })
    expect(cat({ useSemiRules: true, inPSH: true })).toMatchObject({ score: 30, category: 'Critical' })
  })
})

describe('analizarRed — hojas grandes y avisos', () => {
  const base = casos.casos[0].entrada

  it('pide las cinco hojas de análisis a crearHojaGrande y espera su cierre', async () => {
    const pedidas = []
    const cerradas = []
    const crearHojaGrande = (cfg) => {
      const filas = []
      const hoja = {
        tipo: 'tabla', ...cfg, filas, extras: [], total: 0, red: 0, yel: 0, ok: 0,
        agregar(celdas, relleno) {
          const sev = relleno === COLORES.C_RED ? 'red' : relleno === COLORES.C_YEL ? 'yel' : 'ok'
          this.total += 1; this[sev] += 1
          filas.push(celdas)
          return sev
        },
        agregarLibre() {},
        async cerrar() { cerradas.push(cfg.nombre) },
      }
      pedidas.push(cfg.nombre)
      return hoja
    }
    const informe = await correr(base, { crearHojaGrande })
    const cinco = ['Product', 'Location', 'Customer', 'Location Source', 'Customer Source']
    expect(pedidas).toEqual(cinco)
    expect(cerradas).toEqual(cinco)
    // Los totales de la hoja grande llegan al Resumen igual que los de una hoja en memoria.
    const resumen = informe.resumen.find((r) => r.nombre === 'Location Source')
    expect(resumen.total).toBe(informe.hojasWeb['Location Source'].total)
    expect(resumen.total).toBeGreaterThan(0)
  })

  it('cuenta el avance con los textos y los porcentajes de v7', async () => {
    const estados = []
    const barra = []
    const registro = []
    await correr(base, {
      alEstado: (t) => estados.push(t),
      alProgreso: (p) => barra.push(p),
      registrar: (c, t) => registro.push([c, t]),
    })
    expect(estados[0]).toBe('Construyendo índices globales...')
    expect(estados).toContain('Analizando 7/7 productos...')
    expect(estados.slice(-5)).toEqual([
      'Hoja Location lista...', 'Hoja Customer lista...', 'Hoja Location Source lista...',
      'Hoja Customer Source lista...', 'Generando Resumen...',
    ])
    expect(barra).toEqual([57, 85, 88, 91, 94, 96, 97])
    expect(registro[0]).toEqual(['info', 'Fase 2: pre-índices...'])
    expect(registro[1]).toEqual(['ok', 'Pre-índices: LocProd=8 CustProd=2'])
  })

  it('una tabla que no se puede leer para Estadísticas se ignora, como en v7, y el resto sale igual', async () => {
    const fuente = fuenteDe(base.tablas)
    let llamadas = 0
    const original = fuente.recorrer
    // Siete pasadas son del análisis (cinco pre-índices y los dos recorridos de arcos); de la octava en
    // adelante, las de Estadísticas.
    fuente.recorrer = async (t, cb) => {
      llamadas += 1
      if (llamadas > 7) throw new Error('sin disco')
      return original(t, cb)
    }
    const ci = crearIndicesDeRed()
    ci.arcos(base.tablas.sn_loc)
    ci.productos(Object.values(base.prd))
    const informe = await analizarRed({ idx: ci.idx, fuente, tipos: {}, hoy: '2026-10-02' })
    expect(informe.hojasWeb.Product).toBeDefined()
    expect(informe.hojas.find((h) => h.nombre === 'Estadísticas').filas[0].celdas).toEqual(['Estadísticas — Supply Network'])
  })
})

describe('crearIndicesDeRed', () => {
  it('arma los índices que v7 armaba mientras bajaba', () => {
    const ci = crearIndicesDeRed()
    ci.arcos([{ PRDID: ' A ' }, { PRDID: '' }])
    ci.cabeceras([{ SOURCEID: 'S1', PRDID: 'B', LOCID: 'PL1' }, { SOURCEID: 'S2', PRDID: 'C', LOCID: 'PL2' }])
    ci.componentes([{ SOURCEID: 'S1', PRDID: 'A' }, { SOURCEID: 'S2', PRDID: 'A' }, { SOURCEID: 'S9', PRDID: 'Z' }, { SOURCEID: 'S1', PRDID: '' }])
    ci.productos([{ PRDID: 'A', MATTYPEID: 'X' }, { PRDID: 'A', MATTYPEID: 'Y' }])
    ci.ubicaciones([{ LOCID: 'PL1' }])
    ci.clientes([{ CUSTID: 'C1' }])
    const { idx } = ci
    expect(Object.keys(idx.allPrds).sort()).toEqual(['A', 'B', 'C'])
    expect(Object.keys(idx.pshPrds).sort()).toEqual(['B', 'C'])
    expect(Object.keys(idx.psiCompPrds).sort()).toEqual(['A', 'Z'])
    // Dónde se consume: la planta de la receta que lo lleva como componente.
    expect(Object.keys(idx.psiConsumingLocs.A).sort()).toEqual(['PL1', 'PL2'])
    expect(idx.psiConsumingLocs.Z).toBeUndefined() // su receta no está
    // Un maestro repetido: gana el último.
    expect(idx.prdLookup.A.MATTYPEID).toBe('Y')
    expect(Object.keys(idx.locLookup)).toEqual(['PL1'])
    expect(Object.keys(idx.custLookup)).toEqual(['C1'])
  })
})

describe('definición de las hojas', () => {
  it('cada columna tiene su nota y su grupo, y las longitudes son las de v7', () => {
    const largos = { product: 33, location: 19, customer: 11, locationSource: 17, customerSource: 15 }
    for (const [clave, n] of Object.entries(largos)) {
      const d = HOJAS_DE_RED[clave]
      expect(d.encabezados).toHaveLength(n)
      expect(d.notas).toHaveLength(n)
      expect(d.grupos).toHaveLength(n)
    }
  })

  it('las columnas que v7 trae y que el pedido nombra están con su texto exacto', () => {
    const h = HOJAS_DE_RED.product.encabezados
    for (const col of ['Estado de la Red', '# Plantas', '# DCs', '# Clientes', '# Rutas completas', 'Ruta más larga',
      '# Ghost Nodes', '# Dead Ends', 'Health Score', 'Categoría de salud', 'Detalle cálculo Health Score', 'Multi-sourced?',
      'TLT promedio (días)', 'CLT promedio (días)']) {
      expect(h).toContain(col)
    }
  })

  it('las entidades con campos adicionales y sus listas son las de EF_MAND_* de v7', () => {
    expect(ENTIDADES_CON_EXTRAS_RED.map((e) => [e.clave, e.despuesDe])).toEqual([
      ['product', 4], ['location', 4], ['customer', 3], ['locationSource', 9], ['customerSource', 9],
    ])
    expect(CAMPOS_OBLIGATORIOS_RED.locationSource).toEqual(['PRDID', 'LOCFR', 'LOCID', 'TLEADTIME'])
    expect(CAMPOS_OCULTOS_RED.customer).toEqual(['CUSTVALID'])
    expect(NOMBRES_DE_HOJA_RED.stats).toBe('Estadísticas')
  })
})
