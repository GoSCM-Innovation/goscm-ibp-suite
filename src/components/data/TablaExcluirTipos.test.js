// @vitest-environment jsdom
//
// El cuerpo del paso ② con el texto y la forma de v7: la tabla de interruptores, el «Incluido» /
// «Excluido» de cada fila, la fila apagada, los estados vacío y cargando, y el aviso al cambiar.
//
// Se monta con `react-dom` a secas y `createElement`, como el resto de las pruebas de componente.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TablaExcluirTipos from './TablaExcluirTipos.jsx'

let raiz
let contenedor

async function montar(props) {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(TablaExcluirTipos, props))
  })
}

afterEach(async () => {
  await act(async () => { raiz?.unmount() })
  contenedor?.remove()
})

const tipos = [
  { tipo: 'FERT', productos: 1500, excluido: false },
  { tipo: 'HALB', productos: 12, excluido: true },
]

describe('los estados sin tabla', () => {
  it('cargando: el aviso de v7 y nada más', async () => {
    await montar({ tipos: [], cargando: true, onCambiar: () => {} })
    expect(contenedor.textContent).toBe('⏳ Cargando tipos de material desde SAP IBP…')
    expect(contenedor.querySelector('table')).toBeNull()
  })

  it('cargando gana aunque ya haya tipos de una lectura anterior', async () => {
    await montar({ tipos, cargando: true, onCambiar: () => {} })
    expect(contenedor.querySelector('table')).toBeNull()
  })

  it('sin tipos: pide cargar datos primero', async () => {
    await montar({ tipos: [], cargando: false, onCambiar: () => {} })
    const vacio = contenedor.querySelector('p.mattype-empty')
    expect(vacio.textContent).toBe('Carga datos primero para detectar los tipos de material.')
    expect(contenedor.querySelector('table')).toBeNull()
  })
})

describe('la tabla', () => {
  it('lleva las cabeceras y la nota de v7', async () => {
    await montar({ tipos, cargando: false, onCambiar: () => {} })
    const cabeceras = [...contenedor.querySelectorAll('table.mattype-toggle-table th')].map((th) => th.textContent)
    expect(cabeceras).toEqual(['Tipo', 'Productos', 'Incluir en análisis'])
    expect(contenedor.querySelector('p.mattype-note').textContent)
      .toBe('ℹ️ Los tipos excluidos que actúen como componentes PSI de productos incluidos se validan igualmente en contexto.')
  })

  it('una fila por tipo: código, «N prods» sin separador de miles, e interruptor encendido si está incluido', async () => {
    await montar({ tipos, cargando: false, onCambiar: () => {} })
    const filas = [...contenedor.querySelectorAll('tbody tr')]
    expect(filas).toHaveLength(2)

    expect(filas[0].querySelector('.mattype-code').textContent).toBe('FERT')
    expect(filas[0].querySelector('.mattype-col-count').textContent).toBe('1500 prods')
    expect(filas[0].querySelector('input[type=checkbox]').checked).toBe(true)
    expect(filas[0].querySelector('.mattype-toggle-label').textContent).toBe('Incluido')
    expect(filas[0].className).toBe('')

    expect(filas[1].querySelector('.mattype-code').textContent).toBe('HALB')
    expect(filas[1].querySelector('input[type=checkbox]').checked).toBe(false)
    expect(filas[1].querySelector('.mattype-toggle-label').textContent).toBe('Excluido')
    expect(filas[1].classList.contains('mattype-row-excluded')).toBe(true)
  })

  it('el interruptor es label.mattype-toggle > input + span.mattype-toggle-slider', async () => {
    await montar({ tipos, cargando: false, onCambiar: () => {} })
    const etiqueta = contenedor.querySelector('label.mattype-toggle')
    expect(etiqueta.children[0].tagName).toBe('INPUT')
    expect(etiqueta.children[1].className).toBe('mattype-toggle-slider')
  })

  it('respeta el orden que le dan', async () => {
    await montar({ tipos: [...tipos].reverse(), cargando: false, onCambiar: () => {} })
    expect([...contenedor.querySelectorAll('.mattype-code')].map((e) => e.textContent)).toEqual(['HALB', 'FERT'])
  })

  it('un tipo sin cuenta de productos muestra «0 prods»', async () => {
    await montar({ tipos: [{ tipo: 'ROH', excluido: false }], cargando: false, onCambiar: () => {} })
    expect(contenedor.querySelector('.mattype-col-count').textContent).toBe('0 prods')
  })
})

describe('los avisos', () => {
  it('apagar un tipo incluido avisa (tipo, false)', async () => {
    const onCambiar = vi.fn()
    await montar({ tipos, cargando: false, onCambiar })
    await act(async () => { contenedor.querySelectorAll('input')[0].click() })
    expect(onCambiar).toHaveBeenCalledWith('FERT', false)
  })

  it('encender un tipo excluido avisa (tipo, true)', async () => {
    const onCambiar = vi.fn()
    await montar({ tipos, cargando: false, onCambiar })
    await act(async () => { contenedor.querySelectorAll('input')[1].click() })
    expect(onCambiar).toHaveBeenCalledWith('HALB', true)
  })

  it('el estado lo manda quien llama: sin actualizar las props el interruptor no se queda cambiado', async () => {
    await montar({ tipos, cargando: false, onCambiar: () => {} })
    await act(async () => { contenedor.querySelectorAll('input')[0].click() })
    expect(contenedor.querySelectorAll('input')[0].checked).toBe(true)
  })
})
