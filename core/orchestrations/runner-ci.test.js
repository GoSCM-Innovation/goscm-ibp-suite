// El motor con el adaptador de CI Tools: pasos que ejecutan una integración de CPI y esperan su respuesta.
//
// Lo que se prueba aquí es lo que distingue a este adaptador de los de CI-DS e IBP, y que no se puede
// dejar al azar porque cada error es una carga a IBP duplicada o perdida:
//
//   - el estado se guarda ANTES de enviar (si la función muere a mitad, el paso queda «en marcha», no «pendiente»);
//   - un paso que quedó «en marcha» sin respuesta se lee como «sin confirmar» y NO se vuelve a enviar;
//   - una carga que quedó en duda no se reintenta sola, aunque la estrategia sea «reintentar»;
//   - lo que viene detrás de una carga fallida no corre.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInMemoryRedis } from '../persistence/redis-in-memory.js'
import { RUN_LOCK_SINCRONO_SECONDS, getRun, resumeRun, startRun, tickRun } from './runner.js'
import { getOrchestration } from './orchestrations.js'
import { executeIntegration } from '../ci/execute.js'

const entorno = vi.hoisted(() => ({ ms: Date.UTC(2026, 9, 14, 12, 0, 0), redis: null }))

vi.mock('../persistence/redis.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getRedis: () => entorno.redis }
})
vi.mock('./orchestrations.js', () => ({ getOrchestration: vi.fn() }))
vi.mock('../ci/execute.js', () => ({ executeIntegration: vi.fn() }))
vi.mock('../connections/index.js', () => ({
  getConnectionTarget: vi.fn(async () => ({ kind: 'ci', baseUrl: 'https://cpi' })),
  getCredentials: vi.fn(async () => ({ user: 'u', password: 'p' })),
}))
vi.mock('../cids/operations.js', () => ({ runCidsOperation: vi.fn() }))

const CLIENTE = 'c-1'
const ORQ = 'orq-1'

const paso = (id, data = {}) => ({ id, type: 'task', data: { integrationId: `int-${id}`, label: id, ...data } })
const arista = (desde, hasta) => ({ id: `e-${desde}-${hasta}`, source: desde, target: hasta })
const orquestacion = (nodes, edges = []) => ({
  id: ORQ, connectionId: 'conn-1', production: false, name: 'Cargas', nodes, edges,
})

const exito = (extra = {}) => ({
  runId: 'r', nombre: 'x', resultado: 'success', enviado: true, httpStatus: 200, duracionMs: 21_000, mplId: null, mensaje: 'OK', ...extra,
})
const fallo = (extra = {}) => ({
  runId: 'r', nombre: 'x', resultado: 'error', enviado: true, httpStatus: 500, duracionMs: 3_000, mplId: 'MPL-1', mensaje: 'boom', ...extra,
})
const duda = (extra = {}) => ({
  runId: 'r', nombre: 'x', resultado: 'unconfirmed', enviado: true, httpStatus: null, duracionMs: 270_000, mplId: null, mensaje: 'sin respuesta', ...extra,
})

const avanzar = () => tickRun(CLIENTE, ORQ, entorno.ms)
const arrancar = (nodes, edges, defaults = { variables: { FECHA: '20261014' }, startedBy: { id: 'u-1', email: 'a@x.com' } }) => {
  getOrchestration.mockResolvedValue(orquestacion(nodes, edges))
  return startRun(CLIENTE, ORQ, { defaults }, entorno.ms)
}

/**
 * Un Redis que guarda COPIAS, como el de verdad. El doble de pruebas guarda la referencia, y con ella lo
 * «guardado» cambia solo cuando el motor modifica el objeto en memoria: no se podría distinguir lo que quedó
 * guardado antes de enviar de lo que se guardó al final, que es justo lo que estas pruebas miran.
 */
function redisConCopias(opciones) {
  const base = createInMemoryRedis(opciones)
  const copia = (valor) => (valor !== null && typeof valor === 'object' && !(valor instanceof Set) ? structuredClone(valor) : valor)
  return {
    ...base,
    set: (clave, valor, extra) => base.set(clave, copia(valor), extra),
    get: async (clave) => copia(await base.get(clave)),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  entorno.ms = Date.UTC(2026, 9, 14, 12, 0, 0)
  entorno.redis = redisConCopias({ now: () => entorno.ms })
  executeIntegration.mockResolvedValue(exito())
})

describe('un paso exitoso', () => {
  it('se envía en la primera vuelta y queda completado con lo que contestó CPI', async () => {
    await arrancar([paso('a')])
    const run = await avanzar()

    expect(executeIntegration).toHaveBeenCalledTimes(1)
    expect(run.nodes.a).toMatchObject({ status: 'success', sapStatusCode: 'SUCCESS' })
    expect(run.nodes.a.detalle).toMatchObject({ httpStatus: 200, sinConfirmar: false })
    expect(run.status).toBe('success')
  })

  it('le pasa a la integración el cliente, la conexión, las variables y quién lanzó', async () => {
    await arrancar([paso('a')])
    await avanzar()

    expect(executeIntegration).toHaveBeenCalledWith(expect.objectContaining({
      clientId: CLIENTE,
      connectionId: 'conn-1',
      integrationId: 'int-a',
      variables: { FECHA: '20261014' },
      origin: 'orchestration',
      orchestrationId: ORQ,
      user: { id: 'u-1', email: 'a@x.com' },
    }))
  })

  // El fin del paso es el comienzo de la vuelta más lo que duró la llamada.
  it('anota la duración de la llamada, no la espera de la vuelta', async () => {
    await arrancar([paso('a')])
    const run = await avanzar()
    expect(Date.parse(run.nodes.a.finishedAt) - Date.parse(run.nodes.a.startedAt)).toBe(21_000)
  })

  it('el identificador del paso es el de la ejecución anotada en el historial', async () => {
    await arrancar([paso('a')])
    await avanzar()
    const { runId } = executeIntegration.mock.calls[0][0]
    expect(runId).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('guardar antes de enviar', () => {
  it('cuando se envía, lo guardado ya dice «en marcha»', async () => {
    await arrancar([paso('a')])

    let guardadoAlEnviar
    executeIntegration.mockImplementation(async () => {
      guardadoAlEnviar = await getRun(CLIENTE, ORQ)
      return exito()
    })
    await avanzar()

    expect(guardadoAlEnviar.nodes.a.status).toBe('running')
    expect(guardadoAlEnviar.nodes.a.sapRunId).toBeTruthy()
  })

  // Si guardar falla, no se envía nada: lo marcado en memoria se pierde y el paso sigue pendiente en lo guardado.
  it('si no se puede guardar, no se envía nada', async () => {
    await arrancar([paso('a')])
    const original = entorno.redis.set
    entorno.redis.set = vi.fn(async (clave, ...resto) => {
      if (String(clave).includes('orch-run:')) throw new Error('Redis caído')
      return original(clave, ...resto)
    })

    await expect(avanzar()).rejects.toThrow(/Redis caído/)
    expect(executeIntegration).not.toHaveBeenCalled()
    entorno.redis.set = original
    expect((await getRun(CLIENTE, ORQ)).nodes.a.status).toBe('pending')
  })

  it('el cerrojo de la vuelta dura lo que la espera, no los 15 s de siempre', async () => {
    await arrancar([paso('a')])
    let ttl
    executeIntegration.mockImplementation(async () => {
      ttl = await entorno.redis.ttl(`c:${CLIENTE}:orch-run-lock:${ORQ}`)
      return exito()
    })
    await avanzar()
    expect(ttl).toBeGreaterThan(15)
    expect(ttl).toBeLessThanOrEqual(RUN_LOCK_SINCRONO_SECONDS)
  })
})

describe('una vuelta que murió a mitad de un envío', () => {
  /** Deja la ejecución como la dejaría una función que murió justo después de guardar «en marcha». */
  async function conPasoEnMarcha() {
    await arrancar([paso('a'), paso('b')], [arista('a', 'b')])
    executeIntegration.mockImplementation(async () => { throw new Error('la función murió') })
    // Una vuelta cuyo ejecutar lanza: el paso queda en duda. Para simular la MUERTE se pone el estado a mano.
    const run = await getRun(CLIENTE, ORQ)
    run.nodes.a = { ...run.nodes.a, status: 'running', sapRunId: 'huerfano', startedAt: new Date(entorno.ms).toISOString() }
    await entorno.redis.set(`c:${CLIENTE}:orch-run:${ORQ}`, run)
    executeIntegration.mockReset()
    executeIntegration.mockResolvedValue(exito())
  }

  it('el paso se lee «sin confirmar» y NO se vuelve a enviar', async () => {
    await conPasoEnMarcha()
    const run = await avanzar()

    expect(executeIntegration).not.toHaveBeenCalled()
    expect(run.nodes.a.status).toBe('error')
    expect(run.nodes.a.error).toMatch(/Sin confirmar/)
    expect(run.nodes.a.detalle.sinConfirmar).toBe(true)
  })

  it('lo que viene detrás no corre', async () => {
    await conPasoEnMarcha()
    const run = await avanzar()
    expect(run.nodes.b.status).toBe('skipped')
    expect(run.status).toBe('error')
  })
})

describe('un paso fallado', () => {
  it('con «detener»: queda en error con el código y el MPL ID, y lo siguiente se saltea', async () => {
    executeIntegration.mockResolvedValue(fallo())
    await arrancar([paso('a'), paso('b')], [arista('a', 'b')])

    let run = await avanzar()
    expect(run.nodes.a).toMatchObject({ status: 'error' })
    expect(run.nodes.a.error).toBe('HTTP 500: boom')
    expect(run.nodes.a.detalle).toMatchObject({ httpStatus: 500, mplId: 'MPL-1' })

    run = await avanzar()
    expect(run.nodes.b.status).toBe('skipped')
    expect(executeIntegration).toHaveBeenCalledTimes(1)
  })

  it('con «continuar»: lo siguiente corre, pero la ejecución termina en error', async () => {
    executeIntegration
      .mockResolvedValueOnce(fallo())
      .mockResolvedValueOnce(exito())
    await arrancar([paso('a', { errorStrategy: 'continue' }), paso('b')], [arista('a', 'b')])

    await avanzar()
    const run = await avanzar()
    expect(run.nodes.b.status).toBe('success')
    // Decir que salió bien cuando una carga falló sería mentir.
    expect(run.status).toBe('error')
  })

  it('con «reintentar»: espera y vuelve a enviar, y si agota los intentos para la cadena', async () => {
    executeIntegration.mockResolvedValue(fallo())
    await arrancar([paso('a', { errorStrategy: 'retry', maxRetries: 1, retryDelaySeconds: 30 }), paso('b')], [arista('a', 'b')])

    let run = await avanzar()
    expect(run.nodes.a).toMatchObject({ status: 'pending', retryCount: 1 })
    expect(run.nodes.a.error).toMatch(/HTTP 500: boom \(intento 1\/1\)/)

    // Antes de la espera no se vuelve a enviar.
    run = await avanzar()
    expect(executeIntegration).toHaveBeenCalledTimes(1)

    // La espera cuenta desde que terminó la llamada (3 s después del comienzo de la vuelta) y dura 30 s.
    entorno.ms += 34_000
    run = await avanzar()
    expect(executeIntegration).toHaveBeenCalledTimes(2)
    expect(run.nodes.a.status).toBe('error')

    // Agotados los intentos, lo de detrás no corre (política de CI).
    run = await avanzar()
    expect(run.nodes.b.status).toBe('skipped')
  })
})

describe('una carga en duda NO se reintenta sola', () => {
  it('aunque la estrategia sea «reintentar», queda en error y se envía una sola vez', async () => {
    executeIntegration.mockResolvedValue(duda())
    await arrancar([paso('a', { errorStrategy: 'retry', maxRetries: 3, retryDelaySeconds: 10 })])

    let run = await avanzar()
    expect(run.nodes.a.status).toBe('error')
    expect(run.nodes.a.detalle.sinConfirmar).toBe(true)

    entorno.ms += 3_600_000
    run = await avanzar()
    expect(executeIntegration).toHaveBeenCalledTimes(1)
  })

  it('si `ejecutar` lanza, se trata igual: no se sabe si salió', async () => {
    executeIntegration.mockRejectedValue(new Error('algo inesperado'))
    await arrancar([paso('a', { errorStrategy: 'retry', maxRetries: 3, retryDelaySeconds: 10 })])

    const run = await avanzar()
    expect(run.nodes.a.status).toBe('error')
    expect(run.nodes.a.error).toBe('algo inesperado')
    expect(executeIntegration).toHaveBeenCalledTimes(1)
  })
})

describe('pasos en paralelo y en fila', () => {
  it('dos pasos sin dependencia se envían en la misma vuelta, con el estado ya guardado de los dos', async () => {
    await arrancar([paso('a'), paso('b')])

    const vistos = []
    executeIntegration.mockImplementation(async () => {
      const guardado = await getRun(CLIENTE, ORQ)
      vistos.push([guardado.nodes.a.status, guardado.nodes.b.status])
      return exito()
    })
    const run = await avanzar()

    expect(executeIntegration).toHaveBeenCalledTimes(2)
    // Los dos estaban «en marcha» en lo guardado cuando salió el primero.
    expect(vistos[0]).toEqual(['running', 'running'])
    expect(run.status).toBe('success')
  })

  it('en fila, cada paso espera al anterior: uno por vuelta', async () => {
    await arrancar([paso('a'), paso('b'), paso('c')], [arista('a', 'b'), arista('b', 'c')])

    let run = await avanzar()
    expect(executeIntegration).toHaveBeenCalledTimes(1)
    expect(run.nodes.b.status).toBe('pending')

    run = await avanzar()
    expect(executeIntegration).toHaveBeenCalledTimes(2)
    run = await avanzar()
    expect(executeIntegration).toHaveBeenCalledTimes(3)
    expect(run.status).toBe('success')
    expect(executeIntegration.mock.calls.map(([datos]) => datos.integrationId)).toEqual(['int-a', 'int-b', 'int-c'])
  })

  it('un paso que falla no impide que termine el que corría en paralelo', async () => {
    executeIntegration
      .mockResolvedValueOnce(fallo())
      .mockResolvedValueOnce(exito())
    await arrancar([paso('a'), paso('b')])

    const run = await avanzar()
    expect([run.nodes.a.status, run.nodes.b.status].sort()).toEqual(['error', 'success'])
    expect(run.status).toBe('error')
  })
})

describe('un paso sin integración', () => {
  it('falla ese paso sin enviar nada', async () => {
    await arrancar([{ id: 'a', type: 'task', data: { label: 'a' } }])
    const run = await avanzar()

    expect(executeIntegration).not.toHaveBeenCalled()
    expect(run.nodes.a.status).toBe('error')
    expect(run.nodes.a.error).toMatch(/qué integración/)
  })
})

// Un grupo paralelo de CI Tools: varias integraciones que corren a la vez y que lo de detrás espera entero.
describe('grupos paralelos', () => {
  const grupo = (id, data = {}) => ({ id, type: 'group', data: { label: '', errorStrategy: 'stop', ...data } })
  const hijo = (id, padre, data = {}) => ({ ...paso(id, data), parentId: padre })
  const enviadas = () => executeIntegration.mock.calls.map(([datos]) => datos.integrationId)

  /** a, un grupo con b y c, y d detrás: lo que dibuja la pantalla con un grupo en medio. */
  const conGrupo = (datosDelGrupo = {}, datosDeB = {}) => arrancar(
    [paso('a'), grupo('g', datosDelGrupo), hijo('b', 'g', datosDeB), hijo('c', 'g'), paso('d')],
    [arista('a', 'g'), arista('g', 'd')],
  )

  it('las integraciones del grupo se envían en la misma vuelta, con lo guardado ya en marcha, y lo de detrás espera al grupo entero', async () => {
    await conGrupo()

    await avanzar()
    expect(enviadas()).toEqual(['int-a'])
    // Arranca el grupo: sus integraciones empiezan en la vuelta siguiente.
    let run = await avanzar()
    expect(run.nodes.g.status).toBe('running')
    expect(enviadas()).toEqual(['int-a'])

    const vistos = []
    executeIntegration.mockImplementation(async () => {
      const guardado = await getRun(CLIENTE, ORQ)
      vistos.push([guardado.nodes.g.children.b.status, guardado.nodes.g.children.c.status])
      return exito()
    })
    run = await avanzar()

    expect(enviadas()).toEqual(['int-a', 'int-b', 'int-c', 'int-d'])
    // Las dos del grupo estaban «en marcha» en lo guardado cuando salió la primera.
    expect(vistos[0]).toEqual(['running', 'running'])
    expect(run.nodes.g.status).toBe('success')
    expect(run.status).toBe('success')
  })

  it('con una integración del grupo fallada, el grupo falla y lo de detrás no corre (el grupo detiene)', async () => {
    executeIntegration.mockImplementation(async ({ integrationId }) => (integrationId === 'int-b' ? fallo() : exito()))
    await conGrupo()
    await avanzar()
    await avanzar()
    let run = await avanzar()

    expect(run.nodes.g.status).toBe('error')
    expect(run.nodes.g.children.b.status).toBe('error')
    expect(run.nodes.g.children.c.status).toBe('success')
    run = await avanzar()
    expect(run.nodes.d.status).toBe('skipped')
    expect(enviadas()).not.toContain('int-d')
    expect(run.status).toBe('error')
  })

  it('con «continuar» en el grupo, lo de detrás corre aunque una integración haya fallado, y la ejecución termina en error', async () => {
    executeIntegration.mockImplementation(async ({ integrationId }) => (integrationId === 'int-b' ? fallo() : exito()))
    await conGrupo({ errorStrategy: 'continue' })
    await avanzar()
    await avanzar()
    await avanzar()
    const run = await avanzar()

    expect(enviadas()).toContain('int-d')
    expect(run.nodes.d.status).toBe('success')
    // Decir que salió bien cuando una carga falló sería mentir.
    expect(run.status).toBe('error')
  })

  // «Completada con advertencias» no es un fallo: no detiene al grupo ni a lo de detrás.
  it('una integración con advertencias no detiene al grupo', async () => {
    executeIntegration.mockImplementation(async ({ integrationId }) => (
      integrationId === 'int-b' ? exito({ resultado: 'warning', httpStatus: 500, mplId: 'MPL-9', mensaje: 'rechazó un registro' }) : exito()
    ))
    await conGrupo()
    await avanzar()
    await avanzar()
    await avanzar()
    const run = await avanzar()

    expect(run.nodes.g.children.b.status).toBe('success_with_errors')
    expect(run.nodes.g.status).toBe('success')
    expect(run.nodes.d.status).toBe('success')
    expect(run.status).toBe('success')
  })

  it('retomar solo vuelve a enviar lo que falló dentro del grupo: lo que ya cargó no se repite', async () => {
    executeIntegration.mockImplementation(async ({ integrationId }) => (integrationId === 'int-c' ? fallo() : exito()))
    await conGrupo()
    await avanzar()
    await avanzar()
    await avanzar()
    await avanzar()
    expect((await getRun(CLIENTE, ORQ)).status).toBe('error')

    executeIntegration.mockReset()
    executeIntegration.mockResolvedValue(exito())
    await resumeRun(CLIENTE, ORQ)
    let run = await getRun(CLIENTE, ORQ)
    expect(run.nodes.g.children.b.status).toBe('success')
    expect(run.nodes.g.children.c.status).toBe('pending')

    for (let i = 0; i < 4; i += 1) run = await avanzar()
    // `a` y `b` ya habían salido bien: solo se envían `c` y lo que estaba detrás del grupo.
    expect(enviadas()).toEqual(['int-c', 'int-d'])
    expect(run.status).toBe('success')
  })

  it('un grupo vacío termina en el acto y no frena a lo de detrás', async () => {
    await arrancar([paso('a'), grupo('g'), paso('d')], [arista('a', 'g'), arista('g', 'd')])
    let run
    for (let i = 0; i < 4; i += 1) run = await avanzar()

    expect(run.nodes.g.status).toBe('success')
    expect(enviadas()).toEqual(['int-a', 'int-d'])
    expect(run.status).toBe('success')
  })
})
