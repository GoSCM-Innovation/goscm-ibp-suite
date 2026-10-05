import { describe, expect, it } from 'vitest'

import { planificarExtraccion } from '../../core/ibp/explorer-extract-plan.js'
import {
  CAMPOS_DE_RED,
  TABLAS_QUE_BAJA_RED,
  TABLAS_REQUERIDAS_RED,
  entidadesDeLaEjecucion,
  fmtDuration,
  formatoDeRed,
  lineasDeCierre,
  marca,
} from './registro-sn.js'

const formato = () => formatoDeRed({ leerCuentas: async () => ({ productosEnArcos: 41, componentes: 12 }) })

describe('la línea de estado', () => {
  it('las tablas que se guardaban en IndexedDB dicen «Descargando X → IDB...»', () => {
    expect(formato().estado({ tabla: 'sn_loc' })).toEqual({ texto: 'Descargando Location Source → IDB...', pct: 0 })
    expect(formato().estado({ tabla: 'sn_cust' })).toEqual({ texto: 'Descargando Customer Source → IDB...', pct: 8 })
    expect(formato().estado({ tabla: 'sn_plant' }).texto).toBe('Descargando Production Source Header → IDB...')
    expect(formato().estado({ tabla: 'sn_psi' }).texto).toBe('Descargando Production Source Item → IDB...')
    expect(formato().estado({ tabla: 'sn_loc_prod' }).texto).toBe('Descargando Location Product → IDB...')
    expect(formato().estado({ tabla: 'sn_cust_prod' }).texto).toBe('Descargando Customer Product → IDB...')
  })

  it('los maestros, que v7 solo indexaba en memoria, dicen «Indexando X (lookup en memoria)...»', () => {
    expect(formato().estado({ tabla: 'bom_prd' })).toEqual({ texto: 'Indexando Product (lookup en memoria)...', pct: 17 })
    expect(formato().estado({ tabla: 'bom_loc' }).texto).toBe('Indexando Location (lookup en memoria)...')
    expect(formato().estado({ tabla: 'sn_cust_master' }).texto).toBe('Indexando Customer (lookup en memoria)...')
  })

  it('una tabla que no es de este analizador no tiene texto propio', () => {
    expect(formato().estado({ tabla: 'bom_psh' })).toBeNull()
  })

  it('los porcentajes de arranque son los de v7 y suben en el orden de la descarga', () => {
    const pcts = TABLAS_QUE_BAJA_RED.map((tabla) => formato().estado({ tabla }).pct)
    expect(pcts).toEqual([0, 8, 17, 25, 28, 33, 38, 42, 46])
  })

  it('el orden de la descarga es el de v7 (la cabecera antes que sus componentes)', () => {
    expect(TABLAS_QUE_BAJA_RED).toEqual([
      'sn_loc', 'sn_cust', 'bom_prd', 'sn_plant', 'sn_psi', 'bom_loc', 'sn_loc_prod', 'sn_cust_master', 'sn_cust_prod',
    ])
  })
})

describe('lo que falta', () => {
  it('sin ninguna de las tres entidades de red dice lo que decía v7', () => {
    expect(formato().alFaltar([{ tabla: 'sn_loc' }, { tabla: 'sn_cust' }, { tabla: 'sn_plant' }, { tabla: 'bom_loc' }]))
      .toBe('Configura al menos una entidad de red antes de analizar')
  })

  it('faltando solo alguna imprescindible habla de correcciones pendientes', () => {
    expect(formato().alFaltar([{ tabla: 'sn_loc' }]))
      .toBe('Hay correcciones pendientes. Resuélvelas en el paso de mapeo de entidades antes de ejecutar.')
    expect(formato().alFaltar([{ tabla: 'sn_cust_prod' }]))
      .toBe('Hay correcciones pendientes. Resuélvelas en el paso de mapeo de entidades antes de ejecutar.')
  })

  it('las imprescindibles son las ocho que v7 validaba (el maestro de productos no estaba)', () => {
    expect(TABLAS_REQUERIDAS_RED).toHaveLength(8)
    expect(TABLAS_REQUERIDAS_RED).not.toContain('bom_prd')
  })
})

describe('qué se le pide a SAP', () => {
  it('los campos de cada tabla son los de v7 (efGetSelect y los select fijos)', () => {
    expect(CAMPOS_DE_RED.sn_loc).toEqual(['PRDID', 'LOCFR', 'LOCID', 'TLEADTIME', 'TINVALID'])
    expect(CAMPOS_DE_RED.sn_cust).toEqual(['PRDID', 'LOCID', 'CUSTID', 'CLEADTIME', 'CINVALID'])
    expect(CAMPOS_DE_RED.bom_prd).toEqual(['PRDID', 'PRDDESCR', 'MATTYPEID'])
    expect(CAMPOS_DE_RED.sn_plant).toEqual(['SOURCEID', 'PRDID', 'LOCID', 'PLEADTIME', 'PRATIO', 'PINVALID'])
    expect(CAMPOS_DE_RED.sn_psi).toEqual(['SOURCEID', 'PRDID', 'COMPONENTCOEFFICIENT'])
    expect(CAMPOS_DE_RED.bom_loc).toEqual(['LOCID', 'LOCDESCR', 'LOCTYPE', 'LOCVALID'])
    expect(CAMPOS_DE_RED.sn_loc_prod).toEqual(['LOCID', 'PRDID'])
    expect(CAMPOS_DE_RED.sn_cust_master).toEqual(['CUSTID', 'CUSTDESCR', 'CUSTVALID'])
    expect(CAMPOS_DE_RED.sn_cust_prod).toEqual(['CUSTID', 'PRDID'])
  })

  it('el plan, con esos campos, pide justo eso: el maestro de productos sin UOMID ni UOMDESCR', () => {
    const efectivo = {
      arbol: { product: { entidad: 'Product' }, locMaster: { entidad: 'Location' } },
      red: {
        location: { entidad: 'SourceLocation' },
        customer: { entidad: 'SourceCustomer' },
        sourceProd: { entidad: 'SourceProd' },
        sourceItem: { entidad: 'SourceItem' },
        locProd: { entidad: 'LocProd' },
        custProd: { entidad: 'CustProd' },
        custMaster: { entidad: 'Customer' },
      },
    }
    const plan = planificarExtraccion({
      efectivo, tablas: TABLAS_QUE_BAJA_RED, solo: CAMPOS_DE_RED,
    })
    expect(plan.pasos.map((p) => p.tabla)).toEqual(TABLAS_QUE_BAJA_RED)
    const producto = plan.pasos.find((p) => p.tabla === 'bom_prd')
    // Sin mapa de campos, `armarSelect` pide los nombres canónicos tal cual.
    expect(producto.select).toEqual(['PRDID', 'PRDDESCR', 'MATTYPEID'])
    expect(plan.pasos.find((p) => p.tabla === 'sn_loc').select).toEqual(CAMPOS_DE_RED.sn_loc)
    // Los campos adicionales se suman, sin repetir.
    const conExtras = planificarExtraccion({
      efectivo, tablas: TABLAS_QUE_BAJA_RED, solo: CAMPOS_DE_RED, extras: { bom_prd: ['ZGRUPO', 'MATTYPEID'] },
    })
    expect(conExtras.pasos.find((p) => p.tabla === 'bom_prd').select).toEqual(['PRDID', 'PRDDESCR', 'MATTYPEID', 'ZGRUPO'])
  })

  it('sin `solo`, el plan sigue pidiendo los campos del plan (el árbol no cambia)', () => {
    const efectivo = { arbol: { product: { entidad: 'Product' } } }
    const plan = planificarExtraccion({ efectivo, tablas: ['bom_prd'] })
    expect(plan.pasos[0].select).toEqual(['PRDID', 'PRDDESCR', 'MATTYPEID', 'UOMID', 'UOMDESCR'])
  })
})

describe('el registro de la descarga', () => {
  const paso = (tabla, extra = {}) => ({ tabla, entidad: `E_${tabla}`, sePuede: true, omitidos: [], ...extra })
  const hecho = (tabla, extra = {}) => ({ tabla, entidad: `E_${tabla}`, bajadas: 10, guardadas: 10, ...extra })
  const textos = (lineas) => lineas.map((una) => `${una.clase}|${una.texto}`)

  it('cada tabla lleva su petición y su línea de resultado, con los textos de v7', async () => {
    const plan = { pasos: TABLAS_QUE_BAJA_RED.map((t) => paso(t)) }
    const salida = { hechos: TABLAS_QUE_BAJA_RED.map((t, i) => hecho(t, { bajadas: 100 + i })) }
    const tiempos = new Map(TABLAS_QUE_BAJA_RED.map((t, i) => [t, (i + 1) * 100]))

    const lineas = await formato().lineas({ plan, salida, tiempos })
    expect(textos(lineas)).toEqual([
      'info|[+0ms] [GET] E_sn_loc',
      'ok|[+100ms] Location Source: 100 reg → IDB (41 productos)',
      'info|[+0ms] [GET] E_sn_cust',
      'ok|[+200ms] Customer Source: 101 reg → IDB',
      'info|[+0ms] [GET] E_bom_prd',
      'ok|[+300ms] Product: 102 reg',
      'info|[+0ms] [GET] E_sn_plant',
      'ok|[+400ms] Production Source Header: 103 reg → IDB',
      'info|[+0ms] [GET] E_sn_psi',
      'ok|[+500ms] Production Source Item: 104 reg → IDB (12 componentes únicos)',
      'info|[+0ms] [GET] E_bom_loc',
      'ok|[+600ms] Location: 105 reg',
      'info|[+0ms] [GET] E_sn_loc_prod',
      'ok|[+700ms] Location Product: 106 reg → IDB',
      'info|[+0ms] [GET] E_sn_cust_master',
      'ok|[+800ms] Customer: 107 reg',
      'info|[+0ms] [GET] E_sn_cust_prod',
      'ok|[+900ms] Customer Product: 108 reg → IDB',
    ])
  })

  it('las cuentas del paréntesis se leen una sola vez', async () => {
    let lecturas = 0
    const f = formatoDeRed({ leerCuentas: async () => { lecturas += 1; return { productosEnArcos: 1, componentes: 1 } } })
    await f.lineas({
      plan: { pasos: [paso('sn_loc'), paso('sn_psi')] },
      salida: { hechos: [hecho('sn_loc'), hecho('sn_psi')] },
      tiempos: new Map(),
    })
    expect(lecturas).toBe(1)
  })

  it('una entidad sin configurar no dice nada, como v7', async () => {
    const lineas = await formato().lineas({
      plan: { pasos: [paso('bom_prd', { sePuede: false })] },
      salida: { hechos: [] },
      tiempos: new Map(),
    })
    expect(lineas).toEqual([])
  })

  it('una entidad que devolvió 0 registros avisa, sin voseo', async () => {
    const plan = { pasos: [paso('sn_cust')] }
    const salida = { hechos: [hecho('sn_cust', { bajadas: 0, guardadas: 0 })] }
    const lineas = await formato().lineas({ plan, salida, tiempos: new Map([['sn_cust', 300]]) })

    expect(textos(lineas)).toEqual([
      'info|[+0ms] [GET] E_sn_cust',
      'ok|[+300ms] Customer Source: 0 reg → IDB',
      'warn|[+300ms] ⚠️ Customer Source (E_sn_cust): 0 registros. Verifica que la entidad OData seleccionada sea la correcta para esta Planning Area.',
    ])
  })

  it('una tabla incompleta se dice en rojo', async () => {
    const plan = { pasos: [paso('sn_plant')] }
    const salida = { hechos: [hecho('sn_plant', { bajadas: 5, enSap: 9, faltan: 4 })] }
    const lineas = await formato().lineas({ plan, salida, tiempos: new Map() })
    expect(textos(lineas)[2]).toContain('err|✕ Production Source Header: incompleta')
  })

  it('un campo que el tenant no tiene se avisa', async () => {
    const plan = { pasos: [paso('sn_loc', { omitidos: ['TLEADTIME'] })] }
    const lineas = await formato().lineas({ plan, salida: { hechos: [hecho('sn_loc')] }, tiempos: new Map() })
    expect(textos(lineas).at(-1)).toBe('warn|Location Source: este tenant no tiene TLEADTIME. Se baja sin ese campo.')
  })

  it('un error de una tabla sale como error', async () => {
    const plan = { pasos: [paso('sn_cust_prod')] }
    const salida = { hechos: [hecho('sn_cust_prod', { error: 'se cayó' })] }
    const lineas = await formato().lineas({ plan, salida, tiempos: new Map() })
    expect(textos(lineas)).toEqual(['info|[+0ms] [GET] E_sn_cust_prod', 'err|[+0ms] Customer Product: error — se cayó'])
  })

  it('el tiempo se escribe como v7', () => {
    expect(marca(1234.6)).toBe('[+1235ms]')
    expect(marca(-3)).toBe('[+0ms]')
  })
})

describe('el cierre del análisis', () => {
  it('la duración se escribe como v7, con su redondeo', () => {
    expect(fmtDuration(0)).toBe('0 s')
    expect(fmtDuration(45400)).toBe('45 s')
    expect(fmtDuration(45600)).toBe('46 s')
    expect(fmtDuration(60000)).toBe('1 min')
    expect(fmtDuration(125000)).toBe('2 min 5 s')
    // El redondeo de v7 no se corrige: 59,6 s sale «60 s».
    expect(fmtDuration(59600)).toBe('60 s')
  })

  it('dice lo mismo que v7 según cómo se quiso ver', () => {
    const base = { totalProducts: 12345, ms: 125000 }
    expect(lineasDeCierre({ ...base, modo: 'excel' })).toEqual({
      registro: 'Análisis completado. 12.345 productos analizados · Excel descargado · 2 min 5 s.',
      estado: '✓ Análisis completado — Excel descargado | 12.345 productos · 2 min 5 s',
    })
    expect(lineasDeCierre({ ...base, modo: 'web' }).registro)
      .toBe('Análisis completado. 12.345 productos analizados · vista web generada · 2 min 5 s.')
    expect(lineasDeCierre({ ...base, modo: 'both' }).registro)
      .toBe('Análisis completado. 12.345 productos analizados · Excel descargado + vista web · 2 min 5 s.')
  })

  // En v7 `analyzer.status.complete` no cambia con el modo.
  it('la línea de estado dice «Excel descargado» aunque solo se haya pedido la vista web', () => {
    expect(lineasDeCierre({ totalProducts: 7, modo: 'web', ms: 3000 }).estado)
      .toBe('✓ Análisis completado — Excel descargado | 7 productos · 3 s')
  })
})

describe('entidadesDeLaEjecucion', () => {
  const hechos = TABLAS_QUE_BAJA_RED.map((t, i) => ({ tabla: t, entidad: `E_${t}`, bajadas: 100 + i, guardadas: 90 + i }))

  it('devuelve las nueve entidades en el orden de v7, con lo que v7 anotaba de cada una', () => {
    const e = entidadesDeLaEjecucion(hechos)
    expect(e.map((x) => x.name)).toEqual([
      'Location Source', 'Customer Source', 'Product', 'Production Source Header', 'Production Source Item',
      'Location', 'Location Product', 'Customer', 'Customer Product',
    ])
    expect(e[0]).toEqual({
      name: 'Location Source', entityName: 'E_sn_loc', downloaded: 100, retained: 90,
      statKey: 'Location Source', note: 'Excluye TINVALID=X',
    })
    // El maestro de productos y las dos tablas «Product» no tenían filtro: ni «retenidas» ni nota.
    expect(e[2]).toEqual({ name: 'Product', entityName: 'E_bom_prd', downloaded: 102, statKey: 'Product' })
    expect(e[6]).toEqual({ name: 'Location Product', entityName: 'E_sn_loc_prod', downloaded: 106 })
    expect(e[8]).toEqual({ name: 'Customer Product', entityName: 'E_sn_cust_prod', downloaded: 108 })
    // La cabecera y los componentes: retenidas y nota, pero sin hoja con que cruzarse.
    expect(e[3]).toMatchObject({ name: 'Production Source Header', retained: 93, note: 'Excluye PINVALID=X' })
    expect(e[3].statKey).toBeUndefined()
    expect(e[4]).toMatchObject({ retained: 94, note: 'Solo SOURCEIDs activos en PSH' })
    expect(e[5]).toMatchObject({ name: 'Location', statKey: 'Location', note: 'Excluye LOCVALID=X' })
    expect(e[7]).toMatchObject({ name: 'Customer', statKey: 'Customer', note: 'Excluye CUSTVALID=X' })
  })

  it('no incluye lo que no se bajó', () => {
    const e = entidadesDeLaEjecucion([
      ...hechos.slice(0, 2),
      { tabla: 'bom_prd', entidad: null, omitido: true },
      { tabla: 'sn_plant', entidad: 'X', error: 'no' },
    ])
    expect(e.map((x) => x.name)).toEqual(['Location Source', 'Customer Source'])
  })
})
