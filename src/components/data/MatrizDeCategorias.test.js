// @vitest-environment jsdom
//
// El cuerpo del paso ③ con la forma de v7: la matriz de interruptores, las cuatro categorías con su
// color, el «?» con su tooltip flotante (textos y posición) y los avisos al marcar.
//
// Se monta con `react-dom` a secas y `createElement`, como el resto de las pruebas de componente.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MatrizDeCategorias from './MatrizDeCategorias.jsx'
import { MATTYPE_CATS, TEXTOS_DE_CATEGORIA } from '../../../core/ibp/mattype-config.js'

let raiz
let contenedor

async function montar(props) {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(MatrizDeCategorias, props))
  })
}

afterEach(async () => {
  await act(async () => { raiz?.unmount() })
  contenedor?.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const tipos = [
  { tipo: 'FERT', productos: 1500, categorias: ['finished'] },
  { tipo: 'ROH', productos: 7, categorias: [] },
]

const ayudas = () => [...contenedor.querySelectorAll('.mattype-cat-help')]
const tooltip = () => document.getElementById('mattype-floating-tooltip')

/** React reparte enter/leave a partir de mouseover/mouseout con su `relatedTarget`. */
async function entrar(elemento) {
  await act(async () => { elemento.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null })) })
}
async function salir(elemento) {
  await act(async () => { elemento.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: null })) })
}

describe('sin tipos', () => {
  it('dice que no hay nada que categorizar', async () => {
    await montar({ tipos: [], onAlternar: () => {} })
    expect(contenedor.querySelector('p.mattype-empty').textContent).toBe('No hay tipos incluidos para categorizar.')
    expect(contenedor.querySelector('table')).toBeNull()
  })
})

describe('la matriz', () => {
  it('cabeceras: Tipo, Productos y una por categoría, con su color y su nombre de v7', async () => {
    await montar({ tipos, onAlternar: () => {} })
    expect(contenedor.querySelector('.mattype-matrix-scroll > table.mattype-matrix-table')).not.toBeNull()
    expect(contenedor.querySelector('th.mattype-matrix-th-type').textContent).toBe('Tipo')
    expect(contenedor.querySelector('th.mattype-matrix-th-count').textContent).toBe('Productos')

    const categorias = [...contenedor.querySelectorAll('th.mattype-matrix-th-cat')]
    expect(categorias.map((th) => th.textContent)).toEqual([
      'Producto Terminado?', 'Semiterminado?', 'Mat. Prima / Insumo?', 'Mercadería?',
    ])
    categorias.forEach((th, i) => expect(th.style.color).toBe(MATTYPE_CATS[i].color))
  })

  it('una fila por tipo con «N prods» y una casilla por categoría con data-cat', async () => {
    await montar({ tipos, onAlternar: () => {} })
    const filas = [...contenedor.querySelectorAll('tbody tr')]
    expect(filas).toHaveLength(2)
    expect(filas[0].querySelector('.mattype-code').textContent).toBe('FERT')
    expect(filas[0].querySelector('.mattype-col-count').textContent).toBe('1500 prods')

    const celdas = filas[0].querySelectorAll('td.mattype-matrix-cell')
    expect([...celdas].map((c) => c.querySelector('label.mattype-toggle').dataset.cat))
      .toEqual(['finished', 'semi', 'rawmat', 'trading'])
    expect([...celdas].map((c) => c.querySelector('input').checked)).toEqual([true, false, false, false])
    expect(celdas[0].querySelector('label > input + span.mattype-toggle-slider')).not.toBeNull()
  })

  it('un tipo puede estar en más de una categoría', async () => {
    await montar({ tipos: [{ tipo: 'HALB', productos: 3, categorias: ['semi', 'trading'] }], onAlternar: () => {} })
    const marcadas = [...contenedor.querySelectorAll('tbody input')].map((i) => i.checked)
    expect(marcadas).toEqual([false, true, false, true])
  })

  it('la nota de v7 va debajo', async () => {
    await montar({ tipos, onAlternar: () => {} })
    expect(contenedor.querySelector('p.mattype-note').textContent)
      .toBe('ℹ️ Un tipo puede estar en más de una categoría. Sin categoría = todas las métricas con reglas en modo 🟡.')
  })
})

describe('los avisos', () => {
  it('marcar una casilla avisa (tipo, categoría, true)', async () => {
    const onAlternar = vi.fn()
    await montar({ tipos, onAlternar })
    const casilla = contenedor.querySelectorAll('tbody tr')[1].querySelector('[data-cat=rawmat] input')
    await act(async () => { casilla.click() })
    expect(onAlternar).toHaveBeenCalledWith('ROH', 'rawmat', true)
  })

  it('desmarcar una casilla avisa (tipo, categoría, false)', async () => {
    const onAlternar = vi.fn()
    await montar({ tipos, onAlternar })
    const casilla = contenedor.querySelectorAll('tbody tr')[0].querySelector('[data-cat=finished] input')
    await act(async () => { casilla.click() })
    expect(onAlternar).toHaveBeenCalledWith('FERT', 'finished', false)
  })
})

describe('el tooltip del «?»', () => {
  it('no hay tooltip hasta pasar el ratón', async () => {
    await montar({ tipos, onAlternar: () => {} })
    expect(ayudas()).toHaveLength(4)
    expect(ayudas().every((a) => a.textContent === '?')).toBe(true)
    expect(tooltip()).toBeNull()
  })

  it('al entrar muestra título, descripción, reglas y ejemplo de ESA categoría, colgado de <body>', async () => {
    await montar({ tipos, onAlternar: () => {} })
    await entrar(ayudas()[1])

    const tip = tooltip()
    expect(tip).not.toBeNull()
    expect(tip.parentElement).toBe(document.body)
    expect(tip.querySelector('.mattype-cat-tooltip-title').textContent).toBe(TEXTOS_DE_CATEGORIA.semi.label)
    expect(tip.textContent).toContain(TEXTOS_DE_CATEGORIA.semi.desc)
    expect([...tip.querySelectorAll('ul.mattype-cat-tooltip-rules li')].map((li) => li.textContent))
      .toEqual(TEXTOS_DE_CATEGORIA.semi.rules)
    expect(tip.querySelector('.mattype-cat-tooltip-ex').textContent).toBe('Ej: SF_TAPA_ROSCA, WIP_MEZCLA_BASE')
  })

  it('al salir desaparece', async () => {
    await montar({ tipos, onAlternar: () => {} })
    await entrar(ayudas()[0])
    expect(tooltip()).not.toBeNull()
    await salir(ayudas()[0])
    expect(tooltip()).toBeNull()
  })

  it('al desmontar la matriz no queda ningún tooltip huérfano', async () => {
    await montar({ tipos, onAlternar: () => {} })
    await entrar(ayudas()[2])
    await act(async () => { raiz.unmount() })
    raiz = null
    expect(tooltip()).toBeNull()
  })

  describe('la posición', () => {
    // jsdom no calcula geometría: todo mide 0. Se fija el rectángulo del «?», el alto del tooltip y el
    // ancho de la ventana para comprobar la cuenta de v7.
    function simular(rect, alto = 100, ancho = 1024) {
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(alto)
      vi.stubGlobal('innerWidth', ancho)
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
        left: rect.left, top: rect.top, width: 14, height: 14, right: rect.left + 14, bottom: rect.top + 14,
      })
    }

    it('centrado sobre el «?» y encima de él', async () => {
      await montar({ tipos, onAlternar: () => {} })
      simular({ left: 500, top: 300 })
      await entrar(ayudas()[0])
      // 500 + 14/2 - 240/2 = 387;  300 - 100 - 10 = 190
      expect(tooltip().style.left).toBe('387px')
      expect(tooltip().style.top).toBe('190px')
    })

    it('sin salirse por la izquierda: a 8 px del borde', async () => {
      await montar({ tipos, onAlternar: () => {} })
      simular({ left: 10, top: 300 })
      await entrar(ayudas()[0])
      expect(tooltip().style.left).toBe('8px')
    })

    it('sin salirse por la derecha: a 8 px del borde', async () => {
      await montar({ tipos, onAlternar: () => {} })
      simular({ left: 1000, top: 300 }, 100, 1024)
      await entrar(ayudas()[0])
      expect(tooltip().style.left).toBe(`${1024 - 240 - 8}px`)
    })

    it('si no cabe arriba, va debajo del «?»', async () => {
      await montar({ tipos, onAlternar: () => {} })
      simular({ left: 500, top: 50 })
      await entrar(ayudas()[0])
      // 50 - 100 - 10 < 8  →  bottom (50 + 14) + 10 = 74
      expect(tooltip().style.top).toBe('74px')
    })
  })
})
