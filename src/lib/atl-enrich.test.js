import { describe, it, expect } from 'vitest'

import { conConflicto, conflictosDe, detectarConflictos, enrichWithAtl } from './atl-enrich.js'

const integracion = (idx, dataflowName, dataflowGuid = '') => ({ _idx: idx, dataflowName, dataflowGuid })

/** Un ATL con los grupos que se le pasen: `[nombre, paralelo, [guids]]`. */
const atl = (sessionName, grupos) => ({
  sessionName,
  description: '',
  variables: [],
  groups: grupos.map(([displayName, parallel, guids]) => ({
    name: displayName,
    displayName,
    parallel,
    dataflows: guids.map((guid) => ({ guid, displayName: guid })),
  })),
})

describe('enrichWithAtl', () => {
  const integraciones = [integracion(0, 'DF_A', 'g0'), integracion(1, 'DF_B', 'g1'), integracion(2, 'DF_C', 'g2')]

  it('le pone a cada integración su proceso, grupo y orden', () => {
    const { orquestacion } = enrichWithAtl(integraciones, [], [
      { nombre: 'p.atl', atl: atl('PROCESO', [['FLOWof_Carga', false, ['g0', 'g1']]]) },
    ])

    expect(orquestacion.get(0)).toEqual({ session: 'PROCESO', grupo: 'Carga', parallel: false, orden: 1, procesoIdx: 0 })
    expect(orquestacion.get(1).orden).toBe(2)
    expect(orquestacion.has(2)).toBe(false)
  })

  it('el orden es continuo entre grupos, no se reinicia', () => {
    const { orquestacion } = enrichWithAtl(integraciones, [], [
      { nombre: 'p.atl', atl: atl('P', [['Uno', false, ['g0']], ['Dos', false, ['g1']]]) },
    ])
    expect([orquestacion.get(0).orden, orquestacion.get(1).orden]).toEqual([1, 2])
  })

  it('cuenta lo declarado, lo emparejado y lo que falta', () => {
    const { procesos } = enrichWithAtl(integraciones, [], [
      { nombre: 'p.atl', atl: atl('P', [['G', false, ['g0', 'g-inexistente']]]) },
    ])

    expect(procesos[0]).toMatchObject({ declarados: 2, emparejados: 1 })
    expect(procesos[0].faltantes).toEqual([{ grupo: 'G', displayName: 'g-inexistente', guid: 'g-inexistente' }])
    expect(procesos[0].grupos[0].dataflows.map((uno) => uno.falta)).toEqual([false, true])
  })

  it('sin GUID empareja por el nombre visible', () => {
    const sinGuid = { sessionName: 'P', groups: [{ displayName: 'G', parallel: false, dataflows: [{ guid: '', displayName: 'df_a' }] }] }
    const { orquestacion } = enrichWithAtl(integraciones, [], [{ nombre: 'p.atl', atl: sinGuid }])
    expect(orquestacion.get(0).grupo).toBe('G')
  })

  // Un dataflow no puede correr en dos sitios a la vez; quedarse con el primero es consistente.
  it('un dataflow que aparece en dos procesos se queda con el primero', () => {
    const { orquestacion } = enrichWithAtl(integraciones, [], [
      { nombre: 'uno.atl', atl: atl('PRIMERO', [['G', false, ['g0']]]) },
      { nombre: 'dos.atl', atl: atl('SEGUNDO', [['G', false, ['g0']]]) },
    ])
    expect(orquestacion.get(0).session).toBe('PRIMERO')
  })

  it('lista las que ningún ATL menciona', () => {
    const { huerfanas } = enrichWithAtl(integraciones, [], [
      { nombre: 'p.atl', atl: atl('P', [['G', false, ['g0']]]) },
    ])
    expect(huerfanas).toEqual([1, 2])
  })

  it('sin ATL no hay orquestación y todas quedan huérfanas', () => {
    const resultado = enrichWithAtl(integraciones, [], [])
    expect(resultado.procesos).toEqual([])
    expect(resultado.huerfanas).toEqual([0, 1, 2])
    expect(resultado.conflictos).toEqual([])
  })
})

describe('detectarConflictos', () => {
  const orquestacion = (entradas) => new Map(entradas)

  // A alimenta a B y corren a la vez: B puede leer datos de la corrida anterior.
  it('marca la dependencia dentro de un grupo paralelo', () => {
    const conflictos = detectarConflictos(
      [{ from: 0, to: 1, via: 'table', label: 'T' }],
      orquestacion([
        [0, { grupo: 'G', parallel: true, orden: 1, procesoIdx: 0 }],
        [1, { grupo: 'G', parallel: true, orden: 2, procesoIdx: 0 }],
      ]),
    )
    expect(conflictos).toEqual([{ from: 0, to: 1, via: 'table', label: 'T', reason: 'parallel' }])
  })

  // A alimenta a B, pero el proceso ejecuta B primero: siempre lee datos viejos.
  it('marca la dependencia que el proceso ejecuta al revés', () => {
    const conflictos = detectarConflictos(
      [{ from: 0, to: 1, via: 'file', label: 'F' }],
      orquestacion([
        [0, { grupo: 'B', parallel: false, orden: 5, procesoIdx: 0 }],
        [1, { grupo: 'A', parallel: false, orden: 2, procesoIdx: 0 }],
      ]),
    )
    expect(conflictos[0].reason).toBe('reverse')
  })

  it('el orden correcto no es un conflicto', () => {
    expect(detectarConflictos(
      [{ from: 0, to: 1 }],
      orquestacion([
        [0, { grupo: 'A', parallel: false, orden: 1, procesoIdx: 0 }],
        [1, { grupo: 'B', parallel: false, orden: 2, procesoIdx: 0 }],
      ]),
    )).toEqual([])
  })

  // Dos procesos pueden correr en momentos distintos del día; el ATL no dice nada de eso.
  it('no compara integraciones de procesos distintos', () => {
    expect(detectarConflictos(
      [{ from: 0, to: 1 }],
      orquestacion([
        [0, { grupo: 'A', parallel: false, orden: 9, procesoIdx: 0 }],
        [1, { grupo: 'B', parallel: false, orden: 1, procesoIdx: 1 }],
      ]),
    )).toEqual([])
  })

  it('una integración que ningún ATL ubica no entra en ningún conflicto', () => {
    expect(detectarConflictos([{ from: 0, to: 1 }], orquestacion([[0, { orden: 5, procesoIdx: 0 }]]))).toEqual([])
  })

  // Grupos paralelos distintos dentro del mismo proceso corren uno después del otro.
  it('el paralelismo solo importa dentro del mismo grupo', () => {
    expect(detectarConflictos(
      [{ from: 0, to: 1 }],
      orquestacion([
        [0, { grupo: 'A', parallel: true, orden: 1, procesoIdx: 0 }],
        [1, { grupo: 'B', parallel: true, orden: 2, procesoIdx: 0 }],
      ]),
    )).toEqual([])
  })
})

describe('conflictosDe y conConflicto', () => {
  const conflictos = [{ from: 0, to: 1, reason: 'parallel' }, { from: 3, to: 4, reason: 'reverse' }]

  it('encuentra los conflictos de una integración, mire de qué lado', () => {
    expect(conflictosDe(conflictos, 1)).toEqual([conflictos[0]])
    expect(conflictosDe(conflictos, 3)).toEqual([conflictos[1]])
    expect(conflictosDe(conflictos, 9)).toEqual([])
  })

  it('junta a todas las involucradas para poder filtrar', () => {
    expect([...conConflicto(conflictos)].sort()).toEqual([0, 1, 3, 4])
  })
})
