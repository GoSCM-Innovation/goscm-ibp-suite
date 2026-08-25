// @vitest-environment jsdom
//
// Renombrar una conexión, en la pantalla de verdad.
//
// Existe por un fallo que ninguna prueba de `core/` podía ver: el backend estaba bien, el cliente de
// API estaba bien, y el nombre no se guardaba igual. La fila entera abre el detalle al hacer clic, y
// el clic en «Guardar» llegaba hasta la fila: se ponía `busy`, el botón de enviar se deshabilitaba, y
// un botón deshabilitado no envía su formulario. Sin error, sin aviso, sin nada.
//
// Se monta con `react-dom` a secas —el proyecto no trae React Testing Library— y con `createElement`
// en vez de JSX, para no depender de cómo esté configurado el transformador en las pruebas. Se mira
// lo único que importa: que al pulsar «Guardar» salga el PATCH, y que la fila NO se abra.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}

vi.mock('../../lib/api.js', () => ({ api }))

const { default: ConnectionsTab } = await import('./ConnectionsTab.jsx')

const CONEXION = {
  id: 'c1',
  kind: 'ibp',
  name: 'Tenant de pruebas',
  baseUrl: 'https://my400444-api.scmibp1.ondemand.com',
  isProduction: false,
  agreementCount: 2,
}

let contenedor
let raiz

/** Monta la pestaña y espera a que la lista haya llegado. */
async function montar() {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(ConnectionsTab, { clientId: 'cli-1' }))
  })
}

/** El botón cuyo texto visible es `texto`. */
const boton = (texto) => [...contenedor.querySelectorAll('button')]
  .find((uno) => uno.textContent.trim() === texto)

/**
 * El campo del nombre, por su etiqueta.
 *
 * Por la etiqueta y no por `querySelector('input')`: en la pantalla hay más formularios con campos, y
 * una prueba que dependa del orden del DOM se rompe la próxima vez que alguien mueva una tarjeta.
 */
const campoDelNombre = () => contenedor.querySelector(`[aria-label="Nombre de ${CONEXION.name}"]`)

const pulsar = async (elemento) => {
  await act(async () => {
    elemento.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

/**
 * Escribe en un campo como escribiría una persona.
 *
 * Con el asignador nativo y no con `campo.value = …`: React lleva su propia copia del valor y, si se
 * asigna por encima, decide que no cambió nada y no llama a `onChange`. La prueba pasaría con el
 * nombre viejo y no avisaría de nada.
 */
const escribir = async (campo, texto) => {
  const asignar = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  await act(async () => {
    asignar.call(campo, texto)
    campo.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  api.get.mockReset()
  api.patch.mockReset()
  api.get.mockResolvedValue({ connections: [CONEXION] })
  api.patch.mockResolvedValue({ connection: { ...CONEXION, name: 'Nombre nuevo' } })
})

afterEach(async () => {
  await act(async () => { raiz?.unmount() })
  contenedor?.remove()
})

describe('renombrar una conexión', () => {
  it('«Guardar» manda el PATCH con el nombre escrito', async () => {
    await montar()
    await pulsar(boton('Renombrar'))

    const campo = campoDelNombre()
    expect(campo.value).toBe('Tenant de pruebas')

    await escribir(campo, 'Nombre nuevo')
    expect(campoDelNombre().value).toBe('Nombre nuevo')

    await pulsar(boton('Guardar'))

    expect(api.patch).toHaveBeenCalledTimes(1)
    expect(api.patch).toHaveBeenCalledWith('/api/admin/connections', {
      clientId: 'cli-1',
      connectionId: 'c1',
      name: 'Nombre nuevo',
    })
  })

  it('el clic en «Guardar» no abre el detalle de la fila', async () => {
    await montar()
    await pulsar(boton('Renombrar'))

    const antes = api.get.mock.calls.length
    await pulsar(boton('Guardar'))

    // Abrir el detalle es un GET con `id`. Si alguno lleva `id`, el clic se escapó a la fila — y ese
    // escape es exactamente lo que deshabilitaba el botón antes de que el formulario se enviara.
    const conDetalle = api.get.mock.calls.slice(antes).filter(([, params]) => params?.id)
    expect(conDetalle).toEqual([])
  })

  it('«Cancelar» cierra el formulario y no manda nada', async () => {
    await montar()
    await pulsar(boton('Renombrar'))
    await pulsar(boton('Cancelar'))

    expect(campoDelNombre()).toBeNull()
    expect(api.patch).not.toHaveBeenCalled()
  })
})
