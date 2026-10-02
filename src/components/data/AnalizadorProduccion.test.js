// @vitest-environment jsdom
//
// El recorrido del Production Analyzer de v7: que los pasos aparezcan y desaparezcan como allí, que los
// tipos de material se lean de SAP al confirmar el mapeo, y que «▶ Ejecutar análisis» pregunte cómo
// verlo, baje, analice y entregue lo que se eligió.
//
// La descarga, el análisis y el Excel se sustituyen por dobles: aquí interesa el recorrido. El
// algoritmo se prueba en `core/ibp/production-analyzer.test.js` y el Excel en `xlsx-analisis.test.js`.

import { act, createElement, useImperativeHandle } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchExplorerMap = vi.fn()
vi.mock('../../lib/ibp-explorer.js', () => ({
  fetchExplorerMap,
  saveExplorerMap: vi.fn().mockResolvedValue({}),
  resetExplorerMap: vi.fn().mockResolvedValue({}),
}))

const leerTiposDeMaterial = vi.fn()
vi.mock('../../lib/tipos-de-material.js', () => ({ leerTiposDeMaterial }))

const analizarProduccionDescargada = vi.fn()
vi.mock('../../lib/produccion-analizar.js', () => ({ analizarProduccionDescargada }))

const armarLibroDeAnalisis = vi.fn()
vi.mock('../../lib/xlsx-analisis.js', () => ({ armarLibroDeAnalisis }))

const descargarLibro = vi.fn()
vi.mock('../../lib/bom-export.js', () => ({ descargarLibro }))

// La descarga habla con IndexedDB y con SAP. Se sustituye por un doble que expone el mismo mango.
const mango = {
  validar: vi.fn(),
  bajar: vi.fn(),
  decir: vi.fn(),
  anotar: vi.fn(),
  avanzar: vi.fn(),
}
let propsDeLaDescarga = null
function DescargaDeMentira(props) {
  propsDeLaDescarga = props
  useImperativeHandle(props.ref, () => mango)
  return createElement('div', { 'data-prueba': 'descarga' }, 'descarga')
}
vi.mock('./ExplorerExtract.jsx', () => ({ default: DescargaDeMentira }))

const { default: AnalizadorProduccion } = await import('./AnalizadorProduccion.jsx')

const DESTINO = { connectionId: 'c1', planningArea: 'SAP4', versionId: 'V1' }

const rol = (entidad) => ({ etiqueta: 'X', entidad, seguro: true, alternativas: [] })

/** Una detección donde todo resolvió: el paso ① sale sin nada que revisar. */
const MAPA = {
  prefijo: 'GID',
  entidades: ['GIDPRODUCT', 'GIDPSH'],
  campos: { GIDPRODUCT: ['PRDID', 'PRDDESCR', 'MATTYPEID', 'ZGRUPO'], GIDPSH: ['SOURCEID', 'PRDID'] },
  guardado: { roles: {}, fields: {} },
  detectado: {
    arbol: { product: rol('GIDPRODUCT'), header: rol('GIDPSH') },
    red: {},
  },
}

const INFORME = {
  titulo: 'Production Analyzer — vista web',
  archivo: 'ProductionHierarchyAnalysis_2026-10-01.xlsx',
  generadoEl: '2026-10-01',
  orden: ['Product'],
  hojasWeb: {
    Product: {
      nombre: 'Product',
      encabezados: ['Estado', 'Observación', 'PRDID'],
      filas: [{ c: ['✅ OK', 'todo bien', 'A1'], s: 'ok' }],
      total: 1,
      red: 0,
      yel: 0,
      ok: 1,
      conEstado: true,
    },
  },
  resumen: [{ nombre: 'Product', total: 1, red: 0, yel: 0, ok: 1 }],
  estadisticas: [],
  nombreEstadisticas: 'Estadísticas',
}

let contenedor
let raiz

async function montar() {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(AnalizadorProduccion, { area: 'SAP4', destino: DESTINO }))
  })
  // El panel ① pide el catálogo en el siguiente turno del reloj: hay que dejarle pasar.
  await act(async () => { await new Promise((resolver) => setTimeout(resolver, 10)) })
}

const titulos = () => [
  ...contenedor.querySelectorAll('.panel-title, .mattype-panel-title > span:first-child'),
].map((uno) => uno.textContent.replace(/[▼▶]/g, '').trim())

const boton = (texto) => [...contenedor.querySelectorAll('button')]
  .find((uno) => uno.textContent.trim() === texto)

const pulsar = async (elemento) => {
  await act(async () => {
    elemento.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

const botonDelModal = (texto) => [...document.querySelectorAll('.snwv-modal button')]
  .find((uno) => uno.textContent.includes(texto))

/** Confirma ① y avanza hasta ⑤. */
async function llegarAlCinco() {
  await pulsar(boton('Continuar →'))
  await pulsar(boton('Continuar →'))
  await pulsar(boton('Continuar →'))
  await pulsar(boton('Continuar a ejecución →'))
}

beforeEach(() => {
  localStorage.clear()
  propsDeLaDescarga = null
  fetchExplorerMap.mockReset().mockResolvedValue(MAPA)
  leerTiposDeMaterial.mockReset().mockResolvedValue({ cuenta: { FERT: 120, ROH: 4000 } })
  analizarProduccionDescargada.mockReset().mockResolvedValue(INFORME)
  armarLibroDeAnalisis.mockReset().mockResolvedValue(new ArrayBuffer(8))
  descargarLibro.mockReset()
  mango.validar.mockReset().mockResolvedValue(true)
  mango.bajar.mockReset().mockResolvedValue({ ok: true, hechos: [{ tabla: 'bom_psh', entidad: 'GIDPSH' }] })
  mango.decir.mockReset()
  mango.anotar.mockReset()
  mango.avanzar.mockReset()
})

afterEach(async () => {
  await act(async () => { raiz?.unmount() })
  contenedor?.remove()
  document.body.innerHTML = ''
})

describe('la entrada', () => {
  it('abre con «Interpretación de resultados» y solo el paso ①', async () => {
    await montar()
    expect(titulos()).toEqual(['Interpretación de resultados', 'MAPEO DE ENTIDADES'])
  })

  it('el panel de interpretación lleva al Glosario Analyzers', async () => {
    await montar()
    const enlace = [...contenedor.querySelectorAll('a')].find((a) => a.textContent === 'Glosario Analyzers')
    expect(enlace.getAttribute('href')).toBe('#/explorer/glosario')
  })
})

describe('los tipos de material se leen de SAP al confirmar el mapeo', () => {
  it('mientras llegan, el paso ② dice «Cargando tipos de material desde SAP IBP…»', async () => {
    let terminar
    leerTiposDeMaterial.mockReset().mockReturnValue(new Promise((resolver) => { terminar = resolver }))

    await montar()
    await pulsar(boton('Continuar →'))

    expect(titulos()).toContain('② Excluir tipos de material')
    expect(contenedor.textContent).toContain('⏳ Cargando tipos de material desde SAP IBP…')

    await act(async () => { terminar({ cuenta: { FERT: 3 } }) })
    expect(contenedor.textContent).not.toContain('⏳ Cargando')
    expect(contenedor.querySelector('.mattype-code').textContent).toBe('FERT')
  })

  it('pide la tabla de productos de ESTE tenant, con su mapa de campos', async () => {
    await montar()
    await pulsar(boton('Continuar →'))

    expect(leerTiposDeMaterial).toHaveBeenCalledWith({
      destino: DESTINO,
      entidad: 'GIDPRODUCT',
      mapa: {},
    })
  })

  it('lista los tipos con «N prods» y los columnas de v7', async () => {
    await montar()
    await pulsar(boton('Continuar →'))

    const cabeceras = [...contenedor.querySelectorAll('.mattype-toggle-table th')].map((th) => th.textContent)
    expect(cabeceras).toEqual(['Tipo', 'Productos', 'Incluir en análisis'])
    const filas = [...contenedor.querySelectorAll('.mattype-toggle-table tbody tr')].map((tr) => tr.textContent)
    expect(filas[0]).toContain('FERT')
    expect(filas[0]).toContain('120 prods')
    expect(filas[0]).toContain('Incluido')
  })

  it('si la lectura falla, la lista queda vacía como en v7 y se puede seguir', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
    leerTiposDeMaterial.mockReset().mockRejectedValue(new Error('sin red'))
    await montar()
    await pulsar(boton('Continuar →'))

    expect(contenedor.textContent).toContain('Carga datos primero para detectar los tipos de material.')
    expect(boton('Continuar →')).toBeTruthy()
    aviso.mockRestore()
  })
})

describe('el recorrido ② → ⑤', () => {
  it('cada «Continuar» hace aparecer el paso siguiente, y el ⑤ no existe antes', async () => {
    await montar()
    await pulsar(boton('Continuar →'))
    expect(titulos()).not.toContain('③ Categorizar tipos de material')

    await pulsar(boton('Continuar →'))
    expect(titulos()).toContain('③ Categorizar tipos de material')
    expect(titulos()).not.toContain('④ Campos adicionales de datos maestros')

    await pulsar(boton('Continuar →'))
    expect(titulos()).toContain('④ Campos adicionales de datos maestros')
    expect(titulos()).not.toContain('⑤ Ejecutar análisis')

    await pulsar(boton('Continuar a ejecución →'))
    expect(titulos()).toContain('⑤ Ejecutar análisis')
  })

  it('«← Volver al mapeo» esconde todos los pasos y reabre el ①', async () => {
    await montar()
    await llegarAlCinco()
    await pulsar(boton('← Volver'))      // ⑤ → ④
    await pulsar(boton('← Volver'))      // ④ → ③
    await pulsar(boton('← Volver'))      // ③ → ② (abre el ②, el ③ se queda)
    await pulsar(boton('← Volver al mapeo'))

    expect(titulos()).toEqual(['Interpretación de resultados', 'MAPEO DE ENTIDADES'])
  })

  it('«← Volver» del ④ lo esconde y abre el ③, como en v7', async () => {
    await montar()
    await pulsar(boton('Continuar →'))
    await pulsar(boton('Continuar →'))
    await pulsar(boton('Continuar →'))
    expect(titulos()).toContain('④ Campos adicionales de datos maestros')

    await pulsar(boton('← Volver'))
    expect(titulos()).not.toContain('④ Campos adicionales de datos maestros')
    expect(contenedor.querySelector('.mattype-matrix-table')).not.toBeNull()
  })

  it('el ② resume lo excluido con el texto de v7 y «Restablecer» lo deshace', async () => {
    await montar()
    await pulsar(boton('Continuar →'))
    expect(contenedor.textContent).toContain('Todos los tipos incluidos — sin configurar')

    await act(async () => { contenedor.querySelector('.mattype-toggle input').click() })
    expect(contenedor.textContent).toContain('1 tipo(s) excluido(s) · 120 producto(s) omitidos del análisis principal')
    expect(JSON.parse(localStorage.getItem('mattype_SAP4')).FERT.excluido).toBe(true)

    const restablecer = contenedor.querySelector('.mattype-reset-btn')
    await act(async () => { restablecer.click() })
    expect(contenedor.textContent).toContain('Todos los tipos incluidos — sin configurar')
  })

  it('el ③ no ofrece los tipos excluidos y resume las categorías', async () => {
    await montar()
    await pulsar(boton('Continuar →'))
    await act(async () => { contenedor.querySelector('.mattype-toggle input').click() }) // excluye FERT
    await pulsar(boton('Continuar →'))

    const tipos = [...contenedor.querySelectorAll('.mattype-matrix-table tbody .mattype-code')].map((u) => u.textContent)
    expect(tipos).toEqual(['ROH'])

    const interruptor = contenedor.querySelector('.mattype-matrix-table tbody input')
    await act(async () => { interruptor.click() })
    expect(contenedor.textContent).toContain('1 tipo(s) categorizado(s)')
  })

  it('el ④ ofrece los campos REALES de la tabla que resolvió el ①', async () => {
    await montar()
    await pulsar(boton('Continuar →'))
    await pulsar(boton('Continuar →'))
    await pulsar(boton('Continuar →'))

    const botones = [...contenedor.querySelectorAll('.ef-entity-buttons button')].map((b) => b.textContent)
    expect(botones).toContain('Product')
    expect(botones).toContain('Prod Source Header')
    // Las entidades sin tabla en este tenant no tienen botón, como en v7.
    expect(botones).not.toContain('Resource')
  })

  it('el ⑤ resume la configuración y no tiene «Cancelar»', async () => {
    await montar()
    await llegarAlCinco()

    expect(contenedor.textContent).toContain('Configuración por defecto — análisis estándar')
    expect(boton('▶ Ejecutar análisis')).toBeTruthy()
    expect(propsDeLaDescarga.sinCancelar).toBe(true)
  })
})

describe('lo que baja el Production Analyzer', () => {
  it('las diez tablas de v7, las cuatro imprescindibles y los campos de más de la cabecera', async () => {
    await montar()
    await llegarAlCinco()

    expect(propsDeLaDescarga.tablas).toEqual([
      'bom_psh', 'bom_psi', 'bom_psisub', 'bom_psr', 'bom_prd', 'bom_loc', 'bom_res', 'bom_resloc',
      'sn_loc_prod', 'sn_loc',
    ])
    expect(propsDeLaDescarga.requeridas).toEqual(['bom_psh', 'bom_psi', 'bom_psisub', 'sn_loc'])
    expect(propsDeLaDescarga.camposMas).toEqual({ bom_psh: ['PLEADTIME', 'PRATIO'] })
  })

  it('los campos adicionales elegidos viajan a la descarga por tabla', async () => {
    localStorage.setItem('ef_sel_pa_product_SAP4', JSON.stringify(['ZGRUPO']))
    await montar()
    await llegarAlCinco()

    expect(propsDeLaDescarga.extras).toEqual({ bom_prd: ['ZGRUPO'] })
  })
})

describe('«▶ Ejecutar análisis»', () => {
  it('si falta algo imprescindible no pregunta nada', async () => {
    mango.validar.mockResolvedValue(false)
    await montar()
    await llegarAlCinco()
    await pulsar(boton('▶ Ejecutar análisis'))

    expect(document.querySelector('.snwv-modal')).toBeNull()
    expect(mango.bajar).not.toHaveBeenCalled()
  })

  it('pregunta «¿Cómo quieres ver el análisis?» y «Cancelar» no baja nada', async () => {
    await montar()
    await llegarAlCinco()
    await pulsar(boton('▶ Ejecutar análisis'))

    expect(document.querySelector('.snwv-modal').textContent).toContain('¿Cómo quieres ver el análisis?')

    await pulsar(botonDelModal('Cancelar'))
    expect(document.querySelector('.snwv-modal')).toBeNull()
    expect(mango.bajar).not.toHaveBeenCalled()
    expect(boton('▶ Ejecutar análisis').disabled).toBe(false)
  })

  it('«Descargar Excel» baja, analiza, descarga el archivo y muestra el banner', async () => {
    await montar()
    await llegarAlCinco()
    await pulsar(boton('▶ Ejecutar análisis'))
    await pulsar(botonDelModal('Descargar Excel'))

    expect(mango.bajar).toHaveBeenCalledTimes(1)
    const entrada = analizarProduccionDescargada.mock.calls[0][0]
    expect(entrada.hechos).toEqual([{ tabla: 'bom_psh', entidad: 'GIDPSH' }])
    expect(entrada.destino).toBe(DESTINO)
    expect(entrada.conexion).toEqual({ url: '', pa: 'SAP4', pver: 'V1' })

    expect(armarLibroDeAnalisis).toHaveBeenCalledWith(INFORME, expect.anything())
    expect(descargarLibro).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'ProductionHierarchyAnalysis_2026-10-01.xlsx')

    expect(contenedor.textContent).toContain('¡Análisis completado!')
    expect(contenedor.textContent).toContain('El informe ha sido descargado exitosamente.')
    expect(contenedor.querySelector('.snwv-wrap')).toBeNull()
    // El botón no cambia de texto.
    expect(boton('▶ Ejecutar análisis').disabled).toBe(false)
  })

  it('«Ver en la web» no descarga y deja el botón de Excel en la vista', async () => {
    await montar()
    await llegarAlCinco()
    await pulsar(boton('▶ Ejecutar análisis'))
    await pulsar(botonDelModal('Ver en la web'))

    expect(descargarLibro).not.toHaveBeenCalled()
    expect(contenedor.textContent).toContain('🌐 Production Analyzer — vista web')
    expect(contenedor.textContent).not.toContain('¡Análisis completado!')
    expect(boton('⬇️ Descargar Excel')).toBeTruthy()

    await pulsar(boton('⬇️ Descargar Excel'))
    expect(descargarLibro).toHaveBeenCalledTimes(1)
  })

  it('«Ambos» descarga el Excel y muestra la vista con la nota de que ya se descargó', async () => {
    await montar()
    await llegarAlCinco()
    await pulsar(boton('▶ Ejecutar análisis'))
    await pulsar(botonDelModal('Ambos'))

    expect(descargarLibro).toHaveBeenCalledTimes(1)
    expect(contenedor.textContent).toContain('✅ Excel descargado')
    expect(boton('⬇️ Descargar Excel')).toBeUndefined()
    expect(contenedor.textContent).not.toContain('¡Análisis completado!')
  })

  it('escribe en la barra, la línea de estado y el registro los textos de v7', async () => {
    await montar()
    await llegarAlCinco()
    await pulsar(boton('▶ Ejecutar análisis'))
    await pulsar(botonDelModal('Descargar Excel'))

    const anotado = mango.anotar.mock.calls.map(([clase, texto]) => `${clase}|${texto}`)
    expect(anotado.some((l) => /^ok\|\[\+\d+ms\] Descarga completa\. Iniciando análisis\.\.\.$/.test(l))).toBe(true)
    expect(anotado.some((l) => /^ok\|\[\+\d+ms\] Análisis completado · Excel descargado · \d+ms\.$/.test(l))).toBe(true)

    const dicho = mango.decir.mock.calls.map(([, texto]) => texto)
    expect(dicho).toContain('Analizando...')
    expect(dicho).toContain('Generando archivo Excel...')
    expect(dicho.at(-1)).toMatch(/^✓ Completado · \d+ ms$/)
    expect(mango.avanzar).toHaveBeenLastCalledWith(100)
  })

  it('si la descarga no salió bien no analiza', async () => {
    mango.bajar.mockResolvedValue({ ok: false, hechos: [] })
    await montar()
    await llegarAlCinco()
    await pulsar(boton('▶ Ejecutar análisis'))
    await pulsar(botonDelModal('Ver en la web'))

    expect(analizarProduccionDescargada).not.toHaveBeenCalled()
    expect(contenedor.querySelector('.snwv-wrap')).toBeNull()
  })

  it('si el análisis falla lo dice en rojo y deja volver a intentar', async () => {
    analizarProduccionDescargada.mockRejectedValue(new Error('se acabó la memoria'))
    await montar()
    await llegarAlCinco()
    await pulsar(boton('▶ Ejecutar análisis'))
    await pulsar(botonDelModal('Descargar Excel'))

    expect(mango.decir).toHaveBeenCalledWith('err', 'Error: se acabó la memoria')
    expect(mango.anotar.mock.calls.some(([clase, texto]) => clase === 'err' && texto.includes('se acabó la memoria'))).toBe(true)
    expect(boton('▶ Ejecutar análisis').disabled).toBe(false)
  })
})
