// @vitest-environment jsdom
//
// Las listas de Administración, agrupadas: conexiones por tipo, personas por permiso y clientes por estado.
//
// Lo que se mira es lo que un usuario vería: cuántas filas hay a la vista, qué abre cada una y que lo que
// cambia de grupo (una conexión creada, un cliente suspendido) no desaparezca.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), put: vi.fn() }
vi.mock('../../lib/api.js', () => ({ api }))

const { default: ConnectionsTab } = await import('./ConnectionsTab.jsx')
const { default: UsersTab } = await import('./UsersTab.jsx')
const { default: ClientsTab } = await import('./ClientsTab.jsx')

let contenedor
let raiz

async function montar(Componente, props) {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(Componente, props))
  })
  // La lista llega por una cadena de promesas: se deja que se asienten antes de mirar.
  for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve() })
}

const pulsar = async (elemento) => {
  await act(async () => { elemento.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
}

/** La cabecera de un grupo, por el texto con que empieza (sin la flecha que la acompaña). */
const cabecera = (titulo) => [...contenedor.querySelectorAll('[aria-expanded]')]
  .find((una) => una.textContent.replace('▾', '').trim().startsWith(titulo))
const abierto = (titulo) => cabecera(titulo)?.getAttribute('aria-expanded') === 'true'
const boton = (texto) => [...contenedor.querySelectorAll('button')].find((uno) => uno.textContent.trim() === texto)
const celdas = () => [...contenedor.querySelectorAll('tbody tr')].map((fila) => fila.textContent)

const escribir = async (campo, texto) => {
  const asignar = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  await act(async () => {
    asignar.call(campo, texto)
    campo.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  for (const funcion of Object.values(api)) funcion.mockReset()
})

afterEach(async () => {
  await act(async () => { raiz?.unmount() })
  contenedor?.remove()
})

describe('Conexiones, por tipo', () => {
  const IBP1 = { id: 'i1', kind: 'ibp', name: 'IBP QAS', baseUrl: 'https://a.scmibp1.ondemand.com', isProduction: false, agreementCount: 2 }
  const IBP2 = { id: 'i2', kind: 'ibp', name: 'IBP PRD', baseUrl: 'https://b.scmibp1.ondemand.com', isProduction: true, agreementCount: 1 }
  const CIDS = { id: 'd1', kind: 'cids', name: 'CIDS GOSCM', baseUrl: 'https://hcids.us3.hana.ondemand.com/DSo', isProduction: false, agreementCount: 1 }

  beforeEach(() => {
    api.get.mockResolvedValue({ connections: [IBP1, IBP2, CIDS] })
  })

  it('son tres filas y empiezan cerradas, cada una con su cantidad y los nombres que tiene', async () => {
    await montar(ConnectionsTab, { clientId: 'cli-1' })

    for (const titulo of ['SAP IBP', 'CI-DS', 'Cloud Integration']) expect(abierto(titulo), titulo).toBe(false)
    expect(cabecera('SAP IBP').textContent).toContain('2')
    expect(cabecera('SAP IBP').textContent).toContain('IBP QAS, IBP PRD')
    expect(cabecera('CI-DS').textContent).toContain('CIDS GOSCM')
    // Cerradas no dibujan filas.
    expect(celdas()).toEqual([])
  })

  it('un tipo sin conexiones sigue saliendo, con 0, y al abrirlo lo dice', async () => {
    await montar(ConnectionsTab, { clientId: 'cli-1' })
    expect(cabecera('Cloud Integration').textContent).toContain('0')

    await pulsar(cabecera('Cloud Integration'))
    expect(contenedor.textContent).toContain('No hay conexiones de este tipo.')
  })

  it('abrir una fila enseña sus conexiones y solo las suyas', async () => {
    await montar(ConnectionsTab, { clientId: 'cli-1' })
    await pulsar(cabecera('SAP IBP'))

    expect(abierto('SAP IBP')).toBe(true)
    expect(abierto('CI-DS')).toBe(false)
    expect(celdas()).toHaveLength(2)
    expect(celdas().join(' ')).toContain('IBP QAS')
    expect(celdas().join(' ')).not.toContain('CIDS GOSCM')

    await pulsar(cabecera('SAP IBP'))
    expect(abierto('SAP IBP')).toBe(false)
    expect(celdas()).toEqual([])
  })

  it('dentro de un grupo ya no hay columna «Tipo»', async () => {
    await montar(ConnectionsTab, { clientId: 'cli-1' })
    await pulsar(cabecera('SAP IBP'))
    const encabezados = [...contenedor.querySelectorAll('thead th')].map((th) => th.textContent.trim())
    expect(encabezados).toEqual(['Nombre', 'Dirección', 'Acuerdos', ''])
  })

  it('en CI-DS y Cloud Integration la columna se llama «Credenciales»', async () => {
    await montar(ConnectionsTab, { clientId: 'cli-1' })
    await pulsar(cabecera('CI-DS'))
    expect([...contenedor.querySelectorAll('thead th')].map((th) => th.textContent.trim())).toContain('Credenciales')
  })

  it('una conexión de un tipo que la pantalla no conoce no queda invisible: va a «Otros»', async () => {
    api.get.mockResolvedValue({ connections: [IBP1, { ...CIDS, id: 'x1', kind: 'nuevo', name: 'Del futuro' }] })
    await montar(ConnectionsTab, { clientId: 'cli-1' })
    expect(cabecera('Otros').textContent).toContain('Del futuro')
  })

  it('el formulario «Nueva conexión» empieza plegado', async () => {
    await montar(ConnectionsTab, { clientId: 'cli-1' })
    expect(abierto('+ Nueva conexión')).toBe(false)
    expect(contenedor.querySelector('#connName')).toBeNull()

    await pulsar(cabecera('+ Nueva conexión'))
    expect(contenedor.querySelector('#connName')).not.toBeNull()
  })

  it('al crear una conexión se abre la fila de su tipo y el formulario se pliega', async () => {
    api.post.mockResolvedValue({ connection: { id: 'n1' } })
    await montar(ConnectionsTab, { clientId: 'cli-1' })
    await pulsar(cabecera('+ Nueva conexión'))

    await escribir(contenedor.querySelector('#connName'), 'Nueva')
    await escribir(contenedor.querySelector('#baseUrl'), 'https://c.scmibp1.ondemand.com/')
    await pulsar(boton('Crear conexión'))

    expect(api.post).toHaveBeenCalledWith('/api/admin/connections', expect.objectContaining({ kind: 'ibp', name: 'Nueva' }))
    expect(abierto('SAP IBP')).toBe(true)
    expect(abierto('+ Nueva conexión')).toBe(false)
  })
})

describe('Personas, por permiso', () => {
  const persona = (cambios) => ({
    id: cambios.email, name: '', status: 'active', isAdmin: false, isPlatformAdmin: false, lastLoginAt: null, ...cambios,
  })
  const GENTE = [
    persona({ email: 'yo@x.com', isPlatformAdmin: true, isAdmin: true }),
    persona({ email: 'admin@x.com', isAdmin: true }),
    persona({ email: 'ana@x.com' }),
    persona({ email: 'beto@x.com' }),
    persona({ email: 'baja@x.com', status: 'disabled', isAdmin: true }),
  ]
  const VIEWER = { id: 'yo@x.com', isPlatformAdmin: true }

  beforeEach(() => {
    api.get.mockResolvedValue({ users: GENTE })
  })

  it('cuatro grupos: los de gente en activo abiertos y el de baja cerrado', async () => {
    await montar(UsersTab, { viewer: VIEWER, clientId: 'cli-1' })

    expect(['Plataforma', 'Admin', 'Usuario'].map(abierto)).toEqual([true, true, true])
    expect(abierto('De baja')).toBe(false)
    expect(cabecera('De baja').textContent).toContain('baja@x.com')
  })

  it('cada persona está en el grupo de su permiso más alto, y una sola vez', async () => {
    await montar(UsersTab, { viewer: VIEWER, clientId: 'cli-1' })
    const filas = celdas()

    // «yo» es plataforma Y admin: sale una vez, en Plataforma.
    expect(filas.filter((f) => f.includes('yo@x.com'))).toHaveLength(1)
    expect(filas).toHaveLength(4)
    expect(contenedor.textContent).not.toContain('baja@x.com tú')
  })

  it('abrir «De baja» enseña a quien está de baja, con «Reactivar»', async () => {
    await montar(UsersTab, { viewer: VIEWER, clientId: 'cli-1' })
    await pulsar(cabecera('De baja'))
    expect(celdas().some((f) => f.includes('baja@x.com') && f.includes('Reactivar'))).toBe(true)
  })

  it('ya no hay columna «Estado»: el grupo lo dice', async () => {
    await montar(UsersTab, { viewer: VIEWER, clientId: 'cli-1' })
    expect([...contenedor.querySelectorAll('thead th')].map((th) => th.textContent.trim())).not.toContain('Estado')
  })

  it('«Dar de alta» empieza plegado', async () => {
    await montar(UsersTab, { viewer: VIEWER, clientId: 'cli-1' })
    expect(abierto('+ Dar de alta')).toBe(false)
    expect(contenedor.querySelector('#userEmail')).toBeNull()
  })
})

describe('Clientes, por estado', () => {
  const CLIENTES = [
    { id: 'c1', name: 'Acme', slug: 'acme', userCount: 3, moduleCount: 2, status: 'active' },
    { id: 'c2', name: 'Beta', slug: 'beta', userCount: 1, moduleCount: 1, status: 'active' },
    { id: 'c3', name: 'Gamma', slug: 'gamma', userCount: 0, moduleCount: 0, status: 'suspended' },
  ]

  const props = (cambios = {}) => ({ clients: CLIENTES, onChanged: vi.fn(), selectedClientId: null, onSelect: vi.fn(), ...cambios })

  it('activos abiertos y suspendidos cerrados', async () => {
    await montar(ClientsTab, props())
    expect(abierto('Activos')).toBe(true)
    expect(abierto('Suspendidos')).toBe(false)
    expect(cabecera('Suspendidos').textContent).toContain('Gamma')
    expect(celdas()).toHaveLength(2)
  })

  it('suspender a un cliente abre el grupo de suspendidos, para que no parezca que desapareció', async () => {
    api.patch.mockResolvedValue({})
    await montar(ClientsTab, props())
    await pulsar(boton('Suspender'))

    expect(api.patch).toHaveBeenCalledWith('/api/admin/clients', { clientId: 'c1', status: 'suspended' })
    expect(abierto('Suspendidos')).toBe(true)
  })

  it('pulsar una fila la elige', async () => {
    api.get.mockResolvedValue({ subscriptions: [] })
    const elegida = vi.fn()
    await montar(ClientsTab, props({ onSelect: elegida }))
    await pulsar([...contenedor.querySelectorAll('tbody tr')][0])
    expect(elegida).toHaveBeenCalledWith('c1')
  })

  it('sin clientes lo dice, y mientras lee, también', async () => {
    await montar(ClientsTab, props({ clients: [], cargados: false }))
    expect(contenedor.textContent).toContain('Leyendo los clientes…')
  })

  it('«Nuevo cliente» empieza plegado', async () => {
    await montar(ClientsTab, props())
    expect(abierto('+ Nuevo cliente')).toBe(false)
    expect(contenedor.querySelector('#clientName')).toBeNull()
  })
})
