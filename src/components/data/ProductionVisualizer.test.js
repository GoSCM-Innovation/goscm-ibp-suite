// @vitest-environment jsdom
//
// Que el árbol VEA lo que se acaba de bajar. Es el fallo que estas pruebas cierran, y era de los que
// no se ven en el código: la descarga funcionaba —guardaba las 98.956 filas y las nueve tablas salían
// «✓ Lista»— y el árbol seguía diciendo «no hay recetas descargadas». Se montaba antes de bajar,
// leía la base vacía, y nadie le avisaba nunca de que ya había datos.
//
// En v7 no podía pasar porque `doFetchAll` terminaba armando la lista de productos él mismo, y porque
// la tira de pestañas y el árbol estaban OCULTOS hasta que la descarga acababa. Las dos cosas se
// comprueban aquí.
//
// Se monta con `react-dom` a secas y `createElement`, como el resto de las pruebas de componente.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hayRecetas = vi.fn()
vi.mock('../../lib/bom-load.js', () => ({
  hayRecetas,
  cargarSubarbol: vi.fn(),
  productosConReceta: vi.fn(async () => []),
  descripcionesDe: vi.fn(async () => ({})),
}))

// El paso ① de verdad habla con el servidor. Aquí solo importa que su botón dispare la descarga y
// que los hijos —la barra, el estado y los logs— salgan DENTRO y solo estando abierto, como en v7.
vi.mock('./PanelMapeo.jsx', () => ({
  default: ({ abierto, textoConfirmar, confirmando, onConfirmar, children }) => createElement(
    'div',
    { 'data-prueba': 'mapeo', 'data-abierto': String(abierto) },
    createElement(
      'button',
      { type: 'button', 'data-prueba': 'confirmar', onClick: onConfirmar, disabled: confirmando },
      textoConfirmar,
    ),
    abierto ? children : null,
  ),
}))

/** El mando que la descarga de verdad publica en su `ref`. */
const mando = {
  bajar: vi.fn(),
  bajarSiVacio: vi.fn(),
  decir: vi.fn(),
  anotar: vi.fn(),
  avanzar: vi.fn(),
  cancelar: vi.fn(),
}
vi.mock('./ExplorerExtract.jsx', () => ({
  default: ({ ref }) => {
    if (ref) ref.current = mando
    return createElement('div', { 'data-prueba': 'descarga' })
  },
}))

vi.mock('./BomTree.jsx', () => ({
  default: ({ recarga, onCargados }) => {
    onCargados?.(15914)
    return createElement('div', { 'data-prueba': 'arbol', 'data-recarga': String(recarga) })
  },
}))

const { default: ProductionVisualizer } = await import('./ProductionVisualizer.jsx')

const DESTINO = { connectionId: 'c1', planningArea: 'SAP4', versionId: '' }

let contenedor
let raiz

async function montar() {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(ProductionVisualizer, { destino: DESTINO }))
  })
}

const arbol = () => contenedor.querySelector('[data-prueba="arbol"]')
const tira = () => contenedor.querySelector('.bom-tabs-bar')
const descargaVisible = () => contenedor.querySelector('[data-prueba="descarga"]')
const mapeoAbierto = () => contenedor.querySelector('[data-prueba="mapeo"]').dataset.abierto

const confirmar = async () => {
  const boton = contenedor.querySelector('[data-prueba="confirmar"]')
  await act(async () => {
    boton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  hayRecetas.mockResolvedValue(false)
})

afterEach(async () => {
  await act(async () => { raiz?.unmount() })
  contenedor?.remove()
})

describe('la descarga vive dentro del paso ①', () => {
  // En v7 la descarga no era una pantalla aparte: era lo que pasaba al pulsar el botón con el que se
  // cerraba el mapeo, y su barra salía debajo de ese mismo botón. Aquí llegó a haber un panel
  // «DESCARGA DEL ÁRBOL DE MATERIALES» con una tabla, que v7 nunca tuvo.
  it('está dentro del panel, no en uno aparte', async () => {
    await montar()
    const dentro = contenedor.querySelector('[data-prueba="mapeo"] [data-prueba="descarga"]')
    expect(dentro).not.toBeNull()
  })

  it('el botón del paso ① es el que la dispara', async () => {
    await montar()
    expect(contenedor.querySelector('[data-prueba="confirmar"]').textContent)
      .toBe('Descargar datos y construir jerarquía')

    mando.bajar.mockResolvedValue({ ok: true, guardadas: 100 })
    await confirmar()
    expect(mando.bajar).toHaveBeenCalledTimes(1)
  })
})

describe('el árbol no existe hasta que hay datos', () => {
  it('sin nada bajado no se dibuja ni la tira ni el árbol', async () => {
    await montar()
    expect(tira()).toBeNull()
    expect(arbol()).toBeNull()
  })

  it('con datos ya guardados de otra sesión sí se dibuja', async () => {
    hayRecetas.mockResolvedValue(true)
    await montar()
    expect(tira()).not.toBeNull()
    expect(arbol()).not.toBeNull()
  })
})

describe('al terminar la descarga', () => {
  // ESTE es el fallo. Sin el aviso, el árbol se quedaba con la lectura de antes de bajar.
  it('el árbol aparece y vuelve a leer la base', async () => {
    hayRecetas.mockResolvedValueOnce(false).mockResolvedValue(true)
    await montar()
    expect(arbol()).toBeNull()

    mando.bajar.mockResolvedValue({ ok: true, guardadas: 98956 })
    await confirmar()

    expect(arbol()).not.toBeNull()
    // La cuenta subió: es lo que hace que un árbol ya montado vuelva a mirar.
    expect(Number(arbol().dataset.recarga)).toBeGreaterThan(0)
  })

  it('escribe en la línea de estado cuántos productos quedaron, como v7', async () => {
    hayRecetas.mockResolvedValueOnce(false).mockResolvedValue(true)
    await montar()

    mando.bajar.mockResolvedValue({ ok: true, guardadas: 98956 })
    await confirmar()

    expect(mando.decir).toHaveBeenCalledWith(
      'ok',
      '✓ 15.914 productos en caché local. Selecciona uno para ver su BOM.',
    )
  })

  it('saliendo limpia, el paso ① se pliega — como hacía v7', async () => {
    hayRecetas.mockResolvedValueOnce(false).mockResolvedValue(true)
    await montar()
    expect(mapeoAbierto()).toBe('true')

    mando.bajar.mockResolvedValue({ ok: true, guardadas: 98956 })
    await confirmar()
    expect(mapeoAbierto()).toBe('false')
  })

  // Al plegarse el paso ① se van con él la línea de estado y los logs. Plegar con una tabla
  // incompleta esconderÍa justo el aviso que hay que leer, y la descarga se leería como terminada:
  // es exactamente el fallo que el aviso de «faltan filas» vino a evitar.
  it('con filas que faltan NO se pliega, para que el aviso siga a la vista', async () => {
    hayRecetas.mockResolvedValueOnce(false).mockResolvedValue(true)
    await montar()

    mando.bajar.mockResolvedValue({ ok: false, guardadas: 2437, incompletas: 1 })
    await confirmar()

    expect(mapeoAbierto()).toBe('true')
    expect(descargaVisible()).not.toBeNull()
  })

  it('si no se pudo ni empezar, no se toca nada', async () => {
    await montar()
    mando.bajar.mockResolvedValue(null)
    await confirmar()

    expect(mapeoAbierto()).toBe('true')
    expect(arbol()).toBeNull()
  })
})
