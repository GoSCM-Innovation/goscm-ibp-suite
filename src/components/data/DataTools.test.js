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

const { default: DataTools } = await import('./DataTools.jsx')
const { conectar, desconectar } = await import('../../lib/conexion-activa.js')

let raiz
let contenedor

const dibujar = (props = {}) => act(async () => {
  raiz.render(createElement(DataTools, { appId: 'bom', ...props }))
})

beforeEach(async () => {
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
