// Leer lo descargado y entregárselo al algoritmo de v7, contra IndexedDB de verdad.
//
// Lo que se prueba aquí y no en el núcleo: que cada índice salga de la tabla que de verdad lo dice y con
// las mismas reglas de descarte que v7. Atar mal los sustitutos a las cabeceras vivas, o leer mal un
// campo extra, da un informe entero equivocado y ninguna prueba del algoritmo lo vería.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

import { guardar, olvidarBase } from './explorer-db.js'
import {
  analizarProduccionDescargada,
  entidadesMapeadas,
  filtroDeV7,
  leerDatosDeProduccion,
} from './produccion-analizar.js'

const ENT = {
  psh: 'PSH_E', psi: 'PSI_E', psiSub: 'SUB_E', psr: 'PSR_E', prd: 'PRD_E', loc: 'LOC_E', res: 'RES_E',
  resLoc: 'RL_E', locPrd: 'LP_E', locSrc: 'LS_E',
}

async function sembrar() {
  await guardar('bom_prd', [
    { PRDID: 'FG1', PRDDESCR: 'Aceite', MATTYPEID: 'FERT', COLOR: 'ROJO' },
    { PRDID: 'RM1', PRDDESCR: 'Resina', MATTYPEID: 'ROH' },
    { PRDID: 'NUEVO', PRDDESCR: 'Tipo que nadie clasificó', MATTYPEID: 'ZZZ' },
  ])
  await guardar('bom_loc', [
    { LOCID: 'P1', LOCDESCR: 'Planta Uno', LOCTYPE: '1010' },
    { LOCID: 'V1', LOCDESCR: 'Proveedor', LOCTYPE: 'V' },
  ])
  await guardar('bom_res', [{ RESID: 'R1', RESDESCR: 'Linea 1' }])
  await guardar('bom_resloc', [{ RESID: 'R1', LOCID: 'P1', ZTURNO: 'A' }])
  await guardar('bom_psh', [
    { SOURCEID: 'S1', PRDID: 'FG1', LOCID: 'P1', SOURCETYPE: 'P', PLEADTIME: 5, OUTPUTCOEFFICIENT: '1', PRATIO: '0.6', ZPRIO: '2' },
    { SOURCEID: ' S2 ', PRDID: 'RM1', LOCID: 'P1', SOURCETYPE: 'C' },
  ])
  await guardar('bom_psi', [{ SOURCEID: 'S1', PRDID: 'RM1', COMPONENTCOEFFICIENT: '1.5', ISALTITEM: '' }])
  await guardar('bom_psisub', [
    { SOURCEID: 'S1', PRDFR: 'FG1', SPRDFR: 'RM1' },
    { SOURCEID: 'MUERTA', PRDFR: 'X', SPRDFR: 'Y' },
  ])
  await guardar('bom_psr', [{ SOURCEID: 'S1', RESID: 'R1' }])
  await guardar('sn_loc_prod', [{ LOCID: 'P1', PRDID: 'FG1' }, { LOCID: 'P1', PRDID: 'RM1' }])
  await guardar('sn_loc', [{ PRDID: 'RM1', LOCFR: 'V1', LOCID: 'P1', TLEADTIME: '3' }])
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  olvidarBase()
  await sembrar()
})

afterEach(() => { olvidarBase() })

describe('leerDatosDeProduccion', () => {
  it('arma las cabeceras por SOURCEID con los textos limpios, como v7', async () => {
    const d = await leerDatosDeProduccion({ ent: ENT })
    expect(Object.keys(d.pshBySid).sort()).toEqual(['S1', 'S2'])
    expect(d.pshBySid.S1).toEqual([{
      PRDID: 'FG1', LOCID: 'P1', SOURCETYPE: 'P', PLEADTIME: '5', OUTPUTCOEFFICIENT: '1', PRATIO: '0.6',
    }])
    // Un campo ausente es cadena vacía, no «undefined».
    expect(d.pshBySid.S2[0]).toMatchObject({ PLEADTIME: '', OUTPUTCOEFFICIENT: '', PRATIO: '' })
    expect(d.pshPrdSet).toEqual({ FG1: true, RM1: true })
  })

  it('los campos adicionales de la cabecera y de Resource Location viajan en su registro', async () => {
    const d = await leerDatosDeProduccion({
      ent: ENT,
      extras: { psh: ['ZPRIO', 'NOEXISTE'], resourceLocation: ['ZTURNO'] },
    })
    expect(d.pshBySid.S1[0].ZPRIO).toBe('2')
    expect(d.pshBySid.S1[0]).not.toHaveProperty('NOEXISTE')
    expect(d.resLoc.R1).toEqual([{ LOCID: 'P1', ZTURNO: 'A' }])
  })

  it('los sustitutos se atan a las cabeceras vivas', async () => {
    const d = await leerDatosDeProduccion({ ent: ENT })
    expect(d.psiSub).toEqual([{ SOURCEID: 'S1', PRDFR: 'FG1', SPRDFR: 'RM1' }])
  })

  it('los maestros salen indexados por su código', async () => {
    const d = await leerDatosDeProduccion({ ent: ENT })
    expect(Object.keys(d.prd).sort()).toEqual(['FG1', 'NUEVO', 'RM1'])
    expect(d.loc.P1.LOCDESCR).toBe('Planta Uno')
    expect(d.res.R1.RESDESCR).toBe('Linea 1')
    expect(d.locProd).toHaveLength(2)
    expect(d.locSrc).toHaveLength(1)
  })

  it('una entidad sin mapear no se lee', async () => {
    const d = await leerDatosDeProduccion({ ent: { ...ENT, res: null, resLoc: null, locSrc: null } })
    expect(Object.keys(d.res)).toEqual([])
    expect(d.resLoc).toEqual({})
    expect(d.locSrc).toEqual([])
  })

  it('un identificador llamado «constructor» no pisa nada', async () => {
    await guardar('bom_res', [{ RESID: 'constructor', RESDESCR: 'Raro' }])
    const d = await leerDatosDeProduccion({ ent: ENT })
    expect(d.res.constructor.RESDESCR).toBe('Raro')
  })
})

describe('entidadesMapeadas y filtro', () => {
  it('lee de lo que dejó la descarga qué entidad cubrió cada papel', () => {
    const e = entidadesMapeadas([
      { tabla: 'bom_psh', entidad: 'PSH_E' },
      { tabla: 'bom_res', entidad: null, omitido: true },
      { tabla: 'sn_loc', entidad: 'LS_E' },
    ])
    expect(e.psh).toBe('PSH_E')
    expect(e.res).toBeNull()
    expect(e.locSrc).toBe('LS_E')
    expect(e.prd).toBeNull()
  })

  it('el filtro del Resumen es el de v7: área y, si la hay, versión', () => {
    expect(filtroDeV7({ planningArea: 'SAP4', versionId: 'V1' }))
      .toBe("PlanningAreaID eq 'SAP4' and VersionID eq 'V1'")
    expect(filtroDeV7({ planningArea: 'SAP4', versionId: '' })).toBe("PlanningAreaID eq 'SAP4'")
    expect(filtroDeV7({})).toBe('')
  })
})

describe('analizarProduccionDescargada', () => {
  const hechos = [
    { tabla: 'bom_psh', entidad: 'PSH_E', bajadas: 2, guardadas: 2 },
    { tabla: 'bom_psi', entidad: 'PSI_E', bajadas: 1, guardadas: 1 },
    { tabla: 'bom_psisub', entidad: 'SUB_E', bajadas: 2, guardadas: 2 },
    { tabla: 'bom_psr', entidad: 'PSR_E', bajadas: 1, guardadas: 1 },
    { tabla: 'bom_prd', entidad: 'PRD_E', bajadas: 3, guardadas: 3 },
    { tabla: 'bom_loc', entidad: 'LOC_E', bajadas: 2, guardadas: 2 },
    { tabla: 'bom_res', entidad: 'RES_E', bajadas: 1, guardadas: 1 },
    { tabla: 'bom_resloc', entidad: 'RL_E', bajadas: 1, guardadas: 1 },
    { tabla: 'sn_loc_prod', entidad: 'LP_E', bajadas: 2, guardadas: 2 },
    { tabla: 'sn_loc', entidad: 'LS_E', bajadas: 1, guardadas: 1 },
  ]
  const clasificacion = {
    FERT: { excluido: false, categorias: ['finished'] },
    ROH: { excluido: false, categorias: ['rawmat'] },
  }
  const base = () => ({
    hechos,
    destino: { planningArea: 'SAP4', versionId: '' },
    conexion: { url: '', pa: 'SAP4', pver: '' },
    clasificacion,
    hoy: '2026-10-01',
  })

  it('devuelve el informe de v7 con las hojas de lo que se bajó', async () => {
    const informe = await analizarProduccionDescargada(base())
    expect(informe.archivo).toBe('ProductionHierarchyAnalysis_2026-10-01.xlsx')
    expect(informe.orden).toEqual([
      'Product', 'Location', 'Resource', 'Resource Location',
      'Prod Source Header', 'Prod Source Item', 'Prod Source Resource',
    ])
  })

  it('un tipo que el maestro trae y nadie clasificó entra incluido y sin categoría', async () => {
    const informe = await analizarProduccionDescargada(base())
    const filas = informe.hojasWeb.Product.filas
    const nuevo = filas.find((f) => f.c[2] === 'NUEVO')
    expect(nuevo.c[1]).toContain('Sin categoría [ZZZ]')
  })

  it('el Resumen cuenta lo descargado y lo retenido por entidad', async () => {
    const informe = await analizarProduccionDescargada({
      ...base(),
      hechos: hechos.map((h) => (h.tabla === 'bom_psh' ? { ...h, bajadas: 5, guardadas: 2 } : h)),
    })
    const celdas = informe.hojas[0].extras.map((f) => f.celdas)
    expect(celdas).toContainEqual([
      'Production Source Header [PSH_E]',
      '5 registros descargados → 2 retenidos tras filtros automaticos (Excluye PINVALID=X)',
    ])
    expect(celdas).toContainEqual(['Filtro OData aplicado', "PlanningAreaID eq 'SAP4'"])
  })

  it('los campos adicionales llegan a las columnas', async () => {
    const informe = await analizarProduccionDescargada({ ...base(), extras: { product: ['COLOR'] } })
    const h = informe.hojasWeb.Product
    expect(h.encabezados.slice(2, 7)).toEqual(['PRDID', 'PRDDESCR', 'MATTYPEID', 'COLOR', 'En Location Product'])
    expect(h.filas.find((f) => f.c[2] === 'FG1').c[5]).toBe('ROJO')
  })

  it('avisa del avance con los textos de v7', async () => {
    const pasos = []
    await analizarProduccionDescargada({ ...base(), alAvanzar: (texto, pct) => pasos.push([texto, pct]) })
    expect(pasos[0]).toEqual(['Cargando datos desde IndexedDB...', 75])
  })
})
