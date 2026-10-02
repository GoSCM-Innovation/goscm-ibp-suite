// @vitest-environment jsdom
//
// El cuerpo del paso ④ con la forma de v7: un botón por tabla con campos, la insignia «N extra», y el
// diálogo —buscador, campos obligatorios bloqueados, adicionales, contador— con su Guardar y su
// Cerrar. Cerrar DESCARTA; solo Guardar entrega la selección.
//
// Se monta con `react-dom` a secas y `createElement`, como el resto de las pruebas de componente.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CamposAdicionales from './CamposAdicionales.jsx'

let raiz
let contenedor

const entidades = [
  { clave: 'product', etiqueta: 'Product', campos: ['PRDID', 'PRDDESCR', 'MATTYPEID', 'BASEUOM', 'PRDGROUP', 'WEIGHT'] },
  { clave: 'location', etiqueta: 'Location', campos: ['LOCID', 'LOCDESCR', 'LOCTYPE', 'LOCVALID', 'COUNTRY'] },
  { clave: 'resource', etiqueta: 'Resource', campos: null },
]
const obligatorios = { product: ['PRDID', 'PRDDESCR', 'MATTYPEID'], location: ['LOCID', 'LOCDESCR', 'LOCTYPE'] }
const ocultos = { location: ['LOCVALID'] }
const descripciones = { PRDID: 'Producto', BASEUOM: 'Unidad de medida base', PRDGROUP: 'Grupo de producto' }

async function montar(props = {}) {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  const alGuardar = props.onGuardar ?? (() => {})
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(CamposAdicionales, {
      entidades, obligatorios, ocultos, descripciones, seleccion: {}, ...props, onGuardar: alGuardar,
    }))
  })
}

afterEach(async () => {
  await act(async () => { raiz?.unmount() })
  contenedor?.remove()
})

const botones = () => [...contenedor.querySelectorAll('.ef-entity-buttons > button')]
const dialogo = () => document.getElementById('efModal')
const nombres = (seccion) => [...dialogo().querySelectorAll(seccion)].map((e) => e.textContent)

async function abrir(etiqueta) {
  const boton = botones().find((b) => b.textContent.startsWith(etiqueta))
  await act(async () => { boton.click() })
}

/** Escribe en el buscador como lo haría una persona (React escucha el evento `input`). */
async function buscar(texto) {
  const caja = document.getElementById('efModalSearch')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(caja, texto)
    caja.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** El interruptor de un campo ADICIONAL, buscándolo por su nombre. */
function interruptor(campo) {
  const fila = [...dialogo().querySelectorAll('.ef-field-item')]
    .find((f) => f.querySelector('.ef-field-name').textContent === campo)
  return fila.querySelector('input')
}

describe('los botones', () => {
  it('uno por entidad CON campos; la no mapeada no se dibuja', async () => {
    await montar()
    expect(botones().map((b) => b.textContent)).toEqual(['Product', 'Location'])
    expect(botones().every((b) => b.className === 'btn btn-secondary btn-small')).toBe(true)
  })

  it('con extras elegidos lleva la insignia «N extra»', async () => {
    await montar({ seleccion: { product: ['BASEUOM', 'WEIGHT'] } })
    const insignia = botones()[0].querySelector('span.ef-count-badge')
    expect(insignia.textContent).toBe('2 extra')
    expect(botones()[1].querySelector('.ef-count-badge')).toBeNull()
  })

  it('si ninguna entidad tiene campos, pide configurarlas en el paso ①', async () => {
    await montar({ entidades: [{ clave: 'product', etiqueta: 'Product', campos: null }] })
    expect(contenedor.querySelector('.ef-entity-buttons p').textContent)
      .toBe('Configura las entidades en el paso ① para habilitar la selección de campos.')
    expect(botones()).toHaveLength(0)
  })

  it('sin ninguna entidad, el mismo aviso', async () => {
    await montar({ entidades: [] })
    expect(contenedor.querySelector('.ef-entity-buttons p')).not.toBeNull()
  })

  it('el diálogo no existe hasta pulsar un botón', async () => {
    await montar()
    expect(dialogo()).toBeNull()
  })
})

describe('el diálogo', () => {
  it('abre con la etiqueta de la entidad como título, el buscador y el pie', async () => {
    await montar()
    await abrir('Product')
    expect(dialogo()).not.toBeNull()
    expect(dialogo().open).toBe(true)
    expect(dialogo().querySelector('#efModalTitle').textContent).toBe('Product')
    expect(document.getElementById('efModalSearch').placeholder).toBe('Buscar por ID o descripción...')
    expect(dialogo().querySelector('.dialog-close-btn').getAttribute('aria-label')).toBe('Cerrar')
    const pie = [...dialogo().querySelectorAll('.ef-fields-footer button')].map((b) => b.textContent)
    expect(pie).toEqual(['Cancelar', 'Guardar'])
  })

  it('los obligatorios van primero, con el interruptor bloqueado y encendido y su insignia', async () => {
    await montar()
    await abrir('Product')
    const etiquetas = nombres('.ef-section-label')
    expect(etiquetas).toEqual(['Campos obligatorios', 'Campos adicionales disponibles'])

    const filas = [...dialogo().querySelectorAll('.ef-field-item')]
    const obligatoria = filas[0]
    expect(obligatoria.querySelector('.ef-field-name').textContent).toBe('PRDID')
    expect(obligatoria.querySelector('.ef-field-desc').textContent).toBe('Producto')
    expect(obligatoria.querySelector('.ef-toggle-wrap').classList.contains('locked')).toBe(true)
    const entrada = obligatoria.querySelector('input')
    expect(entrada.checked).toBe(true)
    expect(entrada.disabled).toBe(true)
    expect(obligatoria.querySelector('.ef-mandatory-badge').textContent).toBe('Obligatorio')
    expect(nombres('.ef-mandatory-badge')).toHaveLength(3)
  })

  it('los adicionales excluyen obligatorios y ocultos, y muestran la descripción si existe', async () => {
    await montar()
    await abrir('Location')
    const campos = nombres('.ef-field-name')
    // LOCVALID es técnico (oculto): se pide siempre y nunca se enseña.
    expect(campos).toEqual(['LOCID', 'LOCDESCR', 'LOCTYPE', 'COUNTRY'])

    await act(async () => { dialogo().querySelector('.dialog-close-btn').click() })
    await abrir('Product')
    const filas = [...dialogo().querySelectorAll('.ef-field-item')]
    const unidad = filas.find((f) => f.querySelector('.ef-field-name').textContent === 'BASEUOM')
    expect(unidad.querySelector('.ef-field-desc').textContent).toBe('Unidad de medida base')
    const sinDescripcion = filas.find((f) => f.querySelector('.ef-field-name').textContent === 'WEIGHT')
    expect(sinDescripcion.querySelector('.ef-field-desc')).toBeNull()
    expect(sinDescripcion.querySelector('.ef-mandatory-badge')).toBeNull()
  })

  it('sin obligatorios no hay sección de obligatorios', async () => {
    await montar({ obligatorios: {} })
    await abrir('Product')
    expect(nombres('.ef-section-label')).toEqual(['Campos adicionales disponibles'])
  })

  it('arranca con la selección ya guardada, y el contador lo dice', async () => {
    await montar({ seleccion: { product: ['BASEUOM'] } })
    await abrir('Product')
    expect(interruptor('BASEUOM').checked).toBe(true)
    expect(interruptor('WEIGHT').checked).toBe(false)
    expect(dialogo().querySelector('#efModalCount').textContent).toBe('1 campo(s) adicional(es) seleccionado(s)')
  })

  it('el contador está vacío con 0 seleccionados y sube y baja al marcar', async () => {
    await montar()
    await abrir('Product')
    const contador = () => dialogo().querySelector('#efModalCount').textContent
    expect(contador()).toBe('')

    await act(async () => { interruptor('BASEUOM').click() })
    await act(async () => { interruptor('WEIGHT').click() })
    expect(contador()).toBe('2 campo(s) adicional(es) seleccionado(s)')

    await act(async () => { interruptor('BASEUOM').click() })
    expect(contador()).toBe('1 campo(s) adicional(es) seleccionado(s)')
    await act(async () => { interruptor('WEIGHT').click() })
    expect(contador()).toBe('')
  })
})

describe('el buscador', () => {
  it('filtra por id sin distinguir mayúsculas', async () => {
    await montar()
    await abrir('Product')
    await buscar('prdg')
    expect(nombres('.ef-field-name')).toEqual(['PRDGROUP'])
  })

  it('filtra por descripción', async () => {
    await montar()
    await abrir('Product')
    await buscar('unidad')
    expect(nombres('.ef-field-name')).toEqual(['BASEUOM'])
  })

  it('también se aplica a los obligatorios, y la sección sigue con su título', async () => {
    await montar()
    await abrir('Product')
    await buscar('mattype')
    expect(nombres('.ef-field-name')).toEqual(['MATTYPEID'])
    expect(nombres('.ef-section-label')).toEqual(['Campos obligatorios'])
  })

  it('sin coincidencias en los adicionales: «Sin resultados para "{filtro}".», con el filtro tal cual se escribió', async () => {
    await montar()
    await abrir('Product')
    await buscar('zzz ')
    expect(dialogo().querySelector('.ef-fields-list p').textContent).toBe('Sin resultados para "zzz ".')
  })

  it('un buscador vacío o en blanco no dice «sin resultados» ni filtra', async () => {
    await montar()
    await abrir('Product')
    await buscar('   ')
    expect(dialogo().querySelector('.ef-fields-list p')).toBeNull()
    expect(nombres('.ef-field-name')).toHaveLength(6)
  })

  it('lo marcado y escondido por el filtro sigue contando y se guarda', async () => {
    const onGuardar = vi.fn()
    await montar({ onGuardar })
    await abrir('Product')
    await act(async () => { interruptor('BASEUOM').click() })
    await buscar('weight')
    expect(dialogo().querySelector('#efModalCount').textContent).toBe('1 campo(s) adicional(es) seleccionado(s)')
    await act(async () => { [...dialogo().querySelectorAll('.ef-fields-footer button')][1].click() })
    expect(onGuardar).toHaveBeenCalledWith('product', ['BASEUOM'])
  })
})

describe('guardar y cerrar', () => {
  it('Guardar entrega (entidad, campos en el orden en que se marcaron) y cierra', async () => {
    const onGuardar = vi.fn()
    await montar({ onGuardar, seleccion: { product: ['WEIGHT'] } })
    await abrir('Product')
    await act(async () => { interruptor('PRDGROUP').click() })
    await act(async () => { interruptor('BASEUOM').click() })
    await act(async () => { [...dialogo().querySelectorAll('.ef-fields-footer button')][1].click() })

    expect(onGuardar).toHaveBeenCalledTimes(1)
    expect(onGuardar).toHaveBeenCalledWith('product', ['WEIGHT', 'PRDGROUP', 'BASEUOM'])
    expect(dialogo()).toBeNull()
  })

  it('Guardar sin elegir nada entrega la lista vacía (así se quitan los extras)', async () => {
    const onGuardar = vi.fn()
    await montar({ onGuardar, seleccion: { product: ['WEIGHT'] } })
    await abrir('Product')
    await act(async () => { interruptor('WEIGHT').click() })
    await act(async () => { [...dialogo().querySelectorAll('.ef-fields-footer button')][1].click() })
    expect(onGuardar).toHaveBeenCalledWith('product', [])
  })

  it('Cancelar y la ✕ descartan: no avisan y cierran', async () => {
    const onGuardar = vi.fn()
    await montar({ onGuardar })
    await abrir('Product')
    await act(async () => { interruptor('BASEUOM').click() })
    await act(async () => { [...dialogo().querySelectorAll('.ef-fields-footer button')][0].click() })
    expect(dialogo()).toBeNull()

    await abrir('Product')
    await act(async () => { dialogo().querySelector('.dialog-close-btn').click() })
    expect(dialogo()).toBeNull()
    expect(onGuardar).not.toHaveBeenCalled()
  })

  it('lo descartado no reaparece al volver a abrir: la selección temporal arranca de la guardada', async () => {
    await montar({ seleccion: { product: ['WEIGHT'] } })
    await abrir('Product')
    await act(async () => { interruptor('BASEUOM').click() })
    await act(async () => { dialogo().querySelector('.dialog-close-btn').click() })

    await abrir('Product')
    expect(interruptor('BASEUOM').checked).toBe(false)
    expect(interruptor('WEIGHT').checked).toBe(true)
  })

  it('el buscador también arranca limpio en cada apertura', async () => {
    await montar()
    await abrir('Product')
    await buscar('weight')
    await act(async () => { dialogo().querySelector('.dialog-close-btn').click() })
    await abrir('Product')
    expect(document.getElementById('efModalSearch').value).toBe('')
    expect(nombres('.ef-field-name')).toHaveLength(6)
  })

  it('cada tabla tiene su propia selección temporal', async () => {
    await montar({ seleccion: { product: ['WEIGHT'], location: ['COUNTRY'] } })
    await abrir('Location')
    expect(dialogo().querySelector('#efModalTitle').textContent).toBe('Location')
    expect(interruptor('COUNTRY').checked).toBe(true)
    expect(dialogo().querySelector('#efModalCount').textContent).toBe('1 campo(s) adicional(es) seleccionado(s)')
  })

  it('cuando el navegador cierra el diálogo por su cuenta (Escape) también se desmonta', async () => {
    await montar()
    await abrir('Product')
    await act(async () => { dialogo().dispatchEvent(new Event('close')) })
    expect(dialogo()).toBeNull()
  })
})
