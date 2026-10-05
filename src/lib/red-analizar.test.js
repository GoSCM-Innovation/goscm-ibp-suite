// La lectura de lo descargado y el análisis de la red, contra la base local (fake-indexeddb) y las mismas
// entradas y resultados de v7 que usan las pruebas de `core/ibp/network-analyzer.js`.

import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import casos from '../../core/ibp/fixtures-red-v7.json'
import { contar, guardar, leerTramo, olvidarBase } from './explorer-db.js'
import { analizarRedDescargada, fuenteDeLaRed, indexarLaRed } from './red-analizar.js'
import { TABLAS_QUE_BAJA_RED } from './registro-sn.js'

const base = casos.casos[0]
const entrada = base.entrada

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  olvidarBase()
})
afterEach(() => { olvidarBase() })

const TABLA_DE = {
  sn_loc: entrada.tablas.sn_loc,
  sn_cust: entrada.tablas.sn_cust,
  bom_prd: Object.values(entrada.prd),
  sn_plant: entrada.tablas.sn_plant,
  sn_psi: entrada.tablas.sn_psi,
  bom_loc: Object.values(entrada.loc),
  sn_loc_prod: entrada.tablas.sn_loc_prod,
  sn_cust_master: Object.values(entrada.cust),
  sn_cust_prod: entrada.tablas.sn_cust_prod,
}

/** Lo que la descarga dejó en la base local, y su resultado. */
async function descargaSimulada(omitir = []) {
  const hechos = []
  for (const tabla of TABLAS_QUE_BAJA_RED) {
    if (omitir.includes(tabla)) { hechos.push({ tabla, entidad: null, omitido: true }); continue }
    await guardar(tabla, TABLA_DE[tabla])
    hechos.push({ tabla, entidad: `E_${tabla}`, bajadas: TABLA_DE[tabla].length, guardadas: TABLA_DE[tabla].length })
  }
  return hechos
}

const clasificacion = Object.fromEntries(
  Object.entries(entrada.tipos).map(([tipo, t]) => [tipo, { excluido: t.excluded, categorias: t.categories, productos: t.count }]),
)

const opciones = (hechos, extra = {}) => ({
  hechos,
  destino: { planningArea: 'PA1', versionId: '' },
  conexion: { url: '', pa: 'PA1', pver: '' },
  clasificacion,
  extras: {},
  hoy: '2026-10-02',
  ...extra,
})

describe('indexarLaRed', () => {
  it('arma los índices de v7 recorriendo las tablas bajadas', async () => {
    const hechos = await descargaSimulada()
    const idx = await indexarLaRed(hechos)
    // Productos con arcos o recetas: F1, S1, R1, T1, E1 y N1 (M1 solo está en el maestro).
    expect(Object.keys(idx.allPrds).sort()).toEqual(['E1', 'F1', 'N1', 'R1', 'S1', 'T1'])
    expect(Object.keys(idx.pshPrds).sort()).toEqual(['F1', 'S1'])
    expect(Object.keys(idx.psiCompPrds).sort()).toEqual(['R1', 'S1'])
    // R1 se consume en las plantas de SRC1 (PL1) y SRC3 (PL1); S1 en la de SRC2 (PL2).
    expect(Object.keys(idx.psiConsumingLocs.R1)).toEqual(['PL1'])
    expect(Object.keys(idx.psiConsumingLocs.S1)).toEqual(['PL2'])
    expect(Object.keys(idx.prdLookup).sort()).toEqual(['E1', 'F1', 'M1', 'N1', 'R1', 'S1', 'T1'])
    expect(Object.keys(idx.locLookup)).toHaveLength(5)
    expect(Object.keys(idx.custLookup).sort()).toEqual(['C0', 'C1'])
  })

  it('una tabla que no se bajó en esta corrida se lee vacía, aunque la base guarde restos', async () => {
    // Restos de una corrida anterior (o del árbol) en el maestro de productos.
    await guardar('bom_prd', TABLA_DE.bom_prd)
    const hechos = await descargaSimulada(['bom_prd'])
    // La descarga simulada ya guardó los demás; `bom_prd` quedó con restos y marcado como omitido.
    const idx = await indexarLaRed(hechos)
    expect(Object.keys(idx.prdLookup)).toEqual([])
    const fuente = fuenteDeLaRed(hechos)
    let vistas = 0
    await fuente.recorrer('bom_prd', () => { vistas += 1 })
    expect(vistas).toBe(0)
    expect(await fuente.filasDeProducto('bom_prd', 'F1')).toEqual([])
  })
})

describe('fuenteDeLaRed', () => {
  it('recorre una tabla por cursor y trae las filas de un producto por su índice', async () => {
    const hechos = await descargaSimulada()
    const fuente = fuenteDeLaRed(hechos)
    const arcos = []
    await fuente.recorrer('sn_loc', (fila) => { arcos.push(fila.PRDID) })
    expect(arcos).toHaveLength(entrada.tablas.sn_loc.length)

    const deF1 = await fuente.filasDeProducto('sn_loc', 'F1')
    expect(deF1).toHaveLength(entrada.tablas.sn_loc.filter((f) => f.PRDID === 'F1').length)
    expect(await fuente.filasDeProducto('sn_plant', 'S1')).toHaveLength(1)
    expect(await fuente.filasDeProducto('sn_loc', 'NO_EXISTE')).toEqual([])
  })
})

describe('analizarRedDescargada', () => {
  it('da el mismo informe que v7 (hoja Product y totales)', async () => {
    const hechos = await descargaSimulada()
    const informe = await analizarRedDescargada(opciones(hechos))
    const esperado = base.esperado.hojas.Product.slice(1)
    expect(informe.hojasWeb.Product.filas.map((f) => f.c)).toEqual(esperado.map((f) => f.c))
    expect(informe.totales).toEqual(base.esperado.totales)
    expect(informe.archivo).toBe('SupplyNetworkAnalysis_2026-10-02.xlsx')
  })

  it('cuenta lo que v7 contaba en el registro y en la línea de estado', async () => {
    const hechos = await descargaSimulada()
    const registro = []
    const estados = []
    await analizarRedDescargada(opciones(hechos, {
      registrar: (c, t) => registro.push([c, t]),
      alEstado: (t) => estados.push(t),
    }))
    expect(registro[0]).toEqual(['ok', 'Índices listos. 6 productos en la red. Iniciando análisis...'])
    expect(estados[0]).toBe('Analizando red (6 productos)...')
  })

  it('el Resumen lleva las entidades de la descarga con retenidas, analizadas y nota', async () => {
    const hechos = await descargaSimulada()
    const informe = await analizarRedDescargada(opciones(hechos))
    const libres = informe.hojas.find((h) => h.nombre === 'Resumen').extras.map((f) => f.celdas)
    const linea = (inicio) => libres.find((f) => String(f[0]).startsWith(inicio))
    expect(linea('ENTIDADES ODATA UTILIZADAS')[0]).toBe('ENTIDADES ODATA UTILIZADAS (9)')
    // 14 arcos descargados y retenidos; analizados 12, porque E1 (tipo excluido) y N1 (sin tipo) no salen.
    // Como no se descartó ninguno, la nota va al final y no junto a «retenidos».
    expect(linea('Location Source [E_sn_loc]')[1]).toBe('14 registros descargados → 12 analizados — Excluye TINVALID=X')
    expect(linea('Product [E_bom_prd]')[1]).toBe('7 registros descargados → 5 analizados')
  })

  it('sin vista web las hojas de arcos no tocan la base local y solo escriben el Excel', async () => {
    const hechos = await descargaSimulada()
    const informe = await analizarRedDescargada(opciones(hechos, { web: false }))
    const ls = informe.hojasWeb['Location Source']
    expect(ls.filas).toEqual([])
    expect(ls.origen).toBeUndefined()
    expect(ls.partes).toHaveLength(1)
    expect(ls.total).toBe(base.esperado.hojas['Location Source'].length - 1)
    expect(await contar('sn_loc_web')).toBe(0)
    expect(await contar('sn_cust_web')).toBe(0)
  })

  it('con vista web guarda las filas ya armadas y las puede paginar por severidad', async () => {
    const hechos = await descargaSimulada()
    const informe = await analizarRedDescargada(opciones(hechos, { web: true }))
    const ls = informe.hojasWeb['Location Source']
    const esperado = base.esperado.hojas['Location Source'].slice(1)

    expect(await contar('sn_loc_web')).toBe(esperado.length)
    expect(await contar('sn_cust_web')).toBe(base.esperado.hojas['Customer Source'].length - 1)
    expect(ls.origen).toBeDefined()

    // La misma fila que v7 guardaba en `sn_loc_web`: celdas como texto, vacío = '' y la severidad al lado.
    const aTexto = (c) => c.map((v) => (v == null ? '' : String(v)))
    const guardadas = await leerTramo('sn_loc_web', { desde: 0, cuantos: 100 })
    expect(guardadas.map((f) => f.c)).toEqual(esperado.map((f) => aTexto(f.c)))

    const rojas = await ls.origen.pagina('red', 0, 50)
    expect(rojas.every((f) => f.s === 'red')).toBe(true)
    expect(rojas.length).toBe(ls.red)

    const encontradas = await ls.origen.buscar('all', (f) => f.c.some((c, i) => i > 0 && c.includes('arco inverso')), 2000, 300000)
    expect(encontradas.filas.length).toBe(2)
    expect(encontradas.truncada).toBe(false)
  })

  it('vacía las tablas de la vista de una corrida anterior', async () => {
    await guardar('sn_loc_web', [{ c: ['viejo'], s: 'ok' }])
    const hechos = await descargaSimulada()
    await analizarRedDescargada(opciones(hechos, { web: false }))
    expect(await contar('sn_loc_web')).toBe(0)
  })
})
