import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryRedis } from '../persistence/redis-in-memory.js'
import {
  PROMOTED_CACHE_SECONDS,
  PROMOTED_CONCURRENCY,
  forgetPromotedTaskNames,
  getPromotedTaskNames,
  normalizeTaskName,
} from './promoted-tasks.js'
import { getCidsTarget } from './session.js'
import { runCidsOperation } from './operations.js'

const entorno = vi.hoisted(() => ({ ms: 1_700_000_000_000, redis: null }))

vi.mock('../persistence/redis.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getRedis: () => entorno.redis }
})

vi.mock('./session.js', () => ({ getCidsTarget: vi.fn() }))
vi.mock('./operations.js', () => ({ runCidsOperation: vi.fn() }))

const CLIENTE = 'c-1'
const PRUEBAS = 'conn-qa'

// Una sola conexión: el repositorio productivo es el de ella misma, con otra bandera en el logon.
const DESTINO_QA = { id: PRUEBAS, kind: 'cids', name: 'CI-DS' }

/** Responde getProjects y getProjectTasks con un tenant de dos proyectos. */
function tenantConDosProyectos() {
  runCidsOperation.mockImplementation(async ({ operation, params }) => {
    if (operation === 'getProjects') {
      return [{ name: 'Ventas', guid: 'p-1' }, { name: 'Compras', guid: 'p-2' }]
    }
    if (operation === 'getProjectTasks') {
      return params.projectGuid === 'p-1'
        ? [{ taskName: 'carga_diaria' }, { taskName: 'CARGA_MENSUAL' }]
        : [{ taskName: ' maestros ' }]
    }
    return null
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  entorno.ms = 1_700_000_000_000
  entorno.redis = createInMemoryRedis({ now: () => entorno.ms })
  getCidsTarget.mockResolvedValue(DESTINO_QA)
})

describe('normalizeTaskName', () => {
  it('compara sin espacios en las puntas y en mayúsculas', () => {
    expect(normalizeTaskName('  carga_diaria ')).toBe('CARGA_DIARIA')
    expect(normalizeTaskName(null)).toBe('')
  })
})

describe('getPromotedTaskNames', () => {
  it('junta las tareas de todos los proyectos del tenant productivo, normalizadas', async () => {
    tenantConDosProyectos()

    expect(await getPromotedTaskNames(CLIENTE, PRUEBAS)).toEqual(['CARGA_DIARIA', 'CARGA_MENSUAL', 'MAESTROS'])
  })

  // El punto de todo el modulo: es la MISMA conexion, pedida con la bandera del logon puesta.
  it('consulta la misma conexión pero contra el repositorio productivo', async () => {
    tenantConDosProyectos()

    await getPromotedTaskNames(CLIENTE, PRUEBAS)

    expect(runCidsOperation).toHaveBeenCalled()
    for (const [argumentos] of runCidsOperation.mock.calls) {
      expect(argumentos.connectionId).toBe(PRUEBAS)
      expect(argumentos.production).toBe(true)
    }
  })

  // La diferencia entre "no aplica" y "ninguna está transportada" importa: con una lista vacía la
  // interfaz afirmaría algo que no sabe.
  it('devuelve null si ya se está mirando el repositorio productivo', async () => {
    expect(await getPromotedTaskNames(CLIENTE, PRUEBAS, { production: true })).toBeNull()
    expect(runCidsOperation).not.toHaveBeenCalled()
  })

  // La marca de la conexión no decide nada: lo que decide es qué repositorio se está mirando.
  it('no mira la marca de la conexión', async () => {
    getCidsTarget.mockResolvedValue({ ...DESTINO_QA, isProduction: true })
    tenantConDosProyectos()

    expect(await getPromotedTaskNames(CLIENTE, PRUEBAS)).toEqual(['CARGA_DIARIA', 'CARGA_MENSUAL', 'MAESTROS'])
  })

  it('descarta un proyecto cuya consulta falla y se queda con los demás', async () => {
    runCidsOperation.mockImplementation(async ({ operation, params }) => {
      if (operation === 'getProjects') return [{ guid: 'p-1' }, { guid: 'p-2' }]
      if (params.projectGuid === 'p-1') throw new Error('SAP dijo que no')
      return [{ taskName: 'MAESTROS' }]
    })

    expect(await getPromotedTaskNames(CLIENTE, PRUEBAS)).toEqual(['MAESTROS'])
  })

  it('propaga el fallo si es la lista de proyectos la que no se puede leer', async () => {
    runCidsOperation.mockRejectedValue(new Error('El tenant productivo rechazó la sesión'))

    await expect(getPromotedTaskNames(CLIENTE, PRUEBAS)).rejects.toThrow(/rechazó la sesión/)
  })

  it('salta los proyectos sin identificador en vez de consultarlos', async () => {
    runCidsOperation.mockImplementation(async ({ operation }) => (
      operation === 'getProjects' ? [{ name: 'Sin guid' }, { name: 'Ventas', guid: 'p-1' }] : [{ taskName: 'X' }]
    ))

    await getPromotedTaskNames(CLIENTE, PRUEBAS)

    const tareas = runCidsOperation.mock.calls.filter(([{ operation }]) => operation === 'getProjectTasks')
    expect(tareas).toHaveLength(1)
  })

  it('no manda más consultas a la vez que el tope', async () => {
    let enVuelo = 0
    let maximo = 0
    runCidsOperation.mockImplementation(async ({ operation }) => {
      if (operation === 'getProjects') {
        return Array.from({ length: 20 }, (_, i) => ({ guid: `p-${i}` }))
      }
      enVuelo += 1
      maximo = Math.max(maximo, enVuelo)
      await new Promise((listo) => setTimeout(listo, 1))
      enVuelo -= 1
      return [{ taskName: 'X' }]
    })

    await getPromotedTaskNames(CLIENTE, PRUEBAS)

    expect(maximo).toBeLessThanOrEqual(PROMOTED_CONCURRENCY)
  })

  describe('caché', () => {
    it('la segunda vez no vuelve a consultar a SAP', async () => {
      tenantConDosProyectos()

      await getPromotedTaskNames(CLIENTE, PRUEBAS)
      const consultasIniciales = runCidsOperation.mock.calls.length
      const segunda = await getPromotedTaskNames(CLIENTE, PRUEBAS)

      expect(segunda).toEqual(['CARGA_DIARIA', 'CARGA_MENSUAL', 'MAESTROS'])
      expect(runCidsOperation.mock.calls).toHaveLength(consultasIniciales)
    })

    it('vuelve a consultar cuando la guardada venció', async () => {
      tenantConDosProyectos()

      await getPromotedTaskNames(CLIENTE, PRUEBAS)
      entorno.ms += (PROMOTED_CACHE_SECONDS + 1) * 1000
      runCidsOperation.mockClear()
      await getPromotedTaskNames(CLIENTE, PRUEBAS)

      expect(runCidsOperation).toHaveBeenCalled()
    })

    it('la guarda con el prefijo del cliente', async () => {
      tenantConDosProyectos()

      await getPromotedTaskNames(CLIENTE, PRUEBAS)

      expect(entorno.redis.keys()).toEqual([`c:${CLIENTE}:cids-promoted:${PRUEBAS}`])
    })

    it('olvidarla obliga a recalcularla', async () => {
      tenantConDosProyectos()

      await getPromotedTaskNames(CLIENTE, PRUEBAS)
      await forgetPromotedTaskNames(CLIENTE, PRUEBAS)
      runCidsOperation.mockClear()
      await getPromotedTaskNames(CLIENTE, PRUEBAS)

      expect(runCidsOperation).toHaveBeenCalled()
    })
  })
})
