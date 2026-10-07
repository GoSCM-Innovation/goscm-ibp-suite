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

const filas = () => [...contenedor.querySelectorAll('.ef-field-item')].map(f => f.querySelector('.ef-field-name').textContent)
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
  it('lista todas las opciones y marca la selección inicial', () => {
    expect(filas()).toEqual(OPCIONES)
    expect(interruptor('BETA').checked).toBe(true)
    expect(interruptor('ALFA').checked).toBe(false)
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
    expect(filas()).toEqual(['BETA', 'DELTA'])
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
