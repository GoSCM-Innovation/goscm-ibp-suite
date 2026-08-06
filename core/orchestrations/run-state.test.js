import { describe, it, expect } from 'vitest'
import {
  decideForPending,
  directPredecessors,
  initRunState,
  resetForResume,
  runOutcome,
} from './run-state.js'

const ARRANQUE = '2026-08-04T12:00:00.000Z'

const tarea = (id, parentId) => ({ id, type: 'task', ...(parentId ? { parentId } : {}) })
const grupo = (id) => ({ id, type: 'group' })
const arista = (desde, hasta) => ({ id: `e-${desde}-${hasta}`, source: desde, target: hasta })

const conEstado = (status, extra = {}) => ({ status, ...extra })

describe('initRunState', () => {
  it('arranca con todos los pasos pendientes y la ejecución corriendo', () => {
    const run = initRunState([tarea('a'), tarea('b')], ARRANQUE)

    expect(run.status).toBe('running')
    expect(run.startedAt).toBe(ARRANQUE)
    expect(run.finishedAt).toBeNull()
    expect(Object.keys(run.nodes)).toEqual(['a', 'b'])
    expect(run.nodes.a.status).toBe('pending')
  })

  // Así el grupo se puede dar por terminado mirando solo lo suyo.
  it('los hijos de un grupo cuelgan del estado del grupo, no del primer nivel', () => {
    const run = initRunState([grupo('g'), tarea('a', 'g'), tarea('b', 'g')], ARRANQUE)

    expect(Object.keys(run.nodes)).toEqual(['g'])
    expect(Object.keys(run.nodes.g.children)).toEqual(['a', 'b'])
    expect(run.nodes.g.type).toBe('group')
  })

  it('un grupo vacío no rompe nada', () => {
    expect(initRunState([grupo('g')], ARRANQUE).nodes.g.children).toEqual({})
  })

  it('cada paso arranca sin ejecución de SAP ni reintentos', () => {
    const { a } = initRunState([tarea('a')], ARRANQUE).nodes
    expect(a).toMatchObject({ sapRunId: null, retryCount: 0, retryAt: null, error: null })
  })
})

describe('directPredecessors', () => {
  it('dice de quién depende cada paso', () => {
    const mapa = directPredecessors([tarea('a'), tarea('b')], [arista('a', 'b')])
    expect(mapa.get('b')).toEqual(['a'])
    expect(mapa.get('a')).toEqual([])
  })

  it('un paso puede esperar a varios', () => {
    const mapa = directPredecessors(
      [tarea('a'), tarea('b'), tarea('c')],
      [arista('a', 'c'), arista('b', 'c')],
    )
    expect(mapa.get('c').sort()).toEqual(['a', 'b'])
  })

  // Las conexiones que cruzan niveles no cuentan: los hijos de un grupo se ordenan entre ellos.
  it('ignora conexiones con nodos que no están en la lista', () => {
    const mapa = directPredecessors([tarea('a')], [arista('fuera', 'a'), arista('a', 'fuera')])
    expect(mapa.get('a')).toEqual([])
  })
})

describe('decideForPending', () => {
  const sinConfig = {}

  it('sin nada que esperar, se lanza', () => {
    expect(decideForPending([], {}, sinConfig)).toBe('lanzar')
  })

  it('espera mientras algún predecesor siga corriendo', () => {
    const estados = { a: conEstado('success'), b: conEstado('running') }
    expect(decideForPending(['a', 'b'], estados, sinConfig)).toBe('esperar')
  })

  it('con todos los predecesores correctos, se lanza', () => {
    const estados = { a: conEstado('success'), b: conEstado('success_with_errors') }
    expect(decideForPending(['a', 'b'], estados, sinConfig)).toBe('lanzar')
  })

  it('un predecesor salteado arrastra a los que vienen detrás', () => {
    expect(decideForPending(['a'], { a: conEstado('skipped') }, sinConfig)).toBe('saltear')
  })

  it('un predecesor cancelado también bloquea', () => {
    expect(decideForPending(['a'], { a: conEstado('cancelled') }, sinConfig)).toBe('saltear')
  })

  it('un predecesor fallado con "parar" bloquea', () => {
    const config = { a: { errorStrategy: 'stop' } }
    expect(decideForPending(['a'], { a: conEstado('error') }, config)).toBe('saltear')
  })

  // Es justamente para lo que existe la estrategia: el fallo se da por asumido y la cadena sigue.
  it('un predecesor fallado con "continuar" NO bloquea', () => {
    const config = { a: { errorStrategy: 'continue' } }
    expect(decideForPending(['a'], { a: conEstado('error') }, config)).toBe('lanzar')
  })

  it('sin estrategia configurada, un fallo bloquea: es lo prudente', () => {
    expect(decideForPending(['a'], { a: conEstado('error') }, {})).toBe('saltear')
  })

  it('basta que uno bloquee para saltear, aunque los demás hayan ido bien', () => {
    const estados = { a: conEstado('success'), b: conEstado('error') }
    expect(decideForPending(['a', 'b'], estados, { b: { errorStrategy: 'stop' } })).toBe('saltear')
  })
})

describe('runOutcome', () => {
  it('sigue corriendo mientras quede algo sin terminar', () => {
    expect(runOutcome(['a', 'b'], { a: conEstado('success'), b: conEstado('running') })).toBe('running')
  })

  it('todos correctos, ejecución correcta', () => {
    expect(runOutcome(['a', 'b'], { a: conEstado('success'), b: conEstado('success_with_errors') })).toBe('success')
  })

  // Si algo no se hizo, decir que la carga salió bien sería mentir.
  it('una sola fallada deja fallada la ejecución entera', () => {
    expect(runOutcome(['a', 'b'], { a: conEstado('success'), b: conEstado('error') })).toBe('error')
  })

  it('con pasos salteados pero ninguno fallado, la ejecución es correcta', () => {
    expect(runOutcome(['a', 'b'], { a: conEstado('success'), b: conEstado('skipped') })).toBe('success')
  })

  it('un paso sin estado se considera sin terminar', () => {
    expect(runOutcome(['a', 'b'], { a: conEstado('success') })).toBe('running')
  })
})

describe('resetForResume', () => {
  const ejecucionFallada = {
    status: 'error',
    startedAt: ARRANQUE,
    finishedAt: '2026-08-04T13:00:00.000Z',
    nodes: {
      a: { nodeId: 'a', type: 'task', status: 'success', sapRunId: '100', finishedAt: 'x' },
      b: { nodeId: 'b', type: 'task', status: 'error', sapRunId: '101', error: 'SAP: ERROR', retryCount: 2 },
      c: { nodeId: 'c', type: 'task', status: 'skipped' },
    },
  }

  // Volver a lanzar una carga que ya entró la duplicaría en SAP.
  it('conserva lo que salió bien', () => {
    const run = resetForResume(ejecucionFallada)
    expect(run.nodes.a).toBe(ejecucionFallada.nodes.a)
  })

  it('devuelve a pendiente lo que falló, y le limpia el rastro', () => {
    const { b } = resetForResume(ejecucionFallada).nodes
    expect(b).toMatchObject({ status: 'pending', sapRunId: null, error: null, retryCount: 0 })
  })

  // Si el paso que lo bloqueaba ahora sale bien, a este le toca correr.
  it('lo salteado vuelve a pendiente', () => {
    expect(resetForResume(ejecucionFallada).nodes.c.status).toBe('pending')
  })

  it('la ejecución vuelve a estar corriendo y sin hora de fin', () => {
    const run = resetForResume(ejecucionFallada)
    expect(run.status).toBe('running')
    expect(run.finishedAt).toBeNull()
    expect(run.startedAt).toBe(ARRANQUE)
  })

  it('no modifica el estado que recibe', () => {
    const copia = JSON.parse(JSON.stringify(ejecucionFallada))
    resetForResume(ejecucionFallada)
    expect(ejecucionFallada).toEqual(copia)
  })

  describe('grupos', () => {
    const conGrupo = {
      status: 'error',
      nodes: {
        g: {
          nodeId: 'g',
          type: 'group',
          status: 'error',
          children: {
            h1: { nodeId: 'h1', status: 'success', sapRunId: '200' },
            h2: { nodeId: 'h2', status: 'error', sapRunId: '201', error: 'SAP: ERROR' },
          },
        },
      },
    }

    it('un grupo fallado vuelve a pendiente pero conserva los hijos que salieron bien', () => {
      const { g } = resetForResume(conGrupo).nodes
      expect(g.status).toBe('pending')
      expect(g.children.h1.status).toBe('success')
      expect(g.children.h2.status).toBe('pending')
    })

    it('un grupo entero correcto no se toca', () => {
      const correcto = { status: 'error', nodes: { g: { ...conGrupo.nodes.g, status: 'success' } } }
      expect(resetForResume(correcto).nodes.g).toBe(correcto.nodes.g)
    })
  })
})
