import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryRedis } from '../persistence/redis-in-memory.js'
import {
  RUN_STATE_SECONDS,
  borrarRun,
  errorDeConflicto,
  esTerminal,
  getRun,
  guardarRun,
  listActiveRuns,
} from './run-store.js'

const entorno = vi.hoisted(() => ({ redis: null }))

vi.mock('../persistence/redis.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getRedis: () => entorno.redis }
})

beforeEach(() => {
  entorno.redis = createInMemoryRedis()
})

describe('esTerminal', () => {
  it('reconoce los estados en los que la ejecución ya no avanza', () => {
    expect(['success', 'error', 'cancelled'].every(esTerminal)).toBe(true)
    expect(esTerminal('running')).toBe(false)
  })
})

describe('errorDeConflicto', () => {
  it('es un error con código 409', () => {
    const error = errorDeConflicto('Ya hay una ejecución activa')
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ message: 'Ya hay una ejecución activa', statusCode: 409 })
  })
})

describe('guardarRun y getRun', () => {
  it('guarda con el prefijo del cliente y vence a la semana', async () => {
    await guardarRun('c-1', 'o-1', { status: 'running' })

    expect(entorno.redis.keys()).toContain('c:c-1:orch-run:o-1')
    expect(await entorno.redis.ttl('c:c-1:orch-run:o-1')).toBe(RUN_STATE_SECONDS)
  })

  // Aislamiento por cliente: la misma orquestación con otro cliente no ve nada.
  it('una ejecución de un cliente no se lee con otro', async () => {
    await guardarRun('c-1', 'o-1', { status: 'running' })
    expect(await getRun('c-2', 'o-1')).toBeNull()
    expect(await getRun('c-1', 'o-1')).toEqual({ status: 'running' })
  })

  it('una en marcha entra en el índice y al terminar sale', async () => {
    await guardarRun('c-1', 'o-1', { status: 'running' })
    expect(await listActiveRuns()).toEqual([{ clientId: 'c-1', orchestrationId: 'o-1' }])

    await guardarRun('c-1', 'o-1', { status: 'success' })
    expect(await listActiveRuns()).toEqual([])
  })
})

describe('borrarRun', () => {
  it('borra el estado y saca la ejecución del índice', async () => {
    await guardarRun('c-1', 'o-1', { status: 'running' })

    await borrarRun('c-1', 'o-1')

    expect(await getRun('c-1', 'o-1')).toBeNull()
    expect(await listActiveRuns()).toEqual([])
  })

  it('solo toca la del cliente que lo pide', async () => {
    await guardarRun('c-1', 'o-1', { status: 'running' })
    await guardarRun('c-2', 'o-1', { status: 'running' })

    await borrarRun('c-1', 'o-1')

    expect(await getRun('c-2', 'o-1')).toEqual({ status: 'running' })
    expect(await listActiveRuns()).toEqual([{ clientId: 'c-2', orchestrationId: 'o-1' }])
  })

  it('no falla si no había nada', async () => {
    await expect(borrarRun('c-1', 'inexistente')).resolves.toBeUndefined()
  })
})
