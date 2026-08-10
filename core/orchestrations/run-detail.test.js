import { describe, it, expect } from 'vitest'

import {
  arbolDeEjecucion,
  contarPasos,
  duracionMs,
  escribirDuracion,
  nombreDeEstado,
  pasosConProblema,
} from './run-detail.js'

const AHORA = Date.parse('2026-08-10T12:10:00Z')

describe('nombreDeEstado', () => {
  it('traduce los estados del motor', () => {
    expect(nombreDeEstado('success_with_errors')).toBe('Terminado con avisos')
    expect(nombreDeEstado('skipped')).toBe('Omitido')
  })

  it('un estado desconocido se muestra tal cual', () => {
    expect(nombreDeEstado('raro')).toBe('raro')
    expect(nombreDeEstado(undefined)).toBe('—')
  })
})

describe('duracionMs', () => {
  it('mide entre inicio y fin', () => {
    expect(duracionMs({ startedAt: '2026-08-10T12:00:00Z', finishedAt: '2026-08-10T12:02:30Z' })).toBe(150_000)
  })

  // Enseñar «—» en el paso que está corriendo es esconder el dato que se está mirando.
  it('un paso en marcha se mide contra ahora', () => {
    expect(duracionMs({ startedAt: '2026-08-10T12:00:00Z' }, AHORA)).toBe(600_000)
  })

  it('un paso que no empezó no tiene duración', () => {
    expect(duracionMs({})).toBeNull()
    expect(duracionMs(undefined)).toBeNull()
  })

  it('una fecha ilegible no da un número absurdo', () => {
    expect(duracionMs({ startedAt: 'ayer' })).toBeNull()
  })

  // Los relojes del servidor y del navegador pueden no coincidir.
  it('nunca devuelve una duración negativa', () => {
    expect(duracionMs({ startedAt: '2026-08-10T12:20:00Z' }, AHORA)).toBe(0)
  })
})

describe('escribirDuracion', () => {
  it('elige la escala', () => {
    expect(escribirDuracion(4500)).toBe('4 s')
    expect(escribirDuracion(150_000)).toBe('2 min 30 s')
    expect(escribirDuracion(120_000)).toBe('2 min')
  })

  it('sin duración no inventa un cero', () => {
    expect(escribirDuracion(null)).toBe('—')
  })
})

describe('arbolDeEjecucion', () => {
  const orquestacion = {
    nodes: [
      { id: 'a', type: 'task', data: { label: 'Cargar ventas' } },
      { id: 'g', type: 'group', data: { label: 'En paralelo' } },
      { id: 'g1', type: 'task', parentId: 'g', data: { taskName: 'TAREA_1' } },
      { id: 'g2', type: 'task', parentId: 'g', data: { templateName: '/IBP/ALGO' } },
      { id: 'z', type: 'task', data: {} },
    ],
  }

  const run = {
    nodes: {
      a: { status: 'success', startedAt: '2026-08-10T12:00:00Z', finishedAt: '2026-08-10T12:01:00Z', sapRunId: 'R1' },
      g: {
        status: 'running',
        startedAt: '2026-08-10T12:01:00Z',
        children: {
          g1: { status: 'success', startedAt: '2026-08-10T12:01:00Z', finishedAt: '2026-08-10T12:02:00Z' },
          g2: { status: 'error', startedAt: '2026-08-10T12:01:00Z', finishedAt: '2026-08-10T12:01:30Z', error: 'SAP: ERROR', retryCount: 2 },
        },
      },
    },
  }

  const filas = arbolDeEjecucion(orquestacion, run, AHORA)

  // El estado es un objeto y su orden de claves no es el del dibujo.
  it('respeta el orden del grafo y mete los hijos dentro del grupo', () => {
    expect(filas.map((una) => una.id)).toEqual(['a', 'g', 'g1', 'g2', 'z'])
    expect(filas.map((una) => una.nivel)).toEqual([0, 0, 1, 1, 0])
  })

  it('marca cuál es un grupo', () => {
    expect(filas.find((una) => una.id === 'g').esGrupo).toBe(true)
    expect(filas.find((una) => una.id === 'a').esGrupo).toBe(false)
  })

  it('el nombre sale de la etiqueta, del nombre de tarea o de la plantilla', () => {
    expect(filas.find((una) => una.id === 'a').nombre).toBe('Cargar ventas')
    expect(filas.find((una) => una.id === 'g1').nombre).toBe('TAREA_1')
    expect(filas.find((una) => una.id === 'g2').nombre).toBe('/IBP/ALGO')
  })

  it('sin nombre ninguno se muestra el identificador', () => {
    expect(filas.find((una) => una.id === 'z').nombre).toBe('z')
  })

  it('trae tiempos, duración, reintentos y el error de cada paso', () => {
    const fallado = filas.find((una) => una.id === 'g2')
    expect(fallado).toMatchObject({ status: 'error', error: 'SAP: ERROR', reintentos: 2, ms: 30_000 })
  })

  it('un paso sin estado queda pendiente', () => {
    expect(filas.find((una) => una.id === 'z')).toMatchObject({ status: 'pending', ms: null })
  })

  it('el grupo en marcha se mide contra ahora', () => {
    expect(filas.find((una) => una.id === 'g').ms).toBe(540_000)
  })

  it('sin ejecución devuelve el árbol con todo pendiente', () => {
    expect(arbolDeEjecucion(orquestacion, null).every((una) => una.status === 'pending')).toBe(true)
  })

  it('sin orquestación no hay árbol', () => {
    expect(arbolDeEjecucion(null, run)).toEqual([])
  })
})

describe('contarPasos', () => {
  // El estado de un grupo es el resumen de sus hijos: contarlo lo sumaría dos veces.
  it('no cuenta los grupos', () => {
    const filas = [
      { id: 'g', esGrupo: true, status: 'running' },
      { id: 'g1', esGrupo: false, status: 'success' },
      { id: 'g2', esGrupo: false, status: 'success' },
    ]
    expect(contarPasos(filas)).toEqual({ success: 2 })
  })

  it('sin pasos no cuenta nada', () => {
    expect(contarPasos([])).toEqual({})
    expect(contarPasos(undefined)).toEqual({})
  })
})

describe('pasosConProblema', () => {
  // Con doce pasos en pantalla, encontrarlos a ojo es el trabajo que la herramienta debe ahorrar.
  it('junta los fallados y los cancelados', () => {
    const filas = [
      { id: 'a', esGrupo: false, status: 'success' },
      { id: 'b', esGrupo: false, status: 'error' },
      { id: 'c', esGrupo: false, status: 'cancelled' },
      { id: 'g', esGrupo: true, status: 'error' },
    ]
    expect(pasosConProblema(filas).map((una) => una.id)).toEqual(['b', 'c'])
  })

  it('una ejecución limpia no tiene ninguno', () => {
    expect(pasosConProblema([{ esGrupo: false, status: 'success' }])).toEqual([])
  })
})
