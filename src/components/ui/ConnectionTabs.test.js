// @vitest-environment jsdom
//
// La tira de pestañas de conexiones: TODAS las conexiones a la vista, una pestaña por cada una.
//
// Antes solo se dibujaban las «abiertas» y el resto quedaba tras un «+». El usuario pidió el
// 2026-10-05 que estén todas visibles, así que ya no hay «abrir», «cerrar» ni «+».

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ConnectionTabs from './ConnectionTabs.jsx'

const CONEXIONES = [
  { id: 'a', name: 'IBP AGROSUPER QA', isProduction: false },
  { id: 'b', name: 'IBP CONSENSO QA', isProduction: false },
  { id: 'c', name: 'IBP AGROSUPER PRD', isProduction: true },
]

let contenedor
let raiz
let onElegir

async function montar(props = {}) {
  onElegir = vi.fn()
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(ConnectionTabs, {
      conexiones: CONEXIONES,
      activa: 'a',
      onElegir,
      ...props,
    }))
  })
}

const pulsar = async (elemento) => {
  await act(async () => {
    elemento.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

const pestanas = () => [...contenedor.querySelectorAll('.conn-tab-nombre')].map((uno) => uno.textContent)

beforeEach(() => { vi.clearAllMocks() })

afterEach(async () => {
  await act(async () => { raiz?.unmount() })
  contenedor?.remove()
})

describe('las pestañas', () => {
  it('se dibuja una por cada conexión, sin esconder ninguna', async () => {
    await montar()
    expect(pestanas()).toEqual(['IBP AGROSUPER QA', 'IBP CONSENSO QA', 'IBP AGROSUPER PRD'])
  })

  it('marca como activa solo la elegida', async () => {
    await montar({ activa: 'b' })
    const activas = [...contenedor.querySelectorAll('.conn-tab.active .conn-tab-nombre')]
    expect(activas.map((uno) => uno.textContent)).toEqual(['IBP CONSENSO QA'])
  })

  it('pulsar una cualquiera la elige, sin pasos previos', async () => {
    await montar()
    await pulsar(contenedor.querySelectorAll('.conn-tab')[2])
    expect(onElegir).toHaveBeenCalledWith('c')
  })

  it('ya no hay «+» ni ✕: no hay nada que abrir ni que cerrar', async () => {
    await montar()
    expect(contenedor.querySelector('.conn-tabs-mas')).toBeNull()
    expect(contenedor.querySelector('.conn-tab-cerrar')).toBeNull()
  })

  it('la marca de productivo va en la pestaña, que es lo que cambia lo que uno hace ahí', async () => {
    await montar({ activa: 'c' })
    const puntos = [...contenedor.querySelectorAll('.conn-tab-punto')]
    expect(puntos.map((uno) => uno.classList.contains('productivo'))).toEqual([false, false, true])
  })
})

describe('la pestaña fija de inicio', () => {
  it('va delante de las conexiones y, activa, desmarca la conexión', async () => {
    const alElegirInicio = vi.fn()
    await montar({ inicio: { icono: '📊', nombre: 'Resumen', activa: true, onElegir: alElegirInicio } })

    expect(pestanas()).toEqual(['Resumen', 'IBP AGROSUPER QA', 'IBP CONSENSO QA', 'IBP AGROSUPER PRD'])
    expect(contenedor.querySelectorAll('.conn-tab.active')).toHaveLength(1)

    await pulsar(contenedor.querySelectorAll('.conn-tab')[0])
    expect(alElegirInicio).toHaveBeenCalled()
  })
})

describe('sin nada que enseñar', () => {
  it('sin conexiones no dibuja la tira', async () => {
    await montar({ conexiones: [] })
    expect(contenedor.querySelector('.conn-tabs-fila')).toBeNull()
  })
})
