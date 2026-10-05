// @vitest-environment jsdom
//
// La vista web de resultados (`snWebView.js` de v7): tarjetas, pestañas, chips, búsqueda, paginación,
// columnas redimensionables, popup de celda, pantalla completa y minimizar. Se monta con `react-dom` a
// secas y `createElement`, como el resto de las pruebas de componente.
//
// jsdom no hace layout: `scrollWidth` y `clientWidth` valen 0 siempre. Para ver el recorte de celdas
// se los sustituye por una regla simple (texto largo = recortado), y se quita al terminar.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import VistaWebAnalisis from './VistaWebAnalisis.jsx'

const LARGO = 'texto muy largo '.repeat(10).trim()

/** 120 filas: repartidas por igual entre alerta, advertencia y OK (40 de cada una). */
function datosDePrueba() {
  const sev = ['red', 'yel', 'ok']
  const filas = Array.from({ length: 120 }, (_, i) => ({
    s: sev[i % 3],
    c: ['', `P${i}`, i === 5 ? LARGO : `Obs ${i}`, i === 1 ? '—' : i],
  }))
  return {
    titulo: 'Production Analyzer — vista web',
    generadoEl: '30-09-2026 10:15',
    orden: ['Producto', 'Excluidos'],
    hojas: {
      Producto: {
        nombre: 'Producto',
        encabezados: ['Estado', 'Producto', 'Observación', 'Valor'],
        filas,
        total: 120, red: 40, yel: 40, ok: 40,
        conEstado: true,
      },
      // Una hoja SIN columna Estado: la columna 0 trae un dato de verdad y no se debe pisar.
      Excluidos: {
        nombre: 'Excluidos',
        encabezados: ['Tipo', 'Motivo'],
        filas: [
          { s: 'yel', c: ['ZRAW', 'Material crudo'] },
          { s: 'ok', c: ['ZPACK', 'Embalaje'] },
          { s: 'ok', c: ['ZSERV', 'Servicio'] },
        ],
        total: 3, red: 0, yel: 1, ok: 2,
        conEstado: false,
      },
    },
    resumen: [
      { nombre: 'Producto', total: 120, red: 40, yel: 40, ok: 40 },
      { nombre: 'Excluidos', total: 1234, red: 0, yel: 1, ok: 2 },
    ],
    estadisticas: [
      ['Resumen general'],
      ['Indicador', 'Valor'],
      ['Recetas', 120],
      ['Componentes', null],
      [],
      ['Por severidad'],
      ['Severidad', 'Filas'],
      ['Alertas', 40],
      [''],
    ],
    nombreEstadisticas: 'Estadísticas',
  }
}

let raiz
let contenedor

async function montar(props = {}) {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(VistaWebAnalisis, { datos: datosDePrueba(), ...props }))
  })
}

const q = (sel) => document.querySelector(sel)
const qa = (sel) => [...document.querySelectorAll(sel)]
const texto = (sel) => q(sel)?.textContent.trim()
const filas = () => qa('table.snwv-dtable tbody tr')
const columna = (n) => filas().map((tr) => tr.children[n].textContent)
const conteo = () => texto('.snwv-foot .snwv-count')
const pagina = () => texto('.snwv-pager .snwv-count')

async function clic(el) {
  await act(async () => { el.click() })
}
const botonPorTexto = (t) => qa('button').find((b) => b.textContent.trim() === t)
const chip = (k) => q(`.snwv-chip[data-sev="${k}"]`)
const pestana = (nombre) => q(`.snwv-tab[data-sheet="${nombre}"]`)

async function escribir(valor) {
  const input = q('.snwv-search')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, valor)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function esperar(ms) {
  await act(async () => { vi.advanceTimersByTime(ms) })
}
async function escape() {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
}

beforeEach(() => {
  // Una celda de más de 20 caracteres «no cabe» (clientWidth 100 < scrollWidth 300).
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get() { return (this.textContent || '').length > 20 ? 300 : 10 },
  })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 100 } })
})

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await act(async () => { raiz?.unmount() })
  contenedor?.remove()
  raiz = null
  delete HTMLElement.prototype.scrollWidth
  delete HTMLElement.prototype.clientWidth
  document.body.style.overflow = ''
  document.body.innerHTML = ''
})

describe('la cabecera, las tarjetas y las pestañas', () => {
  it('muestra el título, el subtítulo con la fecha y los botones', async () => {
    await montar()
    expect(texto('.snwv-title')).toBe('🌐 Production Analyzer — vista web')
    expect(texto('.snwv-sub')).toBe('Mismo análisis que el Excel, explorable en pantalla · 30-09-2026 10:15')
    expect(botonPorTexto('⛶ Pantalla completa')).toBeTruthy()
    expect(botonPorTexto('Cerrar')).toBeTruthy()
  })

  it('las tarjetas traen nombre, total con formato es-CL y los tres conteos', async () => {
    await montar()
    const tarjetas = qa('.snwv-card')
    expect(tarjetas).toHaveLength(2)
    expect(tarjetas[0].querySelector('.snwv-card-name').textContent).toBe('Producto')
    expect(tarjetas[0].querySelector('.snwv-card-total').textContent).toBe('120')
    expect(tarjetas[0].querySelector('.snwv-card-sev').textContent).toBe('⛔ 40⚠ 40✅ 40')
    expect(tarjetas[1].querySelector('.snwv-card-total').textContent).toBe('1.234')
    expect(tarjetas[0].classList.contains('active')).toBe(true)
    expect(tarjetas[1].classList.contains('active')).toBe(false)
  })

  it('las pestañas llevan «nombre (total)» y la de Estadísticas al final', async () => {
    await montar()
    expect(qa('.snwv-tab').map((t) => t.textContent)).toEqual([
      'Producto (120)', 'Excluidos (3)', '📈 Estadísticas',
    ])
    expect(pestana('Producto').classList.contains('active')).toBe(true)
  })

  it('sin estadísticas no hay pestaña de Estadísticas', async () => {
    const datos = datosDePrueba()
    datos.estadisticas = []
    await montar({ datos })
    expect(qa('.snwv-tab')).toHaveLength(2)
  })

  it('sin resumen, las tarjetas salen de las hojas', async () => {
    const datos = datosDePrueba()
    datos.resumen = []
    await montar({ datos })
    expect(qa('.snwv-card-name').map((n) => n.textContent)).toEqual(['Producto', 'Excluidos'])
    expect(qa('.snwv-card-total').map((n) => n.textContent)).toEqual(['120', '3'])
  })

  it('el clic en una tarjeta abre esa hoja y la marca activa', async () => {
    await montar()
    await clic(q('.snwv-card[data-sheet="Excluidos"]'))
    expect(pestana('Excluidos').classList.contains('active')).toBe(true)
    expect(q('.snwv-card[data-sheet="Excluidos"]').classList.contains('active')).toBe(true)
    expect(q('.snwv-card[data-sheet="Producto"]').classList.contains('active')).toBe(false)
  })

  it('sin datos dice que no hay nada que mostrar', async () => {
    await montar({ datos: { titulo: 'x', orden: [], hojas: {} } })
    expect(texto('.snwv-empty')).toBe('No hay datos para mostrar en la vista web.')
  })
})

describe('los chips de severidad', () => {
  it('llevan los conteos y «Todos» arranca activo', async () => {
    await montar()
    expect(qa('.snwv-chip').map((c) => c.textContent)).toEqual([
      'Todos (120)', '⛔ Alertas (40)', '⚠ Advertencias (40)', '✅ OK (40)',
    ])
    expect(chip('all').classList.contains('active')).toBe(true)
  })

  it('filtrar por alertas deja solo esas filas y dice «filtrado de»', async () => {
    await montar()
    expect(conteo()).toBe('Mostrando 1–50 de 120')
    await clic(chip('red'))
    expect(chip('red').classList.contains('active')).toBe(true)
    expect(chip('all').classList.contains('active')).toBe(false)
    expect(conteo()).toBe('Mostrando 1–40 de 40 (filtrado de 120)')
    expect(filas().every((tr) => tr.classList.contains('snwv-red'))).toBe(true)
    expect(filas()).toHaveLength(40)
  })

  it('volver a «Todos» quita el «filtrado de»', async () => {
    await montar()
    await clic(chip('yel'))
    await clic(chip('all'))
    expect(conteo()).toBe('Mostrando 1–50 de 120')
  })

  it('la columna 0 de una hoja con estado se compone desde la severidad', async () => {
    await montar()
    expect(columna(0).slice(0, 3)).toEqual(['⛔ Alerta', '⚠ Advertencia', '✅ OK'])
    expect(filas()[0].children[0].className).toBe('snwv-sevcell snwv-red')
  })

  it('una hoja sin «conEstado» no pisa la columna 0', async () => {
    await montar()
    await clic(pestana('Excluidos'))
    expect(columna(0)).toEqual(['ZRAW', 'ZPACK', 'ZSERV'])
    expect(q('.snwv-sevcell')).toBeNull()
    // La severidad sigue viéndose por el color de la fila.
    expect(filas().map((tr) => tr.className)).toEqual(['snwv-yel', 'snwv-ok', 'snwv-ok'])
  })
})

describe('la búsqueda', () => {
  beforeEach(() => { vi.useFakeTimers() })

  it('espera 220 ms antes de filtrar y no distingue mayúsculas', async () => {
    await montar()
    expect(q('.snwv-search').placeholder).toBe('Buscar en Producto...')
    await escribir('p11')
    await esperar(219)
    expect(conteo()).toBe('Mostrando 1–50 de 120')
    await esperar(1)
    // P11 y P110 … P119.
    expect(conteo()).toBe('Mostrando 1–11 de 11 (filtrado de 120)')
    expect(columna(1)).toContain('P11')
  })

  it('busca por subcadena en cualquier columna de la 1 en adelante', async () => {
    await montar()
    await escribir('Obs 7')
    await esperar(220)
    // «Obs 7», «Obs 70» … «Obs 79».
    expect(conteo()).toBe('Mostrando 1–11 de 11 (filtrado de 120)')
  })

  // En v7 las celdas de la vista eran texto, así que «0» se podía buscar. Aquí pueden ser números
  // (el Excel los necesita así) y un 0 tiene que seguir encontrándose.
  it('un cero numérico se puede buscar', async () => {
    const datos = datosDePrueba()
    datos.hojas.Producto.filas = [
      { s: 'ok', c: ['', 'AAA', 'sin dígitos', 0] },
      { s: 'ok', c: ['', 'BBB', 'sin dígitos', 7] },
      { s: 'ok', c: ['', 'CCC', 'sin dígitos', null] },
    ]
    datos.hojas.Producto.total = 3
    await montar({ datos })
    await escribir('0')
    await esperar(220)
    expect(columna(1)).toEqual(['AAA'])
  })

  it('ignora la columna 0: buscar «Alerta» no encuentra nada', async () => {
    await montar()
    await escribir('Alerta')
    await esperar(220)
    expect(filas()).toHaveLength(0)
    expect(texto('.snwv-empty')).toBe('Sin filas que coincidan con el filtro.')
    expect(conteo()).toBe('Mostrando 0–0 de 0 (filtrado de 120)')
  })

  it('se combina con el chip de severidad', async () => {
    await montar()
    await clic(chip('red'))
    await escribir('P3')
    await esperar(220)
    // Alertas son las filas 0, 3, 6 …; con «P3»: P3, P30, P33, P36, P39 y P3x múltiplos de 3.
    const esperadas = Array.from({ length: 120 }, (_, i) => i)
      .filter((i) => i % 3 === 0 && `P${i}`.includes('P3')).length
    expect(conteo()).toBe(`Mostrando 1–${esperadas} de ${esperadas} (filtrado de 120)`)
  })

  it('escribir vuelve a la página 1', async () => {
    await montar()
    await clic(botonPorTexto('Siguiente ›'))
    expect(pagina()).toBe('Página 2 / 3')
    await escribir('Obs')
    await esperar(220)
    expect(pagina()).toBe('Página 1 / 3')
  })
})

describe('la paginación', () => {
  it('dibuja solo 50 filas y dice «Mostrando a–b de n»', async () => {
    await montar()
    expect(filas()).toHaveLength(50)
    expect(conteo()).toBe('Mostrando 1–50 de 120')
    expect(pagina()).toBe('Página 1 / 3')
    expect(botonPorTexto('‹ Anterior').disabled).toBe(true)
    expect(botonPorTexto('Siguiente ›').disabled).toBe(false)
  })

  it('avanza y retrocede, y la última página trae el resto', async () => {
    await montar()
    await clic(botonPorTexto('Siguiente ›'))
    expect(conteo()).toBe('Mostrando 51–100 de 120')
    expect(columna(1)[0]).toBe('P50')
    await clic(botonPorTexto('Siguiente ›'))
    expect(conteo()).toBe('Mostrando 101–120 de 120')
    expect(filas()).toHaveLength(20)
    expect(pagina()).toBe('Página 3 / 3')
    expect(botonPorTexto('Siguiente ›').disabled).toBe(true)
    await clic(botonPorTexto('‹ Anterior'))
    expect(pagina()).toBe('Página 2 / 3')
  })

  it('al filtrar desde la página 3 vuelve a la 1', async () => {
    await montar()
    await clic(botonPorTexto('Siguiente ›'))
    await clic(botonPorTexto('Siguiente ›'))
    await clic(chip('ok'))
    expect(pagina()).toBe('Página 1 / 1')
    expect(conteo()).toBe('Mostrando 1–40 de 40 (filtrado de 120)')
  })

  it('cambiar de hoja reinicia filtro, búsqueda y página', async () => {
    await montar()
    await clic(chip('red'))
    await clic(botonPorTexto('Siguiente ›'))
    await clic(pestana('Excluidos'))
    expect(chip('all').classList.contains('active')).toBe(true)
    expect(q('.snwv-search').value).toBe('')
    expect(q('.snwv-search').placeholder).toBe('Buscar en Excluidos...')
    expect(conteo()).toBe('Mostrando 1–3 de 3')
    await clic(pestana('Producto'))
    expect(chip('all').classList.contains('active')).toBe(true)
    expect(pagina()).toBe('Página 1 / 3')
    expect(conteo()).toBe('Mostrando 1–50 de 120')
  })
})

describe('la tabla', () => {
  it('es de ancho fijo con <colgroup> y los anchos de partida de v7', async () => {
    await montar()
    const anchos = qa('table.snwv-dtable col').map((c) => c.style.width)
    expect(anchos).toEqual(['90px', '300px', '150px', '150px'])
    expect(q('table.snwv-dtable').style.width).toBe('690px')
    expect(qa('table.snwv-dtable th').map((th) => th.title)).toEqual(['Estado', 'Producto', 'Observación', 'Valor'])
  })

  it('el valor «—» lleva snwv-na y cada celda su título con el valor completo', async () => {
    await montar()
    const celda = filas()[1].children[3]
    expect(celda.className).toContain('snwv-na')
    expect(celda.textContent).toBe('—')
    expect(filas()[0].children[2].title).toBe('Obs 0')
    // Un número se muestra como texto; el 0 también.
    expect(filas()[0].children[3].textContent).toBe('0')
  })

  it('arrastrar el borde de la cabecera cambia el ancho, con mínimo de 40 px, y persiste al paginar', async () => {
    await montar()
    const borde = q('.snwv-resizer[data-ci="2"]')
    await act(async () => {
      borde.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100 }))
    })
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 160 }))
    })
    expect(qa('table.snwv-dtable col')[2].style.width).toBe('210px')
    expect(q('table.snwv-dtable').style.width).toBe('750px')

    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: -500 }))
    })
    expect(qa('table.snwv-dtable col')[2].style.width).toBe('40px')

    await act(async () => { document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })) })
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 900 }))
    })
    expect(qa('table.snwv-dtable col')[2].style.width).toBe('40px') // soltó: ya no sigue al ratón

    await clic(botonPorTexto('Siguiente ›'))
    expect(qa('table.snwv-dtable col')[2].style.width).toBe('40px')
  })
})

describe('el popup de una celda recortada', () => {
  it('solo las celdas que no caben llevan snwv-clip', async () => {
    await montar()
    const recortadas = qa('td.snwv-clip')
    expect(recortadas).toHaveLength(1)
    expect(recortadas[0].textContent).toBe(LARGO)
  })

  it('el clic abre el popup con la cabecera y el texto completo', async () => {
    await montar()
    await clic(q('td.snwv-clip'))
    const popup = q('.snwv-cellpop')
    expect(popup.querySelector('.snwv-cellpop-h').textContent).toBe('Observación')
    expect(popup.querySelector('.snwv-cellpop-body').textContent).toBe(LARGO)
  })

  it('una celda que cabe no abre nada', async () => {
    await montar()
    await clic(filas()[0].children[1])
    expect(q('.snwv-cellpop')).toBeNull()
  })

  it('«Copiar» copia el texto y cambia a «Copiado ✓»', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await montar()
    await clic(q('td.snwv-clip'))
    await clic(q('[data-cp="copy"]'))
    expect(writeText).toHaveBeenCalledWith(LARGO)
    expect(q('[data-cp="copy"]').textContent).toBe('Copiado ✓')
    delete navigator.clipboard
  })

  it('«Cerrar», Escape y el clic en el fondo lo cierran', async () => {
    await montar()
    await clic(q('td.snwv-clip'))
    await clic(q('[data-cp="close"]'))
    expect(q('.snwv-cellpop')).toBeNull()

    await clic(q('td.snwv-clip'))
    await escape()
    expect(q('.snwv-cellpop')).toBeNull()

    await clic(q('td.snwv-clip'))
    await clic(q('.snwv-cellpop'))
    expect(q('.snwv-cellpop')).toBeNull()

    // El clic dentro del cuadro no lo cierra.
    await clic(q('td.snwv-clip'))
    await clic(q('.snwv-cellpop-body'))
    expect(q('.snwv-cellpop')).not.toBeNull()
  })
})

describe('el botón de Excel', () => {
  it('«Descargar Excel» pasa a «Generando...» y termina en «✅ Excel descargado»', async () => {
    let terminar
    const descargarExcel = vi.fn(() => new Promise((resolver) => { terminar = resolver }))
    await montar({ descargarExcel })
    const boton = q('.snwv-btn-primary')
    expect(boton.textContent).toBe('⬇️ Descargar Excel')

    await clic(boton)
    expect(descargarExcel).toHaveBeenCalledTimes(1)
    expect(boton.textContent).toBe('Generando...')
    expect(boton.disabled).toBe(true)

    await act(async () => { terminar() })
    expect(boton.textContent).toBe('✅ Excel descargado')
    expect(boton.disabled).toBe(true)
  })

  it('si falla, restaura el botón y avisa con el mensaje', async () => {
    const alerta = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const descargarExcel = vi.fn(async () => { throw new Error('sin memoria') })
    await montar({ descargarExcel })
    const boton = q('.snwv-btn-primary')
    await clic(boton)
    expect(alerta).toHaveBeenCalledWith('No se pudo generar el Excel: sin memoria')
    expect(boton.textContent).toBe('⬇️ Descargar Excel')
    expect(boton.disabled).toBe(false)
  })

  it('sin función y con «excelDescargado» muestra la nota en su lugar', async () => {
    await montar({ descargarExcel: null, excelDescargado: true })
    expect(texto('.snwv-dlnote')).toBe('✅ Excel descargado')
    expect(q('.snwv-btn-primary')).toBeNull()
  })

  it('sin función y sin «excelDescargado» no muestra nada', async () => {
    await montar({ descargarExcel: null, excelDescargado: false })
    expect(q('.snwv-dlnote')).toBeNull()
    expect(q('.snwv-btn-primary')).toBeNull()
  })
})

describe('la pantalla completa', () => {
  it('alterna la clase, el texto, aria-pressed y el desplazamiento del fondo', async () => {
    await montar()
    const boton = q('[data-accion="pantalla-completa"]')
    expect(boton.getAttribute('aria-pressed')).toBe('false')
    await clic(boton)
    expect(q('.snwv-wrap').classList.contains('snwv-fs')).toBe(true)
    expect(boton.getAttribute('aria-pressed')).toBe('true')
    expect(boton.textContent).toBe('⛶ Salir de pantalla completa')
    expect(document.body.style.overflow).toBe('hidden')

    await clic(boton)
    expect(q('.snwv-wrap').classList.contains('snwv-fs')).toBe(false)
    expect(boton.textContent).toBe('⛶ Pantalla completa')
    expect(document.body.style.overflow).toBe('')
  })

  it('Escape sale de pantalla completa', async () => {
    await montar()
    await clic(q('[data-accion="pantalla-completa"]'))
    await escape()
    expect(q('.snwv-wrap').classList.contains('snwv-fs')).toBe(false)
    expect(document.body.style.overflow).toBe('')
  })

  it('con un popup abierto, el primer Escape cierra el popup y no sale de pantalla completa', async () => {
    await montar()
    await clic(q('[data-accion="pantalla-completa"]'))
    await clic(q('td.snwv-clip'))
    await escape()
    expect(q('.snwv-cellpop')).toBeNull()
    expect(q('.snwv-wrap').classList.contains('snwv-fs')).toBe(true)
    await escape()
    expect(q('.snwv-wrap').classList.contains('snwv-fs')).toBe(false)
  })

  it('al desmontar con la pantalla completa activa devuelve el desplazamiento del fondo', async () => {
    await montar()
    await clic(q('[data-accion="pantalla-completa"]'))
    expect(document.body.style.overflow).toBe('hidden')
    await act(async () => { raiz.unmount() })
    raiz = null
    expect(document.body.style.overflow).toBe('')
  })
})

describe('minimizar y reabrir', () => {
  it('«Cerrar» deja una barra con «Ver resultados» y esta reabre conservando el estado', async () => {
    vi.useFakeTimers()
    await montar()
    await clic(pestana('Producto'))
    await clic(chip('red'))
    await escribir('P')
    await esperar(220)
    await clic(botonPorTexto('Siguiente ›')) // 40 alertas caben en una sola página
    expect(conteo()).toBe('Mostrando 1–40 de 40 (filtrado de 120)')

    await clic(botonPorTexto('Cerrar'))
    expect(q('.snwv-title')).toBeNull()
    expect(q('.snwv-cards')).toBeNull()
    expect(texto('.snwv-collapsed-txt')).toBe('🌐 Production Analyzer — vista web — análisis disponible')

    await clic(botonPorTexto('Ver resultados'))
    expect(q('.snwv-cards')).not.toBeNull()
    expect(chip('red').classList.contains('active')).toBe(true)
    expect(q('.snwv-search').value).toBe('P')
    expect(conteo()).toBe('Mostrando 1–40 de 40 (filtrado de 120)')
  })

  it('conserva la hoja y la página al reabrir', async () => {
    await montar()
    await clic(botonPorTexto('Siguiente ›'))
    await clic(botonPorTexto('Cerrar'))
    await clic(botonPorTexto('Ver resultados'))
    expect(pagina()).toBe('Página 2 / 3')
    expect(pestana('Producto').classList.contains('active')).toBe(true)
  })

  it('minimizar sale de la pantalla completa', async () => {
    await montar()
    await clic(q('[data-accion="pantalla-completa"]'))
    await clic(botonPorTexto('Cerrar'))
    expect(document.body.style.overflow).toBe('')
    await clic(botonPorTexto('Ver resultados'))
    expect(q('.snwv-wrap').classList.contains('snwv-fs')).toBe(false)
  })
})

describe('la hoja Estadísticas', () => {
  it('muestra los títulos y arma una tabla por bloque contiguo, con la primera fila de cabecera', async () => {
    await montar()
    await clic(pestana('__stats__'))
    expect(pestana('__stats__').classList.contains('active')).toBe(true)
    expect(qa('.snwv-st-h').map((h) => h.textContent)).toEqual(['Resumen general', 'Por severidad'])

    const tablas = qa('.snwv-statsbox table.snwv-table')
    expect(tablas).toHaveLength(2)
    expect([...tablas[0].querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Indicador', 'Valor'])
    expect([...tablas[0].querySelectorAll('tbody tr')].map((tr) => tr.textContent)).toEqual(['Recetas120', 'Componentes'])
    expect([...tablas[1].querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Severidad', 'Filas'])
    // No hay chips ni buscador en esta vista.
    expect(q('.snwv-toolbar')).toBeNull()
  })

  it('una fila de un solo elemento en blanco no dibuja título', async () => {
    await montar()
    await clic(pestana('__stats__'))
    expect(qa('.snwv-st-h').every((h) => h.textContent.trim() !== '')).toBe(true)
  })

  it('volver a una hoja de datos la dibuja de nuevo', async () => {
    await montar()
    await clic(pestana('__stats__'))
    await clic(pestana('Producto'))
    expect(filas()).toHaveLength(50)
  })
})

describe('una hoja grande paginada desde la base local (`origen`)', () => {
  /** 230 filas guardadas "en disco": la vista solo ve las que le pasa `pagina` o `buscar`. */
  function hojaGrande({ falla = false, truncada = false } = {}) {
    const sev = ['red', 'yel', 'ok', 'ok']
    const disco = Array.from({ length: 230 }, (_, i) => ({ s: sev[i % 4], c: ['', `PRD${i}`, `arco ${i}`] }))
    const llamadas = { pagina: [], buscar: [] }
    const origen = {
      pagina: (sv, desde, cuantos) => {
        llamadas.pagina.push([sv, desde, cuantos])
        if (falla) return Promise.reject(new Error('sin disco'))
        const fuente = sv === 'all' ? disco : disco.filter((f) => f.s === sv)
        return Promise.resolve(fuente.slice(desde, desde + cuantos))
      },
      buscar: (sv, prueba, maximo, escanear) => {
        llamadas.buscar.push([sv, maximo, escanear])
        const fuente = sv === 'all' ? disco : disco.filter((f) => f.s === sv)
        return Promise.resolve({ filas: fuente.filter(prueba).slice(0, maximo), truncada })
      },
    }
    return {
      llamadas,
      hoja: {
        nombre: 'Location Source',
        encabezados: ['Estado', 'PRDID', 'Observación'],
        // El respaldo en memoria: las primeras 10 filas.
        filas: disco.slice(0, 10),
        total: 230, red: 58, yel: 58, ok: 114,
        conEstado: true,
        capada: true,
        origen,
      },
    }
  }

  const datosGrandes = (hoja) => ({
    titulo: 'Supply Network Analyzer — vista web',
    orden: ['Location Source'],
    hojas: { 'Location Source': hoja },
    resumen: [{ nombre: 'Location Source', total: 230, red: 58, yel: 58, ok: 114 }],
    estadisticas: [],
  })

  const montarGrande = async (opciones) => {
    const { hoja, llamadas } = hojaGrande(opciones)
    await montar({ datos: datosGrandes(hoja) })
    return llamadas
  }

  it('pide a la base solo la página que se ve y cuenta con los totales de la hoja', async () => {
    const llamadas = await montarGrande()
    expect(llamadas.pagina).toEqual([['all', 0, 50]])
    expect(filas()).toHaveLength(50)
    expect(conteo()).toBe('Mostrando 1–50 de 230')
    expect(pagina()).toBe('Página 1 / 5')
    expect(texto('.snwv-note')).toBe('Navegando el 100% de las filas desde el almacenamiento local del navegador.')
  })

  it('paginar pide el tramo siguiente, no recorre lo anterior', async () => {
    const llamadas = await montarGrande()
    await clic(q('[data-pag="siguiente"]'))
    expect(llamadas.pagina.at(-1)).toEqual(['all', 50, 50])
    expect(columna(1)[0]).toBe('PRD50')
    await clic(q('[data-pag="siguiente"]'))
    await clic(q('[data-pag="siguiente"]'))
    await clic(q('[data-pag="siguiente"]'))
    expect(columna(1)).toHaveLength(30) // 230 - 200
    expect(pagina()).toBe('Página 5 / 5')
  })

  it('un chip de severidad filtra en la base con el contador de esa severidad', async () => {
    const llamadas = await montarGrande()
    await clic(chip('red'))
    expect(llamadas.pagina.at(-1)).toEqual(['red', 0, 50])
    expect(conteo()).toBe('Mostrando 1–50 de 58 (filtrado de 230)')
    expect(columna(0).every((c) => c === '⛔ Alerta')).toBe(true)
  })

  describe('con búsqueda', () => {
    beforeEach(() => { vi.useFakeTimers() })

    it('busca por cursor con los topes de v7 y pagina el resultado sin volver a buscar', async () => {
      const llamadas = await montarGrande()
      await escribir('arco 1')
      await esperar(300)
      expect(llamadas.buscar).toEqual([['all', 2000, 300000]])
      // arco 1, arco 10-19, arco 100-199: 1 + 10 + 100 = 111 coincidencias.
      expect(conteo()).toBe('Mostrando 1–50 de 111 (filtrado de 230)')
      await clic(q('[data-pag="siguiente"]'))
      expect(llamadas.buscar).toHaveLength(1)
      expect(columna(2)[0]).toBe('arco 139') // la coincidencia 51: 1, 10 a 19 y desde 100
    })

    it('si la búsqueda se cortó por el tope, lo dice', async () => {
      await montarGrande({ truncada: true })
      await escribir('arco')
      await esperar(300)
      expect(texto('.snwv-cap')).toBe('⚠ Búsqueda limitada a las primeras 230 coincidencias. Afina el filtro o descarga el Excel.')
    })

    it('mientras busca dice «Buscando...»', async () => {
      const { hoja } = hojaGrande()
      let terminar
      hoja.origen.buscar = () => new Promise((resolver) => { terminar = () => resolver({ filas: [], truncada: false }) })
      await montar({ datos: datosGrandes(hoja) })
      await escribir('zzz')
      await esperar(300)
      expect(texto('.snwv-empty')).toBe('Buscando...')
      await act(async () => { terminar() })
      expect(texto('.snwv-empty')).toBe('Sin filas que coincidan con el filtro.')
    })
  })

  it('si la base falla cae al respaldo en memoria y lo dice', async () => {
    await montarGrande({ falla: true })
    expect(filas()).toHaveLength(10)
    expect(texto('.snwv-cap')).toBe('⚠ No se pudo leer el detalle completo. Vista limitada a 10 filas (de 230). Descarga el Excel para el detalle completo.')
    expect(q('.snwv-note')).toBeNull()
  })

  it('una hoja capada SIN origen enseña solo las filas de respaldo y lo dice', async () => {
    const { hoja } = hojaGrande()
    delete hoja.origen
    await montar({ datos: datosGrandes(hoja) })
    expect(filas()).toHaveLength(10)
    expect(texto('.snwv-cap')).toBe('⚠ Vista limitada a 10 filas (de 230). Descarga el Excel para el detalle completo.')
  })

  it('una hoja en memoria no dice nada de la base local', async () => {
    await montar()
    expect(q('.snwv-note')).toBeNull()
    expect(q('.snwv-cap')).toBeNull()
  })
})
