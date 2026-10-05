import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createInMemoryRedis } from '../persistence/redis-in-memory.js'
import {
  ESPERA_ENTRE_INTENTOS_DE_CORTAR_MS,
  RUN_LOCK_SECONDS,
  cancelRun,
  getRun,
  resumeRun,
  startRun,
  tickRun,
} from './runner.js'
import { getOrchestration } from './orchestrations.js'
import { runCidsOperation } from '../cids/operations.js'

const entorno = vi.hoisted(() => ({ ms: Date.UTC(2026, 7, 4, 12, 0, 0), redis: null }))

vi.mock('../persistence/redis.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getRedis: () => entorno.redis }
})
vi.mock('./orchestrations.js', () => ({ getOrchestration: vi.fn() }))
vi.mock('../cids/operations.js', () => ({ runCidsOperation: vi.fn() }))

// El motor elige el adaptador según el tipo de la conexión. Estas pruebas son las del motor con una
// de CI-DS; las del adaptador de IBP están en `adapters.test.js`.
vi.mock('../connections/index.js', () => ({
  getConnectionTarget: vi.fn(async () => ({ kind: 'cids', baseUrl: 'https://cids' })),
  getCredentials: vi.fn(async () => ({ user: 'u', password: 'p' })),
}))

const CLIENTE = 'c-1'
const ORQ = 'orq-1'

const tarea = (id, data = {}, parentId) => ({
  id,
  type: 'task',
  data: { taskName: id, ...data },
  ...(parentId ? { parentId } : {}),
})
const grupo = (id) => ({ id, type: 'group', data: {} })
const arista = (desde, hasta) => ({ id: `e-${desde}-${hasta}`, source: desde, target: hasta })

const orquestacion = (nodes, edges = []) => ({
  id: ORQ,
  connectionId: 'conn-1',
  production: false,
  name: 'Carga diaria',
  nodes,
  edges,
})

// El contador vive fuera y se reinicia en beforeEach: si se reiniciara en cada `sapResponde`, dos
// tareas distintas recibirían el mismo identificador y los tests mentirían.
let siguienteRunId = 100

/** SAP contesta: lanzar devuelve un identificador y consultar devuelve el estado que se le diga. */
function sapResponde({ estados = {}, alLanzar } = {}) {
  runCidsOperation.mockImplementation(async ({ operation, params }) => {
    if (operation === 'runTask') {
      if (alLanzar) return alLanzar(params)
      siguienteRunId += 1
      return { runId: String(siguienteRunId) }
    }
    if (operation === 'getTaskStatusByRunId2') {
      return estados[params.runId] ?? { statusCode: 'RUNNING' }
    }
    if (operation === 'cancelTask') return { status: 'OK' }
    return null
  })
}

const avanzar = () => tickRun(CLIENTE, ORQ, entorno.ms)

beforeEach(() => {
  vi.clearAllMocks()
  entorno.ms = Date.UTC(2026, 7, 4, 12, 0, 0)
  entorno.redis = createInMemoryRedis({ now: () => entorno.ms })
  siguienteRunId = 100
  sapResponde()
})

describe('startRun', () => {
  it('deja todos los pasos pendientes y la ejecución corriendo', async () => {
    getOrchestration.mockResolvedValue(orquestacion([tarea('a'), tarea('b')]))

    const run = await startRun(CLIENTE, ORQ, {}, entorno.ms)

    expect(run.status).toBe('running')
    expect(run.nodes.a.status).toBe('pending')
    expect(runCidsOperation).not.toHaveBeenCalled()
  })

  it('guarda el estado con el prefijo del cliente', async () => {
    getOrchestration.mockResolvedValue(orquestacion([tarea('a')]))
    await startRun(CLIENTE, ORQ, {}, entorno.ms)
    expect(entorno.redis.keys()).toContain(`c:${CLIENTE}:orch-run:${ORQ}`)
  })

  // Lanzar la misma orquestación dos veces a la vez duplicaría cada carga en SAP.
  it('se niega si ya hay una ejecución en curso', async () => {
    getOrchestration.mockResolvedValue(orquestacion([tarea('a')]))
    await startRun(CLIENTE, ORQ, {}, entorno.ms)

    await expect(startRun(CLIENTE, ORQ, {}, entorno.ms)).rejects.toThrow('Ya hay una ejecución activa')
  })

  // v9 contestaba 409 cuando ya había una ejecución activa.
  it('el rechazo por ejecución activa lleva el código 409', async () => {
    getOrchestration.mockResolvedValue(orquestacion([tarea('a')]))
    await startRun(CLIENTE, ORQ, {}, entorno.ms)

    await expect(startRun(CLIENTE, ORQ, {}, entorno.ms)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('si otra vuelta tiene el cerrojo, tampoco arranca una segunda', async () => {
    getOrchestration.mockResolvedValue(orquestacion([tarea('a')]))
    await entorno.redis.set(`c:${CLIENTE}:orch-run-lock:${ORQ}`, 'de-otro', { ex: RUN_LOCK_SECONDS })

    await expect(startRun(CLIENTE, ORQ, {}, entorno.ms)).rejects.toMatchObject({
      message: 'Ya hay una ejecución activa',
      statusCode: 409,
    })
  })

  it('vuelve a arrancar si la anterior ya terminó', async () => {
    getOrchestration.mockResolvedValue(orquestacion([tarea('a')]))
    await startRun(CLIENTE, ORQ, {}, entorno.ms)
    sapResponde({ estados: { 101: { statusCode: 'SUCCESS' } } })
    await avanzar()
    await avanzar()
    expect((await getRun(CLIENTE, ORQ)).status).toBe('success')

    await expect(startRun(CLIENTE, ORQ, {}, entorno.ms)).resolves.toMatchObject({ status: 'running' })
  })

  it('rechaza una orquestación sin pasos', async () => {
    getOrchestration.mockResolvedValue(orquestacion([]))
    await expect(startRun(CLIENTE, ORQ, {}, entorno.ms)).rejects.toThrow('La orquestación no tiene nodos')
  })

  it('rechaza una orquestación que no es de este cliente', async () => {
    getOrchestration.mockResolvedValue(null)
    await expect(startRun(CLIENTE, ORQ, {}, entorno.ms)).rejects.toThrow(/no existe para este cliente/)
  })
})

describe('tickRun', () => {
  it('lanza los pasos sin predecesores y los deja corriendo', async () => {
    getOrchestration.mockResolvedValue(orquestacion([tarea('a'), tarea('b')]))
    await startRun(CLIENTE, ORQ, {}, entorno.ms)

    const run = await avanzar()

    expect(run.nodes.a.status).toBe('running')
    expect(run.nodes.b.status).toBe('running')
    expect(run.nodes.a.sapRunId).toBeTruthy()
  })

  it('no lanza un paso hasta que termine el que va antes', async () => {
    getOrchestration.mockResolvedValue(orquestacion([tarea('a'), tarea('b')], [arista('a', 'b')]))
    await startRun(CLIENTE, ORQ, {}, entorno.ms)

    const primera = await avanzar()
    expect(primera.nodes.a.status).toBe('running')
    expect(primera.nodes.b.status).toBe('pending')

    sapResponde({ estados: { 101: { statusCode: 'SUCCESS' } } })
    const segunda = await avanzar()
    expect(segunda.nodes.a.status).toBe('success')
    expect(segunda.nodes.b.status).toBe('running')
  })

  // Es el hallazgo de v9: por predecesores y no por olas, dos cadenas no se esperan entre sí.
  it('dos cadenas independientes avanzan a su ritmo', async () => {
    getOrchestration.mockResolvedValue(orquestacion(
      [tarea('a'), tarea('b'), tarea('c'), tarea('d')],
      [arista('a', 'b'), arista('c', 'd')],
    ))
    await startRun(CLIENTE, ORQ, {}, entorno.ms)
    await avanzar()

    // La primera cadena termina su primer paso; la segunda sigue corriendo.
    sapResponde({ estados: { 101: { statusCode: 'SUCCESS' }, 102: { statusCode: 'RUNNING' } } })
    const run = await avanzar()

    expect(run.nodes.b.status).toBe('running')
    expect(run.nodes.d.status).toBe('pending')
  })

  it('la ejecución termina bien cuando terminan todos', async () => {
    getOrchestration.mockResolvedValue(orquestacion([tarea('a')]))
    await startRun(CLIENTE, ORQ, {}, entorno.ms)
    await avanzar()

    sapResponde({ estados: { 101: { statusCode: 'SUCCESS' } } })
    const run = await avanzar()

    expect(run.status).toBe('success')
    expect(run.finishedAt).toBe(new Date(entorno.ms).toISOString())
  })

  it('una vuelta sobre una ejecución terminada no hace nada', async () => {
    getOrchestration.mockResolvedValue(orquestacion([tarea('a')]))
    await startRun(CLIENTE, ORQ, {}, entorno.ms)
    await avanzar()
    sapResponde({ estados: { 101: { statusCode: 'SUCCESS' } } })
    await avanzar()

    runCidsOperation.mockClear()
    await avanzar()
    expect(runCidsOperation).not.toHaveBeenCalled()
  })

  describe('fallos', () => {
    it('un paso fallado con "parar" saltea lo que venía detrás', async () => {
      getOrchestration.mockResolvedValue(orquestacion(
        [tarea('a', { errorStrategy: 'stop' }), tarea('b')],
        [arista('a', 'b')],
      ))
      await startRun(CLIENTE, ORQ, {}, entorno.ms)
      await avanzar()

      sapResponde({ estados: { 101: { statusCode: 'ERROR', statusMsg: 'no anduvo' } } })
      const run = await avanzar()

      expect(run.nodes.a.status).toBe('error')
      expect(run.nodes.b.status).toBe('skipped')
      expect(run.status).toBe('error')
    })

    it('con "continuar", el que viene detrás igual corre', async () => {
      getOrchestration.mockResolvedValue(orquestacion(
        [tarea('a', { errorStrategy: 'continue' }), tarea('b')],
        [arista('a', 'b')],
      ))
      await startRun(CLIENTE, ORQ, {}, entorno.ms)
      await avanzar()

      sapResponde({ estados: { 101: { statusCode: 'ERROR' } } })
      const run = await avanzar()

      expect(run.nodes.b.status).toBe('running')
    })

    // Hay una espera de 1,5 s entre el intento y su reintento (como v9): se adelanta el reloj en vez
    // de esperarla de verdad.
    describe('al lanzar', () => {
      beforeEach(() => { vi.useFakeTimers() })
      afterEach(() => { vi.useRealTimers() })

      it('no poder lanzar una tarea falla ese paso, no la vuelta entera', async () => {
        getOrchestration.mockResolvedValue(orquestacion([tarea('a'), tarea('b')]))
        await startRun(CLIENTE, ORQ, {}, entorno.ms)

        sapResponde({ alLanzar: ({ taskName }) => {
          if (taskName === 'a') throw new Error('SAP rechazó la tarea')
          return { runId: '999' }
        } })
        const vuelta = avanzar()
        await vi.advanceTimersByTimeAsync(1500)
        const run = await vuelta

        expect(run.nodes.a.status).toBe('error')
        expect(run.nodes.a.error).toBe('SAP rechazó la tarea')
        expect(run.nodes.b.status).toBe('running')
      })

      // Como v9: SAP a veces rechaza la primera llamada y la segunda entra.
      it('un rechazo pasajero al lanzar se reintenta una vez y el paso arranca', async () => {
        getOrchestration.mockResolvedValue(orquestacion([tarea('a')]))
        await startRun(CLIENTE, ORQ, {}, entorno.ms)

        let llamadas = 0
        sapResponde({ alLanzar: () => {
          llamadas += 1
          if (llamadas === 1) throw new Error('SOAP error HTTP 500')
          return { runId: '777' }
        } })
        const vuelta = avanzar()
        await vi.advanceTimersByTimeAsync(1500)
        const run = await vuelta

        expect(llamadas).toBe(2)
        expect(run.nodes.a).toMatchObject({ status: 'running', sapRunId: '777' })
      })

      it('un error de sesión al lanzar falla el paso sin reintentar', async () => {
        getOrchestration.mockResolvedValue(orquestacion([tarea('a')]))
        await startRun(CLIENTE, ORQ, {}, entorno.ms)

        let llamadas = 0
        sapResponde({ alLanzar: () => { llamadas += 1; throw new Error('invalid session') } })
        const run = await avanzar()

        expect(llamadas).toBe(1)
        expect(run.nodes.a).toMatchObject({ status: 'error', error: 'invalid session' })
      })
    })

    // Como v9 (`mergeVariables`): la variable de la ejecución pisa la del paso, y solo en los pasos que
    // ya la declaran.
    it('las variables de la ejecución solo llegan a los pasos que las declaran', async () => {
      getOrchestration.mockResolvedValue(orquestacion([
        tarea('a', { globalVariables: [{ name: 'FECHA', value: 'del-paso' }] }),
        tarea('b'),
      ]))
      await startRun(CLIENTE, ORQ, { defaults: { globalVariables: [{ name: 'FECHA', value: 'de-la-ejecucion' }] } }, entorno.ms)
      await avanzar()

      const variables = Object.fromEntries(runCidsOperation.mock.calls
        .filter(([{ operation }]) => operation === 'runTask')
        .map(([{ params }]) => [params.taskName, params.globalVariables]))
      expect(variables.a).toEqual([{ name: 'FECHA', value: 'de-la-ejecucion' }])
      expect(variables.b).toEqual([])
    })

    it('no poder consultar un paso no decide nada: se sigue esperando', async () => {
      getOrchestration.mockResolvedValue(orquestacion([tarea('a')]))
      await startRun(CLIENTE, ORQ, {}, entorno.ms)
      await avanzar()

      runCidsOperation.mockRejectedValue(new Error('CI-DS no contesta'))
      const run = await avanzar()

      expect(run.nodes.a.status).toBe('running')
      expect(run.status).toBe('running')
    })
  })

  describe('reintentos', () => {
    it('un fallo con reintentos vuelve a pendiente y se relanza cuando pasa la espera', async () => {
      getOrchestration.mockResolvedValue(orquestacion(
        [tarea('a', { errorStrategy: 'retry', maxRetries: 1, retryDelaySeconds: 60 })],
      ))
      await startRun(CLIENTE, ORQ, {}, entorno.ms)
      await avanzar()

      sapResponde({ estados: { 101: { statusCode: 'ERROR' } } })
      const trasFallo = await avanzar()
      expect(trasFallo.nodes.a.status).toBe('pending')
      expect(trasFallo.nodes.a.retryCount).toBe(1)

      // Todavía no le toca.
      entorno.ms += 30_000
      expect((await avanzar()).nodes.a.status).toBe('pending')

      // Ahora sí.
      entorno.ms += 40_000
      sapResponde()
      const relanzado = await avanzar()
      expect(relanzado.nodes.a.status).toBe('running')
      expect(relanzado.nodes.a.sapRunId).toBeTruthy()
    })
  })

  describe('grupos', () => {
    it('un grupo no se lanza en SAP: se pone en marcha y sus hijos avanzan solos', async () => {
      getOrchestration.mockResolvedValue(orquestacion([grupo('g'), tarea('h1', {}, 'g')]))
      await startRun(CLIENTE, ORQ, {}, entorno.ms)

      const primera = await avanzar()
      expect(primera.nodes.g.status).toBe('running')
      // Solo se puso en marcha: todavía no se lanzó ninguna tarea.
      expect(runCidsOperation).not.toHaveBeenCalled()

      const segunda = await avanzar()
      expect(segunda.nodes.g.children.h1.status).toBe('running')
    })

    it('el grupo termina cuando terminan sus hijos', async () => {
      getOrchestration.mockResolvedValue(orquestacion([grupo('g'), tarea('h1', {}, 'g')]))
      await startRun(CLIENTE, ORQ, {}, entorno.ms)
      await avanzar()
      await avanzar()

      sapResponde({ estados: { 101: { statusCode: 'SUCCESS' } } })
      const run = await avanzar()

      expect(run.nodes.g.children.h1.status).toBe('success')
      expect(run.nodes.g.status).toBe('success')
      expect(run.status).toBe('success')
    })

    it('un hijo fallado deja fallado al grupo', async () => {
      getOrchestration.mockResolvedValue(orquestacion([grupo('g'), tarea('h1', {}, 'g')]))
      await startRun(CLIENTE, ORQ, {}, entorno.ms)
      await avanzar()
      await avanzar()

      sapResponde({ estados: { 101: { statusCode: 'ERROR' } } })
      const run = await avanzar()

      expect(run.nodes.g.status).toBe('error')
      expect(run.status).toBe('error')
    })

    it('un grupo vacío termina en el acto', async () => {
      getOrchestration.mockResolvedValue(orquestacion([grupo('g')]))
      await startRun(CLIENTE, ORQ, {}, entorno.ms)

      const run = await avanzar()

      expect(run.nodes.g.status).toBe('success')
      expect(run.status).toBe('success')
    })
  })

  describe('cerrojo', () => {
    // Dos relojes avanzando la misma orquestación lanzarían cada tarea dos veces.
    it('si otra vuelta la está avanzando, no se toca nada', async () => {
      getOrchestration.mockResolvedValue(orquestacion([tarea('a')]))
      await startRun(CLIENTE, ORQ, {}, entorno.ms)

      // Alguien más tiene el cerrojo.
      await entorno.redis.set(`c:${CLIENTE}:orch-run-lock:${ORQ}`, 'de-otro', { ex: RUN_LOCK_SECONDS })

      const run = await avanzar()

      expect(run.nodes.a.status).toBe('pending')
      expect(runCidsOperation).not.toHaveBeenCalled()
    })

    it('el cerrojo se suelta al terminar la vuelta', async () => {
      getOrchestration.mockResolvedValue(orquestacion([tarea('a')]))
      await startRun(CLIENTE, ORQ, {}, entorno.ms)
      await avanzar()

      expect(entorno.redis.keys()).not.toContain(`c:${CLIENTE}:orch-run-lock:${ORQ}`)
    })
  })

  it('si borraron la orquestación mientras corría, se deja constancia', async () => {
    getOrchestration.mockResolvedValue(orquestacion([tarea('a')]))
    await startRun(CLIENTE, ORQ, {}, entorno.ms)

    getOrchestration.mockResolvedValue(null)
    const run = await avanzar()

    expect(run.status).toBe('error')
    expect(run.error).toMatch(/eliminada/)
  })
})

describe('resumeRun', () => {
  async function dejarFallada() {
    getOrchestration.mockResolvedValue(orquestacion([tarea('a'), tarea('b')], [arista('a', 'b')]))
    await startRun(CLIENTE, ORQ, {}, entorno.ms)
    await avanzar()
    sapResponde({ estados: { 101: { statusCode: 'ERROR' } } })
    await avanzar()
  }

  it('conserva lo que salió bien y devuelve a pendiente lo demás', async () => {
    getOrchestration.mockResolvedValue(orquestacion([tarea('a'), tarea('b')], [arista('a', 'b')]))
    await startRun(CLIENTE, ORQ, {}, entorno.ms)
    await avanzar()
    sapResponde({ estados: { 101: { statusCode: 'SUCCESS' } } })
    await avanzar()
    sapResponde({ estados: { 102: { statusCode: 'ERROR' } } })
    await avanzar()

    const run = await resumeRun(CLIENTE, ORQ)

    expect(run.status).toBe('running')
    expect(run.nodes.a.status).toBe('success')
    expect(run.nodes.b.status).toBe('pending')
  })

  it('no relanza lo que ya había salido bien', async () => {
    getOrchestration.mockResolvedValue(orquestacion([tarea('a'), tarea('b')], [arista('a', 'b')]))
    await startRun(CLIENTE, ORQ, {}, entorno.ms)
    await avanzar()
    sapResponde({ estados: { 101: { statusCode: 'SUCCESS' } } })
    await avanzar()
    sapResponde({ estados: { 102: { statusCode: 'ERROR' } } })
    await avanzar()
    await resumeRun(CLIENTE, ORQ)

    sapResponde()
    runCidsOperation.mockClear()
    await avanzar()

    const lanzadas = runCidsOperation.mock.calls
      .filter(([{ operation }]) => operation === 'runTask')
      .map(([{ params }]) => params.taskName)
    expect(lanzadas).toEqual(['b'])
  })

  it('no se puede retomar una que terminó bien', async () => {
    getOrchestration.mockResolvedValue(orquestacion([tarea('a')]))
    await startRun(CLIENTE, ORQ, {}, entorno.ms)
    await avanzar()
    sapResponde({ estados: { 101: { statusCode: 'SUCCESS' } } })
    await avanzar()

    await expect(resumeRun(CLIENTE, ORQ)).rejects.toThrow(/terminó bien/)
  })

  it('no se puede retomar una que sigue corriendo', async () => {
    await dejarFallada()
    await resumeRun(CLIENTE, ORQ)
    await expect(resumeRun(CLIENTE, ORQ)).rejects.toThrow('Ya hay una ejecución activa')
  })

  it('sin ejecución previa no hay nada que retomar', async () => {
    await expect(resumeRun(CLIENTE, ORQ)).rejects.toThrow(/ninguna ejecución registrada/)
  })
})

describe('cancelRun', () => {
  it('le pide a CI-DS que corte los pasos en marcha y marca la ejecución', async () => {
    getOrchestration.mockResolvedValue(orquestacion([tarea('a')]))
    await startRun(CLIENTE, ORQ, {}, entorno.ms)
    await avanzar()

    const run = await cancelRun(CLIENTE, ORQ, entorno.ms)

    expect(run.status).toBe('cancelled')
    expect(run.nodes.a.status).toBe('cancelled')
    const cancelaciones = runCidsOperation.mock.calls.filter(([{ operation }]) => operation === 'cancelTask')
    expect(cancelaciones).toHaveLength(1)
  })

  // Quedarse a medias por un paso que no se pudo cancelar sería lo peor de los dos mundos.
  it('un paso que no se puede cancelar no impide cortar los demás', async () => {
    getOrchestration.mockResolvedValue(orquestacion([tarea('a'), tarea('b')]))
    await startRun(CLIENTE, ORQ, {}, entorno.ms)
    await avanzar()

    runCidsOperation.mockImplementation(async ({ operation }) => {
      if (operation === 'cancelTask') throw new Error('CI-DS no pudo cancelarla')
      return { runId: '999' }
    })
    const run = await cancelRun(CLIENTE, ORQ, entorno.ms)

    expect(run.status).toBe('cancelled')
    expect(run.nodes.a.status).toBe('cancelled')
    expect(run.nodes.b.status).toBe('cancelled')
  })

  it('lo que ya había terminado conserva su resultado', async () => {
    getOrchestration.mockResolvedValue(orquestacion([tarea('a'), tarea('b')]))
    await startRun(CLIENTE, ORQ, {}, entorno.ms)
    await avanzar()
    sapResponde({ estados: { 101: { statusCode: 'SUCCESS' }, 102: { statusCode: 'RUNNING' } } })
    await avanzar()

    const run = await cancelRun(CLIENTE, ORQ, entorno.ms)

    expect(run.nodes.a.status).toBe('success')
    expect(run.nodes.b.status).toBe('cancelled')
  })

  // Como v9: a los que no llegaron a arrancar nadie los canceló, simplemente no corrieron.
  it('los pasos que corrían quedan cancelados y los que no habían empezado, omitidos', async () => {
    getOrchestration.mockResolvedValue(orquestacion([tarea('a'), tarea('b')], [arista('a', 'b')]))
    await startRun(CLIENTE, ORQ, {}, entorno.ms)
    await avanzar()

    const run = await cancelRun(CLIENTE, ORQ, entorno.ms)

    expect(run.nodes.a.status).toBe('cancelled')
    expect(run.nodes.b.status).toBe('skipped')
    expect(run.nodes.b.finishedAt).toBe(new Date(entorno.ms).toISOString())
    // Solo se le pide a CI-DS que corte lo que de verdad estaba corriendo.
    expect(runCidsOperation.mock.calls.filter(([{ operation }]) => operation === 'cancelTask')).toHaveLength(1)
  })

  it('en un grupo, los hijos que corrían se cancelan y los pendientes se omiten', async () => {
    getOrchestration.mockResolvedValue(orquestacion(
      [grupo('g'), tarea('h1', {}, 'g'), tarea('h2', {}, 'g'), tarea('post')],
      [arista('h1', 'h2'), arista('g', 'post')],
    ))
    await startRun(CLIENTE, ORQ, {}, entorno.ms)
    await avanzar()
    await avanzar()

    const run = await cancelRun(CLIENTE, ORQ, entorno.ms)

    expect(run.nodes.g.status).toBe('cancelled')
    expect(run.nodes.g.children.h1.status).toBe('cancelled')
    expect(run.nodes.g.children.h2.status).toBe('skipped')
    expect(run.nodes.post.status).toBe('skipped')
  })

  it('un grupo que no había arrancado queda omitido con sus hijos', async () => {
    getOrchestration.mockResolvedValue(orquestacion(
      [tarea('a'), grupo('g'), tarea('h1', {}, 'g')],
      [arista('a', 'g')],
    ))
    await startRun(CLIENTE, ORQ, {}, entorno.ms)
    await avanzar()

    const run = await cancelRun(CLIENTE, ORQ, entorno.ms)

    expect(run.nodes.g.status).toBe('skipped')
    expect(run.nodes.g.children.h1.status).toBe('skipped')
  })

  // Un paso que espera su reintento está «pendiente»: tampoco llegó a correr de nuevo.
  it('un paso que esperaba su reintento queda omitido', async () => {
    getOrchestration.mockResolvedValue(orquestacion(
      [tarea('a', { errorStrategy: 'retry', maxRetries: 1, retryDelaySeconds: 60 })],
    ))
    await startRun(CLIENTE, ORQ, {}, entorno.ms)
    await avanzar()
    sapResponde({ estados: { 101: { statusCode: 'ERROR' } } })
    expect((await avanzar()).nodes.a.status).toBe('pending')

    expect((await cancelRun(CLIENTE, ORQ, entorno.ms)).nodes.a.status).toBe('skipped')
  })

  it('una ejecución cortada se puede retomar: lo omitido vuelve a pendiente', async () => {
    getOrchestration.mockResolvedValue(orquestacion([tarea('a'), tarea('b')], [arista('a', 'b')]))
    await startRun(CLIENTE, ORQ, {}, entorno.ms)
    await avanzar()
    await cancelRun(CLIENTE, ORQ, entorno.ms)

    const run = await resumeRun(CLIENTE, ORQ)

    expect(run.status).toBe('running')
    expect(run.nodes.a.status).toBe('pending')
    expect(run.nodes.b.status).toBe('pending')
  })

  describe('si una vuelta tiene el cerrojo', () => {
    const lock = `c:${CLIENTE}:orch-run-lock:${ORQ}`

    async function arrancarYAvanzar() {
      getOrchestration.mockResolvedValue(orquestacion([tarea('a')]))
      await startRun(CLIENTE, ORQ, {}, entorno.ms)
      await avanzar()
    }

    it('reintenta con 500 ms de espera y corta en cuanto lo consigue', async () => {
      await arrancarYAvanzar()
      await entorno.redis.set(lock, 'de-otro', { ex: RUN_LOCK_SECONDS })
      // La vuelta suelta el cerrojo durante la tercera espera.
      const esperar = vi.fn(async () => {
        if (esperar.mock.calls.length === 3) await entorno.redis.del(lock)
      })

      const run = await cancelRun(CLIENTE, ORQ, entorno.ms, { esperar })

      expect(run.status).toBe('cancelled')
      expect(esperar).toHaveBeenCalledTimes(3)
      expect(esperar).toHaveBeenCalledWith(ESPERA_ENTRE_INTENTOS_DE_CORTAR_MS)
      expect(ESPERA_ENTRE_INTENTOS_DE_CORTAR_MS).toBe(500)
    })

    it('se rinde tras 5 intentos y lo dice, sin dar la ejecución por cortada', async () => {
      await arrancarYAvanzar()
      await entorno.redis.set(lock, 'de-otro', { ex: RUN_LOCK_SECONDS })
      const esperar = vi.fn(async () => {})

      await expect(cancelRun(CLIENTE, ORQ, entorno.ms, { esperar })).rejects.toThrow(/está avanzando en este momento/)

      // Cinco intentos, cuatro esperas entre ellos.
      expect(esperar).toHaveBeenCalledTimes(4)
      expect((await getRun(CLIENTE, ORQ)).status).toBe('running')
    })

    it('sin cerrojo ocupado no espera nada', async () => {
      await arrancarYAvanzar()
      const esperar = vi.fn()
      await cancelRun(CLIENTE, ORQ, entorno.ms, { esperar })
      expect(esperar).not.toHaveBeenCalled()
    })
  })

  it('cancelar una ya terminada no cambia nada', async () => {
    getOrchestration.mockResolvedValue(orquestacion([tarea('a')]))
    await startRun(CLIENTE, ORQ, {}, entorno.ms)
    await avanzar()
    sapResponde({ estados: { 101: { statusCode: 'SUCCESS' } } })
    await avanzar()

    const run = await cancelRun(CLIENTE, ORQ, entorno.ms)
    expect(run.status).toBe('success')
  })
})
