// @vitest-environment jsdom
//
// El criterio único: hasta 12 opciones, el `<select>` de siempre; más, un botón que abre la ventana con
// buscador donde un clic elige y cierra.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { UMBRAL_LISTA_EXTENSA, esListaExtensa } from '../../lib/lista-extensa.js'
import SelectorDeLista from './SelectorDeLista.jsx'

let raiz
let contenedor
const onChange = vi.fn()

const opciones = (n) => Array.from({ length: n }, (_, i) => ({ value: `V${i}`, label: `Valor ${i}` }))
const dibujar = (props = {}) => act(async () => {
  raiz.render(createElement(SelectorDeLista, { value: 'V1', onChange, titulo: 'Prueba', options: opciones(3), ...props }))
})
const pulsar = (nodo) => act(async () => { nodo.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })

beforeEach(() => {
  onChange.mockClear()
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  raiz = createRoot(contenedor)
})

afterEach(async () => {
  await act(async () => { raiz.unmount() })
  contenedor.remove()
})

describe('lib/lista-extensa', () => {
  it('el umbral es 12: 12 es corta, 13 es extensa', () => {
    expect(UMBRAL_LISTA_EXTENSA).toBe(12)
    expect(esListaExtensa(12)).toBe(false)
    expect(esListaExtensa(13)).toBe(true)
  })
})

describe('SelectorDeLista', () => {
  it('con una lista corta es un <select> nativo con su clase, su id y su valor', async () => {
    await dibujar({ className: 'select', id: 'x' })
    const sel = contenedor.querySelector('select')
    expect(sel).not.toBeNull()
    expect(sel.id).toBe('x')
    expect(sel.className).toBe('select')
    expect(sel.value).toBe('V1')
    expect(contenedor.querySelector('dialog')).toBeNull()
  })

  it('con exactamente 12 opciones todavía es el <select>', async () => {
    await dibujar({ options: opciones(12) })
    expect(contenedor.querySelector('select')).not.toBeNull()
  })

  it('con 13 es un botón con el texto del elegido, y no hay <select>', async () => {
    await dibujar({ options: opciones(13), className: 'select' })
    expect(contenedor.querySelector('select')).toBeNull()
    const boton = contenedor.querySelector('button')
    expect(boton.textContent).toContain('Valor 1')
    expect(boton.className).toContain('select')
  })

  it('la opción vacía no cuenta para decidir si la lista es extensa', async () => {
    await dibujar({ options: [{ value: '', label: '— Sin especificar —' }, ...opciones(12)], value: '' })
    expect(contenedor.querySelector('select')).not.toBeNull()
  })

  it('en la ventana, un clic elige y cierra sin «Aplicar»', async () => {
    await dibujar({ options: opciones(20) })
    await pulsar(contenedor.querySelector('button'))
    const filas = [...contenedor.querySelectorAll('.vs-fila')]
    expect(filas).toHaveLength(20)
    await pulsar(filas[5])
    expect(onChange).toHaveBeenCalledWith('V5')
    expect(contenedor.querySelector('dialog')).toBeNull()
  })

  it('el buscador filtra por el texto que se ve', async () => {
    await dibujar({ options: opciones(30) })
    await pulsar(contenedor.querySelector('button'))
    const campo = contenedor.querySelector('.ef-fields-search')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(campo, 'valor 2')
      campo.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const nombres = [...contenedor.querySelectorAll('.vs-fila .ef-field-name')].map(n => n.textContent)
    expect(nombres).toContain('Valor 2')
    expect(nombres).toContain('Valor 20')
    expect(nombres).not.toContain('Valor 3')
  })

  it('con el cambio del <select> nativo entrega el VALOR, no el evento', async () => {
    await dibujar()
    const sel = contenedor.querySelector('select')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'V2')
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith('V2')
  })
})
