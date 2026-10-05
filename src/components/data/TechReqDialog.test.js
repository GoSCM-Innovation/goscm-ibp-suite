// @vitest-environment jsdom
//
// Los Requisitos técnicos con la forma de v9 para CI-DS: abre en su pestaña, con su título, y sin la
// guía de IBP, que ahí no aplica.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import TechReqDialog from './TechReqDialog.jsx'
import { REQUISITOS_CIDS } from '../../lib/requisitos-tecnicos.js'

let contenedor
let raiz

async function montar(props = {}) {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(TechReqDialog, { onClose: () => {}, ...props }))
  })
}

afterEach(() => {
  act(() => raiz?.unmount())
  contenedor?.remove()
})

describe('TechReqDialog', () => {
  it('sin pestaña inicial abre en «Conexión» y ofrece la guía', async () => {
    await montar()
    expect(contenedor.textContent).toContain('Descargar guía de configuración')
  })

  it('desde CI-DS abre en su pestaña, con el título de v9 y sin la guía de IBP', async () => {
    await montar({ pestanaInicial: 'cids' })
    expect(contenedor.textContent).toContain('📋 Requisitos Técnicos — Conexión a SAP CI-DS')
    for (const requisito of REQUISITOS_CIDS) expect(contenedor.textContent).toContain(requisito.titulo)
    expect(contenedor.textContent).not.toContain('Descargar guía de configuración')
  })

  it('la pestaña de IBP Tools tampoco lleva la guía', async () => {
    await montar({ pestanaInicial: 'ibp' })
    expect(contenedor.textContent).not.toContain('Descargar guía de configuración')
  })
})

describe('REQUISITOS_CIDS', () => {
  it('conserva las palabras de v9 donde siguen siendo ciertas', () => {
    const texto = REQUISITOS_CIDS.map((uno) => `${uno.titulo} ${uno.detalle}`).join(' ')
    expect(texto).toContain('mayúsculas/minúsculas')
    expect(texto).toContain('La app hace logon')
    expect(texto).toContain('dos conexiones sobre el mismo tenant: una contra el repositorio Productivo y otra contra el Sandbox')
  })

  it('no dice que la contraseña no se almacena ni que hay token Bearer: aquí no es cierto', () => {
    const texto = REQUISITOS_CIDS.map((uno) => uno.detalle).join(' ')
    expect(texto).not.toContain('no se almacena')
    expect(texto).not.toContain('Bearer')
  })
})
