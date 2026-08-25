// @vitest-environment jsdom
//
// Pantalla completa. Faltaba en las seis pantallas de datos, y estaba en las ocho equivalentes de
// v7/v8/v9: el hueco vivía DENTRO de archivos que el inventario daba por portados, que es por lo que
// dos revisiones de paridad no lo vieron.

import { act, createElement, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { usePantallaCompleta } from './usePantallaCompleta.js'

/** El elemento que se pone a pantalla completa. Fuera del componente: no cambia nunca. */
const ELEMENTO = document.createElement('div')

let contenedor
let raiz
let leido

/**
 * Un componente que publica lo que devuelve el gancho.
 *
 * Por un efecto y no escribiendo una variable de fuera en el cuerpo: eso último es un efecto durante
 * el render, y el linter lo rechaza con razón.
 */
const Pantalla = ({ onLeer }) => {
  const ref = useRef(ELEMENTO)
  const api = usePantallaCompleta(ref)
  useEffect(() => { onLeer(api) })
  return null
}

/** Pone la API de pantalla completa que jsdom no trae. */
function conApi() {
  const pedir = vi.fn(() => Promise.resolve())
  const salir = vi.fn(() => Promise.resolve())
  document.documentElement.requestFullscreen = pedir
  Element.prototype.requestFullscreen = pedir
  document.exitFullscreen = salir
  Object.defineProperty(document, 'fullscreenElement', { value: null, writable: true, configurable: true })
  return { pedir, salir }
}

async function montar() {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(Pantalla, { onLeer: (api) => { leido = api } }))
  })
}

beforeEach(() => {
  delete document.documentElement.requestFullscreen
  delete Element.prototype.requestFullscreen
  delete document.exitFullscreen
})

afterEach(async () => {
  if (raiz) await act(async () => { raiz.unmount() })
  contenedor?.remove()
  raiz = null
})

describe('usePantallaCompleta', () => {
  // Un botón que no hace nada es peor que no tener botón: el componente lo esconde con esto.
  it('dice que no está disponible cuando el navegador no la trae', async () => {
    await montar()
    expect(leido.disponible).toBe(false)
    expect(leido.activa).toBe(false)
  })

  it('en un navegador que la trae, pide pantalla completa del elemento', async () => {
    const { pedir } = conApi()
    await montar()

    expect(leido.disponible).toBe(true)
    await act(async () => { leido.alternar() })
    expect(pedir).toHaveBeenCalledTimes(1)
  })

  it('estando a pantalla completa, sale', async () => {
    const { pedir, salir } = conApi()
    await montar()

    document.fullscreenElement = ELEMENTO
    await act(async () => { leido.alternar() })

    expect(salir).toHaveBeenCalledTimes(1)
    expect(pedir).not.toHaveBeenCalled()
  })

  // `activa` se sigue del evento del navegador y no de lo que pulsamos, porque hay más de una forma de
  // salir —Escape, F11—: fiándose del botón, acabaría diciendo «Salir» con la pantalla ya normal.
  it('sigue el estado por el evento del navegador, no por el botón', async () => {
    conApi()
    await montar()
    expect(leido.activa).toBe(false)

    document.fullscreenElement = ELEMENTO
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')) })
    expect(leido.activa).toBe(true)

    document.fullscreenElement = null
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')) })
    expect(leido.activa).toBe(false)
  })

  // Si el navegador se niega —falta el gesto, o está prohibido— la pantalla sigue funcionando igual.
  it('una negativa del navegador no rompe nada', async () => {
    conApi()
    Element.prototype.requestFullscreen = vi.fn(() => Promise.reject(new Error('no permitido')))
    await montar()

    await act(async () => { leido.alternar() })
    expect(leido.activa).toBe(false)
  })

  it('sin la API, pulsar no hace nada y no falla', async () => {
    await montar()
    await act(async () => { expect(() => leido.alternar()).not.toThrow() })
  })
})
