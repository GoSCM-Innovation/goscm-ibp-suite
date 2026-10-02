// @vitest-environment jsdom
//
// El panel «MAPEO DE ENTIDADES» con la forma de v7: las tarjetas de cada aplicación con sus nombres en
// inglés, el buscador con «(ninguna)» y «nombre (N campos)», y los campos de la tabla elegida debajo.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const detectado = {
  arbol: {
    header: { etiqueta: 'Cabecera de receta', entidad: 'SBHEADER', seguro: true, alternativas: [] },
    item: { etiqueta: 'Componentes', entidad: 'SBITEM', seguro: true, alternativas: [] },
    itemValidity: { etiqueta: 'Validez', entidad: 'SBVALIDITY', seguro: true, alternativas: [] },
    itemSub: { etiqueta: 'Sustitutos', entidad: 'SBSUB', seguro: true, alternativas: [] },
    resource: { etiqueta: 'Recursos', entidad: 'SBRES', seguro: true, alternativas: [] },
    product: { etiqueta: 'Productos', entidad: 'SBPRODUCT', seguro: true, alternativas: [] },
    locMaster: { etiqueta: 'Ubicaciones', entidad: 'SBLOCATION', seguro: true, alternativas: [] },
    resMaster: { etiqueta: 'Recursos maestro', entidad: 'SBRESOURCE', seguro: true, alternativas: [] },
    resLoc: { etiqueta: 'Recurso por ubicación', entidad: 'SBRESLOC', seguro: true, alternativas: [] },
  },
  red: {
    location: { etiqueta: 'Arcos', entidad: 'SBSRCLOC', seguro: true, alternativas: [] },
    customer: { etiqueta: 'Clientes', entidad: 'SBSRCCUST', seguro: true, alternativas: [] },
    product: { etiqueta: 'Productos', entidad: 'SBPRODUCT', seguro: true, alternativas: [] },
    sourceProd: { etiqueta: 'Cabecera', entidad: 'SBHEADER', seguro: true, alternativas: [] },
    locMaster: { etiqueta: 'Ubicaciones', entidad: 'SBLOCATION', seguro: true, alternativas: [] },
    custMaster: { etiqueta: 'Clientes maestro', entidad: 'SBCUSTOMER', seguro: true, alternativas: [] },
    sourceItem: { etiqueta: 'Componentes', entidad: 'SBITEM', seguro: true, alternativas: [] },
    locProd: { etiqueta: 'Producto por ubicación', entidad: 'SBLOCPROD', seguro: true, alternativas: [] },
    custProd: { etiqueta: 'Producto por cliente', entidad: 'SBCUSTPROD', seguro: true, alternativas: [] },
  },
}

const entidades = [
  'SBCUSTOMER', 'SBCUSTPROD', 'SBHEADER', 'SBITEM', 'SBLOCATION', 'SBLOCPROD', 'SBPRODUCT', 'SBRES',
  'SBRESLOC', 'SBRESOURCE', 'SBSRCCUST', 'SBSRCLOC', 'SBSUB', 'SBVALIDITY',
]
const campos = Object.fromEntries(entidades.map((nombre) => [nombre, ['A', 'B', `CAMPO_DE_${nombre}`]]))

vi.mock('../../lib/ibp-explorer.js', () => ({
  fetchExplorerMap: vi.fn(async () => ({
    detectado, entidades, campos, guardado: { roles: {}, fields: {} }, prefijo: 'SB',
  })),
  saveExplorerMap: vi.fn(async () => ({})),
  resetExplorerMap: vi.fn(async () => ({})),
}))

const { default: PanelMapeo } = await import('./PanelMapeo.jsx')

let raiz
let contenedor

async function montar(variante, extra = {}) {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(PanelMapeo, {
      variante, destino: { connectionId: 'c', planningArea: 'PA', versionId: '' }, abierto: true,
      onAlternar: () => {}, ...extra,
    }))
  })
  await vi.waitFor(() => { if (!contenedor.querySelector('.mdt-card')) throw new Error('aún leyendo') })
}

const etiquetas = () => [...contenedor.querySelectorAll('.mdt-label')].map((e) => e.textContent.trim())

afterEach(async () => {
  await act(async () => { raiz?.unmount() })
  contenedor?.remove()
})

describe('las tarjetas de cada aplicación', () => {
  it('Production Visualizer: ocho, con la validez y sin el recurso por ubicación', async () => {
    await montar('pv')
    expect(etiquetas()).toEqual([
      'Production Source Header', 'Production Source Item', 'Production Source Item Validity',
      'Production Source Item Sub', 'Production Source Resource', 'Product', 'Location (maestro)',
      'Resource (maestro)',
    ])
  })

  it('Production Analyzer: diez, con las dos de la red y sin la validez', async () => {
    await montar('pa')
    expect(etiquetas()).toEqual([
      'Production Source Header', 'Production Source Item', 'Production Source Item Sub',
      'Production Source Resource', 'Product', 'Location (maestro)', 'Resource (maestro)',
      'Resource Location (maestro)', 'Location Product', 'Location Source',
    ])
  })

  it('las dos de la red: nueve, las mismas', async () => {
    await montar('nv')
    const nv = etiquetas()
    await act(async () => { raiz.unmount() })
    contenedor.remove()
    await montar('na')
    expect(etiquetas()).toEqual(nv)
    expect(nv).toEqual([
      'Location Source', 'Customer Source', 'Product', 'Production Source Header', 'Location', 'Customer',
      'Production Source Item', 'Location Product', 'Customer Product',
    ])
  })
})

describe('la forma de v7', () => {
  it('título sin numeral y el texto de ayuda de cada aplicación', async () => {
    await montar('nv')
    expect(contenedor.querySelector('.panel-title').textContent).toContain('MAPEO DE ENTIDADES')
    expect(contenedor.querySelector('.panel-title').textContent).not.toContain('①')
    expect(contenedor.querySelector('.panel-desc').textContent).toContain('Confirma para cargar el catálogo de productos.')
  })

  it('el campo dice «nombre (N campos)» y debajo van todos los campos de la tabla', async () => {
    await montar('pv')
    const primera = contenedor.querySelector('.mdt-card')
    expect(primera.querySelector('.ss-input-vis').value).toBe('SBHEADER (3 campos)')
    expect(primera.querySelector('.mdt-fields').textContent).toBe('A, B, CAMPO_DE_SBHEADER')
  })

  it('«(ninguna)» va primero en la lista', async () => {
    await montar('pv')
    const opciones = [...contenedor.querySelector('.mdt-card .ss-list').children].map((o) => o.textContent)
    expect(opciones[0]).toBe('(ninguna)')
    expect(opciones[1]).toBe('SBCUSTOMER (3 campos)')
  })

  it('escribir filtra la lista, y sin coincidencias lo dice', async () => {
    await montar('pv')
    const campo = contenedor.querySelector('.mdt-card .ss-input-vis')
    const poner = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    await act(async () => {
      poner.call(campo, 'validity')
      campo.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const lista = [...contenedor.querySelector('.mdt-card .ss-list').children].map((o) => o.textContent)
    expect(lista).toEqual(['(ninguna)', 'SBVALIDITY (3 campos)'])

    await act(async () => {
      poner.call(campo, 'zzz')
      campo.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(contenedor.querySelector('.mdt-card .ss-none').textContent).toBe('Sin resultados para "zzz"')
  })

  it('elegir «(ninguna)» deja la tarjeta sin tabla y sin campos', async () => {
    await montar('pv')
    const tarjeta = contenedor.querySelectorAll('.mdt-card')[2]
    await act(async () => {
      tarjeta.querySelector('.ss-opt').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    })
    expect(tarjeta.querySelector('.ss-input-vis').value).toBe('')
    expect(tarjeta.querySelector('.mdt-fields').textContent).toBe('—')
  })

  it('no lleva los añadidos de la suite: ni avisos de papeles ni el prefijo del tenant', async () => {
    await montar('pv')
    expect(contenedor.querySelector('.mattype-note')).toBeNull()
    expect(contenedor.textContent).not.toContain('Prefijo')
  })
})
