// @vitest-environment jsdom
//
// El historial de ejecuciones: lo que cuenta de cada una. Aquí, que una ejecución de una orquestación con AJUSTES lo diga, y cuáles fueron.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/ci.js', async (importOriginal) => ({ ...(await importOriginal()), listarEjecuciones: vi.fn() }))

const { listarEjecuciones } = await import('../../lib/ci.js')
const { default: Historial } = await import('./Historial.jsx')
const { asentar, desmontar, dom, montar, pulsar, texto } = await import('./ayudas-de-prueba.js')

const CONEXION = { id: 'conn-1', name: 'CPI desarrollo', baseUrl: 'https://acme.it-cpi034-rt.cfapps.us10-002.hana.ondemand.com/http/IBP2' }

const ejecucion = (id, extra = {}) => ({
  id, integrationId: `int-${id}`, integrationName: `INTEGRACION ${id}`, folder: 'AREA', orchestrationId: null, orchestrationName: null,
  origin: 'manual', userEmail: 'a@x.com', status: 'success', httpStatus: 200, durationMs: 12_000, mplId: null, message: 'OK',
  variables: {}, ajustes: [], startedAt: '2026-10-15T12:00:00.000Z', finishedAt: '2026-10-15T12:00:12.000Z', ...extra,
})

const CAMBIOS = [
  { clave: 'version', etiqueta: 'Versión', de: 'PVSMD', a: 'PV2', fuente: 'orquestacion' },
  { clave: 'filtro', campo: 'KEYFIGUREDATE', etiqueta: 'KEYFIGUREDATE', de: '20260101 → 20271231', a: '20260301 → 20260331', fuente: 'paso' },
]

beforeEach(() => { vi.clearAllMocks() })
afterEach(desmontar)

const montarCon = async (lista) => {
  listarEjecuciones.mockResolvedValue(lista)
  await montar(Historial, { connection: CONEXION })
  await asentar()
}

describe('el historial', () => {
  it('sin ejecuciones lo dice', async () => {
    await montarCon([])
    expect(texto()).toContain('Todavía no se ha ejecutado nada en esta conexión.')
  })

  it('una ejecución de siempre no lleva marca de ajustes', async () => {
    await montarCon([ejecucion('a')])
    expect(texto()).toContain('INTEGRACION a')
    expect(dom().querySelector('.ci-orq-ajustes-chip')).toBeNull()
  })

  // Quien mira el historial tiene que saber que esa carga NO salió como dice la integración.
  it('una ejecución con ajustes lo marca en su fila', async () => {
    await montarCon([ejecucion('a', { origin: 'orchestration', orchestrationName: 'Carga mensual', ajustes: CAMBIOS }), ejecucion('b')])
    const filas = [...dom().querySelectorAll('.ci-historial-fila')]
    expect(filas[0].querySelector('.ci-orq-ajustes-chip').textContent).toBe('con ajustes')
    expect(filas[1].querySelector('.ci-orq-ajustes-chip')).toBeNull()
  })

  it('al abrirla dice cuáles fueron los cambios', async () => {
    await montarCon([ejecucion('a', { origin: 'orchestration', ajustes: CAMBIOS })])
    await pulsar(dom().querySelector('.ci-historial-fila'))

    const detalle = dom().querySelector('.ci-historial-detalle')
    expect(detalle.textContent).toContain('Con ajustes:')
    const codigos = [...detalle.querySelectorAll('code')].map((c) => c.textContent)
    expect(codigos).toContain('Versión: PVSMD → PV2')
    expect(codigos).toContain('KEYFIGUREDATE: 20260101 → 20271231 → 20260301 → 20260331')
  })

  it('una ejecución sin ajustes no dice nada de ajustes al abrirla', async () => {
    await montarCon([ejecucion('a')])
    await pulsar(dom().querySelector('.ci-historial-fila'))
    expect(dom().querySelector('.ci-historial-detalle').textContent).not.toContain('Con ajustes')
  })

  it('una ejecución anterior a los ajustes (sin el dato) se lee igual', async () => {
    const vieja = ejecucion('a')
    delete vieja.ajustes
    await montarCon([vieja])
    await pulsar(dom().querySelector('.ci-historial-fila'))
    expect(dom().querySelector('.ci-orq-ajustes-chip')).toBeNull()
  })
})
