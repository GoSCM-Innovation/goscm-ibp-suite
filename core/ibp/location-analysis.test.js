import { describe, expect, it } from 'vitest'

import {
  COLUMNAS,
  EXIGENCIAS,
  ROLES,
  analizarUbicacion,
  claseDeProblema,
  filaDeUbicacion,
  resumirUbicaciones,
  rolesDe,
} from './location-analysis.js'

/** Los hechos mínimos que le dan a una ubicación ese rol, y solo ese. */
const HECHOS_DEL_ROL = {
  [ROLES.planta]: { recetas: ['R1'] },
  [ROLES.proveedor]: { mandaLoQueSeConsume: true },
  [ROLES.transferencia]: { mandaLoQueNoSeConsume: true },
  [ROLES.receptor]: { recibe: ['X'] },
  [ROLES.recursos]: { recursos: ['MAQ1'] },
  [ROLES.sinActividad]: {},
}

describe('el rol de una ubicación se deduce de cómo se comporta', () => {
  it('tener recetas la hace planta de producción', () => {
    expect(rolesDe({ recetas: ['R1'] })).toEqual([ROLES.planta])
  })

  it('mandar algo que el destino consume la hace proveedor', () => {
    expect(rolesDe({ mandaLoQueSeConsume: true })).toEqual([ROLES.proveedor])
  })

  it('mandar algo que el destino NO consume la hace nodo de transferencia', () => {
    expect(rolesDe({ mandaLoQueNoSeConsume: true })).toEqual([ROLES.transferencia])
  })

  // Es la distinción que da valor a la hoja: las dos mandan material, pero solo una lo manda a donde
  // de verdad se usa. La otra casi siempre esconde un arco de más o un componente que falta.
  it('puede ser las dos cosas: manda algo que se usa y algo que no', () => {
    expect(rolesDe({ mandaLoQueSeConsume: true, mandaLoQueNoSeConsume: true }))
      .toEqual([ROLES.proveedor, ROLES.transferencia])
  })

  it('recibir sin mandar ni producir la hace nodo receptor', () => {
    expect(rolesDe({ recibe: ['A'] })).toEqual([ROLES.receptor])
  })

  it('si además manda, NO es receptor: mandar ya la describe', () => {
    expect(rolesDe({ recibe: ['A'], mandaLoQueNoSeConsume: true })).toEqual([ROLES.transferencia])
  })

  it('una planta que recibe sus componentes tampoco es «receptor»', () => {
    expect(rolesDe({ recibe: ['A'], recetas: ['R1'] })).toEqual([ROLES.planta])
  })

  it('acumula varios roles: una planta que también transfiere', () => {
    expect(rolesDe({ recetas: ['R1'], mandaLoQueNoSeConsume: true, recursos: ['MAQ1'] }))
      .toEqual([ROLES.planta, ROLES.transferencia, ROLES.recursos])
  })

  it('no aparecer en ninguna parte es «sin actividad»', () => {
    expect(rolesDe({ locid: 'X' })).toEqual([ROLES.sinActividad])
    expect(rolesDe({})).toEqual([ROLES.sinActividad])
    expect(rolesDe(null)).toEqual([ROLES.sinActividad])
  })
})

describe('a cada rol se le pide lo suyo', () => {
  it('una planta bien montada sale limpia', () => {
    const salida = analizarUbicacion({ locid: 'P1', recetas: ['R1'], productos: ['A'] })
    expect(salida.severidad).toBe('ok')
    expect(salida.problemas).toEqual([])
  })

  it('a una planta se le exigen sus recetas completas', () => {
    const salida = analizarUbicacion({
      locid: 'P1',
      recetas: ['R1', 'R2'],
      recetasSinComponentes: ['R1'],
      recetasSinRecurso: ['R2'],
      componentesSinArco: ['COMP1', 'COMP2'],
      recetasConPlazoCero: ['R1'],
    })
    expect(salida.severidad).toBe('red')
    expect(salida.problemas).toHaveLength(4)
    expect(salida.problemas.map((uno) => uno.texto).join(' ')).toContain('COMP1, COMP2')
  })

  it('un recurso que nadie usa es aviso, no error: es capacidad sin planificar', () => {
    const salida = analizarUbicacion({ locid: 'P1', recetas: ['R1'], recursosOciosos: ['MAQ9'] })
    expect(salida.severidad).toBe('yel')
  })

  it('fabricar lo que está clasificado como comprado es aviso', () => {
    const salida = analizarUbicacion({ locid: 'P1', recetas: ['R1'], fabricaLoQueSeCompra: ['MP1'] })
    expect(salida.severidad).toBe('yel')
    expect(salida.problemas[0].texto).toContain('clasificados como comprados')
  })

  // Lo que a una planta no se le pide, no se le cuenta: si no tuviera este filtro, cada proveedor
  // saldría con veinte errores por no tener recetas.
  it('a un proveedor NO se le piden las cosas de planta', () => {
    const salida = analizarUbicacion({
      locid: 'PROV1',
      mandaLoQueSeConsume: true,
      // Estos campos vienen puestos y deben ignorarse: no es planta.
      recetasSinComponentes: ['R1'],
      recursosOciosos: ['MAQ1'],
    })
    expect(salida.roles).toEqual([ROLES.proveedor])
    expect(salida.severidad).toBe('ok')
  })

  it('a un proveedor se le exige que lo que manda esté cubierto en el destino', () => {
    const salida = analizarUbicacion({
      locid: 'PROV1',
      mandaLoQueSeConsume: true,
      mandaSinCobertura: ['MP1'],
    })
    expect(salida.severidad).toBe('red')
    expect(salida.problemas[0].texto).toContain('sin cobertura en el destino')
  })

  it('transferir a una planta que no lo usa es error; a un nodo sin producción, aviso', () => {
    const aPlanta = analizarUbicacion({
      locid: 'CD1',
      mandaLoQueNoSeConsume: true,
      transfiereAPlantaSinConsumo: ['SEMI1'],
    })
    expect(aPlanta.severidad).toBe('red')

    const aNodo = analizarUbicacion({
      locid: 'CD1',
      mandaLoQueNoSeConsume: true,
      transfiereANodoSinProduccion: ['SEMI1'],
    })
    expect(aNodo.severidad).toBe('yel')
  })

  it('a un receptor se le exige cobertura de lo que recibe', () => {
    const salida = analizarUbicacion({
      locid: 'CD2',
      recibe: ['P1'],
      recibeSinCobertura: ['A'],
      recibeComponentesSinProducir: ['COMP1'],
    })
    expect(salida.roles).toEqual([ROLES.receptor])
    expect(salida.severidad).toBe('red')
    expect(salida.problemas).toHaveLength(2)
  })

  it('una ubicación con varios roles acumula los problemas de cada uno', () => {
    const salida = analizarUbicacion({
      locid: 'P1',
      recetas: ['R1'],
      mandaLoQueNoSeConsume: true,
      recursosOciosos: ['MAQ1'],
      transfiereAPlantaSinConsumo: ['SEMI1'],
    })
    expect(salida.roles).toEqual([ROLES.planta, ROLES.transferencia])
    expect(salida.severidad).toBe('red')
    expect(salida.problemas).toHaveLength(2)
  })

  it('estar solo en el maestro es una nota, no un error', () => {
    const salida = analizarUbicacion({ locid: 'VIEJA' })
    expect(salida.severidad).toBe('info')
    expect(salida.problemas[0].texto).toContain('maestro de ubicaciones')
  })

  it('la lista de códigos se corta y dice cuántos quedaron fuera', () => {
    const muchos = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    const salida = analizarUbicacion({ locid: 'P1', recetas: ['R1'], componentesSinArco: muchos })
    expect(salida.problemas[0].texto).toContain('+2')
    expect(salida.problemas[0].texto).not.toContain('H')
  })

  // Medido en un tenant real: sin esto, 155 ubicaciones decían exactamente «400 materiales» —que era
  // el tope de la lista— y ninguna tenía 400. Un tope escrito como si fuera un total es peor que no
  // dar el número: el consultor se lo lleva a la reunión.
  it('si la lista viene topada, el número se escribe como «más de»', () => {
    const salida = analizarUbicacion({
      locid: 'CD1',
      recibe: ['P1'],
      recibeSinCobertura: ['A', 'B', 'C'],
      topados: ['recibeSinCobertura'],
    })
    expect(salida.problemas[0].texto).toMatch(/^más de 3 materiales que recibe sin cobertura/)
  })

  it('sin la marca, el número se escribe tal cual', () => {
    const salida = analizarUbicacion({
      locid: 'CD1',
      recibe: ['P1'],
      recibeSinCobertura: ['A', 'B', 'C'],
    })
    expect(salida.problemas[0].texto).toMatch(/^3 materiales que recibe sin cobertura/)
  })

  it('la marca solo afecta al campo marcado', () => {
    const salida = analizarUbicacion({
      locid: 'CD1',
      recibe: ['P1'],
      recibeSinCobertura: ['A'],
      recibeComponentesSinProducir: ['B'],
      topados: ['recibeSinCobertura'],
    })
    expect(salida.problemas[0].texto).toMatch(/^más de 1/)
    expect(salida.problemas[1].texto).toMatch(/^1 componentes/)
  })
})

// La matriz es lo que el glosario lee para explicar el informe. Si una entrada dejara de disparar nada
// —porque le cambió el nombre al campo— el glosario seguiría prometiendo una comprobación que ya no
// existe, que es exactamente el problema que v7 tenía con su glosario escrito a mano.
describe('la matriz de exigencias es la que se aplica', () => {
  const entradas = Object.entries(EXIGENCIAS)
    .flatMap(([rol, suyas]) => suyas.map((una) => [rol, una]))

  it.each(entradas)('%s: «%o» dispara su severidad y nada más', (rol, exigencia) => {
    const hechos = { locid: 'X', ...HECHOS_DEL_ROL[rol] }
    if (exigencia.campo) hechos[exigencia.campo] = ['CODIGO1']

    const salida = analizarUbicacion(hechos)

    expect(salida.roles).toContain(rol)
    expect(salida.problemas).toHaveLength(1)
    expect(salida.problemas[0].severidad).toBe(exigencia.severidad)
    expect(salida.problemas[0].texto).toContain(exigencia.texto)
    expect(salida.severidad).toBe(exigencia.severidad)
  })

  it('un rol sin nada que reprochar sale limpio', () => {
    for (const rol of Object.keys(EXIGENCIAS)) {
      if (rol === ROLES.sinActividad) continue
      const salida = analizarUbicacion({ locid: 'X', ...HECHOS_DEL_ROL[rol] })
      expect(salida.problemas, rol).toEqual([])
    }
  })

  it('todo rol declarado en ROLES existe, y solo «Nodo de recursos» no exige nada propio', () => {
    const conExigencias = new Set(Object.keys(EXIGENCIAS))
    const sinExigencias = Object.values(ROLES).filter((rol) => !conExigencias.has(rol))
    expect(sinExigencias).toEqual([ROLES.recursos])
  })
})

describe('la fila del informe', () => {
  it('lleva el estado, los roles y los códigos', () => {
    const hechos = {
      locid: 'P1',
      descripcion: 'Planta de Quito',
      loctype: '1010',
      recetas: ['R1', 'R2'],
      productos: ['A', 'B'],
      recursos: ['MAQ1'],
      manda: ['CD1'],
      recibe: ['PROV1'],
      recetasSinRecurso: ['R2'],
    }
    const salida = analizarUbicacion(hechos)
    const fila = filaDeUbicacion(hechos, salida)

    expect(fila.s).toBe('red')
    expect(fila.c).toHaveLength(COLUMNAS.length)
    expect(fila.c[0]).toBe('red')
    // Los dos roles, porque tiene recetas y además un recurso asignado.
    expect(fila.c[1]).toBe(`${ROLES.planta}, ${ROLES.recursos}`)
    expect(fila.c[3]).toBe('P1')
    expect(fila.c[4]).toBe('Planta de Quito')
    expect(fila.c[6]).toBe('2')
    expect(fila.c[9]).toBe('CD1')
  })

  it('aguanta que falten datos sin romperse', () => {
    const fila = filaDeUbicacion({}, analizarUbicacion({}))
    expect(fila.c).toHaveLength(COLUMNAS.length)
    expect(fila.c.every((celda) => typeof celda === 'string')).toBe(true)
  })
})

describe('el resumen', () => {
  it('cuenta severidades, roles y los problemas más frecuentes', () => {
    const hechos = [
      { locid: 'P1', recetas: ['R1'], recetasSinRecurso: ['R1'] },
      { locid: 'P2', recetas: ['R2'], recetasSinRecurso: ['R2'] },
      { locid: 'P3', recetas: ['R3'], recursosOciosos: ['MAQ1'] },
      { locid: 'PROV1', mandaLoQueSeConsume: true },
      { locid: 'VIEJA' },
    ]
    const resumen = resumirUbicaciones(hechos.map(analizarUbicacion))

    expect(resumen.total).toBe(5)
    expect(resumen.porSeveridad).toEqual({ red: 2, yel: 1, info: 1, ok: 1 })
    expect(resumen.porEstado[0]).toEqual([ROLES.planta, 3])
    expect(resumen.masFrecuentes[0]).toEqual({ texto: 'recetas sin recurso asignado', cuantos: 2 })
  })

  it('aguanta una lista vacía', () => {
    expect(resumirUbicaciones([]).total).toBe(0)
    expect(resumirUbicaciones(null).total).toBe(0)
  })

  // El número y los códigos cambian en cada ubicación; si el patrón no se agrupa, el resumen es una
  // lista de mil problemas distintos que no dice nada.
  it('la clase de un problema quita el número y los códigos', () => {
    expect(claseDeProblema('12 recetas sin componentes: R1, R2')).toBe('recetas sin componentes')
    expect(claseDeProblema('1 recetas sin componentes: R9')).toBe('recetas sin componentes')
    // Una lista topada tiene que caer en la MISMA clase que una que no lo está, o el resumen parte el
    // mismo problema en dos y ninguna de las dos mitades parece importante.
    expect(claseDeProblema('más de 400 recetas sin componentes: R1')).toBe('recetas sin componentes')
    expect(claseDeProblema('Está en el maestro de ubicaciones y no aparece en ninguna otra parte'))
      .toBe('Está en el maestro de ubicaciones y no aparece en ninguna otra parte')
  })
})
