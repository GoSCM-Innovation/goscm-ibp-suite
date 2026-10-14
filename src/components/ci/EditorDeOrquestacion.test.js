// @vitest-environment jsdom
//
// Armar y ejecutar una orquestación, en la pantalla de verdad.
//
// Lo que se mira es lo que se rompe en silencio:
//   - que el grafo que se guarda sea el que se dibujó (etapas → pasos y conexiones);
//   - que dos cambios seguidos se SUMEN, y que el último no se pierda al cambiar de pestaña;
//   - que lo que se ejecuta sea lo guardado, con los valores que se confirmaron;
//   - que una carga sin confirmar no se pinte como un éxito ni como un error, y avise antes de retomar;
//   - que mientras corre no se pueda editar.

import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const orquestaciones = {
  saveOrchestration: vi.fn(),
  getRun: vi.fn(),
  tickRun: vi.fn(),
  startRun: vi.fn(),
  cancelRun: vi.fn(),
  resumeRun: vi.fn(),
}
vi.mock('../../lib/orchestrations.js', async (importOriginal) => ({ ...(await importOriginal()), ...orquestaciones }))
vi.mock('../../lib/ci.js', async (importOriginal) => ({ ...(await importOriginal()), infoDeOrquestacion: vi.fn() }))
vi.mock('../../lib/aviso-de-corrida.js', () => ({ avisarFinDeCorrida: vi.fn(), pedirPermisoDeAviso: vi.fn() }))

const { infoDeOrquestacion } = await import('../../lib/ci.js')
const { grafoDeEtapas, nuevoPaso } = await import('../../lib/ci-etapas.js')
const { olvidarGuarda } = await import('../../lib/guarda-de-salida.js')
const { default: EditorDeOrquestacion } = await import('./EditorDeOrquestacion.jsx')
const {
  boton, desmontar, dom, elegir, escribir, marcar, montar, porEtiqueta, pulsar, texto, todosPorEtiqueta,
} = await import('./ayudas-de-prueba.js')

const CONEXION = { id: 'conn-1', name: 'CPI desarrollo', baseUrl: 'https://acme.it-cpi034-rt.cfapps.us10-002.hana.ondemand.com/http/IBP2', isProduction: false }

const resumen = (extra) => ({ valido: true, tipo: 'KEYFIGURES', comando: 'REPLACE', variables: [], ...extra })
const INTEGRACIONES = [
  { id: 'int-a', name: 'MAESTRO', folder: 'AREA', resumen: resumen({ tipo: 'MASTERDATA', comando: 'INSERT_UPDATE' }) },
  { id: 'int-b', name: 'FACTURAS', folder: 'AREA', resumen: resumen({ variables: ['DESDE'] }) },
  { id: 'int-c', name: 'PRODUCCION', folder: '', resumen: resumen() },
]

const paso = (id, integracion) => nuevoPaso(INTEGRACIONES.find((una) => una.id === integracion), id)
const orquestacion = (etapas = [], extra = {}) => ({ id: 'o-1', name: 'Carga diaria', connectionId: 'conn-1', ...grafoDeEtapas(etapas), ...extra })

/** Un estado de ejecución con los pasos que se le digan. */
const ejecucion = (status, pasos, extra = {}) => ({
  status, startedAt: '2026-10-14T12:00:00.000Z', finishedAt: status === 'running' ? null : '2026-10-14T12:01:00.000Z',
  defaults: { startedBy: { email: 'a@x.com' } }, nodes: pasos, ...extra,
})
const estadoDePaso = (status, extra = {}) => ({
  nodeId: 'x', type: 'task', status, startedAt: '2026-10-14T12:00:00.000Z',
  finishedAt: status === 'running' || status === 'pending' ? null : '2026-10-14T12:00:21.000Z', error: null, retryCount: 0, ...extra,
})

const props = (extra = {}) => ({
  connection: CONEXION,
  orquestacion: orquestacion(),
  integraciones: INTEGRACIONES,
  onRenombrar: vi.fn(async () => {}),
  onGuardada: vi.fn(),
  ...extra,
})

/** Un botón DENTRO del diálogo: con el diálogo abierto, el del editor de atrás tiene el mismo texto. */
const botonDelDialogo = (nombre) => [...dom().querySelectorAll('.modal button')].find((uno) => uno.textContent.trim() === nombre)

/** Deja pasar el tiempo (y lo que quede pendiente) dentro de `act`. */
const pasar = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  olvidarGuarda()
  orquestaciones.getRun.mockResolvedValue(null)
  orquestaciones.saveOrchestration.mockImplementation(async (id, cambios) => ({ id, name: 'Carga diaria', ...cambios }))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(async () => {
  await desmontar()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const guardadoCon = (i = -1) => orquestaciones.saveOrchestration.mock.calls.at(i)[1]
const ids = (grafo) => grafo.nodes.map((nodo) => nodo.data.integrationId)
const aristas = (grafo) => grafo.edges.map((e) => `${e.source}->${e.target}`)

describe('lo que se dibuja', () => {
  it('muestra las etapas de la orquestación guardada, con los pasos que van a la vez', async () => {
    await montar(EditorDeOrquestacion, props({
      orquestacion: orquestacion([[paso('p1', 'int-a')], [paso('p2', 'int-b'), paso('p3', 'int-c')]]),
    }))

    expect(texto()).toContain('Etapa 1')
    expect(texto()).toContain('Etapa 2')
    expect(texto()).toContain('2 a la vez')
    expect(texto()).toContain('MAESTRO')
    expect(texto()).toContain('FACTURAS')
    expect(texto()).toContain('INSERT_UPDATE')
  })

  it('una orquestación vacía dice qué hacer', async () => {
    await montar(EditorDeOrquestacion, props())
    expect(texto()).toContain('Esta orquestación está vacía')
    expect(boton('▶ Ejecutar').disabled).toBe(true)
  })

  it('un paso que apunta a una integración borrada lo dice', async () => {
    const huerfano = { ...paso('p1', 'int-a'), data: { ...paso('p1', 'int-a').data, integrationId: 'borrada', label: 'VIEJA' } }
    await montar(EditorDeOrquestacion, props({ orquestacion: orquestacion([[huerfano]]) }))
    expect(texto()).toContain('La integración ya no existe')
  })

  // Dos cadenas independientes no son etapas: mostrarlas como si lo fueran enseñaría otra cosa.
  it('un grafo que no tiene forma de etapas lo avisa y no deja ejecutar', async () => {
    const a = paso('a', 'int-a'); const b = paso('b', 'int-b'); const c = paso('c', 'int-c'); const d = paso('d', 'int-a')
    await montar(EditorDeOrquestacion, props({
      orquestacion: { id: 'o-1', name: 'X', nodes: [a, b, c, d], edges: [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'c', target: 'd' }] },
    }))
    expect(texto()).toContain('no se pueden mostrar como etapas')
    expect(boton('▶ Ejecutar').disabled).toBe(true)
  })
})

describe('el guardado automático', () => {
  it('agregar una integración la guarda sola a los 800 ms, con el grafo que se dibujó', async () => {
    const p = props()
    await montar(EditorDeOrquestacion, p)

    await elegir(porEtiqueta('Agregar una integración en una etapa nueva'), 'int-a')
    expect(orquestaciones.saveOrchestration).not.toHaveBeenCalled()
    expect(texto()).toContain('Cambios sin guardar')

    await pasar(800)
    expect(orquestaciones.saveOrchestration).toHaveBeenCalledTimes(1)
    expect(ids(guardadoCon())).toEqual(['int-a'])
    expect(guardadoCon().edges).toEqual([])
    expect(texto()).toContain('✓ Guardado')
    expect(p.onGuardada).toHaveBeenCalled()
  })

  it('dos cambios seguidos se suman en UN guardado, y las etapas quedan conectadas', async () => {
    await montar(EditorDeOrquestacion, props())
    await elegir(porEtiqueta('Agregar una integración en una etapa nueva'), 'int-a')
    await elegir(porEtiqueta('Agregar una integración en una etapa nueva'), 'int-b')
    await pasar(800)

    expect(orquestaciones.saveOrchestration).toHaveBeenCalledTimes(1)
    expect(ids(guardadoCon())).toEqual(['int-a', 'int-b'])
    expect(aristas(guardadoCon())).toHaveLength(1)
  })

  it('agregar en paralelo mete el paso en la misma etapa, sin conexión entre los dos', async () => {
    await montar(EditorDeOrquestacion, props({ orquestacion: orquestacion([[paso('p1', 'int-a')]]) }))
    await elegir(porEtiqueta('Agregar una integración en paralelo en la etapa 1'), 'int-b')
    await pasar(800)

    expect(ids(guardadoCon())).toEqual(['int-a', 'int-b'])
    expect(guardadoCon().edges).toEqual([])
  })

  it('quitar un paso lo saca, y si su etapa queda vacía la etapa desaparece', async () => {
    await montar(EditorDeOrquestacion, props({ orquestacion: orquestacion([[paso('p1', 'int-a')], [paso('p2', 'int-b')]]) }))
    await pulsar(porEtiqueta('Quitar MAESTRO'))
    await pasar(800)

    expect(ids(guardadoCon())).toEqual(['int-b'])
    // Queda una sola etapa de verdad (la otra tarjeta es la de «etapa nueva», que siempre está al final).
    expect(dom().querySelectorAll('.ci-etapa:not(.ci-etapa-nueva)')).toHaveLength(1)
  })

  it('mover un paso a otra etapa lo pone en paralelo con lo que haya', async () => {
    await montar(EditorDeOrquestacion, props({ orquestacion: orquestacion([[paso('p1', 'int-a')], [paso('p2', 'int-b')]]) }))
    await elegir(todosPorEtiqueta('Mover a otra etapa')[1], '0')
    await pasar(800)

    expect(guardadoCon().nodes).toHaveLength(2)
    expect(guardadoCon().edges).toEqual([])
    expect(texto()).toContain('2 a la vez')
  })

  it('cambiar «Si falla» a reintentar pone al menos un reintento', async () => {
    await montar(EditorDeOrquestacion, props({ orquestacion: orquestacion([[paso('p1', 'int-a')]]) }))
    const selector = dom().querySelector('.ci-paso-control select')
    await elegir(selector, 'retry')
    await pasar(800)

    expect(guardadoCon().nodes[0].data).toMatchObject({ errorStrategy: 'retry', maxRetries: 1 })
    expect(texto()).toContain('Reintentar repite la carga completa')
  })

  it('un error al guardar se dice y no se da por guardado', async () => {
    orquestaciones.saveOrchestration.mockRejectedValue(new Error('Hay un ciclo'))
    await montar(EditorDeOrquestacion, props())
    await elegir(porEtiqueta('Agregar una integración en una etapa nueva'), 'int-a')
    await pasar(800)

    expect(texto()).toContain('Hay un ciclo')
    expect(texto()).toContain('No se pudo guardar')
  })

  // Cambiar de pestaña a medio debounce no debe perder el último cambio.
  it('al desmontar guarda lo que estuviera pendiente', async () => {
    await montar(EditorDeOrquestacion, props())
    await elegir(porEtiqueta('Agregar una integración en una etapa nueva'), 'int-a')
    expect(orquestaciones.saveOrchestration).not.toHaveBeenCalled()

    await desmontar()
    expect(orquestaciones.saveOrchestration).toHaveBeenCalledTimes(1)
    expect(ids(guardadoCon())).toEqual(['int-a'])
  })
})

describe('lanzar la orquestación', () => {
  const dosPasos = () => orquestacion([[paso('p1', 'int-a')], [paso('p2', 'int-b')]])

  beforeEach(() => {
    infoDeOrquestacion.mockResolvedValue({
      pasos: [
        { nodeId: 'p1', label: 'MAESTRO', integrationId: 'int-a', variables: [], integracion: { id: 'int-a', name: 'MAESTRO', folder: 'AREA', resumen: resumen({ comando: 'INSERT_UPDATE' }) } },
        { nodeId: 'p2', label: 'FACTURAS', integrationId: 'int-b', variables: ['DESDE'], integracion: { id: 'int-b', name: 'FACTURAS', folder: 'AREA', resumen: resumen() } },
      ],
      variables: ['DESDE'],
      rotos: [],
      ultimas: { DESDE: '20261005' },
    })
  })

  it('guarda lo pendiente, pide los valores con los de la última vez y arranca con ellos', async () => {
    orquestaciones.startRun.mockResolvedValue(ejecucion('running', {}))
    await montar(EditorDeOrquestacion, props({ orquestacion: dosPasos() }))

    // Un cambio pendiente: lo que se ejecuta tiene que ser lo que se ve.
    await elegir(porEtiqueta('Agregar una integración en paralelo en la etapa 1'), 'int-c')
    await pulsar(boton('▶ Ejecutar'))
    await pasar(0)

    expect(orquestaciones.saveOrchestration).toHaveBeenCalledTimes(1)
    expect(infoDeOrquestacion).toHaveBeenCalledWith('o-1')
    expect(texto()).toContain('Ejecutar «Carga diaria»')
    expect(texto()).toContain('CPI desarrollo')
    expect(dom().querySelector('#ci-var-DESDE').value).toBe('20261005')

    await escribir(dom().querySelector('#ci-var-DESDE'), '20261014')
    await pulsar(botonDelDialogo('▶ Ejecutar'))
    await pasar(0)

    expect(orquestaciones.startRun).toHaveBeenCalledWith('o-1', { variables: { DESDE: '20261014' } })
  })

  it('con un paso roto no abre el diálogo y dice cuál', async () => {
    infoDeOrquestacion.mockResolvedValue({
      pasos: [{ nodeId: 'p1', label: 'VIEJA', integrationId: 'x', variables: [], integracion: null }],
      variables: [], rotos: ['p1'], ultimas: {},
    })
    await montar(EditorDeOrquestacion, props({ orquestacion: dosPasos() }))
    await pulsar(boton('▶ Ejecutar'))
    await pasar(0)

    expect(texto()).toContain('«VIEJA» apunta a una integración que ya no existe')
    expect(dom().querySelector('.modal')).toBeNull()
  })

  it('si el servidor no deja arrancar, el diálogo sigue abierto con el motivo', async () => {
    orquestaciones.startRun.mockRejectedValue(Object.assign(new Error('Ya hay una ejecución activa'), { status: 409 }))
    await montar(EditorDeOrquestacion, props({ orquestacion: dosPasos() }))
    await pulsar(boton('▶ Ejecutar'))
    await pasar(0)
    await pulsar(botonDelDialogo('▶ Ejecutar'))
    await pasar(0)

    expect(texto()).toContain('Ya hay una ejecución activa')
    expect(dom().querySelector('.modal')).not.toBeNull()
  })

  it('en producción exige marcar que se entiende antes de ejecutar', async () => {
    await montar(EditorDeOrquestacion, props({ orquestacion: dosPasos(), connection: { ...CONEXION, isProduction: true, name: 'CPI producción' } }))
    await pulsar(boton('▶ Ejecutar'))
    await pasar(0)
    await escribir(dom().querySelector('#ci-var-DESDE'), '20261014')
    expect(botonDelDialogo('▶ Ejecutar').disabled).toBe(true)

    await marcar(dom().querySelector('.ci-confirmar-prod input'))
    expect(botonDelDialogo('▶ Ejecutar').disabled).toBe(false)
  })
})

describe('una ejecución en marcha', () => {
  const dosPasos = () => orquestacion([[paso('p1', 'int-a')], [paso('p2', 'int-b')]])
  const enMarcha = () => ejecucion('running', { p1: estadoDePaso('running'), p2: estadoDePaso('pending') })

  it('no se puede editar mientras corre', async () => {
    orquestaciones.getRun.mockResolvedValue(enMarcha())
    orquestaciones.tickRun.mockResolvedValue(enMarcha())
    await montar(EditorDeOrquestacion, props({ orquestacion: dosPasos() }))
    await pasar(0)

    expect(texto()).toContain('En ejecución')
    expect(texto()).toContain('0/2 pasos')
    expect(boton('▶ Ejecutar').disabled).toBe(true)
    expect(boton('■ Cortar')).toBeDefined()
    expect(todosPorEtiqueta('Mover a otra etapa').every((s) => s.disabled)).toBe(true)
    expect(dom().querySelector('.ci-etapa-agregar')).toBeNull()
    expect(porEtiqueta('Quitar MAESTRO')).toBeNull()
  })

  it('la pantalla empuja la ejecución cada pocos segundos, sin encimar vueltas', async () => {
    orquestaciones.getRun.mockResolvedValue(enMarcha())
    let terminar
    orquestaciones.tickRun.mockImplementation(() => new Promise((resolver) => { terminar = () => resolver(enMarcha()) }))
    await montar(EditorDeOrquestacion, props({ orquestacion: dosPasos() }))

    await pasar(0)
    expect(orquestaciones.tickRun).toHaveBeenCalledTimes(1)
    // Con la vuelta todavía esperando a CPI, pasan 5 s y NO se lanza otra encima.
    await pasar(5000)
    expect(orquestaciones.tickRun).toHaveBeenCalledTimes(1)

    await act(async () => { terminar() })
    await pasar(5000)
    expect(orquestaciones.tickRun).toHaveBeenCalledTimes(2)
  })

  // La vuelta puede durar minutos esperando a CPI: se lee el estado guardado para ver avanzar.
  it('mientras una vuelta espera a CPI, lee el estado guardado y se ve avanzar', async () => {
    orquestaciones.getRun.mockResolvedValueOnce(enMarcha()).mockResolvedValue(
      ejecucion('running', { p1: estadoDePaso('success'), p2: estadoDePaso('running') }),
    )
    orquestaciones.tickRun.mockImplementation(() => new Promise(() => {}))
    await montar(EditorDeOrquestacion, props({ orquestacion: dosPasos() }))

    await pasar(0)
    expect(texto()).toContain('0/2 pasos')
    await pasar(3000)
    expect(texto()).toContain('1/2 pasos')
  })

  it('al terminar avisa y deja de empujar', async () => {
    orquestaciones.getRun.mockResolvedValue(enMarcha())
    orquestaciones.tickRun.mockResolvedValue(ejecucion('success', { p1: estadoDePaso('success', { detalle: { httpStatus: 200 } }), p2: estadoDePaso('success', { detalle: { httpStatus: 200 } }) }))
    await montar(EditorDeOrquestacion, props({ orquestacion: dosPasos() }))
    await pasar(0)

    expect(texto()).toContain('Completada')
    expect(texto()).toContain('2/2 pasos')
    expect(texto()).toContain('lanzada por a@x.com')
    await pasar(20_000)
    expect(orquestaciones.tickRun).toHaveBeenCalledTimes(1)
    expect(boton('▶ Ejecutar').disabled).toBe(false)
  })

  it('cortar pide confirmación y no promete deshacer lo cargado', async () => {
    orquestaciones.getRun.mockResolvedValue(enMarcha())
    orquestaciones.tickRun.mockImplementation(() => new Promise(() => {}))
    orquestaciones.cancelRun.mockResolvedValue(ejecucion('cancelled', {}))
    await montar(EditorDeOrquestacion, props({ orquestacion: dosPasos() }))
    await pasar(0)

    await pulsar(boton('■ Cortar'))
    expect(window.confirm.mock.calls.at(-1)[0]).toContain('no deshace lo cargado')
    expect(orquestaciones.cancelRun).toHaveBeenCalledWith('o-1')
  })

  it('si el usuario no confirma, no corta', async () => {
    window.confirm.mockReturnValue(false)
    orquestaciones.getRun.mockResolvedValue(enMarcha())
    orquestaciones.tickRun.mockImplementation(() => new Promise(() => {}))
    await montar(EditorDeOrquestacion, props({ orquestacion: dosPasos() }))
    await pasar(0)
    await pulsar(boton('■ Cortar'))
    expect(orquestaciones.cancelRun).not.toHaveBeenCalled()
  })
})

describe('el resultado de cada paso', () => {
  const dosPasos = () => orquestacion([[paso('p1', 'int-a')], [paso('p2', 'int-b')]])

  it('un error de CPI enseña el código, el MPL ID y el mensaje; lo siguiente queda omitido', async () => {
    orquestaciones.getRun.mockResolvedValue(ejecucion('error', {
      p1: estadoDePaso('error', { error: 'HTTP 500: An internal server error occured', detalle: { httpStatus: 500, mplId: 'AGrOoIkGv-d7sJej0DVu0bhXLV8K' } }),
      p2: estadoDePaso('skipped'),
    }))
    await montar(EditorDeOrquestacion, props({ orquestacion: dosPasos() }))
    await pasar(0)

    expect(texto()).toContain('Terminó con error')
    expect(texto()).toContain('HTTP 500')
    expect(texto()).toContain('AGrOoIkGv-d7sJej0DVu0bhXLV8K')
    expect(texto()).toContain('An internal server error occured')
    expect(texto()).toContain('Omitido')
    expect(boton('↺ Retomar')).toBeDefined()
  })

  // No es éxito ni error: la carga pudo haber entrado.
  it('un paso sin confirmar avisa, y retomar pregunta de forma distinta', async () => {
    orquestaciones.getRun.mockResolvedValue(ejecucion('error', {
      p1: estadoDePaso('error', { error: 'Sin confirmar: se interrumpió', detalle: { httpStatus: null, sinConfirmar: true } }),
      p2: estadoDePaso('skipped'),
    }))
    orquestaciones.resumeRun.mockResolvedValue(ejecucion('running', {}))
    await montar(EditorDeOrquestacion, props({ orquestacion: dosPasos() }))
    await pasar(0)

    expect(texto()).toContain('Sin confirmar: la carga pudo haber entrado')
    await pulsar(boton('↺ Retomar'))
    expect(window.confirm.mock.calls.at(-1)[0]).toContain('SIN CONFIRMAR')
    expect(orquestaciones.resumeRun).toHaveBeenCalledWith('o-1')
  })

  it('retomar un fallo común dice que lo cargado no se repite', async () => {
    orquestaciones.getRun.mockResolvedValue(ejecucion('error', {
      p1: estadoDePaso('success', { detalle: { httpStatus: 200 } }),
      p2: estadoDePaso('error', { error: 'HTTP 400: x', detalle: { httpStatus: 400 } }),
    }))
    orquestaciones.resumeRun.mockResolvedValue(ejecucion('running', {}))
    await montar(EditorDeOrquestacion, props({ orquestacion: dosPasos() }))
    await pasar(0)

    await pulsar(boton('↺ Retomar'))
    expect(window.confirm.mock.calls.at(-1)[0]).toContain('no se repite')
  })

  // Retomar sigue UNA ejecución concreta: con otros pasos ya no tiene sentido.
  it('si la orquestación cambió después de la ejecución, no se puede retomar', async () => {
    orquestaciones.getRun.mockResolvedValue(ejecucion('error', {
      viejo: estadoDePaso('error', { error: 'HTTP 500: x', detalle: { httpStatus: 500 } }),
    }))
    await montar(EditorDeOrquestacion, props({ orquestacion: dosPasos() }))
    await pasar(0)

    expect(boton('↺ Retomar')).toBeUndefined()
    expect(texto()).toContain('cambió después de la última ejecución')
  })

  it('un paso cortado se pinta como aviso, no como error', async () => {
    orquestaciones.getRun.mockResolvedValue(ejecucion('cancelled', { p1: estadoDePaso('cancelled'), p2: estadoDePaso('cancelled') }))
    await montar(EditorDeOrquestacion, props({ orquestacion: dosPasos() }))
    await pasar(0)

    expect(texto()).toContain('Cortada')
    expect(dom().querySelector('.ci-estado-duda')).not.toBeNull()
  })
})

describe('el nombre', () => {
  it('se guarda al salir del campo, si cambió', async () => {
    const p = props()
    await montar(EditorDeOrquestacion, p)
    const campo = porEtiqueta('Nombre de la orquestación')
    await escribir(campo, 'Carga nocturna')
    await act(async () => { campo.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(p.onRenombrar).toHaveBeenCalledWith('Carga nocturna')
  })

  it('un nombre vacío vuelve al anterior', async () => {
    const p = props()
    await montar(EditorDeOrquestacion, p)
    const campo = porEtiqueta('Nombre de la orquestación')
    await escribir(campo, '   ')
    await act(async () => { campo.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(p.onRenombrar).not.toHaveBeenCalled()
    expect(campo.value).toBe('Carga diaria')
  })
})
