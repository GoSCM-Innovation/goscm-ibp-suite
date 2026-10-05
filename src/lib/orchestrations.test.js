import { describe, expect, it } from 'vitest'
import { runProgress } from './orchestrations.js'

describe('runProgress', () => {
  it('sin ejecución no cuenta nada', () => {
    expect(runProgress(null)).toEqual({ hechos: 0, total: 0 })
    expect(runProgress({})).toEqual({ hechos: 0, total: 0 })
  })

  it('cuenta como hecho todo lo que ya no está pendiente ni corriendo', () => {
    const run = { nodes: {
      a: { status: 'success' },
      b: { status: 'error' },
      c: { status: 'running' },
      d: { status: 'pending' },
      e: { status: 'skipped' },
    } }
    expect(runProgress(run)).toEqual({ hechos: 3, total: 5 })
  })

  it('cuenta los pasos de dentro de un grupo y no el grupo', () => {
    const run = { nodes: {
      g: { type: 'group', status: 'running', children: { x: { status: 'success' }, y: { status: 'running' } } },
      z: { status: 'pending' },
    } }
    expect(runProgress(run)).toEqual({ hechos: 1, total: 3 })
  })
})
