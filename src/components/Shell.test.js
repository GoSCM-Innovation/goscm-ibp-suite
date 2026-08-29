// @vitest-environment jsdom
//
// El menú lateral de v7: las seis aplicaciones colgando de Data Tools, con su candado.
//
// Existe porque esta es la parte de la restauración que ninguna prueba de `core/` puede ver, y porque
// el fallo que se quiere evitar es silencioso: si el candado se cae cuando no debe, la aplicación se
// abre, pide datos sin destino y falla contra SAP con un error que no dice que falta conectarse.
//
// Se monta con `react-dom` a secas —el proyecto no trae React Testing Library— y con `createElement`
// en vez de JSX, igual que `ConnectionsTab.test.js`.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }
vi.mock('../lib/api.js', () => ({ api }))

const { default: Shell } = await import('./Shell.jsx')
const { conectar, desconectar } = await import('../lib/conexion-activa.js')
const { VERSION_BASE } = await import('../lib/version-elegida.js')

const USUARIO = { name: 'Quien sea', email: 'quien@sea.com', isAdmin: false, isPlatformAdmin: false }

let contenedor
let raiz

async function montar({ modules = ['explorer'], route = 'explorer' } = {}) {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(Shell, {
      user: USUARIO,
      modules,
      theme: 'dark',
      onToggleTheme: () => {},
      onSignOut: () => {},
      route,
      onNavigate: () => {},
    }))
  })
}

/** Los nombres de todo lo que hay en el menú, en orden. */
const enElMenu = () => [...contenedor.querySelectorAll('.sidebar .nav-label')]
  .map((uno) => uno.textContent.trim())

/** El botón del menú cuyo nombre es `texto`. */
const itemDelMenu = (texto) => [...contenedor.querySelectorAll('.sidebar .nav-item')]
  .find((uno) => uno.querySelector('.nav-label')?.textContent.trim() === texto)

beforeEach(() => {
  api.get.mockReset()
  api.get.mockResolvedValue({ connections: [] })
  desconectar()
})

afterEach(async () => {
  await act(async () => { raiz?.unmount() })
  contenedor?.remove()
  desconectar()
})

describe('el menú lateral', () => {
  it('despliega las seis aplicaciones de v7 bajo Data Tools', async () => {
    await montar()
    const nombres = enElMenu()

    expect(nombres).toContain('Data Tools')
    for (const app of ['Production Visualizer', 'Production Analyzer', 'Network Visualizer',
      'Network Analyzer', 'Glosario Analyzers', 'Planning Area Documenter']) {
      expect(nombres, app).toContain(app)
    }
  })

  it('las aplicaciones van DEBAJO de su módulo, no sueltas', async () => {
    await montar()
    const nombres = enElMenu()
    expect(nombres.indexOf('Data Tools')).toBeLessThan(nombres.indexOf('Production Visualizer'))
  })

  it('no despliega las aplicaciones de un módulo que no está abierto', async () => {
    await montar({ modules: ['explorer', 'cids'], route: 'cids' })
    expect(enElMenu()).not.toContain('Production Visualizer')
  })

  it('no despliega las aplicaciones de un módulo no contratado', async () => {
    // El módulo se ve con candado —un módulo escondido no se vende—, pero sus aplicaciones no.
    await montar({ modules: ['cids'], route: 'explorer' })
    expect(enElMenu()).toContain('Data Tools')
    expect(enElMenu()).not.toContain('Production Visualizer')
  })
})

describe('el candado de las aplicaciones', () => {
  it('sin conexión, las cuatro que hablan con SAP van con candado', async () => {
    await montar()
    for (const app of ['Production Visualizer', 'Production Analyzer', 'Network Visualizer', 'Network Analyzer']) {
      expect(itemDelMenu(app).querySelector('.nav-lock-badge'), app).not.toBeNull()
    }
  })

  it('el glosario y el documentador NUNCA llevan candado: no dependen del tenant', async () => {
    await montar()
    expect(itemDelMenu('Glosario Analyzers').querySelector('.nav-lock-badge')).toBeNull()
    expect(itemDelMenu('Planning Area Documenter').querySelector('.nav-lock-badge')).toBeNull()
  })

  it('con conexión activa se caen los cuatro candados', async () => {
    conectar({
      connectionId: 'c1',
      nombre: 'Tenant de pruebas',
      planningArea: 'SAP4',
      version: VERSION_BASE,
    })
    await montar()

    for (const app of ['Production Visualizer', 'Production Analyzer', 'Network Visualizer', 'Network Analyzer']) {
      expect(itemDelMenu(app).querySelector('.nav-lock-badge'), app).toBeNull()
    }
  })

  it('una conexión a medias NO abre nada: sin área elegida sigue sin haber destino', async () => {
    // Es el fallo que el asistente existe para evitar. Un tenant sin área ni versión no puede
    // consultar nada, y dejar entrar con eso da un error de SAP que no dice qué falta.
    conectar({ connectionId: 'c1', nombre: 'Tenant', planningArea: '', version: '' })
    await montar()
    expect(itemDelMenu('Production Visualizer').querySelector('.nav-lock-badge')).not.toBeNull()
  })
})

describe('el bloque de conexión', () => {
  it('dice «Desconectado» y ofrece conectar', async () => {
    await montar()
    expect(contenedor.querySelector('.sidebar-conn').textContent).toContain('Desconectado')
    expect(contenedor.querySelector('.status-dot.off')).not.toBeNull()
  })

  it('conectado, dice contra qué área y qué tenant se está trabajando', async () => {
    // La procedencia va siempre visible: un número sin ella se lee como si fuera del tenant que uno
    // tenía en la cabeza.
    conectar({
      connectionId: 'c1',
      nombre: 'Tenant de pruebas',
      planningArea: 'SAP4',
      version: VERSION_BASE,
    })
    await montar()

    const bloque = contenedor.querySelector('.sidebar-conn').textContent
    expect(bloque).toContain('SAP4')
    expect(bloque).toContain('Tenant de pruebas')
    expect(contenedor.querySelector('.status-dot.on')).not.toBeNull()
  })

  it('no se le ofrece a quien no tiene Data Tools contratado', async () => {
    await montar({ modules: ['cids'], route: 'cids' })
    expect(contenedor.querySelector('.sidebar-conn')).toBeNull()
  })
})
