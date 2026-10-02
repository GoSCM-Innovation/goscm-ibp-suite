// @vitest-environment jsdom
//
// El modal «¿Cómo quieres ver el análisis?» (`askOutputMode` de v7): tres respuestas posibles y tres
// maneras de cancelar. Se monta con `react-dom` a secas y `createElement`, como el resto de las pruebas.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ModalModoDeSalida from './ModalModoDeSalida.jsx'

let raiz
let contenedor

async function montar(onElegir) {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(ModalModoDeSalida, { onElegir }))
  })
}

afterEach(async () => {
  await act(async () => { raiz?.unmount() })
  contenedor?.remove()
})

const opcion = (modo) => document.querySelector(`.snwv-opt[data-m="${modo}"]`)

describe('el contenido', () => {
  it('es un diálogo modal con el título, el texto y las tres opciones de v7', async () => {
    await montar(vi.fn())
    const dialogo = document.querySelector('[role="dialog"]')
    expect(dialogo.getAttribute('aria-modal')).toBe('true')
    expect(dialogo.querySelector('h3').textContent).toBe('¿Cómo quieres ver el análisis?')
    expect(dialogo.querySelector('p').textContent)
      .toBe('Puedes explorar el resultado directamente en la web, descargar el Excel, o ambos.')

    const opciones = [...dialogo.querySelectorAll('.snwv-opt')]
    expect(opciones.map((o) => o.querySelector('b').textContent)).toEqual([
      '🖥️ Ver en la web', '⬇️ Descargar Excel', '📊 Ambos',
    ])
    expect(opciones.map((o) => o.querySelector('span').textContent)).toEqual([
      'Explora el análisis en pantalla sin descargar nada.',
      'Genera y descarga el informe .xlsx (comportamiento actual).',
      'Descarga el Excel y además muestra la vista web.',
    ])
    expect(dialogo.querySelector('.snwv-modal-foot button').textContent).toBe('Cancelar')
  })

  it('el foco inicial está en la primera opción', async () => {
    await montar(vi.fn())
    expect(document.activeElement).toBe(opcion('web'))
  })
})

describe('las respuestas', () => {
  it.each([['web'], ['excel'], ['both']])('«%s» se entrega tal cual', async (modo) => {
    const onElegir = vi.fn()
    await montar(onElegir)
    await act(async () => { opcion(modo).click() })
    expect(onElegir).toHaveBeenCalledTimes(1)
    expect(onElegir).toHaveBeenCalledWith(modo)
  })

  it('Cancelar entrega null', async () => {
    const onElegir = vi.fn()
    await montar(onElegir)
    await act(async () => { document.querySelector('.snwv-modal-foot button').click() })
    expect(onElegir).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('Escape entrega null', async () => {
    const onElegir = vi.fn()
    await montar(onElegir)
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onElegir).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('el clic en el fondo entrega null, pero el clic dentro del diálogo no', async () => {
    const onElegir = vi.fn()
    await montar(onElegir)
    await act(async () => { document.querySelector('.snwv-modal h3').click() })
    expect(onElegir).not.toHaveBeenCalled()
    await act(async () => { document.querySelector('.snwv-ov').click() })
    expect(onElegir).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('al desmontarse deja de escuchar Escape', async () => {
    const onElegir = vi.fn()
    await montar(onElegir)
    await act(async () => { raiz.unmount() })
    raiz = null
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onElegir).not.toHaveBeenCalled()
    expect(document.querySelector('.snwv-ov')).toBeNull()
  })
})
