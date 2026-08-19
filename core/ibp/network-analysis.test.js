import { describe, it, expect } from 'vitest'

import {
  COLUMNAS,
  MAX_CICLOS,
  analizarRed,
  callejones,
  ciclos,
  claseDeProblema,
  conjuntosDeRed,
  estadoDeRed,
  estadoEsperado,
  filaDeRed,
  grafoVacio,
  llegaAUnCliente,
  nodosFantasma,
  plantasAisladas,
  plazosFaltantes,
  resumirRedes,
} from './network-analysis.js'

/**
 * Una red sana: la planta manda al centro de distribución y de ahí sale a un cliente.
 *
 *   P1 ──▶ CD ──▶ (CLI1)
 */
function redSana() {
  return {
    ...grafoVacio(),
    plantas: ['P1'],
    ubicaciones: ['P1', 'CD'],
    arcos: { P1: ['CD'] },
    arcosACliente: { CD: ['CLI1'] },
    plazoDeArco: { 'P1|CD': '1' },
    plazoDeCliente: { 'CD|CLI1': '2' },
    plazoDePlanta: { P1: '3' },
  }
}

const HECHOS = {
  prdid: 'P',
  descripcion: 'Un producto',
  mattype: 'FERT',
  enPSH: true,
  enPSI: false,
  enLS: true,
  enCS: true,
  enLocProduct: true,
  enCustProduct: true,
  llegaAPlanta: true,
  consumeLocal: false,
}

describe('conjuntosDeRed', () => {
  it('alimentados: a dónde llega el producto desde sus plantas', () => {
    const { alimentados } = conjuntosDeRed(redSana())
    expect([...alimentados].sort()).toEqual(['CD', 'P1'])
  })

  it('útiles: desde dónde se llega a un cliente', () => {
    const { utiles } = conjuntosDeRed(redSana())
    expect([...utiles].sort()).toEqual(['CD', 'P1'])
  })

  it('recorre varios saltos, no solo el primero', () => {
    const larga = {
      ...grafoVacio(),
      plantas: ['P1'],
      ubicaciones: ['P1', 'A', 'B', 'C'],
      arcos: { P1: ['A'], A: ['B'], B: ['C'] },
      arcosACliente: { C: ['CLI'] },
    }
    const { alimentados, utiles } = conjuntosDeRed(larga)
    expect(alimentados.has('C')).toBe(true)
    expect(utiles.has('P1')).toBe(true)
  })

  it('una bodega a la que no llega nada no está alimentada', () => {
    const suelta = { ...redSana(), ubicaciones: ['P1', 'CD', 'AJENA'] }
    expect(conjuntosDeRed(suelta).alimentados.has('AJENA')).toBe(false)
  })

  it('sin grafo no revienta', () => {
    expect(conjuntosDeRed()).toEqual({ alimentados: new Set(), utiles: new Set() })
  })
})

describe('nodosFantasma', () => {
  // El hallazgo que nadie ve a mano: la bodega existe, tiene entrada y salida, y no lleva a nadie.
  it('encuentra la bodega alimentada cuya salida no lleva a ningún cliente', () => {
    const conFantasma = {
      ...grafoVacio(),
      plantas: ['P1'],
      ubicaciones: ['P1', 'CD', 'PERDIDA', 'FINAL'],
      arcos: { P1: ['CD', 'PERDIDA'], PERDIDA: ['FINAL'] },
      arcosACliente: { CD: ['CLI1'] },
    }
    expect(nodosFantasma(conFantasma)).toEqual(['PERDIDA'])
  })

  it('una red sana no tiene fantasmas', () => {
    expect(nodosFantasma(redSana())).toEqual([])
  })

  it('una planta no se cuenta como fantasma: tiene su propio aviso', () => {
    const aislada = { ...grafoVacio(), plantas: ['P1'], ubicaciones: ['P1', 'X'], arcos: { P1: ['X'] } }
    expect(nodosFantasma(aislada)).not.toContain('P1')
  })

  it('una bodega sin salida no es fantasma: es un callejón', () => {
    const conCallejon = {
      ...grafoVacio(), plantas: ['P1'], ubicaciones: ['P1', 'FIN'], arcos: { P1: ['FIN'] },
    }
    expect(nodosFantasma(conCallejon)).toEqual([])
    expect(callejones(conCallejon)).toEqual(['FIN'])
  })
})

describe('callejones', () => {
  it('recibe producto y no lo manda a ninguna parte', () => {
    const grafo = {
      ...grafoVacio(), plantas: ['P1'], ubicaciones: ['P1', 'CD', 'FIN'],
      arcos: { P1: ['CD', 'FIN'] }, arcosACliente: { CD: ['CLI'] },
    }
    expect(callejones(grafo)).toEqual(['FIN'])
  })

  it('una bodega que no recibe nada no es un callejón', () => {
    const grafo = { ...grafoVacio(), plantas: ['P1'], ubicaciones: ['P1', 'SUELTA'] }
    expect(callejones(grafo)).toEqual([])
  })

  it('una red sana no tiene callejones', () => {
    expect(callejones(redSana())).toEqual([])
  })
})

describe('plantasAisladas', () => {
  it('una planta desde la que no se llega a ningún cliente', () => {
    const grafo = { ...grafoVacio(), plantas: ['P1', 'P2'], ubicaciones: ['P1', 'P2', 'CD'], arcos: { P1: ['CD'] }, arcosACliente: { CD: ['CLI'] } }
    expect(plantasAisladas(grafo)).toEqual(['P2'])
  })

  it('en una red sana no hay ninguna', () => {
    expect(plantasAisladas(redSana())).toEqual([])
  })
})

describe('ciclos', () => {
  it('encuentra el ciclo y lo escribe como camino', () => {
    const grafo = {
      ...grafoVacio(), plantas: ['A'], ubicaciones: ['A', 'B', 'C'],
      arcos: { A: ['B'], B: ['C'], C: ['A'] },
    }
    const salida = ciclos(grafo)
    expect(salida).toHaveLength(1)
    expect(salida[0]).toBe('A → B → C → A')
  })

  it('una red sin ciclos no devuelve ninguno', () => {
    expect(ciclos(redSana())).toEqual([])
  })

  // Con tres ya está dicho que la red tiene un problema estructural.
  it('corta a tres, para no listar cuarenta variantes del mismo lío', () => {
    const arcos = {}
    for (let i = 0; i < 10; i += 1) arcos[`N${i}`] = [`N${(i + 1) % 10}`, `N${i}`]
    const grafo = {
      ...grafoVacio(),
      plantas: ['N0'],
      ubicaciones: Array.from({ length: 10 }, (uno, i) => `N${i}`),
      arcos,
    }
    expect(ciclos(grafo).length).toBeLessThanOrEqual(MAX_CICLOS)
  })

  it('una ubicación que se manda a sí misma es un ciclo', () => {
    const grafo = { ...grafoVacio(), ubicaciones: ['A'], arcos: { A: ['A'] } }
    expect(ciclos(grafo)).toEqual(['A → A'])
  })
})

describe('plazosFaltantes', () => {
  it('un plazo en cero cuenta como faltante: SAP no espera nada', () => {
    const grafo = { ...redSana(), plazoDeArco: { 'P1|CD': '0' } }
    expect(plazosFaltantes(grafo)).toEqual([{ tipo: 'transporte', desde: 'P1', hasta: 'CD' }])
  })

  it('distingue transporte, entrega y producción', () => {
    const grafo = {
      ...redSana(),
      plazoDeArco: { 'P1|CD': '' },
      plazoDeCliente: { 'CD|CLI1': '0' },
      plazoDePlanta: { P1: '' },
    }
    expect(plazosFaltantes(grafo).map((uno) => uno.tipo).sort())
      .toEqual(['entrega', 'produccion', 'transporte'])
  })

  it('con todos los plazos puestos no falta ninguno', () => {
    expect(plazosFaltantes(redSana())).toEqual([])
  })
})

describe('estadoDeRed', () => {
  it('un terminado con ruta a cliente está completo', () => {
    expect(estadoDeRed({ ...HECHOS, llegaACliente: true }, ['finished'])).toBe('Red completa')
  })

  it('un terminado sin ruta a cliente lo dice según hasta dónde llega', () => {
    expect(estadoDeRed({ ...HECHOS, llegaACliente: false, enCS: true }, ['finished']))
      .toBe('Distribución sin ruta completa')
    expect(estadoDeRed({ ...HECHOS, llegaACliente: false, enCS: false, enLS: true }, ['finished']))
      .toBe('Sin entrega a cliente')
    expect(estadoDeRed({ ...HECHOS, llegaACliente: false, enCS: false, enLS: false }, ['finished']))
      .toBe('Sin distribución')
  })

  // Cada tipo de material tiene su propia pregunta: preguntarles lo mismo no diría nada de ninguno.
  it('un insumo se juzga por su abastecimiento, no por la ruta a cliente', () => {
    const insumo = { ...HECHOS, enPSH: false, enPSI: true }
    expect(estadoDeRed({ ...insumo, enLS: true, llegaAPlanta: true }, ['rawmat']))
      .toBe('Abastecimiento completo')
    expect(estadoDeRed({ ...insumo, enLS: true, llegaAPlanta: false }, ['rawmat']))
      .toBe('Abastecimiento parcial')
    expect(estadoDeRed({ ...insumo, enLS: false }, ['rawmat'])).toBe('Sin abastecimiento')
  })

  it('un semiterminado se juzga por su consumo o su transferencia', () => {
    const semi = { ...HECHOS, enPSH: true, enPSI: true }
    expect(estadoDeRed({ ...semi, enLS: false, consumeLocal: true }, ['semi']))
      .toBe('Semiterminado local')
    expect(estadoDeRed({ ...semi, enLS: false, consumeLocal: false }, ['semi']))
      .toBe('Semiterminado sin transferencia')
    expect(estadoDeRed({ ...semi, enLS: true, consumeLocal: true }, ['semi']))
      .toBe('Semiterminado local con transferencia')
    expect(estadoDeRed({ ...semi, enLS: true, consumeLocal: false }, ['semi']))
      .toBe('Semiterminado con transferencia')
  })

  it('un semiterminado sin receta o sin consumo lo dice antes de mirar la red', () => {
    expect(estadoDeRed({ ...HECHOS, enPSH: false }, ['semi'])).toBe('Sin producción')
    expect(estadoDeRed({ ...HECHOS, enPSH: true, enPSI: false }, ['semi']))
      .toBe('Sin consumo en ninguna receta')
  })

  it('la mercadería se juzga solo por sus arcos', () => {
    const merc = { ...HECHOS, enPSH: false, enPSI: false }
    expect(estadoDeRed({ ...merc, enLS: true, enCS: true }, ['trading'])).toBe('Solo distribución y entrega')
    expect(estadoDeRed({ ...merc, enLS: true, enCS: false }, ['trading'])).toBe('Solo distribución')
    expect(estadoDeRed({ ...merc, enLS: false, enCS: true }, ['trading'])).toBe('Solo entrega')
    expect(estadoDeRed({ ...merc, enLS: false, enCS: false }, ['trading'])).toBe('Sin arcos de red')
  })

  it('lo que solo está en el maestro es huérfano', () => {
    expect(estadoDeRed({ ...HECHOS, soloMaestro: true }, ['finished'])).toBe('Huérfano')
  })

  it('sin hechos no revienta', () => {
    expect(estadoDeRed(undefined, ['finished'])).toBe('Sin arcos de red')
  })
})

describe('estadoEsperado', () => {
  it('cada clase de material espera su propio estado', () => {
    expect(estadoEsperado(['finished'])).toEqual(['Red completa'])
    expect(estadoEsperado(['rawmat'])).toEqual(['Abastecimiento completo'])
    expect(estadoEsperado(['trading'])).toEqual(['Solo distribución y entrega'])
    expect(estadoEsperado(['semi'])).toHaveLength(3)
  })

  it('sin categoría se espera lo de un terminado', () => {
    expect(estadoEsperado([])).toEqual(['Red completa'])
  })
})

describe('llegaAUnCliente', () => {
  it('en una red sana, sí', () => {
    expect(llegaAUnCliente(redSana())).toBe(true)
  })

  it('si la planta no tiene salida útil, no', () => {
    const grafo = { ...grafoVacio(), plantas: ['P1'], ubicaciones: ['P1'] }
    expect(llegaAUnCliente(grafo)).toBe(false)
  })
})

describe('analizarRed', () => {
  it('una red sana de un terminado sale limpia', () => {
    const salida = analizarRed(HECHOS, redSana(), ['finished'])
    expect(salida).toMatchObject({ estado: 'Red completa', severidad: 'ok' })
    expect(salida.problemas).toEqual([])
  })

  it('el estado problemático se dice como observación', () => {
    const grafo = { ...grafoVacio(), plantas: ['P1'], ubicaciones: ['P1'] }
    // Con arcos a cliente pero sin ruta completa: el estado lo dice, y es lo que se escribe.
    expect(analizarRed(HECHOS, grafo, ['finished']).problemas[0].texto)
      .toBe('Distribución sin ruta completa')
    expect(analizarRed({ ...HECHOS, enCS: false }, grafo, ['finished']).problemas[0].texto)
      .toBe('Sin entrega a cliente')
    expect(analizarRed(HECHOS, grafo, ['finished']).severidad).toBe('red')
  })

  it('los fantasmas y los callejones se explican con el nombre de la bodega', () => {
    const grafo = {
      ...redSana(),
      ubicaciones: ['P1', 'CD', 'PERDIDA', 'FINAL', 'CIEGA'],
      arcos: { P1: ['CD', 'PERDIDA', 'CIEGA'], PERDIDA: ['FINAL'] },
    }
    const textos = analizarRed(HECHOS, grafo, ['finished']).problemas.map((uno) => uno.texto)
    expect(textos.some((uno) => uno.includes('PERDIDA'))).toBe(true)
    expect(textos.some((uno) => uno.includes('CIEGA') && uno.includes('no lo manda'))).toBe(true)
  })

  // A una materia prima no se le pide que su bodega tenga salida hacia el cliente.
  it('a un insumo no se le exigen los hallazgos de ruta a cliente', () => {
    const grafo = {
      ...grafoVacio(),
      plantas: [],
      ubicaciones: ['PROV', 'PLANTA'],
      arcos: { PROV: ['PLANTA'] },
      plazoDeArco: { 'PROV|PLANTA': '5' },
    }
    const insumo = { ...HECHOS, mattype: 'ROH', enPSH: false, enPSI: true, enLS: true, llegaAPlanta: true, enCS: false, enCustProduct: true }
    const salida = analizarRed(insumo, grafo, ['rawmat'])

    expect(salida.estado).toBe('Abastecimiento completo')
    expect(salida.problemas.map((uno) => uno.texto).join(' ')).not.toContain('no lo manda')
  })

  it('los plazos que faltan son avisos, no errores', () => {
    const grafo = { ...redSana(), plazoDeArco: { 'P1|CD': '0' } }
    const salida = analizarRed(HECHOS, grafo, ['finished'])
    expect(salida.severidad).toBe('yel')
    expect(salida.problemas[0].texto).toContain('Sin plazo de transporte')
  })

  it('el plazo de producción no se le pide a un insumo ni a mercadería', () => {
    const grafo = { ...redSana(), plazoDePlanta: { P1: '0' } }
    const merc = { ...HECHOS, enPSH: false, enPSI: false }
    const salida = analizarRed(merc, grafo, ['trading'])
    expect(salida.problemas.map((uno) => uno.texto).join(' ')).not.toContain('plazo de producción')
  })

  it('la falta de cobertura se dice, en las dos tablas', () => {
    const salida = analizarRed({ ...HECHOS, enLocProduct: false, enCustProduct: false }, redSana(), ['finished'])
    const textos = salida.problemas.map((uno) => uno.texto)
    expect(textos).toContain('Sin cobertura en Location Product')
    expect(textos).toContain('Sin cobertura en Customer Product')
  })

  // Un tipo sin clasificar avisa en amarillo: nadie ha dicho todavía qué es.
  it('sin categoría, lo que sería error sale como aviso', () => {
    const grafo = { ...grafoVacio(), plantas: ['P1'], ubicaciones: ['P1'] }
    expect(analizarRed(HECHOS, grafo, []).severidad).toBe('yel')
  })

  it('las métricas cuentan lo que se encontró', () => {
    const salida = analizarRed(HECHOS, redSana(), ['finished'])
    expect(salida.metricas).toMatchObject({ plantas: 1, ubicaciones: 2, clientes: 1, fantasmas: 0 })
  })

  it('sin grafo no revienta', () => {
    expect(analizarRed(HECHOS, undefined, ['finished']).severidad).toBe('red')
  })
})

describe('filaDeRed', () => {
  const salida = analizarRed(HECHOS, redSana(), ['finished'])
  const fila = filaDeRed(HECHOS, salida)

  it('tiene tantas celdas como columnas', () => {
    expect(fila.c).toHaveLength(COLUMNAS.length)
  })

  it('lleva el estado de la red aparte de la severidad', () => {
    expect(fila.s).toBe('ok')
    expect(fila.c[1]).toBe('Red completa')
  })

  it('las métricas salen como números legibles', () => {
    expect(fila.c[6]).toBe('1')
    expect(fila.c[8]).toBe('1')
  })
})

describe('claseDeProblema y resumirRedes', () => {
  // Dos ciclos distintos son el mismo problema: contarlos por separado esconde el patrón.
  it('agrupa por clase, no por texto', () => {
    expect(claseDeProblema('Ciclo en la red: A → B → A')).toBe('Ciclo en la red')
    expect(claseDeProblema('Le llega producto a CD y desde ahí no se llega a ningún cliente'))
      .toBe('Producto que entra en una bodega sin salida útil')
    expect(claseDeProblema('CIEGA recibe producto y no lo manda a ninguna parte'))
      .toBe('Bodega que recibe y no reenvía')
    expect(claseDeProblema('La planta P2 fabrica y no tiene salida hacia ningún cliente'))
      .toBe('Planta sin salida hacia ningún cliente')
  })

  it('el resumen cuenta severidades, estados y problemas', () => {
    const resumen = resumirRedes([
      { estado: 'Red completa', severidad: 'ok', problemas: [] },
      { estado: 'Sin distribución', severidad: 'red', problemas: [{ texto: 'Sin distribución' }] },
      { estado: 'Sin distribución', severidad: 'red', problemas: [{ texto: 'Ciclo en la red: A → A' }] },
    ])

    expect(resumen.porSeveridad).toEqual({ red: 2, yel: 0, ok: 1 })
    expect(resumen.porEstado[0]).toEqual(['Sin distribución', 2])
    expect(resumen.total).toBe(3)
  })

  it('sin resultados no revienta', () => {
    expect(resumirRedes()).toMatchObject({ total: 0, masFrecuentes: [] })
  })
})
