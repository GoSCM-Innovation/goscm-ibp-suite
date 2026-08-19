import { describe, it, expect } from 'vitest'

import {
  COLUMNAS,
  analizarProducto,
  esCeroOVacio,
  filaDelInforme,
  laPeor,
  resumirAnalisis,
} from './production-analysis.js'

/** Un producto terminado bien armado: nada que decirle. */
const BUENO = {
  prdid: 'P1',
  descripcion: 'Producto terminado',
  mattype: 'FERT',
  enLocProduct: true,
  plantas: ['PLANTA1'],
  recetas: ['S1'],
  componentes: 3,
  recursos: ['LINEA_A'],
  plazoDeProduccion: '2.000000',
  coeficienteDeSalida: '1.000000',
  plantasQueLoConsumen: [],
  plantasConArcoDeEntrada: [],
  esOrigenEnRed: true,
  tieneArcosEnRed: true,
  plazoDeTransporte: '1.000000',
  loConsumeAlguien: true,
  seTransfiere: true,
}

const CONFIG = {
  FERT: { excluido: false, categorias: ['finished'] },
  HALB: { excluido: false, categorias: ['semi'] },
  ROH: { excluido: false, categorias: ['rawmat'] },
  MERC: { excluido: false, categorias: ['trading'] },
  SINCLASIFICAR: { excluido: false, categorias: [] },
}

const problemasDe = (hechos, config = CONFIG) =>
  analizarProducto(hechos, config).problemas.map((uno) => uno.comprobacion)

describe('esCeroOVacio', () => {
  it('los ceros de SAP llegan con seis decimales', () => {
    expect(esCeroOVacio('0.000000')).toBe(true)
    expect(esCeroOVacio('2.000000')).toBe(false)
  })

  it('lo vacío cuenta como cero', () => {
    expect(esCeroOVacio('')).toBe(true)
    expect(esCeroOVacio(undefined)).toBe(true)
  })

  it('lo que no es número no se da por cero', () => {
    expect(esCeroOVacio('X')).toBe(false)
  })

  it('acepta la coma decimal', () => {
    expect(esCeroOVacio('0,000')).toBe(true)
  })
})

describe('laPeor', () => {
  it('el rojo manda', () => {
    expect(laPeor(['yel', 'red', 'info'])).toBe('red')
  })

  it('sin problemas está bien', () => {
    expect(laPeor([])).toBe('ok')
    expect(laPeor()).toBe('ok')
  })
})

describe('analizarProducto', () => {
  it('un terminado bien armado sale limpio', () => {
    expect(analizarProducto(BUENO, CONFIG)).toEqual({ severidad: 'ok', problemas: [] })
  })

  it('sin cobertura en Location Product es rojo para cualquiera', () => {
    for (const mattype of ['FERT', 'HALB', 'ROH', 'MERC']) {
      const salida = analizarProducto({ ...BUENO, mattype, enLocProduct: false }, CONFIG)
      expect(salida.problemas.map((uno) => uno.comprobacion), mattype).toContain('requiresLocPrd')
      expect(salida.severidad, mattype).toBe('red')
    }
  })

  // El caso que da sentido a la matriz: la misma falta, distinta consecuencia.
  it('sin receta: rojo en un terminado, nada en una materia prima', () => {
    const sinReceta = { ...BUENO, recetas: [], componentes: 0, recursos: [] }

    expect(problemasDe({ ...sinReceta, mattype: 'FERT' })).toContain('requiresPSH')
    expect(problemasDe({ ...sinReceta, mattype: 'ROH' })).not.toContain('requiresPSH')
    expect(analizarProducto({ ...sinReceta, mattype: 'ROH' }, CONFIG).severidad).toBe('ok')
  })

  // Un solo problema, no dos: preguntar por los componentes de una receta que no existe es ruido.
  it('sin receta NO se queja además de los componentes ni del recurso', () => {
    const problemas = problemasDe({ ...BUENO, recetas: [], componentes: 0, recursos: [] })
    expect(problemas).toEqual(['requiresPSH'])
  })

  it('con receta y sin componentes ni recurso, los dos se dicen', () => {
    const problemas = problemasDe({ ...BUENO, componentes: 0, recursos: [] })
    expect(problemas).toContain('requiresPSI')
    expect(problemas).toContain('requiresPSR')
  })

  it('el plazo en cero es rojo en un terminado y aviso en un semiterminado', () => {
    const enCero = { ...BUENO, plazoDeProduccion: '0.000000' }
    expect(analizarProducto({ ...enCero, mattype: 'FERT' }, CONFIG).severidad).toBe('red')
    expect(analizarProducto({ ...enCero, mattype: 'HALB' }, CONFIG).severidad).toBe('yel')
  })

  it('una materia prima con receta es un aviso: algo está mal clasificado', () => {
    const problemas = problemasDe({ ...BUENO, mattype: 'ROH' })
    expect(problemas).toContain('hasPSHUnexpected')
  })

  it('el arco de abastecimiento dice a qué plantas NO llega', () => {
    const salida = analizarProducto({
      ...BUENO,
      mattype: 'ROH',
      recetas: [],
      componentes: 0,
      recursos: [],
      plantasQueLoConsumen: ['PLANTA1', 'PLANTA2', 'PLANTA3'],
      plantasConArcoDeEntrada: ['PLANTA1'],
    }, CONFIG)

    const suyo = salida.problemas.find((uno) => uno.comprobacion === 'requiresVendorArc')
    expect(suyo.severidad).toBe('red')
    expect(suyo.texto).toContain('PLANTA2, PLANTA3')
  })

  it('si a todas las plantas que lo consumen les llega un arco, no hay problema', () => {
    const problemas = problemasDe({
      ...BUENO,
      mattype: 'ROH',
      recetas: [],
      plantasQueLoConsumen: ['PLANTA1'],
      plantasConArcoDeEntrada: ['PLANTA1'],
    })
    expect(problemas).not.toContain('requiresVendorArc')
  })

  it('la mercadería sin arcos en la red es roja', () => {
    const problemas = problemasDe({
      ...BUENO, mattype: 'MERC', recetas: [], componentes: 0, recursos: [], tieneArcosEnRed: false,
    })
    expect(problemas).toContain('requiresAnyOriginDest')
  })

  // El que más cuesta ver a mano: cada pieza por separado está bien.
  it('un semiterminado que se produce y no va a ninguna parte se marca', () => {
    const salida = analizarProducto({
      ...BUENO, mattype: 'HALB', loConsumeAlguien: false, seTransfiere: false,
    }, CONFIG)

    expect(salida.problemas.map((uno) => uno.comprobacion)).toContain('semiSinSalida')
    expect(salida.severidad).toBe('red')
  })

  it('un semiterminado que se transfiere a otra planta está bien', () => {
    const problemas = problemasDe({
      ...BUENO, mattype: 'HALB', loConsumeAlguien: false, seTransfiere: true,
    })
    expect(problemas).not.toContain('semiSinSalida')
  })

  it('a un terminado no se le exige que alguien lo consuma: se vende', () => {
    const problemas = problemasDe({ ...BUENO, loConsumeAlguien: false, seTransfiere: false })
    expect(problemas).not.toContain('notConsumedInBOM')
    expect(problemas).not.toContain('semiSinSalida')
  })

  it('el plazo de transporte solo se mira si está en la red', () => {
    expect(problemasDe({ ...BUENO, plazoDeTransporte: '0' })).toContain('tleadtimeZero')
    expect(problemasDe({ ...BUENO, plazoDeTransporte: '0', tieneArcosEnRed: false }))
      .not.toContain('tleadtimeZero')
  })

  it('solo coproducto es un aviso', () => {
    const salida = analizarProducto({ ...BUENO, soloCoproducto: true }, CONFIG)
    expect(salida.problemas.map((uno) => uno.comprobacion)).toContain('isCoproductOnly')
    expect(salida.severidad).toBe('yel')
  })

  // Un tipo sin clasificar no se calla, pero no se marca en rojo.
  it('un tipo sin clasificar sale en amarillo, no en rojo', () => {
    const salida = analizarProducto({
      ...BUENO, mattype: 'SINCLASIFICAR', recetas: [], componentes: 0, recursos: [],
    }, CONFIG)
    expect(salida.severidad).toBe('yel')
  })

  it('un tipo que no está en la configuración se trata como sin clasificar', () => {
    const salida = analizarProducto({ ...BUENO, mattype: 'DESCONOCIDO', recetas: [] }, CONFIG)
    expect(salida.severidad).toBe('yel')
  })

  it('sin hechos no revienta', () => {
    expect(analizarProducto(undefined, CONFIG).severidad).toBe('red')
  })
})

describe('filaDelInforme', () => {
  // Una materia prima a la que no le llega arco a una de sus plantas: al terminado no se le pide.
  const hechos = {
    ...BUENO,
    mattype: 'ROH',
    recetas: [],
    componentes: 0,
    recursos: [],
    plantasQueLoConsumen: ['A', 'B'],
    plantasConArcoDeEntrada: ['A'],
  }
  const fila = filaDelInforme(hechos, analizarProducto(hechos, CONFIG))

  it('tiene tantas celdas como columnas', () => {
    expect(fila.c).toHaveLength(COLUMNAS.length)
  })

  it('lleva la severidad aparte, para poder filtrar sin leer las celdas', () => {
    expect(fila.s).toBe(fila.c[0])
  })

  it('las observaciones van juntas en una celda', () => {
    expect(fila.c[1]).toContain('arco de abastecimiento')
  })

  it('el código y el tipo salen donde toca', () => {
    expect(fila.c[2]).toBe('P1')
    expect(fila.c[4]).toBe('ROH')
  })

  it('la columna del abastecimiento dice a qué plantas no llega', () => {
    expect(fila.c[13]).toBe('B')
  })

  it('lo booleano se escribe como se lee', () => {
    expect(fila.c[5]).toBe('Sí')
  })

  it('una lista larga se corta y dice cuántas faltan', () => {
    const muchas = filaDelInforme(
      { ...BUENO, plantas: ['1', '2', '3', '4', '5', '6', '7', '8'] },
      { severidad: 'ok', problemas: [] },
    )
    expect(muchas.c[6]).toBe('1, 2, 3, 4, 5, 6 +2')
  })

  it('sin hechos devuelve una fila con celdas vacías, no undefined', () => {
    const vacia = filaDelInforme(undefined, { severidad: 'ok', problemas: [] })
    expect(vacia.c).toHaveLength(COLUMNAS.length)
    expect(vacia.c[2]).toBe('')
  })
})

describe('resumirAnalisis', () => {
  const resultados = [
    { mattype: 'FERT', severidad: 'red', problemas: [{ comprobacion: 'requiresPSH' }] },
    { mattype: 'FERT', severidad: 'red', problemas: [{ comprobacion: 'requiresPSH' }, { comprobacion: 'requiresPSR' }] },
    { mattype: 'ROH', severidad: 'yel', problemas: [{ comprobacion: 'tleadtimeZero' }] },
    { mattype: 'ROH', severidad: 'ok', problemas: [] },
  ]
  const resumen = resumirAnalisis(resultados)

  it('cuenta por severidad', () => {
    expect(resumen.porSeveridad).toEqual({ red: 2, yel: 1, info: 0, ok: 1 })
  })

  it('cuenta por tipo de material, que es como se reparte el trabajo', () => {
    expect(resumen.porTipo.FERT).toEqual({ red: 2, yel: 0, info: 0, ok: 0 })
  })

  // Lo que convierte mil errores en una tarea concreta.
  it('dice qué comprobación falla más, con su texto', () => {
    expect(resumen.masFrecuentes[0]).toMatchObject({ comprobacion: 'requiresPSH', cuantos: 2 })
    expect(resumen.masFrecuentes[0].texto).toContain('receta')
  })

  it('un producto con el mismo problema dos veces no lo cuenta dos veces', () => {
    const doble = resumirAnalisis([
      { mattype: 'X', severidad: 'red', problemas: [{ comprobacion: 'requiresPSH' }, { comprobacion: 'requiresPSH' }] },
    ])
    expect(doble.masFrecuentes[0].cuantos).toBe(1)
  })

  it('sin resultados no revienta', () => {
    expect(resumirAnalisis()).toMatchObject({ total: 0, masFrecuentes: [] })
  })
})
