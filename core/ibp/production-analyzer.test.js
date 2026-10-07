// Pruebas del análisis de v7: una fixture pequeña cuyas respuestas se calcularon A MANO leyendo
// `prodAnalyzer.js` de v7, no corriendo este código. Si una prueba falla, el sospechoso es el port.

import { describe, expect, it } from 'vitest'

import { analizarProduccion } from './production-analyzer.js'
import { desdeClasificacion, iniciarTipos } from './mattype-config.js'

const ENT = { prd: 1, loc: 1, res: 1, resLoc: 1, psh: 1, psi: 1, psiSub: 1, psr: 1, locPrd: 1, locSrc: 1 }

/**
 * El tenant de juguete:
 *
 *   P1 y P2 son plantas; V1 un proveedor; DC1 un centro de distribución.
 *   FG1 (terminado) se fabrica en P1 con la receta S1: lleva SEMI1, RM1 y X1.
 *   SEMI1 (semiterminado) se fabrica en P1 con S2 (PLEADTIME 0): lleva RM1.
 *   RM1 (materia prima) llega de V1 a P1. TR1 (mercadería) va de V1 a DC1 con TLEADTIME 0.
 *   X1 es de un tipo excluido (VERP) y nadie lo lleva a P1. U1 no tiene categoría. NOMT no tiene tipo.
 *   R1 está en una receta y en P1; R2 está en P1 y en ninguna receta; R3 no está en ningún sitio.
 */
function datos(extra = {}) {
  const prd = {
    FG1: { PRDID: 'FG1', PRDDESCR: 'Aceite 1L', MATTYPEID: 'FERT', COLOR: 'ROJO' },
    SEMI1: { PRDID: 'SEMI1', PRDDESCR: 'Mezcla', MATTYPEID: 'HALB' },
    RM1: { PRDID: 'RM1', PRDDESCR: 'Resina', MATTYPEID: 'ROH' },
    TR1: { PRDID: 'TR1', PRDDESCR: 'Valvula', MATTYPEID: 'HAND' },
    X1: { PRDID: 'X1', PRDDESCR: 'Caja', MATTYPEID: 'VERP' },
    U1: { PRDID: 'U1', PRDDESCR: 'Raro', MATTYPEID: 'ZZZ' },
    NOMT: { PRDID: 'NOMT', PRDDESCR: 'Sin tipo', MATTYPEID: '' },
  }
  const clasificacion = {
    FERT: { excluido: false, categorias: ['finished'] },
    HALB: { excluido: false, categorias: ['semi'] },
    ROH: { excluido: false, categorias: ['rawmat'] },
    HAND: { excluido: false, categorias: ['trading'] },
    VERP: { excluido: true, categorias: [] },
    ZZZ: { excluido: false, categorias: [] },
  }
  const tipos = desdeClasificacion(clasificacion, { VERP: 1 })

  return {
    ent: ENT,
    prd,
    loc: {
      P1: { LOCID: 'P1', LOCDESCR: 'Planta Uno', LOCTYPE: '1010' },
      P2: { LOCID: 'P2', LOCDESCR: 'Planta Dos', LOCTYPE: '1010' },
      V1: { LOCID: 'V1', LOCDESCR: 'Proveedor 1', LOCTYPE: 'V' },
      DC1: { LOCID: 'DC1', LOCDESCR: 'CD Norte', LOCTYPE: '1020' },
    },
    res: {
      R1: { RESID: 'R1', RESDESCR: 'Linea 1' },
      R2: { RESID: 'R2', RESDESCR: 'Horno' },
      R3: { RESID: 'R3', RESDESCR: 'Perdido' },
    },
    resLoc: { R1: [{ LOCID: 'P1' }], R2: [{ LOCID: 'P1' }] },
    pshBySid: {
      S1: [{ PRDID: 'FG1', LOCID: 'P1', SOURCETYPE: 'P', PLEADTIME: '5', OUTPUTCOEFFICIENT: '1', PRATIO: '' }],
      S2: [{ PRDID: 'SEMI1', LOCID: 'P1', SOURCETYPE: 'P', PLEADTIME: '0', OUTPUTCOEFFICIENT: '10', PRATIO: '' }],
    },
    pshPrdSet: { FG1: true, SEMI1: true },
    psi: [
      { SOURCEID: 'S1', PRDID: 'SEMI1', COMPONENTCOEFFICIENT: '2', ISALTITEM: '' },
      { SOURCEID: 'S1', PRDID: 'RM1', COMPONENTCOEFFICIENT: '1.5', ISALTITEM: '' },
      { SOURCEID: 'S1', PRDID: 'X1', COMPONENTCOEFFICIENT: '1', ISALTITEM: '' },
      { SOURCEID: 'S2', PRDID: 'RM1', COMPONENTCOEFFICIENT: '3', ISALTITEM: '' },
    ],
    psiSub: [],
    psr: [{ SOURCEID: 'S1', RESID: 'R1' }, { SOURCEID: 'S2', RESID: 'R1' }],
    locProd: [
      { LOCID: 'P1', PRDID: 'FG1' }, { LOCID: 'P1', PRDID: 'SEMI1' }, { LOCID: 'P1', PRDID: 'RM1' },
    ],
    locSrc: [
      { PRDID: 'RM1', LOCFR: 'V1', LOCID: 'P1', TLEADTIME: '3' },
      { PRDID: 'FG1', LOCFR: 'P1', LOCID: 'DC1', TLEADTIME: '2' },
      { PRDID: 'TR1', LOCFR: 'V1', LOCID: 'DC1', TLEADTIME: '0' },
    ],
    tipos,
    extras: {},
    conexion: { url: '', pa: 'PA1', pver: '' },
    ejecucion: null,
    hoy: '2026-10-01',
    ...extra,
  }
}

const sinNulos = (celdas) => celdas.map((v) => v ?? '')
const hoja = (informe, nombre) => informe.hojas.find((una) => una.nombre === nombre)
const filaDe = (informe, nombre, i) => sinNulos(hoja(informe, nombre).filas[i].c)

describe('tipos de material (mattype-config.js)', () => {
  it('cuenta los productos por tipo y descarta los que no tienen', () => {
    const cfg = iniciarTipos(datos().prd)
    expect(Object.keys(cfg).sort()).toEqual(['FERT', 'HALB', 'HAND', 'ROH', 'VERP', 'ZZZ'])
    expect(cfg.FERT.count).toBe(1)
    expect(cfg.FERT.excluded).toBe(false)
    expect(cfg.FERT.categories.size).toBe(0)
  })
})

describe('analizarProduccion — encabezados del Excel', () => {
  // v7 escribe `hdrs.map(cleanXml)` en este analizador; el de la red escribe los suyos sin limpiar.
  it('todas las hojas piden escribir los encabezados limpios', async () => {
    const informe = await analizarProduccion(datos())
    const tablas = informe.hojas.filter((una) => una.tipo === 'tabla')
    expect(tablas.length).toBeGreaterThan(1)
    expect(tablas.every((una) => una.limpiarEncabezados === true)).toBe(true)
  })
})

describe('analizarProduccion — hoja Product', () => {
  it('juzga cada producto con las reglas de su categoría', async () => {
    const informe = await analizarProduccion(datos())
    const h = hoja(informe, 'Product')

    // Orden: PRDID ascendente. NOMT (sin tipo) y X1 (excluido) no salen.
    expect(h.filas.map((f) => f.c[2])).toEqual(['FG1', 'RM1', 'SEMI1', 'TR1', 'U1'])
    expect(h.filas.map((f) => f.s)).toEqual(['ok', 'ok', 'yel', 'red', 'red'])
    expect({ t: h.total, r: h.red, y: h.yel, o: h.ok }).toEqual({ t: 5, r: 2, y: 1, o: 2 })

    expect(filaDe(informe, 'Product', 0)).toEqual([
      '✅ OK',
      'Habilitado en Location Product | Con PSH, PSI y PSR | Planta es origen en Location Source | '
      + 'PLEADTIME definido en todos los SOURCEIDs | Coeficiente de salida definido | '
      + 'PSH con SOURCETYPE=P presente | TLEADTIME definido en Location Source',
      'FG1', 'Aceite 1L', 'FERT',
      'Si', 'Si', 'No', 'Si',
      1, 'S1', 1, 'P1', 3, 1, 'R1',
      0, '', 0, '', 0, '', 0, '', 1, 'P1', 0, '',
    ])
  })

  it('a una materia prima le exige arco de proveedor y no receta', async () => {
    const informe = await analizarProduccion(datos())
    expect(filaDe(informe, 'Product', 1)).toEqual([
      '✅ OK',
      'Habilitado en Location Product | Arcos de abastecimiento completos | Sin BOM de fabricación | '
      + 'Consumido como componente en BOM | TLEADTIME definido en Location Source',
      'RM1', 'Resina', 'ROH',
      'Si', 'No', 'Si', 'Si',
      0, '', 0, '', 0, 0, '',
      1, 'V1', 1, 'P1', 0, '', 2, 'FG1, SEMI1', 1, 'V1', 1, 'P1',
    ])
  })

  it('un semiterminado con PLEADTIME 0 es una advertencia, no una alerta', async () => {
    const informe = await analizarProduccion(datos())
    expect(filaDe(informe, 'Product', 2).slice(0, 2)).toEqual([
      '⚠ Advertencia',
      'PLEADTIME ausente o cero en 1 SOURCEID(s)',
    ])
    // Plantas sin cobertura: SEMI1 se consume en P1 y ningún arco lo lleva ahí.
    expect(filaDe(informe, 'Product', 2).slice(18, 22)).toEqual([0, '', 1, 'P1'])
  })

  it('una mercadería sin Location Product y con TLEADTIME en cero sale en alerta', async () => {
    const informe = await analizarProduccion(datos())
    expect(filaDe(informe, 'Product', 3).slice(0, 2)).toEqual([
      '⛔ Alerta',
      'Sin cobertura en Location Product | TLEADTIME = 0 en todos los arcos de Location Source',
    ])
  })

  it('un tipo sin categoría pide todo en modo permisivo y lo dice primero', async () => {
    const informe = await analizarProduccion(datos())
    expect(filaDe(informe, 'Product', 4).slice(0, 2)).toEqual([
      '⛔ Alerta',
      'Sin categoría [ZZZ] | Sin cobertura en Location Product | Sin fuente de producción propia (PSH) | '
      + 'Sin arco de abastecimiento (no registrado en Location Source) | Sin arcos en Location Source | '
      + 'No consumido como componente en ningún BOM',
    ])
  })
})

describe('analizarProduccion — hoja Location', () => {
  it('deduce los roles del comportamiento y juzga cada uno', async () => {
    const informe = await analizarProduccion(datos())
    const h = hoja(informe, 'Location')

    // Orden alfabético: DC1, P1, P2, V1.
    expect(h.filas.map((f) => f.c[2])).toEqual(['DC1', 'P1', 'P2', 'V1'])
    expect(h.filas.map((f) => f.s)).toEqual(['red', 'red', 'ok', 'red'])

    // DC1 solo recibe: no tiene Location Product de lo que le llega.
    expect(filaDe(informe, 'Location', 0).slice(0, 6)).toEqual([
      '⛔ Alerta',
      '2 producto(s) recibidos sin cobertura en Location Product',
      'DC1', 'CD Norte', '1020', 'Nodo receptor',
    ])

    // P1 es planta y además manda FG1 a un destino que no lo consume (nodo de transferencia).
    expect(filaDe(informe, 'Location', 1)).toEqual([
      '⛔ Alerta',
      '1 componente(s) sin arco de abastecimiento | 1 SOURCEID(s) con PLEADTIME = 0 | '
      + '1 recurso(s) asignados sin uso en PSR',
      'P1', 'Planta Uno', '1010', 'Planta de producción | Nodo de transferencia',
      2, 'FG1, SEMI1', 2, 'S1, S2', 2, 'R1, R2', 1, 'R1', 1, 'R2',
      0, '', 0, '',
      3, 1, 'X1', 1, 'S2',
      // Las métricas de «proveedor» se calculan para cualquier origen de Location Source, aunque el
      // rol no aplique: P1 manda FG1 a DC1, que no lo consume ni lo tiene en Location Product.
      1, 'FG1', 1, 'DC1', 1, 'FG1', 1, 'FG1',
      1, 'FG1', 1, 'DC1',
      1, 'RM1', 1, 'V1',
    ])

    // P2 existe en el maestro y nada más: «Sin actividad» sale como OK (v7 no tiene un cuarto estado).
    expect(filaDe(informe, 'Location', 2).slice(0, 6)).toEqual([
      '✅ OK',
      'Ubicación en maestro sin actividad en otros datos',
      'P2', 'Planta Dos', '1010', 'Sin actividad',
    ])

    // V1 abastece RM1 (que P1 consume) y reenvía TR1 a un destino que no lo consume.
    expect(filaDe(informe, 'Location', 3).slice(0, 6)).toEqual([
      '⛔ Alerta',
      '1 producto(s) abastecidos sin consumo PSI en destino | 1 producto(s) sin Location Product en planta destino',
      'V1', 'Proveedor 1', 'V', 'Proveedor | Nodo de transferencia',
    ])
    expect(filaDe(informe, 'Location', 3).slice(25, 41)).toEqual([
      2, 'RM1, TR1', 2, 'DC1, P1', 1, 'TR1', 1, 'TR1',
      1, 'TR1', 1, 'DC1',
      0, '', 0, '',
    ])
  })
})

describe('analizarProduccion — recursos y receta', () => {
  it('Resource: huérfano es alerta, sin uso es advertencia', async () => {
    const informe = await analizarProduccion(datos())
    expect(hoja(informe, 'Resource').filas.map((f) => f.s)).toEqual(['ok', 'yel', 'red'])
    expect(filaDe(informe, 'Resource', 0)).toEqual([
      '✅ OK', 'En uso en PSR y con planta asignada en Resource Location',
      'R1', 'Linea 1', 'Si', 'Si', 1, 'P1', 2, 'S1, S2', 2, 'FG1, SEMI1',
    ])
    expect(filaDe(informe, 'Resource', 1)[1]).toBe('Sin uso en producción (no aparece en PSR)')
    expect(filaDe(informe, 'Resource', 2)[1]).toBe('Recurso huérfano: sin uso en producción ni planta asignada')
  })

  it('Resource Location: asignado sin uso en PSR es advertencia', async () => {
    const informe = await analizarProduccion(datos())
    expect(hoja(informe, 'Resource Location').filas.map((f) => f.s)).toEqual(['ok', 'yel'])
    expect(filaDe(informe, 'Resource Location', 1)).toEqual([
      '⚠ Advertencia',
      'Recurso asignado a planta pero sin uso en PSR para esta planta',
      'R2', 'Horno', 'P1', 'Planta Uno', 'No',
    ])
  })

  it('Prod Source Header: el lead time en cero es alerta', async () => {
    const informe = await analizarProduccion(datos())
    expect(filaDe(informe, 'Prod Source Header', 0)).toEqual([
      '✅ OK',
      'BOM con componentes PSI | Lead time definido | Habilitado en LP | SOURCETYPE=P presente | Recursos PSR asignados',
      'S1', 'FG1', 'Aceite 1L', 'FERT', 'P1', 'Planta Uno', 'P', '5', '1', '', 'Si', 3, 1, 'R1', 0, 'Si',
    ])
    expect(filaDe(informe, 'Prod Source Header', 1).slice(0, 2)).toEqual([
      '⛔ Alerta', 'PLEADTIME = 0 o no definido',
    ])
  })

  it('Prod Source Item: semielaborado local, insumo con arco, y componente de tipo excluido', async () => {
    const informe = await analizarProduccion(datos())
    const h = hoja(informe, 'Prod Source Item')
    expect(h.filas.map((f) => f.s)).toEqual(['ok', 'ok', 'red', 'ok'])

    expect(filaDe(informe, 'Prod Source Item', 0)).toEqual([
      '✅ OK', 'Semielaborado: trazabilidad en PSH',
      'S1', 'FG1', 'Aceite 1L', 'FERT', 'P1', 'Planta Uno',
      'SEMI1', 'Mezcla', 'HALB', '2', 'Semielaborado', 'Si', 'N/A', '', '', 1, 'P1', '', '',
    ])
    expect(filaDe(informe, 'Prod Source Item', 1)).toEqual([
      '✅ OK',
      'SOURCEID valido en PSH | Coeficiente definido | Con arco de abastecimiento en Location Source | Habilitado en Location Product',
      'S1', 'FG1', 'Aceite 1L', 'FERT', 'P1', 'Planta Uno',
      'RM1', 'Resina', 'ROH', '1.5', 'Insumo', 'Si', 'Si', 'V1', 'Proveedor 1', 1, 'V1', '', '',
    ])
    expect(filaDe(informe, 'Prod Source Item', 2).slice(0, 2)).toEqual([
      '⛔ Alerta',
      'Insumo sin arco de abastecimiento en Location Source | Componente no habilitado en Location Product '
      + 'para esta planta | Componente de tipo excluido (VERP) — validado en contexto',
    ])
    expect(filaDe(informe, 'Prod Source Item', 2).slice(8, 21)).toEqual([
      'X1', 'Caja', 'VERP', '1', 'Insumo', 'No', 'No', '', '', 0, '', '', '',
    ])
  })

  it('Prod Source Resource: la asignación consistente es OK', async () => {
    const informe = await analizarProduccion(datos())
    expect(filaDe(informe, 'Prod Source Resource', 0)).toEqual([
      '✅ OK',
      'Recurso R1 asignado en Resource Location para planta P1 | Asociado a SOURCEID S1',
      'S1', 'FG1', 'Aceite 1L', 'FERT', 'P1', 'Planta Uno', 'R1', 'Linea 1', 'Si', 1, 'P1',
    ])
  })

  it('un sustituto sin registro en Item Sub es advertencia solo si la entidad está mapeada', async () => {
    const d = datos()
    d.psi.push({ SOURCEID: 'S1', PRDID: 'RM1', COMPONENTCOEFFICIENT: '1', ISALTITEM: 'X' })
    const con = await analizarProduccion(d)
    const ultima = hoja(con, 'Prod Source Item').filas.at(-1)
    expect(ultima.c[1]).toBe('Material de reemplazo sin registro en Item Sub')
    expect(ultima.s).toBe('yel')

    d.ent = { ...ENT, psiSub: 0 }
    const sin = await analizarProduccion(d)
    expect(hoja(sin, 'Prod Source Item').filas.at(-1).s).toBe('ok')
  })

  it('un sustituto con registro en Item Sub dice a quién reemplaza', async () => {
    const d = datos()
    d.psi.push({ SOURCEID: 'S1', PRDID: 'RM1', COMPONENTCOEFFICIENT: '1', ISALTITEM: 'X' })
    d.psiSub = [{ SOURCEID: 'S1', PRDFR: 'SEMI1', SPRDFR: 'RM1' }]
    const informe = await analizarProduccion(d)
    const f = hoja(informe, 'Prod Source Item').filas.at(-1)
    expect(sinNulos(f.c).slice(19)).toEqual(['X', 'SEMI1'])
  })
})

describe('analizarProduccion — Tipos Excluidos, Resumen y Estadísticas', () => {
  it('Tipos Excluidos cuenta las combinaciones componente-planta sin arco', async () => {
    const informe = await analizarProduccion(datos())
    const h = hoja(informe, 'Tipos Excluidos')
    expect(h.conEstado).toBe(false)
    expect(sinNulos(h.filas[0].c)).toEqual([
      'VERP', 1, 1, 'S1', 0, 1,
      'Excluido del análisis principal. Validado como componente en 1 fuente(s) de producción. '
      + '⚠️ 1 combinación(es) componente-planta sin arco de abastecimiento.',
    ])
    expect(h.filas[0].s).toBe('yel')
  })

  it('sin tipos excluidos no hay hoja Tipos Excluidos', async () => {
    const d = datos()
    d.tipos = desdeClasificacion({ FERT: { excluido: false, categorias: [] } })
    const informe = await analizarProduccion(d)
    expect(hoja(informe, 'Tipos Excluidos')).toBeUndefined()
    expect(informe.orden).not.toContain('Tipos Excluidos')
  })

  it('el Resumen cuenta cada hoja y calcula el % de consistencia', async () => {
    const informe = await analizarProduccion(datos())
    expect(informe.resumen.map((r) => [r.nombre, r.total, r.red, r.yel, r.ok, r.pct])).toEqual([
      ['Product', 5, 2, 1, 2, 40],
      ['Location', 4, 3, 0, 1, 25],
      ['Resource', 3, 1, 1, 1, 33],
      ['Resource Location', 2, 0, 1, 1, 50],
      ['Prod Source Header', 2, 1, 0, 1, 50],
      ['Prod Source Item', 4, 1, 0, 3, 75],
      ['Prod Source Resource', 2, 0, 0, 2, 100],
      ['Tipos Excluidos', 1, 0, 1, 0, 0],
    ])

    const resumen = hoja(informe, 'Resumen')
    expect(sinNulos(resumen.filas[0].c)).toEqual([1, 'Product', 5, 2, 1, 2, '40%'])
    expect(resumen.filas[0].s).toBe('red')
    // Resource Location solo tiene advertencias: la fila va en amarillo.
    expect(resumen.filas[3].s).toBe('yel')
    expect(resumen.filas[6].s).toBe('ok')
  })

  it('el orden de las hojas del Excel es Resumen, Estadísticas y luego las de análisis', async () => {
    const informe = await analizarProduccion(datos())
    expect(informe.hojas.map((h) => h.nombre)).toEqual([
      'Resumen', 'Estadísticas', 'Product', 'Location', 'Resource', 'Resource Location',
      'Prod Source Header', 'Prod Source Item', 'Prod Source Resource', 'Tipos Excluidos',
    ])
    // La vista web no lleva el Resumen entre sus pestañas: lo lleva en las tarjetas.
    expect(informe.orden).toEqual([
      'Product', 'Location', 'Resource', 'Resource Location',
      'Prod Source Header', 'Prod Source Item', 'Prod Source Resource', 'Tipos Excluidos',
    ])
    expect(informe.archivo).toBe('ProductionHierarchyAnalysis_2026-10-01.xlsx')
  })

  it('una entidad sin mapear omite su hoja, como en v7', async () => {
    const d = datos()
    d.ent = { ...ENT, res: 0, resLoc: 0 }
    const informe = await analizarProduccion(d)
    expect(hoja(informe, 'Resource')).toBeUndefined()
    expect(hoja(informe, 'Resource Location')).toBeUndefined()
    expect(informe.resumen.map((r) => r.nombre)).not.toContain('Resource')
  })

  it('Estadísticas: la composición del maestro por tipo de material', async () => {
    const informe = await analizarProduccion(datos())
    const e = informe.estadisticas
    expect(e[0]).toEqual(['Estadísticas — Production Hierarchy'])
    expect(e[1]).toEqual([])
    expect(e[2]).toEqual(['PRODUCTO — Composición del maestro por tipo de material'])
    expect(e[3]).toEqual(['Tipo de material', 'Productos', 'Solo output (PSH)',
      'Solo componente (PSI)', 'Output + componente', 'Sin uso en estructura', '% maestro'])
    expect(e[4]).toEqual(['(sin tipo)', '1', '0', '0', '0', '1', '14%'])
    expect(e[5]).toEqual(['FERT', '1', '1', '0', '0', '0', '14%'])
    expect(e[6]).toEqual(['HALB', '1', '0', '0', '1', '0', '14%'])
    expect(e[10]).toEqual(['ZZZ', '1', '0', '0', '0', '1', '14%'])
    expect(e[11]).toEqual(['TOTAL', '7', '1', '2', '1', '3', '100%'])
    // La hoja Estadísticas arranca con el título, que el Excel pinta como encabezado.
    expect(hoja(informe, 'Estadísticas').filas[0].celdas).toEqual(['Estadísticas — Production Hierarchy'])
  })

  it('Estadísticas: sin campos adicionales lo dice', async () => {
    const informe = await analizarProduccion(datos())
    expect(informe.estadisticas.at(-1)).toEqual([
      'No se seleccionaron campos adicionales. Agrégalos en el paso "Campos adicionales" para ver cruces aquí.',
    ])
  })

  it('el bloque de metadatos del Resumen trae ejecución, conexión, entidades, tipos y métricas', async () => {
    const generadoEl = new Date(2026, 9, 1, 12, 30, 0)
    const informe = await analizarProduccion(datos({
      conexion: { url: '', pa: 'PA1', pver: 'V1' },
      ejecucion: {
        generadoEl,
        filtro: "PlanningAreaID eq 'PA1'",
        entidades: [
          { name: 'Production Source Header', entityName: 'PSH_E', downloaded: 5, retained: 2, statKey: 'Prod Source Header', note: 'Excluye PINVALID=X' },
          { name: 'Product', entityName: 'PRD_E', downloaded: 7, statKey: 'Product' },
        ],
      },
    }))
    const libres = hoja(informe, 'Resumen').extras
    const celdas = libres.map((f) => f.celdas)

    expect(celdas[0]).toEqual([])
    expect(celdas[1]).toEqual(['INFORMACION DE LA EJECUCION'])
    expect(libres[1].relleno).toBe('FFE5E7EB')
    expect(celdas[2]).toEqual(['Generado el', generadoEl.toLocaleString('es-CL')])
    expect(celdas[3]).toEqual(['Analizador', 'Production Hierarchy Analyzer'])
    expect(celdas[4]).toEqual(['Archivo Excel', 'ProductionHierarchyAnalysis_2026-10-01.xlsx'])
    expect(celdas).toContainEqual(['Version', 'V1'])
    expect(celdas).toContainEqual(['API Base URL', '—'])
    expect(celdas).toContainEqual(['ENTIDADES ODATA UTILIZADAS (2)'])
    // Descargados → retenidos (con su nota) → analizados.
    expect(celdas).toContainEqual([
      'Production Source Header [PSH_E]',
      '5 registros descargados → 2 retenidos tras filtros automaticos (Excluye PINVALID=X)',
    ])
    expect(celdas).toContainEqual(['Product [PRD_E]', '7 registros descargados → 5 analizados'])
    expect(celdas).toContainEqual(['TIPOS DE MATERIAL — 6 detectados | 5 incluidos | 1 excluidos | 4 categorizados'])
    expect(celdas).toContainEqual(['FERT', '0 prods', 'Producto Terminado'])
    expect(celdas).toContainEqual(['ZZZ', '0 prods', 'Sin categoria — reglas permisivas (⚠)'])
    expect(celdas).toContainEqual(['VERP', '1 prods', ''])
    expect(celdas).toContainEqual(['Total productos en maestro', '7'])
    expect(celdas).toContainEqual(['Productos analizados (incluidos)', '5'])
    expect(celdas).toContainEqual(['SOURCEIDs activos (PSH)', '2'])
  })
})

describe('analizarProduccion — campos adicionales', () => {
  it('inserta cabecera, nota y valor justo después de la última columna fija', async () => {
    const informe = await analizarProduccion(datos({ extras: { product: ['COLOR'] } }))
    const h = hoja(informe, 'Product')
    expect(h.encabezados.slice(2, 7)).toEqual(['PRDID', 'PRDDESCR', 'MATTYPEID', 'COLOR', 'En Location Product'])
    expect(h.notas[5]).toBe('Campo adicional: COLOR')
    expect(h.grupos[5]).toBe('ibp')
    expect(sinNulos(h.filas[0].c).slice(2, 7)).toEqual(['FG1', 'Aceite 1L', 'FERT', 'ROJO', 'Si'])
    // Un registro sin el campo deja la celda vacía.
    expect(sinNulos(h.filas[1].c)[5]).toBe('')
  })

  it('la hoja Estadísticas cruza el campo adicional por tipo de material', async () => {
    const informe = await analizarProduccion(datos({ extras: { product: ['COLOR'] } }))
    const e = informe.estadisticas
    const i = e.findIndex((f) => f[0] === 'COLOR × Tipo de material')
    expect(i).toBeGreaterThan(0)
    expect(e[i + 1].slice(0, 2)).toEqual(['COLOR', 'FERT'])
  })
})

describe('analizarProduccion — avance', () => {
  it('informa los mismos pasos y porcentajes que v7', async () => {
    const pasos = []
    await analizarProduccion(datos({ alAvanzar: (texto, pct) => pasos.push([texto, pct]) }))
    expect(pasos[0]).toEqual(['Cargando datos desde IndexedDB...', 75])
    expect(pasos[1]).toEqual(['Construyendo índices...', 77])
    expect(pasos[2]).toEqual(['Inicializando Excel...', 79])
    expect(pasos.map((p) => p[0])).toContain('Hoja Product lista...')
    expect(pasos).toContainEqual(['Hoja Prod Source Item: 4/4...', 91])
    expect(pasos.at(-1)).toEqual(['Generando Resumen...', 98])
  })
})
