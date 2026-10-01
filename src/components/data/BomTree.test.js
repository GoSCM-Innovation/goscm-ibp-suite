// @vitest-environment jsdom
//
// La pantalla del árbol, con la forma de v7: buscador arriba y, sin producto, solo el mensaje inicial
// (NO una lista de productos ni un selector de planta); con producto, una tabla de once columnas con
// las raíces de todas las plantas juntas.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { default: BomTree } = await import('./BomTree.jsx')
const { guardar, olvidarBase } = await import('../../lib/explorer-db.js')

let raiz
let contenedor

async function montar() {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(BomTree))
  })
  // Sale cuando termina de leer la base local: se espera a que esté, no un tiempo fijo.
  await vi.waitFor(() => { if (!contenedor.querySelector('.bom-prompt')) throw new Error('aún leyendo') })
}

async function escribir(valor) {
  const campo = contenedor.querySelector('.bom-search-inp')
  const poner = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  await act(async () => {
    poner.call(campo, valor)
    campo.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  olvidarBase()
  await guardar('bom_psh', [
    { SOURCEID: 'S1', PRDID: 'FG1', LOCID: 'P1', SOURCETYPE: 'M', OUTPUTCOEFFICIENT: '1' },
    { SOURCEID: 'S2', PRDID: 'SF1', LOCID: 'P1', SOURCETYPE: 'M', OUTPUTCOEFFICIENT: '1' },
  ])
  await guardar('bom_psi', [
    { SOURCEID: 'S1', PRDID: 'RM1', COMPONENTCOEFFICIENT: '2.5', ISALTITEM: '' },
    { SOURCEID: 'S1', PRDID: 'SF1', COMPONENTCOEFFICIENT: '1', ISALTITEM: '' },
    { SOURCEID: 'S2', PRDID: 'RM2', COMPONENTCOEFFICIENT: '4', ISALTITEM: '' },
  ])
  await guardar('bom_prd', [
    { PRDID: 'FG1', PRDDESCR: 'Producto terminado', MATTYPEID: 'FERT', UOMID: 'KG' },
    { PRDID: 'RM1', PRDDESCR: 'Harina', MATTYPEID: 'ROH', UOMID: 'KG' },
  ])
  await guardar('bom_loc', [{ LOCID: 'P1', LOCDESCR: 'Planta Uno' }])
})

afterEach(async () => {
  await act(async () => { raiz?.unmount() })
  contenedor?.remove()
  olvidarBase()
})

describe('sin producto elegido', () => {
  it('solo el buscador y el mensaje inicial de v7', async () => {
    await montar()
    expect(contenedor.textContent).toContain('Buscar producto')
    expect(contenedor.textContent).toContain('Busca un producto en el campo superior')
    expect(contenedor.querySelector('.bom-search-inp').placeholder).toBe('Código o descripción...')
    // Lo que v7 NO tenía y la suite puso: una lista de productos a la vista y un selector de planta.
    expect(contenedor.querySelector('select')).toBeNull()
    expect(contenedor.querySelector('table')).toBeNull()
    expect(contenedor.textContent).not.toContain('con receta')
  })

  it('los botones y contadores de v7', async () => {
    await montar()
    const botones = [...contenedor.querySelectorAll('button')].map((b) => b.textContent)
    expect(botones).toEqual(['⊟ Colapsar', '⬇ Exportar', '✕ Limpiar'])
    expect(contenedor.querySelector('.stats-row').textContent).toBe('Raíces: -Visibles: -Prof.máx: -')
  })
})

describe('el buscador', () => {
  it('encuentra por código y por descripción', async () => {
    await montar()
    await escribir('fg1')
    expect([...contenedor.querySelectorAll('.ss-opt')].map((o) => o.textContent)).toEqual(['FG1 · Producto terminado'])

    await escribir('terminado')
    expect(contenedor.querySelectorAll('.ss-opt')).toHaveLength(1)

    await escribir('nada')
    expect(contenedor.querySelector('.ss-none').textContent).toBe('Sin coincidencias')
  })
})

describe('con un producto elegido', () => {
  async function elegirFG1() {
    await montar()
    await escribir('FG1')
    await act(async () => {
      contenedor.querySelector('.ss-opt').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    })
    await vi.waitFor(() => { if (!contenedor.querySelector('table')) throw new Error('aún cargando el árbol') })
  }

  it('una tabla con las columnas de v7, y las raíces de todas las plantas juntas', async () => {
    await elegirFG1()
    const columnas = [...contenedor.querySelectorAll('th')].map((th) => th.textContent)
    expect(columnas).toEqual([
      '', 'Material Padre Nivel 1', 'Material Padre del Nivel', 'Nivel', 'Planta', 'ID de producción',
      'Material', 'Reemplazante', 'Coeficiente', 'Tipo de Material', 'Tipo', 'Puestos de trabajo',
    ])
    expect(contenedor.querySelector('.stats-row').textContent).toContain('Raíces: 1')
  })

  it('abrir una raíz enseña sus componentes y el divisor «Componentes PSI»', async () => {
    await elegirFG1()
    await act(async () => { contenedor.querySelector('.exp-btn:not(.no-ch)').click() })
    expect(contenedor.querySelector('.tr-comp-divider').textContent).toContain('Componentes PSI (2)')
    expect(contenedor.textContent).toContain('RM1')
    // El nivel mostrado: raíz = 1 y sus componentes directos = 1.
    const niveles = [...contenedor.querySelectorAll('.lvl-badge')].map((n) => n.textContent)
    expect(niveles).toEqual(['1', '1', '1'])
  })

  it('«Limpiar» vuelve al mensaje inicial', async () => {
    await elegirFG1()
    await act(async () => {
      [...contenedor.querySelectorAll('button')].find((b) => b.textContent.includes('Limpiar')).click()
    })
    expect(contenedor.querySelector('table')).toBeNull()
    expect(contenedor.textContent).toContain('Busca un producto en el campo superior')
  })
})
