// @vitest-environment jsdom
//
// La pantalla de orquestaciones de CI Tools: la lista, el editor y la ejecución.
//
// Lo que se mira es lo que se rompe en silencio:
//   - que con una ejecución en marcha no se pueda abrir, crear ni borrar otra orquestación, y que la pantalla la siga
//     empujando (hoy es lo único que la hace avanzar);
//   - que la ejecución de una orquestación no se lea como si fuera de otra;
//   - que lo que se ejecuta sea lo guardado, con los valores que se confirmaron;
//   - que una carga sin confirmar no se pinte como un éxito ni como un error, y avise antes de retomar.

import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const orquestaciones = {
  listOrchestrations: vi.fn(),
  createOrchestration: vi.fn(),
  deleteOrchestration: vi.fn(),
  duplicateOrchestration: vi.fn(),
  saveOrchestration: vi.fn(),
  getRun: vi.fn(),
  tickRun: vi.fn(),
  startRun: vi.fn(),
  cancelRun: vi.fn(),
  resumeRun: vi.fn(),
}
vi.mock('../../lib/orchestrations.js', async (importOriginal) => ({ ...(await importOriginal()), ...orquestaciones }))
vi.mock('../../lib/ci.js', async (importOriginal) => ({ ...(await importOriginal()), listIntegraciones: vi.fn(), infoDeOrquestacion: vi.fn() }))
vi.mock('../../lib/aviso-de-corrida.js', () => ({ avisarFinDeCorrida: vi.fn(), pedirPermisoDeAviso: vi.fn() }))

const { listIntegraciones, infoDeOrquestacion } = await import('../../lib/ci.js')
const { avisarFinDeCorrida } = await import('../../lib/aviso-de-corrida.js')
const { grafoDePasos, grupoNuevo, pasoDeIntegracion } = await import('../../lib/ci-pasos.js')
const { olvidarGuarda, puedeSalir } = await import('../../lib/guarda-de-salida.js')
const { default: OrquestacionesCi } = await import('./OrquestacionesCi.jsx')
const {
  boton, desmontar, dom, escribir, montar, porEtiqueta, pulsar, redibujar, teclear, texto,
} = await import('./ayudas-de-prueba.js')

const CONEXION = { id: 'conn-1', name: 'CPI desarrollo', baseUrl: 'https://acme.it-cpi034-rt.cfapps.us10-002.hana.ondemand.com/http/IBP2', isProduction: false }

const resumen = (extra) => ({ valido: true, tipo: 'KEYFIGURES', comando: 'REPLACE', destino: '', variables: [], ...extra })
const INTEGRACIONES = [
  { id: 'int-a', name: 'MAESTRO', folder: 'AREA', resumen: resumen({ tipo: 'MASTERDATA', comando: 'INSERT_UPDATE', destino: 'SBPRODUCT' }) },
  { id: 'int-b', name: 'FACTURAS', folder: 'AREA', resumen: resumen({ variables: ['DESDE'], destino: 'SBINVOICE' }) },
  { id: 'int-c', name: 'PRODUCCION', folder: '', resumen: resumen() },
]
const paso = (id, integracion) => pasoDeIntegracion(INTEGRACIONES.find((una) => una.id === integracion), id)

const dosPasos = () => ({
  id: 'o-1', name: 'Carga diaria', connectionId: 'conn-1', createdAt: '2026-10-01T10:00:00.000Z', ...grafoDePasos([paso('p1', 'int-a'), paso('p2', 'int-b')]),
})
const unPaso = () => ({
  id: 'o-2', name: 'Cierre mensual', connectionId: 'conn-1', createdAt: '2026-09-15T10:00:00.000Z', ...grafoDePasos([paso('q1', 'int-c')]),
})
const conGrupo = () => ({
  id: 'o-3', name: 'Con grupo', connectionId: 'conn-1', createdAt: '2026-09-20T10:00:00.000Z',
  ...grafoDePasos([paso('g1', 'int-a'), { ...grupoNuevo('g'), children: [paso('g2', 'int-b'), paso('g3', 'int-c')] }]),
})

const estado = (status, extra = {}) => ({
  nodeId: 'x', type: 'task', status, startedAt: '2026-10-14T12:00:00.000Z',
  finishedAt: status === 'running' || status === 'pending' ? null : '2026-10-14T12:00:21.000Z', error: null, retryCount: 0, ...extra,
})
const ejecucion = (status, pasos, extra = {}) => ({
  status, startedAt: '2026-10-14T12:00:00.000Z', finishedAt: status === 'running' ? null : '2026-10-14T12:01:00.000Z',
  defaults: { startedBy: { email: 'a@x.com' } }, nodes: pasos, ...extra,
})
const enMarcha = () => ejecucion('running', { p1: estado('running'), p2: estado('pending') })

/** Las ejecuciones guardadas por orquestación: `getRun` contesta según el identificador. */
let ejecuciones

const props = (extra = {}) => ({ connection: CONEXION, visible: true, ...extra })

/** Un botón DENTRO del diálogo: con el diálogo abierto, el del editor de atrás tiene el mismo texto. */
const botonDelDialogo = (nombre) => [...dom().querySelectorAll('.modal button')].find((uno) => uno.textContent.trim() === nombre)

/** Deja pasar el tiempo (y lo que quede pendiente) dentro de `act`. */
const pasar = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

const filas = () => [...dom().querySelectorAll('.ci-orq-item')]
const filaDe = (nombre) => filas().find((fila) => fila.textContent.includes(nombre))
const abrir = (nombre) => pulsar(filaDe(nombre).querySelector('.ci-orq-item-principal'))
const campoDeNombre = () => porEtiqueta('Nombre de la orquestación')

/** Monta la pantalla con estas orquestaciones y deja que termine de leer. */
async function montarCon(lista, extra = {}) {
  orquestaciones.listOrchestrations.mockResolvedValue(lista)
  await montar(OrquestacionesCi, props(extra))
  await pasar(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  olvidarGuarda()
  ejecuciones = {}
  window.innerWidth = 1024
  listIntegraciones.mockResolvedValue(INTEGRACIONES)
  orquestaciones.getRun.mockImplementation(async (id) => ejecuciones[id] ?? null)
  orquestaciones.saveOrchestration.mockImplementation(async (id, cambios) => ({ ...dosPasos(), id, ...cambios }))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(async () => {
  await desmontar()
  vi.useRealTimers()
  vi.restoreAllMocks()
  window.innerWidth = 1024
})

describe('la lista', () => {
  it('muestra cada orquestación con cuántos pasos tiene y su fecha', async () => {
    await montarCon([dosPasos(), unPaso(), conGrupo()])

    expect(filas()).toHaveLength(3)
    expect(filaDe('Carga diaria').textContent).toMatch(/2 pasos · /)
    expect(filaDe('Cierre mensual').textContent).toMatch(/1 paso · /)
    // Un grupo cuenta como UN paso.
    expect(filaDe('Con grupo').textContent).toMatch(/2 pasos · /)
  })

  it('mientras lee dice que está cargando', async () => {
    orquestaciones.listOrchestrations.mockReturnValue(new Promise(() => {}))
    await montar(OrquestacionesCi, props())
    expect(texto()).toContain('Cargando orquestaciones…')
  })

  it('un error al leer se dice, y la lista queda vacía', async () => {
    orquestaciones.listOrchestrations.mockRejectedValue(new Error('Sin permiso'))
    await montar(OrquestacionesCi, props())
    await pasar(0)
    expect(texto()).toContain('Sin permiso')
    expect(texto()).toContain('Sin orquestaciones. Crea la primera.')
  })

  it('sin orquestaciones, invita a crear la primera', async () => {
    await montarCon([])
    expect(texto()).toContain('Sin orquestaciones. Crea la primera.')
    expect(texto()).toContain('Orquestador de integraciones')
    expect(texto()).toContain('agrupar integraciones en paralelo')
  })

  it('no lee nada mientras la pestaña no se ve, y lo lee todo al verse', async () => {
    orquestaciones.listOrchestrations.mockResolvedValue([dosPasos()])
    await montar(OrquestacionesCi, props({ visible: false }))
    await pasar(0)
    expect(orquestaciones.listOrchestrations).not.toHaveBeenCalled()

    await redibujar(OrquestacionesCi, props({ visible: true }))
    await pasar(0)
    expect(orquestaciones.listOrchestrations).toHaveBeenCalledWith({ connectionId: 'conn-1', production: false })
    expect(listIntegraciones).toHaveBeenCalledWith('conn-1')
    expect(filas()).toHaveLength(1)
  })

  it('«Actualizar» vuelve a leer la lista y las integraciones', async () => {
    await montarCon([dosPasos()])
    await pulsar(dom().querySelector('.ci-orq-lista-botones .boton-actualizar'))
    await pasar(0)
    expect(orquestaciones.listOrchestrations).toHaveBeenCalledTimes(2)
    expect(listIntegraciones).toHaveBeenCalledTimes(2)
  })

  it('en una conexión productiva, pide las orquestaciones de producción', async () => {
    await montarCon([], { connection: { ...CONEXION, isProduction: true } })
    expect(orquestaciones.listOrchestrations).toHaveBeenCalledWith({ connectionId: 'conn-1', production: true })
  })

  it('se pliega a las iniciales y se vuelve a desplegar', async () => {
    await montarCon([dosPasos(), unPaso()])
    await pulsar(porEtiqueta('Colapsar el panel de orquestaciones'))

    expect(dom().querySelector('.ci-orq-lista.plegada')).not.toBeNull()
    expect(dom().querySelector('.ci-orq-lista .ci-orq-nueva')).toBeNull()
    const iniciales = [...dom().querySelectorAll('.ci-orq-inicial:not(.nueva)')]
    expect(iniciales.map((una) => una.textContent)).toEqual(['C', 'C'])
    expect(iniciales[0].title).toBe('Carga diaria')

    // Con la lista plegada también se abre una orquestación.
    await pulsar(iniciales[1])
    expect(campoDeNombre().value).toBe('Cierre mensual')

    await pulsar(porEtiqueta('Expandir el panel de orquestaciones'))
    expect(dom().querySelector('.ci-orq-lista.plegada')).toBeNull()
    expect(filas()).toHaveLength(2)
  })
})

describe('abrir, crear, duplicar y eliminar', () => {
  it('abrir una orquestación enseña su editor, y sin elegir ninguna no hay editor', async () => {
    await montarCon([dosPasos(), unPaso()])
    expect(campoDeNombre()).toBeNull()

    await abrir('Cierre mensual')
    expect(campoDeNombre().value).toBe('Cierre mensual')
    expect(filaDe('Cierre mensual').classList.contains('activa')).toBe(true)

    await abrir('Carga diaria')
    expect(campoDeNombre().value).toBe('Carga diaria')
    expect(dom().querySelectorAll('.ci-orq-tarjeta')).toHaveLength(2)
  })

  it('«+ Nueva orquestación» pide el nombre y la abre vacía', async () => {
    orquestaciones.createOrchestration.mockResolvedValue({ id: 'o-9', name: 'Nueva carga', connectionId: 'conn-1', createdAt: '2026-10-14T10:00:00.000Z', nodes: [], edges: [] })
    await montarCon([dosPasos()])

    await pulsar(boton('+ Nueva orquestación'))
    expect(dom().querySelector('.modal')).not.toBeNull()
    expect(botonDelDialogo('Crear').disabled).toBe(true)

    await escribir(porEtiqueta('Nombre de la orquestación nueva'), '  Nueva carga ')
    expect(botonDelDialogo('Crear').disabled).toBe(false)
    await pulsar(botonDelDialogo('Crear'))
    await pasar(0)

    expect(orquestaciones.createOrchestration).toHaveBeenCalledWith({ connectionId: 'conn-1', production: false }, 'Nueva carga')
    expect(dom().querySelector('.modal')).toBeNull()
    expect(filas()).toHaveLength(2)
    expect(campoDeNombre().value).toBe('Nueva carga')
    expect(texto()).toContain('Sin pasos configurados.')
  })

  it('Enter en el nombre también crea; Cancelar no crea nada', async () => {
    orquestaciones.createOrchestration.mockResolvedValue({ id: 'o-9', name: 'Otra', connectionId: 'conn-1', createdAt: null, nodes: [], edges: [] })
    await montarCon([])

    await pulsar(boton('+ Nueva orquestación'))
    await pulsar(botonDelDialogo('Cancelar'))
    expect(dom().querySelector('.modal')).toBeNull()
    expect(orquestaciones.createOrchestration).not.toHaveBeenCalled()

    await pulsar(boton('+ Nueva orquestación'))
    await escribir(porEtiqueta('Nombre de la orquestación nueva'), 'Otra')
    await teclear(porEtiqueta('Nombre de la orquestación nueva'), 'Enter')
    await pasar(0)
    expect(orquestaciones.createOrchestration).toHaveBeenCalledTimes(1)
  })

  it('el nombre del diálogo tiene el foco para escribir sin hacer clic', async () => {
    await montarCon([])
    await pulsar(boton('+ Nueva orquestación'))
    expect(document.activeElement).toBe(porEtiqueta('Nombre de la orquestación nueva'))
  })

  it('si el servidor no deja crearla, lo dice', async () => {
    orquestaciones.createOrchestration.mockRejectedValue(new Error('Ya existe una con ese nombre'))
    await montarCon([])
    await pulsar(boton('+ Nueva orquestación'))
    await escribir(porEtiqueta('Nombre de la orquestación nueva'), 'Repetida')
    await pulsar(botonDelDialogo('Crear'))
    await pasar(0)
    expect(texto()).toContain('Ya existe una con ese nombre')
  })

  it('duplicar agrega la copia y la abre', async () => {
    orquestaciones.duplicateOrchestration.mockResolvedValue({ ...dosPasos(), id: 'o-5', name: 'Carga diaria (copia)' })
    await montarCon([dosPasos()])
    await pulsar(porEtiqueta('Duplicar Carga diaria'))
    await pasar(0)

    expect(orquestaciones.duplicateOrchestration).toHaveBeenCalledWith('o-1')
    expect(filas()).toHaveLength(2)
    expect(campoDeNombre().value).toBe('Carga diaria (copia)')
  })

  it('eliminar pide confirmar, dice cuál, y la saca de la lista', async () => {
    orquestaciones.deleteOrchestration.mockResolvedValue()
    await montarCon([dosPasos(), unPaso()])
    await abrir('Carga diaria')

    await pulsar(porEtiqueta('Eliminar Carga diaria'))
    expect(dom().querySelector('.modal').textContent).toContain('¿Eliminar «Carga diaria»?')
    expect(orquestaciones.deleteOrchestration).not.toHaveBeenCalled()

    await pulsar(botonDelDialogo('Eliminar'))
    await pasar(0)
    expect(orquestaciones.deleteOrchestration).toHaveBeenCalledWith('o-1')
    expect(filas()).toHaveLength(1)
    // La que estaba abierta se cierra.
    expect(campoDeNombre()).toBeNull()
    expect(texto()).toContain('Orquestador de integraciones')
  })

  it('cancelar la eliminación no borra nada', async () => {
    await montarCon([dosPasos()])
    await pulsar(porEtiqueta('Eliminar Carga diaria'))
    await pulsar(botonDelDialogo('Cancelar'))
    expect(orquestaciones.deleteOrchestration).not.toHaveBeenCalled()
    expect(filas()).toHaveLength(1)
  })

  it('si el servidor no deja eliminarla (tiene una ejecución en marcha), lo dice y sigue ahí', async () => {
    orquestaciones.deleteOrchestration.mockRejectedValue(new Error('Tiene una ejecución en marcha'))
    await montarCon([dosPasos()])
    await pulsar(porEtiqueta('Eliminar Carga diaria'))
    await pulsar(botonDelDialogo('Eliminar'))
    await pasar(0)
    expect(texto()).toContain('Tiene una ejecución en marcha')
    expect(filas()).toHaveLength(1)
  })

  it('lo que el editor guarda se ve en la lista: el nuevo nombre y la cantidad de pasos', async () => {
    orquestaciones.saveOrchestration.mockImplementation(async (id, cambios) => ({ ...dosPasos(), id, ...cambios }))
    await montarCon([dosPasos()])
    await abrir('Carga diaria')

    await pulsar(porEtiqueta('Agregar a la secuencia: PRODUCCION'))
    await escribir(campoDeNombre(), 'Carga nocturna')
    await pasar(800)

    expect(filas()[0].textContent).toContain('Carga nocturna')
    expect(filas()[0].textContent).toMatch(/3 pasos · /)
  })
})

describe('lanzar la orquestación', () => {
  beforeEach(() => {
    infoDeOrquestacion.mockResolvedValue({
      pasos: [
        { nodeId: 'p1', label: 'MAESTRO', integrationId: 'int-a', variables: [], integracion: INTEGRACIONES[0] },
        { nodeId: 'p2', label: 'FACTURAS', integrationId: 'int-b', variables: ['DESDE'], integracion: INTEGRACIONES[1] },
      ],
      variables: ['DESDE'],
      variablesDeFecha: [],
      rotos: [],
      ultimas: { DESDE: '20261005' },
    })
  })

  it('pide los valores, arranca con ellos y pasa a la vista de la ejecución', async () => {
    orquestaciones.startRun.mockResolvedValue(enMarcha())
    orquestaciones.tickRun.mockImplementation(() => new Promise(() => {}))
    await montarCon([dosPasos()])
    await abrir('Carga diaria')

    await pulsar(boton('▶ Ejecutar'))
    await pasar(0)
    expect(texto()).toContain('Ejecutar «Carga diaria»')
    await escribir(dom().querySelector('#ci-var-DESDE'), '20261014')
    await pulsar(botonDelDialogo('▶ Ejecutar'))
    await pasar(0)

    expect(orquestaciones.startRun).toHaveBeenCalledWith('o-1', { variables: { DESDE: '20261014' } })
    expect(dom().querySelector('.modal')).toBeNull()
    expect(dom().querySelector('.ci-orq-ejecucion')).not.toBeNull()
    expect(campoDeNombre()).toBeNull()
    expect(texto()).toContain('En ejecución')
  })

  it('«← Volver al editor» regresa al editor, que ofrece «Última ejecución»', async () => {
    orquestaciones.startRun.mockResolvedValue(ejecucion('success', { p1: estado('success'), p2: estado('success') }))
    await montarCon([dosPasos()])
    await abrir('Carga diaria')
    await pulsar(boton('▶ Ejecutar'))
    await pasar(0)
    await escribir(dom().querySelector('#ci-var-DESDE'), '20261014')
    await pulsar(botonDelDialogo('▶ Ejecutar'))
    await pasar(0)

    // Terminó: se ve el resultado hasta que se pida volver.
    expect(texto()).toContain('Completada')
    await pulsar(boton('← Volver al editor'))
    expect(campoDeNombre()).not.toBeNull()

    await pulsar(boton('Última ejecución'))
    expect(dom().querySelector('.ci-orq-ejecucion')).not.toBeNull()
  })
})

describe('una ejecución en marcha', () => {
  const abrirEnMarcha = async () => {
    ejecuciones['o-1'] = enMarcha()
    orquestaciones.tickRun.mockResolvedValue(enMarcha())
    await montarCon([dosPasos(), unPaso()])
    await abrir('Carga diaria')
    await pasar(0)
  }

  it('al abrir una orquestación que corre, se ve su ejecución', async () => {
    await abrirEnMarcha()
    expect(dom().querySelector('.ci-orq-ejecucion')).not.toBeNull()
    expect(texto()).toContain('En ejecución')
    expect(texto()).toContain('0/2 integraciones')
    expect(boton('⊘ Cancelar')).toBeDefined()
  })

  it('mientras corre no se puede abrir otra, crear, duplicar ni eliminar', async () => {
    await abrirEnMarcha()

    expect(boton('+ Nueva orquestación').disabled).toBe(true)
    expect(porEtiqueta('Duplicar Carga diaria')).toBeNull()
    expect(porEtiqueta('Eliminar Carga diaria')).toBeNull()
    expect(dom().querySelector('.ci-orq-punto')).not.toBeNull()

    await abrir('Cierre mensual')
    expect(filaDe('Carga diaria').classList.contains('activa')).toBe(true)
    expect(filaDe('Cierre mensual').classList.contains('activa')).toBe(false)
    expect(dom().querySelector('.ci-orq-ejecucion')).not.toBeNull()
  })

  it('con la lista plegada tampoco se abre otra ni se crea', async () => {
    await abrirEnMarcha()
    await pulsar(porEtiqueta('Colapsar el panel de orquestaciones'))
    expect(dom().querySelector('.ci-orq-inicial.nueva').disabled).toBe(true)
    await pulsar(dom().querySelector('.ci-orq-inicial[title="Cierre mensual"]'))
    expect(dom().querySelector('.ci-orq-inicial.activa').title).toBe('Carga diaria')
  })

  it('salir de la pantalla pregunta mientras corre, y deja de preguntar al terminar', async () => {
    await abrirEnMarcha()
    window.confirm.mockReturnValue(false)
    expect(puedeSalir()).toBe(false)
    expect(window.confirm.mock.calls.at(-1)[0]).toContain('Hay una orquestación en marcha')

    orquestaciones.tickRun.mockResolvedValue(ejecucion('success', { p1: estado('success'), p2: estado('success') }))
    await pasar(5000)
    expect(puedeSalir()).toBe(true)
  })

  it('la pantalla empuja la ejecución cada pocos segundos, sin encimar vueltas', async () => {
    ejecuciones['o-1'] = enMarcha()
    let terminar
    orquestaciones.tickRun.mockImplementation(() => new Promise((resolver) => { terminar = () => resolver(enMarcha()) }))
    await montarCon([dosPasos()])
    await abrir('Carga diaria')

    await pasar(0)
    expect(orquestaciones.tickRun).toHaveBeenCalledTimes(1)
    expect(orquestaciones.tickRun).toHaveBeenCalledWith('o-1')
    // Con la vuelta todavía esperando a CPI, pasan 5 s y NO se lanza otra encima.
    await pasar(5000)
    expect(orquestaciones.tickRun).toHaveBeenCalledTimes(1)

    await act(async () => { terminar() })
    await pasar(5000)
    expect(orquestaciones.tickRun).toHaveBeenCalledTimes(2)
  })

  // La vuelta puede durar minutos esperando a CPI: se lee el estado guardado para ver avanzar.
  it('mientras una vuelta espera a CPI, lee el estado guardado y se ve avanzar', async () => {
    ejecuciones['o-1'] = enMarcha()
    await montarCon([dosPasos()])
    orquestaciones.tickRun.mockImplementation(() => new Promise(() => {}))
    await abrir('Carga diaria')
    await pasar(0)
    expect(texto()).toContain('0/2 integraciones')

    ejecuciones['o-1'] = ejecucion('running', { p1: estado('success'), p2: estado('running') })
    await pasar(3000)
    expect(texto()).toContain('1/2 integraciones')
  })

  it('al terminar avisa, deja de empujar y devuelve la lista', async () => {
    ejecuciones['o-1'] = enMarcha()
    orquestaciones.tickRun.mockResolvedValue(ejecucion('success', { p1: estado('success', { detalle: { httpStatus: 200 } }), p2: estado('success', { detalle: { httpStatus: 200 } }) }))
    await montarCon([dosPasos()])
    await abrir('Carga diaria')
    await pasar(0)

    expect(texto()).toContain('Completada')
    expect(texto()).toContain('2/2 integraciones')
    expect(texto()).toContain('lanzada por a@x.com')
    expect(avisarFinDeCorrida).toHaveBeenCalledWith('Carga diaria', 'success')
    await pasar(20_000)
    expect(orquestaciones.tickRun).toHaveBeenCalledTimes(1)
    // Libre otra vez.
    expect(boton('+ Nueva orquestación').disabled).toBe(false)
    expect(porEtiqueta('Eliminar Carga diaria')).not.toBeNull()
  })

  it('la ejecución de una orquestación no se lee como si fuera de otra', async () => {
    // `o-1` corrió y terminó; `o-2` nunca corrió. Al abrir la segunda no hay nada que empujar ni que ver.
    ejecuciones['o-1'] = ejecucion('success', { p1: estado('success'), p2: estado('success') })
    await montarCon([dosPasos(), unPaso()])
    await abrir('Carga diaria')
    await pasar(0)
    expect(boton('Última ejecución')).toBeDefined()

    await abrir('Cierre mensual')
    await pasar(10_000)
    expect(campoDeNombre().value).toBe('Cierre mensual')
    expect(boton('Última ejecución')).toBeUndefined()
    expect(orquestaciones.tickRun).not.toHaveBeenCalled()
  })

  it('cancelar pide confirmación y no promete deshacer lo cargado', async () => {
    await abrirEnMarcha()
    orquestaciones.cancelRun.mockResolvedValue(ejecucion('cancelled', { p1: estado('cancelled'), p2: estado('skipped') }))

    await pulsar(boton('⊘ Cancelar'))
    expect(window.confirm.mock.calls.at(-1)[0]).toContain('no deshace lo cargado')
    expect(orquestaciones.cancelRun).toHaveBeenCalledWith('o-1')
  })

  it('si no se confirma, no cancela', async () => {
    await abrirEnMarcha()
    window.confirm.mockReturnValue(false)
    await pulsar(boton('⊘ Cancelar'))
    expect(orquestaciones.cancelRun).not.toHaveBeenCalled()
  })
})

describe('el resultado de la ejecución', () => {
  const abrirConResultado = async (run, orquestacion = dosPasos()) => {
    ejecuciones[orquestacion.id] = run
    await montarCon([orquestacion])
    await abrir(orquestacion.name)
    await pasar(0)
    // Una ejecución que ya terminó no se enseña sola: se pide.
    await pulsar(boton('Última ejecución'))
  }

  it('un error de CPI enseña el código, el MPL ID y el mensaje; lo siguiente queda omitido', async () => {
    await abrirConResultado(ejecucion('error', {
      p1: estado('error', { error: 'HTTP 500: An internal server error occured', detalle: { httpStatus: 500, mplId: 'AGrOoIkGv-d7sJej0DVu0bhXLV8K' } }),
      p2: estado('skipped'),
    }))

    expect(texto()).toContain('Terminó con error')
    expect(texto()).toContain('HTTP 500')
    expect(texto()).toContain('AGrOoIkGv-d7sJej0DVu0bhXLV8K')
    expect(texto()).toContain('Omitido')
    expect(boton('↺ Retomar')).toBeDefined()
  })

  // «Completada con advertencias» no es un error: la carga se procesó.
  it('un paso con advertencias no es un error', async () => {
    await abrirConResultado(ejecucion('success', {
      p1: estado('success_with_errors', { detalle: { httpStatus: 500, mplId: 'MPL-1', mensaje: 'rechazó un registro' } }),
      p2: estado('success'),
    }))
    expect(texto()).toContain('Completada con advertencias')
    expect(texto()).not.toContain('Terminó con error')
    expect(boton('↺ Retomar')).toBeUndefined()
  })

  // No es éxito ni error: la carga pudo haber entrado.
  it('un paso sin confirmar avisa, y retomar pregunta de forma distinta', async () => {
    orquestaciones.resumeRun.mockResolvedValue(ejecucion('running', { p1: estado('running'), p2: estado('pending') }))
    orquestaciones.tickRun.mockImplementation(() => new Promise(() => {}))
    await abrirConResultado(ejecucion('error', {
      p1: estado('error', { error: 'Sin confirmar: se interrumpió', detalle: { httpStatus: null, sinConfirmar: true } }),
      p2: estado('skipped'),
    }))

    expect(texto()).toContain('Sin confirmar: la carga pudo haber entrado')
    await pulsar(boton('↺ Retomar'))
    expect(window.confirm.mock.calls.at(-1)[0]).toContain('SIN CONFIRMAR')
    expect(orquestaciones.resumeRun).toHaveBeenCalledWith('o-1')
  })

  it('un paso sin confirmar dentro de un grupo también hace que retomar pregunte', async () => {
    orquestaciones.resumeRun.mockResolvedValue(ejecucion('running', {}))
    orquestaciones.tickRun.mockImplementation(() => new Promise(() => {}))
    await abrirConResultado(ejecucion('error', {
      g1: estado('success'),
      g: { ...estado('error'), type: 'group', children: {
        g2: estado('error', { error: 'Sin confirmar', detalle: { sinConfirmar: true } }),
        g3: estado('success'),
      } },
    }), conGrupo())

    await pulsar(boton('↺ Retomar'))
    expect(window.confirm.mock.calls.at(-1)[0]).toContain('SIN CONFIRMAR')
  })

  it('retomar un fallo común dice que lo cargado no se repite', async () => {
    orquestaciones.resumeRun.mockResolvedValue(ejecucion('running', { p1: estado('running'), p2: estado('pending') }))
    orquestaciones.tickRun.mockImplementation(() => new Promise(() => {}))
    await abrirConResultado(ejecucion('error', {
      p1: estado('success', { detalle: { httpStatus: 200 } }),
      p2: estado('error', { error: 'HTTP 400: x', detalle: { httpStatus: 400 } }),
    }))

    await pulsar(boton('↺ Retomar'))
    expect(window.confirm.mock.calls.at(-1)[0]).toContain('no se repite')
    await pasar(0)
    // Retomada, vuelve a estar en marcha.
    expect(boton('⊘ Cancelar')).toBeDefined()
  })

  it('si no se confirma, no retoma', async () => {
    window.confirm.mockReturnValue(false)
    await abrirConResultado(ejecucion('error', { p1: estado('success'), p2: estado('error', { error: 'HTTP 400: x' }) }))
    await pulsar(boton('↺ Retomar'))
    expect(orquestaciones.resumeRun).not.toHaveBeenCalled()
  })

  // Retomar sigue UNA ejecución concreta: con otros pasos ya no tiene sentido.
  it('si la orquestación cambió después de la ejecución, no se puede retomar', async () => {
    await abrirConResultado(ejecucion('error', {
      viejo: estado('error', { error: 'HTTP 500: x', detalle: { httpStatus: 500 } }),
    }))
    expect(boton('↺ Retomar')).toBeUndefined()
    expect(texto()).toContain('La orquestación cambió después de esta ejecución')
  })

  // Una orquestación del editor de etapas se enseña con un grupo que en el grafo guardado no existe, y su ejecución tampoco lo tiene:
  // es la MISMA versión, y se puede retomar.
  it('la ejecución de una orquestación del editor de etapas se ve y se puede retomar', async () => {
    const deEtapas = {
      id: 'o-7', name: 'De etapas', connectionId: 'conn-1', createdAt: '2026-10-15T10:00:00.000Z',
      nodes: [
        { id: 'a', type: 'task', data: { label: 'MAESTRO', integrationId: 'int-a', errorStrategy: 'stop', maxRetries: 0, retryDelaySeconds: 60 } },
        { id: 'b', type: 'task', data: { label: 'FACTURAS', integrationId: 'int-b', errorStrategy: 'stop', maxRetries: 0, retryDelaySeconds: 60 } },
      ],
      edges: [],
    }
    await abrirConResultado(ejecucion('error', {
      a: estado('success', { detalle: { httpStatus: 200 } }),
      b: estado('error', { error: 'HTTP 500: x', detalle: { httpStatus: 500, mplId: 'MPL-7' } }),
    }), deEtapas)

    expect(texto()).toContain('FACTURAS')
    expect(texto()).toContain('MPL-7')
    expect(texto()).not.toContain('La orquestación cambió después')
    expect(boton('↺ Retomar')).toBeDefined()
  })

  it('una ejecución cancelada también se puede retomar', async () => {
    await abrirConResultado(ejecucion('cancelled', { p1: estado('success'), p2: estado('cancelled') }))
    expect(texto()).toContain('Cancelada')
    expect(boton('↺ Retomar')).toBeDefined()
  })
})

describe('en el teléfono', () => {
  beforeEach(() => { window.innerWidth = 500 })

  it('empieza por la lista; al abrir una orquestación enseña el editor con «← Volver»', async () => {
    await montarCon([dosPasos()])
    expect(dom().querySelector('.ci-orq-lista')).not.toBeNull()
    expect(dom().querySelector('.ci-orq-panel')).toBeNull()
    // No hay botón de plegar: la lista ocupa toda la pantalla.
    expect(porEtiqueta('Colapsar el panel de orquestaciones')).toBeNull()

    await abrir('Carga diaria')
    expect(dom().querySelector('.ci-orq-lista')).toBeNull()
    expect(campoDeNombre().value).toBe('Carga diaria')
    expect(dom().querySelector('.ci-orq-movil-barra').textContent).toContain('Carga diaria')

    await pulsar(boton('← Volver'))
    expect(dom().querySelector('.ci-orq-lista')).not.toBeNull()
    expect(campoDeNombre()).toBeNull()
  })

  it('una ejecución en marcha sigue avanzando aunque se mire la lista', async () => {
    ejecuciones['o-1'] = enMarcha()
    orquestaciones.tickRun.mockResolvedValue(enMarcha())
    await montarCon([dosPasos()])
    await abrir('Carga diaria')
    await pasar(0)
    expect(orquestaciones.tickRun).toHaveBeenCalledTimes(1)

    await pulsar(boton('← Volver'))
    await pasar(5000)
    expect(orquestaciones.tickRun).toHaveBeenCalledTimes(2)
  })
})
