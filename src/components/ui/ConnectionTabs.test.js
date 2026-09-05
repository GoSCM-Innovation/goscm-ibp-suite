// @vitest-environment jsdom
//
// El «+» de la tira de pestañas, que es lo que permite cambiar de conexión.
//
// Sin él el módulo quedaba encerrado: la tira solo dibujaba las pestañas ya abiertas, y con una sola
// no había ningún control que abriera otra. La función de abrir existía y era inalcanzable. Pasó las
// revisiones de paridad porque en v9 este control no estaba aquí — estaba en el menú lateral, que
// listaba los tenants; el de esta plataforma lista módulos, y nadie se quedó con ese trabajo.

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
let onCerrar

async function montar(props = {}) {
  onElegir = vi.fn()
  onCerrar = vi.fn()
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(ConnectionTabs, {
      conexiones: CONEXIONES,
      abiertas: ['a'],
      activa: 'a',
      onElegir,
      onCerrar,
      ...props,
    }))
  })
}

const pulsar = async (elemento) => {
  await act(async () => {
    elemento.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

const botonDelMas = () => contenedor.querySelector('.conn-tabs-mas-btn')
const menu = () => contenedor.querySelector('.conn-tabs-menu')
const opciones = () => [...contenedor.querySelectorAll('.conn-tabs-opcion')]
  .map((uno) => ({ texto: uno.textContent, apagada: uno.disabled, nodo: uno }))
const pestanas = () => [...contenedor.querySelectorAll('.conn-tab-nombre')].map((uno) => uno.textContent)

beforeEach(() => { vi.clearAllMocks() })

afterEach(async () => {
  await act(async () => { raiz?.unmount() })
  contenedor?.remove()
})

describe('las pestañas abiertas', () => {
  it('se dibujan las abiertas, no todas las conexiones', async () => {
    await montar()
    expect(pestanas()).toEqual(['IBP AGROSUPER QA'])
  })

  it('la última no se puede cerrar: un módulo sin pestaña no tiene nada que enseñar', async () => {
    await montar()
    expect(contenedor.querySelector('.conn-tab-cerrar')).toBeNull()
  })

  it('con varias abiertas sí se pueden cerrar', async () => {
    await montar({ abiertas: ['a', 'b'] })
    const cerrar = contenedor.querySelectorAll('.conn-tab-cerrar')
    expect(cerrar).toHaveLength(2)
    await pulsar(cerrar[0])
    expect(onCerrar).toHaveBeenCalledWith('a')
  })

  it('la marca de productivo va en la pestaña, que es lo que cambia lo que uno hace ahí', async () => {
    await montar({ abiertas: ['c'], activa: 'c' })
    expect(contenedor.querySelector('.conn-tab-punto.productivo')).not.toBeNull()
  })
})

describe('el «+»', () => {
  it('está cuando queda alguna conexión por abrir', async () => {
    await montar()
    expect(botonDelMas()).not.toBeNull()
  })

  it('no está cuando ya están todas abiertas: no ofrecería nada', async () => {
    await montar({ abiertas: ['a', 'b', 'c'] })
    expect(botonDelMas()).toBeNull()
  })

  it('el desplegable arranca cerrado', async () => {
    await montar()
    expect(menu()).toBeNull()
  })

  // La tira hace scroll horizontal y `overflow-x: auto` recorta lo que se sale, así que un
  // desplegable colgado ahí dentro no se vería. Casi pasó: se descubrió mirando la pantalla.
  it('no cuelga de la tira que hace scroll, o quedaría recortado', async () => {
    await montar()
    await pulsar(botonDelMas())
    expect(menu()).not.toBeNull()
    expect(contenedor.querySelector('.conn-tabs .conn-tabs-menu')).toBeNull()
    expect(contenedor.querySelector('.conn-tabs .conn-tabs-mas-btn')).toBeNull()
  })

  it('lista todas las conexiones, marcando las que ya están abiertas', async () => {
    await montar()
    await pulsar(botonDelMas())

    const lista = opciones()
    expect(lista).toHaveLength(3)
    expect(lista[0].texto).toContain('IBP AGROSUPER QA')
    expect(lista[0].texto).toContain('ya abierta')
    expect(lista[0].apagada).toBe(true)
    expect(lista[1].apagada).toBe(false)
  })

  it('dice de cada una si es productiva o sandbox, sin tener que pasar el ratón', async () => {
    await montar()
    await pulsar(botonDelMas())

    const lista = opciones()
    expect(lista[1].texto).toContain('Sandbox')
    expect(lista[2].texto).toContain('Productivo')
  })

  // Esto es lo que faltaba: elegir una conexión que no estaba abierta.
  it('elegir una que no estaba abierta la abre', async () => {
    await montar()
    await pulsar(botonDelMas())
    await pulsar(opciones()[1].nodo)

    expect(onElegir).toHaveBeenCalledWith('b')
    expect(menu()).toBeNull()
  })

  it('se cierra al pulsar fuera', async () => {
    await montar()
    await pulsar(botonDelMas())
    expect(menu()).not.toBeNull()

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    })
    expect(menu()).toBeNull()
  })

  it('se cierra con Escape', async () => {
    await montar()
    await pulsar(botonDelMas())

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(menu()).toBeNull()
  })
})

describe('sin nada que enseñar', () => {
  it('sin conexiones no dibuja la tira', async () => {
    await montar({ conexiones: [], abiertas: [] })
    expect(contenedor.querySelector('.conn-tabs-fila')).toBeNull()
  })

  // Puede pasar: lo guardado se filtra contra lo que existe, y si se borraron todas las conexiones
  // guardadas la tira se queda sin pestañas pero con conexiones que ofrecer.
  it('con conexiones y ninguna abierta, deja el «+» para abrir una', async () => {
    await montar({ abiertas: [], activa: '' })
    expect(pestanas()).toEqual([])
    expect(botonDelMas()).not.toBeNull()
  })
})
