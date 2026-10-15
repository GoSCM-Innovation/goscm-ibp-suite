// @vitest-environment jsdom
//
// El módulo CI Tools: la tira de conexiones, sus tres vistas y el historial.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ci = {
  listCiConnections: vi.fn(),
  listIntegraciones: vi.fn(),
  listarEjecuciones: vi.fn(),
}
vi.mock('../../lib/ci.js', async (importOriginal) => ({ ...(await importOriginal()), ...ci }))
vi.mock('../../lib/orchestrations.js', async (importOriginal) => ({
  ...(await importOriginal()),
  listOrchestrations: vi.fn(async () => []),
}))

const { default: CiTools } = await import('./CiTools.jsx')
const { default: Historial } = await import('./Historial.jsx')
const { olvidarGuarda } = await import('../../lib/guarda-de-salida.js')
const { asentar, boton, desmontar, dom, escribir, montar, porEtiqueta, pulsar, texto } = await import('./ayudas-de-prueba.js')

const DEV = { id: 'c-dev', name: 'STARBRANDS DEV', baseUrl: 'https://dev.it-cpi034-rt.cfapps.us10-002.hana.ondemand.com/http/IBP2', isProduction: false, agreements: ['CI'] }
const PRD = { id: 'c-prd', name: 'STARBRANDS PRD', baseUrl: 'https://prd.it-cpi034-rt.cfapps.us10-002.hana.ondemand.com/http/IBP2', isProduction: true, agreements: ['CI'] }

beforeEach(() => {
  vi.clearAllMocks()
  olvidarGuarda()
  ci.listCiConnections.mockResolvedValue([DEV, PRD])
  ci.listIntegraciones.mockResolvedValue([])
  ci.listarEjecuciones.mockResolvedValue([])
})

afterEach(desmontar)

const montarModulo = async () => {
  await montar(CiTools)
  await asentar()
}

describe('las conexiones', () => {
  it('muestra una pestaña por conexión, con la primera activa', async () => {
    await montarModulo()
    const pestanas = [...dom().querySelectorAll('.conn-tab')]
    expect(pestanas.map((p) => p.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('STARBRANDS DEV'), expect.stringContaining('STARBRANDS PRD')]))
    expect(pestanas[0].classList.contains('active')).toBe(true)
    expect(ci.listIntegraciones).toHaveBeenCalledWith('c-dev')
  })

  it('pide solo las conexiones de tipo Cloud Integration', async () => {
    await montarModulo()
    expect(ci.listCiConnections).toHaveBeenCalledTimes(1)
  })

  it('cambiar de conexión empieza de cero con la biblioteca de esa conexión', async () => {
    await montarModulo()
    await pulsar([...dom().querySelectorAll('.conn-tab')][1])
    await asentar()
    expect(ci.listIntegraciones).toHaveBeenCalledWith('c-prd')
  })

  it('sin conexiones explica cómo darlas de alta', async () => {
    ci.listCiConnections.mockResolvedValue([])
    await montarModulo()
    expect(texto()).toContain('No hay ninguna conexión a Cloud Integration')
    expect(texto()).toContain('Administración → Conexiones')
  })

  it('si no se pueden leer las conexiones, lo dice', async () => {
    ci.listCiConnections.mockRejectedValue(new Error('Este módulo no está contratado.'))
    await montarModulo()
    expect(texto()).toContain('Este módulo no está contratado.')
  })
})

describe('las vistas', () => {
  it('tiene Integraciones, Orquestaciones e Historial, y abre la primera', async () => {
    await montarModulo()
    const vistas = [...dom().querySelectorAll('.ci-vistas [role="tab"]')]
    expect(vistas.map((v) => v.textContent)).toEqual(['Integraciones', 'Orquestaciones', 'Historial'])
    expect(vistas[0].getAttribute('aria-selected')).toBe('true')
  })

  it('el historial se lee al abrirlo', async () => {
    await montarModulo()
    expect(ci.listarEjecuciones).not.toHaveBeenCalled()
    await pulsar([...dom().querySelectorAll('.ci-vistas [role="tab"]')][2])
    await asentar()
    expect(ci.listarEjecuciones).toHaveBeenCalledWith('c-dev')
  })

  it('una vista abierta se queda montada al cambiar de pestaña', async () => {
    await montarModulo()
    await pulsar([...dom().querySelectorAll('.ci-vistas [role="tab"]')][1])
    await asentar()
    await pulsar([...dom().querySelectorAll('.ci-vistas [role="tab"]')][0])
    // La biblioteca sigue ahí (oculta o visible) y no se volvió a pedir.
    expect(ci.listIntegraciones.mock.calls.filter(([id]) => id === 'c-dev').length).toBeLessThanOrEqual(2)
  })
})

describe('el historial', () => {
  const EJECUCIONES = [
    { id: 'r-1', integrationName: 'FACTURAS', folder: 'AREA', origin: 'manual', userEmail: 'ana@x.com', status: 'success', httpStatus: 200, durationMs: 21_430, mplId: null, message: 'OK', variables: { DESDE: '20261005' }, startedAt: '2026-10-14T12:00:00Z', orchestrationName: null },
    { id: 'r-2', integrationName: 'PRODUCTOS', folder: '', origin: 'orchestration', orchestrationName: 'Carga diaria', userEmail: 'luis@x.com', status: 'error', httpStatus: 500, durationMs: 3_000, mplId: 'AGrOoIkGv-d7sJej0DVu0bhXLV8K', message: 'An internal server error occured', variables: {}, startedAt: '2026-10-14T11:00:00Z' },
    { id: 'r-3', integrationName: 'INVENTARIO', folder: '', origin: 'manual', userEmail: 'ana@x.com', status: 'unconfirmed', httpStatus: null, durationMs: null, mplId: null, message: 'No quedó registrada la respuesta', variables: {}, startedAt: '2026-10-14T10:00:00Z' },
  ]

  beforeEach(() => { ci.listarEjecuciones.mockResolvedValue(EJECUCIONES) })

  const montarHistorial = async () => { await montar(Historial, { connection: DEV }); await asentar() }

  it('dice quién ejecutó qué, de dónde vino y cómo salió', async () => {
    await montarHistorial()
    expect(texto()).toContain('FACTURAS')
    expect(texto()).toContain('ana@x.com')
    expect(texto()).toContain('Manual')
    expect(texto()).toContain('Orquestación · Carga diaria')
    expect(texto()).toContain('Completada')
    expect(texto()).toContain('Error')
    expect(dom().querySelectorAll('.ci-historial-fila')[1].textContent).toContain('500')
  })

  // Lo que quedó en duda no se pinta como éxito ni como error.
  it('lo sin confirmar tiene su propio estado', async () => {
    await montarHistorial()
    expect(texto()).toContain('Sin confirmar')
    expect(dom().querySelectorAll('.ci-estado-duda')).toHaveLength(1)
  })

  it('pulsar una fila despliega el mensaje, el MPL ID y los valores', async () => {
    await montarHistorial()
    expect(texto()).not.toContain('An internal server error occured')
    const filas = dom().querySelectorAll('.ci-historial-fila')
    await pulsar(filas[1])
    expect(texto()).toContain('An internal server error occured')
    expect(texto()).toContain('AGrOoIkGv-d7sJej0DVu0bhXLV8K')

    await pulsar(filas[0])
    expect(texto()).toContain('DESDE = 20261005')
  })

  it('se puede filtrar por texto y por estado', async () => {
    await montarHistorial()
    await escribir(porEtiqueta('Buscar en el historial'), 'luis')
    expect(dom().querySelectorAll('.ci-historial-fila')).toHaveLength(1)
    expect(texto()).toContain('PRODUCTOS')

    await escribir(porEtiqueta('Buscar en el historial'), '')
    await pulsar(boton('Sin confirmar'))
    expect(dom().querySelectorAll('.ci-historial-fila')).toHaveLength(1)
    expect(texto()).toContain('INVENTARIO')
  })

  it('también se busca por MPL ID', async () => {
    await montarHistorial()
    await escribir(porEtiqueta('Buscar en el historial'), 'agrooikgv')
    expect(dom().querySelectorAll('.ci-historial-fila')).toHaveLength(1)
  })

  it('sin ejecuciones lo dice', async () => {
    ci.listarEjecuciones.mockResolvedValue([])
    await montarHistorial()
    expect(texto()).toContain('Todavía no se ha ejecutado nada en esta conexión.')
  })

  it('un filtro sin resultados no dice que no hay historial', async () => {
    await montarHistorial()
    await escribir(porEtiqueta('Buscar en el historial'), 'zzz')
    expect(texto()).toContain('Ninguna ejecución coincide con el filtro.')
  })

  it('actualizar vuelve a pedir el historial', async () => {
    await montarHistorial()
    await pulsar(boton('↺ Actualizar'))
    await asentar()
    expect(ci.listarEjecuciones).toHaveBeenCalledTimes(2)
  })

  it('si no se puede leer, lo dice', async () => {
    ci.listarEjecuciones.mockRejectedValue(new Error('Falta la conexión.'))
    await montarHistorial()
    expect(texto()).toContain('Falta la conexión.')
  })
})

describe('las pestañas de vista suben a la tira de conexiones', () => {
  const vistasDeLaTira = () => dom().querySelector('.conn-tabs-fila .conn-tabs-derecha')
  const pestanaDeVista = (nombre) => [...vistasDeLaTira().querySelectorAll('[role="tab"]')].find((t) => t.textContent === nombre)

  it('Integraciones, Orquestaciones e Historial van en la misma fila que las conexiones, no en otra', async () => {
    await montarModulo()
    expect([...vistasDeLaTira().querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Integraciones', 'Orquestaciones', 'Historial'])
    expect(vistasDeLaTira().querySelector('[aria-selected="true"]').textContent).toBe('Integraciones')
    // Ya no hay una fila de pestañas aparte debajo de la tira.
    expect(dom().querySelector('.ci-sistema > .ci-vistas')).toBeNull()
  })

  it('pulsar una cambia de vista', async () => {
    await montarModulo()
    await pulsar(pestanaDeVista('Historial'))
    await asentar()
    expect(pestanaDeVista('Historial').getAttribute('aria-selected')).toBe('true')
    expect(ci.listarEjecuciones).toHaveBeenCalled()
  })

  it('cambiar de conexión vuelve a «Integraciones»', async () => {
    await montarModulo()
    await pulsar(pestanaDeVista('Historial'))
    await pulsar([...dom().querySelectorAll('.conn-tab')][1])
    await asentar()
    expect(pestanaDeVista('Integraciones').getAttribute('aria-selected')).toBe('true')
  })
})
