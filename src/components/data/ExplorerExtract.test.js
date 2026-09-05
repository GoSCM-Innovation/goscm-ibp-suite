// @vitest-environment jsdom
//
// Que la descarga tenga LA FORMA DE v7: una barra, una línea de estado con color, y un botón «Ver
// logs técnicos» que abre el registro de esa descarga. Nada más — y en particular ninguna tabla, que
// es lo que había aquí y v7 nunca tuvo.
//
// La otra mitad de estas pruebas es que quitar la tabla no se llevara por delante lo que sí avisaba.
// Lo que decía —contra qué tabla del tenant resolvió cada papel, cuántas filas descartó SAP y si
// faltan filas— tiene que seguir estando, ahora en el registro.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchExplorerMap = vi.fn()
vi.mock('../../lib/ibp-explorer.js', () => ({
  fetchExplorerMap,
  saveExplorerMap: vi.fn(),
  resetExplorerMap: vi.fn(),
}))

const extraer = vi.fn()
vi.mock('../../lib/explorer-extract.js', () => ({ extraer }))

const contar = vi.fn(async () => 0)
vi.mock('../../lib/explorer-db.js', () => ({ contar }))

const { default: ExplorerExtract } = await import('./ExplorerExtract.jsx')

const DESTINO = { connectionId: 'c1', planningArea: 'SAP4', versionId: '' }

/** Un tenant donde los dos papeles imprescindibles del árbol resolvieron. */
const MAPA = {
  guardado: { roles: {}, fields: {} },
  efectivo: {
    arbol: {
      header: { etiqueta: 'Cabecera de receta', entidad: 'GIDSOURCEPRODUCTION' },
      item: { etiqueta: 'Componentes de la receta', entidad: 'GIDPRODUCTIONSOURCEITM' },
      product: { etiqueta: 'Maestro de productos', entidad: 'GIDPRODUCT' },
    },
  },
}

/** Lo que devuelve una descarga que salió bien. */
const salidaLimpia = {
  seVacio: false,
  guardadas: 98956,
  descartadas: 0,
  conError: 0,
  incompletas: 0,
  ok: true,
  hechos: [
    { tabla: 'bom_psh', guardadas: 2437, bajadas: 2437, faltan: 0 },
    { tabla: 'bom_psi', guardadas: 37855, bajadas: 37855, faltan: 0 },
    { tabla: 'bom_prd', guardadas: 15914, bajadas: 15914, faltan: 0 },
  ],
}

let contenedor
let raiz
let mando

async function montar() {
  mando = { current: null }
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(ExplorerExtract, {
      ref: mando, destino: DESTINO, gruposFijos: ['arbol'],
    }))
  })
}

const bajar = async () => {
  let salida
  await act(async () => { salida = await mando.current.bajar() })
  return salida
}

const barra = () => contenedor.querySelector('.progress-bar .fill')
const estado = () => contenedor.querySelector('.prog-estado span')?.textContent
const botonDeLogs = () => [...contenedor.querySelectorAll('button')]
  .find((uno) => /logs/i.test(uno.textContent))
const registro = () => [...contenedor.querySelectorAll('.log-area > div')]
  .map((uno) => ({ clase: uno.className, texto: uno.textContent }))

const abrirLogs = async () => {
  await act(async () => {
    botonDeLogs().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchExplorerMap.mockResolvedValue(MAPA)
  contar.mockResolvedValue(0)
})

afterEach(async () => {
  await act(async () => { raiz?.unmount() })
  contenedor?.remove()
})

describe('antes de disparar', () => {
  // En v7 la barra, la línea de estado y los logs estaban ocultos hasta que `doFetchAll` los
  // mostraba. El paso ① no anunciaba la descarga: solo tenía el botón.
  it('no dibuja nada', async () => {
    await montar()
    expect(contenedor.textContent).toBe('')
  })
})

describe('la forma de v7', () => {
  it('son tres cosas: barra, línea de estado y logs técnicos', async () => {
    await montar()
    extraer.mockResolvedValue(salidaLimpia)
    await bajar()

    expect(barra()).not.toBeNull()
    expect(estado()).toBe('98.956 filas guardadas.')
    expect(botonDeLogs().textContent).toBe('Ver logs técnicos')
  })

  it('no hay ninguna tabla: eso no era de v7', async () => {
    await montar()
    extraer.mockResolvedValue(salidaLimpia)
    await bajar()
    expect(contenedor.querySelector('table')).toBeNull()
  })

  it('el registro está cerrado hasta que se pide, y el botón cambia de texto', async () => {
    await montar()
    extraer.mockResolvedValue(salidaLimpia)
    await bajar()

    expect(contenedor.querySelector('.log-area')).toBeNull()
    await abrirLogs()
    expect(contenedor.querySelector('.log-area')).not.toBeNull()
    expect(botonDeLogs().textContent).toBe('Ocultar logs')
  })

  it('la barra se llena al terminar', async () => {
    await montar()
    extraer.mockResolvedValue(salidaLimpia)
    await bajar()
    expect(barra().style.width).toBe('100%')
  })
})

describe('el registro dice lo que decía la tabla', () => {
  it('contra qué tabla del tenant se pidió cada papel', async () => {
    await montar()
    extraer.mockResolvedValue(salidaLimpia)
    await bajar()
    await abrirLogs()

    const texto = registro().map((una) => una.texto).join('\n')
    expect(texto).toContain('GET → GIDSOURCEPRODUCTION [filtro PA/Ver]')
    expect(texto).toContain('GET → GIDPRODUCT [filtro PA/Ver]')
    expect(texto).toContain('Header: 2437 registros → IDB')
    expect(texto).toContain('Product: 15.914 registros → IDB')
  })

  it('los papeles que este tenant no cubre', async () => {
    await montar()
    extraer.mockResolvedValue(salidaLimpia)
    await bajar()
    await abrirLogs()

    // `bom_psi_validity` no está en el mapa de arriba: v7 escribía justo esta línea.
    expect(registro().map((una) => una.texto).join('\n'))
      .toContain('Item Validity: sin entidad configurada')
  })

  // El aviso que más importa de todos, y el único que invalida lo que se analice después. Sale en
  // rojo, la línea de estado no lo presenta como terminado, y el registro se abre solo.
  it('que a una tabla le falten filas, en rojo y con los logs ya abiertos', async () => {
    await montar()
    extraer.mockResolvedValue({
      ...salidaLimpia,
      ok: false,
      incompletas: 1,
      hechos: [
        { tabla: 'bom_psh', guardadas: 2437, bajadas: 2437, enSap: 30000, faltan: 27563 },
      ],
    })
    await bajar()

    expect(estado()).toContain('no conviene analizar')
    // Sin tocar el botón: si hay que mirarlo, que no haya que buscarlo.
    expect(contenedor.querySelector('.log-area')).not.toBeNull()

    const suya = registro().find((una) => una.texto.includes('incompleta'))
    expect(suya.clase).toBe('err')
    expect(suya.texto).toContain('SAP dice 30.000 filas y llegaron 2437')
  })

  it('las filas que SAP marca como inválidas', async () => {
    await montar()
    extraer.mockResolvedValue({
      ...salidaLimpia,
      hechos: [{ tabla: 'bom_psh', guardadas: 2437, bajadas: 2500, faltan: 0 }],
    })
    await bajar()
    await abrirLogs()

    expect(registro().map((una) => una.texto).join('\n'))
      .toContain('2437 registros → IDB (63 descartadas: SAP las marca inválidas)')
  })
})

describe('cuando no se puede bajar', () => {
  // Enterarse a los seis minutos de que falta la tabla principal, después de bajar tres que no
  // sirven sin ella, es la diferencia entre una herramienta y un castigo. Se dice ANTES.
  it('falta una tabla imprescindible: no se pide nada a SAP', async () => {
    fetchExplorerMap.mockResolvedValue({ guardado: { roles: {}, fields: {} }, efectivo: { arbol: {} } })
    await montar()
    const salida = await bajar()

    expect(salida).toBeNull()
    expect(extraer).not.toHaveBeenCalled()
    expect(estado()).toContain('Falta alguna tabla imprescindible')
    expect(contenedor.querySelector('.log-area')).not.toBeNull()
  })

  it('el catálogo del tenant no responde', async () => {
    fetchExplorerMap.mockRejectedValue(new Error('HTTP 503'))
    await montar()
    const salida = await bajar()

    expect(salida).toBeNull()
    expect(estado()).toBe('Error: HTTP 503')
  })
})

describe('bajarSiVacio', () => {
  // v7 bajaba siempre porque no guardaba nada entre sesiones. Aquí sí, y rebajar tres millones de
  // filas por volver a pulsar sería un castigo.
  it('con datos guardados no vuelve a bajar', async () => {
    contar.mockResolvedValue(500)
    await montar()

    let salida
    await act(async () => { salida = await mando.current.bajarSiVacio() })
    expect(salida).toBe(true)
    expect(extraer).not.toHaveBeenCalled()
  })

  it('con la base vacía baja, como v7', async () => {
    contar.mockResolvedValue(0)
    extraer.mockResolvedValue(salidaLimpia)
    await montar()

    let salida
    await act(async () => { salida = await mando.current.bajarSiVacio() })
    expect(salida).toBe(true)
    expect(extraer).toHaveBeenCalledTimes(1)
  })

  // El analizador tiene que poder distinguir «ya estaba» de «no se pudo»: juzgar sin datos daría un
  // informe creíble y falso.
  it('dice que no se puede seguir cuando la descarga no arrancó', async () => {
    fetchExplorerMap.mockResolvedValue({ guardado: { roles: {}, fields: {} }, efectivo: { arbol: {} } })
    contar.mockResolvedValue(0)
    await montar()

    let salida
    await act(async () => { salida = await mando.current.bajarSiVacio() })
    expect(salida).toBe(false)
  })
})
