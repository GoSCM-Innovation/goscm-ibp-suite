// @vitest-environment jsdom
//
// El botón «↺ Actualizar» con su proceso a la vista: mientras carga se apaga y dice qué lee; al terminar,
// si lo pidió un clic, confirma. La primera lectura al abrir la pantalla NO confirma nada.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import BotonActualizar from './BotonActualizar.jsx'

let raiz
let contenedor
const onClick = vi.fn()

const dibujar = (props = {}) => act(async () => {
  raiz.render(createElement(BotonActualizar, { onClick, mensaje: 'Leyendo SAP…', confirmar: true, ...props }))
})
const boton = () => contenedor.querySelector('button')

beforeEach(() => {
  onClick.mockClear()
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  raiz = createRoot(contenedor)
})

afterEach(async () => {
  await act(async () => { raiz.unmount() })
  contenedor.remove()
})

describe('BotonActualizar', () => {
  it('en reposo es un botón normal, sin aviso', async () => {
    await dibujar()
    expect(boton().disabled).toBe(false)
    expect(boton().textContent).toContain('Actualizar')
    expect(contenedor.querySelector('[role="status"]')).toBeNull()
  })

  it('mientras carga se apaga, gira y dice qué se lee', async () => {
    await dibujar({ cargando: true })
    expect(boton().disabled).toBe(true)
    expect(boton().className).toContain('cargando')
    expect(contenedor.querySelector('[role="status"]').textContent).toContain('Leyendo SAP…')
  })

  it('confirma «Actualizado» cuando lo pidió un clic y terminó bien', async () => {
    await dibujar()
    await act(async () => { boton().dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onClick).toHaveBeenCalledTimes(1)
    await dibujar({ cargando: true })
    await dibujar({ cargando: false })
    expect(contenedor.textContent).toContain('Actualizado')
  })

  it('no confirma si terminó con error', async () => {
    await dibujar()
    await act(async () => { boton().dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await dibujar({ cargando: true })
    await dibujar({ cargando: false, error: true })
    expect(contenedor.textContent).not.toContain('Actualizado')
  })

  it('no confirma la lectura inicial, que nadie pidió', async () => {
    await dibujar({ cargando: true })
    await dibujar({ cargando: false })
    expect(contenedor.textContent).not.toContain('Actualizado')
  })

  it('respeta el texto y el estilo de quien lo usa', async () => {
    await dibujar({ etiqueta: 'Refresh', className: 'btn btn-sm' })
    expect(boton().textContent).toContain('Refresh')
    expect(boton().className).toContain('btn btn-sm')
  })
})
