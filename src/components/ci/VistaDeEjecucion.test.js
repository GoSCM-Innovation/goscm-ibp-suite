// @vitest-environment jsdom
//
// La vista de una ejecución: lo que enseña de cada paso y qué botones ofrece.
//
// Lo que se mira es lo que se puede leer mal:
//   - «Completado con advertencias» no es un error (y no se pinta como uno);
//   - una carga SIN CONFIRMAR no es ni éxito ni error, y avisa que se revise antes de retomar;
//   - el error de CPI trae su código HTTP y su MPL ID;
//   - los botones dependen de si corre o no, y de si se puede retomar.

import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { grupoNuevo, pasoDeIntegracion } from '../../lib/ci-pasos.js'
import { boton, desmontar, dom, montar, pulsar, texto } from './ayudas-de-prueba.js'
import VistaDeEjecucion from './VistaDeEjecucion.jsx'

const resumen = (extra) => ({ valido: true, tipo: 'KEYFIGURES', comando: 'REPLACE', destino: '', variables: [], ...extra })
const INTEGRACIONES = [
  { id: 'int-a', name: 'MAESTRO', folder: 'AREA', resumen: resumen({ tipo: 'MASTERDATA', comando: 'INSERT_UPDATE', destino: 'SBPRODUCT' }) },
  { id: 'int-b', name: 'FACTURAS', folder: 'AREA', resumen: resumen({ destino: 'SBINVOICE' }) },
  { id: 'int-c', name: 'PRODUCCION', folder: '', resumen: resumen() },
]
const porId = new Map(INTEGRACIONES.map((una) => [una.id, una]))

const paso = (id, integracion) => pasoDeIntegracion(INTEGRACIONES.find((una) => una.id === integracion), id)
const PASOS = [
  paso('p1', 'int-a'),
  { ...grupoNuevo('g'), label: 'Cifras', children: [paso('p2', 'int-b'), paso('p3', 'int-c')] },
  paso('p4', 'int-a'),
]

const estado = (status, extra = {}) => ({
  nodeId: 'x', status, startedAt: '2026-10-14T12:00:00.000Z',
  finishedAt: status === 'running' || status === 'pending' ? null : '2026-10-14T12:00:21.000Z',
  error: null, retryCount: 0, ...extra,
})
const delGrupo = (status, children) => ({ ...estado(status), type: 'group', children })
const ejecucion = (status, nodes, extra = {}) => ({
  status,
  startedAt: '2026-10-14T12:00:00.000Z',
  finishedAt: status === 'running' ? null : '2026-10-14T12:01:00.000Z',
  defaults: { startedBy: { email: 'a@x.com' }, variables: { DESDE: '20261005' } },
  nodes,
  ...extra,
})

const props = (run, extra = {}) => ({
  run,
  pasos: PASOS,
  porId,
  nombre: 'Carga diaria',
  enMarcha: run.status === 'running',
  ocupado: false,
  error: '',
  puedeRetomar: false,
  mismaVersion: true,
  onCancelar: vi.fn(),
  onRetomar: vi.fn(),
  onVolver: vi.fn(),
  ...extra,
})

const enMarcha = () => ejecucion('running', {
  p1: estado('success', { detalle: { httpStatus: 200 } }),
  g: delGrupo('running', { p2: estado('running'), p3: estado('pending') }),
  p4: estado('pending'),
})

const terminada = () => ejecucion('success', {
  p1: estado('success', { detalle: { httpStatus: 200 } }),
  g: delGrupo('success', { p2: estado('success', { detalle: { httpStatus: 200 } }), p3: estado('success', { detalle: { httpStatus: 200 } }) }),
  p4: estado('success', { detalle: { httpStatus: 200 } }),
})

beforeEach(() => { vi.useFakeTimers() })

afterEach(async () => {
  await desmontar()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('una ejecución en marcha', () => {
  it('dice que está en ejecución, cuántos pasos van y quién la lanzó, con los valores usados', async () => {
    await montar(VistaDeEjecucion, props(enMarcha()))
    expect(texto()).toContain('Carga diaria')
    expect(texto()).toContain('En ejecución')
    // Cuenta las integraciones y no el grupo: 1 de 4 ya salió de la cola. Los pasos se numeran aparte: el grupo es UN paso.
    expect(texto()).toContain('1/4 integraciones')
    expect(texto()).toContain('lanzada por a@x.com')
    expect(texto()).toContain('{{DESDE}} = 20261005')
    expect(texto()).toContain('no la cierres hasta que termine')
  })

  it('ofrece cancelar, y no volver al editor', async () => {
    const p = props(enMarcha())
    await montar(VistaDeEjecucion, p)
    expect(boton('← Volver al editor')).toBeUndefined()
    await pulsar(boton('⊘ Cancelar'))
    expect(p.onCancelar).toHaveBeenCalledTimes(1)
  })

  it('mientras una acción está en curso no deja cancelar dos veces', async () => {
    await montar(VistaDeEjecucion, props(enMarcha(), { ocupado: true }))
    expect(boton('⊘ Cancelar').disabled).toBe(true)
  })

  it('el paso que corre cuenta el tiempo en vivo', async () => {
    vi.setSystemTime(new Date('2026-10-14T12:00:00.000Z'))
    await montar(VistaDeEjecucion, props(enMarcha()))
    expect(dom().querySelector('.ci-orq-tiempo').textContent).toBe('0 s')
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000) })
    expect(dom().querySelector('.ci-orq-tiempo').textContent).toBe('12 s')
  })

  it('cada paso dice su estado, y los del grupo van dentro de él', async () => {
    await montar(VistaDeEjecucion, props(enMarcha()))
    const filas = [...dom().querySelectorAll('.ci-orq-fila')].map((fila) => fila.textContent)
    expect(filas).toHaveLength(4)
    expect(filas[0]).toContain('1. MAESTRO')
    expect(filas[0]).toContain('Completado')
    expect(filas[0]).toContain('HTTP 200')
    expect(filas[1]).toContain('FACTURAS')
    expect(filas[1]).toContain('En ejecución')
    expect(filas[2]).toContain('PRODUCCION')
    expect(filas[2]).toContain('Pendiente')
    expect(filas[3]).toContain('3. MAESTRO')

    expect(dom().querySelectorAll('.ci-orq-grupo-fila')).toHaveLength(1)
    expect(dom().querySelector('.ci-orq-grupo-fila').textContent).toContain('Cifras')
    expect(dom().querySelectorAll('.ci-orq-fila.hijo')).toHaveLength(2)
  })

  it('un grupo sin descripción se llama «Grupo paralelo · paso N»', async () => {
    await montar(VistaDeEjecucion, props(enMarcha(), { pasos: [PASOS[0], { ...PASOS[1], label: '' }, PASOS[2]] }))
    expect(dom().querySelector('.ci-orq-grupo-fila').textContent).toContain('Grupo paralelo · paso 2')
  })
})

describe('una ejecución terminada', () => {
  it('bien: «Completada», cuánto duró, y «← Volver al editor»', async () => {
    const p = props(terminada())
    await montar(VistaDeEjecucion, p)
    expect(texto()).toContain('Completada')
    expect(texto()).not.toContain('Completada con advertencias')
    expect(texto()).toContain('4/4 integraciones')
    expect(texto()).toContain('1 min')
    expect(boton('⊘ Cancelar')).toBeUndefined()
    await pulsar(boton('← Volver al editor'))
    expect(p.onVolver).toHaveBeenCalledTimes(1)
  })

  // IBP puede rechazar un registro sin que la carga haya fallado: no es un error y no detiene lo siguiente.
  it('con un paso con advertencias, dice «Completada con advertencias» y no pinta error', async () => {
    const run = ejecucion('success', {
      p1: estado('success_with_errors', { detalle: { httpStatus: 500, mplId: 'AGrOoIkGv-d7sJej0DVu0bhXLV8K', mensaje: 'rechazó el registro 7' } }),
      g: delGrupo('success', { p2: estado('success'), p3: estado('success') }),
      p4: estado('success'),
    })
    await montar(VistaDeEjecucion, props(run))

    expect(texto()).toContain('Completada con advertencias')
    expect(dom().querySelector('.ci-orq-ejecucion-titulo .ci-orq-texto-aviso')).not.toBeNull()
    expect(dom().querySelector('.ci-orq-ejecucion-titulo .ci-orq-texto-mal')).toBeNull()
    // El paso: su estado, lo que contestó CPI y qué hacer.
    expect(texto()).toContain('Completado con advertencias')
    expect(texto()).toContain('CPI respondió 500 y no 200 (OK)')
    expect(texto()).toContain('no es necesariamente un error')
    expect(texto()).toContain('AGrOoIkGv-d7sJej0DVu0bhXLV8K')
    expect(texto()).toContain('rechazó el registro 7')
    expect(dom().querySelector('.ci-orq-fila .ci-orq-icono-mal')).toBeNull()
  })

  it('una advertencia dentro de un grupo también lo dice', async () => {
    const run = ejecucion('success', {
      p1: estado('success'),
      g: delGrupo('success', { p2: estado('success_with_errors', { detalle: { httpStatus: 202 } }), p3: estado('success') }),
      p4: estado('success'),
    })
    await montar(VistaDeEjecucion, props(run))
    expect(texto()).toContain('Completada con advertencias')
    expect(texto()).toContain('CPI respondió 202 y no 200 (OK)')
  })

  it('con error: el código HTTP, el MPL ID y el mensaje de CPI; lo siguiente, omitido', async () => {
    const run = ejecucion('error', {
      p1: estado('error', { error: 'HTTP 500: An internal server error occured', detalle: { httpStatus: 500, mplId: 'AGrOoIkGv-d7sJej0DVu0bhXLV8K' } }),
      g: { ...estado('skipped'), type: 'group', children: { p2: estado('skipped'), p3: estado('skipped') } },
      p4: estado('skipped'),
    })
    await montar(VistaDeEjecucion, props(run))

    expect(texto()).toContain('Terminó con error')
    expect(texto()).toContain('HTTP 500')
    expect(texto()).toContain('AGrOoIkGv-d7sJej0DVu0bhXLV8K')
    expect(texto()).toContain('An internal server error occured')
    expect(texto()).toContain('Omitido')
    expect(dom().querySelector('.ci-orq-fila .ci-orq-icono-mal')).not.toBeNull()
  })

  it('el MPL ID se puede copiar', async () => {
    const run = ejecucion('error', {
      p1: estado('error', { error: 'HTTP 500: x', detalle: { httpStatus: 500, mplId: 'MPL-123' } }),
      g: { ...estado('skipped'), type: 'group', children: {} },
      p4: estado('skipped'),
    })
    await montar(VistaDeEjecucion, props(run))
    expect(dom().querySelector('.ci-resultado-mpl button')).not.toBeNull()
  })

  // No es éxito ni error: la carga pudo haber entrado.
  it('un paso sin confirmar no se pinta de error y avisa que se revise antes de repetir', async () => {
    const run = ejecucion('error', {
      p1: estado('error', { error: 'Sin confirmar: se interrumpió', detalle: { httpStatus: null, sinConfirmar: true } }),
      g: { ...estado('skipped'), type: 'group', children: {} },
      p4: estado('skipped'),
    })
    await montar(VistaDeEjecucion, props(run))

    const fila = dom().querySelector('.ci-orq-fila')
    expect(fila.textContent).toContain('Sin confirmar')
    expect(fila.querySelector('.ci-orq-icono-duda')).not.toBeNull()
    expect(fila.querySelector('.ci-orq-icono-mal')).toBeNull()
    expect(texto()).toContain('Sin confirmar: la carga pudo haber entrado')
  })

  it('cancelada: «Cancelada», y lo cancelado como duda, no como error', async () => {
    const run = ejecucion('cancelled', {
      p1: estado('success'),
      g: delGrupo('cancelled', { p2: estado('cancelled'), p3: estado('cancelled') }),
      p4: estado('cancelled'),
    })
    await montar(VistaDeEjecucion, props(run))
    expect(texto()).toContain('Cancelada')
    expect(texto()).toContain('Cancelado')
    expect(dom().querySelector('.ci-orq-ejecucion-titulo .ci-orq-texto-duda')).not.toBeNull()
  })

  it('un reintento dice en qué intento va', async () => {
    const run = ejecucion('running', {
      p1: estado('running', { retryCount: 1 }),
      g: delGrupo('pending', { p2: estado('pending'), p3: estado('pending') }),
      p4: estado('pending'),
    })
    await montar(VistaDeEjecucion, props(run))
    expect(texto()).toContain('intento 2')
  })

  it('un paso que no está en la ejecución no se enseña', async () => {
    const run = ejecucion('success', { p1: estado('success') })
    await montar(VistaDeEjecucion, props(run, { mismaVersion: false }))
    expect(dom().querySelectorAll('.ci-orq-fila')).toHaveLength(1)
    expect(dom().querySelectorAll('.ci-orq-grupo-fila')).toHaveLength(0)
  })
})

describe('retomar', () => {
  const conError = () => ejecucion('error', {
    p1: estado('success'),
    g: delGrupo('error', { p2: estado('error', { error: 'HTTP 400: x', detalle: { httpStatus: 400 } }), p3: estado('success') }),
    p4: estado('skipped'),
  })

  it('«↺ Retomar» solo está si se puede', async () => {
    await montar(VistaDeEjecucion, props(conError(), { puedeRetomar: false }))
    expect(boton('↺ Retomar')).toBeUndefined()
    await desmontar()

    const p = props(conError(), { puedeRetomar: true })
    await montar(VistaDeEjecucion, p)
    await pulsar(boton('↺ Retomar'))
    expect(p.onRetomar).toHaveBeenCalledTimes(1)
  })

  it('si la orquestación cambió después, lo dice', async () => {
    await montar(VistaDeEjecucion, props(conError(), { mismaVersion: false }))
    expect(texto()).toContain('La orquestación cambió después de esta ejecución')
    expect(texto()).toContain('ya no se puede retomar')
  })

  it('con la misma versión no dice nada de eso', async () => {
    await montar(VistaDeEjecucion, props(conError()))
    expect(texto()).not.toContain('cambió después')
  })

  it('un error de una acción (retomar, cancelar) se enseña', async () => {
    await montar(VistaDeEjecucion, props(conError(), { error: 'Ya hay una ejecución activa' }))
    expect(texto()).toContain('Ya hay una ejecución activa')
  })
})

// Las ejecuciones del editor de etapas no tienen el grupo: sus integraciones están sueltas en el primer nivel.
describe('una ejecución del editor de etapas', () => {
  const sueltas = () => ejecucion('error', {
    p1: estado('success', { detalle: { httpStatus: 200 } }),
    p2: estado('error', { error: 'HTTP 500: x', detalle: { httpStatus: 500, mplId: 'MPL-7' } }),
    p3: estado('success', { detalle: { httpStatus: 200 } }),
    p4: estado('skipped'),
  })

  it('enseña las integraciones del grupo aunque la ejecución no tenga el grupo', async () => {
    await montar(VistaDeEjecucion, props(sueltas()))
    const filas = [...dom().querySelectorAll('.ci-orq-fila')].map((fila) => fila.textContent)
    expect(filas).toHaveLength(4)
    expect(filas[1]).toContain('FACTURAS')
    expect(filas[1]).toContain('MPL-7')
    expect(filas[2]).toContain('PRODUCCION')
    expect(dom().querySelector('.ci-orq-grupo-fila').textContent).toContain('Cifras')
    // El grupo no tiene estado propio: no inventa uno.
    expect(dom().querySelector('.ci-orq-grupo-fila .ci-orq-fila-estado')).toBeNull()
  })
})

// Lo que la orquestación cambió de una integración al enviarla queda en el detalle del paso: se ve en la ejecución.
describe('una ejecución con ajustes', () => {
  const CAMBIOS = [
    { clave: 'version', etiqueta: 'Versión', de: 'PVSMD', a: 'PV2', fuente: 'orquestacion' },
    { clave: 'comando', etiqueta: 'Comando', de: 'INSERT_UPDATE', a: 'REPLACE', fuente: 'paso' },
  ]

  it('el paso lo dice, con lo que cambió', async () => {
    const run = ejecucion('success', {
      p1: estado('success', { detalle: { httpStatus: 200, ajustes: CAMBIOS } }),
      g: delGrupo('success', { p2: estado('success', { detalle: { httpStatus: 200 } }), p3: estado('success', { detalle: { httpStatus: 200, ajustes: [] } }) }),
      p4: estado('success', { detalle: { httpStatus: 200 } }),
    })
    await montar(VistaDeEjecucion, props(run))

    const filas = [...dom().querySelectorAll('.ci-orq-fila')]
    expect(filas[0].textContent).toContain('Con ajustes')
    expect(filas[0].textContent).toContain('Versión: PVSMD → PV2 · Comando: INSERT_UPDATE → REPLACE')
    // Los que no llevaron ajustes no dicen nada.
    expect(filas.slice(1).every((fila) => !fila.textContent.includes('Con ajustes'))).toBe(true)
  })

  it('un paso con ajustes dentro de un grupo también', async () => {
    const run = ejecucion('success', {
      p1: estado('success'),
      g: delGrupo('success', { p2: estado('success', { detalle: { httpStatus: 200, ajustes: CAMBIOS } }), p3: estado('success') }),
      p4: estado('success'),
    })
    await montar(VistaDeEjecucion, props(run))
    expect(dom().querySelectorAll('.ci-orq-fila.hijo')[0].textContent).toContain('Con ajustes')
  })
})

describe('sin ejecución', () => {
  it('no dibuja nada', async () => {
    await montar(VistaDeEjecucion, { ...props(enMarcha()), run: null })
    expect(dom().textContent).toBe('')
  })
})
