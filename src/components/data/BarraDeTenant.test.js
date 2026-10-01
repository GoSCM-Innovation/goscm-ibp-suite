// @vitest-environment jsdom
//
// La barra de tenant de cada aplicación de Data Tools: dice contra qué se ejecuta y deja cambiarlo.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const { default: BarraDeTenant } = await import('./BarraDeTenant.jsx')
const { conectar, desconectar, useAsistenteAbierto, verAsistente } = await import('../../lib/conexion-activa.js')
const { VERSION_BASE } = await import('../../lib/version-elegida.js')

let contenedor
let raiz

// Un componente que muestra si el asistente está abierto, para comprobar que el botón lo abre.
function Espia() {
  return createElement('span', { id: 'espia' }, useAsistenteAbierto() ? 'abierto' : 'cerrado')
}

async function montar() {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement('div', null, createElement(BarraDeTenant), createElement(Espia)))
  })
}

beforeEach(() => {
  desconectar()
  verAsistente(false)
})

afterEach(async () => {
  await act(async () => { raiz?.unmount() })
  contenedor?.remove()
})

describe('la barra de tenant', () => {
  it('sin conexión, dice que no hay tenant y ofrece conectar', async () => {
    await montar()
    expect(contenedor.textContent).toContain('Sin tenant seleccionado')
    expect(contenedor.querySelector('.status-dot.off')).not.toBeNull()
    expect(contenedor.querySelector('button').textContent).toContain('Conectar SAP IBP')
  })

  it('conectada, dice tenant, área y versión, y ofrece cambiar', async () => {
    conectar({
      connectionId: 'c1',
      nombre: 'Tenant de pruebas',
      planningArea: 'SAP4',
      version: VERSION_BASE,
    })
    await montar()
    const texto = contenedor.textContent
    expect(texto).toContain('Tenant de pruebas')
    expect(texto).toContain('SAP4')
    expect(texto).toContain('Versión base')
    expect(contenedor.querySelector('.status-dot.on')).not.toBeNull()
    expect(contenedor.querySelector('button').textContent).toContain('Cambiar tenant')
  })

  it('un tenant productivo se marca como tal', async () => {
    conectar({
      connectionId: 'c1', nombre: 'Prod', planningArea: 'SAP4', version: 'V1', esProduccion: true,
    })
    await montar()
    expect(contenedor.textContent).toContain('Productivo')
  })

  it('el botón abre el asistente de conexión', async () => {
    await montar()
    expect(contenedor.querySelector('#espia').textContent).toBe('cerrado')
    await act(async () => { contenedor.querySelector('button').click() })
    expect(contenedor.querySelector('#espia').textContent).toBe('abierto')
  })
})
