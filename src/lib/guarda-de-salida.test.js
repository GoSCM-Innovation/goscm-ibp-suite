// @vitest-environment jsdom
//
// La guarda que impide perder una copia en marcha al salir. Portada de v8, donde faltaba entera:
// ni el aviso del navegador al cerrar la pestaña, ni la confirmación al cambiar de pantalla.
//
// Importa porque las dos copias las encadena EL NAVEGADOR: salir a mitad corta la cadena, y lo que no
// se copió no se copia. Lo confirmado en SAP se queda, así que el aviso tiene que decir las dos cosas.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { olvidarGuarda, puedeSalir, useGuardaDeSalida } from './guarda-de-salida.js'

const MENSAJE = 'Hay una copia en marcha. ¿Salir igual?'

let contenedor
let raiz

/** Un componente que solo declara la guarda, para poder montarla y desmontarla. */
const Pantalla = ({ enCurso }) => {
  useGuardaDeSalida(enCurso, MENSAJE)
  return null
}

async function montar(enCurso) {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(Pantalla, { enCurso }))
  })
}

const volverAPintar = async (enCurso) => {
  await act(async () => { raiz.render(createElement(Pantalla, { enCurso })) })
}

beforeEach(() => {
  olvidarGuarda()
  vi.restoreAllMocks()
})

afterEach(async () => {
  if (raiz) await act(async () => { raiz.unmount() })
  contenedor?.remove()
  raiz = null
  olvidarGuarda()
})

describe('salir de la aplicación', () => {
  it('sin nada en marcha se sale sin preguntar', () => {
    const confirmar = vi.spyOn(window, 'confirm')
    expect(puedeSalir()).toBe(true)
    expect(confirmar).not.toHaveBeenCalled()
  })

  it('con una copia en marcha pregunta, y respeta el «sí»', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await montar(true)

    expect(puedeSalir()).toBe(true)
    expect(confirmar).toHaveBeenCalledWith(MENSAJE)
  })

  // Lo que de verdad protege: un «no» tiene que impedir la navegación.
  it('respeta el «no»', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await montar(true)
    expect(puedeSalir()).toBe(false)
  })

  it('cuando la copia termina se deja de preguntar', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await montar(true)
    await volverAPintar(false)

    expect(puedeSalir()).toBe(true)
    expect(confirmar).not.toHaveBeenCalled()
  })

  // Si la guarda sobreviviera al desmontaje, la aplicación quedaría preguntando para siempre.
  it('al irse la pantalla la guarda se va con ella', async () => {
    await montar(true)
    await act(async () => { raiz.unmount() })
    raiz = null

    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false)
    expect(puedeSalir()).toBe(true)
    expect(confirmar).not.toHaveBeenCalled()
  })
})

describe('cerrar o recargar la pestaña', () => {
  // Cerrar la pestaña NO dispara la confirmación de la aplicación: solo el navegador puede preguntar,
  // y solo si el evento se cancela.
  it('se cancela el evento del navegador mientras hay algo en marcha', async () => {
    await montar(true)

    const evento = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(evento)

    // Basta con que quede cancelado. Se escriben las dos vías —`preventDefault` y `returnValue`—
    // porque los navegadores no coinciden en cuál miran, pero en jsdom `returnValue` es el alias
    // antiguo de «no cancelado», así que leerlo da `false` justamente cuando SÍ está cancelado.
    expect(evento.defaultPrevented).toBe(true)
    expect(evento.returnValue).toBe(false)
  })

  it('sin nada en marcha el evento pasa sin tocarse', async () => {
    await montar(false)

    const evento = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(evento)

    expect(evento.defaultPrevented).toBe(false)
  })

  it('al irse la pantalla se deja de escuchar', async () => {
    await montar(true)
    await act(async () => { raiz.unmount() })
    raiz = null

    const evento = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(evento)

    expect(evento.defaultPrevented).toBe(false)
  })
})
