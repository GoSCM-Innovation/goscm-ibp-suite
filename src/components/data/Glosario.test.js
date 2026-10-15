// @vitest-environment jsdom
//
// El índice del Glosario Analyzers: pulsar una sección tiene que llevar el texto hasta ella.
//
// El caso que se rompió: el glosario dejó de ser una caja con su propio desplazamiento (la página crecía con el texto), `scrollTo` del
// contenedor no movía nada y el clic solo marcaba la sección. Se prueban los dos caminos: el contenedor que se desplaza y el que no.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Glosario from './Glosario.jsx'

let contenedor = null
let raiz = null

const montar = async () => {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(Glosario))
  })
}

const enlaces = () => [...contenedor.querySelectorAll('.glos-nav-link')]
const pulsar = (elemento) => act(async () => { elemento.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })

/** Hace que cualquier elemento diga que su texto es más alto que su caja (o no), como lo mediría un navegador de verdad. */
function medidas({ alto, caja }) {
  Object.defineProperty(Element.prototype, 'scrollHeight', { configurable: true, get: () => alto })
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => caja })
}

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(async () => {
  await act(async () => { raiz?.unmount() })
  contenedor?.remove()
  contenedor = null
  raiz = null
  delete Element.prototype.scrollTo
  delete Element.prototype.scrollIntoView
  delete Element.prototype.scrollHeight
  delete Element.prototype.clientHeight
  window.location.hash = ''
})

describe('el índice del glosario', () => {
  it('con el texto en su propia caja con desplazamiento, la desplaza hasta la sección', async () => {
    medidas({ alto: 5000, caja: 500 })
    await montar()
    await pulsar(enlaces()[1])

    expect(Element.prototype.scrollTo).toHaveBeenCalledTimes(1)
    expect(Element.prototype.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth', top: expect.any(Number) }))
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  // Es lo que pasaba: la caja no se desplaza y `scrollTo` no hace nada. Quien se desplaza es la página.
  it('con el texto que no se desplaza por sí solo, lleva la sección a la vista desplazando la página', async () => {
    medidas({ alto: 500, caja: 500 })
    await montar()
    const enlace = enlaces()[2]
    await pulsar(enlace)

    expect(Element.prototype.scrollTo).not.toHaveBeenCalled()
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    // La sección a la que se va es la del enlace.
    expect(Element.prototype.scrollIntoView.mock.contexts[0].id).toBe(enlace.getAttribute('href').slice(1))
  })

  it('el enlace no cambia la dirección de la página: el enrutador usa el # y se perdería la pantalla', async () => {
    medidas({ alto: 5000, caja: 500 })
    window.location.hash = '#/explorer/glosario'
    await montar()
    await pulsar(enlaces()[1])
    expect(window.location.hash).toBe('#/explorer/glosario')
  })

  it('marca la sección elegida', async () => {
    medidas({ alto: 5000, caja: 500 })
    await montar()
    await pulsar(enlaces()[3])
    expect(enlaces()[3].classList.contains('active')).toBe(true)
    expect(enlaces().filter((uno) => uno.classList.contains('active'))).toHaveLength(1)
  })

  it('cada pestaña trae sus secciones, y cambiar de una a otra limpia la marca', async () => {
    medidas({ alto: 5000, caja: 500 })
    await montar()
    const deProduccion = enlaces().map((uno) => uno.getAttribute('href'))
    await pulsar(enlaces()[1])

    const botonRed = [...contenedor.querySelectorAll('.glosario-mod-btn')].find((uno) => uno.textContent.includes('Network Analyzer'))
    await pulsar(botonRed)
    const deRed = enlaces().map((uno) => uno.getAttribute('href'))
    expect(deRed).not.toEqual(deProduccion)
    expect(enlaces().some((uno) => uno.classList.contains('active'))).toBe(false)
  })
})
