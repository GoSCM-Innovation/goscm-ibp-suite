// @vitest-environment jsdom
//
// El recorrido del Network Analyzer de v7: que los pasos aparezcan y desaparezcan como allí, que los
// tipos de material se lean de SAP al confirmar el mapeo, y que «▶ Ejecutar análisis» pregunte cómo
// verlo, baje, analice y entregue lo que se eligió.
//
// La descarga, el análisis y el Excel se sustituyen por dobles: aquí interesa el recorrido. El
// algoritmo se prueba en `core/ibp/network-analyzer.test.js`, la lectura de lo bajado en
// `lib/red-analizar.test.js` y el Excel en `xlsx-analisis.test.js`.

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

const analizarRedDescargada = vi.fn()
vi.mock('../../lib/red-analizar.js', () => ({ analizarRedDescargada }))

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

const { default: NetworkAnalyzer } = await import('./NetworkAnalyzer.jsx')

const DESTINO = { connectionId: 'c1', planningArea: 'SAP4', versionId: 'V1' }

const rol = (entidad) => ({ etiqueta: 'X', entidad, seguro: true, alternativas: [] })

/** Una detección donde todo resolvió: el paso ① sale sin nada que revisar. */
const MAPA = {
  prefijo: 'GID',
  entidades: ['GIDPRODUCT', 'GIDLOC', 'GIDCUST', 'GIDLS', 'GIDCS'],
  campos: {
    GIDPRODUCT: ['PRDID', 'PRDDESCR', 'MATTYPEID', 'ZGRUPO'],
    GIDLOC: ['LOCID', 'LOCDESCR', 'LOCTYPE', 'LOCVALID', 'ZREGION'],
    GIDCUST: ['CUSTID', 'CUSTDESCR', 'CUSTVALID'],
    GIDLS: ['PRDID', 'LOCFR', 'LOCID', 'TLEADTIME', 'TINVALID'],
    GIDCS: ['PRDID', 'LOCID', 'CUSTID', 'CLEADTIME', 'CINVALID'],
  },
  guardado: { roles: {}, fields: {} },
  detectado: {
    arbol: {},
    red: {
      product: rol('GIDPRODUCT'),
      locMaster: rol('GIDLOC'),
      custMaster: rol('GIDCUST'),
      location: rol('GIDLS'),
      customer: rol('GIDCS'),
    },
  },
}

const INFORME = {
  titulo: 'Supply Network Analyzer — vista web',
  archivo: 'SupplyNetworkAnalysis_2026-10-02.xlsx',
  generadoEl: '2026-10-02',
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
  totales: { totalProducts: 12345, completeProducts: 1, totalPaths: 2, ghostNodes: 0, avgHealthScore: 55 },
}

let contenedor
let raiz

async function montar() {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(NetworkAnalyzer, { area: 'SAP4', destino: DESTINO }))
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
  analizarRedDescargada.mockReset().mockResolvedValue(INFORME)
  armarLibroDeAnalisis.mockReset().mockResolvedValue(new ArrayBuffer(8))
  descargarLibro.mockReset()
  mango.validar.mockReset().mockResolvedValue(true)
  mango.bajar.mockReset().mockResolvedValue({ ok: true, hechos: [{ tabla: 'sn_loc', entidad: 'GIDLS' }] })
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

  it('el mapeo es el de la red: nueve tarjetas con los nombres de v7', async () => {
    await montar()
    const tarjetas = [...contenedor.querySelectorAll('.mdt-label')].map((u) => u.textContent)
    expect(tarjetas).toEqual([
      'Location Source', 'Customer Source', 'Product', 'Production Source Header', 'Location',
      'Customer', 'Production Source Item', 'Location Product', 'Customer Product',
    ])
    expect(contenedor.textContent).toContain('Selecciona las entidades de datos maestros para analizar la red de suministro.')
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

  it('pide el maestro de productos que se eligió en la tarjeta «Product» de la red', async () => {
    await montar()
    await pulsar(boton('Continuar →'))

    expect(leerTiposDeMaterial).toHaveBeenCalledWith({
      destino: DESTINO,
      entidad: 'GIDPRODUCT',
      mapa: {},
    })
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
    await pulsar(boton('← Volver')) // ⑤ → ④
    await pulsar(boton('← Volver')) // ④ → ③
    await pulsar(boton('← Volver')) // ③ → ② (abre el ②, el ③ se queda)
    await pulsar(boton('← Volver al mapeo'))

    expect(titulos()).toEqual(['Interpretación de resultados', 'MAPEO DE ENTIDADES'])
  })

  it('«← Volver» del ⑤ lo esconde y abre el ④, como en v7', async () => {
    await montar()
    await llegarAlCinco()
    await pulsar(boton('← Volver'))
    expect(titulos()).not.toContain('⑤ Ejecutar análisis')
    expect(titulos()).toContain('④ Campos adicionales de datos maestros')
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

  it('el ④ ofrece una entidad por cada hoja de la red, con los campos REALES de su tabla', async () => {
    await montar()
    await pulsar(boton('Continuar →'))
    await pulsar(boton('Continuar →'))
    await pulsar(boton('Continuar →'))

    const botones = [...contenedor.querySelectorAll('.ef-entity-buttons button')].map((b) => b.textContent)
    expect(botones).toEqual(['Product', 'Location', 'Customer', 'Location Source', 'Customer Source'])
  })

  it('el ⑤ resume la configuración con el texto de la red y no tiene «Cancelar»', async () => {
    await montar()
    await llegarAlCinco()

    expect(contenedor.textContent).toContain('Configuración por defecto — análisis estándar para todos los tipos')
    expect(boton('▶ Ejecutar análisis')).toBeTruthy()
    expect(propsDeLaDescarga.sinCancelar).toBe(true)
  })

  it('el ⑤ resume lo configurado igual que v7', async () => {
    await montar()
    await pulsar(boton('Continuar →'))
    await act(async () => { contenedor.querySelector('.mattype-toggle input').click() }) // excluye FERT
    await pulsar(boton('Continuar →'))
    await pulsar(boton('Continuar →'))
    await pulsar(boton('Continuar a ejecución →'))
    expect(contenedor.textContent).toContain('4000 productos incluidos en 1 tipo(s) · 120 productos excluidos (FERT)')
  })
})

describe('lo que baja el Network Analyzer', () => {
  it('las nueve tablas de v7 en su orden, las ocho imprescindibles y los campos exactos de v7', async () => {
    await montar()
    await llegarAlCinco()

    expect(propsDeLaDescarga.tablas).toEqual([
      'sn_loc', 'sn_cust', 'bom_prd', 'sn_plant', 'sn_psi', 'bom_loc', 'sn_loc_prod', 'sn_cust_master', 'sn_cust_prod',
    ])
    expect(propsDeLaDescarga.requeridas).toHaveLength(8)
    expect(propsDeLaDescarga.requeridas).not.toContain('bom_prd')
    expect(propsDeLaDescarga.solo.bom_prd).toEqual(['PRDID', 'PRDDESCR', 'MATTYPEID'])
    expect(propsDeLaDescarga.sinCancelar).toBe(true)
  })

  it('los maestros de la red se leen en el lugar donde el plan los busca', async () => {
    await montar()
    await llegarAlCinco()
    const efectivo = propsDeLaDescarga.ajustarEfectivo({
      arbol: { product: rol('DEL_ARBOL') },
      red: { product: rol('DE_LA_RED'), locMaster: rol('LOC_DE_LA_RED') },
    })
    expect(efectivo.arbol.product.entidad).toBe('DE_LA_RED')
    expect(efectivo.arbol.locMaster.entidad).toBe('LOC_DE_LA_RED')
  })

  it('los campos adicionales elegidos viajan a la descarga por tabla de la red', async () => {
    localStorage.setItem('ef_sel_sn_product_SAP4', JSON.stringify(['ZGRUPO']))
    localStorage.setItem('ef_sel_sn_locationSource_SAP4', JSON.stringify(['ZRUTA']))
    localStorage.setItem('ef_sel_sn_customer_SAP4', JSON.stringify(['ZCANAL']))
    await montar()
    await llegarAlCinco()

    expect(propsDeLaDescarga.extras).toEqual({ bom_prd: ['ZGRUPO'], sn_loc: ['ZRUTA'], sn_cust_master: ['ZCANAL'] })
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
    const entrada = analizarRedDescargada.mock.calls[0][0]
    expect(entrada.hechos).toEqual([{ tabla: 'sn_loc', entidad: 'GIDLS' }])
    expect(entrada.destino).toBe(DESTINO)
    expect(entrada.conexion).toEqual({ url: '', pa: 'SAP4', pver: 'V1' })
    // Solo Excel: las hojas de arcos no se guardan para la vista web.
    expect(entrada.web).toBe(false)

    expect(armarLibroDeAnalisis).toHaveBeenCalledWith(INFORME, expect.anything())
    expect(descargarLibro).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'SupplyNetworkAnalysis_2026-10-02.xlsx')

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

    expect(analizarRedDescargada.mock.calls[0][0].web).toBe(true)
    expect(descargarLibro).not.toHaveBeenCalled()
    expect(contenedor.textContent).toContain('🌐 Supply Network Analyzer — vista web')
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

    expect(analizarRedDescargada.mock.calls[0][0].web).toBe(true)
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
    expect(anotado.some((l) => /^ok\|\[\+\d+ms\] Análisis completado\. 12\.345 productos analizados · Excel descargado · \d+ s\.$/.test(l))).toBe(true)

    const dicho = mango.decir.mock.calls.map(([, texto]) => texto)
    expect(dicho).toContain('Generando archivo Excel...')
    expect(dicho.at(-1)).toMatch(/^✓ Análisis completado — Excel descargado \| 12\.345 productos · \d+ s$/)
    // La descarga termina en el 50 % de la barra, como en v7, y todo acaba en el 100 %.
    expect(mango.avanzar.mock.calls.map(([pct]) => pct)).toContain(50)
    expect(mango.avanzar).toHaveBeenLastCalledWith(100)
  })

  it('le pasa al análisis la barra y la línea de estado de la descarga', async () => {
    await montar()
    await llegarAlCinco()
    await pulsar(boton('▶ Ejecutar análisis'))
    await pulsar(botonDelModal('Descargar Excel'))

    const entrada = analizarRedDescargada.mock.calls[0][0]
    entrada.alEstado('Analizando red (3 productos)...')
    entrada.alProgreso(57)
    entrada.registrar('info', 'Fase 2: pre-índices...')
    expect(mango.decir).toHaveBeenCalledWith('info', 'Analizando red (3 productos)...')
    expect(mango.avanzar).toHaveBeenCalledWith(57)
    expect(mango.anotar.mock.calls.at(-1)[1]).toMatch(/^\[\+\d+ms\] Fase 2: pre-índices\.\.\.$/)
  })

  it('si la descarga no salió bien no analiza', async () => {
    mango.bajar.mockResolvedValue({ ok: false, hechos: [] })
    await montar()
    await llegarAlCinco()
    await pulsar(boton('▶ Ejecutar análisis'))
    await pulsar(botonDelModal('Ver en la web'))

    expect(analizarRedDescargada).not.toHaveBeenCalled()
    expect(contenedor.querySelector('.snwv-wrap')).toBeNull()
  })

  it('si el análisis falla lo dice en rojo, quita la barra y deja volver a intentar', async () => {
    analizarRedDescargada.mockRejectedValue(new Error('se acabó la memoria'))
    await montar()
    await llegarAlCinco()
    await pulsar(boton('▶ Ejecutar análisis'))
    await pulsar(botonDelModal('Descargar Excel'))

    expect(mango.decir).toHaveBeenCalledWith('err', 'Error: se acabó la memoria')
    expect(mango.anotar.mock.calls.some(([clase, texto]) => clase === 'err' && texto.includes('Error: se acabó la memoria'))).toBe(true)
    expect(mango.avanzar).toHaveBeenLastCalledWith(0)
    expect(boton('▶ Ejecutar análisis').disabled).toBe(false)
  })
})
