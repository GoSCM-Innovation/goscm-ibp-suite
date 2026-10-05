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
  localStorage.clear()
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
  it('despliega bajo Data Tools las aplicaciones de v7 que se ofrecen', async () => {
    await montar()
    const nombres = enElMenu()

    expect(nombres).toContain('Data Tools')
    for (const app of ['Production Visualizer', 'Production Analyzer', 'Network Visualizer',
      'Network Analyzer', 'Glosario Analyzers']) {
      expect(nombres, app).toContain(app)
    }
  })

  it('Planning Area Documenter está oculto de momento', async () => {
    await montar()
    expect(enElMenu()).not.toContain('Planning Area Documenter')
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

  it('el glosario NUNCA lleva candado: no depende del tenant', async () => {
    await montar()
    expect(itemDelMenu('Glosario Analyzers').querySelector('.nav-lock-badge')).toBeNull()
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

describe('el estado de la conexión NO está en el menú', () => {
  // La conexión a SAP IBP es de Data Tools: vive en la barra de cada aplicación
  // (`BarraDeTenant`), no arriba del menú de toda la suite.
  it('sin conexión, el menú no dice «Desconectado» ni ofrece conectar', async () => {
    await montar()
    expect(contenedor.querySelector('.sidebar-conn')).toBeNull()
    expect(contenedor.querySelector('.sidebar').textContent).not.toContain('Desconectado')
    expect(contenedor.querySelector('.sidebar').textContent).not.toContain('Conectar SAP IBP')
  })

  it('conectado, tampoco: el menú solo marca los candados de las aplicaciones', async () => {
    conectar({
      connectionId: 'c1',
      nombre: 'Tenant de pruebas',
      planningArea: 'SAP4',
      version: VERSION_BASE,
    })
    await montar()
    expect(contenedor.querySelector('.sidebar-conn')).toBeNull()
    expect(contenedor.querySelector('.status-dot')).toBeNull()
  })
})

describe('el árbol de Data Tools se pliega', () => {
  const flecha = () => contenedor.querySelector('.nav-plegar')

  const pulsar = (nodo) => act(async () => {
    nodo.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })

  it('arranca desplegado y la flecha lo pliega, dejando solo el módulo', async () => {
    await montar()
    expect(enElMenu()).toContain('Production Visualizer')

    await pulsar(flecha())
    expect(enElMenu()).toContain('Data Tools')
    expect(enElMenu()).not.toContain('Production Visualizer')
    expect(flecha().getAttribute('aria-expanded')).toBe('false')
  })

  it('la misma flecha lo vuelve a desplegar', async () => {
    await montar()
    await pulsar(flecha())
    await pulsar(flecha())
    expect(enElMenu()).toContain('Production Visualizer')
  })

  it('se recuerda: al volver a montar el menú sigue plegado', async () => {
    await montar()
    await pulsar(flecha())
    await act(async () => { raiz.unmount() })
    contenedor.remove()

    await montar()
    expect(enElMenu()).not.toContain('Production Visualizer')
  })

  it('pulsar el módulo estando plegado lo despliega y navega a él', async () => {
    const ir = vi.fn()
    contenedor = document.createElement('div')
    document.body.appendChild(contenedor)
    await act(async () => {
      raiz = createRoot(contenedor)
      raiz.render(createElement(Shell, {
        user: USUARIO, modules: ['explorer'], theme: 'dark', onToggleTheme: () => {},
        onSignOut: () => {}, route: 'explorer', onNavigate: ir,
      }))
    })
    await pulsar(flecha())
    await pulsar(itemDelMenu('Data Tools'))

    expect(ir).toHaveBeenCalledWith('explorer')
    expect(enElMenu()).toContain('Production Visualizer')
  })

  it('los módulos sin aplicaciones no llevan flecha', async () => {
    await montar({ modules: ['explorer', 'cids'], route: 'cids' })
    expect(contenedor.querySelectorAll('.nav-plegar')).toHaveLength(1)
  })
})
