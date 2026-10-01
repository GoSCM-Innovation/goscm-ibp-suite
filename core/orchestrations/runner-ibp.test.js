// El motor con una conexión de IBP: las reglas del orquestador de v8 (`useOrchRun.js`).
//
// Va aparte de `runner.test.js` porque allí la conexión es de CI-DS para todo el archivo, y esas
// pruebas son justamente las que demuestran que CI-DS sigue portándose como v9.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryRedis } from '../persistence/redis-in-memory.js'
import { cancelRun, startRun, tickRun } from './runner.js'
import { getOrchestration } from './orchestrations.js'
import { scheduleJob } from '../ibp/job-schedule.js'
import { cancelJobRun, readJobRun } from '../ibp/job-runs.js'

const entorno = vi.hoisted(() => ({ ms: Date.UTC(2026, 7, 4, 12, 0, 0), redis: null }))

vi.mock('../persistence/redis.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getRedis: () => entorno.redis }
})
vi.mock('./orchestrations.js', () => ({ getOrchestration: vi.fn() }))
vi.mock('../cids/operations.js', () => ({ runCidsOperation: vi.fn() }))
vi.mock('../connections/index.js', () => ({
  getConnectionTarget: vi.fn(async () => ({ kind: 'ibp', baseUrl: 'https://ibp' })),
  getCredentials: vi.fn(async () => ({ user: 'COMM_USER', password: 'p' })),
}))
vi.mock('../ibp/job-schedule.js', () => ({ scheduleJob: vi.fn() }))
vi.mock('../ibp/job-runs.js', () => ({
  readJobRun: vi.fn(),
  cancelJobRun: vi.fn(),
  readLatestTemplateRun: vi.fn(),
}))

const CLIENTE = 'c-1'
const ORQ = 'orq-ibp'

const paso = (id, data = {}, parentId) => ({
  id,
  type: 'task',
  data: { templateName: id.toUpperCase(), errorStrategy: 'stop', maxRetries: 3, retryDelaySeconds: 60, ...data },
  ...(parentId ? { parentId } : {}),
})
const grupo = (id, data = {}) => ({ id, type: 'group', data: { errorStrategy: 'stop', ...data } })

/** La forma de v8: los pasos de primer nivel, en cadena. */
function cadena(...nodos) {
  const primerNivel = nodos.filter((nodo) => !nodo.parentId)
  const edges = primerNivel.slice(0, -1).map((nodo, i) => ({
    id: `e-${nodo.id}-${primerNivel[i + 1].id}`, source: nodo.id, target: primerNivel[i + 1].id,
  }))
  return { id: ORQ, connectionId: 'conn-ibp', production: false, name: 'Cierre', nodes: nodos, edges }
}

/** Qué letra devuelve SAP para cada trabajo, por nombre técnico. */
let letras = {}
let lanzados = 0

beforeEach(() => {
  vi.clearAllMocks()
  entorno.ms = Date.UTC(2026, 7, 4, 12, 0, 0)
  entorno.redis = createInMemoryRedis({ now: () => entorno.ms })
  letras = {}
  lanzados = 0
  // Cada trabajo se llama como su plantilla y un contador: «A-1», «B-2»…
  scheduleJob.mockImplementation(async ({ templateName }) => {
    lanzados += 1
    return { ok: true, jobName: `${templateName}-${lanzados}`, jobRunCount: '1' }
  })
  readJobRun.mockImplementation(async ({ jobName }) => (
    letras[jobName] ? { JobName: jobName, JobRunCount: '1', JobStatus: letras[jobName] } : null
  ))
})

const avanzar = () => tickRun(CLIENTE, ORQ, entorno.ms)
const arrancar = async (orquestacion) => {
  getOrchestration.mockResolvedValue(orquestacion)
  await startRun(CLIENTE, ORQ, {}, entorno.ms)
  return avanzar()
}

describe('el motor con IBP', () => {
  it('lanza con el usuario de comunicación y guarda la letra de SAP en el paso', async () => {
    await arrancar(cadena(paso('a')))
    expect(scheduleJob.mock.calls[0][0].jobUser).toBe('COMM_USER')

    letras['A-1'] = 'R'
    const run = await avanzar()
    expect(run.nodes.a).toMatchObject({ status: 'running', sapStatus: 'R', sapRunId: 'A-1|1' })
  })

  it('los pasos corren en el orden de la lista', async () => {
    const primera = await arrancar(cadena(paso('a'), paso('b')))
    expect(primera.nodes.b.status).toBe('pending')

    letras['A-1'] = 'F'
    const segunda = await avanzar()
    expect(segunda.nodes.a.status).toBe('success')
    expect(segunda.nodes.b.status).toBe('running')
  })

  it('terminado con avisos (W) queda «con advertencias» y la cadena sigue', async () => {
    await arrancar(cadena(paso('a'), paso('b')))
    letras['A-1'] = 'W'
    const run = await avanzar()
    expect(run.nodes.a.status).toBe('success_with_errors')
    expect(run.nodes.b.status).toBe('running')
  })

  // v8: un trabajo cancelado en SAP no es un error; el paso queda «Cancelado» y se sigue.
  it('un trabajo cancelado (C) deja el paso cancelado y la cadena SIGUE', async () => {
    await arrancar(cadena(paso('a'), paso('b')))
    letras['A-1'] = 'C'
    const run = await avanzar()
    expect(run.nodes.a).toMatchObject({ status: 'cancelled', error: 'SAP: C' })
    expect(run.nodes.b.status).toBe('running')

    letras['B-2'] = 'F'
    expect((await avanzar()).status).toBe('success')
  })

  it('desconocido (X) y por saltar (k) no son finales: se sigue preguntando', async () => {
    await arrancar(cadena(paso('a')))
    letras['A-1'] = 'X'
    expect((await avanzar()).nodes.a.status).toBe('running')
    letras['A-1'] = 'k'
    expect((await avanzar()).nodes.a.status).toBe('running')
  })

  it('saltado (K) es un error y, con «Detener si falla», saltea lo que viene detrás', async () => {
    await arrancar(cadena(paso('a'), paso('b')))
    letras['A-1'] = 'K'
    const run = await avanzar()
    expect(run.nodes.a.status).toBe('error')
    expect(run.nodes.b.status).toBe('skipped')
    expect(run.status).toBe('error')
  })

  // v8: «Continuar si falla» sigue y la ejecución termina «Completado».
  it('un fallo con «Continuar si falla» no deja fallada la ejecución', async () => {
    await arrancar(cadena(paso('a', { errorStrategy: 'continue' }), paso('b')))
    letras['A-1'] = 'A'
    const run = await avanzar()
    expect(run.nodes.a.status).toBe('error')
    expect(run.nodes.b.status).toBe('running')

    letras['B-2'] = 'F'
    expect((await avanzar()).status).toBe('success')
  })

  // v8: agotar los reintentos PARA la cadena.
  it('agotados los reintentos, la cadena se detiene', async () => {
    await arrancar(cadena(paso('a', { errorStrategy: 'retry', maxRetries: 1, retryDelaySeconds: 10 }), paso('b')))
    letras['A-1'] = 'A'
    const tras = await avanzar()
    expect(tras.nodes.a).toMatchObject({ status: 'pending', retryCount: 1, error: 'Reintentando 1/1…' })

    entorno.ms += 10_000
    const relanzado = await avanzar()
    expect(relanzado.nodes.a).toMatchObject({ status: 'running', sapRunId: 'A-2|1', sapStatus: null })

    letras['A-2'] = 'A'
    const final = await avanzar()
    expect(final.nodes.a.status).toBe('error')
    expect(final.nodes.b.status).toBe('skipped')
    expect(final.status).toBe('error')
  })

  describe('grupos', () => {
    const conGrupo = () => cadena(grupo('g'), paso('x', {}, 'g'), paso('y', {}, 'g'), paso('c'))

    it('los hijos corren a la vez', async () => {
      await arrancar(conGrupo())
      const run = await avanzar()
      expect(run.nodes.g.children.x.status).toBe('running')
      expect(run.nodes.g.children.y.status).toBe('running')
    })

    it('un hijo cancelado deja cancelado al grupo, y la cadena sigue', async () => {
      await arrancar(conGrupo())
      await avanzar()
      letras['X-1'] = 'C'
      letras['Y-2'] = 'F'
      const run = await avanzar()
      expect(run.nodes.g.status).toBe('cancelled')
      expect(run.nodes.c.status).toBe('running')
    })

    it('un hijo fallado deja fallado al grupo y, con «Detener», se para', async () => {
      await arrancar(conGrupo())
      await avanzar()
      letras['X-1'] = 'A'
      letras['Y-2'] = 'F'
      const run = await avanzar()
      expect(run.nodes.g.status).toBe('error')
      expect(run.nodes.c.status).toBe('skipped')
      expect(run.status).toBe('error')
    })
  })

  // v8 solo dejaba de preguntar: no le pedía nada a SAP.
  it('cortar no le pide a SAP que cancele nada', async () => {
    await arrancar(cadena(paso('a')))
    const run = await cancelRun(CLIENTE, ORQ, entorno.ms)
    expect(run.status).toBe('cancelled')
    expect(run.nodes.a.status).toBe('cancelled')
    expect(cancelJobRun).not.toHaveBeenCalled()
  })

  // Sin repetición se pregunta por el nombre; el paso no puede quedarse «En ejecución» para siempre.
  it('un trabajo lanzado sin repetición se sigue y gana la repetición al contarla SAP', async () => {
    scheduleJob.mockImplementationOnce(async () => ({ ok: true, jobName: 'SIN-1', jobRunCount: '' }))
    await arrancar(cadena(paso('a')))
    readJobRun.mockImplementationOnce(async () => ({ JobName: 'SIN-1', JobRunCount: '5', JobStatus: 'F' }))

    const run = await avanzar()
    expect(readJobRun.mock.calls.at(-1)[0]).toMatchObject({ jobName: 'SIN-1', jobRunCount: '' })
    expect(run.nodes.a).toMatchObject({ status: 'success', sapRunId: 'SIN-1|5', sapStatus: 'F' })
  })
})
