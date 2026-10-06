// @vitest-environment jsdom
//
// El marco de CI-DS Tools con la forma de v9 (revisión de paridad del 2026-10-05): la cabecera del
// sistema, la tira de pestañas siempre a la vista, el orden de las pestañas, y el explorador y el
// documentador que se quedan montados al cambiar de pestaña.

import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const montajes = { explorador: 0, documentador: 0 }
function Contador({ id }) {
  const [veces] = useState(() => { montajes[id] += 1; return montajes[id] })
  return createElement('div', { 'data-id': id }, `${id} montado ${veces}`)
}
vi.mock('./explorer/IntegrationExplorer.jsx', () => ({ default: () => createElement(Contador, { id: 'explorador' }) }))
vi.mock('./documenter/MappingDocumenter.jsx', () => ({ default: () => createElement(Contador, { id: 'documentador' }) }))
vi.mock('./Summary.jsx', () => ({ default: ({ destino }) => createElement('div', null, `Resumen de ${destino.label}`) }))
vi.mock('./GlobalSummary.jsx', () => ({ default: () => createElement('div', null, 'Tablero global') }))
vi.mock('./orchestrations/Orchestrations.jsx', () => ({ default: () => createElement('div', null, 'Orquestaciones') }))
vi.mock('./TaskLauncher.jsx', () => ({ default: () => createElement('div', null, 'Lanzador') }))
vi.mock('./TaskMonitor.jsx', () => ({
  default: ({ busqueda }) => createElement('div', { 'data-testid': 'monitor' }, `Monitor [${busqueda}]`),
}))

vi.mock('../../lib/run-logs.js', () => ({ lectorDeCids: () => () => {} }))
vi.mock('../../lib/cids.js', async (original) => ({
  ...(await original()),
  listCidsConnections: vi.fn(async () => [
    { id: 'c1', name: 'CLARO', baseUrl: 'https://claro.hana.ondemand.com/', organization: 'CLARO_ORG', isProduction: false },
    { id: 'c2', name: 'Grupo Consenso', baseUrl: 'https://gc.hana.ondemand.com/', organization: 'GC', isProduction: false },
  ]),
  fetchPromotedTaskNames: vi.fn(async () => null),
}))

const { default: CidsTools } = await import('./CidsTools.jsx')

let contenedor
let raiz

async function montar() {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(CidsTools))
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

beforeEach(() => { montajes.explorador = 0; montajes.documentador = 0 })

afterEach(() => {
  act(() => raiz?.unmount())
  contenedor?.remove()
})

const pestanas = () => [...contenedor.querySelectorAll('.tabs .tab')].map((uno) => uno.textContent)
const pulsar = async (texto, selector = '.tabs .tab') => {
  const boton = [...contenedor.querySelectorAll(selector)].find((uno) => uno.textContent.includes(texto))
  await act(async () => { boton.click() })
}

describe('el detalle del sistema va en la tira, no en una franja', () => {
  const detalle = () => contenedor.querySelector('.conn-detalle')
  const abrirDetalle = () => act(async () => { contenedor.querySelector('.conn-tab.active button[aria-label]').click() })

  it('ya no hay franja bajo la tira', async () => {
    await montar()
    expect(contenedor.querySelector('.cids-cabecera')).toBeNull()
  })

  it('el «ⓘ» de la pestaña activa dice dirección, organización y Sandbox, como la franja de v9', async () => {
    await montar()
    expect(detalle()).toBeNull()
    await abrirDetalle()
    expect(detalle().querySelector('.conn-detalle-titulo').textContent).toBe('CLARO')
    expect(detalle().textContent).toContain('https://claro.hana.ondemand.com/')
    expect(detalle().textContent).toContain('CLARO_ORG')
    expect(detalle().textContent).toContain('Sandbox')
  })

  it('en el destino productivo dice Producción', async () => {
    await montar()
    await pulsar('CLARO · Productivo', '.conn-tab')
    await abrirDetalle()
    expect(detalle().textContent).toContain('Producción')
  })

  it('solo la pestaña activa lleva «ⓘ»', async () => {
    await montar()
    expect(contenedor.querySelectorAll('.conn-tab button[aria-label]')).toHaveLength(1)
  })

  it('cambiar de pestaña cierra el detalle', async () => {
    await montar()
    await abrirDetalle()
    await pulsar('CLARO · Productivo', '.conn-tab')
    expect(detalle()).toBeNull()
  })
})

describe('pestañas', () => {
  it('el Mapping Dataflow Generator va antes que el Integration Explorer, como en el menú de v9', async () => {
    await montar()
    const lista = pestanas()
    expect(lista.indexOf('Mapping Dataflow Generator')).toBeLessThan(lista.indexOf('Integration Explorer'))
    expect(lista.slice(1, 5)).toEqual(['Resumen', 'Projects & Tasks', 'Task Monitor', 'Orquestaciones'])
  })

  it('las pestañas de destino se ven también en el tablero global y en el explorador', async () => {
    await montar()
    await pulsar('Resumen Global')
    expect(contenedor.querySelector('.conn-tabs')).not.toBeNull()
    await pulsar('Integration Explorer')
    expect(contenedor.querySelector('.conn-tabs')).not.toBeNull()
  })

  it('elegir una pestaña de destino desde el tablero global lleva a su Resumen', async () => {
    await montar()
    await pulsar('Resumen Global')
    await pulsar('Grupo Consenso · Sandbox', '.conn-tab')
    expect(contenedor.textContent).toContain('Resumen de Grupo Consenso · Sandbox')
  })
})

describe('explorador y documentador', () => {
  it('se montan al visitarlos y se quedan montados al cambiar de pestaña', async () => {
    await montar()
    expect(montajes.explorador).toBe(0)

    await pulsar('Integration Explorer')
    expect(montajes.explorador).toBe(1)

    await pulsar('Resumen')
    // Sigue en el árbol, escondido: no se vuelve a montar al regresar.
    expect(contenedor.querySelector('[data-id="explorador"]')).not.toBeNull()
    expect(contenedor.querySelector('[data-id="explorador"]').parentElement.style.display).toBe('none')

    await pulsar('Integration Explorer')
    expect(montajes.explorador).toBe(1)
    expect(contenedor.querySelector('[data-id="explorador"]').parentElement.style.display).toBe('contents')
  })

  it('el documentador también', async () => {
    await montar()
    await pulsar('Mapping Dataflow Generator')
    await pulsar('Task Monitor')
    await pulsar('Mapping Dataflow Generator')
    expect(montajes.documentador).toBe(1)
  })
})

describe('búsqueda del monitor', () => {
  it('se suelta al salir del monitor', async () => {
    await montar()
    await pulsar('Task Monitor')
    expect(contenedor.querySelector('[data-testid="monitor"]').textContent).toBe('Monitor []')
  })
})
