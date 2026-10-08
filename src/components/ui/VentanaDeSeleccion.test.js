// @vitest-environment jsdom
//
// La ventana de selección de listas extensas. Lo que importa: lo marcado NO se aplica hasta «Aplicar»,
// «Cancelar» lo descarta, el buscador mira el ID y la descripción, y el orden de la selección es el
// orden en que se marcó.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import VentanaDeSeleccion from './VentanaDeSeleccion.jsx'

let raiz
let contenedor
const onGuardar = vi.fn()
const onCerrar = vi.fn()

const OPCIONES = ['ALFA', 'BETA', 'GAMA', 'DELTA']
const ETIQUETAS = { ALFA: 'Primera letra', GAMA: 'Tercera letra' }

const dibujar = (props = {}) => act(async () => {
  raiz.render(createElement(VentanaDeSeleccion, {
    titulo: 'Prueba', opciones: OPCIONES, seleccion: ['BETA'], etiquetas: ETIQUETAS, onGuardar, onCerrar, ...props,
  }))
})

// Las filas de la lista que se desplaza (lo elegido va aparte, en el encabezado `.vs-elegidas`).
const filas = () => [...contenedor.querySelectorAll('.ef-fields-list .ef-field-item')].map(f => f.querySelector('.ef-field-name').textContent)
const elegidas = () => [...contenedor.querySelectorAll('.vs-elegidas .ef-field-item')].map(f => f.querySelector('.ef-field-name').textContent)
const interruptor = id => [...contenedor.querySelectorAll('.ef-field-item')]
  .find(f => f.querySelector('.ef-field-name').textContent === id).querySelector('input')
const pulsar = (nodo) => act(async () => { nodo.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
const boton = texto => [...contenedor.querySelectorAll('button')].find(b => b.textContent.includes(texto))
const escribir = (valor) => act(async () => {
  const campo = contenedor.querySelector('.ef-fields-search')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(campo, valor)
  campo.dispatchEvent(new Event('input', { bubbles: true }))
})

beforeEach(async () => {
  onGuardar.mockClear()
  onCerrar.mockClear()
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  raiz = createRoot(contenedor)
  await dibujar()
})

afterEach(async () => {
  await act(async () => { raiz.unmount() })
  contenedor.remove()
})

describe('VentanaDeSeleccion', () => {
  it('lo elegido queda arriba, como encabezado, y no se repite en la lista', () => {
    expect(elegidas()).toEqual(['BETA'])
    expect(filas()).toEqual(['ALFA', 'GAMA', 'DELTA'])
    expect(interruptor('BETA').checked).toBe(true)
    expect(interruptor('ALFA').checked).toBe(false)
    expect(contenedor.querySelector('.vs-elegidas .ef-section-label').textContent).toBe('Seleccionados (1)')
  })

  it('marcar sube la opción al encabezado y quitarla desde ahí la devuelve a la lista', async () => {
    await pulsar(interruptor('DELTA'))
    expect(elegidas()).toEqual(['BETA', 'DELTA'])
    expect(filas()).toEqual(['ALFA', 'GAMA'])
    await pulsar(interruptor('BETA'))
    expect(elegidas()).toEqual(['DELTA'])
    expect(filas()).toEqual(['ALFA', 'BETA', 'GAMA'])
    await pulsar(interruptor('DELTA'))
    expect(contenedor.querySelector('.vs-elegidas')).toBeNull()
    expect(filas()).toEqual(OPCIONES)
  })

  it('el encabezado no obedece al buscador: lo activo se ve siempre', async () => {
    await escribir('gama')
    expect(elegidas()).toEqual(['BETA'])
    expect(filas()).toEqual(['GAMA'])
  })

  it('elección única: el valor actual queda arriba y no se repite abajo', async () => {
    const onElegir = vi.fn()
    await dibujar({ modo: 'unica', valor: 'GAMA', onElegir })
    const nombre = f => f.querySelector('.ef-field-name').textContent
    const arriba = [...contenedor.querySelectorAll('.vs-elegidas .vs-fila')].map(nombre)
    expect(arriba).toEqual(['GAMA'])
    const abajo = [...contenedor.querySelectorAll('.ef-fields-list .vs-fila')].map(nombre)
    expect(abajo).toEqual(['ALFA', 'BETA', 'DELTA'])
    await pulsar(boton('BETA'))
    expect(onElegir).toHaveBeenCalledWith('BETA')
  })

  it('elección única sin valor: no hay encabezado', async () => {
    await dibujar({ modo: 'unica', valor: '', onElegir: vi.fn() })
    expect(contenedor.querySelector('.vs-elegidas')).toBeNull()
  })

  it('no aplica nada hasta pulsar «Aplicar», y entrega la selección en el orden en que se marcó', async () => {
    await pulsar(interruptor('DELTA'))
    await pulsar(interruptor('ALFA'))
    expect(onGuardar).not.toHaveBeenCalled()
    await pulsar(boton('Aplicar'))
    expect(onGuardar).toHaveBeenCalledWith(['BETA', 'DELTA', 'ALFA'])
  })

  it('«Cancelar» cierra sin aplicar lo marcado', async () => {
    await pulsar(interruptor('GAMA'))
    await pulsar(boton('Cancelar'))
    expect(onGuardar).not.toHaveBeenCalled()
    expect(onCerrar).toHaveBeenCalled()
  })

  it('el buscador mira el ID y la descripción', async () => {
    await escribir('tercera')
    expect(filas()).toEqual(['GAMA'])
    await escribir('ta')
    // BETA también coincide, pero está elegida: se ve arriba, no en la lista.
    expect(filas()).toEqual(['DELTA'])
    expect(elegidas()).toEqual(['BETA'])
  })

  it('«Marcar visibles» solo marca lo que el buscador deja ver', async () => {
    await escribir('a')
    await pulsar(boton('Marcar visibles'))
    await escribir('')
    await pulsar(boton('Aplicar'))
    expect(onGuardar.mock.calls[0][0].sort()).toEqual(['ALFA', 'BETA', 'DELTA', 'GAMA'])
  })

  it('«Quitar visibles» no toca lo marcado que el buscador esconde', async () => {
    await escribir('gama')
    await pulsar(boton('Quitar visibles'))
    await escribir('')
    await pulsar(boton('Aplicar'))
    expect(onGuardar).toHaveBeenCalledWith(['BETA'])
  })

  it('con muchas opciones solo dibuja un tope y avisa', async () => {
    const muchas = Array.from({ length: 800 }, (_, i) => `K${String(i).padStart(4, '0')}`)
    await dibujar({ opciones: muchas, seleccion: [] })
    expect(filas()).toHaveLength(500)
    expect(contenedor.textContent).toContain('Se muestran 500 de 800')
  })
})
