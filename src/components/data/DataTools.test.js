// @vitest-environment jsdom
//
// El «parpadeo» del mapeo de entidades. La aplicación relee la sesión cada vez que se vuelve a su
// pestaña del navegador o se cambia de sección, y eso redibuja Data Tools. Si el destino se
// recalculaba como un objeto nuevo en cada dibujo, el mapeo creía que el destino había cambiado, se
// vaciaba y volvía a pedir las tablas a SAP: se veía como un refresco «cada cierto tiempo».

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const vistos = []
vi.mock('./ProductionVisualizer.jsx', () => ({
  default: ({ destino }) => {
    vistos.push(destino)
    return createElement('div', { 'data-prueba': 'pv' })
  },
}))
vi.mock('./BarraDeTenant.jsx', () => ({ default: () => null }))
const CONEXIONES = [
  { id: 'c-1', name: 'TENANT UNO', isProduction: false, baseUrl: 'https://uno' },
  { id: 'c-2', name: 'TENANT DOS', isProduction: true, baseUrl: 'https://dos' },
]
vi.mock('../../lib/ibp.js', () => ({ listIbpConnections: vi.fn(async () => CONEXIONES) }))
const fijar = vi.fn(async () => {})
vi.mock('../../lib/fijar-destino.js', () => ({ fijarDestino: (...args) => fijar(...args) }))

const { default: DataTools } = await import('./DataTools.jsx')
const { conectar, desconectar, conexionPreseleccionada, verAsistente } = await import('../../lib/conexion-activa.js')

let raiz
let contenedor

const dibujar = (props = {}) => act(async () => {
  raiz.render(createElement(DataTools, { appId: 'bom', ...props }))
})

beforeEach(async () => {
  fijar.mockClear()
  verAsistente(false)
  vistos.length = 0
  desconectar()
  conectar({ connectionId: 'c-1', nombre: 'T', planningArea: 'PA', version: 'V1' })
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  raiz = createRoot(contenedor)
  await dibujar()
})

afterEach(async () => {
  await act(async () => { raiz.unmount() })
  contenedor.remove()
})

describe('el destino que reciben las aplicaciones', () => {
  it('es el MISMO objeto mientras no cambie el tenant, el área ni la versión', async () => {
    await dibujar()
    await dibujar()
    expect(vistos.length).toBeGreaterThanOrEqual(2)
    expect(new Set(vistos).size).toBe(1)
  })

  it('cambia de verdad cuando se elige otra versión', async () => {
    await act(async () => {
      conectar({ connectionId: 'c-1', nombre: 'T', planningArea: 'PA', version: 'V2' })
    })
    expect(new Set(vistos).size).toBe(2)
    expect(vistos.at(-1).versionId).toBe('V2')
  })
})

describe('sin aplicación elegida', () => {
  it('muestra la bienvenida y no monta ninguna aplicación', async () => {
    vistos.length = 0
    await dibujar({ appId: null })
    expect(contenedor.querySelector('[data-prueba="pv"]')).toBeNull()
    expect(contenedor.querySelector('.data-tools-bienvenida')).not.toBeNull()
    expect(vistos).toHaveLength(0)
  })
})

describe('las pestañas de tenants', () => {
  const pestanas = () => [...contenedor.querySelectorAll('.conn-tab')]
  const nombres = () => pestanas().map((una) => una.querySelector('.conn-tab-nombre').textContent)
  const pulsar = (nodo) => act(async () => {
    nodo.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })

  it('están todas las conexiones, con la del destino activo marcada', () => {
    expect(nombres()).toEqual(['TENANT UNO', 'TENANT DOS'])
    const activas = contenedor.querySelectorAll('.conn-tab.active .conn-tab-nombre')
    expect([...activas].map((una) => una.textContent)).toEqual(['TENANT UNO'])
  })

  it('pulsar un tenant al que no se le eligió área abre el asistente con ese tenant', async () => {
    await pulsar(pestanas()[1])
    expect(conexionPreseleccionada()).toBe('c-2')
    expect(fijar).not.toHaveBeenCalled()
  })

  it('pulsar uno ya elegido antes vuelve a su área y versión sin preguntar', async () => {
    await act(async () => {
      conectar({ connectionId: 'c-2', nombre: 'TENANT DOS', planningArea: 'PA2', version: 'V9' })
      conectar({ connectionId: 'c-1', nombre: 'T', planningArea: 'PA', version: 'V1' })
    })
    await pulsar(pestanas()[1])

    expect(fijar).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 'c-2', nombre: 'TENANT DOS', planningArea: 'PA2', version: 'V9', esProduccion: true,
    }))
  })

  it('pulsar el tenant activo no hace nada', async () => {
    await pulsar(pestanas()[0])
    expect(fijar).not.toHaveBeenCalled()
    expect(conexionPreseleccionada()).toBe('')
  })
})
