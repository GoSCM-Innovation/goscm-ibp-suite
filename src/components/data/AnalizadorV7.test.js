// @vitest-environment jsdom
//
// El acordeón de los analizadores: que los pasos APAREZCAN de uno en uno, en orden.
//
// Es la parte de la restauración de la interfaz de v7 que no se puede comprobar de otra forma. Y el
// fallo que evita no es cosmético: si el paso ⑤ existiera desde el principio, se podría ejecutar el
// análisis sin haber confirmado contra qué tablas corre, y el informe saldría —creíble— de las
// entidades que la máquina adivinó.
//
// Se monta con `react-dom` a secas y `createElement`, como el resto de las pruebas de componente.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchExplorerMap = vi.fn()
const saveExplorerMap = vi.fn()
const resetExplorerMap = vi.fn()
vi.mock('../../lib/ibp-explorer.js', () => ({ fetchExplorerMap, saveExplorerMap, resetExplorerMap }))

const tiposDeMaterial = vi.fn()
vi.mock('../../lib/production-analyze.js', () => ({ tiposDeMaterial }))

// La descarga habla con IndexedDB y con SAP: aquí solo interesa que el paso ⑤ la tenga dentro.
vi.mock('./ExplorerExtract.jsx', () => ({
  default: () => createElement('div', { 'data-prueba': 'descarga' }, 'descarga'),
}))

const { default: AnalizadorV7 } = await import('./AnalizadorV7.jsx')

const DESTINO = { connectionId: 'c1', planningArea: 'SAP4', versionId: '' }

/** Una detección donde todo resolvió por campos: el paso ① sale sin nada que revisar. */
const MAPA = {
  prefijo: 'GID',
  entidades: ['GIDPRODUCT', 'GIDPSH'],
  campos: { GIDPRODUCT: ['PRDID', 'PRDDESCR', 'ZGRUPO'], GIDPSH: ['SOURCEID', 'PRDID', 'LOCID'] },
  guardado: { roles: {}, fields: {} },
  detectado: {
    arbol: {
      product: { etiqueta: 'Maestro de productos', entidad: 'GIDPRODUCT', seguro: true, alternativas: [] },
      header: { etiqueta: 'Cabecera de receta', entidad: 'GIDPSH', seguro: true, alternativas: [] },
    },
  },
}

let contenedor
let raiz

async function montar() {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(AnalizadorV7, {
      area: 'SAP4',
      destino: DESTINO,
      grupo: 'arbol',
      queEs: 'la jerarquía',
      correr: async () => ({ ok: true }),
      children: () => createElement('div', { 'data-prueba': 'informe' }, 'informe'),
    }))
  })
}

/** Los títulos de los pasos que hay AHORA en la pantalla, sin la flecha de plegar. */
const pasosVisibles = () => [
  ...contenedor.querySelectorAll('.panel-title, .mattype-panel-title > span:first-child'),
].map((uno) => uno.textContent.replace(/[▼▶]/g, '').trim())

const boton = (texto) => [...contenedor.querySelectorAll('button')]
  .find((uno) => uno.textContent.trim() === texto)

const pulsar = async (elemento) => {
  await act(async () => {
    elemento.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

/** Confirma el paso ① y espera a que aparezca el ②. */
async function confirmarMapeo() {
  await pulsar(boton('Continuar →'))
}

beforeEach(() => {
  localStorage.clear()
  fetchExplorerMap.mockReset().mockResolvedValue(MAPA)
  saveExplorerMap.mockReset().mockResolvedValue({})
  resetExplorerMap.mockReset().mockResolvedValue({})
  tiposDeMaterial.mockReset().mockResolvedValue({
    cuenta: { FERT: 120, ROH: 4000 },
    configuracion: {
      FERT: { excluido: false, categorias: [] },
      ROH: { excluido: false, categorias: [] },
    },
  })
})

afterEach(async () => {
  await act(async () => { raiz?.unmount() })
  contenedor?.remove()
})

describe('los pasos aparecen de uno en uno', () => {
  it('al abrir solo está el ①', async () => {
    await montar()
    const pasos = pasosVisibles()
    expect(pasos).toEqual(['① Mapeo de entidades'])
  })

  it('confirmar ① hace aparecer el ②, y nada más', async () => {
    await montar()
    await confirmarMapeo()

    const pasos = pasosVisibles()
    expect(pasos).toContain('② Excluir tipos de material')
    expect(pasos).not.toContain('③ Categorizar tipos de material')
    expect(pasos).not.toContain('⑤ Ejecutar análisis')
  })

  it('la secuencia completa llega al ⑤, y no antes', async () => {
    await montar()
    await confirmarMapeo()
    await pulsar(boton('Continuar →'))            // ② → ③
    expect(pasosVisibles()).not.toContain('⑤ Ejecutar análisis')

    await pulsar(boton('Continuar →'))            // ③ → ④
    expect(pasosVisibles()).not.toContain('⑤ Ejecutar análisis')

    await pulsar(boton('Continuar a ejecución →')) // ④ → ⑤
    expect(pasosVisibles()).toContain('⑤ Ejecutar análisis')
  })

  it('el paso ⑤ lleva la descarga dentro: analizar es bajar y juzgar', async () => {
    await montar()
    await confirmarMapeo()
    await pulsar(boton('Continuar →'))
    await pulsar(boton('Continuar →'))
    await pulsar(boton('Continuar a ejecución →'))

    expect(contenedor.querySelector('[data-prueba="descarga"]')).not.toBeNull()
    expect(boton('▶ Ejecutar análisis')).toBeTruthy()
  })

  it('un paso que ya apareció no desaparece al volver atrás', async () => {
    // «← Volver» abre el anterior; no deshace el recorrido. Deshacerlo obligaría a repetir todo por
    // haber ido a mirar una cosa.
    await montar()
    await confirmarMapeo()
    await pulsar(boton('Continuar →'))
    await pulsar(boton('← Volver'))

    expect(pasosVisibles()).toContain('③ Categorizar tipos de material')
  })
})

describe('los pasos ② y ③', () => {
  it('el ② lista los tipos del tenant con su número de productos', async () => {
    await montar()
    await confirmarMapeo()

    const filas = [...contenedor.querySelectorAll('.mattype-panel-body tbody tr')]
    expect(filas).toHaveLength(2)
    expect(filas[0].textContent).toContain('FERT')
    expect(filas[0].textContent).toContain('120')
  })

  it('excluir un tipo lo saca del paso ③: no se categoriza lo que no se analiza', async () => {
    await montar()
    await confirmarMapeo()

    const casilla = contenedor.querySelector('[aria-label="Analizar FERT"]')
    await act(async () => {
      casilla.click()
    })

    await pulsar(boton('Continuar →'))
    const enCategorias = [...contenedor.querySelectorAll('.mattype-panel-body tbody tr')]
      .map((uno) => uno.textContent)
    expect(enCategorias.some((uno) => uno.includes('FERT'))).toBe(false)
    expect(enCategorias.some((uno) => uno.includes('ROH'))).toBe(true)
  })

  it('lo excluido queda guardado para el área, y lo ven los dos analizadores', async () => {
    await montar()
    await confirmarMapeo()
    await act(async () => { contenedor.querySelector('[aria-label="Analizar FERT"]').click() })

    expect(JSON.parse(localStorage.getItem('mattype_SAP4')).FERT.excluido).toBe(true)
  })
})

describe('el paso ④', () => {
  it('ofrece los campos REALES de la tabla que resolvió el paso ①', async () => {
    await montar()
    await confirmarMapeo()
    await pulsar(boton('Continuar →'))
    await pulsar(boton('Continuar →'))

    const cuerpo = contenedor.querySelector('.mattype-panel-body')
    expect(cuerpo.textContent).toContain('ZGRUPO')
    expect(cuerpo.textContent).toContain('PRDID')
  })
})
