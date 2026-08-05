import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DETAIL_CONCURRENCY, MAX_RUNS_PER_BATCH, fetchTaskDetails } from './task-details.js'
import { runCidsOperation } from './operations.js'

vi.mock('./operations.js', () => ({ runCidsOperation: vi.fn() }))

const CLIENTE = 'c-1'
const CONEXION = 'conn-1'

const pedir = (runIds) => fetchTaskDetails({ clientId: CLIENTE, connectionId: CONEXION, runIds })

beforeEach(() => {
  vi.clearAllMocks()
  runCidsOperation.mockResolvedValue({ endTime: '20260804123000.0000000', executionTime: '296.5' })
})

describe('fetchTaskDetails', () => {
  it('devuelve fin y duración por ejecución', async () => {
    const detalles = await pedir(['r-1', 'r-2'])

    expect(detalles).toEqual({
      'r-1': { endTime: '202608041230000000000', durationSeconds: 296.5, failed: false },
      'r-2': { endTime: '202608041230000000000', durationSeconds: 296.5, failed: false },
    })
  })

  it('consulta con el cliente y la conexión que le dieron', async () => {
    await pedir(['r-1'])

    expect(runCidsOperation).toHaveBeenCalledWith({
      clientId: CLIENTE,
      connectionId: CONEXION,
      operation: 'getTaskStatusByRunId2',
      params: { runId: 'r-1' },
    })
  })

  it('quita los separadores del fin, vengan como vengan del tenant', async () => {
    runCidsOperation.mockResolvedValue({ endTime: '2026-08-04T12:30:00', executionTime: '1' })

    const { 'r-1': detalle } = await pedir(['r-1'])

    // Los catorce primeros dígitos son la fecha y la hora, que es lo que se muestra.
    expect(detalle.endTime.slice(0, 14)).toBe('20260804123000')
  })

  it('deja el fin en nulo cuando la ejecución sigue en curso', async () => {
    runCidsOperation.mockResolvedValue({ endTime: '', executionTime: '' })

    expect(await pedir(['r-1'])).toEqual({
      'r-1': { endTime: null, durationSeconds: null, failed: false },
    })
  })

  it('no pregunta dos veces por la misma ejecución', async () => {
    await pedir(['r-1', 'r-1', 'r-1'])

    expect(runCidsOperation).toHaveBeenCalledTimes(1)
  })

  it('descarta identificadores vacíos', async () => {
    const detalles = await pedir(['r-1', '', '   ', null, undefined])

    expect(runCidsOperation).toHaveBeenCalledTimes(1)
    expect(Object.keys(detalles)).toEqual(['r-1'])
  })

  it('con la lista vacía no llama a SAP', async () => {
    expect(await pedir([])).toEqual({})
    expect(runCidsOperation).not.toHaveBeenCalled()
  })

  it('exige una lista', async () => {
    await expect(pedir(undefined)).rejects.toThrow(/qué ejecuciones/)
  })

  // El tope es del despliegue: una tanda más grande no entra en el tiempo de la función.
  it('rechaza una tanda que pase del máximo', async () => {
    const demasiadas = Array.from({ length: MAX_RUNS_PER_BATCH + 1 }, (_, i) => `r-${i}`)

    await expect(pedir(demasiadas)).rejects.toThrow(new RegExp(`${MAX_RUNS_PER_BATCH}`))
    expect(runCidsOperation).not.toHaveBeenCalled()
  })

  it('admite justo el máximo', async () => {
    const justas = Array.from({ length: MAX_RUNS_PER_BATCH }, (_, i) => `r-${i}`)

    expect(Object.keys(await pedir(justas))).toHaveLength(MAX_RUNS_PER_BATCH)
  })

  // Con cincuenta filas en pantalla, dejar la tabla en blanco por una ejecución con problemas
  // sería peor que no mostrar su duración.
  it('una consulta que falla no tumba a las demás', async () => {
    runCidsOperation.mockImplementation(async ({ params }) => {
      if (params.runId === 'r-2') throw new Error('SAP dijo que no')
      return { endTime: '20260804123000', executionTime: '10' }
    })

    const detalles = await pedir(['r-1', 'r-2', 'r-3'])

    expect(detalles['r-2']).toEqual({ endTime: null, durationSeconds: null, failed: true })
    expect(detalles['r-1'].failed).toBe(false)
    expect(detalles['r-3'].failed).toBe(false)
  })

  it('no manda a SAP más consultas a la vez que el tope', async () => {
    let enVuelo = 0
    let maximo = 0
    runCidsOperation.mockImplementation(async () => {
      enVuelo += 1
      maximo = Math.max(maximo, enVuelo)
      await new Promise((listo) => setTimeout(listo, 1))
      enVuelo -= 1
      return { endTime: '20260804123000', executionTime: '1' }
    })

    await pedir(Array.from({ length: MAX_RUNS_PER_BATCH }, (_, i) => `r-${i}`))

    expect(maximo).toBeLessThanOrEqual(DETAIL_CONCURRENCY)
  })
})
